from fastapi import FastAPI, APIRouter, Depends, HTTPException, Header, status, BackgroundTasks, Request
from fastapi.responses import PlainTextResponse, HTMLResponse, Response
from urllib.parse import quote_plus as _quote_plus_std
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import bcrypt
import jwt
import httpx
import smtplib
import ssl
import asyncio
import base64
import json as _json_stdlib
import secrets
import io
import pyotp
import qrcode
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import formataddr
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any, Literal, Tuple
from datetime import datetime, timezone, timedelta


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# JWT config
# In production JWT_SECRET MUST be provided via environment. In dev/test we allow a
# non-persistent random fallback that is generated fresh on process start so tokens
# never leak across environments and are never predictable.
_JWT_SECRET_ENV = os.environ.get('JWT_SECRET')
if _JWT_SECRET_ENV:
    JWT_SECRET = _JWT_SECRET_ENV
elif os.environ.get('APP_ENV', 'development').lower() in ('production', 'prod'):
    raise RuntimeError("JWT_SECRET environment variable is required in production but was not set.")
else:
    import secrets as _secrets_mod
    JWT_SECRET = _secrets_mod.token_urlsafe(64)
    import logging as _logging_mod
    _logging_mod.getLogger(__name__).warning(
        "JWT_SECRET not set; generated a random per-process secret for development. "
        "All sessions will invalidate on backend restart."
    )
JWT_ALG = 'HS256'
JWT_EXP_DAYS = 30

# 2FA config
TOTP_ISSUER = os.environ.get('TOTP_ISSUER', 'Dal Pastro CRM')
TEMP_2FA_TOKEN_MINUTES = 10
DEVICE_TRUST_HOURS = 24

app = FastAPI()
api_router = APIRouter(prefix="/api")


# =========================
# Helpers
# =========================
def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def create_jwt(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "iat": int(utcnow().timestamp()),
        "exp": int((utcnow() + timedelta(days=JWT_EXP_DAYS)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def create_temp_2fa_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "purpose": "2fa_pending",
        "iat": int(utcnow().timestamp()),
        "exp": int((utcnow() + timedelta(minutes=TEMP_2FA_TOKEN_MINUTES)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def totp_provisioning_uri(email: str, secret: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=TOTP_ISSUER)


def qr_png_data_url(data: str) -> str:
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=6, border=2)
    qr.add_data(data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#0F2438", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def generate_backup_codes(count: int = 10) -> list[str]:
    # 10-char, split into 5-5 for display: XXXXX-XXXXX
    codes = []
    for _ in range(count):
        raw = secrets.token_hex(5).upper()  # 10 chars
        codes.append(f"{raw[:5]}-{raw[5:]}")
    return codes


def hash_backup_code(code: str) -> str:
    # Normalize by removing dashes/spaces + upper
    norm = code.replace("-", "").replace(" ", "").upper()
    return bcrypt.hashpw(norm.encode(), bcrypt.gensalt()).decode()


def verify_backup_code(code: str, hashed: str) -> bool:
    try:
        norm = code.replace("-", "").replace(" ", "").upper()
        return bcrypt.checkpw(norm.encode(), hashed.encode())
    except Exception:
        return False


def strip_id(doc: Optional[dict]) -> Optional[dict]:
    if not doc:
        return doc
    doc.pop("_id", None)
    return doc


async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1].strip()

    # Try JWT first
    user_id = None
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        user_id = payload.get("sub")
    except Exception:
        # Try session token (Google auth)
        session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
        if session:
            exp = session.get("expires_at")
            if isinstance(exp, datetime):
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
                if exp < utcnow():
                    raise HTTPException(status_code=401, detail="Session expired")
            user_id = session.get("user_id")

    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0, "totp_secret": 0, "totp_secret_pending": 0, "backup_codes": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


# =========================
# Models
# =========================
class RegisterInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str


class LoginInput(BaseModel):
    email: EmailStr
    password: str


class TwoFAVerifyInput(BaseModel):
    temp_token: str
    code: str


class TwoFAConfirmInput(BaseModel):
    code: str


class TwoFADisableInput(BaseModel):
    password: Optional[str] = None
    code: Optional[str] = None  # TOTP or backup code (alternative to password)


class GoogleSessionInput(BaseModel):
    session_id: str


class UserOut(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    role: str = "owner"
    areas: List[str] = Field(default_factory=lambda: ["energy", "network"])
    parent_user_id: Optional[str] = None
    avatar_base64: Optional[str] = None
    two_factor_enabled: bool = False
    additional_emails: List[str] = Field(default_factory=list)  # V38H
    # V38I — Report branding
    company_name: Optional[str] = None
    company_logo_base64: Optional[str] = None
    # V38U — Report header extras (slogan + contacts printed as header)
    report_slogan: Optional[str] = None
    report_contacts: Optional[str] = None


class TeamInviteInput(BaseModel):
    email: EmailStr
    name: str
    password: str = Field(min_length=6)
    areas: List[Literal["energy", "network"]] = Field(default_factory=lambda: ["energy", "network"])


class TeamUpdateInput(BaseModel):
    areas: Optional[List[Literal["energy", "network"]]] = None
    name: Optional[str] = None


def tenant_id(user: dict) -> str:
    """Owner's user_id (tenant root). For owner returns own id, for sub-user returns parent."""
    return user.get("parent_user_id") or user["user_id"]


def is_owner(user: dict) -> bool:
    return user.get("role") == "owner" and not user.get("parent_user_id")


def is_admin_or_owner(user: dict) -> bool:
    """True if user is owner OR promoted admin (regardless of level in hierarchy)."""
    return is_owner(user) or user.get("role") == "admin"


async def descendant_user_ids(user_id: str) -> List[str]:
    """Return all user_ids that directly or transitively descend from `user_id` (BFS)."""
    result: List[str] = []
    queue = [user_id]
    seen = {user_id}
    while queue:
        current = queue.pop(0)
        children = await db.users.find({"parent_user_id": current}, {"user_id": 1, "_id": 0}).to_list(1000)
        for c in children:
            uid = c["user_id"]
            if uid in seen:
                continue
            seen.add(uid)
            result.append(uid)
            queue.append(uid)
    return result


async def resolve_broadcast_recipients(creator: dict, scope: str, custom_ids: Optional[List[str]] = None) -> List[str]:
    """Compute recipient user_ids for a broadcast event.
    - "all": all users under the tenant (owner + all sub-users)
    - "subtree": creator's direct and transitive descendants (creator NOT included)
    - "custom": explicit list, filtered to tenant members
    Owner (creator) is always excluded from recipient list.
    """
    tid = tenant_id(creator)
    # Get all tenant member IDs
    if scope == "all":
        all_users = await db.users.find(
            {"$or": [{"user_id": tid}, {"parent_user_id": tid}]},
            {"user_id": 1, "_id": 0},
        ).to_list(2000)
        # For a nested hierarchy, also include descendants beyond direct children
        # (currently parent_user_id points to any ancestor, but conservative: also traverse)
        ids = {u["user_id"] for u in all_users}
        # Expand via descendants of tenant root
        for uid in await descendant_user_ids(tid):
            ids.add(uid)
        ids.discard(creator["user_id"])
        return list(ids)
    if scope == "subtree":
        ids = set(await descendant_user_ids(creator["user_id"]))
        ids.discard(creator["user_id"])
        return list(ids)
    if scope == "custom":
        req = set(custom_ids or [])
        # Filter to same tenant
        allowed = await db.users.find(
            {"$or": [{"user_id": tid}, {"parent_user_id": {"$exists": True}}],
             "user_id": {"$in": list(req)}},
            {"user_id": 1, "parent_user_id": 1, "_id": 0},
        ).to_list(2000)
        # keep only those in tenant
        result = []
        for u in allowed:
            if u["user_id"] == tid or u.get("parent_user_id") == tid:
                result.append(u["user_id"])
            else:
                # deep descendant: verify by walking up
                cur = u
                while cur.get("parent_user_id"):
                    if cur["parent_user_id"] == tid:
                        result.append(u["user_id"])
                        break
                    cur = await db.users.find_one({"user_id": cur["parent_user_id"]}, {"parent_user_id": 1, "user_id": 1, "_id": 0})
                    if not cur: break
        if creator["user_id"] in result:
            result.remove(creator["user_id"])
        return list(set(result))
    return []


def check_area_allowed(user: dict, area: str):
    allowed = user.get("areas") or ["energy", "network"]
    if area not in allowed:
        raise HTTPException(status_code=403, detail=f"Area '{area}' non consentita per questo utente")


def scope_query(user: dict, extra: Dict[str, Any] = None) -> Dict[str, Any]:
    """Build a MongoDB filter that scopes reads based on user role.
    - Owner: everything in tenant (user_id == owner_id)
    - Sub-user: only records they created (created_by == user_id), still under same tenant
    """
    q: Dict[str, Any] = {"user_id": tenant_id(user)}
    if not is_owner(user):
        q["created_by"] = user["user_id"]
    if extra:
        q.update(extra)
    return q


def tenant_scope(user: dict, extra: Dict[str, Any] = None) -> Dict[str, Any]:
    """Tenant-only scope (no created_by restriction). Used by contact endpoints
    where role-based visibility is controlled by `contact_visibility_filter`.
    """
    q: Dict[str, Any] = {"user_id": tenant_id(user)}
    if extra:
        q.update(extra)
    return q


class CustomArea(BaseModel):
    id: str
    name: str
    color: str = "#6B7280"
    icon: str = "briefcase"


class SettingsModel(BaseModel):
    energy_title: str = "Consulente Energetico"
    energy_color: str = "#EF4444"
    network_title: str = "Networker"
    network_color: str = "#2563EB"
    app_name: str = "Dal Pastro CRM"
    custom_appointment_types: List[str] = Field(default_factory=list)
    custom_product_categories: List[Dict[str, Any]] = Field(default_factory=list)
    custom_areas: List[Dict[str, Any]] = Field(default_factory=list)
    appointment_outcomes: List[Dict[str, Any]] = Field(default_factory=list)
    call_outcomes: List[Dict[str, Any]] = Field(default_factory=list)
    callback_notify_default_advance_min: int = 10
    disable_callback_notifications: bool = False
    contact_source_options: List[Dict[str, Any]] = Field(default_factory=list)
    # V27 — Referral / Call script templates (configured by Master, used by all agents)
    wa_referral_template: str = ""  # WhatsApp message for "Chiedi Referenze" (customer → their contacts). Supports {name} placeholder.
    call_script: str = ""  # Floating script overlay for agents during phone calls


DEFAULT_CALL_OUTCOMES = [
    {"id": "call_appointment", "name": "Presa Appuntamento", "color": "#16A34A", "icon": "calendar"},
    {"id": "call_busy", "name": "Occupato", "color": "#C83232", "icon": "call-outline"},
    {"id": "call_recall", "name": "Mi richiama", "color": "#0891B2", "icon": "time"},
    {"id": "call_no_answer", "name": "Nessuna risposta", "color": "#B77C14", "icon": "call"},
    {"id": "call_wrong_number", "name": "Numero errato", "color": "#6B7280", "icon": "warning"},
    {"id": "call_not_interested", "name": "Non interessato", "color": "#DC2626", "icon": "close-circle"},
]


DEFAULT_APPT_OUTCOMES = [
    {"id": "out_contract", "name": "Contratto fatto", "color": "#16A34A", "icon": "checkmark-done", "counts_as": "contract"},
    {"id": "out_new_energy", "name": "Nuovo cliente Consulente Energetico", "color": "#C83232", "icon": "flash", "counts_as": "new_energy"},
    {"id": "out_new_network", "name": "Nuovo cliente Networker", "color": "#1B6CB0", "icon": "people", "counts_as": "new_network"},
    {"id": "out_rescheduled", "name": "Rinviato", "color": "#B77C14", "icon": "calendar", "counts_as": "rescheduled"},
    {"id": "out_no_interest", "name": "Non interessato", "color": "#6B7280", "icon": "close-circle", "counts_as": "no_interest"},
    {"id": "out_followup", "name": "Da ricontattare", "color": "#0891B2", "icon": "call", "counts_as": "followup"},
]


DEFAULT_SOURCE_OPTIONS = [
    {"id": "personal", "name": "Personale", "icon": "person", "color": "#2563EB", "note": ""},
    {"id": "referral", "name": "Referenza", "icon": "share-social", "color": "#10B981", "note": ""},
    {"id": "web", "name": "Sito Web", "icon": "globe", "color": "#8B5CF6", "note": ""},
    {"id": "social", "name": "Social Media", "icon": "logo-instagram", "color": "#EC4899", "note": ""},
    {"id": "event", "name": "Evento/Fiera", "icon": "calendar", "color": "#F59E0B", "note": ""},
]


AreaLiteral = Literal["energy", "network"]


class ContactNote(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    kind: Literal["text", "audio", "photo", "video", "file", "link"] = "text"
    category: Optional[Literal["general", "email", "referral"]] = None
    text: Optional[str] = None
    audio_base64: Optional[str] = None
    audio_mime: Optional[str] = None
    photo_base64: Optional[str] = None
    video_base64: Optional[str] = None
    video_mime: Optional[str] = None
    file_base64: Optional[str] = None
    file_name: Optional[str] = None
    file_mime: Optional[str] = None
    file_size: Optional[int] = None
    link_url: Optional[str] = None
    link_title: Optional[str] = None
    duration_ms: Optional[int] = None
    created_at: datetime = Field(default_factory=utcnow)


class ContactFile(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    mime: str
    data_base64: str
    size: int = 0
    created_at: datetime = Field(default_factory=utcnow)


class ContactIn(BaseModel):
    first_name: str
    last_name: str = ""
    contact_code: Optional[str] = None
    assigned_to_user_id: Optional[str] = None  # V24: assignment for visibility filtering
    phone: str = ""
    phone_alt: str = ""
    whatsapp: str = ""
    email: str = ""
    email_alt: str = ""
    address: str = ""
    address_street: str = ""
    address_number: str = ""
    address_zip: str = ""
    address_city: str = ""
    address_province: str = ""
    work_address: str = ""       # V26.h: indirizzo di lavoro (free text)
    residence_address: str = ""  # V26.h: indirizzo di residenza (free text)
    birth_date: Optional[str] = None
    birthday_alert_days_before: int = 1
    birthday_auto_send: bool = False
    birthday_message: str = ""
    birthday_message_photo: Optional[str] = None
    birthday_message_link: Optional[str] = None
    # V38H: sender/recipient selection + active client flag
    birthday_sender_email: Optional[str] = None
    birthday_recipient_email: Optional[str] = None
    is_active_client: bool = False
    anniversaries: List[Dict[str, Any]] = Field(default_factory=list)
    fiscal_code: str = ""
    vat_number: str = ""
    website: str = ""
    linkedin: str = ""
    instagram: str = ""
    facebook: str = ""
    telegram: str = ""
    area: AreaLiteral = "energy"
    additional_areas: List[str] = Field(default_factory=list)
    source: Literal["personal", "referral"] = "personal"
    referred_by_contact_id: Optional[str] = None
    referral_type: Optional[Literal["direct", "from_contact"]] = None
    referral_note: str = ""
    email_note: str = ""
    general_note: str = ""
    tags: List[str] = Field(default_factory=list)
    group_ids: List[str] = Field(default_factory=list)
    # V27 — Contact status classification (Master can change any time from the detail screen)
    status: Literal["prospect", "collaborator", "client"] = "prospect"


class ContactUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    contact_code: Optional[str] = None
    assigned_to_user_id: Optional[str] = None
    phone: Optional[str] = None
    phone_alt: Optional[str] = None
    whatsapp: Optional[str] = None
    email: Optional[str] = None
    email_alt: Optional[str] = None
    address: Optional[str] = None
    address_street: Optional[str] = None
    address_number: Optional[str] = None
    address_zip: Optional[str] = None
    address_city: Optional[str] = None
    address_province: Optional[str] = None
    work_address: Optional[str] = None       # V26.h
    residence_address: Optional[str] = None  # V26.h
    birth_date: Optional[str] = None
    birthday_alert_days_before: Optional[int] = None
    birthday_auto_send: Optional[bool] = None
    birthday_message: Optional[str] = None
    birthday_message_photo: Optional[str] = None
    birthday_message_link: Optional[str] = None
    birthday_sender_email: Optional[str] = None  # V38H
    birthday_recipient_email: Optional[str] = None  # V38H
    is_active_client: Optional[bool] = None  # V38H
    anniversaries: Optional[List[Dict[str, Any]]] = None
    fiscal_code: Optional[str] = None
    vat_number: Optional[str] = None
    website: Optional[str] = None
    linkedin: Optional[str] = None
    instagram: Optional[str] = None
    facebook: Optional[str] = None
    telegram: Optional[str] = None
    area: Optional[AreaLiteral] = None
    additional_areas: Optional[List[str]] = None
    source: Optional[Literal["personal", "referral"]] = None
    referred_by_contact_id: Optional[str] = None
    referral_type: Optional[Literal["direct", "from_contact"]] = None
    referral_note: Optional[str] = None
    email_note: Optional[str] = None
    general_note: Optional[str] = None
    tags: Optional[List[str]] = None
    group_ids: Optional[List[str]] = None
    avatar_base64: Optional[str] = None
    # V27 — Contact status
    status: Optional[Literal["prospect", "collaborator", "client"]] = None


class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    avatar_base64: Optional[str] = None
    additional_emails: Optional[List[str]] = None  # V38H
    # V38I — Report branding
    company_name: Optional[str] = None
    company_logo_base64: Optional[str] = None
    # V38U — Report header extras
    report_slogan: Optional[str] = None
    report_contacts: Optional[str] = None


class AppointmentIn(BaseModel):
    contact_id: Optional[str] = None
    title: str
    area: AreaLiteral = "energy"
    start_at: datetime
    end_at: Optional[datetime] = None
    duration_min: int = 60
    is_phone: bool = False
    phone_mobile: str = ""  # V26.p: numero cellulare per chiamata
    phone_work: str = ""    # V26.p: numero aziendale per chiamata
    phone_target: Literal["mobile", "work", ""] = ""  # V26.p: quale numero usare
    email: str = ""         # v2.16 — email diretta appuntamento (fallback per share sheet)
    location: str = ""
    map_address: str = ""
    full_address: str = ""  # V26.p: indirizzo completo (auto-fill dal contatto)
    # v2.16 — Indirizzo strutturato (in aggiunta a location per backward compat)
    address_street: str = ""    # Via/Piazza
    address_number: str = ""    # Numero civico
    address_city: str = ""      # Città
    address_zip: str = ""       # CAP
    address_province: str = ""  # Provincia
    notes: str = ""
    note_attachments: List[Dict[str, Any]] = Field(default_factory=list)
    reminder_minutes: int = 15
    recurrence: Literal["none", "weekly", "monthly", "yearly"] = "none"
    participant_contact_ids: List[str] = Field(default_factory=list)
    value_amount: float = 0.0
    appointment_type_tags: List[str] = Field(default_factory=list)
    product_categories: List[str] = Field(default_factory=list)
    # Broadcast fields (admin/owner only)
    is_broadcast: bool = False
    broadcast_scope: Optional[Literal["all", "subtree", "custom"]] = None
    broadcast_to_user_ids: List[str] = Field(default_factory=list)
    broadcast_notify_advance_min: int = 15


class AppointmentUpdate(BaseModel):
    title: Optional[str] = None
    area: Optional[AreaLiteral] = None
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    duration_min: Optional[int] = None
    is_phone: Optional[bool] = None
    phone_mobile: Optional[str] = None
    phone_work: Optional[str] = None
    phone_target: Optional[Literal["mobile", "work", ""]] = None
    email: Optional[str] = None  # v2.16
    done: Optional[bool] = None
    location: Optional[str] = None
    map_address: Optional[str] = None
    full_address: Optional[str] = None
    # v2.16 — structured address parts
    address_street: Optional[str] = None
    address_number: Optional[str] = None
    address_city: Optional[str] = None
    address_zip: Optional[str] = None
    address_province: Optional[str] = None
    notes: Optional[str] = None
    note_attachments: Optional[List[Dict[str, Any]]] = None
    outcome_tags: Optional[List[str]] = None
    broadcast_notify_advance_min: Optional[int] = None
    outcome_notes: Optional[str] = None
    products_sold: Optional[int] = None
    contract_signed: Optional[bool] = None
    reminder_minutes: Optional[int] = None
    recurrence: Optional[Literal["none", "weekly", "monthly", "yearly"]] = None
    participant_contact_ids: Optional[List[str]] = None
    value_amount: Optional[float] = None
    appointment_type_tags: Optional[List[str]] = None
    product_categories: Optional[List[str]] = None
    outcome_ids: Optional[List[str]] = None
    rescheduled_to: Optional[str] = None
    # V38W — allow linking / relinking a contact from the appointment detail
    contact_id: Optional[str] = None


class CallbackIn(BaseModel):
    contact_id: Optional[str] = None
    title: str
    area: AreaLiteral = "energy"
    scheduled_at: datetime
    note: str = ""
    phone: Optional[str] = None
    notify: bool = True
    notify_advance_min: Optional[int] = None  # None = use user default


class CallbackUpdate(BaseModel):
    title: Optional[str] = None
    area: Optional[AreaLiteral] = None
    scheduled_at: Optional[datetime] = None
    note: Optional[str] = None
    done: Optional[bool] = None
    phone: Optional[str] = None
    notify: Optional[bool] = None
    notify_advance_min: Optional[int] = None
    last_call_outcome_id: Optional[str] = None
    last_call_at: Optional[datetime] = None


class CallLogIn(BaseModel):
    contact_id: Optional[str] = None
    callback_id: Optional[str] = None
    appointment_id: Optional[str] = None
    phone: Optional[str] = None
    outcome_id: Optional[str] = None
    note: str = ""
    duration_sec: int = 0
    # V28.c — Communication channel (phone by default). Enables the unified
    # "Comunicazioni" timeline in the contact card. Values: phone|sms|whatsapp|email|telegram.
    channel: Optional[str] = None
    # If outcome triggers a reschedule
    reschedule_at: Optional[datetime] = None
    reschedule_delta_min: Optional[int] = None  # Alternative to reschedule_at


# ============ MY THING (personal space) ============
MyThingKind = Literal["message", "image", "event", "anniversary"]


class MyThingIn(BaseModel):
    kind: MyThingKind
    title: str = ""
    body: str = ""
    image_base64: Optional[str] = None
    scheduled_at: Optional[datetime] = None      # events / anniversaries
    daily_time: Optional[str] = None             # HH:MM for scheduled daily messages
    recurring: Literal["none", "daily", "yearly"] = "none"
    display_mode: Literal["random", "scheduled"] = "random"
    notify: bool = False
    active: bool = True
    color: str = "#FFFFFF"
    # V28.d — banner customization for message slides on the home dashboard
    font_family: Optional[str] = None  # "system" | "serif" | "monospace" | "rounded"
    font_size: Optional[str] = None    # "small" | "medium" | "large"


class MyThingUpdate(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    image_base64: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    daily_time: Optional[str] = None
    recurring: Optional[Literal["none", "daily", "yearly"]] = None
    display_mode: Optional[Literal["random", "scheduled"]] = None
    notify: Optional[bool] = None
    active: Optional[bool] = None
    color: Optional[str] = None
    font_family: Optional[str] = None
    font_size: Optional[str] = None


# =========================
# Auth
# =========================
@api_router.post("/auth/register")
async def register(body: RegisterInput):
    existing = await db.users.find_one({"email": body.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email già registrata")
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    doc = {
        "user_id": user_id,
        "email": body.email.lower(),
        "name": body.name,
        "password_hash": hash_password(body.password),
        "role": "owner",
        "areas": ["energy", "network"],
        "picture": None,
        "created_at": utcnow(),
    }
    await db.users.insert_one(doc)
    # Init default settings
    await db.settings.insert_one({
        "user_id": user_id,
        **SettingsModel().model_dump(),
    })
    token = create_jwt(user_id)
    return {"token": token, "user": UserOut(**{k: doc.get(k) for k in ["user_id", "email", "name", "picture", "role", "areas", "parent_user_id"]}).model_dump()}


@api_router.post("/auth/login")
async def login(body: LoginInput):
    user = await db.users.find_one({"email": body.email.lower()})
    if not user or not user.get("password_hash") or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Credenziali non valide")

    # If 2FA enabled, return temp token requiring 2FA
    if user.get("two_factor_enabled"):
        return {
            "requires_2fa": True,
            "temp_token": create_temp_2fa_token(user["user_id"]),
        }

    token = create_jwt(user["user_id"])
    strip_id(user)
    user.pop("password_hash", None)
    trust_expires_at = utcnow() + timedelta(hours=DEVICE_TRUST_HOURS)
    return {
        "token": token,
        "user": UserOut(**user).model_dump(),
        "trust_expires_at": trust_expires_at.isoformat(),
    }


@api_router.post("/auth/login/2fa")
async def login_2fa(body: TwoFAVerifyInput):
    try:
        payload = jwt.decode(body.temp_token, JWT_SECRET, algorithms=[JWT_ALG])
    except Exception:
        raise HTTPException(status_code=401, detail="Token temporaneo non valido o scaduto")
    if payload.get("purpose") != "2fa_pending":
        raise HTTPException(status_code=401, detail="Token non valido")
    user_id = payload.get("sub")
    user = await db.users.find_one({"user_id": user_id})
    if not user or not user.get("two_factor_enabled"):
        raise HTTPException(status_code=401, detail="Sessione non valida")

    code = (body.code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="Codice mancante")

    verified = False
    used_backup_index = None

    # Try backup codes first (if code contains letters or dashes, it's likely a backup code)
    if not code.isdigit() or len(code) >= 8:
        for idx, item in enumerate(user.get("backup_codes") or []):
            if item.get("used_at") is None and verify_backup_code(code, item["hash"]):
                used_backup_index = idx
                verified = True
                break

    # Try TOTP
    if not verified and code.isdigit() and len(code) == 6:
        try:
            totp = pyotp.TOTP(user["totp_secret"])
            timecode = totp.verify(code, valid_window=1)
            if timecode:
                # Prevent replay: check last used
                last = user.get("totp_last_code")
                if last == code:
                    raise HTTPException(status_code=401, detail="Codice già utilizzato, attendi il prossimo")
                verified = True
                await db.users.update_one(
                    {"user_id": user_id},
                    {"$set": {"totp_last_code": code, "totp_last_verified_at": utcnow()}},
                )
        except HTTPException:
            raise
        except Exception:
            verified = False

    if not verified:
        raise HTTPException(status_code=401, detail="Codice 2FA non valido")

    # Mark backup code as used
    if used_backup_index is not None:
        codes_list = user.get("backup_codes") or []
        codes_list[used_backup_index]["used_at"] = utcnow()
        await db.users.update_one({"user_id": user_id}, {"$set": {"backup_codes": codes_list}})

    token = create_jwt(user_id)
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0, "totp_secret": 0, "backup_codes": 0})
    trust_expires_at = utcnow() + timedelta(hours=DEVICE_TRUST_HOURS)
    return {
        "token": token,
        "user": UserOut(**user).model_dump(),
        "trust_expires_at": trust_expires_at.isoformat(),
        "used_backup_code": used_backup_index is not None,
    }


@api_router.post("/auth/2fa/setup/start")
async def twofa_setup_start(user=Depends(get_current_user)):
    """Generate a fresh TOTP secret (not activated until confirmed)."""
    secret = pyotp.random_base32()
    uri = totp_provisioning_uri(user["email"], secret)
    # Store as pending secret (does NOT enable yet)
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"totp_secret_pending": secret}},
    )
    return {
        "otpauth_uri": uri,
        "qr_code_data_url": qr_png_data_url(uri),
        "secret": secret,  # Show once for manual entry
    }


@api_router.post("/auth/2fa/setup/confirm")
async def twofa_setup_confirm(body: TwoFAConfirmInput, user=Depends(get_current_user)):
    fresh = await db.users.find_one({"user_id": user["user_id"]})
    secret = fresh.get("totp_secret_pending")
    if not secret:
        raise HTTPException(status_code=400, detail="Nessun setup 2FA in corso. Ricomincia.")
    code = (body.code or "").strip()
    if not code.isdigit() or len(code) != 6:
        raise HTTPException(status_code=400, detail="Codice deve essere 6 cifre")
    totp = pyotp.TOTP(secret)
    if not totp.verify(code, valid_window=1):
        raise HTTPException(status_code=400, detail="Codice non valido, riprova")

    # Generate backup codes
    backup_codes = generate_backup_codes(10)
    backup_hashed = [{"hash": hash_backup_code(c), "used_at": None} for c in backup_codes]

    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {
            "two_factor_enabled": True,
            "totp_secret": secret,
            "totp_last_code": code,
            "totp_enabled_at": utcnow(),
            "backup_codes": backup_hashed,
        }, "$unset": {"totp_secret_pending": ""}},
    )
    return {"ok": True, "backup_codes": backup_codes}


@api_router.post("/auth/2fa/disable")
async def twofa_disable(body: TwoFADisableInput, user=Depends(get_current_user)):
    fresh = await db.users.find_one({"user_id": user["user_id"]})
    if not fresh.get("two_factor_enabled"):
        return {"ok": True}

    verified = False
    if body.password and fresh.get("password_hash") and verify_password(body.password, fresh["password_hash"]):
        verified = True
    elif body.code:
        code = body.code.strip()
        # Try TOTP
        if code.isdigit() and len(code) == 6:
            totp = pyotp.TOTP(fresh["totp_secret"])
            if totp.verify(code, valid_window=1):
                verified = True
        # Try backup code
        if not verified:
            for item in fresh.get("backup_codes") or []:
                if item.get("used_at") is None and verify_backup_code(code, item["hash"]):
                    verified = True
                    break

    if not verified:
        raise HTTPException(status_code=401, detail="Password o codice non validi")

    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"two_factor_enabled": False}, "$unset": {"totp_secret": "", "totp_secret_pending": "", "backup_codes": "", "totp_last_code": ""}},
    )
    return {"ok": True}


@api_router.post("/auth/2fa/regenerate-backup-codes")
async def twofa_regen_backup(body: TwoFAConfirmInput, user=Depends(get_current_user)):
    fresh = await db.users.find_one({"user_id": user["user_id"]})
    if not fresh.get("two_factor_enabled"):
        raise HTTPException(status_code=400, detail="2FA non attivo")
    code = (body.code or "").strip()
    if not (code.isdigit() and len(code) == 6):
        raise HTTPException(status_code=400, detail="Serve codice TOTP a 6 cifre")
    totp = pyotp.TOTP(fresh["totp_secret"])
    if not totp.verify(code, valid_window=1):
        raise HTTPException(status_code=401, detail="Codice TOTP non valido")

    backup_codes = generate_backup_codes(10)
    backup_hashed = [{"hash": hash_backup_code(c), "used_at": None} for c in backup_codes]
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"backup_codes": backup_hashed}},
    )
    return {"backup_codes": backup_codes}


@api_router.get("/auth/2fa/status")
async def twofa_status(user=Depends(get_current_user)):
    fresh = await db.users.find_one({"user_id": user["user_id"]})
    codes = fresh.get("backup_codes") or []
    unused = sum(1 for c in codes if c.get("used_at") is None)
    return {
        "enabled": bool(fresh.get("two_factor_enabled")),
        "backup_codes_remaining": unused,
        "enabled_at": fresh.get("totp_enabled_at").isoformat() if fresh.get("totp_enabled_at") else None,
    }


@api_router.post("/auth/google-session")
async def google_session(body: GoogleSessionInput):
    """Exchange Emergent session_id -> session_token, upsert user, store session."""
    async with httpx.AsyncClient(timeout=15) as hx:
        r = await hx.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": body.session_id},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Google auth fallita")
    data = r.json()
    email = data["email"].lower()
    name = data.get("name") or email.split("@")[0]
    picture = data.get("picture")
    session_token = data["session_token"]

    existing = await db.users.find_one({"email": email})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one({"user_id": user_id}, {"$set": {"name": name, "picture": picture}})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "password_hash": None,
            "role": "owner",
            "areas": ["energy", "network"],
            "created_at": utcnow(),
        })
        await db.settings.insert_one({
            "user_id": user_id,
            **SettingsModel().model_dump(),
        })

    # Store session
    await db.user_sessions.update_one(
        {"session_token": session_token},
        {"$set": {
            "session_token": session_token,
            "user_id": user_id,
            "expires_at": utcnow() + timedelta(days=7),
            "created_at": utcnow(),
        }},
        upsert=True,
    )
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    return {"token": session_token, "user": UserOut(**user).model_dump()}


@api_router.get("/auth/me")
async def auth_me(user=Depends(get_current_user)):
    return {"user": UserOut(**user).model_dump()}


@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


@api_router.put("/auth/profile")
async def update_profile(body: ProfileUpdate, user=Depends(get_current_user)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if not upd:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": upd})
    u = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0})
    return {"user": UserOut(**u).model_dump()}


# =========================
# Settings
# =========================
@api_router.get("/settings")
async def get_settings(user=Depends(get_current_user)):
    tid = tenant_id(user)
    s = await db.settings.find_one({"user_id": tid}, {"_id": 0})
    if not s:
        s = {"user_id": tid, **SettingsModel().model_dump()}
        await db.settings.insert_one(dict(s))
    # Seed default outcomes for tenants that don't have them yet
    if not s.get("appointment_outcomes"):
        s["appointment_outcomes"] = DEFAULT_APPT_OUTCOMES
        await db.settings.update_one({"user_id": tid}, {"$set": {"appointment_outcomes": DEFAULT_APPT_OUTCOMES}})
    if not s.get("call_outcomes"):
        s["call_outcomes"] = DEFAULT_CALL_OUTCOMES
        await db.settings.update_one({"user_id": tid}, {"$set": {"call_outcomes": DEFAULT_CALL_OUTCOMES}})
    else:
        # V26.k migration: ensure "Presa Appuntamento" (call_appointment) is FIRST and renamed
        existing = s["call_outcomes"]
        needs_migration = False
        if not existing or existing[0].get("id") != "call_appointment":
            needs_migration = True
        else:
            # Also migrate if name is still old
            if existing[0].get("name") == "Appuntamento preso":
                needs_migration = True
        if needs_migration:
            # Keep any custom outcomes user added, but ensure call_appointment is first with new name
            keep = [o for o in existing if o.get("id") != "call_appointment"]
            new_head = {"id": "call_appointment", "name": "Presa Appuntamento", "color": "#16A34A", "icon": "calendar"}
            s["call_outcomes"] = [new_head] + keep
            await db.settings.update_one({"user_id": tid}, {"$set": {"call_outcomes": s["call_outcomes"]}})
    if "callback_notify_default_advance_min" not in s:
        s["callback_notify_default_advance_min"] = 10
    if "disable_callback_notifications" not in s:
        s["disable_callback_notifications"] = False
    if not s.get("contact_source_options"):
        s["contact_source_options"] = DEFAULT_SOURCE_OPTIONS
        await db.settings.update_one({"user_id": tid}, {"$set": {"contact_source_options": DEFAULT_SOURCE_OPTIONS}})
    # V27 — Referral / Call script default seeds
    if "wa_referral_template" not in s:
        s["wa_referral_template"] = (
            "Ciao {name}! Volevo consigliarti il mio consulente energia che mi ha "
            "fatto risparmiare in bolletta. È preparato, trasparente e disponibile. "
            "Ti lascio il suo contatto se ti va di sentirlo. 🙂"
        )
        await db.settings.update_one({"user_id": tid}, {"$set": {"wa_referral_template": s["wa_referral_template"]}})
    if "call_script" not in s:
        s["call_script"] = (
            "APERTURA\n"
            "Buongiorno {name}, sono {agent} — la disturbo un attimo?\n\n"
            "SCOPO\n"
            "La chiamo perché aiuto famiglie e aziende a risparmiare in bolletta con un check gratuito.\n\n"
            "AGGANCIO\n"
            "Le posso fare una foto della sua bolletta e in 24h le mostro esattamente quanto può risparmiare — senza impegno.\n\n"
            "CHIUSURA\n"
            "Le va bene se ci vediamo giovedì alle 18:00 o preferisce venerdì mattina?"
        )
        await db.settings.update_one({"user_id": tid}, {"$set": {"call_script": s["call_script"]}})
    return s


@api_router.put("/settings")
async def update_settings(body: SettingsModel, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo l'owner può modificare le impostazioni")
    await db.settings.update_one(
        {"user_id": user["user_id"]},
        {"$set": body.model_dump()},
        upsert=True,
    )
    s = await db.settings.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return s


# =========================
# Team (multi-user)
# =========================
@api_router.get("/team")
async def list_team(user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo l'owner può gestire il team")
    members = await db.users.find(
        {"parent_user_id": user["user_id"]},
        {"_id": 0, "password_hash": 0},
    ).to_list(1000)
    return {"items": members}


@api_router.get("/team/members")
async def list_team_members(user=Depends(get_current_user)):
    """Return all users in the current tenant (owner + all sub-users) — usable by owner and sub-users.
    Excludes the current caller.
    """
    tid = tenant_id(user)
    members = await db.users.find(
        {"$or": [{"user_id": tid}, {"parent_user_id": tid}]},
        {"_id": 0, "password_hash": 0},
    ).to_list(1000)
    members = [m for m in members if m.get("user_id") != user["user_id"]]
    return {"items": members}


async def _is_ancestor_of(caller_user_id: str, target_user_id: str) -> bool:
    """Return True if caller is (transitively) parent of target."""
    if caller_user_id == target_user_id:
        return False
    cur = await db.users.find_one({"user_id": target_user_id}, {"parent_user_id": 1, "_id": 0})
    while cur and cur.get("parent_user_id"):
        if cur["parent_user_id"] == caller_user_id:
            return True
        cur = await db.users.find_one({"user_id": cur["parent_user_id"]}, {"parent_user_id": 1, "_id": 0})
    return False


@api_router.post("/team")
async def invite_member(body: TeamInviteInput, user=Depends(get_current_user)):
    if not is_admin_or_owner(user):
        raise HTTPException(status_code=403, detail="Solo owner o admin possono invitare utenti")
    if not body.areas:
        raise HTTPException(status_code=400, detail="Assegna almeno un'area")
    existing = await db.users.find_one({"email": body.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email già registrata")
    uid = f"user_{uuid.uuid4().hex[:12]}"
    doc = {
        "user_id": uid,
        "email": body.email.lower(),
        "name": body.name,
        "password_hash": hash_password(body.password),
        "role": "member",
        "areas": body.areas,
        # Parent = the caller (nested hierarchy). Members created by admins become their children.
        "parent_user_id": user["user_id"],
        "picture": None,
        "created_at": utcnow(),
    }
    await db.users.insert_one(doc)
    strip_id(doc)
    doc.pop("password_hash", None)
    return doc


@api_router.put("/team/{member_id}")
async def update_member(member_id: str, body: TeamUpdateInput, user=Depends(get_current_user)):
    # Owner can update anyone in tenant; admins can update their own descendants
    if is_owner(user):
        can = True
    else:
        can = await _is_ancestor_of(user["user_id"], member_id)
    if not can:
        raise HTTPException(status_code=403, detail="Non autorizzato")
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if not upd:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
    r = await db.users.update_one({"user_id": member_id}, {"$set": upd})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Membro non trovato")
    m = await db.users.find_one({"user_id": member_id}, {"_id": 0, "password_hash": 0})
    return m


@api_router.delete("/team/{member_id}")
async def delete_member(member_id: str, user=Depends(get_current_user)):
    if is_owner(user):
        can = True
    else:
        can = await _is_ancestor_of(user["user_id"], member_id)
    if not can:
        raise HTTPException(status_code=403, detail="Non autorizzato")
    r = await db.users.delete_one({"user_id": member_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Membro non trovato")
    await db.user_sessions.delete_many({"user_id": member_id})
    return {"ok": True}


class RoleInput(BaseModel):
    role: Literal["admin", "member", "owner"]


@api_router.put("/team/{member_id}/role")
async def set_member_role(member_id: str, body: RoleInput, user=Depends(get_current_user)):
    """Promote/demote a member to owner (Master figlio), admin (Manager) or member (Basic).
    Only owner OR an ancestor admin can change roles of a descendant.
    """
    if is_owner(user):
        can = True
    else:
        can = await _is_ancestor_of(user["user_id"], member_id)
    if not can:
        raise HTTPException(status_code=403, detail="Non autorizzato")
    target = await db.users.find_one({"user_id": member_id})
    if not target:
        raise HTTPException(status_code=404, detail="Membro non trovato")
    # Cannot change your own role or the top-level tenant owner's role
    if target.get("user_id") == user["user_id"]:
        raise HTTPException(status_code=400, detail="Non puoi modificare il tuo ruolo")
    if target.get("role") == "owner" and not target.get("parent_user_id"):
        raise HTTPException(status_code=400, detail="Impossibile modificare il ruolo del proprietario principale")
    await db.users.update_one({"user_id": member_id}, {"$set": {"role": body.role}})
    return {"user_id": member_id, "role": body.role}


@api_router.get("/team/hierarchy")
async def team_hierarchy(user=Depends(get_current_user)):
    """Return the team as a tree rooted at the tenant owner."""
    tid = tenant_id(user)
    users = await db.users.find(
        {"$or": [{"user_id": tid}, {"parent_user_id": {"$exists": True, "$ne": None}}]},
        {"_id": 0, "password_hash": 0, "totp_secret": 0, "backup_codes": 0},
    ).to_list(2000)
    # Filter to tenant only
    tenant_users = []
    for u in users:
        if u.get("user_id") == tid:
            tenant_users.append(u)
        else:
            # Walk up to check tenant membership
            cur = u
            while cur.get("parent_user_id"):
                if cur["parent_user_id"] == tid:
                    tenant_users.append(u)
                    break
                cur = await db.users.find_one({"user_id": cur["parent_user_id"]}, {"parent_user_id": 1, "user_id": 1, "_id": 0})
                if not cur: break
    # Build tree
    by_id: Dict[str, Dict[str, Any]] = {u["user_id"]: {**u, "children": []} for u in tenant_users}
    root = None
    for uid, node in by_id.items():
        pid = node.get("parent_user_id")
        if pid and pid in by_id:
            by_id[pid]["children"].append(node)
        elif uid == tid:
            root = node
    return {"root": root, "flat": tenant_users}




# =========================
# Contacts
# =========================
async def contact_visibility_filter(user: dict) -> Dict[str, Any]:
    """V24: role-based contact visibility filter to be $and-merged with tenant scope.
    - Owner or non-nested admin (top-level tenant admin): see all → return {}.
    - Group manager (admin with parent): see contacts assigned to self OR descendants OR unassigned.
    - Standard member: see only contacts assigned to self.
    """
    if is_owner(user):
        return {}
    role = user.get("role") or "member"
    uid = user["user_id"]
    if role == "admin":
        # Group manager scope: self + descendants + unassigned (orphans)
        descendants = await descendant_user_ids(uid)
        pool = [uid] + descendants
        return {"$or": [
            {"assigned_to_user_id": {"$in": pool}},
            {"assigned_to_user_id": {"$exists": False}},
            {"assigned_to_user_id": None},
        ]}
    # member
    return {"assigned_to_user_id": uid}


@api_router.get("/contacts")
async def list_contacts(area: Optional[str] = None, q: Optional[str] = None, group_id: Optional[str] = None, user=Depends(get_current_user)):
    query: Dict[str, Any] = tenant_scope(user)
    and_clauses: List[Dict[str, Any]] = []
    vis = await contact_visibility_filter(user)
    if vis:
        and_clauses.append(vis)
    if area:
        and_clauses.append({"$or": [{"area": area}, {"additional_areas": area}]})
    if group_id:
        query["group_ids"] = group_id
    if q:
        and_clauses.append({"$or": [
            {"first_name": {"$regex": q, "$options": "i"}},
            {"last_name": {"$regex": q, "$options": "i"}},
            {"phone": {"$regex": q, "$options": "i"}},
            {"email": {"$regex": q, "$options": "i"}},
        ]})
    if and_clauses:
        query["$and"] = and_clauses
    items = await db.contacts.find(query, {"_id": 0, "notes": 0, "files": 0}).sort([("created_at", -1)]).to_list(1000)
    return {"items": items}


class ContactAssignIn(BaseModel):
    assignee_user_id: Optional[str] = None  # None = unassign


@api_router.put("/contacts/{contact_id}/assign")
async def assign_contact(contact_id: str, body: ContactAssignIn, user=Depends(get_current_user)):
    # Owner: can assign to any tenant member
    # Group manager (admin non-owner): only to self or descendants
    # Member: not allowed
    if user.get("role") == "member":
        raise HTTPException(status_code=403, detail="Non autorizzato")
    existing = await db.contacts.find_one(tenant_scope(user, {"contact_id": contact_id}))
    if not existing:
        raise HTTPException(status_code=404, detail="Contatto non trovato")
    assignee = body.assignee_user_id
    if assignee is not None and not is_owner(user):
        # Verify assignee is self or descendant
        allowed = [user["user_id"]] + await descendant_user_ids(user["user_id"])
        if assignee not in allowed:
            raise HTTPException(status_code=403, detail="Puoi assegnare solo ai tuoi collaboratori")
    upd: Dict[str, Any] = {"updated_at": utcnow()}
    if assignee is None:
        await db.contacts.update_one({"contact_id": contact_id}, {"$unset": {"assigned_to_user_id": ""}, "$set": upd})
    else:
        upd["assigned_to_user_id"] = assignee
        await db.contacts.update_one({"contact_id": contact_id}, {"$set": upd})
    c = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0, "notes": 0, "files": 0})
    return c


AREA_PREFIX_DEFAULT = {"energy": "EN", "network": "NW"}


def _prefix_for_area(area: str, settings: Optional[dict] = None) -> str:
    if area in AREA_PREFIX_DEFAULT:
        return AREA_PREFIX_DEFAULT[area]
    # Try custom_areas
    if settings:
        for a in settings.get("custom_areas") or []:
            if a.get("id") == area:
                p = (a.get("prefix") or a.get("name") or a.get("id") or "")[:2].upper()
                return p or "XX"
    return (area or "XX")[:2].upper()


async def _next_contact_code(user: dict, area: str) -> str:
    """Generate the next sequential code for the user's tenant + area: `<PFX>-0001`."""
    tid = tenant_id(user)
    settings = await db.settings.find_one({"user_id": tid}) or {}
    prefix = _prefix_for_area(area, settings)
    # Find current max seq for this prefix
    last = await db.contacts.find_one(
        {"user_id": tid, "contact_code": {"$regex": f"^{prefix}-\\d+$"}},
        sort=[("contact_code", -1)],
        projection={"contact_code": 1},
    )
    if last and last.get("contact_code"):
        try:
            n = int(last["contact_code"].split("-", 1)[1])
        except Exception:
            n = 0
    else:
        n = 0
    return f"{prefix}-{n + 1:04d}"


@api_router.post("/contacts")
async def create_contact(body: ContactIn, user=Depends(get_current_user)):
    check_area_allowed(user, body.area)
    cid = f"c_{uuid.uuid4().hex[:12]}"
    payload = body.model_dump()
    # Auto-assign contact_code if not provided
    if not payload.get("contact_code"):
        payload["contact_code"] = await _next_contact_code(user, body.area)
    # V24: auto-assign to creator if not explicitly assigned
    if not payload.get("assigned_to_user_id"):
        payload["assigned_to_user_id"] = user["user_id"]
    doc = {
        "contact_id": cid,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        **payload,
        "notes": [],
        "files": [],
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.contacts.insert_one(doc)
    strip_id(doc)
    return doc


@api_router.get("/contacts/{contact_id}/referrals")
async def get_contact_referrals(contact_id: str, user=Depends(get_current_user)):
    """Returns contacts referred BY this contact (reverse lookup on referred_by_contact_id)."""
    # Ensure contact belongs to tenant
    parent = await db.contacts.find_one(scope_query(user, {"contact_id": contact_id}), {"_id": 0})
    if not parent:
        raise HTTPException(status_code=404, detail="Contatto non trovato")
    referrals = await db.contacts.find(
        scope_query(user, {"referred_by_contact_id": contact_id}),
        {"_id": 0, "notes": 0, "files": 0},
    ).sort("created_at", -1).to_list(500)
    # And the "referred by" info for parent
    referred_by = None
    if parent.get("referred_by_contact_id"):
        referred_by = await db.contacts.find_one(
            scope_query(user, {"contact_id": parent["referred_by_contact_id"]}),
            {"_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1, "contact_code": 1, "area": 1},
        )
    return {"referred_by": referred_by, "referrals": referrals}


@api_router.get("/contacts/{contact_id}")
async def get_contact(contact_id: str, user=Depends(get_current_user)):
    c = await db.contacts.find_one(tenant_scope(user, {"contact_id": contact_id}), {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Contatto non trovato")
    # V24: enforce role-based visibility
    role = user.get("role") or "member"
    if not is_owner(user):
        assignee = c.get("assigned_to_user_id")
        if role == "admin":
            allowed = [user["user_id"]] + await descendant_user_ids(user["user_id"])
            if assignee and assignee not in allowed:
                raise HTTPException(status_code=404, detail="Contatto non trovato")
        else:  # member
            if assignee != user["user_id"]:
                raise HTTPException(status_code=404, detail="Contatto non trovato")
    return c


@api_router.put("/contacts/{contact_id}")
async def update_contact(contact_id: str, body: ContactUpdate, user=Depends(get_current_user)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if "area" in upd:
        check_area_allowed(user, upd["area"])
    upd["updated_at"] = utcnow()
    r = await db.contacts.update_one(scope_query(user, {"contact_id": contact_id}), {"$set": upd})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Contatto non trovato")
    c = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})
    return c


@api_router.delete("/contacts/{contact_id}")
async def delete_contact(contact_id: str, user=Depends(get_current_user)):
    await db.contacts.delete_one(scope_query(user, {"contact_id": contact_id}))
    return {"ok": True}


@api_router.post("/contacts/{contact_id}/notes")
async def add_note(contact_id: str, body: ContactNote, user=Depends(get_current_user)):
    c = await db.contacts.find_one(scope_query(user, {"contact_id": contact_id}), {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Contatto non trovato")
    note = body.model_dump()
    await db.contacts.update_one({"contact_id": contact_id}, {"$push": {"notes": note}})
    return note


@api_router.delete("/contacts/{contact_id}/notes/{note_id}")
async def delete_note(contact_id: str, note_id: str, user=Depends(get_current_user)):
    await db.contacts.update_one(
        scope_query(user, {"contact_id": contact_id}),
        {"$pull": {"notes": {"id": note_id}}},
    )
    return {"ok": True}


@api_router.post("/contacts/{contact_id}/files")
async def add_file(contact_id: str, body: ContactFile, user=Depends(get_current_user)):
    c = await db.contacts.find_one(scope_query(user, {"contact_id": contact_id}), {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Contatto non trovato")
    f = body.model_dump()
    await db.contacts.update_one({"contact_id": contact_id}, {"$push": {"files": f}})
    f_light = {k: v for k, v in f.items() if k != "data_base64"}
    return f_light


@api_router.delete("/contacts/{contact_id}/files/{file_id}")
async def delete_file(contact_id: str, file_id: str, user=Depends(get_current_user)):
    await db.contacts.update_one(
        scope_query(user, {"contact_id": contact_id}),
        {"$pull": {"files": {"id": file_id}}},
    )
    return {"ok": True}


# ---- V38F: Shareable public link for contact files ----
class RenameFileIn(BaseModel):
    name: str

@api_router.patch("/contacts/{contact_id}/files/{file_id}")
async def rename_file(contact_id: str, file_id: str, body: RenameFileIn, user=Depends(get_current_user)):
    new_name = (body.name or "").strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="Nome file non valido")
    r = await db.contacts.update_one(
        scope_query(user, {"contact_id": contact_id, "files.id": file_id}),
        {"$set": {"files.$.name": new_name}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="File non trovato")
    return {"ok": True, "name": new_name}


@api_router.post("/contacts/{contact_id}/files/{file_id}/share-link")
async def create_file_share_link(contact_id: str, file_id: str, request: Request, user=Depends(get_current_user)):
    """Create a signed URL to publicly serve the file for a limited time (24h).
    Any auth-related caller (owner/admin/member) with visibility to the contact can create the token."""
    c = await db.contacts.find_one(
        scope_query(user, {"contact_id": contact_id, "files.id": file_id}),
        {"contact_id": 1, "files.$": 1},
    )
    if not c or not c.get("files"):
        raise HTTPException(status_code=404, detail="File non trovato")
    f = c["files"][0]
    exp_dt = utcnow() + timedelta(hours=24)
    token = jwt.encode({
        "kind": "cfile",
        "contact_id": contact_id,
        "file_id": file_id,
        "user_id": user["user_id"],
        "exp": int(exp_dt.timestamp()),
    }, JWT_SECRET, algorithm=JWT_ALG)
    # Build the absolute URL using forwarded proxy headers when available
    # (behind Kubernetes ingress request.base_url points at the internal cluster host).
    fwd_proto = request.headers.get("x-forwarded-proto")
    fwd_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    if fwd_proto and fwd_host:
        base = f"{fwd_proto}://{fwd_host}"
    else:
        base = str(request.base_url).rstrip("/")
    base = base.rstrip("/")
    url = f"{base}/api/public/files/{token}"
    return {"url": url, "expires_at": exp_dt.isoformat(), "name": f.get("name"), "mime": f.get("mime")}


@api_router.get("/public/files/{token}")
async def public_file(token: str):
    """Public download endpoint for signed contact-file tokens. No auth required."""
    from fastapi.responses import Response as FastAPIResponse
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=410, detail="Link scaduto")
    except Exception:
        raise HTTPException(status_code=400, detail="Link non valido")
    if payload.get("kind") != "cfile":
        raise HTTPException(status_code=400, detail="Token non compatibile")
    contact_id = payload.get("contact_id")
    file_id = payload.get("file_id")
    c = await db.contacts.find_one(
        {"contact_id": contact_id, "files.id": file_id},
        {"files.$": 1},
    )
    if not c or not c.get("files"):
        raise HTTPException(status_code=404, detail="File non trovato")
    f = c["files"][0]
    import base64 as _b64
    try:
        data = _b64.b64decode(f.get("data_base64") or "")
    except Exception:
        raise HTTPException(status_code=500, detail="File corrotto")
    mime = f.get("mime") or "application/octet-stream"
    name = f.get("name") or "download"
    return FastAPIResponse(
        content=data,
        media_type=mime,
        headers={"Content-Disposition": f'inline; filename="{name}"'},
    )


@api_router.post("/master-files/{file_id}/share-link")
async def create_master_file_share_link(file_id: str, request: Request, user=Depends(get_current_user)):
    """V38R — Create a signed URL for a master file (any category).
    Used by ShareSheet 'Copia link' channel."""
    f = await db.master_files.find_one({"user_id": tenant_id(user), "file_id": file_id})
    if not f:
        raise HTTPException(status_code=404, detail="File non trovato")
    exp_dt = utcnow() + timedelta(hours=24)
    token = jwt.encode({
        "kind": "mfile",
        "file_id": file_id,
        "user_id": tenant_id(user),
        "exp": int(exp_dt.timestamp()),
    }, JWT_SECRET, algorithm=JWT_ALG)
    fwd_proto = request.headers.get("x-forwarded-proto")
    fwd_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    if fwd_proto and fwd_host:
        base = f"{fwd_proto}://{fwd_host}"
    else:
        base = str(request.base_url).rstrip("/")
    base = base.rstrip("/")
    url = f"{base}/api/public/master-files/{token}"
    return {"url": url, "expires_at": exp_dt.isoformat(), "name": f.get("name"), "mime": f.get("mime")}


@api_router.get("/public/master-files/{token}")
async def public_master_file(token: str):
    """V38R — Public download endpoint for signed master-file tokens."""
    from fastapi.responses import Response as FastAPIResponse
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=410, detail="Link scaduto")
    except Exception:
        raise HTTPException(status_code=400, detail="Link non valido")
    if payload.get("kind") != "mfile":
        raise HTTPException(status_code=400, detail="Token non compatibile")
    file_id = payload.get("file_id")
    user_id = payload.get("user_id")
    f = await db.master_files.find_one({"user_id": user_id, "file_id": file_id})
    if not f:
        raise HTTPException(status_code=404, detail="File non trovato")
    import base64 as _b64
    try:
        data = _b64.b64decode(f.get("data_base64") or "")
    except Exception:
        raise HTTPException(status_code=500, detail="File corrotto")
    mime = f.get("mime") or "application/octet-stream"
    name = f.get("name") or "download"
    return FastAPIResponse(
        content=data,
        media_type=mime,
        headers={"Content-Disposition": f'inline; filename="{name}"'},
    )



# V38I — Email a contact file as attachment via SMTP
class EmailAttachmentIn(BaseModel):
    to_email: EmailStr
    subject: Optional[str] = None
    message: Optional[str] = None
    sender_email: Optional[str] = None  # override sender (if user has additional_emails)


@api_router.post("/contacts/{contact_id}/files/{file_id}/email-attachment")
async def email_file_attachment(contact_id: str, file_id: str, body: EmailAttachmentIn, user=Depends(get_current_user)):
    """Send the contact file to `to_email` as a real SMTP attachment.
    Uses the caller's SMTP config (must be configured in Settings)."""
    c = await db.contacts.find_one(
        scope_query(user, {"contact_id": contact_id, "files.id": file_id}),
        {"first_name": 1, "last_name": 1, "files.$": 1},
    )
    if not c or not c.get("files"):
        raise HTTPException(status_code=404, detail="File non trovato")
    f = c["files"][0]
    cfg = await db.smtp_configs.find_one({"user_id": tenant_id(user)}, {"_id": 0})
    if not cfg or not cfg.get("host"):
        raise HTTPException(status_code=400, detail="SMTP non configurato. Vai in Impostazioni → SMTP.")
    # If a sender override is supplied and it belongs to the user's allowed emails, honor it
    if body.sender_email:
        u = await db.users.find_one({"user_id": tenant_id(user)}, {"email": 1, "additional_emails": 1})
        allowed = {(u or {}).get("email")} | set((u or {}).get("additional_emails") or [])
        if body.sender_email in allowed:
            cfg = dict(cfg)
            cfg["sender_email"] = body.sender_email
    import base64 as _b64
    try:
        attachment_bytes = _b64.b64decode(f.get("data_base64") or "")
    except Exception:
        raise HTTPException(status_code=500, detail="File corrotto")
    subject = body.subject or f"File condiviso: {f.get('name')}"
    text = body.message or f"Ti condivido in allegato il file: {f.get('name')}."
    try:
        await asyncio.to_thread(
            _send_smtp_email_with_attachment,
            cfg, body.to_email, subject, text, None,
            attachment_bytes, f.get("name") or "file", f.get("mime") or "application/octet-stream",
        )
    except Exception as e:
        logger.exception(f"email attachment failed: {e}")
        raise HTTPException(status_code=500, detail=f"Errore invio email: {str(e)[:200]}")
    return {"ok": True, "sent_to": body.to_email}


def _send_smtp_email_with_attachment(cfg: dict, to_email: str, subject: str, body_text: str, body_html: Optional[str],
                                      attachment_bytes: bytes, attachment_name: str, attachment_mime: str):
    """Blocking send via SMTP including a real binary attachment."""
    from email.mime.base import MIMEBase
    from email import encoders
    sender_email = cfg.get("sender_email") or cfg.get("username")
    sender_name = cfg.get("sender_name") or sender_email
    msg = MIMEMultipart("mixed")
    msg["Subject"] = subject
    msg["From"] = formataddr((sender_name, sender_email))
    msg["To"] = to_email
    alt = MIMEMultipart("alternative")
    alt.attach(MIMEText(body_text or "", "plain", "utf-8"))
    if body_html:
        alt.attach(MIMEText(body_html, "html", "utf-8"))
    msg.attach(alt)
    part = MIMEBase(*(attachment_mime.split("/", 1) if "/" in attachment_mime else ("application", "octet-stream")))
    part.set_payload(attachment_bytes)
    encoders.encode_base64(part)
    part.add_header("Content-Disposition", f'attachment; filename="{attachment_name}"')
    msg.attach(part)
    host = cfg["host"]
    port = int(cfg.get("port") or 465)
    use_ssl = bool(cfg.get("use_ssl", True))
    if use_ssl:
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(host, port, context=context, timeout=45) as server:
            server.login(cfg["username"], cfg["password"])
            server.sendmail(sender_email, [to_email], msg.as_string())
    else:
        with smtplib.SMTP(host, port, timeout=45) as server:
            server.ehlo()
            try:
                server.starttls(context=ssl.create_default_context())
                server.ehlo()
            except Exception:
                pass
            server.login(cfg["username"], cfg["password"])
            server.sendmail(sender_email, [to_email], msg.as_string())


# =========================
# Appointments
# =========================
@api_router.get("/appointments")
async def list_appointments(
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
    area: Optional[str] = None,
    contact_id: Optional[str] = None,
    user=Depends(get_current_user),
):
    tid = tenant_id(user)
    # Base scope: own records + broadcast events I'm a recipient of
    scope_filter: Dict[str, Any] = {"user_id": tid}
    if is_owner(user):
        # Owner sees everything in tenant
        base = {"user_id": tid}
    else:
        base = {
            "user_id": tid,
            "$or": [
                {"created_by": user["user_id"]},
                {"is_broadcast": True, "broadcast_to_user_ids": user["user_id"]},
            ],
        }
    q: Dict[str, Any] = base
    date_filter: Dict[str, Any] = {}
    if start and end:
        date_filter = {"$gte": start, "$lte": end}
    elif start:
        date_filter = {"$gte": start}
    if date_filter:
        q["start_at"] = date_filter
    if area in ("energy", "network"):
        q["area"] = area
    if contact_id:
        q["contact_id"] = contact_id
    items = await db.appointments.find(q, {"_id": 0}).sort("start_at", 1).to_list(1000)
    # Attach read_only flag for broadcast recipients (creator != me)
    for it in items:
        it["read_only"] = bool(it.get("is_broadcast") and it.get("created_by") != user["user_id"] and not is_owner(user))
    return {"items": items}
    _ = scope_filter  # placeholder to avoid unused warnings


@api_router.post("/appointments")
async def create_appointment(body: AppointmentIn, user=Depends(get_current_user)):
    check_area_allowed(user, body.area)
    aid = f"a_{uuid.uuid4().hex[:12]}"
    payload = body.model_dump()
    # Broadcast: only owners or admins can broadcast
    if payload.get("is_broadcast"):
        if not is_admin_or_owner(user):
            raise HTTPException(status_code=403, detail="Solo owner o admin possono creare eventi broadcast")
        scope = payload.get("broadcast_scope") or "all"
        # "all" is restricted to owner
        if scope == "all" and not is_owner(user):
            raise HTTPException(status_code=403, detail="Solo l'owner può inviare a tutta l'azienda")
        payload["broadcast_to_user_ids"] = await resolve_broadcast_recipients(user, scope, payload.get("broadcast_to_user_ids"))
    doc = {
        "appointment_id": aid,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        **payload,
        "done": False,
        "outcome_tags": [],
        "outcome_notes": "",
        "products_sold": 0,
        "contract_signed": False,
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.appointments.insert_one(doc)
    strip_id(doc)
    return doc


# v2.19 — Statistiche appuntamenti per collaboratore
@api_router.get("/appointments/stats")
async def appointments_stats(
    range_days: int = 30,
    user=Depends(get_current_user),
):
    """Return counts done/undone per user (self + team) over the last N days.
    Owner/admin see all tenant members; members see only their own row."""
    tid = tenant_id(user)
    since = utcnow() - timedelta(days=max(1, min(range_days, 365)))
    # Fetch team members within tenant
    members = await db.users.find(
        {"$or": [{"user_id": tid}, {"parent_user_id": tid}]},
        {"_id": 0, "user_id": 1, "name": 1, "email": 1, "role": 1}
    ).to_list(200)
    is_master = user.get("role") in ("owner", "admin")
    if not is_master:
        members = [m for m in members if m["user_id"] == user["user_id"]]
    # Aggregate counts per created_by
    pipeline = [
        {"$match": {"user_id": tid, "start_at": {"$gte": since}, "is_broadcast": {"$ne": True}}},
        {"$group": {
            "_id": "$created_by",
            "total": {"$sum": 1},
            "done": {"$sum": {"$cond": [{"$eq": ["$done", True]}, 1, 0]}},
        }},
    ]
    agg = {}
    async for row in db.appointments.aggregate(pipeline):
        agg[row["_id"]] = {"total": row["total"], "done": row["done"]}
    per_user = []
    for m in members:
        st = agg.get(m["user_id"], {"total": 0, "done": 0})
        per_user.append({
            "user_id": m["user_id"],
            "name": m.get("name") or m.get("email") or "—",
            "role": m.get("role"),
            "total": st["total"],
            "done": st["done"],
            "undone": st["total"] - st["done"],
        })
    # Sort by total desc for a leaderboard feel
    per_user.sort(key=lambda x: (-x["total"], x["name"]))
    my_row = next((r for r in per_user if r["user_id"] == user["user_id"]), {"total": 0, "done": 0, "undone": 0})
    group_total = sum(r["total"] for r in per_user)
    group_done = sum(r["done"] for r in per_user)
    return {
        "range_days": max(1, min(range_days, 365)),
        "mine": {"total": my_row["total"], "done": my_row["done"], "undone": my_row["undone"]},
        "group": {"total": group_total, "done": group_done, "undone": group_total - group_done},
        "per_user": per_user,
    }


@api_router.get("/appointments/{appointment_id}")
async def get_appointment(appointment_id: str, user=Depends(get_current_user)):
    # Fetch within tenant (allow broadcast visibility)
    a = await db.appointments.find_one({
        "user_id": tenant_id(user),
        "appointment_id": appointment_id,
    }, {"_id": 0})
    if not a:
        raise HTTPException(status_code=404, detail="Appuntamento non trovato")
    # Non-owner: must be creator or broadcast recipient
    if not is_owner(user):
        allowed = a.get("created_by") == user["user_id"] or (
            a.get("is_broadcast") and user["user_id"] in (a.get("broadcast_to_user_ids") or [])
        )
        if not allowed:
            raise HTTPException(status_code=404, detail="Appuntamento non trovato")
    a["read_only"] = bool(a.get("is_broadcast") and a.get("created_by") != user["user_id"] and not is_owner(user))
    return a


@api_router.put("/appointments/{appointment_id}")
async def update_appointment(appointment_id: str, body: AppointmentUpdate, user=Depends(get_current_user)):
    # Only creator (or owner) can update
    existing = await db.appointments.find_one({
        "user_id": tenant_id(user),
        "appointment_id": appointment_id,
    })
    if not existing:
        raise HTTPException(status_code=404, detail="Appuntamento non trovato")
    if not is_owner(user) and existing.get("created_by") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Non puoi modificare un evento broadcast: sola lettura")
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if "area" in upd:
        check_area_allowed(user, upd["area"])
    upd["updated_at"] = utcnow()
    await db.appointments.update_one({"appointment_id": appointment_id}, {"$set": upd})
    a = await db.appointments.find_one({"appointment_id": appointment_id}, {"_id": 0})
    return a


@api_router.delete("/appointments/{appointment_id}")
async def delete_appointment(appointment_id: str, user=Depends(get_current_user)):
    existing = await db.appointments.find_one({
        "user_id": tenant_id(user),
        "appointment_id": appointment_id,
    })
    if not existing:
        return {"ok": True}
    if not is_owner(user) and existing.get("created_by") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Non puoi eliminare un evento broadcast di cui non sei creatore")
    await db.appointments.delete_one({"appointment_id": appointment_id})
    return {"ok": True}


# =========================
# Team Calendar (V38T)
# =========================
# Palette used to assign deterministic colors to each collaborator on the team
# calendar. Colors are picked by hashing the user_id into the palette.
_TEAM_MEMBER_COLORS: List[str] = [
    "#2563EB",  # blue
    "#DC2626",  # red
    "#16A34A",  # green
    "#D97706",  # amber
    "#7C3AED",  # violet
    "#DB2777",  # pink
    "#0891B2",  # cyan
    "#EA580C",  # orange
    "#65A30D",  # lime
    "#0369A1",  # sky
    "#7E22CE",  # purple
    "#B45309",  # brown
]


def _color_for_user(user_id: str) -> str:
    if not user_id:
        return "#6B7280"
    # Deterministic hash → palette index
    h = 0
    for ch in user_id:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return _TEAM_MEMBER_COLORS[h % len(_TEAM_MEMBER_COLORS)]


async def _tenant_member_ids(user: dict) -> List[str]:
    """Return the list of user_ids belonging to the same tenant as `user`.
    Includes the tenant owner and all sub-users under the owner.
    """
    tid = tenant_id(user)
    # Owner + direct children under the tenant
    tenant_users = await db.users.find(
        {"$or": [{"user_id": tid}, {"parent_user_id": tid}]},
        {"user_id": 1, "_id": 0},
    ).to_list(2000)
    ids = {u["user_id"] for u in tenant_users}
    # Also traverse deeper descendants (nested hierarchy)
    for uid in await descendant_user_ids(tid):
        ids.add(uid)
    return list(ids)


@api_router.get("/calendar/team-members")
async def calendar_team_members(user=Depends(get_current_user)):
    """Return all team members (same tenant) with an assigned display color.
    Includes the current user. Used by the team calendar for filtering and
    color-coding events.
    """
    tid = tenant_id(user)
    members = await db.users.find(
        {"$or": [{"user_id": tid}, {"parent_user_id": tid}]},
        {"_id": 0, "user_id": 1, "name": 1, "email": 1, "role": 1, "picture": 1, "parent_user_id": 1},
    ).to_list(2000)
    # Also include deeper descendants (nested) that weren't caught by parent_user_id == tid
    known = {m.get("user_id") for m in members}
    for uid in await descendant_user_ids(tid):
        if uid not in known:
            m = await db.users.find_one(
                {"user_id": uid},
                {"_id": 0, "user_id": 1, "name": 1, "email": 1, "role": 1, "picture": 1, "parent_user_id": 1},
            )
            if m:
                members.append(m)
                known.add(uid)
    out = []
    for m in members:
        out.append({
            "user_id": m.get("user_id"),
            "name": m.get("name") or m.get("email") or "Collaboratore",
            "email": m.get("email"),
            "role": m.get("role") or "member",
            "picture": m.get("picture"),
            "color": _color_for_user(m.get("user_id") or ""),
            "is_me": m.get("user_id") == user["user_id"],
            "is_owner": (m.get("user_id") == tid),
        })
    # Sort: me first, then owner, then by name
    out.sort(key=lambda x: (0 if x["is_me"] else (1 if x["is_owner"] else 2), (x["name"] or "").lower()))
    return {"items": out}


@api_router.get("/calendar/team")
async def calendar_team(
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
    area: Optional[str] = None,
    user_ids: Optional[str] = None,  # comma-separated
    user=Depends(get_current_user),
):
    """Return appointments across the whole tenant for the Team Calendar view.
    Enriches each event with `created_by_name`, `created_by_color`, and `is_mine`.
    Non-owned appointments have contact_id / location / notes / phone fields
    redacted for privacy (per user choice: only title + orario + collaboratore).
    """
    tid = tenant_id(user)
    # Base tenant filter (everyone under this tenant)
    q: Dict[str, Any] = {"user_id": tid}

    # Date window
    if start and end:
        q["start_at"] = {"$gte": start, "$lte": end}
    elif start:
        q["start_at"] = {"$gte": start}

    if area in ("energy", "network"):
        q["area"] = area

    # Optional filter by user_ids (comma-separated). Keep only those in the tenant.
    # Note: if the caller passes ONLY foreign user_ids, allowed_ids may be empty →
    # we still apply the filter (with an empty $in) so the response is [] instead of
    # accidentally returning the entire tenant's events. (V38T bug fix.)
    tenant_ids = set(await _tenant_member_ids(user))
    if user_ids:
        requested = {u.strip() for u in user_ids.split(",") if u.strip()}
        allowed_ids = list(requested & tenant_ids)
        q["created_by"] = {"$in": allowed_ids}

    # Fetch
    items = await db.appointments.find(q, {"_id": 0}).sort("start_at", 1).to_list(2000)

    # Build user lookup for enrichment
    creator_ids = list({it.get("created_by") for it in items if it.get("created_by")})
    users_lookup: Dict[str, Dict[str, Any]] = {}
    if creator_ids:
        async for u in db.users.find(
            {"user_id": {"$in": creator_ids}},
            {"_id": 0, "user_id": 1, "name": 1, "email": 1},
        ):
            users_lookup[u["user_id"]] = u

    my_id = user["user_id"]
    out = []
    for it in items:
        created_by = it.get("created_by") or ""
        u_info = users_lookup.get(created_by, {})
        creator_name = u_info.get("name") or u_info.get("email") or "Collaboratore"
        is_mine = (created_by == my_id)
        enriched = {
            "appointment_id": it.get("appointment_id"),
            "title": it.get("title"),
            "area": it.get("area"),
            "start_at": it.get("start_at"),
            "end_at": it.get("end_at"),
            "duration_min": it.get("duration_min"),
            "is_phone": bool(it.get("is_phone")),
            "done": bool(it.get("done")),
            "appointment_type_tags": it.get("appointment_type_tags") or [],
            "is_broadcast": bool(it.get("is_broadcast")),
            "created_by": created_by,
            "created_by_name": creator_name,
            "created_by_color": _color_for_user(created_by),
            "is_mine": is_mine,
        }
        if is_mine:
            # Full detail for my own appointments
            enriched.update({
                "location": it.get("location") or "",
                "map_address": it.get("map_address") or "",
                "full_address": it.get("full_address") or "",
                "notes": it.get("notes") or "",
                "contact_id": it.get("contact_id"),
                "phone_mobile": it.get("phone_mobile") or "",
                "phone_work": it.get("phone_work") or "",
                "outcome_tags": it.get("outcome_tags") or [],
                "products_sold": it.get("products_sold") or 0,
                "contract_signed": bool(it.get("contract_signed")),
                "value_amount": it.get("value_amount") or 0.0,
                "read_only": False,
            })
        else:
            # Redacted view for others' appointments (privacy)
            enriched.update({
                "location": "",
                "map_address": "",
                "full_address": "",
                "notes": "",
                "contact_id": None,
                "phone_mobile": "",
                "phone_work": "",
                "read_only": True,
            })
        out.append(enriched)

    return {"items": out}


# =========================
# Callbacks (Ritelefonate)
# =========================
@api_router.get("/callbacks")
async def list_callbacks(
    day: Optional[str] = None,
    area: Optional[str] = None,
    include_done: bool = False,
    user=Depends(get_current_user),
):
    q: Dict[str, Any] = scope_query(user)
    if area in ("energy", "network"):
        q["area"] = area
    if not include_done:
        q["done"] = {"$ne": True}
    if day:
        try:
            d = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            q["scheduled_at"] = {"$gte": d, "$lt": d + timedelta(days=1)}
        except Exception:
            pass
    items = await db.callbacks.find(q, {"_id": 0}).sort("scheduled_at", 1).to_list(1000)
    return {"items": items}


@api_router.post("/callbacks")
async def create_callback(body: CallbackIn, user=Depends(get_current_user)):
    check_area_allowed(user, body.area)
    cid = f"cb_{uuid.uuid4().hex[:12]}"
    doc = {
        "callback_id": cid,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        **body.model_dump(),
        "done": False,
        "created_at": utcnow(),
    }
    await db.callbacks.insert_one(doc)
    strip_id(doc)
    return doc


@api_router.get("/callbacks/{callback_id}")
async def get_callback(callback_id: str, user=Depends(get_current_user)):
    c = await db.callbacks.find_one(scope_query(user, {"callback_id": callback_id}), {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Ritelefonata non trovata")
    return c


@api_router.put("/callbacks/{callback_id}")
async def update_callback(callback_id: str, body: CallbackUpdate, user=Depends(get_current_user)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if "area" in upd:
        check_area_allowed(user, upd["area"])
    r = await db.callbacks.update_one(
        scope_query(user, {"callback_id": callback_id}),
        {"$set": upd},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ritelefonata non trovata")
    c = await db.callbacks.find_one({"callback_id": callback_id}, {"_id": 0})
    return c


@api_router.delete("/callbacks/{callback_id}")
async def delete_callback(callback_id: str, user=Depends(get_current_user)):
    await db.callbacks.delete_one(scope_query(user, {"callback_id": callback_id}))
    return {"ok": True}


# =========================
# Call logs & outcomes
# =========================
@api_router.post("/calls/log")
async def log_call(body: CallLogIn, user=Depends(get_current_user)):
    """Records a communication event (phone call, SMS, WhatsApp, email, telegram).
    Optionally creates a follow-up callback if the outcome indicates a reschedule
    (reschedule_at or reschedule_delta_min). V28.c: added `channel` field so the
    frontend can render a unified communications timeline.
    """
    log_id = f"cl_{uuid.uuid4().hex[:12]}"
    channel = (body.channel or "phone").lower()
    if channel not in {"phone", "sms", "whatsapp", "email", "telegram"}:
        channel = "phone"
    outcome_id = body.outcome_id or ("auto_started" if channel == "phone" else f"auto_{channel}")
    doc = {
        "log_id": log_id,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        "contact_id": body.contact_id,
        "callback_id": body.callback_id,
        "appointment_id": body.appointment_id,
        "phone": body.phone,
        "channel": channel,
        "outcome_id": outcome_id,
        "note": body.note,
        "duration_sec": body.duration_sec,
        "created_at": utcnow(),
    }
    await db.call_logs.insert_one(doc)
    strip_id(doc)

    # Update the source callback (mark done + outcome)
    if body.callback_id:
        await db.callbacks.update_one(
            scope_query(user, {"callback_id": body.callback_id}),
            {"$set": {
                "last_call_outcome_id": outcome_id,
                "last_call_at": utcnow(),
                "done": True,  # by default; a reschedule creates a new callback
            }},
        )

    # Create a follow-up callback if requested
    new_callback = None
    reschedule_time: Optional[datetime] = None
    if body.reschedule_at:
        reschedule_time = body.reschedule_at
    elif body.reschedule_delta_min is not None:
        reschedule_time = utcnow() + timedelta(minutes=int(body.reschedule_delta_min))

    if reschedule_time:
        # Fetch original callback for context
        original = None
        if body.callback_id:
            original = await db.callbacks.find_one({"callback_id": body.callback_id})

        # Also fetch contact for name/phone if provided
        contact = None
        cid = body.contact_id or (original.get("contact_id") if original else None)
        if cid:
            contact = await db.contacts.find_one({"contact_id": cid})

        cb_id = f"cb_{uuid.uuid4().hex[:12]}"
        settings = await db.settings.find_one({"user_id": tenant_id(user)}) or {}
        area = (original or {}).get("area") or "energy"
        phone = body.phone or (original or {}).get("phone") or (contact or {}).get("phone")
        title = (original or {}).get("title") or (contact and f"{contact.get('first_name','')} {contact.get('last_name','')}".strip()) or "Ritelefonata"
        cb_doc = {
            "callback_id": cb_id,
            "user_id": tenant_id(user),
            "created_by": user["user_id"],
            "contact_id": cid,
            "title": title,
            "area": area,
            "scheduled_at": reschedule_time,
            "note": body.note or "",
            "phone": phone,
            "notify": True,
            "notify_advance_min": (original or {}).get("notify_advance_min") or settings.get("callback_notify_default_advance_min", 10),
            "done": False,
            "created_at": utcnow(),
            "parent_call_log_id": log_id,
        }
        await db.callbacks.insert_one(cb_doc)
        strip_id(cb_doc)
        new_callback = cb_doc

    return {"log": doc, "new_callback": new_callback}


@api_router.get("/calls/log")
async def list_call_logs(contact_id: Optional[str] = None, limit: int = 50, user=Depends(get_current_user)):
    q = scope_query(user)
    if contact_id:
        q["contact_id"] = contact_id
    items = await db.call_logs.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return {"items": items}


# =========================
# Reports
# =========================
def _period_range(period: str) -> tuple:
    now = utcnow()
    if period == "day":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=1)
    elif period == "week":
        start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=7)
    elif period == "month":
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        # naive next month
        if start.month == 12:
            end = start.replace(year=start.year + 1, month=1)
        else:
            end = start.replace(month=start.month + 1)
    elif period == "year":
        start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
        end = start.replace(year=start.year + 1)
    else:
        start = now - timedelta(days=1)
        end = now + timedelta(days=1)
    return start, end


@api_router.get("/reports")
async def reports(period: str = "day", user=Depends(get_current_user)):
    start, end = _period_range(period)
    result = {}
    base = scope_query(user)
    for area in ("energy", "network"):
        appointments_done = await db.appointments.count_documents({
            **base, "area": area,
            "done": True, "start_at": {"$gte": start, "$lt": end},
        })
        appointments_total = await db.appointments.count_documents({
            **base, "area": area,
            "start_at": {"$gte": start, "$lt": end},
        })
        phone_done = await db.appointments.count_documents({
            **base, "area": area,
            "done": True, "is_phone": True, "start_at": {"$gte": start, "$lt": end},
        })
        contracts = await db.appointments.count_documents({
            **base, "area": area,
            "contract_signed": True, "start_at": {"$gte": start, "$lt": end},
        })
        pipe = [
            {"$match": {**base, "area": area, "start_at": {"$gte": start, "$lt": end}}},
            {"$group": {"_id": None, "s": {"$sum": {"$ifNull": ["$products_sold", 0]}}}},
        ]
        agg = await db.appointments.aggregate(pipe).to_list(1)
        products = int(agg[0]["s"]) if agg else 0
        result[area] = {
            "appointments_done": appointments_done,
            "appointments_total": appointments_total,
            "phone_done": phone_done,
            "contracts": contracts,
            "products": products,
        }

    # Outcome breakdown (across both areas)
    outcome_pipe = [
        {"$match": {**base, "done": True, "start_at": {"$gte": start, "$lt": end}, "outcome_ids": {"$exists": True, "$not": {"$size": 0}}}},
        {"$unwind": "$outcome_ids"},
        {"$group": {"_id": "$outcome_ids", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    outcome_agg = await db.appointments.aggregate(outcome_pipe).to_list(100)
    outcomes = [{"outcome_id": o["_id"], "count": o["count"]} for o in outcome_agg]

    return {"period": period, "start": start.isoformat(), "end": end.isoformat(), "stats": result, "outcomes": outcomes}


# =========================
# Invites & Trial subscription
# =========================
class InviteIn(BaseModel):
    trial_days: int = 30
    note: str = ""
    role: Optional[str] = None  # "basic" | "manager" | "master_figlio" (mapped to member/admin/owner)
    collaborator_name: Optional[str] = None  # display name of the invited collaborator
    assign_parent_user_id: Optional[str] = None  # V27 — assign new collaborator under an existing team member (must be tenant member)
    # V27 — Contact linkage: invite an existing contact from the rubrica.
    # If contact_id is provided, the invite is bound to that contact and status is updated on registration.
    # If contact_id is None but contact_quick fields are provided, a new contact is created on the fly.
    contact_id: Optional[str] = None
    contact_quick_first_name: Optional[str] = None
    contact_quick_last_name: Optional[str] = None
    contact_quick_email: Optional[str] = None
    contact_quick_phone: Optional[str] = None
    contact_intent: Optional[Literal["prospect", "collaborator"]] = None  # what the invite is FOR


class InviteRegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str = Field(min_length=1, max_length=100)


class ExtendTrialIn(BaseModel):
    add_days: int = Field(ge=1, le=3650)


def _subscription_state(user: dict) -> Dict[str, Any]:
    """Compute the subscription state (owner + trial + expiry) for a user."""
    if user.get("parent_user_id"):
        # sub-user inherits from parent
        return {"status": "sub_user", "expires_at": None, "days_left": None, "is_active": True}
    status_str = user.get("subscription_status") or "active"
    # Free-forever bypass trial logic
    if status_str == "free_forever":
        return {"status": "free_forever", "expires_at": None, "days_left": None, "is_active": True}
    exp = user.get("trial_expires_at")
    days_left = None
    if exp:
        if isinstance(exp, str):
            try: exp = datetime.fromisoformat(exp.replace("Z", "+00:00"))
            except Exception: exp = None
        if exp:
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            days_left = int((exp - utcnow()).total_seconds() // 86400)
            if status_str == "trial" and days_left < 0:
                status_str = "expired"
    return {
        "status": status_str,
        "expires_at": exp.isoformat() if isinstance(exp, datetime) else None,
        "days_left": days_left,
        "is_active": status_str in ("active", "trial") and (days_left is None or days_left >= 0),
    }


@api_router.get("/subscription/status")
async def get_subscription_status(user=Depends(get_current_user)):
    # Refresh from DB in case of updates
    tid = tenant_id(user)
    parent = await db.users.find_one({"user_id": tid}, {"_id": 0, "password_hash": 0}) or user
    state = _subscription_state(parent)
    return state


@api_router.post("/invites")
async def create_invite(body: InviteIn, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo l'owner può creare inviti")
    tok = uuid.uuid4().hex[:20]
    # Normalize role (Basic/Manager/Master figlio → member/admin/owner)
    role_map = {
        "basic": "member",
        "manager": "admin",
        "master_figlio": "owner",
        "member": "member",
        "admin": "admin",
        "owner": "owner",
    }
    invite_role = role_map.get((body.role or "").lower(), "member") if body.role else None
    tid = tenant_id(user)
    # V27 — Validate assign_parent_user_id: must be a member of the current tenant
    assign_parent_user_id: Optional[str] = None
    if body.assign_parent_user_id and invite_role in ("member", "admin"):
        target = await db.users.find_one(
            {"user_id": body.assign_parent_user_id, "$or": [{"user_id": tid}, {"parent_user_id": tid}]},
            {"_id": 0, "user_id": 1}
        )
        if not target:
            raise HTTPException(status_code=400, detail="Collaboratore di destinazione non valido")
        assign_parent_user_id = body.assign_parent_user_id

    # V27 — Contact linkage: bind to existing contact or create one on the fly
    contact_id_final: Optional[str] = None
    if body.contact_id:
        ct = await db.contacts.find_one({"contact_id": body.contact_id, "user_id": tid}, {"_id": 0, "contact_id": 1})
        if not ct:
            raise HTTPException(status_code=400, detail="Contatto non valido")
        contact_id_final = body.contact_id
    elif body.contact_quick_first_name or body.contact_quick_email or body.contact_quick_phone:
        fn = (body.contact_quick_first_name or "").strip()
        ln = (body.contact_quick_last_name or "").strip()
        em = (body.contact_quick_email or "").strip().lower()
        ph = (body.contact_quick_phone or "").strip()
        if not (fn or em or ph):
            raise HTTPException(status_code=400, detail="Servono almeno nome, email o telefono per creare il contatto")
        cid = f"contact_{uuid.uuid4().hex[:12]}"
        intent_status = body.contact_intent or ("collaborator" if invite_role else "prospect")
        contact_doc = {
            "contact_id": cid,
            "user_id": tid,
            "assigned_to_user_id": user["user_id"],
            "created_by": user["user_id"],
            "first_name": fn or (em.split("@")[0] if em else "—"),
            "last_name": ln,
            "email": em,
            "phone": ph,
            "area": "energy",
            "additional_areas": [],
            "source": "personal",
            "status": intent_status,
            "created_at": utcnow(),
            "updated_at": utcnow(),
        }
        await db.contacts.insert_one(contact_doc)
        contact_id_final = cid
    # Sync contact status to the invite intent immediately (visible in rubrica even before registration)
    if contact_id_final and body.contact_intent:
        await db.contacts.update_one(
            {"contact_id": contact_id_final, "user_id": tid},
            {"$set": {"status": body.contact_intent, "updated_at": utcnow()}}
        )

    doc = {
        "invite_token": tok,
        "created_by": user["user_id"],
        "trial_days": body.trial_days,
        "note": body.note,
        "invite_role": invite_role,  # role to assign upon acceptance
        "collaborator_name": (body.collaborator_name or "").strip() or None,
        "assign_parent_user_id": assign_parent_user_id,  # V27 — override parent at registration
        "contact_id": contact_id_final,  # V27 — linked contact
        "contact_intent": body.contact_intent,  # V27 — prospect|collaborator
        "created_at": utcnow(),
        "used_at": None,
        "used_by_user_id": None,
    }
    await db.invites.insert_one(doc)
    strip_id(doc)
    return doc


@api_router.get("/invites")
async def list_invites(user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Non autorizzato")
    items = await db.invites.find({"created_by": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    # Enrich with invited user info + subscription state
    for inv in items:
        if inv.get("used_by_user_id"):
            u = await db.users.find_one({"user_id": inv["used_by_user_id"]}, {"_id": 0, "password_hash": 0})
            if u:
                inv["invited_user"] = {
                    "user_id": u["user_id"],
                    "name": u.get("name"),
                    "email": u.get("email"),
                    "subscription": _subscription_state(u),
                }
    return {"items": items}


@api_router.delete("/invites/{token}")
async def delete_invite(token: str, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Non autorizzato")
    await db.invites.delete_one({"invite_token": token, "created_by": user["user_id"]})
    return {"ok": True}


@api_router.get("/invites/{token}/info")
async def invite_info(token: str):
    """Public endpoint: get invite info before registering."""
    inv = await db.invites.find_one({"invite_token": token}, {"_id": 0, "created_by": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invito non trovato")
    if inv.get("used_at"):
        raise HTTPException(status_code=410, detail="Questo invito è già stato utilizzato")
    return {"trial_days": inv["trial_days"], "note": inv.get("note", "")}


@api_router.post("/invites/{token}/register")
async def register_via_invite(token: str, body: InviteRegisterIn):
    """Public endpoint: register a new tenant using an invite token."""
    inv = await db.invites.find_one({"invite_token": token})
    if not inv:
        raise HTTPException(status_code=404, detail="Invito non trovato")
    if inv.get("used_at"):
        raise HTTPException(status_code=410, detail="Invito già utilizzato")
    # Check email uniqueness
    existing = await db.users.find_one({"email": body.email.lower().strip()})
    if existing:
        raise HTTPException(status_code=409, detail="Email già registrata")
    uid = f"user_{uuid.uuid4().hex[:12]}"
    trial_days = int(inv.get("trial_days") or 30)
    trial_expires_at = utcnow() + timedelta(days=trial_days)
    pw_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    now = utcnow()
    # Support role-based invites (Basic/Manager/Master figlio)
    invite_role = inv.get("invite_role")  # "member" | "admin" | "owner" | None
    creator_id = inv.get("created_by")
    # V27 — Optional override: assign under an existing team member instead of directly under master
    assign_parent_override = inv.get("assign_parent_user_id")
    if invite_role == "member":
        role = "member"
        parent_user_id = assign_parent_override or creator_id
    elif invite_role == "admin":
        role = "admin"
        parent_user_id = assign_parent_override or creator_id
    elif invite_role == "owner":
        role = "owner"
        parent_user_id = creator_id  # sub-master (Master figlio) — separate tenant with lineage
    else:
        # Default legacy behavior: new independent owner
        role = "owner"
        parent_user_id = None
    user_doc = {
        "user_id": uid,
        "email": body.email.lower().strip(),
        "password_hash": pw_hash,
        "name": body.name,
        "role": role,
        "areas": ["energy", "network"],
        "parent_user_id": parent_user_id,
        "subscription_status": "trial",
        "trial_expires_at": trial_expires_at,
        "created_at": now,
        "invited_by": inv["created_by"],
    }
    await db.users.insert_one(user_doc)
    # Mark invite used
    await db.invites.update_one(
        {"invite_token": token},
        {"$set": {"used_at": now, "used_by_user_id": uid}},
    )
    # V27 — Update linked contact status + link to registered user
    inv_contact_id = inv.get("contact_id")
    inv_intent = inv.get("contact_intent") or ("collaborator" if invite_role else "prospect")
    if inv_contact_id and inv["created_by"]:
        # Update inside the inviter's tenant (creator is a master, so its user_id IS the tenant_id)
        await db.contacts.update_one(
            {"contact_id": inv_contact_id, "user_id": inv["created_by"]},
            {"$set": {
                "status": inv_intent,
                "linked_user_id": uid,  # V27 — link the newly-registered user back to the master's rubrica entry
                "email": body.email.lower().strip() or None,
                "updated_at": now,
            }}
        )
    token_jwt = jwt.encode({"sub": uid, "email": user_doc["email"]}, JWT_SECRET, algorithm=JWT_ALG)
    return {
        "token": token_jwt,
        "user": {"user_id": uid, "email": user_doc["email"], "name": user_doc["name"], "role": user_doc["role"], "areas": user_doc["areas"]},
        "subscription": _subscription_state(user_doc),
    }


@api_router.put("/users/{user_id}/extend-trial")
async def extend_trial(user_id: str, body: ExtendTrialIn, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Non autorizzato")
    # Ensure the target user was invited by this owner
    target = await db.users.find_one({"user_id": user_id, "invited_by": user["user_id"]})
    if not target:
        raise HTTPException(status_code=404, detail="Utente non trovato o non invitato da te")
    exp = target.get("trial_expires_at") or utcnow()
    if isinstance(exp, str):
        try: exp = datetime.fromisoformat(exp.replace("Z", "+00:00"))
        except Exception: exp = utcnow()
    if exp.tzinfo is None: exp = exp.replace(tzinfo=timezone.utc)
    # If already expired, start from now
    base = exp if exp > utcnow() else utcnow()
    new_exp = base + timedelta(days=body.add_days)
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"trial_expires_at": new_exp, "subscription_status": "trial"}},
    )
    fresh = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    return {"user_id": user_id, "subscription": _subscription_state(fresh), "trial_expires_at": new_exp.isoformat()}


@api_router.put("/users/{user_id}/free-forever")
async def set_free_forever(user_id: str, user=Depends(get_current_user)):
    """Owner marks an invited user as Free Sempre (indefinite free access)."""
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Non autorizzato")
    target = await db.users.find_one({"user_id": user_id, "invited_by": user["user_id"]})
    if not target:
        raise HTTPException(status_code=404, detail="Utente non trovato o non invitato da te")
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"subscription_status": "free_forever"}, "$unset": {"trial_expires_at": ""}},
    )
    fresh = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    return {"user_id": user_id, "subscription": _subscription_state(fresh)}


class RevokeFreeForeverIn(BaseModel):
    mode: Literal["trial", "expired"] = "trial"
    trial_days: int = 30


@api_router.put("/users/{user_id}/revoke-free-forever")
async def revoke_free_forever(user_id: str, body: RevokeFreeForeverIn, user=Depends(get_current_user)):
    """Owner revokes Free Sempre and moves user back to trial (or marks expired to force upgrade)."""
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Non autorizzato")
    target = await db.users.find_one({"user_id": user_id, "invited_by": user["user_id"]})
    if not target:
        raise HTTPException(status_code=404, detail="Utente non trovato o non invitato da te")
    if body.mode == "expired":
        upd = {"subscription_status": "expired", "trial_expires_at": utcnow() - timedelta(days=1)}
    else:
        new_exp = utcnow() + timedelta(days=max(1, int(body.trial_days)))
        upd = {"subscription_status": "trial", "trial_expires_at": new_exp}
    await db.users.update_one({"user_id": user_id}, {"$set": upd})
    fresh = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    return {"user_id": user_id, "subscription": _subscription_state(fresh)}


# =========================
# Groups (custom, per-tenant)
# =========================
class GroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    color: str = "#1B6CB0"
    description: str = ""


class GroupUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    description: Optional[str] = None


@api_router.get("/groups")
async def list_groups(user=Depends(get_current_user)):
    q = {"user_id": tenant_id(user)}
    items = await db.groups.find(q, {"_id": 0}).sort("name", 1).to_list(1000)
    # Attach member_count
    for g in items:
        g["member_count"] = await db.contacts.count_documents({
            "user_id": tenant_id(user),
            "group_ids": g["group_id"],
        })
    return {"items": items}


@api_router.post("/groups")
async def create_group(body: GroupIn, user=Depends(get_current_user)):
    gid = f"g_{uuid.uuid4().hex[:12]}"
    doc = {
        "group_id": gid,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        **body.model_dump(),
        "created_at": utcnow(),
    }
    await db.groups.insert_one(doc)
    strip_id(doc)
    doc["member_count"] = 0
    return doc


@api_router.put("/groups/{group_id}")
async def update_group(group_id: str, body: GroupUpdate, user=Depends(get_current_user)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if not upd:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
    r = await db.groups.update_one(
        {"user_id": tenant_id(user), "group_id": group_id},
        {"$set": upd},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Gruppo non trovato")
    g = await db.groups.find_one({"group_id": group_id}, {"_id": 0})
    return g


@api_router.delete("/groups/{group_id}")
async def delete_group(group_id: str, user=Depends(get_current_user)):
    await db.groups.delete_one({"user_id": tenant_id(user), "group_id": group_id})
    # Remove reference from all contacts
    await db.contacts.update_many(
        {"user_id": tenant_id(user), "group_ids": group_id},
        {"$pull": {"group_ids": group_id}},
    )
    return {"ok": True}


@api_router.get("/groups/{group_id}/contacts")
async def group_contacts(group_id: str, user=Depends(get_current_user)):
    q = scope_query(user, {"group_ids": group_id})
    items = await db.contacts.find(
        q,
        {"_id": 0, "notes": 0, "files": 0},
    ).sort("last_name", 1).to_list(2000)
    return {"items": items}


# =========================
# SMTP config (per-tenant)
# =========================
class SmtpConfig(BaseModel):
    host: str = ""
    port: int = 465
    username: str = ""
    password: str = ""
    sender_name: str = ""
    sender_email: str = ""
    use_ssl: bool = True


class SmtpConfigOut(BaseModel):
    host: str = ""
    port: int = 465
    username: str = ""
    sender_name: str = ""
    sender_email: str = ""
    use_ssl: bool = True
    configured: bool = False


@api_router.get("/smtp/config", response_model=SmtpConfigOut)
async def get_smtp_config(user=Depends(get_current_user)):
    doc = await db.smtp_configs.find_one({"user_id": tenant_id(user)}, {"_id": 0})
    if not doc:
        return SmtpConfigOut()
    return SmtpConfigOut(
        host=doc.get("host", ""),
        port=doc.get("port", 465),
        username=doc.get("username", ""),
        sender_name=doc.get("sender_name", ""),
        sender_email=doc.get("sender_email", ""),
        use_ssl=doc.get("use_ssl", True),
        configured=bool(doc.get("password")),
    )


@api_router.put("/smtp/config", response_model=SmtpConfigOut)
async def put_smtp_config(body: SmtpConfig, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo l'owner può modificare le impostazioni email")
    tid = tenant_id(user)
    existing = await db.smtp_configs.find_one({"user_id": tid}, {"_id": 0}) or {}
    upd = body.model_dump()
    # If password is empty, keep existing
    if not upd.get("password"):
        upd["password"] = existing.get("password", "")
    upd["user_id"] = tid
    upd["updated_at"] = utcnow()
    await db.smtp_configs.update_one({"user_id": tid}, {"$set": upd}, upsert=True)
    return SmtpConfigOut(
        host=upd.get("host", ""),
        port=upd.get("port", 465),
        username=upd.get("username", ""),
        sender_name=upd.get("sender_name", ""),
        sender_email=upd.get("sender_email", ""),
        use_ssl=upd.get("use_ssl", True),
        configured=bool(upd.get("password")),
    )


def _send_smtp_email(cfg: dict, to_email: str, subject: str, body_text: str, body_html: Optional[str] = None):
    """Blocking send via SMTP. To be run in a threadpool."""
    sender_email = cfg.get("sender_email") or cfg.get("username")
    sender_name = cfg.get("sender_name") or sender_email
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = formataddr((sender_name, sender_email))
    msg["To"] = to_email
    msg.attach(MIMEText(body_text or "", "plain", "utf-8"))
    if body_html:
        msg.attach(MIMEText(body_html, "html", "utf-8"))
    host = cfg["host"]
    port = int(cfg.get("port") or 465)
    use_ssl = bool(cfg.get("use_ssl", True))
    if use_ssl:
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(host, port, context=context, timeout=30) as server:
            server.login(cfg["username"], cfg["password"])
            server.sendmail(sender_email, [to_email], msg.as_string())
    else:
        with smtplib.SMTP(host, port, timeout=30) as server:
            server.ehlo()
            try:
                server.starttls(context=ssl.create_default_context())
                server.ehlo()
            except Exception:
                pass
            server.login(cfg["username"], cfg["password"])
            server.sendmail(sender_email, [to_email], msg.as_string())


class SmtpTestInput(BaseModel):
    to_email: EmailStr


@api_router.post("/smtp/test")
async def smtp_test(body: SmtpTestInput, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Non autorizzato")
    cfg = await db.smtp_configs.find_one({"user_id": tenant_id(user)}, {"_id": 0})
    if not cfg or not cfg.get("password") or not cfg.get("host"):
        raise HTTPException(status_code=400, detail="Configurazione SMTP mancante")
    try:
        await asyncio.get_event_loop().run_in_executor(
            None,
            _send_smtp_email,
            cfg,
            body.to_email,
            "Test invio Dal Pastro CRM",
            "Questa è una email di prova. Se la ricevi, la configurazione SMTP funziona correttamente.",
            None,
        )
    except Exception as e:
        logger.exception("SMTP test failed")
        raise HTTPException(status_code=400, detail=f"Errore invio: {e}")
    return {"ok": True}


# =========================
# Bulk messaging
# =========================
class BulkEmailInput(BaseModel):
    contact_ids: List[str] = Field(default_factory=list)
    group_id: Optional[str] = None
    subject: str
    body_text: str
    body_html: Optional[str] = None


@api_router.post("/bulk/email")
async def bulk_email(body: BulkEmailInput, user=Depends(get_current_user)):
    cfg = await db.smtp_configs.find_one({"user_id": tenant_id(user)}, {"_id": 0})
    if not cfg or not cfg.get("password") or not cfg.get("host"):
        raise HTTPException(status_code=400, detail="Configurazione SMTP non presente. Configura le credenziali email dalle Impostazioni.")
    q: Dict[str, Any] = scope_query(user)
    if body.group_id:
        q["group_ids"] = body.group_id
    elif body.contact_ids:
        q["contact_id"] = {"$in": body.contact_ids}
    else:
        raise HTTPException(status_code=400, detail="Nessun destinatario specificato")
    contacts = await db.contacts.find(q, {"_id": 0, "email": 1, "email_alt": 1, "first_name": 1, "last_name": 1, "contact_id": 1}).to_list(2000)
    sent, failed = [], []
    for c in contacts:
        to = (c.get("email") or c.get("email_alt") or "").strip()
        if not to:
            failed.append({"contact_id": c["contact_id"], "reason": "Email mancante"})
            continue
        try:
            personalized = body.body_text.replace("{nome}", c.get("first_name", "")).replace("{cognome}", c.get("last_name", ""))
            html = body.body_html.replace("{nome}", c.get("first_name", "")).replace("{cognome}", c.get("last_name", "")) if body.body_html else None
            await asyncio.get_event_loop().run_in_executor(
                None,
                _send_smtp_email,
                cfg,
                to,
                body.subject,
                personalized,
                html,
            )
            sent.append({"contact_id": c["contact_id"], "email": to})
        except Exception as e:
            logger.exception(f"SMTP send failed for {to}")
            failed.append({"contact_id": c["contact_id"], "email": to, "reason": str(e)[:200]})
    return {"sent_count": len(sent), "failed_count": len(failed), "sent": sent, "failed": failed}


class BulkPreviewInput(BaseModel):
    contact_ids: List[str] = Field(default_factory=list)
    group_id: Optional[str] = None
    channel: Literal["whatsapp", "telegram", "sms"]


@api_router.post("/bulk/preview")
async def bulk_preview(body: BulkPreviewInput, user=Depends(get_current_user)):
    """Return ordered list of recipients with deep-link phone/telegram to open sequentially from the client."""
    q: Dict[str, Any] = scope_query(user)
    if body.group_id:
        q["group_ids"] = body.group_id
    elif body.contact_ids:
        q["contact_id"] = {"$in": body.contact_ids}
    else:
        raise HTTPException(status_code=400, detail="Nessun destinatario")
    contacts = await db.contacts.find(
        q,
        {"_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1, "phone": 1, "whatsapp": 1, "telegram": 1},
    ).sort("last_name", 1).to_list(2000)
    out = []
    for c in contacts:
        entry = {
            "contact_id": c["contact_id"],
            "name": f"{c.get('first_name', '')} {c.get('last_name', '')}".strip(),
        }
        if body.channel == "whatsapp":
            phone = (c.get("whatsapp") or c.get("phone") or "").strip()
            entry["target"] = phone
            entry["skip"] = not phone
        elif body.channel == "sms":
            phone = (c.get("phone") or "").strip()
            entry["target"] = phone
            entry["skip"] = not phone
        else:  # telegram
            t = (c.get("telegram") or "").strip()
            entry["target"] = t
            entry["skip"] = not t
        out.append(entry)
    return {"items": out}


# =========================
# Internal team chat
# =========================
class ChannelIn(BaseModel):
    name: str = ""
    member_user_ids: List[str] = Field(default_factory=list)
    is_direct: bool = False


class ChannelUpdate(BaseModel):
    name: Optional[str] = None
    member_user_ids: Optional[List[str]] = None


class ChatMessageIn(BaseModel):
    kind: Literal["text", "audio", "photo", "file", "link"] = "text"
    text: Optional[str] = None
    audio_base64: Optional[str] = None
    audio_mime: Optional[str] = None
    photo_base64: Optional[str] = None
    file_base64: Optional[str] = None
    file_name: Optional[str] = None
    file_mime: Optional[str] = None
    file_size: Optional[int] = None
    link_url: Optional[str] = None
    link_title: Optional[str] = None
    duration_ms: Optional[int] = None
    reply_to: Optional[str] = None


async def _validate_channel_members(tid: str, member_ids: List[str]) -> List[str]:
    """Ensure all provided user_ids belong to same tenant."""
    if not member_ids:
        return []
    users = await db.users.find({
        "user_id": {"$in": member_ids},
        "$or": [{"user_id": tid}, {"parent_user_id": tid}],
    }, {"_id": 0, "user_id": 1}).to_list(1000)
    return [u["user_id"] for u in users]


@api_router.get("/chat/channels")
async def list_channels(user=Depends(get_current_user)):
    uid = user["user_id"]
    tid = tenant_id(user)
    items = await db.chat_channels.find(
        {"user_id": tid, "member_user_ids": uid},
        {"_id": 0},
    ).sort("last_message_at", -1).to_list(200)
    # Attach last message + unread count + display info
    for ch in items:
        last = await db.chat_messages.find_one(
            {"channel_id": ch["channel_id"]},
            {"_id": 0},
            sort=[("created_at", -1)],
        )
        ch["last_message"] = last
        # Unread: messages after user's last_read_at (per member)
        read_map = ch.get("read_map") or {}
        last_read = read_map.get(uid)
        unread_q = {"channel_id": ch["channel_id"], "sender_id": {"$ne": uid}}
        if last_read:
            unread_q["created_at"] = {"$gt": last_read}
        ch["unread_count"] = await db.chat_messages.count_documents(unread_q)
    return {"items": items}


@api_router.post("/chat/channels")
async def create_channel(body: ChannelIn, user=Depends(get_current_user)):
    tid = tenant_id(user)
    uid = user["user_id"]
    valid_members = await _validate_channel_members(tid, list(set(body.member_user_ids + [uid])))
    if len(valid_members) < 2:
        raise HTTPException(status_code=400, detail="Aggiungi almeno un altro utente")
    # For direct 1-1 chats, reuse existing
    if body.is_direct and len(valid_members) == 2:
        existing = await db.chat_channels.find_one({
            "user_id": tid,
            "is_direct": True,
            "member_user_ids": {"$all": valid_members, "$size": 2},
        }, {"_id": 0})
        if existing:
            return existing
    cid = f"ch_{uuid.uuid4().hex[:12]}"
    doc = {
        "channel_id": cid,
        "user_id": tid,
        "name": body.name or "",
        "is_direct": bool(body.is_direct) and len(valid_members) == 2,
        "member_user_ids": valid_members,
        "created_by": uid,
        "created_at": utcnow(),
        "last_message_at": utcnow(),
        "read_map": {uid: utcnow()},
    }
    await db.chat_channels.insert_one(doc)
    strip_id(doc)
    return doc


@api_router.put("/chat/channels/{channel_id}")
async def update_channel(channel_id: str, body: ChannelUpdate, user=Depends(get_current_user)):
    tid = tenant_id(user)
    uid = user["user_id"]
    ch = await db.chat_channels.find_one({"channel_id": channel_id, "user_id": tid, "member_user_ids": uid}, {"_id": 0})
    if not ch:
        raise HTTPException(status_code=404, detail="Canale non trovato")
    upd = {}
    if body.name is not None:
        upd["name"] = body.name
    if body.member_user_ids is not None:
        valid = await _validate_channel_members(tid, list(set(body.member_user_ids + [uid])))
        upd["member_user_ids"] = valid
    if not upd:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
    await db.chat_channels.update_one({"channel_id": channel_id}, {"$set": upd})
    ch2 = await db.chat_channels.find_one({"channel_id": channel_id}, {"_id": 0})
    return ch2


@api_router.delete("/chat/channels/{channel_id}")
async def delete_channel(channel_id: str, user=Depends(get_current_user)):
    tid = tenant_id(user)
    ch = await db.chat_channels.find_one({"channel_id": channel_id, "user_id": tid}, {"_id": 0})
    if not ch:
        raise HTTPException(status_code=404, detail="Canale non trovato")
    if ch["created_by"] != user["user_id"] and not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il creatore o l'owner può eliminare")
    await db.chat_channels.delete_one({"channel_id": channel_id})
    await db.chat_messages.delete_many({"channel_id": channel_id})
    return {"ok": True}


@api_router.get("/chat/channels/{channel_id}/messages")
async def list_messages(channel_id: str, after: Optional[datetime] = None, limit: int = 100, user=Depends(get_current_user)):
    tid = tenant_id(user)
    uid = user["user_id"]
    ch = await db.chat_channels.find_one({"channel_id": channel_id, "user_id": tid, "member_user_ids": uid}, {"_id": 0})
    if not ch:
        raise HTTPException(status_code=404, detail="Canale non trovato")
    q: Dict[str, Any] = {"channel_id": channel_id}
    if after:
        if after.tzinfo is None:
            after = after.replace(tzinfo=timezone.utc)
        q["created_at"] = {"$gt": after}
    items = await db.chat_messages.find(q, {"_id": 0}).sort("created_at", 1).to_list(limit)
    # Mark as read
    await db.chat_channels.update_one(
        {"channel_id": channel_id},
        {"$set": {f"read_map.{uid}": utcnow()}},
    )
    return {"items": items}


@api_router.post("/chat/channels/{channel_id}/messages")
async def send_message(channel_id: str, body: ChatMessageIn, user=Depends(get_current_user)):
    tid = tenant_id(user)
    uid = user["user_id"]
    ch = await db.chat_channels.find_one({"channel_id": channel_id, "user_id": tid, "member_user_ids": uid}, {"_id": 0})
    if not ch:
        raise HTTPException(status_code=404, detail="Canale non trovato")
    mid = f"m_{uuid.uuid4().hex[:12]}"
    now = utcnow()
    doc = {
        "message_id": mid,
        "channel_id": channel_id,
        "sender_id": uid,
        "sender_name": user.get("name", ""),
        "created_at": now,
        **body.model_dump(),
    }
    await db.chat_messages.insert_one(doc)
    await db.chat_channels.update_one(
        {"channel_id": channel_id},
        {"$set": {"last_message_at": now, f"read_map.{uid}": now}},
    )
    strip_id(doc)
    return doc


@api_router.delete("/chat/messages/{message_id}")
async def delete_message(message_id: str, user=Depends(get_current_user)):
    m = await db.chat_messages.find_one({"message_id": message_id}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Messaggio non trovato")
    if m["sender_id"] != user["user_id"] and not is_owner(user):
        raise HTTPException(status_code=403, detail="Non autorizzato")
    await db.chat_messages.delete_one({"message_id": message_id})
    return {"ok": True}


# =========================
# Contact vCard (share)
# =========================
@api_router.get("/contacts/{contact_id}/vcard", response_class=PlainTextResponse)
async def contact_vcard(contact_id: str, user=Depends(get_current_user)):
    c = await db.contacts.find_one(scope_query(user, {"contact_id": contact_id}), {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Contatto non trovato")
    parts = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        f"N:{c.get('last_name', '')};{c.get('first_name', '')};;;",
        f"FN:{c.get('first_name', '')} {c.get('last_name', '')}".strip(),
    ]
    if c.get("phone"):
        parts.append(f"TEL;TYPE=CELL:{c['phone']}")
    if c.get("phone_alt"):
        parts.append(f"TEL;TYPE=HOME:{c['phone_alt']}")
    if c.get("email"):
        parts.append(f"EMAIL:{c['email']}")
    if c.get("email_alt"):
        parts.append(f"EMAIL:{c['email_alt']}")
    addr_parts = [c.get("address_street", ""), c.get("address_city", ""), c.get("address_zip", ""), c.get("address_province", "")]
    if any(addr_parts):
        parts.append(f"ADR:;;{addr_parts[0]};{addr_parts[1]};{addr_parts[3]};{addr_parts[2]};")
    if c.get("website"):
        parts.append(f"URL:{c['website']}")
    if c.get("birth_date"):
        try:
            bd = c["birth_date"]
            if len(bd) == 10:
                parts.append(f"BDAY:{bd.replace('-', '')}")
        except Exception:
            pass
    if c.get("general_note"):
        parts.append(f"NOTE:{c['general_note']}")
    parts.append("END:VCARD")
    return "\r\n".join(parts)


# =========================
# MY THING (personal, private per user)
# =========================
def _mt_scope(user: dict) -> Dict[str, Any]:
    # Strictly private: only items owned by the caller (not tenant-wide)
    return {"owner_user_id": user["user_id"]}


def _serialize_mt(doc: dict) -> dict:
    if not doc:
        return doc
    doc.pop("_id", None)
    if isinstance(doc.get("scheduled_at"), datetime):
        doc["scheduled_at"] = doc["scheduled_at"].isoformat()
    if isinstance(doc.get("created_at"), datetime):
        doc["created_at"] = doc["created_at"].isoformat()
    if isinstance(doc.get("updated_at"), datetime):
        doc["updated_at"] = doc["updated_at"].isoformat()
    return doc


@api_router.get("/my-thing")
async def my_thing_list(kind: Optional[str] = None, user=Depends(get_current_user)):
    q = _mt_scope(user)
    if kind:
        q["kind"] = kind
    docs = await db.my_thing.find(q).sort("created_at", -1).to_list(500)
    return {"items": [_serialize_mt(d) for d in docs]}


@api_router.post("/my-thing")
async def my_thing_create(body: MyThingIn, user=Depends(get_current_user)):
    item_id = f"mt_{uuid.uuid4().hex[:12]}"
    doc = {
        "item_id": item_id,
        "owner_user_id": user["user_id"],
        "kind": body.kind,
        "title": body.title,
        "body": body.body,
        "image_base64": body.image_base64,
        "scheduled_at": body.scheduled_at,
        "daily_time": body.daily_time,
        "recurring": body.recurring,
        "display_mode": body.display_mode,
        "notify": body.notify,
        "active": body.active,
        "color": body.color,
        # V28.d — banner customization (message-kind only)
        "font_family": body.font_family or "system",
        "font_size": body.font_size or "medium",
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.my_thing.insert_one(doc)
    return {"item": _serialize_mt(doc)}


@api_router.put("/my-thing/{item_id}")
async def my_thing_update(item_id: str, body: MyThingUpdate, user=Depends(get_current_user)):
    existing = await db.my_thing.find_one({"item_id": item_id, **_mt_scope(user)})
    if not existing:
        raise HTTPException(status_code=404, detail="Elemento non trovato")
    upd = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not upd:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
    upd["updated_at"] = utcnow()
    await db.my_thing.update_one({"item_id": item_id}, {"$set": upd})
    doc = await db.my_thing.find_one({"item_id": item_id})
    return {"item": _serialize_mt(doc)}


@api_router.delete("/my-thing/{item_id}")
async def my_thing_delete(item_id: str, user=Depends(get_current_user)):
    r = await db.my_thing.delete_one({"item_id": item_id, **_mt_scope(user)})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Elemento non trovato")
    return {"ok": True}


@api_router.get("/my-thing/random-banner")
async def my_thing_random_banner(user=Depends(get_current_user)):
    """Random active message or image for the home splash banner."""
    q = {**_mt_scope(user), "active": True, "kind": {"$in": ["message", "image"]}}
    # Prefer scheduled messages if current time matches HH:MM
    now = utcnow()
    now_it = now.astimezone(timezone(timedelta(hours=2)))  # rough Italy TZ; TZ-agnostic OK for HH:MM
    hhmm = now_it.strftime("%H:%M")
    scheduled = await db.my_thing.find_one({**q, "display_mode": "scheduled", "daily_time": hhmm})
    if scheduled:
        return {"item": _serialize_mt(scheduled)}
    # Otherwise: random pick among random-mode items
    import random as _random
    items = await db.my_thing.find({**q, "display_mode": "random"}).to_list(200)
    if not items:
        return {"item": None}
    return {"item": _serialize_mt(_random.choice(items))}


@api_router.get("/my-thing/upcoming-events")
async def my_thing_upcoming_events(user=Depends(get_current_user)):
    """Return events + anniversaries in next 30 days."""
    now = utcnow()
    horizon = now + timedelta(days=30)
    # Events with scheduled_at in [now, horizon]
    events = await db.my_thing.find({
        **_mt_scope(user),
        "active": True,
        "kind": {"$in": ["event", "anniversary"]},
    }).to_list(500)
    upcoming = []
    for e in events:
        sched = e.get("scheduled_at")
        if not sched:
            continue
        if e.get("kind") == "anniversary":
            # Compute next yearly occurrence
            try:
                base = sched if isinstance(sched, datetime) else datetime.fromisoformat(str(sched))
                if base.tzinfo is None:
                    base = base.replace(tzinfo=timezone.utc)
                next_year = base.replace(year=now.year)
                if next_year < now:
                    next_year = next_year.replace(year=now.year + 1)
                if next_year <= horizon:
                    ee = _serialize_mt(dict(e))
                    ee["next_occurrence"] = next_year.isoformat()
                    upcoming.append(ee)
            except Exception:
                pass
        else:
            base = sched if isinstance(sched, datetime) else datetime.fromisoformat(str(sched))
            if base.tzinfo is None:
                base = base.replace(tzinfo=timezone.utc)
            if now <= base <= horizon:
                ee = _serialize_mt(dict(e))
                ee["next_occurrence"] = base.isoformat()
                upcoming.append(ee)
    upcoming.sort(key=lambda x: x.get("next_occurrence") or "")
    return {"items": upcoming}


# =========================
# AI-powered Contact helpers (Emergent LLM Key)
# =========================
class AIUrlIn(BaseModel):
    url: str
    context: Optional[str] = None


class AITextIn(BaseModel):
    text: str


class AIVoiceIn(BaseModel):
    audio_base64: str  # data URL or plain b64
    mime: Optional[str] = "audio/webm"


class AIImageIn(BaseModel):
    image_base64: str  # data URL or plain b64
    mime: Optional[str] = "image/jpeg"


CONTACT_EXTRACTION_SYSTEM = (
    "Sei un assistente che estrae informazioni di contatto da testo o pagine web. "
    "Rispondi SEMPRE con un oggetto JSON valido (senza testo aggiuntivo, senza markdown) con questi campi opzionali: "
    "first_name (string), last_name (string), phone (string, con prefisso internazionale se disponibile), "
    "phone_alt (string), email (string), email_alt (string), company (string), role (string), "
    "address_street (string), address_city (string), address_zip (string), address_province (string), "
    "website (string), linkedin (string), telegram (string), whatsapp (string), "
    "birth_date (string in formato DD/MM/YYYY se identificabile), "
    "notes (string, breve descrizione professionale). "
    "Se un campo non è presente, omettilo. Rispondi in italiano nei campi testuali. NON aggiungere spiegazioni."
)


# ---------------------------------------------------------------------------
# V38Z — Robust JSON parser for LLM responses.
# ---------------------------------------------------------------------------
# LLMs occasionally emit malformed JSON: wrapped in prose, missing quotes,
# trailing commas, single quotes, etc. This helper attempts multiple fallback
# strategies and, when ALL fail, returns a dict with a *clear user-facing*
# error message (no raw broken JSON exposed to the frontend).
# ---------------------------------------------------------------------------
def _parse_llm_json(raw: str, fallback_key: str = "note_ai") -> dict:
    """Best-effort JSON parser for LLM responses.

    Returns a dict. When parsing fails after all strategies, returns:
      {
        "parse_error": True,
        "error_message": "L'analisi AI ha restituito una risposta non valida. Riprova più tardi.",
        <fallback_key>: <short excerpt of the raw text for debugging>
      }
    NEVER raises. Callers can check `result.get("parse_error")` to detect
    the failure and display a clear message instead of raw fields.
    """
    import json as _json_local
    import re as _re_local

    USER_FRIENDLY_MSG = (
        "L'analisi AI ha restituito una risposta non valida. "
        "Riprova più tardi o contatta il supporto se il problema persiste."
    )

    def _err(kind: str, snippet: str) -> dict:
        return {
            "parse_error": True,
            "error_message": USER_FRIENDLY_MSG,
            "parse_error_kind": kind,  # internal, not shown to user
            fallback_key: snippet[:300],
        }

    if not raw or not isinstance(raw, str):
        return _err("empty", "")
    text = raw.strip()

    # Strip common markdown code fences ```json ... ```
    if text.startswith("```"):
        text = text.strip("`")
        # remove optional leading "json"
        if text.lower().startswith("json"):
            text = text[4:].strip()
        if text.endswith("```"):
            text = text[:-3].strip()

    # Attempt 1: strict parse
    try:
        data = _json_local.loads(text)
        if isinstance(data, dict):
            return data
        # Not a dict — wrap it
        return {fallback_key: str(data)[:500]}
    except Exception:
        pass

    # Attempt 2: extract the outermost {...} block via regex
    m = _re_local.search(r"\{[\s\S]*\}", text)
    if m:
        candidate = m.group(0)
        try:
            data = _json_local.loads(candidate)
            if isinstance(data, dict):
                return data
        except Exception:
            pass
        # Attempt 3: repair common defects on the candidate
        repaired = candidate
        # Remove trailing commas before } or ]
        repaired = _re_local.sub(r",(\s*[}\]])", r"\1", repaired)
        # Replace single-quoted string literals with double quotes (best-effort)
        repaired = _re_local.sub(r"(?<![\\])'([^'\n]*?)'", r'"\1"', repaired)
        # Wrap unquoted keys in double quotes: {foo: 1} -> {"foo": 1}
        repaired = _re_local.sub(r'([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:', r'\1"\2":', repaired)
        try:
            data = _json_local.loads(repaired)
            if isinstance(data, dict):
                return data
        except Exception:
            pass

    # All attempts failed
    logger.warning("_parse_llm_json failed; raw preview=%r", (raw or "")[:200])
    return _err("unparseable", raw)


async def _llm_extract_contact(text: str, model: str = "claude-haiku-4-5-20251001", provider: str = "anthropic") -> dict:
    """Send raw text to Claude Haiku and parse the JSON contact dict."""
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY non configurato")
    chat = LlmChat(
        api_key=key,
        session_id=f"contact-extract-{uuid.uuid4().hex[:8]}",
        system_message=CONTACT_EXTRACTION_SYSTEM,
    ).with_model(provider, model)
    try:
        resp = await chat.send_message(UserMessage(text=text))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Errore LLM: {e}")
    raw = (resp or "").strip()
    # V38Z — robust JSON parsing (never raises)
    data = _parse_llm_json(raw, fallback_key="notes")
    # For contact extraction, ignore parse_error flag (caller expects a dict either way)
    data.pop("parse_error", None)
    data.pop("error_message", None)
    data.pop("parse_error_kind", None)
    return data


@api_router.post("/ai/contact-from-url")
async def ai_contact_from_url(body: AIUrlIn, user=Depends(get_current_user)):
    """Fetch the URL, extract clean text, feed it to Claude Haiku 4.5 for JSON contact parsing."""
    url = (body.url or "").strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="URL non valido")
    # Download HTML
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=15) as c:
            r = await c.get(url, headers={"User-Agent": "Mozilla/5.0 DalPastroCRM/1.0"})
            r.raise_for_status()
            html = r.text
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Impossibile scaricare la pagina: {e}")
    # Naive text extraction (strip tags)
    import re as _re
    text = _re.sub(r"<script[\s\S]*?</script>", " ", html, flags=_re.IGNORECASE)
    text = _re.sub(r"<style[\s\S]*?</style>", " ", text, flags=_re.IGNORECASE)
    text = _re.sub(r"<[^>]+>", " ", text)
    text = _re.sub(r"\s+", " ", text).strip()
    if len(text) > 6000:
        text = text[:6000]
    prompt = (
        f"Ecco il contenuto testuale della pagina {url}. Estrai i dati di contatto.\n\n{text}"
        + (f"\n\nContesto aggiuntivo: {body.context}" if body.context else "")
    )
    parsed = await _llm_extract_contact(prompt)
    return {"contact": parsed, "source_url": url}


@api_router.post("/ai/transcribe")
async def ai_transcribe(body: AIVoiceIn, user=Depends(get_current_user)):
    """Transcribe audio to text via OpenAI Whisper (Italian language).
    Returns just the raw transcript — used by the microphone button on the contact card notes.
    """
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY non configurato")
    b64 = body.audio_base64
    if b64.startswith("data:"):
        b64 = b64.split(",", 1)[1]
    try:
        audio_bytes = base64.b64decode(b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Audio base64 non valido")
    if len(audio_bytes) < 1024:
        raise HTTPException(status_code=400, detail="Audio troppo corto o vuoto")
    if len(audio_bytes) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio troppo grande (max 25 MB)")
    import tempfile
    mime = (body.mime or "").lower()
    if "webm" in mime:
        ext = ".webm"
    elif "m4a" in mime or "mp4" in mime or "aac" in mime:
        ext = ".m4a"
    elif "wav" in mime:
        ext = ".wav"
    elif "ogg" in mime:
        ext = ".webm"  # litellm expects webm/ogg family
    else:
        ext = ".mp3"
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(audio_bytes)
        path = tmp.name
    try:
        from emergentintegrations.llm.openai.speech_to_text import OpenAISpeechToText
        stt = OpenAISpeechToText(api_key=key)
        with open(path, "rb") as _fh:
            result = await stt.transcribe(
                file=_fh,
                model="whisper-1",
                language="it",
                response_format="text",
            )
        # response can be a plain string when response_format=text, or an object with .text
        if isinstance(result, str):
            transcript = result.strip()
        elif isinstance(result, dict):
            transcript = (result.get("text") or result.get("transcript") or "").strip()
        else:
            transcript = str(getattr(result, "text", result) or "").strip()
    except Exception as e:
        logger.exception(f"transcribe error: {e}")
        raise HTTPException(status_code=502, detail=f"Errore trascrizione: {str(e)[:300]}")
    finally:
        try:
            import os as _os
            _os.unlink(path)
        except Exception:
            pass
    return {"transcript": transcript, "language": "it", "model": "whisper-1"}


@api_router.post("/ai/contact-from-voice")
async def ai_contact_from_voice(body: AIVoiceIn, user=Depends(get_current_user)):
    """Transcribe audio via Whisper, then parse to contact fields via Claude Haiku."""
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY non configurato")
    b64 = body.audio_base64
    if b64.startswith("data:"):
        b64 = b64.split(",", 1)[1]
    try:
        audio_bytes = base64.b64decode(b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Audio base64 non valido")
    import tempfile
    ext = ".webm" if "webm" in (body.mime or "") else (".m4a" if "m4a" in (body.mime or "") else ".mp3")
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(audio_bytes)
        path = tmp.name
    try:
        from emergentintegrations.llm.openai.speech_to_text import OpenAISpeechToText
        stt = OpenAISpeechToText(api_key=key)
        # V38P — bug fix: the correct kwarg is `file`, not `file_path`.
        # Previously this raised TypeError → HTTP 502.
        with open(path, "rb") as _fh:
            result = await stt.transcribe(
                file=_fh,
                model="whisper-1",
                language="it",
                response_format="text",
            )
        if isinstance(result, str):
            transcript = result.strip()
        elif isinstance(result, dict):
            transcript = (result.get("text") or result.get("transcript") or "").strip()
        else:
            transcript = str(getattr(result, "text", result) or "").strip()
    except Exception as e:
        emsg = str(e).lower()
        logger.exception(f"transcribe (contact-from-voice) error: {e}")
        # V38P — narrow error mapping: content/format problems from Whisper
        # (invalid audio, truncated, unsupported codec) → 422; only genuine
        # transport/auth problems → 502.
        content_hints = (
            "invalid file format", "invalid_audio", "audio file might be corrupted",
            "could not decode", "unsupported format", "empty", "no audio data",
            "invalid_request_error", "invalid file", "unable to parse",
            "decoding", "ffprobe", "bad request", "400",
        )
        if any(hint in emsg for hint in content_hints):
            raise HTTPException(status_code=422, detail=f"Audio non decodificabile: {str(e)[:200]}")
        raise HTTPException(status_code=502, detail=f"Errore trascrizione: {str(e)[:300]}")
    finally:
        try:
            os.remove(path)
        except Exception:
            pass
    parsed = await _llm_extract_contact(
        f"Ecco un dettato vocale in italiano di dati di contatto. Estrai i campi:\n\n{transcript}"
    )
    return {"contact": parsed, "transcript": transcript}


@api_router.post("/ai/contact-from-card")
async def ai_contact_from_card(body: AIImageIn, user=Depends(get_current_user)):
    """V38I — OCR + extraction of a business card image via Gemini vision.
    Bug fix: previously `'ImageContent' in dir()` was always False inside the
    function scope, so the image was never attached and Gemini returned an error
    → HTTP 502. Also added better error propagation and a fallback model."""
    from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY non configurato")
    b64 = body.image_base64 or ""
    if not b64:
        raise HTTPException(status_code=400, detail="Immagine mancante")
    # Normalise to a BARE base64 string (no data URL prefix) — this is what
    # emergentintegrations.ImageContent(image_base64=...) expects. Its mime
    # detection looks at the base64 magic bytes (iVBORw0KGgo / /9j/ / etc.).
    if b64.startswith("data:"):
        # strip "data:<mime>;base64,"
        try:
            bare_b64 = b64.split(",", 1)[1]
        except IndexError:
            bare_b64 = b64
    else:
        bare_b64 = b64

    async def _run(model_name: str):
        chat = LlmChat(
            api_key=key,
            session_id=f"card-ocr-{uuid.uuid4().hex[:8]}",
            system_message=CONTACT_EXTRACTION_SYSTEM,
        ).with_model("gemini", model_name)
        msg = UserMessage(
            text="Ecco l'immagine di un biglietto da visita italiano. Estrai i dati (nome, cognome, ruolo/qualifica, azienda, telefono, telefono alternativo, email, email alternativa, indirizzo, città, CAP, provincia, sito web) e restituisci un JSON compatto.",
            file_contents=[ImageContent(image_base64=bare_b64)],
        )
        return await chat.send_message(msg)

    resp = None
    last_err: Optional[Exception] = None
    for model in ("gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.0-flash"):
        try:
            resp = await _run(model)
            if resp:
                break
        except Exception as e:
            last_err = e
            logger.warning(f"card OCR failed with {model}: {e}")
            continue
    if resp is None:
        raise HTTPException(
            status_code=422,
            detail=f"Impossibile leggere il biglietto: {str(last_err)[:200] if last_err else 'nessuna risposta'}"
        )

    raw = (resp or "").strip()
    # V38Z — robust JSON parsing (never raises)
    data = _parse_llm_json(raw, fallback_key="notes")
    data.pop("parse_error", None)
    data.pop("error_message", None)
    data.pop("parse_error_kind", None)
    return {"contact": data}


# =========================
# Energy Bills (Fatture Energia) — V25
# Multi-section (luce/gas/telco) PDF upload + Claude Sonnet 5 background AI analysis
# =========================

BILL_TYPES = ("luce", "gas", "telco")

class EnergyBillIn(BaseModel):
    bill_type: str  # luce | gas | telco
    pdf_base64: str
    pdf_name: Optional[str] = None
    pdf_mime: Optional[str] = "application/pdf"
    # V38: user-selected parameters to focus the AI extraction on (optional list of labels)
    analysis_params: Optional[List[str]] = None


BILL_SYSTEM_PROMPT_LUCE = """Sei un analista esperto di bollette elettriche italiane. Analizza il testo estratto da una fattura LUCE e restituisci ESCLUSIVAMENTE un JSON valido, senza testo introduttivo, senza markdown.

Estrai TUTTI i campi disponibili. Se un campo NON è presente, ometti la chiave (non usare null/N.D.).

Schema JSON atteso:
{
  "fornitore": "Nome azienda fornitrice",
  "cliente": "Nome intestatario",
  "codice_cliente": "codice cliente",
  "pod": "IT001E12345678",
  "pod_count": 1,
  "tensione": "bassa" | "media",
  "potenza_impegnata_kw": 3.0,
  "consumo_totale_12m_kwh": 2450,
  "consumo_medio_mensile_kwh": 204,
  "consumi_mensili_kwh": [{"mese":"gen","kwh":180}, ...],
  "nome_offerta": "Placet Fisso Luce",
  "data_attivazione": "01/03/2024",
  "data_scadenza": "01/03/2026",
  "durata_contratto_mesi": 24,
  "iva_percentuale": 10,
  "spread_eur_kwh": 0.015,
  "prezzo_energia_eur_kwh": 0.145,
  "importo_totale_eur": 145.30,
  "periodo_fattura": "01/09/2024 - 31/10/2024",
  "note_ai": ["punto 1", "punto 2", "punto 3"]
}"""

BILL_SYSTEM_PROMPT_GAS = """Sei un analista esperto di bollette gas italiane. Analizza il testo estratto da una fattura GAS e restituisci ESCLUSIVAMENTE un JSON valido, senza testo introduttivo, senza markdown.

Estrai TUTTI i campi disponibili. Se un campo NON è presente, ometti la chiave.

Schema JSON atteso:
{
  "fornitore": "Nome azienda fornitrice",
  "cliente": "Nome intestatario",
  "codice_cliente": "codice cliente",
  "pdr": "01234567890123",
  "pdr_count": 1,
  "consumo_totale_12m_smc": 850,
  "consumo_medio_mensile_smc": 71,
  "consumi_mensili_smc": [{"mese":"gen","smc":120}, ...],
  "nome_offerta": "Placet Fisso Gas",
  "data_attivazione": "01/03/2024",
  "data_scadenza": "01/03/2026",
  "durata_contratto_mesi": 24,
  "iva_percentuale": 22,
  "accisa_eur_smc": 0.044,
  "spread_eur_smc": 0.02,
  "prezzo_gas_eur_smc": 0.42,
  "importo_totale_eur": 245.30,
  "periodo_fattura": "01/09/2024 - 31/10/2024",
  "note_ai": ["punto 1", "punto 2", "punto 3"]
}"""

BILL_SYSTEM_PROMPT_TELCO = """Sei un analista esperto di bollette telefoniche/internet italiane. Analizza il testo estratto da una fattura TELCO e restituisci ESCLUSIVAMENTE un JSON valido, senza testo introduttivo, senza markdown.

Estrai TUTTI i campi disponibili. Se un campo NON è presente, ometti la chiave.

Schema JSON atteso:
{
  "fornitore": "Nome azienda fornitrice (TIM, Vodafone, Fastweb, ...)",
  "cliente": "Nome intestatario",
  "codice_cliente": "codice cliente",
  "tipo_connessione": "Fibra" | "ADSL" | "FWA" | "Mobile",
  "velocita_download_mbps": 1000,
  "velocita_upload_mbps": 300,
  "numero_telefono": "0245XXXX",
  "servizi_inclusi": ["Chiamate illimitate","IPTV"],
  "costo_mensile_eur": 29.90,
  "costo_annuale_eur": 358.80,
  "durata_contratto_mesi": 24,
  "data_attivazione": "01/03/2024",
  "data_scadenza": "01/03/2026",
  "codice_migrazione": "CM123456",
  "penale_disdetta_eur": 49.90,
  "iva_percentuale": 22,
  "importo_totale_eur": 32.90,
  "periodo_fattura": "01/09/2024 - 31/10/2024",
  "note_ai": ["punto 1", "punto 2", "punto 3"]
}"""


def _extract_pdf_text(pdf_base64: str) -> str:
    """Extract text from a base64-encoded PDF using pypdf."""
    b64 = pdf_base64
    if b64.startswith("data:"):
        b64 = b64.split(",", 1)[1]
    try:
        raw = base64.b64decode(b64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"PDF base64 non valido: {e}")
    try:
        from pypdf import PdfReader
        from io import BytesIO
        reader = PdfReader(BytesIO(raw))
        parts: List[str] = []
        for page in reader.pages[:20]:  # cap first 20 pages
            try:
                parts.append(page.extract_text() or "")
            except Exception:
                continue
        text = "\n".join(parts).strip()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Impossibile leggere PDF: {e}")
    return text


async def _llm_analyze_bill_text(bill_type: str, text: str, analysis_params: Optional[List[str]] = None, tenant: Optional[str] = None) -> dict:
    """Send extracted PDF text to Claude Sonnet 5 and get structured JSON."""
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise Exception("EMERGENT_LLM_KEY non configurato")
    system = {
        "luce": BILL_SYSTEM_PROMPT_LUCE,
        "gas": BILL_SYSTEM_PROMPT_GAS,
        "telco": BILL_SYSTEM_PROMPT_TELCO,
    }.get(bill_type, BILL_SYSTEM_PROMPT_LUCE)
    # V27 — Insegna all'AI: prepend Master-configured rules + monitored URLs as PRIORITY context
    if tenant:
        try:
            teach = await build_ai_teach_context(tenant, bill_type if bill_type in ("luce", "gas", "telco") else "luce")
            if teach:
                system = (
                    "CONTESTO PRIORITARIO CONFIGURATO DAL MASTER (usa queste regole PRIMA di qualsiasi altra fonte):\n"
                    f"{teach}\n\n"
                    "———\n\n"
                ) + system
        except Exception as _e:
            logger.warning("ai_teach context build failed: %s", _e)
    # V38: if user selected specific parameters to focus on, append them to the system prompt
    fiscal_directives: List[str] = []
    display_params: List[str] = []
    if analysis_params:
        for p in analysis_params:
            s = str(p).strip()
            if not s:
                continue
            if s.startswith("__verifica_"):
                fiscal_directives.append(s)
            else:
                display_params.append(s)
    if display_params:
        focus = ", ".join(display_params[:40])
        system = system + (
            f"\n\nPARAMETRI PRIORITARI RICHIESTI DALL'UTENTE (assicurati di estrarli se presenti): {focus}."
            f"\nSe uno dei parametri richiesti non ha corrispondenza diretta nello schema, includilo in un oggetto 'parametri_richiesti' con chiave = nome parametro e valore = valore trovato (o 'N.D.' se non rilevabile)."
        )
    # V38U — Fiscal-check directives → the LLM must extract the *actual* values
    # and flag them in a `fiscal_check` object we render red in the UI.
    if fiscal_directives:
        expected_iva = None
        expected_accise = None
        require_pcv_zero = False
        for d in fiscal_directives:
            if d.startswith("__verifica_iva__="):
                try: expected_iva = float(d.split("=", 1)[1])
                except Exception: pass
            elif d.startswith("__verifica_accise_gas__="):
                try: expected_accise = float(d.split("=", 1)[1])
                except Exception: pass
            elif d.startswith("__verifica_pcv_annullato__="):
                require_pcv_zero = True
        directive_txt = "\n\nVERIFICA AGEVOLAZIONI FISCALI (obbligatorio se presente nella fattura):\n"
        directive_txt += (
            "Includi nella risposta un oggetto `fiscal_check` con la seguente struttura:\n"
            "{\n"
            "  \"iva\": { \"expected\": <expected|null>, \"actual\": <numero>, \"ok\": <bool>, \"delta_annual_eur\": <numero|null> },\n"
            "  \"accise_gas\": { \"expected\": <expected|null>, \"actual\": <numero>, \"ok\": <bool>, \"delta_annual_eur\": <numero|null> },\n"
            "  \"pcv\": { \"expected\": <0|null>, \"actual\": <numero>, \"ok\": <bool>, \"delta_annual_eur\": <numero|null> }\n"
            "}\n"
            "Regole:\n"
            "- `ok` = true se `actual` corrisponde all'expected entro 5% di tolleranza.\n"
            "- `delta_annual_eur` = quanto ha speso in più il cliente su 12 mesi rispetto al valore corretto. Se non calcolabile usa null.\n"
            "- Ometti le chiavi non richieste.\n"
        )
        if expected_iva is not None:
            directive_txt += f"- IVA attesa: {expected_iva}%. Confronta con l'aliquota IVA effettivamente applicata sulla fattura. delta_annual_eur = (aliquota_effettiva - {expected_iva})/100 * imponibile_annuo_stimato.\n"
        if expected_accise is not None:
            directive_txt += f"- Accise gas attese: {expected_accise:.6f} €/Smc. Confronta con l'importo unitario delle accise sul gas riportato in fattura. delta_annual_eur = (accise_effettive - {expected_accise:.6f}) * consumo_annuo_smc_stimato.\n"
        if require_pcv_zero:
            directive_txt += "- PCV / costi fissi mensili attesi: 0 (annullato nel contratto). Se in fattura risulta un PCV / costi fissi > 0, ok=false. delta_annual_eur = PCV_effettivo * 12.\n"
        system = system + directive_txt
    chat = LlmChat(
        api_key=key,
        session_id=f"bill-{bill_type}-{uuid.uuid4().hex[:8]}",
        system_message=system,
    ).with_model("anthropic", "claude-sonnet-5")
    # cap text length
    snippet = text[:18000]
    resp = await chat.send_message(UserMessage(
        text=f"Testo della fattura {bill_type.upper()}:\n\n{snippet}"
    ))
    raw = (resp or "").strip()
    # V38Z — robust JSON parsing for bill analysis. `parse_error` flag survives
    # so the frontend can render a clear red banner instead of raw fields.
    return _parse_llm_json(raw, fallback_key="note_ai")


async def _analyze_bill_task(bill_id: str):
    """Background task: extract PDF text + call Claude, then update bill status.
    Checks for 'cancelled' status before starting the LLM call and before saving results."""
    bill = await db.energy_bills.find_one({"bill_id": bill_id})
    if not bill:
        return
    try:
        # Check cancellation before starting
        curr = await db.energy_bills.find_one({"bill_id": bill_id}, {"status": 1})
        if curr and curr.get("status") == "cancelled":
            return
        await db.energy_bills.update_one({"bill_id": bill_id}, {"$set": {"status": "analyzing"}})
        text = _extract_pdf_text(bill["pdf_base64"])
        if not text or len(text.strip()) < 20:
            # respect cancellation
            curr = await db.energy_bills.find_one({"bill_id": bill_id}, {"status": 1})
            if not (curr and curr.get("status") == "cancelled"):
                await db.energy_bills.update_one({"bill_id": bill_id}, {"$set": {
                    "status": "error",
                    "error_message": "PDF vuoto o non leggibile (potrebbe essere scansione senza OCR).",
                    "analyzed_at": utcnow(),
                }})
            return
        # Check again before hitting the LLM (which is expensive)
        curr = await db.energy_bills.find_one({"bill_id": bill_id}, {"status": 1})
        if curr and curr.get("status") == "cancelled":
            return
        extracted = await _llm_analyze_bill_text(
            bill["bill_type"], text, analysis_params=bill.get("analysis_params"), tenant=bill.get("user_id")
        )
        # Final check: if cancelled during LLM, don't overwrite
        curr = await db.energy_bills.find_one({"bill_id": bill_id}, {"status": 1})
        if curr and curr.get("status") == "cancelled":
            return
        await db.energy_bills.update_one({"bill_id": bill_id}, {"$set": {
            "status": "done",
            "extracted": extracted,
            "raw_text_preview": text[:800],
            "analyzed_at": utcnow(),
            "error_message": None,
        }})
    except Exception as e:
        logger.exception(f"bill analysis failed for {bill_id}: {e}")
        curr = await db.energy_bills.find_one({"bill_id": bill_id}, {"status": 1})
        if not (curr and curr.get("status") == "cancelled"):
            await db.energy_bills.update_one({"bill_id": bill_id}, {"$set": {
                "status": "error",
                "error_message": str(e)[:400],
                "analyzed_at": utcnow(),
            }})


async def _ensure_contact_owned(contact_id: str, user: dict) -> dict:
    c = await db.contacts.find_one(tenant_scope(user, {"contact_id": contact_id}))
    if not c:
        raise HTTPException(status_code=404, detail="Contatto non trovato")
    # Also apply visibility filter
    vis = await contact_visibility_filter(user)
    if vis:
        # cheap re-check
        recheck = await db.contacts.find_one({**tenant_scope(user, {"contact_id": contact_id}), **vis})
        if not recheck:
            raise HTTPException(status_code=403, detail="Non autorizzato su questo contatto")
    return c


@api_router.post("/contacts/{contact_id}/bills")
async def create_bill(contact_id: str, body: EnergyBillIn, background: BackgroundTasks, user=Depends(get_current_user)):
    if body.bill_type not in BILL_TYPES:
        raise HTTPException(status_code=400, detail=f"bill_type non valido: usa {BILL_TYPES}")
    await _ensure_contact_owned(contact_id, user)
    # rough size check to avoid huge PDFs
    b64 = body.pdf_base64
    if b64.startswith("data:"):
        b64 = b64.split(",", 1)[1]
    approx_size = int(len(b64) * 0.75)
    if approx_size > 12 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="PDF troppo grande (max ~12 MB)")
    bill_id = f"bill_{uuid.uuid4().hex[:12]}"
    doc = {
        "bill_id": bill_id,
        "contact_id": contact_id,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        "bill_type": body.bill_type,
        "pdf_base64": body.pdf_base64,
        "pdf_name": body.pdf_name or f"fattura-{body.bill_type}.pdf",
        "pdf_mime": body.pdf_mime or "application/pdf",
        "pdf_size": approx_size,
        "status": "pending",
        "extracted": None,
        "error_message": None,
        "analysis_params": body.analysis_params or None,
        "created_at": utcnow(),
        "analyzed_at": None,
    }
    await db.energy_bills.insert_one(doc)
    background.add_task(_analyze_bill_task, bill_id)
    strip_id(doc)
    # Do not return the huge base64 in the response
    doc.pop("pdf_base64", None)
    return doc


@api_router.get("/contacts/{contact_id}/bills")
async def list_bills(contact_id: str, user=Depends(get_current_user)):
    await _ensure_contact_owned(contact_id, user)
    items = await db.energy_bills.find(
        {"user_id": tenant_id(user), "contact_id": contact_id},
        {"_id": 0, "pdf_base64": 0},
    ).sort("created_at", -1).to_list(200)
    grouped: Dict[str, List[Dict[str, Any]]] = {"luce": [], "gas": [], "telco": []}
    for it in items:
        bt = it.get("bill_type") or "luce"
        grouped.setdefault(bt, []).append(it)
    return {"items": items, "grouped": grouped}


@api_router.get("/contacts/{contact_id}/bills/{bill_id}/pdf")
async def get_bill_pdf(contact_id: str, bill_id: str, user=Depends(get_current_user)):
    """Return the raw base64 PDF (for viewing/downloading)."""
    await _ensure_contact_owned(contact_id, user)
    b = await db.energy_bills.find_one(
        {"user_id": tenant_id(user), "contact_id": contact_id, "bill_id": bill_id},
        {"_id": 0},
    )
    if not b:
        raise HTTPException(status_code=404, detail="Fattura non trovata")
    return {"pdf_base64": b.get("pdf_base64"), "pdf_name": b.get("pdf_name"), "pdf_mime": b.get("pdf_mime")}


@api_router.delete("/contacts/{contact_id}/bills/{bill_id}")
async def delete_bill(contact_id: str, bill_id: str, user=Depends(get_current_user)):
    await _ensure_contact_owned(contact_id, user)
    r = await db.energy_bills.delete_one({"user_id": tenant_id(user), "contact_id": contact_id, "bill_id": bill_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Fattura non trovata")
    return {"ok": True}


@api_router.post("/contacts/{contact_id}/bills/{bill_id}/reanalyze")
async def reanalyze_bill(contact_id: str, bill_id: str, background: BackgroundTasks, user=Depends(get_current_user)):
    await _ensure_contact_owned(contact_id, user)
    b = await db.energy_bills.find_one({"user_id": tenant_id(user), "contact_id": contact_id, "bill_id": bill_id})
    if not b:
        raise HTTPException(status_code=404, detail="Fattura non trovata")
    await db.energy_bills.update_one({"bill_id": bill_id}, {"$set": {"status": "pending", "error_message": None}})
    background.add_task(_analyze_bill_task, bill_id)
    return {"ok": True, "status": "pending"}


@api_router.post("/contacts/{contact_id}/bills/{bill_id}/cancel")
async def cancel_bill_analysis(contact_id: str, bill_id: str, user=Depends(get_current_user)):
    """V38: Mark a bill analysis as cancelled. The background task will skip saving results.
    Only bills that are pending or analyzing can be cancelled."""
    await _ensure_contact_owned(contact_id, user)
    b = await db.energy_bills.find_one({"user_id": tenant_id(user), "contact_id": contact_id, "bill_id": bill_id})
    if not b:
        raise HTTPException(status_code=404, detail="Fattura non trovata")
    st = b.get("status")
    if st not in ("pending", "analyzing"):
        raise HTTPException(status_code=400, detail=f"Impossibile annullare: stato attuale '{st}'")
    await db.energy_bills.update_one({"bill_id": bill_id}, {"$set": {
        "status": "cancelled",
        "error_message": "Analisi annullata dall'utente",
        "analyzed_at": utcnow(),
    }})
    return {"ok": True, "status": "cancelled"}


BILL_REPORT_SYSTEM = """Sei un consulente energetico esperto italiano. Analizzi bollette LUCE, GAS e TELCO e produci consigli concreti in italiano.
Rispondi ESCLUSIVAMENTE con JSON valido (nessun markdown, nessuna intro):
{
  "riepilogo_generale": ["punto 1 di overview", "punto 2", "punto 3"],
  "punti_forza": ["...", "..."],
  "punti_debolezza": ["...", "..."],
  "suggerimenti_luce": ["..."],
  "suggerimenti_gas": ["..."],
  "suggerimenti_telco": ["..."],
  "risparmio_stimato_annuo_eur": 240,
  "priorita_azione": "alta" | "media" | "bassa"
}"""


async def _llm_bill_suggestions(summary_data: dict) -> dict:
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        return {"error": "EMERGENT_LLM_KEY non configurato"}
    chat = LlmChat(
        api_key=key,
        session_id=f"bill-report-{uuid.uuid4().hex[:8]}",
        system_message=BILL_REPORT_SYSTEM,
    ).with_model("anthropic", "claude-sonnet-5")
    import json as _json
    prompt = (
        "Ecco i dati estratti dalle fatture del cliente. Fornisci analisi e consigli come da schema:\n\n"
        + _json.dumps(summary_data, ensure_ascii=False, indent=2)[:15000]
    )
    try:
        resp = await chat.send_message(UserMessage(text=prompt))
    except Exception as e:
        return {"error": f"Errore LLM: {e}"}
    raw = (resp or "").strip()
    # V38Z — robust JSON parsing
    data = _parse_llm_json(raw, fallback_key="riepilogo_generale")
    return data


@api_router.get("/contacts/{contact_id}/bills/report")
async def bills_report(contact_id: str, user=Depends(get_current_user)):
    contact = await _ensure_contact_owned(contact_id, user)
    items = await db.energy_bills.find(
        {"user_id": tenant_id(user), "contact_id": contact_id, "status": "done"},
        {"_id": 0, "pdf_base64": 0, "raw_text_preview": 0},
    ).sort("created_at", -1).to_list(200)
    if not items:
        raise HTTPException(status_code=400, detail="Nessuna fattura analizzata disponibile")
    # Group extracted data per type
    grouped: Dict[str, List[Dict[str, Any]]] = {"luce": [], "gas": [], "telco": []}
    for it in items:
        bt = it.get("bill_type") or "luce"
        grouped.setdefault(bt, []).append({
            "pdf_name": it.get("pdf_name"),
            "extracted": it.get("extracted") or {},
        })
    ai_suggestions = await _llm_bill_suggestions(grouped)
    return {
        "contact": {
            "contact_id": contact["contact_id"],
            "first_name": contact.get("first_name"),
            "last_name": contact.get("last_name"),
            "contact_code": contact.get("contact_code"),
            "phone": contact.get("phone"),
            "email": contact.get("email"),
        },
        "grouped": grouped,
        "ai_suggestions": ai_suggestions,
        "generated_at": utcnow(),
    }


# =========================
# v2.12 (Feb 2026) — CTE Comparativa (multi-bill upload + comparative report)
# Consultant uploads several PDFs at once for a client. Backend enqueues each
# as an energy_bill, background task analyses them, then a dedicated endpoint
# builds a comparative HTML report with SVG charts + AI verdict.
# =========================

class BulkBillItem(BaseModel):
    bill_type: str  # luce | gas | telco
    pdf_base64: str
    pdf_name: Optional[str] = None
    pdf_mime: Optional[str] = "application/pdf"


class BulkBillsIn(BaseModel):
    bills: List[BulkBillItem] = Field(default_factory=list)


@api_router.post("/contacts/{contact_id}/bills/bulk-upload")
async def bulk_upload_bills(contact_id: str, body: BulkBillsIn, background: BackgroundTasks, user=Depends(get_current_user)):
    """v2.12 — Upload N bills for a contact in a single request. Each bill
    is created as pending and analysed asynchronously (mirrors create_bill)."""
    await _ensure_contact_owned(contact_id, user)
    if not body.bills:
        raise HTTPException(status_code=400, detail="Nessuna fattura fornita")
    if len(body.bills) > 20:
        raise HTTPException(status_code=400, detail="Massimo 20 fatture per volta")
    created: List[dict] = []
    for item in body.bills:
        if item.bill_type not in BILL_TYPES:
            continue
        b64 = item.pdf_base64
        if b64.startswith("data:"):
            b64 = b64.split(",", 1)[1]
        approx_size = int(len(b64) * 0.75)
        if approx_size > 12 * 1024 * 1024:
            continue  # skip oversized silently — user gets a partial success
        bill_id = f"bill_{uuid.uuid4().hex[:12]}"
        doc = {
            "bill_id": bill_id,
            "contact_id": contact_id,
            "user_id": tenant_id(user),
            "created_by": user["user_id"],
            "bill_type": item.bill_type,
            "pdf_base64": item.pdf_base64,
            "pdf_name": item.pdf_name or f"fattura-{item.bill_type}.pdf",
            "pdf_mime": item.pdf_mime or "application/pdf",
            "pdf_size": approx_size,
            "status": "pending",
            "extracted": None,
            "error_message": None,
            "analysis_params": None,
            "created_at": utcnow(),
            "analyzed_at": None,
        }
        await db.energy_bills.insert_one(doc)
        background.add_task(_analyze_bill_task, bill_id)
        created.append({"bill_id": bill_id, "bill_type": item.bill_type, "pdf_name": doc["pdf_name"]})
    return {"ok": True, "created": created, "count": len(created)}


def _fmt_eur(n: Any) -> str:
    try:
        v = float(n)
        return f"€ {v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    except Exception:
        return "—"


def _num(x: Any) -> Optional[float]:
    if x is None:
        return None
    try:
        return float(x)
    except Exception:
        s = str(x).replace(".", "").replace(",", ".").strip()
        try:
            return float("".join(ch for ch in s if ch.isdigit() or ch in ".-"))
        except Exception:
            return None


def _build_cte_report_html(contact: dict, bills: List[dict], ai_verdict: dict, branding: dict) -> str:
    """v2.12 — Build a comparative HTML report with SVG charts.
    - Trend spesa nel tempo (bar per bill sorted by created_at)
    - Confronto fornitori per bill_type (table)
    - AI verdict per bill_type
    """
    def esc(s):
        return (str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))

    section_meta = {
        "luce": ("Luce", "#F59E0B", "💡"),
        "gas": ("Gas", "#DC2626", "🔥"),
        "telco": ("Telco", "#0891B2", "📞"),
    }

    # Enrich bills with numeric spend + consumption
    enriched: List[dict] = []
    for b in bills:
        ex = b.get("extracted") or {}
        totale = _num(ex.get("importo_totale") or ex.get("importo_totale_eur"))
        consumo = _num(ex.get("consumo_annuo") or ex.get("consumo_annuo_smc") or ex.get("consumo_totale_12_mesi"))
        fornitore = str(ex.get("fornitore") or "—").strip() or "—"
        enriched.append({
            **b,
            "fornitore": fornitore,
            "totale": totale,
            "consumo": consumo,
            "when": b.get("created_at"),
        })

    # SVG bar chart: spesa nel tempo (max 20 bars)
    def spend_chart():
        items = [x for x in enriched if x["totale"] is not None]
        items = sorted(items, key=lambda x: str(x.get("when") or ""))[-20:]
        if not items:
            return ""
        W, H, PL, PR, PT, PB = 700, 220, 46, 12, 20, 60
        chart_w = W - PL - PR
        chart_h = H - PT - PB
        max_v = max((x["totale"] for x in items), default=0) or 1
        bar_w = max(6, (chart_w / len(items)) - 6)
        y_ticks = [0, 0.25, 0.5, 0.75, 1]
        grid = "".join(
            f'<line x1="{PL}" y1="{PT + chart_h - chart_h*t}" x2="{W-PR}" y2="{PT + chart_h - chart_h*t}" stroke="#E5E7EB" stroke-width="1"/>'
            f'<text x="{PL-4}" y="{PT + chart_h - chart_h*t + 3}" font-size="9" fill="#6B7280" text-anchor="end">{int(max_v*t)}</text>'
            for t in y_ticks
        )
        bars = ""
        for i, x in enumerate(items):
            v = x["totale"]
            h = (v / max_v) * chart_h
            bx = PL + i * (bar_w + 6)
            by = PT + chart_h - h
            color = section_meta.get(x.get("bill_type", ""), ("", "#6366F1", ""))[1]
            label_short = (x.get("fornitore") or "—")[:10]
            when = ""
            try:
                when = (x.get("when") or "").strftime("%m/%y") if hasattr(x.get("when"), "strftime") else str(x.get("when"))[:7]
            except Exception:
                when = str(x.get("when"))[:7]
            bars += (
                f'<rect x="{bx:.1f}" y="{by:.1f}" width="{bar_w:.1f}" height="{h:.1f}" fill="{color}" rx="3"/>'
                f'<text x="{bx + bar_w/2:.1f}" y="{by-3:.1f}" font-size="8" fill="#374151" text-anchor="middle">€{int(v)}</text>'
                f'<text x="{bx + bar_w/2:.1f}" y="{H - PB + 12}" font-size="8" fill="#6B7280" text-anchor="middle">{esc(label_short)}</text>'
                f'<text x="{bx + bar_w/2:.1f}" y="{H - PB + 24}" font-size="8" fill="#94A3B8" text-anchor="middle">{esc(when)}</text>'
            )
        return f'<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 {W} {H}">{grid}{bars}</svg>'

    # Supplier comparison table per bill_type
    supplier_tables = ""
    for bt, (lbl, color, emoji) in section_meta.items():
        rows_bt = [x for x in enriched if x.get("bill_type") == bt]
        if not rows_bt:
            continue
        # Group by supplier
        by_sup: Dict[str, dict] = {}
        for r in rows_bt:
            sup = r["fornitore"] or "—"
            agg = by_sup.setdefault(sup, {"count": 0, "totali": [], "consumi": []})
            agg["count"] += 1
            if r["totale"] is not None:
                agg["totali"].append(r["totale"])
            if r["consumo"] is not None:
                agg["consumi"].append(r["consumo"])
        rows_html = ""
        best_sup = None
        best_spesa = None
        for sup, agg in by_sup.items():
            avg = sum(agg["totali"]) / len(agg["totali"]) if agg["totali"] else None
            if avg is not None and (best_spesa is None or avg < best_spesa):
                best_spesa = avg
                best_sup = sup
        for sup, agg in by_sup.items():
            avg = sum(agg["totali"]) / len(agg["totali"]) if agg["totali"] else None
            cons_avg = sum(agg["consumi"]) / len(agg["consumi"]) if agg["consumi"] else None
            is_best = sup == best_sup and len(by_sup) > 1
            badge = ' <span style="background:#DCFCE7;color:#166534;padding:2px 6px;border-radius:6px;font-size:10px;font-weight:800;margin-left:6px;">più conveniente</span>' if is_best else ""
            rows_html += (
                f'<tr><td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;font-weight:700;color:#0F172A;font-size:12px;">{esc(sup)}{badge}</td>'
                f'<td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;font-size:12px;">{agg["count"]}</td>'
                f'<td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;font-size:12px;">{_fmt_eur(avg) if avg is not None else "—"}</td>'
                f'<td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;font-size:12px;">{("%.0f" % cons_avg) if cons_avg is not None else "—"}</td>'
                '</tr>'
            )
        supplier_tables += (
            f'<h3 style="color:{color};font-size:16px;margin:22px 0 8px;">{emoji} {lbl} — {len(rows_bt)} fatture</h3>'
            f'<table style="width:100%;border-collapse:collapse;background:#FFF;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);">'
            f'<thead><tr style="background:#F8FAFC;"><th style="text-align:left;padding:8px 10px;font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:.4px;">Fornitore</th>'
            f'<th style="text-align:left;padding:8px 10px;font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:.4px;">Fatture</th>'
            f'<th style="text-align:left;padding:8px 10px;font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:.4px;">Spesa media</th>'
            f'<th style="text-align:left;padding:8px 10px;font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:.4px;">Consumo medio</th></tr></thead>'
            f'<tbody>{rows_html}</tbody></table>'
        )

    # AI verdict per bill_type
    verdict_blocks = ""
    for bt, (lbl, color, emoji) in section_meta.items():
        v = (ai_verdict or {}).get(bt)
        if not v:
            continue
        verdict_blocks += (
            f'<div style="background:{color}18;border-left:4px solid {color};padding:12px 14px;border-radius:8px;margin-top:10px;">'
            f'<div style="font-weight:800;color:{color};font-size:13px;margin-bottom:4px;">{emoji} {lbl}</div>'
            f'<div style="font-size:12px;color:#0F172A;line-height:1.5;">{esc(v)}</div></div>'
        )
    verdict_html = f'<h2 style="font-size:18px;color:#1E3A5F;margin-top:26px;">Suggerimento AI — Fornitore più conveniente</h2>{verdict_blocks}' if verdict_blocks else ""

    contact_name = f"{contact.get('first_name','')} {contact.get('last_name','')}".strip() or "Cliente"
    agency = esc(branding.get("agency_name") or "")
    logo_b64 = branding.get("logo_base64") or ""
    logo_html = f'<img src="data:image/png;base64,{logo_b64}" style="height:48px;object-fit:contain;"/>' if logo_b64 else ""
    generated_at = utcnow().strftime("%d/%m/%Y ore %H:%M")

    html = f"""<!doctype html>
<html lang="it"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>CTE Comparativa — {esc(contact_name)}</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0F172A; margin: 0; padding: 0; background: #F8FAFC; }}
  .wrap {{ max-width: 900px; margin: 0 auto; padding: 22px 20px 48px; background: #FFF; }}
  header {{ display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #1E3A5F; padding-bottom: 12px; margin-bottom: 18px; }}
  header h1 {{ font-size: 22px; margin: 0; color: #1E3A5F; }}
  header .sub {{ font-size: 12px; color: #64748B; margin-top: 2px; }}
  .chart-card {{ background: #FFF; border-radius: 12px; padding: 16px; box-shadow: 0 2px 6px rgba(0,0,0,0.06); margin-top: 16px; }}
  h2 {{ font-size: 18px; color: #1E3A5F; margin: 26px 0 10px; }}
  .kpi-row {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 12px 0; }}
  .kpi {{ background: #EEF2FF; border-radius: 10px; padding: 12px; text-align: center; }}
  .kpi .n {{ font-size: 22px; font-weight: 800; color: #1E3A5F; }}
  .kpi .l {{ font-size: 10px; color: #64748B; text-transform: uppercase; letter-spacing: .4px; margin-top: 2px; }}
</style></head><body>
<div class="wrap">
  <header>
    {logo_html}
    <div>
      <h1>CTE Comparativa</h1>
      <div class="sub">Cliente: <strong>{esc(contact_name)}</strong> · Generato il {generated_at}{(' · ' + agency) if agency else ''}</div>
    </div>
  </header>

  <div class="kpi-row">
    <div class="kpi"><div class="n">{len(bills)}</div><div class="l">Fatture analizzate</div></div>
    <div class="kpi"><div class="n">{len({x['fornitore'] for x in enriched if x['fornitore'] != '—'})}</div><div class="l">Fornitori diversi</div></div>
    <div class="kpi"><div class="n">{_fmt_eur(sum(x['totale'] or 0 for x in enriched))}</div><div class="l">Spesa totale</div></div>
  </div>

  <h2>Andamento spesa nel tempo</h2>
  <div class="chart-card">{spend_chart() or '<div style="color:#94A3B8;font-style:italic;text-align:center;padding:22px;">Nessun dato importo disponibile.</div>'}</div>

  <h2>Confronto fornitori</h2>
  {supplier_tables or '<div style="color:#94A3B8;font-style:italic;">Nessun dato per il confronto.</div>'}

  {verdict_html}
</div></body></html>"""
    return html


async def _llm_cte_verdict(bills: List[dict]) -> dict:
    """Ask Claude to pick the most convenient supplier per bill_type based on
    analysed data. Returns {luce: str, gas: str, telco: str} — one sentence each."""
    if not bills:
        return {}
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception:
        return {}
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        return {}
    # Compact bill summary
    summary = []
    for b in bills:
        ex = b.get("extracted") or {}
        summary.append({
            "bill_type": b.get("bill_type"),
            "fornitore": ex.get("fornitore"),
            "importo_totale": ex.get("importo_totale"),
            "consumo": ex.get("consumo_annuo") or ex.get("consumo_annuo_smc"),
            "prezzo_energia": ex.get("prezzo_energia") or ex.get("prezzo_gas"),
            "spread": ex.get("spread"),
            "costi_fissi": ex.get("costi_fissi"),
            "durata_contratto": ex.get("durata_contratto"),
            "penale_disdetta": ex.get("penale_disdetta"),
        })
    import json as _j
    system = (
        "Sei un consulente energetico italiano. Analizza le fatture fornite e per ciascun tipo "
        "(luce/gas/telco) SCRIVI UNA SOLA FRASE in italiano che indichi il fornitore più conveniente "
        "e il perché (es. costo minore, spread inferiore, penale disdetta ridotta). Se il tipo ha una "
        "sola fattura, indica solo il fornitore attuale e le sue caratteristiche. Restituisci JSON: "
        "{\"luce\": \"...\", \"gas\": \"...\", \"telco\": \"...\"}. Ometti chiavi senza dati."
    )
    prompt = f"Fatture analizzate:\n{_j.dumps(summary, ensure_ascii=False, default=str)}\n\nRispondi con il JSON."
    chat = LlmChat(api_key=key, session_id=f"cte-{uuid.uuid4().hex[:6]}", system_message=system).with_model("anthropic", "claude-sonnet-4-5-20250929")
    try:
        raw = await chat.send_message(UserMessage(text=prompt))
    except Exception as e:
        logger.warning("CTE LLM err: %s", e)
        return {}
    data = _parse_llm_json(raw or "", fallback_key="luce")
    data.pop("parse_error", None); data.pop("error_message", None); data.pop("parse_error_kind", None)
    return {k: v for k, v in data.items() if k in ("luce", "gas", "telco") and isinstance(v, str)}


@api_router.get("/contacts/{contact_id}/bills/cte-report")
async def cte_comparative_report(contact_id: str, user=Depends(get_current_user)):
    """v2.12 — Generate a comparative HTML report ("CTE") across all analysed
    bills of a contact. Returns {name, mime, data_base64} ready for FileViewer."""
    contact = await _ensure_contact_owned(contact_id, user)
    bills = await db.energy_bills.find(
        {"user_id": tenant_id(user), "contact_id": contact_id, "status": "done"},
        {"_id": 0, "pdf_base64": 0, "raw_text_preview": 0},
    ).sort("created_at", 1).to_list(200)
    if not bills:
        raise HTTPException(status_code=400, detail="Nessuna fattura analizzata disponibile. Carica e attendi l'analisi di almeno una fattura.")
    # Branding
    u = await db.users.find_one({"user_id": tenant_id(user)}, {"_id": 0, "name": 1, "company_name": 1, "company_logo_base64": 1}) or {}
    branding = {
        "agency_name": (u.get("company_name") or u.get("name") or "").strip(),
        "logo_base64": (u.get("company_logo_base64") or "").strip(),
    }
    verdict = await _llm_cte_verdict(bills)
    html = _build_cte_report_html(contact, bills, verdict, branding)
    import base64 as _b64
    name = f"CTE-Comparativa-{(contact.get('last_name') or contact.get('first_name') or 'cliente')}.html"
    return {
        "name": name,
        "mime": "text/html",
        "data_base64": _b64.b64encode(html.encode("utf-8")).decode("ascii"),
        "bills_count": len(bills),
        "verdict": verdict,
    }


# =========================
# Quick Bill Analysis (Drafts, V38N)
# Allow analyzing a bill PDF WITHOUT selecting a contact first. Useful for
# on-the-spot analysis at a customer meeting: upload PDF → AI extract → later
# associate to an existing contact or create a new one from extracted data.
# =========================

class QuickBillIn(BaseModel):
    bill_type: str  # luce | gas | telco
    pdf_base64: str
    pdf_name: Optional[str] = None
    pdf_mime: Optional[str] = "application/pdf"
    analysis_params: Optional[List[str]] = None
    label: Optional[str] = None  # optional user-friendly label (e.g. "Prospect via Roma")

async def _auto_save_draft_to_master_files(draft: dict):
    """V38Q — Persist a completed bill-draft into the Master's file cabinet.
    V38R (June 2026): Save TWO separate documents:
      - The RAW PDF in category='bills' (original fattura, same size as upload)
      - A generated HTML ANALISI report in category='analisi' (contains the
        extracted structured data + note_ai + consumption chart — much smaller
        than the PDF, distinctly rendered).
    V38W: fetch consultant profile for a professional header (logo + name).
    Both saves are idempotent: skip when a doc with the same name exists.
    """
    try:
        pdf_name = draft.get("pdf_name") or "fattura.pdf"
        base = pdf_name[:-4] if pdf_name.lower().endswith(".pdf") else pdf_name
        # 1) Save the raw PDF into 'bills' — original file, unchanged
        bill_name = f"{base}.pdf"
        exists_bill = await db.master_files.find_one({
            "user_id": draft.get("user_id"),
            "category": "bills",
            "name": bill_name,
        })
        if not exists_bill:
            b64 = draft.get("pdf_base64") or ""
            if b64.startswith("data:"):
                b64 = b64.split(",", 1)[1]
            approx_size = int(len(b64) * 0.75) if b64 else 0
            await db.master_files.insert_one({
                "file_id": f"mf_{uuid.uuid4().hex[:12]}",
                "user_id": draft.get("user_id"),
                "created_by": draft.get("created_by") or draft.get("user_id"),
                "category": "bills",
                "name": bill_name,
                "title": None,
                "body": None,
                "mime": draft.get("pdf_mime") or "application/pdf",
                "data_base64": b64,
                "size": approx_size,
                "created_at": utcnow(),
                "updated_at": utcnow(),
                "source": "bill-draft",
                "source_draft_id": draft.get("draft_id"),
            })
        # 2) Build & save the ANALISI HTML in 'analisi' — human-readable
        analysis_name = f"Analisi-{base}.html"
        exists_ana = await db.master_files.find_one({
            "user_id": draft.get("user_id"),
            "category": "analisi",
            "name": analysis_name,
        })
        if not exists_ana:
            extracted = draft.get("extracted") or {}
            bill_type = (draft.get("bill_type") or "luce").lower()
            # V38W — Plain-text labels (no emoji: cleaner + no charset artifacts)
            label_map = {"luce": ("Luce", "#EA580C"), "gas": ("Gas", "#F59E0B"), "telco": ("Telefono/Internet", "#0891B2")}
            bt_label, bt_color = label_map.get(bill_type, ("Fattura", "#6366F1"))
            # V38W — Fetch consultant profile for professional header + Note author
            user_doc = await db.users.find_one({"user_id": draft.get("user_id")}, {
                "_id": 0, "name": 1, "company_name": 1, "company_logo_base64": 1,
                "report_slogan": 1, "report_contacts": 1,
            }) or {}
            html = _build_analysis_html(
                extracted, bt_label, bt_color, base,
                draft.get("analysis_params") or [],
                user_doc,
            )
            html_b64 = base64.b64encode(html.encode("utf-8")).decode("ascii")
            await db.master_files.insert_one({
                "file_id": f"mf_{uuid.uuid4().hex[:12]}",
                "user_id": draft.get("user_id"),
                "created_by": draft.get("created_by") or draft.get("user_id"),
                "category": "analisi",
                "name": analysis_name,
                "title": f"Analisi {bt_label}",
                "body": None,
                "mime": "text/html",
                "data_base64": html_b64,
                "size": len(html.encode("utf-8")),
                "created_at": utcnow(),
                "updated_at": utcnow(),
                "source": "bill-draft",
                "source_draft_id": draft.get("draft_id"),
                "bill_type": bill_type,
            })
    except Exception as e:
        logger.warning("_auto_save_draft_to_master_files err: %s", e)


def _consultant_display(user_doc: dict) -> str:
    """V38W — Prefer user.name, else company_name, else initials."""
    name = (user_doc or {}).get("name") or ""
    if name.strip():
        return name.strip()
    comp = (user_doc or {}).get("company_name") or ""
    if comp.strip():
        return comp.strip()
    return "Consulente"


def _format_fiscal_check_html(fc: dict) -> str:
    """V38W — Render fiscal_check dict as human-readable rows (never JSON)."""
    if not fc or not isinstance(fc, dict):
        return ""
    from html import escape as esc
    rows = []
    def _num(v, digits=2):
        try:
            return f"{float(v):,.{digits}f}".replace(",", "X").replace(".", ",").replace("X", ".")
        except Exception:
            return "—"
    def _row(label, entry, digits, unit=""):
        if not isinstance(entry, dict):
            return None
        ok = bool(entry.get("ok"))
        exp = entry.get("expected")
        act = entry.get("actual")
        delta = entry.get("delta_annual_eur")
        color = "#059669" if ok else "#DC2626"
        bg = "#ECFDF5" if ok else "#FEF2F2"
        border = "#A7F3D0" if ok else "#FCA5A5"
        if ok:
            text = f"{esc(label)} {_num(exp, digits)}{unit} OK"
        else:
            text = f"{esc(label)} errata — attesa {_num(exp, digits)}{unit}, trovata {_num(act, digits)}{unit}"
        delta_txt = ""
        if not ok and isinstance(delta, (int, float)) and delta:
            delta_txt = f"<span style='color:#DC2626;font-weight:700;'>· Extra 12 mesi: € {_num(delta, 0)}</span>"
        return f"<li style='padding:6px 10px;background:{bg};border:1px solid {border};border-radius:6px;margin-bottom:6px;color:{color};font-size:12px;'>{text} {delta_txt}</li>"
    if fc.get("iva"):
        r = _row("IVA", fc["iva"], 0, "%")
        if r: rows.append(r)
    if fc.get("accise_gas"):
        r = _row("Accise gas", fc["accise_gas"], 6, " €/Smc")
        if r: rows.append(r)
    if fc.get("pcv"):
        r = _row("PCV / Costi fissi", fc["pcv"], 2, " €/mese")
        if r: rows.append(r)
    if not rows:
        return ""
    return "<h3 style='color:#0F172A;font-size:14px;margin:16px 0 6px;'>Verifica agevolazioni fiscali</h3><ul style='padding:0;margin:0;list-style:none;'>" + "".join(rows) + "</ul>"


def _build_analysis_html(extracted: dict, bt_label: str, bt_color: str, doc_base: str, params: list, user_doc: dict = None) -> str:
    """Render a compact HTML analysis report from the extracted fields.
    Includes a monthly consumption SVG bar chart when present.
    V38W: professional header + fiscal_check rendering + note author personalization + emoji-free titles.
    V2.1 (bugfix): sanitizes AI-generated text to strip HTML tags that would otherwise
    leak into the rendered report as visible <br>/<p> text.
    """
    from html import escape as esc
    import re as _re_local

    def _sanitize_ai(text) -> str:
        """Strip HTML tags from AI text while preserving semantic line breaks.
        - <br> / <br/> → newline
        - </p>         → double newline (paragraph break)
        - <p ...>      → removed
        - <li ...>     → "• "
        - </li>        → newline
        - all other tags → removed
        - HTML entities (&nbsp; &amp; &lt; &gt; &quot; &#39;) → their literal form
        """
        if text is None:
            return ""
        s = str(text)
        # Preserve semantic breaks BEFORE stripping
        s = _re_local.sub(r"<\s*br\s*/?\s*>", "\n", s, flags=_re_local.IGNORECASE)
        s = _re_local.sub(r"</\s*p\s*>", "\n\n", s, flags=_re_local.IGNORECASE)
        s = _re_local.sub(r"<\s*p(?:\s[^>]*)?>", "", s, flags=_re_local.IGNORECASE)
        s = _re_local.sub(r"</\s*li\s*>", "\n", s, flags=_re_local.IGNORECASE)
        s = _re_local.sub(r"<\s*li(?:\s[^>]*)?>", "• ", s, flags=_re_local.IGNORECASE)
        # Strip anything else that looks like a tag
        s = _re_local.sub(r"<[^>]+>", "", s)
        # Decode common HTML entities so the plain text isn't littered with them
        s = (s.replace("&nbsp;", " ")
               .replace("&amp;", "&")
               .replace("&lt;", "<")
               .replace("&gt;", ">")
               .replace("&quot;", '"')
               .replace("&#39;", "'")
               .replace("&apos;", "'"))
        # Collapse >=3 blank lines to 2
        s = _re_local.sub(r"\n{3,}", "\n\n", s)
        return s.strip()

    user_doc = user_doc or {}
    generated = datetime.now(timezone.utc).astimezone().strftime("%d/%m/%Y %H:%M")
    fornitore = esc(_sanitize_ai(extracted.get("fornitore") or "—"))
    offerta = esc(_sanitize_ai(extracted.get("nome_offerta") or extracted.get("tipo_offerta") or "Offerta non specificata"))
    consultant = _consultant_display(user_doc)
    company = (user_doc.get("company_name") or "").strip()
    logo = (user_doc.get("company_logo_base64") or "").strip()
    slogan = (user_doc.get("report_slogan") or "").strip()
    contacts = (user_doc.get("report_contacts") or "").strip()

    # V38W — Professional header
    header_html = ""
    if consultant or logo or company:
        logo_html = f'<img src="{esc(logo)}" alt="Logo" style="max-height:56px;max-width:120px;object-fit:contain;"/>' if logo else ""
        agency_line = esc(company or consultant)
        role_line = esc(consultant) if company and consultant and company != consultant else ""
        header_html = f"""
        <div style="display:flex;align-items:center;gap:14px;padding:12px 0;border-bottom:2px solid {bt_color};margin-bottom:16px;">
          {logo_html}
          <div style="flex:1;">
            <div style="font-size:15px;font-weight:800;color:#1F2937;">{agency_line}</div>
            {f'<div style="font-size:12px;color:#475569;margin-top:2px;">{role_line}</div>' if role_line else ""}
            {f'<div style="font-size:11px;font-style:italic;color:#64748B;margin-top:3px;">{esc(slogan)}</div>' if slogan else ""}
            {f'<div style="font-size:10px;color:#94A3B8;margin-top:3px;">{esc(contacts)}</div>' if contacts else ""}
          </div>
        </div>
        """

    # SVG chart from consumi_mensili
    chart_html = ""
    for k in ("consumi_mensili_kwh", "consumi_mensili_smc"):
        v = extracted.get(k)
        if not v:
            continue
        unit = "kWh" if k.endswith("kwh") else "SMC"
        points = _normalize_monthly(v)
        if points:
            chart_html = _svg_bar_chart(points, unit, bt_color)
            break

    # Consulenza Corporate (was "Note AI" / "Note di {consultant}")
    notes_html = ""
    note_val = extracted.get("note_ai")
    if note_val:
        if isinstance(note_val, str):
            # V2.1 — sanitize AI text first (strip <br>/<p> etc.), then split
            sanitized = _sanitize_ai(note_val)
            items = [x.strip().lstrip("-•* ") for x in sanitized.splitlines() if x.strip()]
        elif isinstance(note_val, list):
            items = [_sanitize_ai(x) for x in note_val if _sanitize_ai(x)]
        else:
            items = []
        if items:
            note_title = "Consulenza Corporate"
            notes_html = f"<h3 style='color:#0F172A;font-size:14px;margin:16px 0 6px;'>{note_title}</h3><ul style='padding-left:20px;margin:0;color:#334155;font-size:12px;'>" + "".join(f"<li style='margin-bottom:4px;'>{esc(it)}</li>" for it in items) + "</ul>"

    # V38W — Fiscal check rendered as readable rows (never JSON)
    fiscal_html = _format_fiscal_check_html(extracted.get("fiscal_check") or {})

    # V38Z — Clear parse-error banner (never expose broken JSON to the user)
    parse_error_html = ""
    if extracted.get("parse_error"):
        msg = extracted.get("error_message") or (
            "L'analisi AI ha restituito una risposta non valida. "
            "Riprova più tardi o contatta il supporto se il problema persiste."
        )
        parse_error_html = (
            "<div style='background:#FEF2F2;border:1px solid #FCA5A5;border-radius:8px;"
            "padding:12px;margin:12px 0;color:#7F1D1D;font-size:12px;line-height:1.5;'>"
            "<div style='font-weight:800;color:#991B1B;margin-bottom:4px;'>&#9888; Analisi non riuscita</div>"
            f"{esc(str(msg))}</div>"
        )

    # Standard KV table — skip internal keys and fiscal_check
    rows = []
    for k, v in extracted.items():
        if v in (None, "", []):
            continue
        if k in ("consumi_mensili_kwh", "consumi_mensili_smc", "note_ai",
                 "parametri_richiesti", "raw_text_preview", "fiscal_check",
                 "parse_error", "parse_error_kind", "error_message"):
            continue
        if isinstance(v, dict) and "ok" in v and ("expected" in v or "actual" in v):
            # V38X — fiscal-check-shaped sub-entry rendered readable, never JSON
            ok = bool(v.get("ok"))
            def _fmt(n):
                try: return f"{float(n):,.6f}".rstrip("0").rstrip(".").replace(",", "X").replace(".", ",").replace("X", ".")
                except Exception: return "—"
            if ok:
                v_str = f"{_fmt(v.get('expected'))} OK"
            else:
                delta = v.get("delta_annual_eur")
                d_txt = f" · Extra 12 mesi: € {_fmt(delta)}" if isinstance(delta, (int, float)) and delta else ""
                v_str = f"errata — attesa {_fmt(v.get('expected'))}, trovata {_fmt(v.get('actual'))}{d_txt}"
        elif isinstance(v, (list, dict)):
            # V38X — Instead of raw JSON, flatten as "k: v · k: v"
            if isinstance(v, list) and all(not isinstance(x, (list, dict)) for x in v):
                v_str = ", ".join(_sanitize_ai(x) for x in v)
            elif isinstance(v, dict):
                v_str = " · ".join(f"{esc(str(kk).replace('_', ' ').title())}: {_sanitize_ai(vv)}" for kk, vv in v.items())
            else:
                v_str = f"{len(v)} elementi"
        else:
            # V2.1 — strip AI-generated HTML tags before rendering
            v_str = _sanitize_ai(v)
        label = k.replace("_", " ").title()
        rows.append(f"<tr><td style='padding:8px 10px;background:#F8FAFC;font-weight:700;color:#475569;font-size:11px;border-bottom:1px solid #E2E8F0;width:40%;'>{esc(label)}</td><td style='padding:8px 10px;color:#0F172A;font-size:12px;border-bottom:1px solid #E2E8F0;word-break:break-word;'>{esc(v_str)}</td></tr>")
    table_html = f"<table style='width:100%;border-collapse:collapse;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);margin-top:12px;'>{''.join(rows)}</table>" if rows else "<p style='color:#94A3B8;font-style:italic;'>Nessun dato estratto.</p>"

    # V38W — Filter internal `__verifica_*` markers before rendering user-visible pills
    params_html = ""
    if params:
        clean_params = [p for p in params if not (isinstance(p, str) and p.startswith("__verifica_"))]
        if clean_params:
            pills = "".join(f"<span style='display:inline-block;padding:3px 9px;border-radius:12px;background:#EDE9FE;color:#5B21B6;font-size:10px;font-weight:700;margin:2px;'>{esc(str(p))}</span>" for p in clean_params)
            params_html = f"<div style='margin:14px 0 6px;'><div style='font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6B7280;margin-bottom:6px;'>Parametri prioritari</div>{pills}</div>"

    return f"""<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Analisi Fattura {esc(bt_label)} - {esc(doc_base)}</title>
<style>
  body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0F172A;margin:16px;background:#F8FAFC;}}
  .banner{{background:linear-gradient(135deg,{bt_color},{bt_color}CC);color:#FFF;padding:14px 18px;border-radius:10px;margin-bottom:14px;}}
  .banner-title{{font-size:17px;font-weight:900;margin:0;}}
  .banner-sub{{font-size:11px;opacity:0.92;margin-top:3px;}}
  h1{{color:{bt_color};margin:0 0 4px;font-size:20px;}}
  .subtitle{{color:#6B7280;font-size:11px;margin-bottom:14px;}}
  .footer{{margin-top:22px;padding-top:12px;border-top:1px solid #E5E7EB;font-size:10px;color:#9CA3AF;text-align:center;}}
</style>
</head>
<body>
  {header_html}
  <h1>Analisi Fattura {esc(bt_label)}</h1>
  <div class="subtitle"><b>Documento:</b> {esc(doc_base)} &nbsp;·&nbsp; <b>Analizzata:</b> {esc(generated)}</div>
  <div class="banner">
    <div class="banner-title">{fornitore}</div>
    <div class="banner-sub">{offerta}</div>
  </div>
  {params_html}
  {parse_error_html}
  {fiscal_html}
  {table_html}
  {"<h3 style='color:#0F172A;font-size:14px;margin:16px 0 6px;'>Consumi mensili</h3>" + chart_html if chart_html else ""}
  {notes_html}
  <div class="footer">Report generato da {esc(consultant)} · Dal Pastro CRM</div>
</body>
</html>"""


def _normalize_monthly(v):
    """Return a list of {mese, value} tuples from various input shapes."""
    months = ["gen","feb","mar","apr","mag","giu","lug","ago","set","ott","nov","dic"]
    if isinstance(v, list):
        out = []
        for i, it in enumerate(v):
            if isinstance(it, (int, float)):
                out.append({"mese": months[i] if i < 12 else str(i+1), "value": float(it)})
            elif isinstance(it, dict):
                mese = str(it.get("mese") or it.get("month") or (months[i] if i < 12 else str(i+1)))[:3].lower()
                val = it.get("kwh") or it.get("smc") or it.get("value") or it.get("consumo") or 0
                try:
                    out.append({"mese": mese, "value": float(val)})
                except Exception:
                    pass
        return out
    if isinstance(v, dict):
        out = []
        for k, val in v.items():
            lk = k.lower()[:3]
            if lk in months:
                try:
                    out.append({"mese": lk, "value": float(val)})
                except Exception:
                    pass
        # sort by month order
        out.sort(key=lambda x: months.index(x["mese"]) if x["mese"] in months else 99)
        return out
    return []


def _svg_bar_chart(points: list, unit: str, color: str) -> str:
    """Return an inline SVG bar chart for the given monthly consumption points."""
    if not points:
        return ""
    width = 520
    height = 220
    padL, padR, padT, padB = 42, 12, 16, 40
    chart_w = width - padL - padR
    chart_h = height - padT - padB
    max_v = max([p["value"] for p in points] + [1])
    bar_gap = 6
    bar_w = (chart_w / len(points)) - bar_gap
    y_ticks = [0, 0.25, 0.5, 0.75, 1.0]
    grid = "".join(
        f'<line x1="{padL}" y1="{padT + chart_h - chart_h*t}" x2="{width-padR}" y2="{padT + chart_h - chart_h*t}" stroke="#E5E7EB" stroke-width="1"/>'
        f'<text x="{padL-6}" y="{padT + chart_h - chart_h*t + 3}" font-size="9" fill="#6B7280" text-anchor="end">{int(max_v*t)}</text>'
        for t in y_ticks
    )
    bars = []
    for i, p in enumerate(points):
        h = (p["value"] / max_v) * chart_h if max_v > 0 else 0
        x = padL + i * (bar_w + bar_gap)
        y = padT + chart_h - h
        label = p.get("mese", "").capitalize()
        val_txt = str(int(p["value"])) if p["value"] > 0 else ""
        bars.append(
            f'<rect x="{x:.1f}" y="{y:.1f}" width="{bar_w:.1f}" height="{h:.1f}" fill="{color}" rx="3"/>'
            f'<text x="{x + bar_w/2:.1f}" y="{y - 3:.1f}" font-size="9" fill="#374151" text-anchor="middle">{val_txt}</text>'
            f'<text x="{x + bar_w/2:.1f}" y="{height - padB + 14}" font-size="10" fill="#4B5563" text-anchor="middle">{label}</text>'
        )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="{height}" '
        f'viewBox="0 0 {width} {height}" preserveAspectRatio="xMidYMid meet" '
        f'style="max-width:100%;background:#FFF;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">'
        f'{grid}{"".join(bars)}'
        f'<text x="{width - padR}" y="{height - 4}" font-size="9" fill="#6B7280" text-anchor="end">Unità: {unit}</text>'
        f'</svg>'
    )




async def _analyze_draft_task(draft_id: str):
    """Background analysis task for bill drafts (mirrors _analyze_bill_task)."""
    draft = await db.bill_drafts.find_one({"draft_id": draft_id})
    if not draft:
        return
    try:
        curr = await db.bill_drafts.find_one({"draft_id": draft_id}, {"status": 1})
        if curr and curr.get("status") == "cancelled":
            return
        await db.bill_drafts.update_one({"draft_id": draft_id}, {"$set": {"status": "analyzing"}})
        text = _extract_pdf_text(draft["pdf_base64"])
        if not text or len(text.strip()) < 30:
            curr = await db.bill_drafts.find_one({"draft_id": draft_id}, {"status": 1})
            if curr and curr.get("status") != "cancelled":
                await db.bill_drafts.update_one({"draft_id": draft_id}, {"$set": {
                    "status": "error",
                    "error_message": "PDF vuoto o non leggibile (potrebbe essere scansione senza OCR).",
                    "analyzed_at": utcnow(),
                }})
            return
        curr = await db.bill_drafts.find_one({"draft_id": draft_id}, {"status": 1})
        if curr and curr.get("status") == "cancelled":
            return
        extracted = await _llm_analyze_bill_text(
            draft.get("bill_type") or "luce", text, draft.get("analysis_params") or None, tenant=draft.get("user_id")
        )
        curr = await db.bill_drafts.find_one({"draft_id": draft_id}, {"status": 1})
        if curr and curr.get("status") == "cancelled":
            return
        await db.bill_drafts.update_one({"draft_id": draft_id}, {"$set": {
            "status": "done",
            "extracted": extracted,
            "error_message": None,
            "analyzed_at": utcnow(),
        }})
        # V38Q — auto-save the analyzed bill PDF into the Master's file
        # cabinet (category=bills), unless a copy is already there.
        try:
            fresh = await db.bill_drafts.find_one({"draft_id": draft_id})
            if fresh:
                await _auto_save_draft_to_master_files(fresh)
        except Exception as e:
            logger.warning("draft auto-save to master-files failed: %s", e)
    except Exception as e:
        logger.exception("draft analysis err %s", e)
        curr = await db.bill_drafts.find_one({"draft_id": draft_id}, {"status": 1})
        if curr and curr.get("status") != "cancelled":
            await db.bill_drafts.update_one({"draft_id": draft_id}, {"$set": {
                "status": "error",
                "error_message": str(e)[:500],
                "analyzed_at": utcnow(),
            }})


@api_router.post("/bill-drafts")
async def create_bill_draft(body: QuickBillIn, background: BackgroundTasks, user=Depends(get_current_user)):
    if body.bill_type not in BILL_TYPES:
        raise HTTPException(status_code=400, detail=f"bill_type non valido: usa {BILL_TYPES}")
    b64 = body.pdf_base64
    if b64.startswith("data:"):
        b64 = b64.split(",", 1)[1]
    approx_size = int(len(b64) * 0.75)
    if approx_size > 12 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="PDF troppo grande (max ~12 MB)")
    draft_id = f"bdft_{uuid.uuid4().hex[:12]}"
    doc = {
        "draft_id": draft_id,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        "bill_type": body.bill_type,
        "pdf_base64": body.pdf_base64,
        "pdf_name": body.pdf_name or f"fattura-{body.bill_type}.pdf",
        "pdf_mime": body.pdf_mime or "application/pdf",
        "pdf_size": approx_size,
        "label": (body.label or "").strip() or None,
        "status": "pending",
        "extracted": None,
        "error_message": None,
        "analysis_params": body.analysis_params or None,
        "contact_id": None,
        "created_at": utcnow(),
        "analyzed_at": None,
    }
    await db.bill_drafts.insert_one(doc)
    background.add_task(_analyze_draft_task, draft_id)
    strip_id(doc)
    doc.pop("pdf_base64", None)
    return doc


@api_router.get("/bill-drafts")
async def list_bill_drafts(user=Depends(get_current_user)):
    items = await db.bill_drafts.find(
        {"user_id": tenant_id(user), "contact_id": None},
        {"_id": 0, "pdf_base64": 0},
    ).sort("created_at", -1).to_list(200)
    return {"items": items}


@api_router.get("/bill-drafts/{draft_id}")
async def get_bill_draft(draft_id: str, user=Depends(get_current_user)):
    d = await db.bill_drafts.find_one(
        {"user_id": tenant_id(user), "draft_id": draft_id},
        {"_id": 0, "pdf_base64": 0},
    )
    if not d:
        raise HTTPException(status_code=404, detail="Bozza non trovata")
    return d


@api_router.get("/bill-drafts/{draft_id}/pdf")
async def get_bill_draft_pdf(draft_id: str, user=Depends(get_current_user)):
    d = await db.bill_drafts.find_one(
        {"user_id": tenant_id(user), "draft_id": draft_id},
        {"_id": 0},
    )
    if not d:
        raise HTTPException(status_code=404, detail="Bozza non trovata")
    return {"pdf_base64": d.get("pdf_base64"), "pdf_name": d.get("pdf_name"), "pdf_mime": d.get("pdf_mime")}


@api_router.delete("/bill-drafts/{draft_id}")
async def delete_bill_draft(draft_id: str, user=Depends(get_current_user)):
    r = await db.bill_drafts.delete_one({"user_id": tenant_id(user), "draft_id": draft_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Bozza non trovata")
    return {"ok": True}


@api_router.post("/bill-drafts/{draft_id}/reanalyze")
async def reanalyze_bill_draft(draft_id: str, background: BackgroundTasks, user=Depends(get_current_user)):
    d = await db.bill_drafts.find_one({"user_id": tenant_id(user), "draft_id": draft_id})
    if not d:
        raise HTTPException(status_code=404, detail="Bozza non trovata")
    await db.bill_drafts.update_one({"draft_id": draft_id}, {"$set": {"status": "pending", "error_message": None}})
    background.add_task(_analyze_draft_task, draft_id)
    return {"ok": True}


@api_router.post("/bill-drafts/{draft_id}/cancel")
async def cancel_bill_draft(draft_id: str, user=Depends(get_current_user)):
    """v2.8 — Cancel a running/pending draft analysis. Parity with the
    contact-side /contacts/{id}/bills/{bill_id}/cancel endpoint."""
    d = await db.bill_drafts.find_one({"user_id": tenant_id(user), "draft_id": draft_id}, {"_id": 0, "status": 1})
    if not d:
        raise HTTPException(status_code=404, detail="Bozza non trovata")
    st = d.get("status")
    if st not in ("pending", "analyzing"):
        raise HTTPException(status_code=400, detail=f"Impossibile annullare: stato attuale '{st}'")
    await db.bill_drafts.update_one({"draft_id": draft_id}, {"$set": {
        "status": "cancelled",
        "error_message": "Analisi annullata dall'utente",
        "analyzed_at": utcnow(),
    }})
    return {"ok": True, "status": "cancelled"}


class DraftAssociateIn(BaseModel):
    contact_id: str


async def _push_draft_files_to_contact(draft: dict, contact_id: str):
    """v2.7 (Feb 2026) — When a bill-draft is associated to a contact, mirror
    the RAW PDF and the ANALISI HTML into the contact's files section so they
    show up in the client card under "File". Idempotent (skip existing names).
    """
    try:
        pdf_name_src = draft.get("pdf_name") or "fattura.pdf"
        base = pdf_name_src[:-4] if pdf_name_src.lower().endswith(".pdf") else pdf_name_src
        # Fetch current file names to skip duplicates
        c = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0, "files": 1}) or {}
        existing_names = {(f or {}).get("name") for f in (c.get("files") or [])}
        new_files: List[dict] = []

        # 1) RAW PDF → contact.files
        pdf_name = f"{base}.pdf"
        if pdf_name not in existing_names:
            b64 = draft.get("pdf_base64") or ""
            if b64.startswith("data:"):
                b64 = b64.split(",", 1)[1]
            approx_size = draft.get("pdf_size") or int(len(b64) * 0.75) if b64 else 0
            new_files.append({
                "id": str(uuid.uuid4()),
                "name": pdf_name,
                "mime": draft.get("pdf_mime") or "application/pdf",
                "data_base64": b64,
                "size": approx_size,
                "created_at": utcnow(),
            })

        # 2) ANALISI HTML → contact.files (same render used for master_files)
        analysis_name = f"Analisi-{base}.html"
        if analysis_name not in existing_names:
            extracted = draft.get("extracted") or {}
            bill_type = (draft.get("bill_type") or "luce").lower()
            label_map = {"luce": ("Luce", "#EA580C"), "gas": ("Gas", "#F59E0B"), "telco": ("Telefono/Internet", "#0891B2")}
            bt_label, bt_color = label_map.get(bill_type, ("Fattura", "#6366F1"))
            user_doc = await db.users.find_one({"user_id": draft.get("user_id")}, {
                "_id": 0, "name": 1, "company_name": 1, "company_logo_base64": 1,
                "report_slogan": 1, "report_contacts": 1,
            }) or {}
            html = _build_analysis_html(
                extracted, bt_label, bt_color, base,
                draft.get("analysis_params") or [],
                user_doc,
            )
            html_b64 = base64.b64encode(html.encode("utf-8")).decode("ascii")
            new_files.append({
                "id": str(uuid.uuid4()),
                "name": analysis_name,
                "mime": "text/html",
                "data_base64": html_b64,
                "size": len(html.encode("utf-8")),
                "created_at": utcnow(),
            })

        if new_files:
            await db.contacts.update_one(
                {"contact_id": contact_id},
                {"$push": {"files": {"$each": new_files}}, "$set": {"updated_at": utcnow()}},
            )
    except Exception as e:
        logger.warning("_push_draft_files_to_contact err: %s", e)


@api_router.post("/bill-drafts/{draft_id}/associate")
async def associate_bill_draft(draft_id: str, body: DraftAssociateIn, user=Depends(get_current_user)):
    """Move a draft's PDF + extracted data into the target contact's energy_bills
    then delete the draft. Returns the newly-created bill_id."""
    d = await db.bill_drafts.find_one({"user_id": tenant_id(user), "draft_id": draft_id})
    if not d:
        raise HTTPException(status_code=404, detail="Bozza non trovata")
    await _ensure_contact_owned(body.contact_id, user)
    bill_id = f"bill_{uuid.uuid4().hex[:12]}"
    bill_doc = {
        "bill_id": bill_id,
        "contact_id": body.contact_id,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        "bill_type": d.get("bill_type") or "luce",
        "pdf_base64": d.get("pdf_base64"),
        "pdf_name": d.get("pdf_name"),
        "pdf_mime": d.get("pdf_mime"),
        "pdf_size": d.get("pdf_size"),
        "status": d.get("status") or "done",
        "extracted": d.get("extracted"),
        "error_message": d.get("error_message"),
        "analysis_params": d.get("analysis_params"),
        "created_at": d.get("created_at") or utcnow(),
        "analyzed_at": d.get("analyzed_at"),
    }
    await db.energy_bills.insert_one(bill_doc)
    # v2.7 — also mirror PDF + Analisi HTML into contact.files
    await _push_draft_files_to_contact(d, body.contact_id)
    await db.bill_drafts.delete_one({"draft_id": draft_id})
    strip_id(bill_doc)
    bill_doc.pop("pdf_base64", None)
    return {"ok": True, "bill_id": bill_id, "contact_id": body.contact_id, "bill": bill_doc}


@api_router.post("/bill-drafts/{draft_id}/create-contact")
async def create_contact_from_draft(draft_id: str, user=Depends(get_current_user)):
    """Create a new contact from the extracted bill data, then associate the
    draft's bill to it. Returns {contact_id, bill_id}."""
    d = await db.bill_drafts.find_one({"user_id": tenant_id(user), "draft_id": draft_id})
    if not d:
        raise HTTPException(status_code=404, detail="Bozza non trovata")
    extracted = d.get("extracted") or {}
    if not extracted:
        raise HTTPException(status_code=400, detail="La bozza non ha ancora dati estratti. Attendi il completamento dell'analisi.")
    # Try to map common bill fields → contact fields
    holder = extracted.get("intestatario") or extracted.get("cliente") or extracted.get("holder") or ""
    holder = str(holder).strip()
    first_name = holder
    last_name = ""
    if holder and " " in holder:
        parts = holder.split()
        first_name = parts[0]
        last_name = " ".join(parts[1:])
    if not first_name:
        first_name = f"Bolletta {d.get('bill_type','luce').title()}"
    addr = extracted.get("indirizzo_fornitura") or extracted.get("indirizzo") or ""
    contact_id = f"c_{uuid.uuid4().hex[:12]}"
    contact_doc = {
        "contact_id": contact_id,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        "assigned_to_user_id": user["user_id"],
        "first_name": first_name,
        "last_name": last_name,
        "phone": str(extracted.get("telefono") or extracted.get("phone") or ""),
        "email": str(extracted.get("email") or ""),
        "address_street": str(addr) if isinstance(addr, str) else "",
        "fiscal_code": str(extracted.get("codice_fiscale") or ""),
        "vat_number": str(extracted.get("partita_iva") or ""),
        "area": "energy",
        "additional_areas": [],
        "source": "personal",
        "tags": ["da-bolletta"],
        "group_ids": [],
        "general_note": f"Cliente creato automaticamente dall'analisi di una bolletta {d.get('bill_type','luce')}.",
        "email_note": "",
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.contacts.insert_one(contact_doc)
    # Now associate the draft
    bill_id = f"bill_{uuid.uuid4().hex[:12]}"
    bill_doc = {
        "bill_id": bill_id,
        "contact_id": contact_id,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        "bill_type": d.get("bill_type") or "luce",
        "pdf_base64": d.get("pdf_base64"),
        "pdf_name": d.get("pdf_name"),
        "pdf_mime": d.get("pdf_mime"),
        "pdf_size": d.get("pdf_size"),
        "status": d.get("status") or "done",
        "extracted": d.get("extracted"),
        "error_message": d.get("error_message"),
        "analysis_params": d.get("analysis_params"),
        "created_at": d.get("created_at") or utcnow(),
        "analyzed_at": d.get("analyzed_at"),
    }
    await db.energy_bills.insert_one(bill_doc)
    # v2.7 — also mirror PDF + Analisi HTML into contact.files
    await _push_draft_files_to_contact(d, contact_id)
    await db.bill_drafts.delete_one({"draft_id": draft_id})
    return {"ok": True, "contact_id": contact_id, "bill_id": bill_id}


# =========================
# Master Files (V38O) — personal file cabinet for the Master (owner) that
# mirrors the client-side files section. Categories: notes, bills, audio, files.
# Files are stored inline (data_base64) — same pattern as ContactFile.
# =========================

class MasterFileIn(BaseModel):
    category: str  # notes | bills | audio | files
    name: str
    mime: str = "application/octet-stream"
    data_base64: str = ""            # for binary files (audio/bills/generic)
    body: Optional[str] = None       # for text notes — rich text markdown-ish
    title: Optional[str] = None      # for notes
    size: Optional[int] = None


class MasterFileRenameIn(BaseModel):
    name: Optional[str] = None
    title: Optional[str] = None
    body: Optional[str] = None


ALLOWED_MASTER_CATS = {"notes", "bills", "audio", "files", "analisi"}


@api_router.post("/master-files")
async def add_master_file(body: MasterFileIn, user=Depends(get_current_user)):
    if body.category not in ALLOWED_MASTER_CATS:
        raise HTTPException(status_code=400, detail=f"category deve essere: {sorted(ALLOWED_MASTER_CATS)}")
    file_id = f"mf_{uuid.uuid4().hex[:12]}"
    b64 = body.data_base64 or ""
    if b64.startswith("data:"):
        b64 = b64.split(",", 1)[1]
    est_size = int(len(b64) * 0.75) if b64 else 0
    if est_size > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File troppo grande (max ~20 MB)")
    doc = {
        "file_id": file_id,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        "category": body.category,
        "name": (body.name or "").strip() or (body.title or "senza titolo"),
        "title": (body.title or "").strip() or None,
        "body": body.body if body.category == "notes" else None,
        "mime": body.mime or "application/octet-stream",
        "data_base64": b64,
        "size": body.size if body.size is not None else est_size,
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.master_files.insert_one(doc)
    out = {k: v for k, v in doc.items() if k not in {"_id", "data_base64"}}
    return out


# =========================
# Master Business Card (V38Q)
# One document per user with the digital business-card configuration. QR
# content is user-defined: app-demo link / website / free text. Shared as
# image, link or QR code from the frontend.
# =========================

class BusinessCardIn(BaseModel):
    display_name: Optional[str] = None
    title: Optional[str] = None
    company_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    address: Optional[str] = None
    tagline: Optional[str] = None
    logo_base64: Optional[str] = None
    photo_base64: Optional[str] = None
    accent_color: Optional[str] = None
    qr_type: Optional[str] = None      # "app" | "website" | "text" | "vcard"
    qr_content: Optional[str] = None
    demo_app_link: Optional[str] = None
    social_links: Optional[Dict[str, str]] = None
    # V38V — Public page customization
    link_title: Optional[str] = Field(default=None, max_length=200)
    visual_effect: Optional[str] = None  # "none" | "shimmer" | "border"
    # V27 — Theme selection (orange/navy redesign)
    card_theme: Optional[str] = None  # "sunset" | "midnight" | "ivory" | "mono" | "gold" (default "sunset")
    show_photo: Optional[bool] = None  # V27 — whether to show the agent photo on the public link


@api_router.get("/master/business-card")
async def get_business_card(user=Depends(get_current_user)):
    d = await db.business_cards.find_one({"user_id": tenant_id(user)}, {"_id": 0})
    if not d:
        # Seed a lightweight default from the user profile
        return {
            "user_id": tenant_id(user),
            "display_name": user.get("name") or user.get("email") or "",
            "title": "",
            "company_name": user.get("company_name") or "",
            "phone": user.get("phone") or "",
            "email": user.get("email") or "",
            "website": "",
            "address": "",
            "tagline": "",
            "logo_base64": user.get("company_logo_base64") or "",
            "photo_base64": "",  # V27 — no auto-load; user must explicitly pick a photo
            "accent_color": "#6366F1",
            "qr_type": "website",
            "qr_content": "",
            "demo_app_link": "",
            "social_links": {},
            "created_at": None,
            "updated_at": None,
        }
    return d


@api_router.put("/master/business-card")
async def update_business_card(body: BusinessCardIn, user=Depends(get_current_user)):
    patch: Dict[str, Any] = {"updated_at": utcnow()}
    for field in [
        "display_name", "title", "company_name", "phone", "email", "website",
        "address", "tagline", "logo_base64", "photo_base64", "accent_color",
        "qr_type", "qr_content", "demo_app_link", "social_links",
        "link_title", "visual_effect",  # V38V
        "card_theme", "show_photo",  # V27
    ]:
        v = getattr(body, field, None)
        if v is not None:
            patch[field] = v
    if body.qr_type and body.qr_type not in {"app", "website", "text", "vcard"}:
        raise HTTPException(status_code=400, detail="qr_type deve essere: app | website | text | vcard")
    if body.visual_effect and body.visual_effect not in {"none", "shimmer", "border"}:
        raise HTTPException(status_code=400, detail="visual_effect deve essere: none | shimmer | border")
    if body.card_theme and body.card_theme not in {"sunset", "midnight", "ivory", "mono", "gold"}:
        raise HTTPException(status_code=400, detail="card_theme non valido")
    tid = tenant_id(user)
    existing = await db.business_cards.find_one({"user_id": tid})
    if not existing:
        patch["user_id"] = tid
        patch["created_at"] = utcnow()
        patch["card_id"] = f"bc_{uuid.uuid4().hex[:12]}"
        await db.business_cards.insert_one(patch)
    else:
        await db.business_cards.update_one({"user_id": tid}, {"$set": patch})
    out = await db.business_cards.find_one({"user_id": tid}, {"_id": 0})
    return out


class BusinessCardShareLinkIn(BaseModel):
    channel: Optional[str] = None  # optional analytics tag


def _build_vcard(d: dict) -> str:
    """V38V — Build a valid vCard 3.0 string from a business card doc."""
    lines = ["BEGIN:VCARD", "VERSION:3.0"]
    name = (d.get("display_name") or "").strip()
    if name:
        parts = name.split(" ", 1)
        surname = parts[1] if len(parts) > 1 else ""
        given = parts[0]
        lines.append(f"N:{surname};{given};;;")
        lines.append(f"FN:{name}")
    if d.get("company_name"):
        lines.append(f"ORG:{d['company_name']}")
    if d.get("title"):
        lines.append(f"TITLE:{d['title']}")
    if d.get("phone"):
        lines.append(f"TEL;TYPE=CELL:{d['phone']}")
    if d.get("email"):
        lines.append(f"EMAIL;TYPE=INTERNET:{d['email']}")
    if d.get("website"):
        lines.append(f"URL:{d['website']}")
    if d.get("address"):
        lines.append(f"ADR;TYPE=WORK:;;{d['address']};;;;")
    if d.get("tagline"):
        lines.append(f"NOTE:{d['tagline']}")
    lines.append("END:VCARD")
    return "\r\n".join(lines)


def _build_public_card_html(d: dict, card_id: str) -> str:
    """V27 — Server-side HTML page for the public /master/business-card/public/{card_id}
    endpoint. Redesigned with orange/navy palette, clean/minimal typography,
    optional agent photo, and 5 selectable themes (sunset · midnight · ivory ·
    mono · gold). Optional visual effect (shimmer / animated border) applied
    via pure CSS.
    """
    from html import escape as esc
    name = esc(d.get("display_name") or "Biglietto")
    title = esc(d.get("title") or "")
    company = esc(d.get("company_name") or "")
    phone = esc(d.get("phone") or "")
    email = esc(d.get("email") or "")
    website = (d.get("website") or "").strip()
    website_esc = esc(website)
    address = esc(d.get("address") or "")
    tagline = esc(d.get("tagline") or "")
    logo = d.get("logo_base64") or ""
    logo_esc = esc(logo)
    photo = d.get("photo_base64") or ""
    photo_esc = esc(photo)
    show_photo_pref = d.get("show_photo")
    show_photo = bool(photo) and (show_photo_pref is not False)  # default: show if photo present
    page_title = esc(d.get("link_title") or f"Biglietto da visita — {d.get('display_name') or ''}".strip())
    effect = (d.get("visual_effect") or "none").lower()
    card_theme = (d.get("card_theme") or "sunset").lower()
    # V27 palette
    THEMES = {
        # sunset: orange primary + navy accent (default)
        "sunset":   {"primary": "#FF6B35", "secondary": "#1B2B4B", "bg1": "#FFFFFF", "bg2": "#FFF1E9", "text": "#0F172A", "muted": "#64748B", "card_bg": "#FFFFFF", "stripe": "#FF6B35", "surface": "#F8FAFC"},
        # midnight: pure navy with orange accent
        "midnight": {"primary": "#1B2B4B", "secondary": "#FF6B35", "bg1": "#1B2B4B", "bg2": "#0F172A", "text": "#FFFFFF", "muted": "#94A3B8", "card_bg": "#0F172A", "stripe": "#FF6B35", "surface": "#1E2A44"},
        # ivory: light navy on cream
        "ivory":    {"primary": "#1B2B4B", "secondary": "#B8845A", "bg1": "#FFFBF3", "bg2": "#F5EDDF", "text": "#1B2B4B", "muted": "#6B5A47", "card_bg": "#FFFDF7", "stripe": "#1B2B4B", "surface": "#F5EDDF"},
        # mono: pure black/white minimal
        "mono":     {"primary": "#0F172A", "secondary": "#0F172A", "bg1": "#FFFFFF", "bg2": "#F1F5F9", "text": "#0F172A", "muted": "#94A3B8", "card_bg": "#FFFFFF", "stripe": "#0F172A", "surface": "#F8FAFC"},
        # gold: navy with gold accent
        "gold":     {"primary": "#1B2B4B", "secondary": "#D4A853", "bg1": "#F8F5EE", "bg2": "#EFE7D2", "text": "#1B2B4B", "muted": "#7A6C4C", "card_bg": "#FFFFFF", "stripe": "#D4A853", "surface": "#F8F5EE"},
    }
    T = THEMES.get(card_theme, THEMES["sunset"])
    primary = T["primary"]
    secondary = T["secondary"]
    bg1 = T["bg1"]; bg2 = T["bg2"]
    text_c = T["text"]; muted_c = T["muted"]; card_bg = T["card_bg"]
    stripe_c = T["stripe"]
    surface_c = T["surface"]
    qr_type = d.get("qr_type") or "website"
    if qr_type == "app":
        qr_value = d.get("demo_app_link") or d.get("qr_content") or ""
    elif qr_type == "website":
        qr_value = website or (d.get("qr_content") or "")
    elif qr_type == "vcard":
        qr_value = _build_vcard(d)
    else:
        qr_value = d.get("qr_content") or ""
    # QR — use the primary color for dark modules; on midnight theme use white bg
    qr_color = primary.replace("#", "")
    qr_bg = "FFFFFF" if card_theme != "midnight" else "FFFFFF"
    qr_url = f"https://api.qrserver.com/v1/create-qr-code/?data={_quote_plus_std(qr_value or ' ')}&size=200x200&color={qr_color}&bgcolor={qr_bg}"

    # Effect styles — pure CSS
    effect_css = ""
    effect_class = ""
    if effect == "shimmer":
        effect_class = "with-shimmer"
        effect_css = """
        .card.with-shimmer { position: relative; overflow: hidden; }
        .card.with-shimmer::before {
          content: ""; position: absolute; top: 0; left: -100%; width: 55%; height: 100%;
          background: linear-gradient(120deg, transparent 30%, rgba(255,255,255,0.4) 50%, transparent 70%);
          animation: bc-shimmer 10s infinite; pointer-events: none;
        }
        @keyframes bc-shimmer { 0% { left: -100%; } 12% { left: 120%; } 100% { left: 120%; } }
        """
    elif effect == "border":
        effect_class = "with-border-glow"
        effect_css = f"""
        .card.with-border-glow {{ position: relative; }}
        .card.with-border-glow::after {{
          content: ""; position: absolute; inset: -3px; border-radius: 26px;
          padding: 3px; background: conic-gradient(from 0deg, transparent 60%, {secondary}, transparent 100%);
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor; mask-composite: exclude;
          animation: bc-border-spin 3s linear infinite; pointer-events: none;
        }}
        @keyframes bc-border-spin {{ to {{ transform: rotate(360deg); }} }}
        """

    # Contact rows — icon-only labels for a cleaner minimal look
    contacts_rows = "".join([
        (f'<a class="row" href="tel:{phone}"><span class="ico">📞</span><span>{phone}</span></a>' if phone else ""),
        (f'<a class="row" href="mailto:{email}"><span class="ico">✉️</span><span>{email}</span></a>' if email else ""),
        (f'<a class="row" href="{website_esc if website.startswith("http") else "https://" + website_esc}" target="_blank" rel="noopener"><span class="ico">🌐</span><span>{website_esc}</span></a>' if website else ""),
        (f'<div class="row"><span class="ico">📍</span><span>{address}</span></div>' if address else ""),
    ])
    logo_html = f'<img class="logo" src="{logo_esc}" alt="Logo"/>' if logo else ""
    photo_html = f'<img class="photo" src="{photo_esc}" alt="{name}"/>' if show_photo else ""
    tagline_html = f'<div class="tagline">« {tagline} »</div>' if tagline else ""
    title_html = f'<div class="role">{title}</div>' if title else ""
    company_html = f'<div class="company">{company}</div>' if company else ""

    return f"""<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, viewport-fit=cover"/>
<title>{page_title}</title>
<meta property="og:title" content="{page_title}"/>
<meta property="og:description" content="{tagline or name}"/>
<meta name="theme-color" content="{primary}"/>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
  * {{ box-sizing: border-box; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }}
  html, body {{ margin: 0; padding: 0; min-height: 100vh; background: linear-gradient(160deg, {bg1} 0%, {bg2} 100%);
    font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: {text_c}; letter-spacing: -0.011em; }}
  .wrap {{ max-width: 440px; margin: 0 auto; padding: 16px 14px 32px; }}
  .banner {{ background: {primary}; color: #FFF; padding: 10px 12px; border-radius: 12px; margin-bottom: 12px;
    display: none; align-items: center; gap: 8px; box-shadow: 0 4px 16px {primary}44; }}
  .banner .txt {{ flex: 1; font-size: 12.5px; line-height: 1.35; font-weight: 500; }}
  .banner button {{ background: #FFF; color: {primary}; border: none; padding: 7px 14px; border-radius: 8px;
    font-weight: 800; font-size: 11.5px; cursor: pointer; font-family: inherit; }}
  .banner .close {{ background: transparent; color: #FFF; padding: 0 4px; font-size: 18px; }}

  .card {{ background: {card_bg}; border-radius: 22px; overflow: hidden;
    box-shadow: 0 16px 48px rgba(15,23,42,0.11), 0 4px 14px rgba(15,23,42,0.05);
    position: relative;
  }}
  .stripe {{ height: 5px; background: linear-gradient(90deg, {primary} 0%, {secondary} 100%); }}

  /* Photo — fully INSIDE the card (no negative margin), integrated into the header block */
  .photo-wrap {{ display: flex; justify-content: center; padding: 16px 0 4px; position: relative; z-index: 2; }}
  .photo {{ width: 92px; height: 92px; border-radius: 50%; object-fit: cover;
    border: 3px solid {card_bg}; box-shadow: 0 0 0 3px {primary}, 0 6px 16px rgba(15,23,42,0.15); }}

  /* Header — logo + name + role, compact spacing */
  .head {{ padding: 6px 20px 4px; text-align: center; }}
  .head.head-no-photo {{ padding-top: 22px; }}
  .logo-wrap {{ display: flex; justify-content: center; margin-bottom: 10px; }}
  .logo {{ max-width: 130px; max-height: 40px; object-fit: contain; }}
  .name {{ font-size: 25px; font-weight: 900; color: {secondary}; line-height: 1.05; letter-spacing: -0.03em; }}
  .role {{ font-size: 12px; color: {primary}; margin-top: 4px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }}
  .company {{ font-size: 12px; color: {muted_c}; margin-top: 3px; font-weight: 600; }}
  .divider {{ height: 2px; width: 32px; background: {primary}; margin: 12px auto 2px; border-radius: 999px; }}

  /* Contact block — tighter */
  .contacts {{ padding: 8px 18px 12px; display: flex; flex-direction: column; gap: 3px; }}
  .row {{ display: flex; align-items: center; gap: 10px; padding: 9px 12px; font-size: 14px;
    color: {text_c}; text-decoration: none; border-radius: 10px; font-weight: 600;
    background: {surface_c}; transition: background 0.2s; word-break: break-all; }}
  .row:hover {{ background: {primary}18; }}
  a.row {{ color: {text_c}; }}
  a.row span:last-child {{ color: {text_c}; }}
  .row .ico {{ font-size: 15px; width: 20px; text-align: center; flex-shrink: 0; }}

  .tagline {{ padding: 4px 22px 14px; font-size: 13px; font-weight: 500; color: {primary};
    text-align: center; font-style: italic; line-height: 1.4; }}

  /* QR area — smaller, tighter */
  .qr-box {{ padding: 14px 18px 18px; border-top: 1px solid {primary}18; text-align: center; }}
  .qr-frame {{ display: inline-block; padding: 10px; background: #FFF; border-radius: 16px;
    box-shadow: 0 6px 16px rgba(15,23,42,0.08); }}
  .qr-frame img {{ display: block; width: 140px; height: 140px; }}
  .qr-hint {{ font-size: 10px; color: {muted_c}; text-transform: uppercase;
    letter-spacing: 1.4px; font-weight: 800; margin-top: 8px; }}

  /* Actions */
  .actions {{ padding: 14px 14px 4px; display: flex; flex-direction: column; gap: 8px; }}
  .btn {{ display: flex; align-items: center; justify-content: center; gap: 8px; padding: 13px 16px;
    border-radius: 12px; font-weight: 800; font-size: 14px; text-decoration: none; cursor: pointer;
    border: none; font-family: inherit; letter-spacing: 0.01em; transition: transform 0.15s, box-shadow 0.15s; }}
  .btn:active {{ transform: scale(0.98); }}
  .btn-primary {{ background: {primary}; color: #FFF; box-shadow: 0 6px 18px {primary}55; }}
  .btn-primary:hover {{ box-shadow: 0 8px 22px {primary}77; }}
  .btn-secondary {{ background: transparent; color: {secondary}; border: 2px solid {secondary}; }}

  .footer {{ text-align: center; color: {muted_c}; font-size: 10px; padding: 18px 0 4px;
    letter-spacing: 1px; text-transform: uppercase; font-weight: 700; }}

  {effect_css}

  @media (max-width: 380px) {{
    .name {{ font-size: 22px; }}
    .photo {{ width: 82px; height: 82px; }}
    .qr-frame img {{ width: 128px; height: 128px; }}
  }}
</style>
</head>
<body>
  <div class="wrap">
    <div id="save-banner" class="banner">
      <div class="txt">Vuoi salvare i dati nella tua rubrica telefonica?</div>
      <button onclick="downloadVCard()">Salva</button>
      <button class="close" onclick="closeBanner()" aria-label="Chiudi">×</button>
    </div>

    <div class="card {effect_class}">
      <div class="stripe"></div>
      {"<div class='photo-wrap'>" + photo_html + "</div>" if show_photo else ""}
      <div class="head {'head-no-photo' if not show_photo else ''}">
        {("<div class='logo-wrap'>" + logo_html + "</div>") if logo else ""}
        <div class="name">{name}</div>
        {title_html}
        {company_html}
        <div class="divider"></div>
      </div>
      <div class="contacts">{contacts_rows}</div>
      {tagline_html}
      <div class="qr-box">
        <div class="qr-frame"><img src="{qr_url}" alt="QR code"/></div>
        <div class="qr-hint">Scansiona con la fotocamera</div>
      </div>
    </div>

    <div class="actions">
      <button class="btn btn-primary" onclick="downloadVCard()">
        📇 Salva in rubrica
      </button>
      <a class="btn btn-secondary" href="/api/master/business-card/public/{card_id}.vcf" target="_blank" rel="noopener">
        ⬇️ Scarica vCard
      </a>
    </div>

    <div class="footer">Biglietto digitale</div>
  </div>

<script>
  function isMobile() {{ return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent); }}
  function downloadVCard() {{
    window.location.href = '/api/master/business-card/public/{card_id}.vcf';
  }}
  function closeBanner() {{
    var b = document.getElementById('save-banner');
    if (b) b.style.display = 'none';
    try {{ localStorage.setItem('bc_banner_dismissed_{card_id}', '1'); }} catch(e) {{}}
  }}
  (function() {{
    if (!isMobile()) return;
    try {{ if (localStorage.getItem('bc_banner_dismissed_{card_id}') === '1') return; }} catch(e) {{}}
    var b = document.getElementById('save-banner');
    if (b) b.style.display = 'flex';
  }})();
</script>
</body>
</html>"""


@api_router.get("/master/business-card/public/{card_id}.vcf")
async def get_public_business_card_vcf(card_id: str):
    """V38V — Serve the vCard (.vcf) file so the phonebook opens it directly."""
    d = await db.business_cards.find_one({"card_id": card_id}, {"_id": 0, "user_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Biglietto non trovato")
    vc = _build_vcard(d)
    name_slug = (d.get("display_name") or "contatto").replace(" ", "_")
    return Response(
        content=vc,
        media_type="text/vcard",
        headers={"Content-Disposition": f'attachment; filename="{name_slug}.vcf"'},
    )


# =========================
# Business Card Analytics (V28)
# Track opens of the public share link and aggregate stats by city.
# Uses ip-api.com (free, no key) for reverse-geolocation with graceful
# fallback when the network is unavailable or the lookup fails.
# =========================


def _client_ip_from_request(request: Request) -> str:
    """Extract the best-effort real client IP behind the ingress proxy."""
    xff = request.headers.get("x-forwarded-for") or ""
    if xff:
        # X-Forwarded-For: "client, proxy1, proxy2" — client IP is the first.
        first = xff.split(",")[0].strip()
        if first:
            return first
    real = request.headers.get("x-real-ip")
    if real:
        return real.strip()
    try:
        return request.client.host if request.client else ""
    except Exception:
        return ""


def _is_private_ip(ip: str) -> bool:
    """Return True for loopback / RFC1918 / link-local addresses where a
    geo-lookup would only return 'unknown'."""
    if not ip:
        return True
    if ip.startswith(("10.", "127.", "169.254.", "192.168.")):
        return True
    if ip.startswith("172."):
        try:
            second = int(ip.split(".")[1])
            if 16 <= second <= 31:
                return True
        except Exception:
            pass
    if ip in ("::1", "0.0.0.0", "localhost"):
        return True
    return False


async def _geolocate_ip(ip: str) -> Dict[str, str]:
    """Look up city/region/country for an IP via ip-api.com. Best-effort,
    silent fallback to empty strings when offline / rate-limited."""
    if not ip or _is_private_ip(ip):
        return {"city": "", "region": "", "country": "", "country_code": ""}
    try:
        url = f"http://ip-api.com/json/{ip}?fields=status,country,countryCode,regionName,city"
        async with httpx.AsyncClient(timeout=4) as hx:
            r = await hx.get(url)
            if r.status_code != 200:
                return {"city": "", "region": "", "country": "", "country_code": ""}
            j = r.json()
            if j.get("status") != "success":
                return {"city": "", "region": "", "country": "", "country_code": ""}
            return {
                "city": j.get("city") or "",
                "region": j.get("regionName") or "",
                "country": j.get("country") or "",
                "country_code": (j.get("countryCode") or "").upper(),
            }
    except Exception:
        return {"city": "", "region": "", "country": "", "country_code": ""}


async def _record_business_card_view(card_id: str, user_id: str, ip: str, user_agent: str) -> None:
    """Insert a single view document. Runs in background; never raises."""
    try:
        geo = await _geolocate_ip(ip)
        doc = {
            "view_id": f"bcv_{uuid.uuid4().hex[:12]}",
            "card_id": card_id,
            "user_id": user_id,
            "ip": ip or "",
            "user_agent": (user_agent or "")[:400],
            "city": geo["city"],
            "region": geo["region"],
            "country": geo["country"],
            "country_code": geo["country_code"],
            "timestamp": utcnow(),
        }
        await db.business_card_views.insert_one(doc)
    except Exception as exc:  # pragma: no cover — analytics must never break the page
        logging.getLogger(__name__).warning("business_card_view record failed: %s", exc)


@api_router.get("/master/business-card/public/{card_id}", response_class=HTMLResponse)
async def get_public_business_card(card_id: str, request: Request, background_tasks: BackgroundTasks):
    """V38V — Public HTML page (no auth) rendered server-side. Includes vCard
    download button + mobile 'save to phonebook' banner + optional CSS effect.
    V28 — Also records an anonymous analytics view (city aggregation).
    """
    d = await db.business_cards.find_one({"card_id": card_id}, {"_id": 0})
    if not d:
        return HTMLResponse(
            content="<html><body style='font-family:sans-serif;padding:40px;text-align:center;color:#DC2626'>"
                    "<h1>Biglietto non trovato</h1><p>Il link è scaduto o non valido.</p></body></html>",
            status_code=404,
        )
    # V28 — Record analytics in background so the HTML response is instant.
    ip = _client_ip_from_request(request)
    ua = request.headers.get("user-agent") or ""
    background_tasks.add_task(_record_business_card_view, card_id, d.get("user_id") or "", ip, ua)
    # Strip user_id from data used to render the public page
    d.pop("user_id", None)
    return HTMLResponse(content=_build_public_card_html(d, card_id))


@api_router.get("/master/business-card/stats")
async def get_business_card_stats(user=Depends(get_current_user)):
    """V28 — Aggregated stats for the current master's business card.

    Returns:
      - total_views: all-time
      - unique_views: distinct IPs all-time
      - views_last_7_days: [{date: "YYYY-MM-DD", count}] most-recent last
      - views_last_30_days: total count in the last 30 days
      - top_cities: [{city, country, country_code, count}] top 10
      - top_countries: [{country, country_code, count}] top 5
      - recent_views: [{city, country, country_code, timestamp}] last 20
    """
    tid = tenant_id(user)
    # Fetch the card_id belonging to this tenant (some legacy docs might not have one)
    card = await db.business_cards.find_one({"user_id": tid}, {"_id": 0, "card_id": 1})
    card_id = (card or {}).get("card_id")
    if not card_id:
        return {
            "total_views": 0, "unique_views": 0,
            "views_last_7_days": [], "views_last_30_days": 0,
            "top_cities": [], "top_countries": [], "recent_views": [],
            "card_id": None,
        }
    q = {"$or": [{"card_id": card_id}, {"user_id": tid}]}
    now = utcnow()
    since_7 = now - timedelta(days=7)
    since_30 = now - timedelta(days=30)

    total_views = await db.business_card_views.count_documents(q)
    unique_views_agg = await db.business_card_views.aggregate([
        {"$match": q},
        {"$group": {"_id": "$ip"}},
        {"$count": "n"},
    ]).to_list(1)
    unique_views = (unique_views_agg[0]["n"] if unique_views_agg else 0)

    views_last_30_days = await db.business_card_views.count_documents({**q, "timestamp": {"$gte": since_30}})

    # Timeline last 7 days
    daily_agg = await db.business_card_views.aggregate([
        {"$match": {**q, "timestamp": {"$gte": since_7}}},
        {"$group": {
            "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$timestamp"}},
            "count": {"$sum": 1},
        }},
    ]).to_list(31)
    daily_map = {row["_id"]: row["count"] for row in daily_agg}
    views_last_7_days: List[Dict[str, Any]] = []
    for i in range(6, -1, -1):
        day = (now - timedelta(days=i)).strftime("%Y-%m-%d")
        views_last_7_days.append({"date": day, "count": int(daily_map.get(day, 0))})

    # Top cities
    top_cities_raw = await db.business_card_views.aggregate([
        {"$match": {**q, "city": {"$ne": ""}}},
        {"$group": {
            "_id": {"city": "$city", "country": "$country", "country_code": "$country_code"},
            "count": {"$sum": 1},
        }},
        {"$sort": {"count": -1}},
        {"$limit": 10},
    ]).to_list(10)
    top_cities = [
        {
            "city": r["_id"]["city"],
            "country": r["_id"].get("country") or "",
            "country_code": r["_id"].get("country_code") or "",
            "count": r["count"],
        }
        for r in top_cities_raw
    ]

    # Top countries
    top_countries_raw = await db.business_card_views.aggregate([
        {"$match": {**q, "country": {"$ne": ""}}},
        {"$group": {
            "_id": {"country": "$country", "country_code": "$country_code"},
            "count": {"$sum": 1},
        }},
        {"$sort": {"count": -1}},
        {"$limit": 5},
    ]).to_list(5)
    top_countries = [
        {
            "country": r["_id"]["country"],
            "country_code": r["_id"].get("country_code") or "",
            "count": r["count"],
        }
        for r in top_countries_raw
    ]

    # Recent views (last 20)
    recent_raw = await db.business_card_views.find(
        q, {"_id": 0, "city": 1, "country": 1, "country_code": 1, "timestamp": 1}
    ).sort("timestamp", -1).limit(20).to_list(20)
    recent_views = [
        {
            "city": r.get("city") or "",
            "country": r.get("country") or "",
            "country_code": r.get("country_code") or "",
            "timestamp": (r.get("timestamp").isoformat() if r.get("timestamp") else ""),
        }
        for r in recent_raw
    ]

    return {
        "card_id": card_id,
        "total_views": int(total_views),
        "unique_views": int(unique_views),
        "views_last_7_days": views_last_7_days,
        "views_last_30_days": int(views_last_30_days),
        "top_cities": top_cities,
        "top_countries": top_countries,
        "recent_views": recent_views,
    }


@api_router.get("/master-files")
async def list_master_files(category: Optional[str] = None, user=Depends(get_current_user)):
    q = {"user_id": tenant_id(user)}
    if category:
        if category not in ALLOWED_MASTER_CATS:
            raise HTTPException(status_code=400, detail=f"category invalida")
        q["category"] = category
    items = await db.master_files.find(q, {"_id": 0, "data_base64": 0}).sort("created_at", -1).to_list(500)
    return {"items": items}


@api_router.get("/master-files/{file_id}")
async def get_master_file(file_id: str, user=Depends(get_current_user)):
    d = await db.master_files.find_one({"user_id": tenant_id(user), "file_id": file_id}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="File non trovato")
    return d


@api_router.patch("/master-files/{file_id}")
async def rename_master_file(file_id: str, body: MasterFileRenameIn, user=Depends(get_current_user)):
    patch: Dict[str, Any] = {"updated_at": utcnow()}
    if body.name is not None:
        nm = body.name.strip()
        if not nm:
            raise HTTPException(status_code=400, detail="Nome non valido")
        patch["name"] = nm
    if body.title is not None:
        patch["title"] = body.title.strip() or None
    if body.body is not None:
        patch["body"] = body.body
    r = await db.master_files.update_one({"user_id": tenant_id(user), "file_id": file_id}, {"$set": patch})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="File non trovato")
    return {"ok": True}


@api_router.delete("/master-files/{file_id}")
async def delete_master_file(file_id: str, user=Depends(get_current_user)):
    r = await db.master_files.delete_one({"user_id": tenant_id(user), "file_id": file_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="File non trovato")
    return {"ok": True}


# =========================
# Company Offers + Comparison (V25.b)
# Each user (tenant owner) can upload company offer PDFs (luce/gas/telco). AI extracts
# offer parameters, then the /bills/comparison endpoint compares any client's bill vs an offer.
# =========================

class CompanyOfferIn(BaseModel):
    bill_type: str  # luce | gas | telco
    pdf_base64: Optional[str] = None
    pdf_name: Optional[str] = None
    pdf_mime: Optional[str] = "application/pdf"
    label: Optional[str] = None  # short label like "Offerta Fibra 24m"
    manual_text: Optional[str] = None  # V26.q: testo condizioni economiche inserito manualmente


COMPANY_OFFER_PROMPT = """Sei un analista esperto di offerte commerciali italiane per energia elettrica, gas e telecomunicazioni.
Analizza il testo estratto dal documento delle CONDIZIONI ECONOMICHE di un'offerta commerciale e restituisci ESCLUSIVAMENTE un JSON valido.

Schema atteso (ometti chiavi mancanti):
{
  "fornitore": "Nome azienda che propone l'offerta",
  "tipo": "luce" | "gas" | "telco",
  "nome_offerta": "es. Placet Fisso Business",
  "tipologia_prezzo": "fisso" | "variabile" | "indicizzato",
  "durata_contratto_mesi": 24,
  "prezzo_energia_eur_kwh": 0.13,
  "prezzo_gas_eur_smc": 0.38,
  "spread_eur_kwh": 0.008,
  "spread_eur_smc": 0.015,
  "quota_fissa_mensile_eur": 5.0,
  "costo_mensile_eur": 24.90,
  "costo_annuale_eur": 298.80,
  "penale_uscita_anticipata_eur": 0,
  "servizi_extra": ["..."],
  "condizioni_particolari": ["..."],
  "target_cliente": "residenziale" | "business" | "misto",
  "note_ai": ["punto 1", "punto 2"]
}"""


async def _llm_analyze_offer_text(text: str) -> dict:
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise Exception("EMERGENT_LLM_KEY non configurato")
    chat = LlmChat(
        api_key=key,
        session_id=f"offer-{uuid.uuid4().hex[:8]}",
        system_message=COMPANY_OFFER_PROMPT,
    ).with_model("anthropic", "claude-sonnet-5")
    snippet = text[:18000]
    resp = await chat.send_message(UserMessage(text=f"Testo delle condizioni economiche:\n\n{snippet}"))
    raw = (resp or "").strip()
    # V38Z — robust JSON parsing
    return _parse_llm_json(raw, fallback_key="note_ai")


async def _analyze_offer_task(offer_id: str):
    o = await db.company_offers.find_one({"offer_id": offer_id})
    if not o:
        return
    try:
        await db.company_offers.update_one({"offer_id": offer_id}, {"$set": {"status": "analyzing"}})
        # V26.q: se abbiamo manual_text usiamo quello, altrimenti estraiamo dal PDF
        if o.get("manual_text"):
            text = o["manual_text"]
        elif o.get("pdf_base64"):
            text = _extract_pdf_text(o["pdf_base64"])
        else:
            text = ""
        if not text or len(text.strip()) < 20:
            await db.company_offers.update_one({"offer_id": offer_id}, {"$set": {
                "status": "error",
                "error_message": "Testo vuoto o troppo corto (min 20 caratteri) per essere analizzato dall'AI.",
                "analyzed_at": utcnow(),
            }})
            return
        extracted = await _llm_analyze_offer_text(text)
        await db.company_offers.update_one({"offer_id": offer_id}, {"$set": {
            "status": "done",
            "extracted": extracted,
            "analyzed_at": utcnow(),
            "error_message": None,
        }})
    except Exception as e:
        logger.exception(f"offer analysis failed for {offer_id}: {e}")
        await db.company_offers.update_one({"offer_id": offer_id}, {"$set": {
            "status": "error",
            "error_message": str(e)[:400],
            "analyzed_at": utcnow(),
        }})


@api_router.post("/company-offers")
async def create_company_offer(body: CompanyOfferIn, background: BackgroundTasks, user=Depends(get_current_user)):
    if body.bill_type not in BILL_TYPES:
        raise HTTPException(status_code=400, detail=f"bill_type non valido: usa {BILL_TYPES}")
    if not body.pdf_base64 and not body.manual_text:
        raise HTTPException(status_code=400, detail="Fornisci un PDF (pdf_base64) o un testo manuale (manual_text)")
    b64 = body.pdf_base64 or ""
    if b64.startswith("data:"):
        b64 = b64.split(",", 1)[1]
    approx = int(len(b64) * 0.75) if b64 else 0
    if approx > 12 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="PDF troppo grande (max ~12 MB)")
    offer_id = f"offer_{uuid.uuid4().hex[:12]}"
    doc = {
        "offer_id": offer_id,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        "bill_type": body.bill_type,
        "label": body.label or f"Offerta {body.bill_type}",
        "pdf_base64": body.pdf_base64 or None,
        "pdf_name": body.pdf_name or (f"offerta-{body.bill_type}.pdf" if body.pdf_base64 else f"offerta-manuale-{body.bill_type}.txt"),
        "pdf_mime": body.pdf_mime or "application/pdf",
        "pdf_size": approx,
        "manual_text": body.manual_text or None,  # V26.q
        "source": "pdf" if body.pdf_base64 else "manual",
        "status": "pending",
        "extracted": None,
        "error_message": None,
        "created_at": utcnow(),
        "analyzed_at": None,
    }
    await db.company_offers.insert_one(doc)
    background.add_task(_analyze_offer_task, offer_id)
    strip_id(doc)
    doc.pop("pdf_base64", None)
    return doc


@api_router.get("/company-offers")
async def list_company_offers(user=Depends(get_current_user)):
    items = await db.company_offers.find(
        {"user_id": tenant_id(user)},
        {"_id": 0, "pdf_base64": 0},
    ).sort("created_at", -1).to_list(50)
    grouped: Dict[str, List[Dict[str, Any]]] = {"luce": [], "gas": [], "telco": []}
    for it in items:
        bt = it.get("bill_type") or "luce"
        grouped.setdefault(bt, []).append(it)
    return {"items": items, "grouped": grouped}


@api_router.get("/company-offers/{offer_id}/pdf")
async def get_offer_pdf(offer_id: str, user=Depends(get_current_user)):
    o = await db.company_offers.find_one({"user_id": tenant_id(user), "offer_id": offer_id}, {"_id": 0})
    if not o:
        raise HTTPException(status_code=404, detail="Offerta non trovata")
    return {"pdf_base64": o.get("pdf_base64"), "pdf_name": o.get("pdf_name"), "pdf_mime": o.get("pdf_mime")}


@api_router.delete("/company-offers/{offer_id}")
async def delete_company_offer(offer_id: str, user=Depends(get_current_user)):
    r = await db.company_offers.delete_one({"user_id": tenant_id(user), "offer_id": offer_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Offerta non trovata")
    return {"ok": True}


@api_router.post("/company-offers/{offer_id}/reanalyze")
async def reanalyze_offer(offer_id: str, background: BackgroundTasks, user=Depends(get_current_user)):
    o = await db.company_offers.find_one({"user_id": tenant_id(user), "offer_id": offer_id})
    if not o:
        raise HTTPException(status_code=404, detail="Offerta non trovata")
    await db.company_offers.update_one({"offer_id": offer_id}, {"$set": {"status": "pending", "error_message": None}})
    background.add_task(_analyze_offer_task, offer_id)
    return {"ok": True, "status": "pending"}


COMPARISON_PROMPT_BASIC = """Sei un consulente energetico italiano esperto. Confronta due offerte energia/gas/telco.
Rispondi ESCLUSIVAMENTE con JSON valido (nessun markdown, nessuna intro):
{
  "tipo_fornitura": "luce" | "gas" | "telco",
  "sintesi": ["punto 1 conciso", "punto 2", "punto 3"],
  "vantaggi_offerta_aziendale": ["vantaggio 1", "vantaggio 2"],
  "svantaggi_offerta_aziendale": ["svantaggio 1"],
  "differenza_prezzo_energia_eur_kwh": 0.015,
  "differenza_prezzo_gas_eur_smc": 0.03,
  "differenza_costo_mensile_eur": 5.0,
  "risparmio_annuo_stimato_eur": 180,
  "risparmio_percentuale": 15,
  "raccomandazione": "consigliato" | "neutro" | "sconsigliato",
  "motivazione_raccomandazione": ["motivo 1"],
  "azione_consigliata": ["passo 1", "passo 2"]
}
Se un dato non è disponibile, ometti la chiave (non usare null). Sii conciso."""

COMPARISON_PROMPT_RICH = """Sei un consulente energetico italiano. Analizza l'offerta ATTUALE del cliente e produci un report VISIVO strutturato.
Rispondi ESCLUSIVAMENTE con JSON valido (nessun markdown):
{
  "impronta_energetica": {
    "consumo_annuo_kwh_o_smc": 3200,
    "unita": "kWh" | "SMC" | "GB",
    "profilo_utilizzo": "descrizione breve (max 15 parole)",
    "categoria_consumo": "basso" | "medio" | "medio-alto" | "alto",
    "note": ["osservazione 1", "osservazione 2"]
  },
  "dettaglio_fasce": {
    "F1_kwh": 1200, "F2_kwh": 900, "F3_kwh": 1100,
    "F1_percent": 37.5, "F2_percent": 28.1, "F3_percent": 34.4,
    "fascia_prevalente": "F1" | "F2" | "F3" | "monoraria",
    "raccomandazione_tariffa": "biorario" | "monorario" | "trioraria",
    "motivazione": "spiegazione max 20 parole"
  },
  "analisi_contratto_attuale": {
    "fornitore": "nome", "nome_offerta": "nome",
    "tipo_prezzo": "fisso" | "variabile" | "indicizzato",
    "spread_eur_kwh_o_smc": 0.045,
    "durata_contratto_mesi": 24,
    "data_scadenza": "MM/AAAA",
    "criticita": ["criticità 1"],
    "punti_forza": ["punto forte 1"]
  },
  "calcolo_risparmio": {
    "costo_annuo_attuale_eur": 1450,
    "costo_annuo_nuovo_eur": 1250,
    "risparmio_annuo_eur": 200,
    "risparmio_percentuale": 13.8,
    "risparmio_mensile_eur": 16.7,
    "dettaglio_calcolo": ["voce -180€"]
  },
  "matrice_confronto": [
    {"parametro": "Prezzo €/kWh", "attuale": "0.185", "proposta": "0.152", "delta": "-0.033", "vantaggio": "cliente"},
    {"parametro": "Quota fissa", "attuale": "12€", "proposta": "9€", "delta": "-3€", "vantaggio": "cliente"}
  ],
  "executive_summary": {
    "verdetto": "Passaggio fortemente consigliato" | "Passaggio consigliato" | "Situazione neutra" | "Passaggio sconsigliato",
    "risparmio_annuo_eur": 200,
    "punti_chiave": ["risparmio 13.8%", "flessibilità"],
    "prossimi_passi": ["Presentare proposta", "Firma modulo"]
  }
}
Basa i calcoli sui dati reali. Se manca un dato ometti la chiave. Le fasce F1/F2/F3 sono solo per luce/gas."""

# Legacy fallback prompt (single big call) — kept for backward compat but unused in comparison endpoint
COMPARISON_PROMPT = COMPARISON_PROMPT_BASIC


async def _llm_compare_offers_basic(bill_extracted: dict, offer_extracted: dict, bill_type: str) -> dict:
    return await _llm_compare_call(COMPARISON_PROMPT_BASIC, bill_extracted, offer_extracted, bill_type, "compare-basic")


async def _llm_compare_offers_rich(bill_extracted: dict, offer_extracted: dict, bill_type: str) -> dict:
    return await _llm_compare_call(COMPARISON_PROMPT_RICH, bill_extracted, offer_extracted, bill_type, "compare-rich")


async def _llm_compare_call(system_prompt: str, bill_extracted: dict, offer_extracted: dict, bill_type: str, session_prefix: str) -> dict:
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise Exception("EMERGENT_LLM_KEY non configurato")
    chat = LlmChat(
        api_key=key,
        session_id=f"{session_prefix}-{uuid.uuid4().hex[:8]}",
        system_message=system_prompt,
    ).with_model("anthropic", "claude-sonnet-5")
    import json as _json
    # Trim payload aggressively to keep the LLM prompt/response fast
    bill_str = _json.dumps(bill_extracted, ensure_ascii=False)[:4500]
    offer_str = _json.dumps(offer_extracted, ensure_ascii=False)[:4500]
    prompt = (
        f"Tipo fornitura: {bill_type.upper()}\n\n"
        f"=== FATTURA CLIENTE (offerta attuale) ===\n{bill_str}\n\n"
        f"=== OFFERTA AZIENDALE (proposta) ===\n{offer_str}\n\n"
        f"Produci il JSON richiesto."
    )
    resp = await chat.send_message(UserMessage(text=prompt))
    raw = (resp or "").strip()
    # V38Z — robust JSON parsing (never raises)
    return _parse_llm_json(raw, fallback_key="note_ai")


async def _llm_compare_offers(bill_extracted: dict, offer_extracted: dict, bill_type: str) -> dict:
    """Run BASIC + RICH prompts in PARALLEL and merge into one dict.
    This keeps each individual call small/fast (< 30s) so we don't hit the ~60s ingress timeout.
    If one call fails, we still return the other's data + a note."""
    import asyncio as _asyncio
    basic_task = _llm_compare_offers_basic(bill_extracted, offer_extracted, bill_type)
    rich_task = _llm_compare_offers_rich(bill_extracted, offer_extracted, bill_type)
    basic_res, rich_res = await _asyncio.gather(basic_task, rich_task, return_exceptions=True)
    merged: dict = {"tipo_fornitura": bill_type}
    partial_errors: List[str] = []
    if isinstance(basic_res, Exception):
        logger.warning(f"compare basic failed: {basic_res}")
        partial_errors.append(f"basic:{str(basic_res)[:120]}")
    elif isinstance(basic_res, dict):
        merged.update(basic_res)
    if isinstance(rich_res, Exception):
        logger.warning(f"compare rich failed: {rich_res}")
        partial_errors.append(f"rich:{str(rich_res)[:120]}")
    elif isinstance(rich_res, dict):
        # Rich takes precedence for its keys
        merged.update(rich_res)
    if partial_errors and not merged.get("sintesi"):
        merged["parse_error"] = True
        merged["error_message"] = " | ".join(partial_errors)
        merged.setdefault("sintesi", ["Comparazione parzialmente completata a causa di un errore AI."])
        merged.setdefault("raccomandazione", "neutro")
    elif partial_errors:
        merged["partial_error"] = " | ".join(partial_errors)
    return merged


@api_router.get("/contacts/{contact_id}/bills/comparison")
async def bills_comparison(
    contact_id: str,
    bill_id: Optional[str] = None,
    offer_id: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Compare a client bill vs a company offer. If bill_id/offer_id omitted, use latest done for
    matching bill_type per section (creates one comparison per fornitura where both exist).
    V38: LLM calls now run in parallel via asyncio.gather to stay under ingress timeout."""
    contact = await _ensure_contact_owned(contact_id, user)
    # Fetch bills done
    bills = await db.energy_bills.find(
        {"user_id": tenant_id(user), "contact_id": contact_id, "status": "done"},
        {"_id": 0, "pdf_base64": 0, "raw_text_preview": 0},
    ).sort("created_at", -1).to_list(200)
    offers = await db.company_offers.find(
        {"user_id": tenant_id(user), "status": "done"},
        {"_id": 0, "pdf_base64": 0},
    ).sort("created_at", -1).to_list(50)
    if not bills:
        raise HTTPException(status_code=400, detail="Nessuna fattura analizzata disponibile")
    if not offers:
        raise HTTPException(status_code=400, detail="Nessuna offerta aziendale analizzata disponibile")

    async def _safe_compare(bill_ex: dict, offer_ex: dict, bt: str) -> dict:
        try:
            return await _llm_compare_offers(bill_ex or {}, offer_ex or {}, bt)
        except Exception as e:
            logger.exception(f"comparison failed for bill_type={bt}: {e}")
            return {
                "parse_error": True,
                "error_message": f"Impossibile completare il confronto: {str(e)[:200]}",
                "sintesi": [f"Errore durante l'elaborazione AI ({bt}). Riprova più tardi."],
                "raccomandazione": "neutro",
            }

    # If specific ids given, compare just those
    if bill_id and offer_id:
        bill = next((b for b in bills if b["bill_id"] == bill_id), None)
        offer = next((o for o in offers if o["offer_id"] == offer_id), None)
        if not bill or not offer:
            raise HTTPException(status_code=404, detail="Fattura o offerta non trovata")
        comparison = await _safe_compare(bill.get("extracted") or {}, offer.get("extracted") or {}, bill.get("bill_type") or "luce")
        return {
            "contact": {
                "contact_id": contact["contact_id"],
                "first_name": contact.get("first_name"),
                "last_name": contact.get("last_name"),
                "contact_code": contact.get("contact_code"),
            },
            "items": [{
                "bill_type": bill.get("bill_type"),
                "bill": {"bill_id": bill["bill_id"], "pdf_name": bill.get("pdf_name"), "extracted": bill.get("extracted")},
                "offer": {"offer_id": offer["offer_id"], "label": offer.get("label"), "extracted": offer.get("extracted")},
                "comparison": comparison,
            }],
            "generated_at": utcnow(),
        }

    # Auto-match: latest bill and latest offer per bill_type — run LLM calls in PARALLEL
    pairs: List[Dict[str, Any]] = []
    for bt in BILL_TYPES:
        latest_bill = next((b for b in bills if b.get("bill_type") == bt), None)
        latest_offer = next((o for o in offers if o.get("bill_type") == bt), None)
        if not latest_bill or not latest_offer:
            continue
        pairs.append({"bill_type": bt, "bill": latest_bill, "offer": latest_offer})
    if not pairs:
        raise HTTPException(status_code=400, detail="Nessuna coppia fattura/offerta corrispondente. Carica un'offerta aziendale dello stesso tipo (luce/gas/telco).")

    # Parallel execution
    import asyncio as _asyncio
    comparisons = await _asyncio.gather(
        *[_safe_compare(p["bill"].get("extracted") or {}, p["offer"].get("extracted") or {}, p["bill_type"]) for p in pairs],
        return_exceptions=False,
    )
    results: List[Dict[str, Any]] = []
    for p, comparison in zip(pairs, comparisons):
        results.append({
            "bill_type": p["bill_type"],
            "bill": {"bill_id": p["bill"]["bill_id"], "pdf_name": p["bill"].get("pdf_name"), "extracted": p["bill"].get("extracted")},
            "offer": {"offer_id": p["offer"]["offer_id"], "label": p["offer"].get("label"), "extracted": p["offer"].get("extracted")},
            "comparison": comparison,
        })
    total_risparmio = sum(float(r["comparison"].get("risparmio_annuo_stimato_eur") or 0) for r in results)
    return {
        "contact": {
            "contact_id": contact["contact_id"],
            "first_name": contact.get("first_name"),
            "last_name": contact.get("last_name"),
            "contact_code": contact.get("contact_code"),
        },
        "items": results,
        "risparmio_totale_annuo_eur": total_risparmio,
        "generated_at": utcnow(),
    }


# =========================
# V26 — Master Interface support: Contracts, Web Links, User Settings
# =========================

class ContractIn(BaseModel):
    contact_id: Optional[str] = None
    contract_number: Optional[str] = None
    contract_type: str = "energy"  # energy | luce | gas | telco | other
    supplier: Optional[str] = None
    signed_date: Optional[str] = None
    activation_date: Optional[str] = None
    expiry_date: Optional[str] = None
    amount_eur: Optional[float] = None
    status: str = "active"  # draft | active | expired | cancelled
    notes: Optional[str] = ""


class ContractUpdate(BaseModel):
    contact_id: Optional[str] = None
    contract_number: Optional[str] = None
    contract_type: Optional[str] = None
    supplier: Optional[str] = None
    signed_date: Optional[str] = None
    activation_date: Optional[str] = None
    expiry_date: Optional[str] = None
    amount_eur: Optional[float] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class WebLinkIn(BaseModel):
    title: str
    url: str
    icon: Optional[str] = None  # emoji or url


class AudioRecordIn(BaseModel):
    target_type: str  # "personal" | "contact" | "group"
    target_id: Optional[str] = None  # contact_id or group_id
    audio_base64: str
    mime: Optional[str] = "audio/webm"
    duration_sec: Optional[float] = None
    title: Optional[str] = None


class UserSettingsIn(BaseModel):
    theme: Optional[str] = None  # "light" | "dark" | "auto"
    accent_color: Optional[str] = None  # hex e.g. "#7C3AED"
    banner_image_url: Optional[str] = None  # Master banner override
    assistant_name: Optional[str] = None  # AI assistant custom name (default "Neo")
    assistant_response_mode: Optional[str] = None  # "text" | "voice" | "both" (default "text")
    assistant_voice: Optional[str] = None  # OpenAI TTS voice: alloy | echo | fable | onyx | nova | shimmer


class AssistantChatIn(BaseModel):
    message: str
    session_id: Optional[str] = None


class AssistantTTSIn(BaseModel):
    text: str
    voice: Optional[str] = None


@api_router.post("/contracts")
async def create_contract(body: ContractIn, user=Depends(get_current_user)):
    if body.contact_id:
        c = await db.contacts.find_one(tenant_scope(user, {"contact_id": body.contact_id}))
        if not c:
            raise HTTPException(status_code=404, detail="Contatto non trovato")
    contract_id = f"ctr_{uuid.uuid4().hex[:12]}"
    doc = {
        "contract_id": contract_id,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        "contact_id": body.contact_id,
        "contract_number": body.contract_number,
        "contract_type": body.contract_type,
        "supplier": body.supplier,
        "signed_date": body.signed_date,
        "activation_date": body.activation_date,
        "expiry_date": body.expiry_date,
        "amount_eur": body.amount_eur,
        "status": body.status,
        "notes": body.notes or "",
        "created_at": utcnow(),
    }
    await db.contracts.insert_one(doc)
    strip_id(doc)
    return doc


@api_router.get("/contracts")
async def list_contracts(user=Depends(get_current_user)):
    q: Dict[str, Any] = {"user_id": tenant_id(user)}
    vis = await contact_visibility_filter(user)
    if vis:
        # Same visibility rules as contacts: non-admin sees only own (created_by)
        q["created_by"] = user["user_id"]
    items = await db.contracts.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    # Enrich with contact name (small)
    contact_ids = [c["contact_id"] for c in items if c.get("contact_id")]
    if contact_ids:
        contacts = await db.contacts.find(
            {"contact_id": {"$in": contact_ids}, "user_id": tenant_id(user)},
            {"_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1, "contact_code": 1},
        ).to_list(500)
        cmap = {c["contact_id"]: c for c in contacts}
        for it in items:
            it["contact"] = cmap.get(it.get("contact_id"))
    return {"items": items}


@api_router.get("/contracts/new-alerts")
async def contracts_new_alerts(user=Depends(get_current_user)):
    """Returns unread contracts created by OTHER team members in the same tenant.
    A user's last-seen timestamp is stored in user_settings.contracts_last_seen_at."""
    tid = tenant_id(user)
    settings = await db.user_settings.find_one({"user_id": user["user_id"]}) or {}
    last_seen = settings.get("contracts_last_seen_at") or datetime(1970, 1, 1)
    if isinstance(last_seen, str):
        try:
            last_seen = datetime.fromisoformat(last_seen.replace("Z", "+00:00"))
        except Exception:
            last_seen = datetime(1970, 1, 1)
    count = await db.contracts.count_documents({
        "user_id": tid,
        "created_by": {"$ne": user["user_id"]},
        "created_at": {"$gt": last_seen},
    })
    latest = await db.contracts.find({
        "user_id": tid,
        "created_by": {"$ne": user["user_id"]},
        "created_at": {"$gt": last_seen},
    }, {"_id": 0}).sort("created_at", -1).to_list(10)
    return {"unread": count, "latest": latest}


@api_router.post("/contracts/mark-seen")
async def contracts_mark_seen(user=Depends(get_current_user)):
    now = utcnow()
    await db.user_settings.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"contracts_last_seen_at": now, "updated_at": now}, "$setOnInsert": {"user_id": user["user_id"], "created_at": now}},
        upsert=True,
    )
    return {"ok": True, "seen_at": now}


@api_router.get("/contracts/{contract_id}")
async def get_contract(contract_id: str, user=Depends(get_current_user)):
    c = await db.contracts.find_one({"user_id": tenant_id(user), "contract_id": contract_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Contratto non trovato")
    return c


@api_router.put("/contracts/{contract_id}")
async def update_contract(contract_id: str, body: ContractUpdate, user=Depends(get_current_user)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
    updates["updated_at"] = utcnow()
    r = await db.contracts.update_one({"user_id": tenant_id(user), "contract_id": contract_id}, {"$set": updates})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Contratto non trovato")
    return {"ok": True}


@api_router.delete("/contracts/{contract_id}")
async def delete_contract(contract_id: str, user=Depends(get_current_user)):
    r = await db.contracts.delete_one({"user_id": tenant_id(user), "contract_id": contract_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Contratto non trovato")
    return {"ok": True}


# ---- Web Links (My Web) ----
@api_router.get("/web-links")
async def list_web_links(user=Depends(get_current_user)):
    items = await db.web_links.find({"user_id": user["user_id"]}, {"_id": 0}).sort("order", 1).to_list(200)
    return {"items": items}


@api_router.post("/web-links")
async def create_web_link(body: WebLinkIn, user=Depends(get_current_user)):
    link_id = f"lnk_{uuid.uuid4().hex[:10]}"
    order_max = await db.web_links.find_one({"user_id": user["user_id"]}, sort=[("order", -1)])
    order = int(order_max.get("order", 0)) + 1 if order_max else 1
    url = body.url.strip()
    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url
    doc = {
        "link_id": link_id,
        "user_id": user["user_id"],
        "title": body.title.strip()[:120],
        "url": url,
        "icon": body.icon or "🔗",
        "order": order,
        "created_at": utcnow(),
    }
    await db.web_links.insert_one(doc)
    strip_id(doc)
    return doc


@api_router.delete("/web-links/{link_id}")
async def delete_web_link(link_id: str, user=Depends(get_current_user)):
    r = await db.web_links.delete_one({"user_id": user["user_id"], "link_id": link_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Link non trovato")
    return {"ok": True}


# ---- Audio Records (Master recorder) ----
ALLOWED_TARGETS = ("personal", "contact", "group")


@api_router.post("/audio-records")
async def create_audio_record(body: AudioRecordIn, user=Depends(get_current_user)):
    if body.target_type not in ALLOWED_TARGETS:
        raise HTTPException(status_code=400, detail=f"target_type non valido: {ALLOWED_TARGETS}")
    b64 = body.audio_base64
    if b64.startswith("data:"):
        b64 = b64.split(",", 1)[1]
    approx = int(len(b64) * 0.75)
    if approx < 512:
        raise HTTPException(status_code=400, detail="Audio troppo corto")
    if approx > 30 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio troppo grande (max ~30 MB)")

    if body.target_type == "contact":
        if not body.target_id:
            raise HTTPException(status_code=400, detail="target_id (contact_id) richiesto")
        c = await db.contacts.find_one(tenant_scope(user, {"contact_id": body.target_id}))
        if not c:
            raise HTTPException(status_code=404, detail="Contatto non trovato")
    elif body.target_type == "group":
        if not body.target_id:
            raise HTTPException(status_code=400, detail="target_id (group_id) richiesto")
        g = await db.groups.find_one({"group_id": body.target_id, "user_id": tenant_id(user)})
        if not g:
            raise HTTPException(status_code=404, detail="Gruppo non trovato")

    audio_id = f"aud_{uuid.uuid4().hex[:12]}"
    doc = {
        "audio_id": audio_id,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        "target_type": body.target_type,
        "target_id": body.target_id,
        "audio_base64": body.audio_base64,
        "mime": body.mime or "audio/webm",
        "duration_sec": body.duration_sec,
        "size_bytes": approx,
        "title": body.title or None,
        "created_at": utcnow(),
    }
    await db.audio_records.insert_one(doc)
    strip_id(doc)
    doc.pop("audio_base64", None)
    return doc


@api_router.get("/audio-records")
async def list_audio_records(target_type: Optional[str] = None, target_id: Optional[str] = None, user=Depends(get_current_user)):
    q: Dict[str, Any] = {"user_id": tenant_id(user)}
    if target_type:
        if target_type not in ALLOWED_TARGETS:
            raise HTTPException(status_code=400, detail="target_type non valido")
        q["target_type"] = target_type
    if target_id:
        q["target_id"] = target_id
    # personal recordings scoped to the creator
    if target_type == "personal" or (target_type is None and not target_id):
        # If listing personal, restrict to created_by
        if target_type == "personal":
            q["created_by"] = user["user_id"]
    items = await db.audio_records.find(q, {"_id": 0, "audio_base64": 0}).sort("created_at", -1).to_list(200)
    return {"items": items}


@api_router.get("/audio-records/{audio_id}")
async def get_audio_record(audio_id: str, user=Depends(get_current_user)):
    a = await db.audio_records.find_one({"user_id": tenant_id(user), "audio_id": audio_id}, {"_id": 0})
    if not a:
        raise HTTPException(status_code=404, detail="Audio non trovato")
    # For personal, only creator can access
    if a.get("target_type") == "personal" and a.get("created_by") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Non autorizzato")
    return a


@api_router.put("/audio-records/{audio_id}/title")
async def rename_audio_record(audio_id: str, body: dict, user=Depends(get_current_user)):
    a = await db.audio_records.find_one({"user_id": tenant_id(user), "audio_id": audio_id})
    if not a:
        raise HTTPException(status_code=404, detail="Audio non trovato")
    if not is_owner(user) and a.get("created_by") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Non autorizzato")
    new_title = (body.get("title") or "").strip()[:200]
    await db.audio_records.update_one({"audio_id": audio_id}, {"$set": {"title": new_title or None, "updated_at": utcnow()}})
    return {"ok": True, "title": new_title or None}


@api_router.delete("/audio-records/{audio_id}")
async def delete_audio_record(audio_id: str, user=Depends(get_current_user)):
    a = await db.audio_records.find_one({"user_id": tenant_id(user), "audio_id": audio_id})
    if not a:
        raise HTTPException(status_code=404, detail="Audio non trovato")
    # Only creator (or owner) can delete
    if not is_owner(user) and a.get("created_by") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Solo il creatore può eliminare")
    await db.audio_records.delete_one({"audio_id": audio_id})
    return {"ok": True}


# ---- User Settings (theme / accent / banner) ----
@api_router.get("/user-settings")
async def get_user_settings(user=Depends(get_current_user)):
    s = await db.user_settings.find_one({"user_id": user["user_id"]}, {"_id": 0}) or {
        "user_id": user["user_id"], "theme": "light", "accent_color": "#7C3AED", "banner_image_url": None, "assistant_name": "Neo", "assistant_response_mode": "text", "assistant_voice": "nova"
    }
    if not s.get("assistant_name"):
        s["assistant_name"] = "Neo"
    if not s.get("assistant_response_mode"):
        s["assistant_response_mode"] = "text"
    if not s.get("assistant_voice"):
        s["assistant_voice"] = "nova"
    return s


@api_router.put("/user-settings")
async def update_user_settings(body: UserSettingsIn, user=Depends(get_current_user)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        return {"ok": True}
    updates["updated_at"] = utcnow()
    now = utcnow()
    await db.user_settings.update_one(
        {"user_id": user["user_id"]},
        {"$set": updates, "$setOnInsert": {"user_id": user["user_id"], "created_at": now}},
        upsert=True,
    )
    s = await db.user_settings.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return s


# =========================
# AI Personal Assistant (Neo)
# =========================
_WEATHER_KEYWORDS = [
    "tempo", "meteo", "pioggia", "piove", "piover", "sole", "soleggiato", "sereno",
    "temperatura", "gradi", "nevica", "neve", "vento", "nuvoloso", "nuvole", "nebbia",
    "clima", "umidità", "afoso", "caldo", "freddo", "temporale",
]

_WEATHER_CODES_IT = {
    0: "sereno", 1: "prevalentemente sereno", 2: "parzialmente nuvoloso", 3: "coperto",
    45: "nebbia", 48: "nebbia con brina",
    51: "pioviggine leggera", 53: "pioviggine", 55: "pioviggine intensa",
    56: "pioviggine gelata leggera", 57: "pioviggine gelata intensa",
    61: "pioggia leggera", 63: "pioggia", 65: "pioggia intensa",
    66: "pioggia gelata leggera", 67: "pioggia gelata intensa",
    71: "neve leggera", 73: "neve", 75: "neve intensa", 77: "granuli di neve",
    80: "rovesci leggeri", 81: "rovesci", 82: "rovesci intensi",
    85: "rovesci di neve leggeri", 86: "rovesci di neve intensi",
    95: "temporale", 96: "temporale con grandine leggera", 99: "temporale con grandine intensa",
}


def _detect_weather_query(text: str) -> Optional[str]:
    """Return the city name if the message looks like a weather query, else None."""
    if not text:
        return None
    lower = text.lower()
    if not any(kw in lower for kw in _WEATHER_KEYWORDS):
        return None
    # Try to extract "a <City>" / "in <City>" / "di <City>" / "per <City>" / "su <City>"
    # Capture up to 4 tokens; stop at time words or punctuation
    import re
    # Words that indicate end of city name
    stop = r"(?:oggi|domani|dopodomani|stamattina|stanotte|pomeriggio|sera|mattina|adesso|ora|questa|questo|nel|nella|dalle|alle|verso|tra|tra\s+\w+|entro|prossim\w+|\?|\.|,|!|$)"
    # City must start with capital in original text (best-effort)
    m = re.search(
        r"\b(?:a|ad|in|di|per|su)\s+([A-ZÀ-Ú][\wÀ-úà-ú'\-]*(?:\s+(?!" + stop + r"\b)[A-ZÀ-Ú]?[\wÀ-úà-ú'\-]+){0,3})",
        text,
    )
    if m:
        city = m.group(1).strip().rstrip(",.;:!?").strip()
        # Cleanup: drop trailing time words that slipped in
        parts = city.split()
        while parts and parts[-1].lower() in {
            "oggi", "domani", "dopodomani", "stamattina", "stanotte", "pomeriggio",
            "sera", "mattina", "adesso", "ora", "questa", "questo",
        }:
            parts.pop()
        city = " ".join(parts).strip()
        if len(city) >= 2:
            return city
    return "?"  # weather query but no city detected


async def _fetch_weather(city: str) -> Optional[dict]:
    """Fetch weather via wttr.in (no key required, Italian localized). Falls back to Open-Meteo on failure."""
    from urllib.parse import quote
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as hx:
            r = await hx.get(
                f"https://wttr.in/{quote(city)}",
                params={"format": "j1", "lang": "it"},
                headers={"User-Agent": "curl/8.0"},
            )
            if r.status_code == 200 and r.text.strip().startswith("{"):
                data = r.json()
                cur_list = data.get("current_condition") or []
                weather_days = data.get("weather") or []
                area = (data.get("nearest_area") or [{}])[0]

                resolved = ""
                try:
                    resolved = area.get("areaName", [{}])[0].get("value", "")
                    reg = area.get("region", [{}])[0].get("value", "")
                    country = area.get("country", [{}])[0].get("value", "")
                    if reg:
                        resolved += f", {reg}"
                    if country:
                        resolved += f" ({country})"
                except Exception:
                    resolved = city

                current = {}
                if cur_list:
                    c = cur_list[0]
                    desc_it = ""
                    try:
                        desc_it = c.get("lang_it", [{}])[0].get("value") or c.get("weatherDesc", [{}])[0].get("value", "")
                    except Exception:
                        desc_it = ""
                    current = {
                        "condizione": desc_it or "sconosciuta",
                        "temp_c": _to_num(c.get("temp_C")),
                        "percepita_c": _to_num(c.get("FeelsLikeC")),
                        "umidita_pct": _to_num(c.get("humidity")),
                        "vento_kmh": _to_num(c.get("windspeedKmph")),
                        "pioggia_mm": _to_num(c.get("precipMM")),
                        "cielo_pct_nuvole": _to_num(c.get("cloudcover")),
                    }

                # Group hourly buckets — wttr.in provides 8 slots (every 3h) per day
                hourly = []
                prossimi_giorni = []
                today = datetime.now().strftime("%Y-%m-%d")
                for day in weather_days[:3]:
                    d_date = day.get("date")
                    prossimi_giorni.append({
                        "giorno": d_date,
                        "max_c": _to_num(day.get("maxtempC")),
                        "min_c": _to_num(day.get("mintempC")),
                        "prob_pioggia_max_pct": max(
                            [_to_num(h.get("chanceofrain")) or 0 for h in (day.get("hourly") or [])],
                            default=0,
                        ),
                        "sunrise": (day.get("astronomy") or [{}])[0].get("sunrise"),
                        "sunset": (day.get("astronomy") or [{}])[0].get("sunset"),
                    })
                    for h in day.get("hourly") or []:
                        # h.time is "0","300","600","900","1200","1500","1800","2100"
                        try:
                            t = int(h.get("time", "0"))
                            hh = t // 100
                            slot = f"{d_date} {hh:02d}:00"
                        except Exception:
                            slot = f"{d_date}"
                        desc = ""
                        try:
                            desc = h.get("lang_it", [{}])[0].get("value") or h.get("weatherDesc", [{}])[0].get("value", "")
                        except Exception:
                            pass
                        hourly.append({
                            "ora": slot,
                            "temp_c": _to_num(h.get("tempC")),
                            "prob_pioggia_pct": _to_num(h.get("chanceofrain")),
                            "condizione": desc or "?",
                        })

                # Trim hourly to next ~24h from now
                now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
                hourly = [h for h in hourly if h["ora"] >= now_str.split(":")[0]]
                if len(hourly) > 12:
                    hourly = hourly[:12]

                return {
                    "citta_richiesta": city,
                    "localita_trovata": resolved or city,
                    "fonte": "wttr.in",
                    "aggiornato_alle": today,
                    "adesso": current,
                    "prossime_ore": hourly,
                    "prossimi_giorni": prossimi_giorni,
                }
    except Exception:
        pass

    # Fallback: Open-Meteo
    try:
        async with httpx.AsyncClient(timeout=8, follow_redirects=True) as hx:
            g = await hx.get(
                "https://geocoding-api.open-meteo.com/v1/search",
                params={"name": city, "count": 1, "language": "it", "format": "json"},
            )
            gj = g.json() if g.status_code == 200 else {}
            results = gj.get("results") or []
            if not results:
                return {"error": f"città '{city}' non trovata"}
            loc = results[0]
            lat, lon = loc.get("latitude"), loc.get("longitude")
            resolved = f"{loc.get('name','')}"
            if loc.get("admin1"):
                resolved += f", {loc['admin1']}"
            if loc.get("country"):
                resolved += f" ({loc['country']})"

            w = await hx.get(
                "https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude": lat, "longitude": lon,
                    "current": "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,relative_humidity_2m",
                    "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
                    "timezone": "Europe/Rome", "forecast_days": 3,
                },
            )
            if w.status_code != 200:
                return {"error": "meteo non disponibile"}
            wj = w.json()
            cur = wj.get("current") or {}
            return {
                "citta_richiesta": city, "localita_trovata": resolved, "fonte": "open-meteo",
                "adesso": {
                    "condizione": _WEATHER_CODES_IT.get(cur.get("weather_code"), "sconosciuta"),
                    "temp_c": cur.get("temperature_2m"),
                    "percepita_c": cur.get("apparent_temperature"),
                    "vento_kmh": cur.get("wind_speed_10m"),
                    "pioggia_mm": cur.get("precipitation"),
                    "umidita_pct": cur.get("relative_humidity_2m"),
                },
            }
    except Exception as e:
        return {"error": f"errore recupero meteo: {e}"}


def _to_num(v):
    try:
        if v is None or v == "":
            return None
        return float(v) if "." in str(v) else int(v)
    except Exception:
        try:
            return float(v)
        except Exception:
            return None


def _fmt_dt_it(dt: Optional[datetime]) -> str:
    if not dt:
        return ""
    try:
        return dt.strftime("%d/%m/%Y %H:%M")
    except Exception:
        return str(dt)


async def _build_assistant_context(user: dict) -> dict:
    """Fetch a compact snapshot of the user's CRM data to feed to the LLM."""
    now = utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)
    week_end = today_start + timedelta(days=7)

    tid = tenant_id(user)
    uid = user["user_id"]
    vis = await contact_visibility_filter(user)

    # Base query for user-scoped data (appointments/calls/callbacks: creator or assignee)
    def _own(extra: Dict[str, Any] = None) -> Dict[str, Any]:
        base = {"user_id": tid}
        if not is_owner(user):
            base["$or"] = [{"created_by": uid}, {"assignee_user_id": uid}, {"broadcast_to_user_ids": uid}]
        if extra:
            base.update(extra)
        return base

    # Upcoming appointments (next 7 days)
    appts_cursor = db.appointments.find(
        _own({"start_at": {"$gte": today_start, "$lte": week_end}}),
        {"_id": 0, "appointment_id": 1, "title": 1, "start_at": 1, "end_at": 1, "contact_id": 1, "location": 1, "area": 1, "notes": 1},
    ).sort("start_at", 1).limit(15)
    upcoming_appts = []
    async for a in appts_cursor:
        cname = None
        if a.get("contact_id"):
            c = await db.contacts.find_one({"contact_id": a["contact_id"]}, {"first_name": 1, "last_name": 1, "phone_mobile": 1})
            if c:
                cname = f"{c.get('first_name','')} {c.get('last_name','')}".strip()
        upcoming_appts.append({
            "id": a.get("appointment_id"),
            "titolo": a.get("title") or "",
            "quando": _fmt_dt_it(a.get("start_at")),
            "cliente": cname,
            "luogo": a.get("location") or "",
            "area": a.get("area") or "",
            "note": (a.get("notes") or "")[:200],
        })

    # Today's call logs
    calls_today = await db.call_logs.count_documents(_own({"created_at": {"$gte": today_start, "$lt": today_end}}))
    # Aggregate by outcome
    outcome_agg = db.call_logs.aggregate([
        {"$match": _own({"created_at": {"$gte": today_start, "$lt": today_end}})},
        {"$group": {"_id": "$outcome_id", "count": {"$sum": 1}}},
    ])
    calls_by_outcome: Dict[str, int] = {}
    async for row in outcome_agg:
        calls_by_outcome[row["_id"] or "sconosciuto"] = row["count"]

    # Active/pending callbacks (not done, sorted by priority/next_at)
    cb_cursor = db.callbacks.find(
        _own({"$or": [{"done": False}, {"done": {"$exists": False}}]}),
        {"_id": 0, "callback_id": 1, "title": 1, "next_at": 1, "phone": 1, "priority": 1, "contact_id": 1, "notes": 1},
    ).sort([("priority", -1), ("next_at", 1)]).limit(20)
    callbacks_list = []
    async for cb in cb_cursor:
        cname = None
        if cb.get("contact_id"):
            c = await db.contacts.find_one({"contact_id": cb["contact_id"]}, {"first_name": 1, "last_name": 1})
            if c:
                cname = f"{c.get('first_name','')} {c.get('last_name','')}".strip()
        callbacks_list.append({
            "id": cb.get("callback_id"),
            "titolo": cb.get("title") or "",
            "quando": _fmt_dt_it(cb.get("next_at")),
            "telefono": cb.get("phone") or "",
            "priorita": cb.get("priority") or "normale",
            "cliente": cname,
            "note": (cb.get("notes") or "")[:150],
        })

    # Contacts summary
    contacts_query = tenant_scope(user)
    if vis:
        contacts_query = {"$and": [contacts_query, vis]}
    total_contacts = await db.contacts.count_documents(contacts_query)
    recent_cursor = db.contacts.find(contacts_query, {
        "_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1, "phone_mobile": 1, "phone_work": 1, "email": 1, "city": 1, "area": 1,
    }).sort("created_at", -1).limit(15)
    recent_contacts = [c async for c in recent_cursor]

    # Contacts without any appointment scheduled (future)
    # Efficient: get contact_ids referenced by future appointments, then contacts NOT in that set
    future_appt_contact_ids = set()
    async for a in db.appointments.find(_own({"start_at": {"$gte": today_start}}), {"contact_id": 1}):
        if a.get("contact_id"):
            future_appt_contact_ids.add(a["contact_id"])
    orphan_query = dict(contacts_query)
    orphan_query["contact_id"] = {"$nin": list(future_appt_contact_ids)}
    orphan_count = await db.contacts.count_documents(orphan_query)
    orphan_cursor = db.contacts.find(orphan_query, {
        "_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1, "phone_mobile": 1, "phone_work": 1,
    }).sort("last_name", 1).limit(15)
    orphans_sample = [c async for c in orphan_cursor]

    # Contracts (last 30 days)
    since = today_start - timedelta(days=30)
    contracts_cursor = db.contracts.find(
        _own({"created_at": {"$gte": since}}),
        {"_id": 0, "contract_id": 1, "title": 1, "amount": 1, "status": 1, "created_at": 1, "contact_id": 1, "area": 1},
    ).sort("created_at", -1).limit(15)
    recent_contracts = []
    async for ct in contracts_cursor:
        cname = None
        if ct.get("contact_id"):
            c = await db.contacts.find_one({"contact_id": ct["contact_id"]}, {"first_name": 1, "last_name": 1})
            if c:
                cname = f"{c.get('first_name','')} {c.get('last_name','')}".strip()
        recent_contracts.append({
            "id": ct.get("contract_id"),
            "titolo": ct.get("title") or "",
            "importo": ct.get("amount"),
            "stato": ct.get("status") or "",
            "creato": _fmt_dt_it(ct.get("created_at")),
            "cliente": cname,
            "area": ct.get("area") or "",
        })
    contracts_total = await db.contracts.count_documents(_own({}))

    return {
        "ora_attuale": _fmt_dt_it(now),
        "utente": {
            "nome": user.get("name") or "",
            "email": user.get("email") or "",
            "ruolo": user.get("role") or "member",
        },
        "appuntamenti_prossimi_7gg": upcoming_appts,
        "telefonate_oggi": {"totale": calls_today, "per_esito": calls_by_outcome},
        "ritelefonate_attive": callbacks_list,
        "clienti": {
            "totale": total_contacts,
            "recenti": recent_contacts,
            "senza_appuntamento_futuro_totale": orphan_count,
            "senza_appuntamento_futuro_esempio": orphans_sample,
        },
        "contratti": {
            "totale": contracts_total,
            "ultimi_30_giorni": recent_contracts,
        },
    }


async def _get_assistant_name(user: dict) -> str:
    s = await db.user_settings.find_one({"user_id": user["user_id"]}, {"assistant_name": 1}) or {}
    name = (s.get("assistant_name") or "").strip()
    return name or "Neo"



# ============================================================
# V38T — Neo web-search (Tavily) + persistent memory
# ============================================================
_ENERGY_KEYWORDS = [
    # Wholesale energy market
    "pun", "gme", "mgp", "gse", "mercato elettrico", "mercato del gas",
    "psv", "ttf", "ipex", "spot", "borsa elettrica",
    # Regulator + specifics
    "arera", "delibera", "delibere", "autorità energia",
    "oneri di sistema", "oneri generali", "componente asos", "arim",
    # Tariffs / bill terms
    "tariffa", "tariffe", "quota energia", "quota potenza", "quota fissa",
    "spesa materia energia", "spesa materia gas", "trasporto e gestione",
    # Adjacent lookup topics
    "cip 6", "certificati bianchi", "titoli di efficienza",
    "conguaglio", "aggiornamento trimestrale", "aggiornamento mensile",
    "regolatorio", "normativa energia",
]


def _detect_energy_query(text: str) -> bool:
    """True when the message mentions Italian energy market data that
    warrants a live Tavily search (PUN, ARERA delibere, tariffs, oneri…).

    V38T-fix — Use word-boundary regex so "appuntamento" doesn't match "pun".
    """
    if not text:
        return False
    lower = text.lower()
    import re as _re
    for kw in _ENERGY_KEYWORDS:
        # Multi-word phrases → use simple substring (they can't collide)
        if " " in kw:
            if kw in lower:
                return True
            continue
        # Single-word keywords → require word boundaries
        if _re.search(rf"\b{_re.escape(kw)}\b", lower):
            return True
    return False


async def _tavily_search(query: str, max_results: int = 5) -> Optional[dict]:
    """V38T — Query the Tavily search API. Returns a compact answer block or None.

    Docs: https://docs.tavily.com — POST /search with `api_key`, `query`,
    `search_depth: 'advanced'`, `include_answer: true`, `max_results`.
    """
    key = os.environ.get("TAVILY_API_KEY")
    if not key:
        return None
    try:
        async with httpx.AsyncClient(timeout=15) as hx:
            r = await hx.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": key,
                    "query": query,
                    "search_depth": "advanced",
                    "include_answer": True,
                    "include_raw_content": False,
                    "max_results": max_results,
                    "include_domains": [
                        "arera.it", "mercatoelettrico.org", "gse.it",
                        "gme.it", "snam.it", "terna.it", "acquirente-unico.it",
                        "borsaitaliana.it", "governo.it", "gazzettaufficiale.it",
                    ],
                },
                headers={"Content-Type": "application/json"},
            )
            r.raise_for_status()
            data = r.json()
            return {
                "answer": data.get("answer") or "",
                "results": [
                    {
                        "title": it.get("title") or "",
                        "url": it.get("url") or "",
                        "content": (it.get("content") or "")[:600],
                    } for it in (data.get("results") or [])[:max_results]
                ],
                "query": query,
            }
    except Exception as e:
        logger.warning("tavily search failed for %s: %s", query, e)
        return None


async def _load_neo_memories(user_id: str, limit: int = 5) -> List[dict]:
    """Return the user's most recent persistent memories (for injection)."""
    cursor = db.neo_memory.find(
        {"user_id": user_id},
        {"_id": 0, "memory_id": 1, "summary": 1, "facts": 1, "created_at": 1},
    ).sort("created_at", -1).limit(limit)
    return [m async for m in cursor]


async def _maybe_save_memory(user_id: str, session_id: str, assistant_name: str) -> None:
    """After a chat exchange, decide whether to distill the session into a
    long-lived memory row. We only save when the session has >= 6 messages
    (3 user + 3 assistant) AND has not already been persisted in the last
    10 minutes for this session_id."""
    total = await db.assistant_messages.count_documents({
        "user_id": user_id, "session_id": session_id,
    })
    if total < 6:
        return
    recent = await db.neo_memory.find_one({
        "user_id": user_id, "session_id": session_id,
        "created_at": {"$gte": utcnow() - timedelta(minutes=10)},
    })
    if recent:
        return
    # Collect last 12 turns
    cursor = db.assistant_messages.find(
        {"user_id": user_id, "session_id": session_id},
        {"_id": 0, "role": 1, "content": 1},
    ).sort("created_at", -1).limit(12)
    msgs = [m async for m in cursor]
    msgs.reverse()
    if not msgs:
        return
    convo = "\n".join(f"{m['role'].upper()}: {m['content']}" for m in msgs)
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        return
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(
            api_key=key,
            session_id=f"memory_{session_id}",
            system_message=(
                "Sei un motore di distillazione della memoria per un CRM italiano. "
                "Ricevi una conversazione tra un utente (Consulente Energia) e l'assistente "
                f"{assistant_name}. Estrai i FATTI DUREVOLI: clienti menzionati, decisioni prese, "
                "analisi svolte, preferenze utente. Ignora scambi triviali (saluti, chiarimenti).\n"
                "Rispondi in JSON PURO nel formato:\n"
                "{\"summary\": \"riassunto in 1-2 frasi (max 200 caratteri)\", "
                "\"facts\": [\"fatto 1 conciso\", \"fatto 2 conciso\", ...]}\n"
                "Se la conversazione è banale (solo saluti/chiarimenti) rispondi "
                "{\"summary\": \"\", \"facts\": []}. "
                "Massimo 8 fatti, ciascuno < 120 caratteri."
            ),
        ).with_model("anthropic", "claude-haiku-4-5")
        raw = await chat.send_message(UserMessage(text=convo))
        raw_clean = (raw or "").strip()
        # LLM sometimes wraps JSON in code fences
        if raw_clean.startswith("```"):
            raw_clean = raw_clean.strip("`")
            if raw_clean.startswith("json"):
                raw_clean = raw_clean[4:]
            raw_clean = raw_clean.strip()
        parsed = _json_stdlib.loads(raw_clean)
        summary = (parsed.get("summary") or "").strip()
        facts = [str(f).strip() for f in (parsed.get("facts") or []) if str(f).strip()]
        if not summary and not facts:
            return
        await db.neo_memory.insert_one({
            "memory_id": f"mem_{uuid.uuid4().hex[:12]}",
            "user_id": user_id,
            "session_id": session_id,
            "summary": summary[:220],
            "facts": facts[:8],
            "created_at": utcnow(),
            "updated_at": utcnow(),
        })
    except Exception as e:
        logger.warning("_maybe_save_memory failed: %s", e)



@api_router.post("/assistant/chat")
async def assistant_chat(body: AssistantChatIn, user=Depends(get_current_user)):
    """Personal AI assistant. Uses Claude Sonnet 5 via Emergent LLM Key.
    Fetches user's CRM snapshot and answers questions in Italian.
    """
    msg = (body.message or "").strip()
    if not msg:
        raise HTTPException(status_code=400, detail="Messaggio vuoto")
    if len(msg) > 4000:
        raise HTTPException(status_code=400, detail="Messaggio troppo lungo (max 4000 caratteri)")

    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY non configurato")

    assistant_name = await _get_assistant_name(user)
    session_id = body.session_id or f"asst_{user['user_id']}_{uuid.uuid4().hex[:10]}"

    # Load recent conversation history from DB (last 12 messages)
    hist_cursor = db.assistant_messages.find(
        {"user_id": user["user_id"], "session_id": session_id},
        {"_id": 0, "role": 1, "content": 1, "created_at": 1},
    ).sort("created_at", -1).limit(12)
    history = [h async for h in hist_cursor]
    history.reverse()

    # Build CRM context snapshot
    try:
        context = await _build_assistant_context(user)
    except Exception as e:
        context = {"error": f"Impossibile caricare i dati CRM: {e}"}

    # Detect weather intent and prefetch data if a city is mentioned
    weather_ctx: Optional[dict] = None
    weather_city = _detect_weather_query(msg)
    if weather_city and weather_city != "?":
        weather_ctx = await _fetch_weather(weather_city)

    # V38T — Detect energy market intent and prefetch data via Tavily
    web_search_ctx: Optional[dict] = None
    used_web_search = False
    if _detect_energy_query(msg):
        web_search_ctx = await _tavily_search(msg)
        if web_search_ctx and (web_search_ctx.get("answer") or web_search_ctx.get("results")):
            used_web_search = True

    # V38T — Load persistent memories for this user
    memories = await _load_neo_memories(user["user_id"], limit=5)

    import json as _json
    ctx_json = _json.dumps(context, ensure_ascii=False, default=str)
    # Trim if too large (Claude Sonnet accepts a lot but let's be safe)
    if len(ctx_json) > 25000:
        ctx_json = ctx_json[:25000] + "\n... (dati troncati)"

    weather_section = ""
    if weather_ctx is not None:
        weather_section = (
            "\n\nMETEO (dati aggiornati, timezone Europe/Rome):\n"
            f"{_json.dumps(weather_ctx, ensure_ascii=False, default=str)}\n"
            "Usa questi dati per rispondere in modo naturale alla domanda meteo. "
            "Se l'utente chiede un momento specifico (oggi pomeriggio, domani mattina, ecc.) "
            "cita la temperatura, la condizione (es. sereno, pioggia leggera) e la probabilità di pioggia se rilevante.\n"
        )
    elif weather_city == "?":
        weather_section = (
            "\n\nAVVISO: L'utente sembra chiedere del meteo ma non ha specificato una città. "
            "Chiedi cortesemente per quale città.\n"
        )

    # V38T — Inject web-search results when energy topic detected
    web_section = ""
    if web_search_ctx and used_web_search:
        web_section = (
            "\n\nRICERCA WEB AGGIORNATA (dati reali dal mercato energetico italiano):\n"
            f"Query utente: {web_search_ctx.get('query')}\n"
            f"Risposta sintetizzata (Tavily): {web_search_ctx.get('answer') or 'nessuna sintesi'}\n"
            "Fonti primarie (usa questi contenuti come base per la tua risposta):\n"
        )
        for i, r in enumerate(web_search_ctx.get("results", [])[:5], 1):
            web_section += f"[{i}] {r.get('title')} — {r.get('url')}\n{r.get('content')}\n\n"
        web_section += (
            "REGOLE per usare questi dati:\n"
            "- Cita i numeri esatti (€/MWh, €/kWh, mesi, delibere ARERA con numero e data).\n"
            "- NON rimandare l'utente a siti esterni. Rispondi TU con la risposta.\n"
            "- Se i dati sono aggiornati a un mese specifico, dillo (es. 'PUN novembre 2026').\n"
            "- Se la ricerca non ha trovato dati precisi, dillo apertamente.\n"
        )

    # V38T — Inject long-term memory
    memory_section = ""
    if memories:
        memory_section = "\n\nMEMORIA PERSISTENTE (contesto delle conversazioni precedenti):\n"
        for m in memories:
            memory_section += f"- {m.get('summary', '')}\n"
            for f in (m.get("facts") or []):
                memory_section += f"  • {f}\n"
        memory_section += "\nUsa la memoria per personalizzare le risposte, ma non citare esplicitamente 'ricordo che...' a meno che sia utile.\n"

    system_message = (
        f"Sei {assistant_name}, l'assistente personale AI del CRM di {user.get('name', 'utente')}, "
        "consulente energetico e networker in Italia.\n\n"
        "REGOLE:\n"
        "- Rispondi SEMPRE in italiano, tono professionale ma amichevole.\n"
        "- Per domande CRM usa esclusivamente i dati forniti (SNAPSHOT_CRM). Non inventare.\n"
        "- Se un dato non è nello snapshot, dillo chiaramente.\n"
        "- Per domande sul meteo usa i dati della sezione METEO (se presente).\n"
        "- Per dati di mercato energetico (PUN, ARERA, tariffe, oneri) usa la sezione RICERCA WEB e cita i numeri.\n"
        "- Formatta le liste con elenchi puntati chiari; usa nomi, orari, telefoni quando disponibili.\n"
        "- Le date sono in formato DD/MM/YYYY HH:MM (fuso orario locale italiano).\n"
        "- Sii conciso: risposte brevi e utili, evita preamboli lunghi.\n"
        "- Puoi dare consigli operativi basati sui dati (es. suggerire di chiamare clienti senza appuntamento).\n\n"
        f"ORA ATTUALE: {context.get('ora_attuale', '')}\n\n"
        "SNAPSHOT_CRM (JSON):\n"
        f"{ctx_json}\n"
        f"{weather_section}"
        f"{web_section}"
        f"{memory_section}"
    )

    from emergentintegrations.llm.chat import LlmChat, UserMessage
    chat = LlmChat(
        api_key=key,
        session_id=session_id,
        system_message=system_message,
    ).with_model("anthropic", "claude-sonnet-5")

    # Replay history so multi-turn works (LlmChat keeps internal state but we start fresh each request)
    # We prepend history summary to the current user message for continuity
    if history:
        convo_text = ""
        for h in history[-10:]:
            role = "Utente" if h["role"] == "user" else assistant_name
            convo_text += f"{role}: {h['content']}\n"
        user_prompt = (
            f"Conversazione precedente:\n{convo_text}\n"
            f"---\nNuovo messaggio dell'utente: {msg}"
        )
    else:
        user_prompt = msg

    try:
        reply = await chat.send_message(UserMessage(text=user_prompt))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Errore LLM: {e}")

    reply_text = (reply or "").strip() or "Non ho ricevuto una risposta. Riprova."

    now = utcnow()
    # Persist both messages
    await db.assistant_messages.insert_many([
        {"user_id": user["user_id"], "session_id": session_id, "role": "user", "content": msg, "created_at": now},
        {"user_id": user["user_id"], "session_id": session_id, "role": "assistant", "content": reply_text, "created_at": utcnow()},
    ])

    # V38T — Fire-and-forget memory distillation (does not block the response)
    try:
        asyncio.create_task(_maybe_save_memory(user["user_id"], session_id, assistant_name))
    except Exception:
        pass

    return {
        "session_id": session_id,
        "reply": reply_text,
        "assistant_name": assistant_name,
        "used_web_search": used_web_search,
        "web_sources": [
            {"title": r.get("title"), "url": r.get("url")}
            for r in (web_search_ctx.get("results", []) if web_search_ctx else [])
        ][:5] if used_web_search else [],
    }


@api_router.get("/assistant/history")
async def assistant_history(session_id: Optional[str] = None, user=Depends(get_current_user)):
    """Load conversation history. If session_id not given, returns latest session."""
    if not session_id:
        # Find latest session
        latest = await db.assistant_messages.find_one(
            {"user_id": user["user_id"]},
            {"session_id": 1},
            sort=[("created_at", -1)],
        )
        if not latest:
            return {"session_id": None, "messages": [], "assistant_name": await _get_assistant_name(user)}
        session_id = latest["session_id"]

    cursor = db.assistant_messages.find(
        {"user_id": user["user_id"], "session_id": session_id},
        {"_id": 0, "role": 1, "content": 1, "created_at": 1},
    ).sort("created_at", 1).limit(100)
    msgs = [m async for m in cursor]
    return {
        "session_id": session_id,
        "messages": msgs,
        "assistant_name": await _get_assistant_name(user),
    }


@api_router.post("/assistant/reset")
async def assistant_reset(user=Depends(get_current_user)):
    """Start a new conversation. Old sessions remain in DB but a new session_id is issued."""
    session_id = f"asst_{user['user_id']}_{uuid.uuid4().hex[:10]}"
    return {"session_id": session_id, "assistant_name": await _get_assistant_name(user)}


# ============================================================
# V38T — Neo persistent memory endpoints
# ============================================================
@api_router.get("/assistant/memory")
async def list_neo_memories(user=Depends(get_current_user)):
    """List all persistent memories saved by Neo for the current user."""
    cursor = db.neo_memory.find(
        {"user_id": user["user_id"]},
        {"_id": 0, "memory_id": 1, "summary": 1, "facts": 1, "created_at": 1, "session_id": 1},
    ).sort("created_at", -1).limit(200)
    items = [m async for m in cursor]
    return {"items": items, "total": len(items)}


@api_router.delete("/assistant/memory/{memory_id}")
async def delete_neo_memory(memory_id: str, user=Depends(get_current_user)):
    res = await db.neo_memory.delete_one({"user_id": user["user_id"], "memory_id": memory_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Memoria non trovata")
    return {"deleted": True, "memory_id": memory_id}


@api_router.delete("/assistant/memory")
async def clear_all_neo_memories(user=Depends(get_current_user)):
    res = await db.neo_memory.delete_many({"user_id": user["user_id"]})
    return {"deleted_count": res.deleted_count}


class SaveNeoResponseIn(BaseModel):
    content: str
    name: str
    session_id: Optional[str] = None
    category: Optional[str] = "notes"  # notes | files | analisi


@api_router.post("/assistant/save-to-master")
async def save_neo_response_to_master(body: SaveNeoResponseIn, user=Depends(get_current_user)):
    """V38T — Persist a Neo response as a text/markdown file in the Master's
    file cabinet. Used by the "Salva nei file Master" button in the assistant."""
    content = (body.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Contenuto vuoto")
    name = (body.name or "").strip() or f"Neo-{datetime.now().strftime('%Y%m%d-%H%M')}"
    if not name.lower().endswith((".txt", ".md", ".html")):
        name = f"{name}.md"
    category = body.category if body.category in ALLOWED_MASTER_CATS else "notes"
    b64 = base64.b64encode(content.encode("utf-8")).decode("ascii")
    file_id = f"mf_{uuid.uuid4().hex[:12]}"
    mime = "text/markdown" if name.endswith(".md") else ("text/html" if name.endswith(".html") else "text/plain")
    doc = {
        "file_id": file_id,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        "category": category,
        "name": name,
        "title": f"Risposta Neo — {name}",
        "body": content if len(content) < 2000 else content[:2000] + "…",
        "mime": mime,
        "data_base64": b64,
        "size": len(content.encode("utf-8")),
        "created_at": utcnow(),
        "updated_at": utcnow(),
        "source": "neo-assistant",
        "source_session_id": body.session_id,
    }
    await db.master_files.insert_one(doc)
    return {"file_id": file_id, "name": name, "category": category, "size": doc["size"]}





@api_router.post("/assistant/tts")
async def assistant_tts(body: AssistantTTSIn, user=Depends(get_current_user)):
    """Convert assistant reply text to speech using OpenAI TTS via Emergent LLM Key."""
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Testo mancante")
    if len(text) > 4000:
        text = text[:4000]
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY non configurato")
    voice = (body.voice or "").strip().lower()
    if voice not in {"alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"}:
        # try user setting fallback
        s = await db.user_settings.find_one({"user_id": user["user_id"]}, {"assistant_voice": 1}) or {}
        voice = (s.get("assistant_voice") or "nova").lower()
        if voice not in {"alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"}:
            voice = "nova"
    try:
        from emergentintegrations.llm.openai.text_to_speech import OpenAITextToSpeech
        tts = OpenAITextToSpeech(api_key=key)
        b64 = await tts.generate_speech_base64(text=text, model="tts-1", voice=voice, response_format="mp3")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Errore TTS: {e}")
    return {"audio_base64": b64, "mime": "audio/mpeg", "voice": voice}


# =========================
# Health
# =========================
@api_router.get("/")
async def root():
    return {"message": "ProSync CRM API", "ok": True}


# =========================
# V38H — AI Birthday message generator
# =========================
class BirthdayGenIn(BaseModel):
    contact_id: str
    is_active_client: Optional[bool] = None  # override; if None uses stored value

@api_router.post("/contacts/{contact_id}/birthday/generate-message")
async def generate_birthday_message(contact_id: str, user=Depends(get_current_user)):
    """Generate a fresh, human-sounding birthday message using Claude Sonnet 5.
    The message uses the contact's first name and varies year over year. If the
    contact is marked as active client (`is_active_client=True`) the message also
    thanks them for their continued trust and invites them to reach out."""
    contact = await _ensure_contact_owned(contact_id, user)
    first_name = (contact.get("first_name") or "").strip() or "Cliente"
    is_active = bool(contact.get("is_active_client"))
    year = datetime.now(timezone.utc).year

    from emergentintegrations.llm.chat import LlmChat, UserMessage
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY non configurato")

    # Include prior years' generated messages to encourage variation
    prior = await db.birthday_messages.find(
        {"user_id": tenant_id(user), "contact_id": contact_id},
        {"_id": 0, "year": 1, "message": 1},
    ).sort("year", -1).limit(3).to_list(3)
    prior_txt = ""
    if prior:
        prior_txt = "\n\nMessaggi degli anni precedenti (NON riscriverli, cambia stile e parole):\n" + "\n".join(
            [f"- {p['year']}: {p.get('message', '')[:200]}" for p in prior]
        )

    system = (
        "Sei un consulente energetico italiano che scrive messaggi di auguri "
        "di compleanno personalizzati ai propri clienti. Il messaggio deve essere:\n"
        "- Caldo, sincero e personale — MAI generico o da spam\n"
        "- Breve (3-6 frasi, massimo 500 caratteri totali)\n"
        "- Scritto in prima persona come consulente\n"
        "- Con un tocco di originalità (metafora, ricordo simbolico, riferimento alla stagione, alla città…)\n"
        "- Firmato genericamente 'Il tuo Consulente' o simile (non usare un nome specifico)\n"
        "- Diverso dai messaggi degli anni scorsi\n"
        "Rispondi solo con il testo del messaggio, senza intestazioni né virgolette."
    )
    user_prompt = (
        f"Genera il messaggio di auguri di compleanno {year} per {first_name}."
        + (
            "\n\nQuesto cliente è ATTIVO: ringrazialo brevemente per la continua fiducia "
            "e invita gentilmente a contattarti per qualsiasi dubbio o consulenza — senza forzare la vendita."
            if is_active else
            "\n\nNon è più un cliente attivo: mantieni il messaggio cordiale e cortese, senza riferimenti commerciali."
        )
        + prior_txt
    )

    chat = LlmChat(
        api_key=key,
        session_id=f"bday-{contact_id}-{year}",
        system_message=system,
    ).with_model("anthropic", "claude-sonnet-5")

    try:
        resp = await chat.send_message(UserMessage(text=user_prompt))
        message = (resp or "").strip().strip('"').strip("'")
        if not message:
            raise Exception("Messaggio vuoto")
        # Trim overly long output
        if len(message) > 800:
            message = message[:800].rsplit(".", 1)[0] + "."
    except Exception as e:
        logger.exception(f"birthday gen failed: {e}")
        raise HTTPException(status_code=500, detail=f"Impossibile generare il messaggio: {str(e)[:200]}")

    # Persist so future generations can vary from it
    await db.birthday_messages.insert_one({
        "user_id": tenant_id(user),
        "contact_id": contact_id,
        "year": year,
        "message": message,
        "is_active_client": is_active,
        "created_at": utcnow(),
    })
    return {"message": message, "year": year, "is_active_client": is_active}


@api_router.get("/contacts/{contact_id}/birthday/history")
async def birthday_history(contact_id: str, user=Depends(get_current_user)):
    """Return previously generated birthday messages for a contact."""
    await _ensure_contact_owned(contact_id, user)
    items = await db.birthday_messages.find(
        {"user_id": tenant_id(user), "contact_id": contact_id},
        {"_id": 0},
    ).sort("year", -1).limit(10).to_list(10)
    return {"items": items}


# =========================
# v2.10 (Feb 2026) — Event Banners
# Master can create a homepage banner for a scheduled event. Banner has cover,
# title, event date, program (uploaded PDF or AI-generated HTML), and per-user /
# per-contact / per-group visibility. Team collaborators see it in their home.
# Contacts can view via a public link (no auth). Countdown rendered client-side.
# =========================

class EventBannerIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    event_at: datetime
    event_end_at: Optional[datetime] = None  # v2.18 — optional end date for ranges
    description: Optional[str] = None  # v2.18 — free-text description
    cover_base64: str = Field(min_length=10)
    cover_mime: str = "image/jpeg"
    program_pdf_base64: Optional[str] = None
    program_pdf_name: Optional[str] = None
    program_html: Optional[str] = None  # AI-generated OR manually provided
    # v2.18 — Optional audio attachment (announcement/promo voice message)
    audio_base64: Optional[str] = None
    audio_mime: Optional[str] = None  # audio/mpeg | audio/mp4 | audio/wav | audio/m4a
    audio_name: Optional[str] = None
    # Visibility
    visibility_kind: str = "all"  # "all" | "specific"
    visible_user_ids: List[str] = Field(default_factory=list)
    visible_contact_ids: List[str] = Field(default_factory=list)
    visible_group_ids: List[str] = Field(default_factory=list)


class EventBannerUpdate(BaseModel):
    title: Optional[str] = None
    event_at: Optional[datetime] = None
    event_end_at: Optional[datetime] = None
    description: Optional[str] = None
    cover_base64: Optional[str] = None
    cover_mime: Optional[str] = None
    program_pdf_base64: Optional[str] = None
    program_pdf_name: Optional[str] = None
    program_html: Optional[str] = None
    audio_base64: Optional[str] = None
    audio_mime: Optional[str] = None
    audio_name: Optional[str] = None
    visibility_kind: Optional[str] = None
    visible_user_ids: Optional[List[str]] = None
    visible_contact_ids: Optional[List[str]] = None
    visible_group_ids: Optional[List[str]] = None


def _ensure_master(user: dict):
    """Only the master (owner/no parent) or admin can manage event banners."""
    role = user.get("role") or "member"
    if role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Solo il master può gestire gli eventi")


def _event_visible_to_user(banner: dict, user: dict) -> bool:
    """Team-member visibility check. Master (owner) always sees own banners."""
    if banner.get("user_id") != tenant_id(user):
        return False
    if banner.get("visibility_kind", "all") == "all":
        return True
    uids = banner.get("visible_user_ids") or []
    return user.get("user_id") in uids or user.get("role") == "owner"


def _strip_banner_heavy(b: dict) -> dict:
    """Return a light copy without cover/PDF base64 blobs for list endpoints."""
    out = {k: v for k, v in b.items() if k not in ("cover_base64", "program_pdf_base64", "program_html")}
    out["_id"] = None
    strip_id(out)
    return out


@api_router.post("/event-banners")
async def create_event_banner(body: EventBannerIn, user=Depends(get_current_user)):
    _ensure_master(user)
    if body.visibility_kind not in ("all", "specific"):
        raise HTTPException(status_code=400, detail="visibility_kind non valido")
    event_id = f"evt_{uuid.uuid4().hex[:12]}"
    public_token = uuid.uuid4().hex
    doc = {
        "event_id": event_id,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        "title": body.title.strip(),
        "event_at": body.event_at,
        "event_end_at": body.event_end_at,  # v2.18
        "description": (body.description or "").strip() or None,  # v2.18
        "cover_base64": body.cover_base64,
        "cover_mime": body.cover_mime or "image/jpeg",
        "program_pdf_base64": body.program_pdf_base64,
        "program_pdf_name": body.program_pdf_name,
        "program_html": body.program_html,
        "audio_base64": body.audio_base64,  # v2.18
        "audio_mime": body.audio_mime,
        "audio_name": body.audio_name,
        "visibility_kind": body.visibility_kind,
        "visible_user_ids": body.visible_user_ids or [],
        "visible_contact_ids": body.visible_contact_ids or [],
        "visible_group_ids": body.visible_group_ids or [],
        "public_token": public_token,
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.event_banners.insert_one(doc)
    return {"ok": True, "event_id": event_id, "public_token": public_token}


@api_router.get("/event-banners")
async def list_event_banners(user=Depends(get_current_user)):
    """Master view: list all banners in tenant (light)."""
    _ensure_master(user)
    items = await db.event_banners.find(
        {"user_id": tenant_id(user)},
        {"_id": 0, "cover_base64": 0, "program_pdf_base64": 0, "program_html": 0},
    ).sort("event_at", -1).to_list(200)
    return {"items": items}


@api_router.get("/event-banners/active")
async def list_active_event_banners(user=Depends(get_current_user)):
    """Any authenticated user (master + collaborators) can call this to fetch
    the banners currently visible to them (event_at in future, visibility ok).
    Returns light payload (cover_base64 included for rendering, no PDF/HTML/audio)."""
    now = utcnow()
    # V27 fix — show banners that are UPCOMING (event_at in future) OR ONGOING
    # (event_at in past but event_end_at in future OR within 24h grace period).
    # This fixes the bug where Master-created banners with "TUTTI" didn't appear
    # if their event_at was already reached.
    grace_cutoff = now - timedelta(hours=24)
    all_banners = await db.event_banners.find(
        {
            "user_id": tenant_id(user),
            "$or": [
                {"event_at": {"$gte": now}},
                {"event_end_at": {"$gte": now}},
                {"event_at": {"$gte": grace_cutoff}, "event_end_at": None},
            ],
        },
        {"_id": 0, "program_pdf_base64": 0, "program_html": 0, "audio_base64": 0},
    ).sort("event_at", 1).to_list(50)
    visible = [b for b in all_banners if _event_visible_to_user(b, user)]
    return {"items": visible}


@api_router.get("/event-banners/{event_id}")
async def get_event_banner(event_id: str, user=Depends(get_current_user)):
    b = await db.event_banners.find_one(
        {"user_id": tenant_id(user), "event_id": event_id},
        {"_id": 0, "audio_base64": 0},  # v2.18 — audio via dedicated /audio endpoint
    )
    if not b:
        raise HTTPException(status_code=404, detail="Evento non trovato")
    if not _event_visible_to_user(b, user):
        raise HTTPException(status_code=403, detail="Non hai accesso a questo evento")
    # v2.18 — Expose a boolean "has_audio" flag so UI can toggle the playback button
    b["has_audio"] = False
    audio_check = await db.event_banners.find_one(
        {"event_id": event_id}, {"_id": 0, "audio_base64": 1}
    )
    if audio_check and audio_check.get("audio_base64"):
        b["has_audio"] = True
    return b


@api_router.put("/event-banners/{event_id}")
async def update_event_banner(event_id: str, body: EventBannerUpdate, user=Depends(get_current_user)):
    _ensure_master(user)
    # v2.18 — audio/program fields must be settable to None (to clear them)
    _nullable_ok = ("program_pdf_base64", "program_pdf_name", "program_html",
                    "audio_base64", "audio_mime", "audio_name",
                    "event_end_at", "description")
    upd = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None or k in _nullable_ok}
    upd["updated_at"] = utcnow()
    r = await db.event_banners.update_one(
        {"user_id": tenant_id(user), "event_id": event_id},
        {"$set": upd},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Evento non trovato")
    return {"ok": True}


@api_router.delete("/event-banners/{event_id}")
async def delete_event_banner(event_id: str, user=Depends(get_current_user)):
    _ensure_master(user)
    r = await db.event_banners.delete_one({"user_id": tenant_id(user), "event_id": event_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Evento non trovato")
    return {"ok": True}


class EventProgramAIIn(BaseModel):
    description: str = ""
    duration_hint: Optional[str] = None  # e.g. "mezza giornata", "sera"


@api_router.post("/event-banners/{event_id}/generate-program")
async def generate_event_program(event_id: str, body: EventProgramAIIn, user=Depends(get_current_user)):
    """Ask Claude to draft a professional event program in Italian (HTML),
    then store it on the banner for later viewing / sharing."""
    _ensure_master(user)
    b = await db.event_banners.find_one({"user_id": tenant_id(user), "event_id": event_id})
    if not b:
        raise HTTPException(status_code=404, detail="Evento non trovato")
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM non disponibile: {e}")
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY non configurato")

    when_str = b["event_at"].strftime("%d/%m/%Y ore %H:%M")
    system = (
        "Sei un event manager professionista italiano. Redigi un programma d'evento "
        "chiaro, ben strutturato, in HTML pulito (usa <h2>, <h3>, <ul>, <li>, <p>). "
        "Includi: intro/benvenuto, obiettivi, agenda con orari, relatori (se applicabile), "
        "networking/pausa, chiusura. Tono professionale ma caloroso. NON usare markdown. "
        "Rispondi SOLO con l'HTML dell'evento (nessuna intro, nessun code fence)."
    )
    prompt = (
        f"Titolo evento: {b['title']}\n"
        f"Data e ora: {when_str}\n"
        f"Descrizione libera: {(body.description or '').strip() or '—'}\n"
        f"Durata prevista: {(body.duration_hint or '').strip() or 'non specificata'}\n\n"
        "Crea l'HTML del programma dell'evento."
    )
    chat = LlmChat(
        api_key=key,
        session_id=f"event-program-{event_id}",
        system_message=system,
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")
    try:
        raw = await chat.send_message(UserMessage(text=prompt))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Errore LLM: {e}")
    html_body = (raw or "").strip()
    # Escape only the title to avoid HTML injection
    def _esc(s: str) -> str:
        return (str(s or "")
                .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace('"', "&quot;").replace("'", "&#39;"))
    full = f"""<!doctype html>
<html lang="it"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{_esc(b['title'])} — Programma</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0F172A; margin: 0; padding: 0; background: #F8FAFC; }}
  .wrap {{ max-width: 780px; margin: 0 auto; padding: 24px 20px 48px; background: #FFF; }}
  h1 {{ font-size: 24px; margin: 0 0 4px; color: #0F172A; }}
  .when {{ color: #64748B; font-size: 13px; margin-bottom: 20px; }}
  h2 {{ font-size: 17px; color: #1E3A5F; margin-top: 22px; border-bottom: 1px solid #E2E8F0; padding-bottom: 4px; }}
  h3 {{ font-size: 14px; color: #334155; margin-top: 16px; }}
  ul {{ padding-left: 20px; }}
  li {{ margin-bottom: 4px; line-height: 1.5; font-size: 13px; }}
  p {{ line-height: 1.6; font-size: 13px; }}
</style></head><body>
<div class="wrap">
  <h1>{_esc(b['title'])}</h1>
  <div class="when">{_esc(when_str)}</div>
  {html_body}
</div>
</body></html>"""
    await db.event_banners.update_one(
        {"event_id": event_id},
        {"$set": {"program_html": full, "updated_at": utcnow()}},
    )
    return {"ok": True, "program_html": full}


@api_router.get("/event-banners/{event_id}/audio")
async def get_event_audio(event_id: str, user=Depends(get_current_user)):
    """v2.18 — Return the audio attachment for an event (if present)."""
    b = await db.event_banners.find_one(
        {"user_id": tenant_id(user), "event_id": event_id},
        {"_id": 0, "audio_base64": 1, "audio_mime": 1, "audio_name": 1, "user_id": 1, "visibility_kind": 1, "visible_user_ids": 1},
    )
    if not b:
        raise HTTPException(status_code=404, detail="Evento non trovato")
    if not _event_visible_to_user(b, user):
        raise HTTPException(status_code=403, detail="Non hai accesso a questo evento")
    if not b.get("audio_base64"):
        raise HTTPException(status_code=404, detail="Nessuna audio-registrazione allegata")
    return {
        "name": b.get("audio_name") or "audio.m4a",
        "mime": b.get("audio_mime") or "audio/mp4",
        "data_base64": b["audio_base64"],
    }


@api_router.get("/event-banners/{event_id}/program")
async def get_event_program(event_id: str, user=Depends(get_current_user)):
    """Return the program (PDF or HTML) for viewing/sharing."""
    b = await db.event_banners.find_one(
        {"user_id": tenant_id(user), "event_id": event_id},
        {"_id": 0},
    )
    if not b:
        raise HTTPException(status_code=404, detail="Evento non trovato")
    if not _event_visible_to_user(b, user):
        raise HTTPException(status_code=403, detail="Non hai accesso a questo evento")
    if b.get("program_pdf_base64"):
        return {
            "kind": "pdf",
            "name": b.get("program_pdf_name") or f"Programma-{b['title']}.pdf",
            "mime": "application/pdf",
            "data_base64": b["program_pdf_base64"],
        }
    if b.get("program_html"):
        import base64 as _b64
        html = b["program_html"]
        return {
            "kind": "html",
            "name": f"Programma-{b['title']}.html",
            "mime": "text/html",
            "data_base64": _b64.b64encode(html.encode("utf-8")).decode("ascii"),
        }
    raise HTTPException(status_code=404, detail="Nessun programma disponibile per questo evento")


def _extract_best_image_from_pdf(pdf_b64: str) -> Optional[Tuple[bytes, str]]:
    """v2.11 — Extract the "most significant" image from a PDF and return
    (jpeg_bytes, mime) resized to a banner-friendly 16:9 (1600x900).

    Strategy:
      1. Iterate all embedded images across pages (PyMuPDF `get_images`)
      2. Score each by area (w*h) — larger = more likely to be the hero image
      3. Also render the first page at 2x as fallback if no embedded images
         are found (e.g. text-only PDFs with vector cover)
      4. Center-crop the winner to 16:9 aspect and resize to 1600x900
      5. Return JPEG bytes at quality 85
    """
    import base64 as _b64
    import io
    try:
        import fitz  # PyMuPDF
        from PIL import Image
    except Exception as e:
        logger.warning("PDF cover extraction deps missing: %s", e)
        return None

    try:
        raw = _b64.b64decode(pdf_b64.split(",", 1)[-1])
        doc = fitz.open(stream=raw, filetype="pdf")
    except Exception as e:
        logger.warning("PDF open failed: %s", e)
        return None

    best_bytes: Optional[bytes] = None
    best_area = 0

    try:
        # Pass 1 — embedded raster images
        for page_index in range(min(len(doc), 8)):
            page = doc[page_index]
            for img in page.get_images(full=True):
                xref = img[0]
                try:
                    pix = fitz.Pixmap(doc, xref)
                    # Skip masks / tiny thumbnails
                    if pix.width < 200 or pix.height < 200:
                        pix = None
                        continue
                    area = pix.width * pix.height
                    if area > best_area:
                        # Convert CMYK / alpha to RGB before saving
                        if pix.n >= 5:
                            pix = fitz.Pixmap(fitz.csRGB, pix)
                        best_bytes = pix.tobytes("png")
                        best_area = area
                    pix = None
                except Exception:
                    continue
        # Pass 2 — fallback: rasterize first page at 2x if nothing worthwhile
        if best_bytes is None and len(doc) > 0:
            page = doc[0]
            mat = fitz.Matrix(2.0, 2.0)
            pix = page.get_pixmap(matrix=mat, alpha=False)
            best_bytes = pix.tobytes("png")
            best_area = pix.width * pix.height
    finally:
        doc.close()

    if not best_bytes:
        return None

    # Load with Pillow → center-crop 16:9 → resize 1600x900 → JPEG
    try:
        im = Image.open(io.BytesIO(best_bytes)).convert("RGB")
        target_ratio = 16 / 9
        w, h = im.size
        cur_ratio = w / h
        if cur_ratio > target_ratio:
            # Too wide → crop sides
            new_w = int(h * target_ratio)
            x0 = (w - new_w) // 2
            im = im.crop((x0, 0, x0 + new_w, h))
        elif cur_ratio < target_ratio:
            # Too tall → crop top/bottom
            new_h = int(w / target_ratio)
            y0 = (h - new_h) // 2
            im = im.crop((0, y0, w, y0 + new_h))
        im = im.resize((1600, 900), Image.LANCZOS)
        out = io.BytesIO()
        im.save(out, "JPEG", quality=85, optimize=True)
        return out.getvalue(), "image/jpeg"
    except Exception as e:
        logger.warning("Pillow resize failed: %s", e)
        return None


class EventCoverExtractIn(BaseModel):
    # If True (default), persist the extracted cover on the event.
    apply: bool = True


@api_router.post("/event-banners/{event_id}/extract-cover-from-pdf")
async def extract_event_cover_from_pdf(event_id: str, body: EventCoverExtractIn, user=Depends(get_current_user)):
    """v2.11 — Extract the most significant image from the event's uploaded
    program PDF and either apply it as the banner cover (default) or preview it."""
    _ensure_master(user)
    b = await db.event_banners.find_one({"user_id": tenant_id(user), "event_id": event_id})
    if not b:
        raise HTTPException(status_code=404, detail="Evento non trovato")
    pdf_b64 = b.get("program_pdf_base64")
    if not pdf_b64:
        raise HTTPException(status_code=400, detail="Nessun PDF programma caricato. Carica il PDF prima di estrarre la copertina.")

    result = _extract_best_image_from_pdf(pdf_b64)
    if not result:
        raise HTTPException(status_code=422, detail="Impossibile estrarre un'immagine significativa dal PDF.")
    import base64 as _b64
    jpeg_bytes, mime = result
    cover_b64 = _b64.b64encode(jpeg_bytes).decode("ascii")

    if body.apply:
        await db.event_banners.update_one(
            {"event_id": event_id},
            {"$set": {"cover_base64": cover_b64, "cover_mime": mime, "updated_at": utcnow()}},
        )
    return {"ok": True, "applied": body.apply, "cover_base64": cover_b64, "cover_mime": mime, "size_bytes": len(jpeg_bytes)}


@app.get("/api/public/event-banners/{public_token}", response_class=HTMLResponse)
async def public_event_page(public_token: str):
    """Public page for contacts (no auth). Simple HTML with cover, title,
    countdown script, and inline program preview."""
    b = await db.event_banners.find_one({"public_token": public_token}, {"_id": 0})
    if not b:
        return HTMLResponse("<h1>Evento non trovato</h1>", status_code=404)
    title = (b.get("title") or "").replace("<", "&lt;")
    when_iso = b["event_at"].isoformat() if isinstance(b.get("event_at"), datetime) else str(b.get("event_at"))
    when_pretty = b["event_at"].strftime("%d/%m/%Y · %H:%M") if isinstance(b.get("event_at"), datetime) else ""
    cover = b.get("cover_base64") or ""
    cover_mime = b.get("cover_mime") or "image/jpeg"
    cover_src = f"data:{cover_mime};base64,{cover}" if cover else ""
    program_href = ""
    if b.get("program_pdf_base64"):
        program_href = f"data:application/pdf;base64,{b['program_pdf_base64']}"
    elif b.get("program_html"):
        import base64 as _b64
        program_href = "data:text/html;base64," + _b64.b64encode(b["program_html"].encode("utf-8")).decode("ascii")
    html = f"""<!doctype html>
<html lang="it"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{title}</title>
<style>
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0F172A; color: #FFF; min-height: 100vh; }}
  .hero {{ position: relative; width: 100%; height: 60vh; min-height: 340px; overflow: hidden; }}
  .hero img {{ width: 100%; height: 100%; object-fit: cover; }}
  .hero .overlay {{ position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.85) 100%); display: flex; flex-direction: column; justify-content: flex-end; padding: 28px 22px; }}
  h1 {{ font-size: 30px; margin: 0 0 6px; line-height: 1.15; text-shadow: 0 2px 8px rgba(0,0,0,0.6); }}
  .when {{ font-size: 15px; opacity: 0.85; margin-bottom: 16px; }}
  .cd {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; max-width: 460px; }}
  .cd .box {{ background: rgba(255,255,255,0.12); backdrop-filter: blur(6px); border-radius: 10px; padding: 10px 4px; text-align: center; }}
  .cd .n {{ font-size: 22px; font-weight: 800; line-height: 1.1; }}
  .cd .l {{ font-size: 10px; opacity: 0.8; text-transform: uppercase; letter-spacing: 0.4px; }}
  .actions {{ padding: 22px; text-align: center; }}
  .btn {{ display: inline-block; background: #F59E0B; color: #0F172A; text-decoration: none; font-weight: 800; padding: 12px 22px; border-radius: 10px; margin: 6px; box-shadow: 0 4px 12px rgba(245,158,11,0.35); }}
  .btn.sec {{ background: transparent; color: #FFF; border: 1px solid rgba(255,255,255,0.4); box-shadow: none; }}
</style></head><body>
<div class="hero">
  {'<img src="'+cover_src+'"/>' if cover_src else ''}
  <div class="overlay">
    <h1>{title}</h1>
    <div class="when">{when_pretty}</div>
    <div class="cd" id="cd">
      <div class="box"><div class="n" id="dd">—</div><div class="l">Giorni</div></div>
      <div class="box"><div class="n" id="hh">—</div><div class="l">Ore</div></div>
      <div class="box"><div class="n" id="mm">—</div><div class="l">Min</div></div>
      <div class="box"><div class="n" id="ss">—</div><div class="l">Sec</div></div>
    </div>
  </div>
</div>
<div class="actions">
  {'<a class="btn" href="'+program_href+'" target="_blank" rel="noopener">Apri il programma</a>' if program_href else ''}
</div>
<script>
  const target = new Date("{when_iso}").getTime();
  function pad(n){{ return String(n).padStart(2,"0"); }}
  function tick(){{
    const now = Date.now();
    let d = Math.max(0, target - now);
    const days = Math.floor(d/86400000); d -= days*86400000;
    const hh = Math.floor(d/3600000); d -= hh*3600000;
    const mm = Math.floor(d/60000); d -= mm*60000;
    const ss = Math.floor(d/1000);
    document.getElementById("dd").textContent = pad(days);
    document.getElementById("hh").textContent = pad(hh);
    document.getElementById("mm").textContent = pad(mm);
    document.getElementById("ss").textContent = pad(ss);
  }}
  tick(); setInterval(tick, 1000);
</script>
</body></html>"""
    return HTMLResponse(html)


# ================================================================
# V27 — Document Scanner (multi-page + auto-crop + PDF merge)
# ================================================================
class ScannerPageIn(BaseModel):
    data_base64: str
    mime: str  # image/jpeg | image/png | application/pdf


class ScannerMergeIn(BaseModel):
    pages: List[ScannerPageIn]
    enhance: bool = True
    autocrop: bool = True  # detect document borders + perspective correction
    grayscale: bool = False
    name: Optional[str] = None


def _cv2_scan_document(img_bytes: bytes, enhance: bool, autocrop: bool, grayscale: bool) -> bytes:
    """CamScanner-like pipeline on a single image using OpenCV.
    - EXIF-aware auto-orientation (via PIL)
    - Document edge detection + 4-point perspective warp (autocrop)
    - Adaptive contrast + sharpen (enhance)
    - Optional grayscale
    Returns JPEG bytes.
    """
    import cv2  # local import so absent cv2 doesn't crash the app on boot
    import numpy as np
    from PIL import Image, ImageOps

    # Auto-orient via PIL, then convert to CV2 BGR
    pil = Image.open(io.BytesIO(img_bytes))
    pil = ImageOps.exif_transpose(pil).convert("RGB")
    src = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
    h0, w0 = src.shape[:2]

    warped = src
    if autocrop:
        try:
            # 1. Downscale for speed
            ratio = 900.0 / max(h0, w0)
            small = cv2.resize(src, None, fx=ratio, fy=ratio) if ratio < 1 else src.copy()
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            gray = cv2.GaussianBlur(gray, (5, 5), 0)
            edges = cv2.Canny(gray, 60, 180)
            edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
            contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            contours = sorted(contours, key=cv2.contourArea, reverse=True)[:5]
            page_contour = None
            for c in contours:
                peri = cv2.arcLength(c, True)
                approx = cv2.approxPolyDP(c, 0.02 * peri, True)
                if len(approx) == 4 and cv2.contourArea(approx) > (small.shape[0] * small.shape[1] * 0.20):
                    page_contour = approx
                    break
            if page_contour is not None:
                pts = page_contour.reshape(4, 2).astype("float32") / (ratio if ratio < 1 else 1.0)
                # Sort corners: tl, tr, br, bl
                s = pts.sum(axis=1); diff = np.diff(pts, axis=1)
                tl = pts[np.argmin(s)]; br = pts[np.argmax(s)]
                tr = pts[np.argmin(diff)]; bl = pts[np.argmax(diff)]
                rect = np.array([tl, tr, br, bl], dtype="float32")
                wA = np.linalg.norm(br - bl); wB = np.linalg.norm(tr - tl)
                hA = np.linalg.norm(tr - br); hB = np.linalg.norm(tl - bl)
                maxW = int(max(wA, wB)); maxH = int(max(hA, hB))
                if maxW > 200 and maxH > 200:
                    dst = np.array([[0, 0], [maxW - 1, 0], [maxW - 1, maxH - 1], [0, maxH - 1]], dtype="float32")
                    M = cv2.getPerspectiveTransform(rect, dst)
                    warped = cv2.warpPerspective(src, M, (maxW, maxH))
        except Exception as _e:
            logger.warning("scanner autocrop failed: %s", _e)

    if enhance:
        try:
            # Contrast Limited Adaptive Histogram Equalization on luminance
            lab = cv2.cvtColor(warped, cv2.COLOR_BGR2LAB)
            l, a, b = cv2.split(lab)
            clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
            l = clahe.apply(l)
            warped = cv2.cvtColor(cv2.merge((l, a, b)), cv2.COLOR_LAB2BGR)
            # Unsharp mask for crisper text
            blur = cv2.GaussianBlur(warped, (0, 0), sigmaX=1.5)
            warped = cv2.addWeighted(warped, 1.5, blur, -0.5, 0)
        except Exception as _e:
            logger.warning("scanner enhance failed: %s", _e)

    if grayscale:
        try:
            g = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
            warped = cv2.cvtColor(g, cv2.COLOR_GRAY2BGR)
        except Exception:
            pass

    # Encode JPEG
    ok, buf = cv2.imencode(".jpg", warped, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
    if not ok:
        raise HTTPException(status_code=500, detail="Impossibile codificare l'immagine")
    return buf.tobytes()


@api_router.post("/scanner/merge-pdf")
async def scanner_merge_pdf(body: ScannerMergeIn, user=Depends(get_current_user)):
    """Enhance + merge multiple pages (images or PDFs) into a single PDF.
    Returns { pdf_base64, name, page_count }.
    """
    if not body.pages:
        raise HTTPException(status_code=400, detail="Nessuna pagina fornita")
    if len(body.pages) > 30:
        raise HTTPException(status_code=400, detail="Max 30 pagine per scansione")

    from PIL import Image
    import fitz  # PyMuPDF

    processed_images: List[Image.Image] = []
    for i, pg in enumerate(body.pages):
        try:
            raw = base64.b64decode(pg.data_base64.split(",")[-1] if pg.data_base64.startswith("data:") else pg.data_base64)
        except Exception:
            raise HTTPException(status_code=400, detail=f"Pagina {i + 1}: base64 non valido")
        mime = (pg.mime or "").lower()
        if mime == "application/pdf":
            # Rasterize each PDF page as an image at 200 DPI
            try:
                doc = fitz.open(stream=raw, filetype="pdf")
                for pn in range(doc.page_count):
                    page = doc.load_page(pn)
                    pix = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
                    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
                    processed_images.append(img)
                doc.close()
            except Exception as e:
                logger.warning("PDF rasterize fail: %s", e)
                raise HTTPException(status_code=400, detail=f"Pagina {i + 1}: PDF non valido")
        else:
            try:
                out = _cv2_scan_document(raw, enhance=body.enhance, autocrop=body.autocrop, grayscale=body.grayscale)
                processed_images.append(Image.open(io.BytesIO(out)).convert("RGB"))
            except HTTPException:
                raise
            except Exception as e:
                logger.warning("scan image fail: %s", e)
                # Fall back to raw image without processing
                try:
                    processed_images.append(Image.open(io.BytesIO(raw)).convert("RGB"))
                except Exception:
                    raise HTTPException(status_code=400, detail=f"Pagina {i + 1}: immagine non valida")

    if not processed_images:
        raise HTTPException(status_code=400, detail="Nessuna pagina elaborabile")

    # Merge into PDF using PIL
    buf = io.BytesIO()
    first, rest = processed_images[0], processed_images[1:]
    first.save(buf, format="PDF", save_all=True, append_images=rest, resolution=150.0)
    pdf_bytes = buf.getvalue()

    safe_name = (body.name or "Scansione").strip() or "Scansione"
    if not safe_name.lower().endswith(".pdf"):
        safe_name += ".pdf"
    return {
        "pdf_base64": base64.b64encode(pdf_bytes).decode(),
        "name": safe_name,
        "page_count": len(processed_images),
    }



# =========================================================================
# V27 — "Insegna all'AI" (Master-only knowledge base)
#   - Manual rules per category (luce | gas | telco) with optional PDF files
#   - URL watchlist refreshed via Tavily by frequency (daily/weekly/monthly)
#   - Content is prepended to bill-analysis system prompts as priority context
# =========================================================================

class AiTeachFileIn(BaseModel):
    name: str
    mime: str
    data_base64: str

class AiTeachRuleIn(BaseModel):
    category: Literal["luce", "gas", "telco"]
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1)
    files: List[AiTeachFileIn] = Field(default_factory=list)

class AiTeachRulePatch(BaseModel):
    category: Optional[Literal["luce", "gas", "telco"]] = None
    title: Optional[str] = None
    text: Optional[str] = None
    files: Optional[List[AiTeachFileIn]] = None

class AiTeachUrlIn(BaseModel):
    url: str = Field(min_length=1)
    name: str = Field(min_length=1, max_length=200)
    category: Optional[Literal["luce", "gas", "telco", "generic"]] = "generic"
    frequency: Literal["daily", "weekly", "monthly"] = "weekly"
    username: Optional[str] = None
    password: Optional[str] = None

class AiTeachUrlPatch(BaseModel):
    url: Optional[str] = None
    name: Optional[str] = None
    category: Optional[Literal["luce", "gas", "telco", "generic"]] = None
    frequency: Optional[Literal["daily", "weekly", "monthly"]] = None
    username: Optional[str] = None
    password: Optional[str] = None


def _require_master(user: Dict[str, Any]) -> None:
    """Only owners (Master) can access this feature."""
    if (user.get("role") or "member") != "owner":
        raise HTTPException(status_code=403, detail="Sezione riservata al Master")


@api_router.get("/ai-teach/rules")
async def ai_teach_list_rules(user=Depends(get_current_user)):
    _require_master(user)
    tid = tenant_id(user)
    cur = db.ai_teach_rules.find({"user_id": tid}).sort("updated_at", -1)
    items = []
    async for r in cur:
        r.pop("_id", None)
        # Strip file base64 from list (keep only metadata) — client fetches full file separately when needed
        r["files"] = [{"name": f.get("name"), "mime": f.get("mime"), "size": f.get("size", 0)} for f in (r.get("files") or [])]
        items.append(r)
    return {"items": items}


@api_router.post("/ai-teach/rules")
async def ai_teach_create_rule(body: AiTeachRuleIn, user=Depends(get_current_user)):
    _require_master(user)
    tid = tenant_id(user)
    rid = f"aitr_{uuid.uuid4().hex[:12]}"
    files = []
    for f in body.files:
        raw = f.data_base64.split(",")[-1] if f.data_base64.startswith("data:") else f.data_base64
        try:
            size = len(base64.b64decode(raw))
        except Exception:
            size = 0
        files.append({"name": f.name, "mime": f.mime, "data_base64": raw, "size": size})
    doc = {
        "rule_id": rid,
        "user_id": tid,
        "created_by": user["user_id"],
        "category": body.category,
        "title": body.title.strip(),
        "text": body.text.strip(),
        "files": files,
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.ai_teach_rules.insert_one(doc)
    doc.pop("_id", None)
    doc["files"] = [{"name": f["name"], "mime": f["mime"], "size": f["size"]} for f in files]
    return doc


@api_router.put("/ai-teach/rules/{rule_id}")
async def ai_teach_update_rule(rule_id: str, body: AiTeachRulePatch, user=Depends(get_current_user)):
    _require_master(user)
    tid = tenant_id(user)
    patch: Dict[str, Any] = {"updated_at": utcnow()}
    if body.category is not None: patch["category"] = body.category
    if body.title is not None: patch["title"] = body.title.strip()
    if body.text is not None: patch["text"] = body.text.strip()
    if body.files is not None:
        norm = []
        for f in body.files:
            raw = f.data_base64.split(",")[-1] if f.data_base64.startswith("data:") else f.data_base64
            try: size = len(base64.b64decode(raw))
            except Exception: size = 0
            norm.append({"name": f.name, "mime": f.mime, "data_base64": raw, "size": size})
        patch["files"] = norm
    r = await db.ai_teach_rules.update_one({"rule_id": rule_id, "user_id": tid}, {"$set": patch})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Regola non trovata")
    return {"ok": True}


@api_router.delete("/ai-teach/rules/{rule_id}")
async def ai_teach_delete_rule(rule_id: str, user=Depends(get_current_user)):
    _require_master(user)
    tid = tenant_id(user)
    r = await db.ai_teach_rules.delete_one({"rule_id": rule_id, "user_id": tid})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Regola non trovata")
    return {"ok": True}


@api_router.get("/ai-teach/urls")
async def ai_teach_list_urls(user=Depends(get_current_user)):
    _require_master(user)
    tid = tenant_id(user)
    cur = db.ai_teach_urls.find({"user_id": tid}).sort("updated_at", -1)
    items = []
    async for r in cur:
        r.pop("_id", None)
        # Mask password on list
        if r.get("password"):
            r["password_masked"] = True
            r.pop("password", None)
        items.append(r)
    return {"items": items}


@api_router.post("/ai-teach/urls")
async def ai_teach_create_url(body: AiTeachUrlIn, user=Depends(get_current_user)):
    _require_master(user)
    tid = tenant_id(user)
    uid_ = f"aitu_{uuid.uuid4().hex[:12]}"
    doc = {
        "url_id": uid_,
        "user_id": tid,
        "created_by": user["user_id"],
        "url": body.url.strip(),
        "name": body.name.strip(),
        "category": body.category or "generic",
        "frequency": body.frequency,
        "username": (body.username or "").strip() or None,
        "password": (body.password or "").strip() or None,
        "last_fetched_at": None,
        "last_summary": "",
        "last_error": None,
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.ai_teach_urls.insert_one(doc)
    doc.pop("_id", None)
    if doc.get("password"): doc["password_masked"] = True; doc.pop("password", None)
    return doc


@api_router.put("/ai-teach/urls/{url_id}")
async def ai_teach_update_url(url_id: str, body: AiTeachUrlPatch, user=Depends(get_current_user)):
    _require_master(user)
    tid = tenant_id(user)
    patch: Dict[str, Any] = {"updated_at": utcnow()}
    for field in ["url", "name", "category", "frequency", "username", "password"]:
        v = getattr(body, field, None)
        if v is not None:
            patch[field] = (v.strip() if isinstance(v, str) else v) or None
    r = await db.ai_teach_urls.update_one({"url_id": url_id, "user_id": tid}, {"$set": patch})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="URL non trovato")
    return {"ok": True}


@api_router.delete("/ai-teach/urls/{url_id}")
async def ai_teach_delete_url(url_id: str, user=Depends(get_current_user)):
    _require_master(user)
    tid = tenant_id(user)
    r = await db.ai_teach_urls.delete_one({"url_id": url_id, "user_id": tid})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="URL non trovato")
    return {"ok": True}


async def _ai_teach_refresh_url(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Fetch a monitored URL via Tavily (if configured) and update last_summary."""
    try:
        summary = ""
        # Prefer Tavily's answer for the exact URL as query context
        q = f"{doc.get('name') or ''} {doc.get('url')}".strip()
        res = await _tavily_search(q, max_results=4)
        if res:
            summary = (res.get("answer") or "").strip()
            # Include result snippets for richer context
            for it in (res.get("results") or [])[:3]:
                if it.get("content"):
                    summary += f"\n- {it.get('title') or ''}: {it.get('content')}"
        else:
            summary = f"[Tavily non configurato o non disponibile] URL: {doc.get('url')}"
        now = utcnow()
        await db.ai_teach_urls.update_one(
            {"url_id": doc["url_id"]},
            {"$set": {"last_fetched_at": now, "last_summary": summary[:4000], "last_error": None}},
        )
        return {"ok": True, "summary_len": len(summary)}
    except Exception as e:
        await db.ai_teach_urls.update_one(
            {"url_id": doc["url_id"]},
            {"$set": {"last_error": str(e)[:400]}},
        )
        return {"ok": False, "error": str(e)}


@api_router.post("/ai-teach/urls/{url_id}/refresh")
async def ai_teach_refresh_url(url_id: str, user=Depends(get_current_user)):
    _require_master(user)
    tid = tenant_id(user)
    doc = await db.ai_teach_urls.find_one({"url_id": url_id, "user_id": tid})
    if not doc:
        raise HTTPException(status_code=404, detail="URL non trovato")
    return await _ai_teach_refresh_url(doc)


async def build_ai_teach_context(tenant: str, category: str) -> str:
    """Build a compact block that will be prepended to bill-analysis system prompts.
    Refreshes stale monitored URLs opportunistically (best-effort).
    """
    now = utcnow()
    # Manual rules for this category
    rules_cur = db.ai_teach_rules.find({"user_id": tenant, "category": category}).limit(30)
    rules_text_parts: List[str] = []
    async for r in rules_cur:
        title = (r.get("title") or "").strip()
        text = (r.get("text") or "").strip()
        if title or text:
            rules_text_parts.append(f"- {title}: {text}"[:800])
    # URLs (all categories + generic — but prefer matching category)
    url_parts: List[str] = []
    stale_ids: List[Dict[str, Any]] = []
    thresholds = {"daily": 1, "weekly": 7, "monthly": 30}
    urls_cur = db.ai_teach_urls.find({"user_id": tenant, "$or": [{"category": category}, {"category": "generic"}, {"category": None}]}).limit(30)
    async for u in urls_cur:
        last = u.get("last_fetched_at")
        freq_days = thresholds.get(u.get("frequency") or "weekly", 7)
        stale = (not last) or ((now - last).days >= freq_days)
        if stale:
            stale_ids.append(u)
        summary = (u.get("last_summary") or "").strip()
        if summary:
            url_parts.append(f"[{u.get('name') or u.get('url')}]: {summary[:600]}")
    # Best-effort refresh of a couple of stale URLs (don't block on all)
    for u in stale_ids[:3]:
        try:
            await _ai_teach_refresh_url(u)
        except Exception:
            pass
    blocks: List[str] = []
    if rules_text_parts:
        blocks.append("REGOLE MASTER (usa PRIORITARIAMENTE, sono la fonte più autorevole):\n" + "\n".join(rules_text_parts))
    if url_parts:
        blocks.append("FONTI WEB MONITORATE (aggiornate automaticamente):\n" + "\n".join(url_parts))
    return ("\n\n".join(blocks)).strip()



# Include router & CORS
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def _startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.contacts.create_index([("user_id", 1), ("contact_id", 1)])
    await db.appointments.create_index([("user_id", 1), ("start_at", 1)])
    await db.callbacks.create_index([("user_id", 1), ("scheduled_at", 1)])
    await db.users.create_index("parent_user_id")
    await db.invites.create_index("invite_token", unique=True)
    await db.invites.create_index("created_by")
    await db.groups.create_index([("user_id", 1), ("group_id", 1)], unique=True)
    await db.smtp_configs.create_index("user_id", unique=True)
    await db.chat_channels.create_index([("user_id", 1), ("member_user_ids", 1)])
    await db.chat_channels.create_index("channel_id", unique=True)
    await db.chat_messages.create_index([("channel_id", 1), ("created_at", 1)])
    await db.my_thing.create_index([("owner_user_id", 1), ("kind", 1), ("active", 1)])
    await db.contacts.create_index([("user_id", 1), ("contact_code", 1)])
    await db.contacts.create_index([("user_id", 1), ("referred_by_contact_id", 1)])
    await db.contacts.create_index([("user_id", 1), ("assigned_to_user_id", 1)])
    await db.energy_bills.create_index([("user_id", 1), ("contact_id", 1)])
    await db.energy_bills.create_index("bill_id", unique=True)
    await db.company_offers.create_index([("user_id", 1), ("bill_type", 1)])
    await db.company_offers.create_index("offer_id", unique=True)
    await db.contracts.create_index([("user_id", 1), ("created_at", -1)])
    await db.contracts.create_index("contract_id", unique=True)
    await db.web_links.create_index([("user_id", 1), ("order", 1)])
    await db.web_links.create_index("link_id", unique=True)
    await db.user_settings.create_index("user_id", unique=True)
    await db.audio_records.create_index([("user_id", 1), ("target_type", 1), ("target_id", 1)])
    await db.audio_records.create_index("audio_id", unique=True)
    await db.assistant_messages.create_index([("user_id", 1), ("session_id", 1), ("created_at", 1)])
    # V24 migration: back-fill assigned_to_user_id from created_by for legacy contacts
    try:
        result = await db.contacts.update_many(
            {"assigned_to_user_id": {"$exists": False}, "created_by": {"$exists": True}},
            [{"$set": {"assigned_to_user_id": "$created_by"}}],
        )
        if result.modified_count:
            logger.info(f"V24 migration: assigned {result.modified_count} legacy contacts to their creator")
    except Exception as e:
        logger.warning(f"V24 legacy contact assignment migration skipped: {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    try:
        _birthday_scheduler.shutdown(wait=False)
    except Exception:
        pass
    client.close()


# =========================
# V38I — Birthday cron scheduler (APScheduler)
# =========================
from apscheduler.schedulers.asyncio import AsyncIOScheduler  # noqa: E402

_birthday_scheduler = AsyncIOScheduler(timezone="Europe/Rome")


async def _run_birthday_job():
    """Daily job: for each contact whose birthday_auto_send=True and today matches
    birth_date (MM-DD), generate a fresh AI message (or reuse this year's) and send
    via SMTP. Uses birthday_sender_email as From, birthday_recipient_email as To."""
    logger.info("Running daily birthday scheduler…")
    today = datetime.now(timezone.utc).date()
    year = today.year
    # Iterate users
    async for user_doc in db.users.find({}, {"user_id": 1, "email": 1, "additional_emails": 1, "company_name": 1}):
        tid = user_doc["user_id"]
        smtp_cfg = await db.smtp_configs.find_one({"user_id": tid}, {"_id": 0})
        if not smtp_cfg or not smtp_cfg.get("host"):
            continue
        contacts = await db.contacts.find(
            {"user_id": tid, "birthday_auto_send": True, "birth_date": {"$exists": True, "$ne": ""}},
            {"contact_id": 1, "first_name": 1, "last_name": 1, "birth_date": 1,
             "birthday_recipient_email": 1, "birthday_sender_email": 1,
             "email": 1, "email_alt": 1, "is_active_client": 1},
        ).to_list(2000)
        for c in contacts:
            bd = str(c.get("birth_date") or "").strip()
            if not bd:
                continue
            # Support DD/MM/YYYY, DD-MM-YYYY, ISO YYYY-MM-DD
            try:
                if "/" in bd:
                    parts = bd.split("/")
                    day, month = int(parts[0]), int(parts[1])
                elif "-" in bd and len(bd) >= 8:
                    p = bd.split("-")
                    if len(p[0]) == 4:  # ISO
                        day, month = int(p[2]), int(p[1])
                    else:
                        day, month = int(p[0]), int(p[1])
                else:
                    continue
            except Exception:
                continue
            if day != today.day or month != today.month:
                continue
            # Skip if already sent this year
            already = await db.birthday_messages.find_one({
                "user_id": tid, "contact_id": c["contact_id"], "year": year, "sent": True,
            })
            if already:
                continue
            # Fetch or generate the message
            existing = await db.birthday_messages.find_one({
                "user_id": tid, "contact_id": c["contact_id"], "year": year,
            }, sort=[("created_at", -1)])
            message = existing.get("message") if existing else None
            if not message:
                try:
                    from emergentintegrations.llm.chat import LlmChat, UserMessage as _UM
                    key = os.environ.get("EMERGENT_LLM_KEY", "")
                    if not key:
                        continue
                    is_active = bool(c.get("is_active_client"))
                    first_name = c.get("first_name") or "Cliente"
                    system = (
                        "Sei un consulente energetico italiano che scrive messaggi di auguri "
                        "di compleanno personalizzati. Caldo, sincero, personale, 3-6 frasi, ~500 chars, "
                        "firmato 'Il tuo Consulente'."
                    )
                    prompt = (
                        f"Genera il messaggio di auguri di compleanno {year} per {first_name}."
                        + (" Cliente attivo: ringrazialo per la fiducia e invitalo a contattarti." if is_active else "")
                    )
                    chat = LlmChat(api_key=key, session_id=f"bday-cron-{c['contact_id']}-{year}",
                                   system_message=system).with_model("anthropic", "claude-sonnet-5")
                    resp = await chat.send_message(_UM(text=prompt))
                    message = (resp or "").strip().strip('"').strip("'")
                    if message:
                        await db.birthday_messages.insert_one({
                            "user_id": tid, "contact_id": c["contact_id"], "year": year,
                            "message": message, "is_active_client": is_active, "created_at": utcnow(),
                        })
                except Exception as e:
                    logger.warning(f"birthday gen failed for {c.get('contact_id')}: {e}")
                    continue
            # Pick recipient / sender
            to_email = c.get("birthday_recipient_email") or c.get("email") or c.get("email_alt")
            if not to_email:
                continue
            sender_override = c.get("birthday_sender_email")
            cfg_copy = dict(smtp_cfg)
            if sender_override:
                cfg_copy["sender_email"] = sender_override
            subject = f"Buon compleanno, {c.get('first_name') or ''}!"
            try:
                await asyncio.to_thread(_send_smtp_email, cfg_copy, to_email, subject, message, None)
                await db.birthday_messages.update_one(
                    {"user_id": tid, "contact_id": c["contact_id"], "year": year},
                    {"$set": {"sent": True, "sent_at": utcnow(), "sent_to": to_email}},
                    upsert=True,
                )
                logger.info(f"birthday sent to {to_email} for contact {c['contact_id']}")
            except Exception as e:
                logger.warning(f"birthday send failed for {to_email}: {e}")


@app.on_event("startup")
async def _start_scheduler():
    # Run daily at 09:00 Europe/Rome
    try:
        _birthday_scheduler.add_job(_run_birthday_job, "cron", hour=9, minute=0, id="birthday-job", replace_existing=True)
        _birthday_scheduler.start()
        logger.info("Birthday scheduler started (daily 09:00 Europe/Rome)")
    except Exception as e:
        logger.warning(f"birthday scheduler start failed: {e}")


# Manual trigger endpoint (Owner only) — useful for testing
@api_router.post("/admin/birthday/run-now")
async def run_birthday_now(user=Depends(get_current_user)):
    if user.get("role") != "owner":
        raise HTTPException(status_code=403, detail="Solo Owner")
    await _run_birthday_job()
    return {"ok": True}
