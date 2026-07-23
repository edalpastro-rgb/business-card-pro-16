from fastapi import FastAPI, APIRouter, Depends, HTTPException, Header, status
from fastapi.responses import PlainTextResponse
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
import secrets
import io
import pyotp
import qrcode
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import formataddr
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any, Literal
from datetime import datetime, timezone, timedelta


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# JWT config
JWT_SECRET = os.environ.get('JWT_SECRET', 'dev-secret-change-me-in-prod-9827345')
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


DEFAULT_CALL_OUTCOMES = [
    {"id": "call_ok", "name": "Chiamata completata", "color": "#16A34A", "icon": "checkmark-circle"},
    {"id": "call_no_answer", "name": "Non risponde", "color": "#B77C14", "icon": "call"},
    {"id": "call_recall", "name": "Richiamare più tardi", "color": "#0891B2", "icon": "time"},
    {"id": "call_wrong_number", "name": "Numero errato", "color": "#6B7280", "icon": "warning"},
    {"id": "call_busy", "name": "Occupato", "color": "#C83232", "icon": "call-outline"},
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
    contact_code: Optional[str] = None  # e.g. "EN-0042" auto-assigned if empty
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
    birth_date: Optional[str] = None
    birthday_alert_days_before: int = 1
    birthday_auto_send: bool = False
    birthday_message: str = ""
    birthday_message_photo: Optional[str] = None
    birthday_message_link: Optional[str] = None
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


class ContactUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
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
    birth_date: Optional[str] = None
    birthday_alert_days_before: Optional[int] = None
    birthday_auto_send: Optional[bool] = None
    birthday_message: Optional[str] = None
    birthday_message_photo: Optional[str] = None
    birthday_message_link: Optional[str] = None
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


class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    avatar_base64: Optional[str] = None


class AppointmentIn(BaseModel):
    contact_id: Optional[str] = None
    title: str
    area: AreaLiteral = "energy"
    start_at: datetime
    end_at: Optional[datetime] = None
    duration_min: int = 60
    is_phone: bool = False
    location: str = ""
    notes: str = ""
    note_attachments: List[Dict[str, Any]] = Field(default_factory=list)
    reminder_minutes: int = 15
    recurrence: Literal["none", "weekly", "monthly", "yearly"] = "none"
    participant_contact_ids: List[str] = Field(default_factory=list)
    value_amount: float = 0.0
    appointment_type_tags: List[str] = Field(default_factory=list)
    product_categories: List[str] = Field(default_factory=list)


class AppointmentUpdate(BaseModel):
    title: Optional[str] = None
    area: Optional[AreaLiteral] = None
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    duration_min: Optional[int] = None
    is_phone: Optional[bool] = None
    done: Optional[bool] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    note_attachments: Optional[List[Dict[str, Any]]] = None
    outcome_tags: Optional[List[str]] = None
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
    outcome_id: str
    note: str = ""
    duration_sec: int = 0
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
    color: str = "#3A739C"


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
    if "callback_notify_default_advance_min" not in s:
        s["callback_notify_default_advance_min"] = 10
    if "disable_callback_notifications" not in s:
        s["disable_callback_notifications"] = False
    if not s.get("contact_source_options"):
        s["contact_source_options"] = DEFAULT_SOURCE_OPTIONS
        await db.settings.update_one({"user_id": tid}, {"$set": {"contact_source_options": DEFAULT_SOURCE_OPTIONS}})
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


@api_router.post("/team")
async def invite_member(body: TeamInviteInput, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo l'owner può invitare utenti")
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
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Non autorizzato")
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if not upd:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
    r = await db.users.update_one(
        {"user_id": member_id, "parent_user_id": user["user_id"]},
        {"$set": upd},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Membro non trovato")
    m = await db.users.find_one({"user_id": member_id}, {"_id": 0, "password_hash": 0})
    return m


@api_router.delete("/team/{member_id}")
async def delete_member(member_id: str, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Non autorizzato")
    r = await db.users.delete_one({"user_id": member_id, "parent_user_id": user["user_id"]})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Membro non trovato")
    await db.user_sessions.delete_many({"user_id": member_id})
    return {"ok": True}


# =========================
# Contacts
# =========================
@api_router.get("/contacts")
async def list_contacts(area: Optional[str] = None, q: Optional[str] = None, group_id: Optional[str] = None, user=Depends(get_current_user)):
    query: Dict[str, Any] = scope_query(user)
    and_clauses: List[Dict[str, Any]] = []
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
    items = await db.contacts.find(query, {"_id": 0, "notes": 0, "files": 0}).sort("last_name", 1).to_list(1000)
    return {"items": items}


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
    c = await db.contacts.find_one(scope_query(user, {"contact_id": contact_id}), {"_id": 0})
    if not c:
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


# =========================
# Appointments
# =========================
@api_router.get("/appointments")
async def list_appointments(
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
    area: Optional[str] = None,
    user=Depends(get_current_user),
):
    q: Dict[str, Any] = scope_query(user)
    if start and end:
        q["start_at"] = {"$gte": start, "$lte": end}
    elif start:
        q["start_at"] = {"$gte": start}
    if area in ("energy", "network"):
        q["area"] = area
    items = await db.appointments.find(q, {"_id": 0}).sort("start_at", 1).to_list(1000)
    return {"items": items}


@api_router.post("/appointments")
async def create_appointment(body: AppointmentIn, user=Depends(get_current_user)):
    check_area_allowed(user, body.area)
    aid = f"a_{uuid.uuid4().hex[:12]}"
    doc = {
        "appointment_id": aid,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        **body.model_dump(),
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


@api_router.get("/appointments/{appointment_id}")
async def get_appointment(appointment_id: str, user=Depends(get_current_user)):
    a = await db.appointments.find_one(scope_query(user, {"appointment_id": appointment_id}), {"_id": 0})
    if not a:
        raise HTTPException(status_code=404, detail="Appuntamento non trovato")
    return a


@api_router.put("/appointments/{appointment_id}")
async def update_appointment(appointment_id: str, body: AppointmentUpdate, user=Depends(get_current_user)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if "area" in upd:
        check_area_allowed(user, upd["area"])
    upd["updated_at"] = utcnow()
    r = await db.appointments.update_one(
        scope_query(user, {"appointment_id": appointment_id}),
        {"$set": upd},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Appuntamento non trovato")
    a = await db.appointments.find_one({"appointment_id": appointment_id}, {"_id": 0})
    return a


@api_router.delete("/appointments/{appointment_id}")
async def delete_appointment(appointment_id: str, user=Depends(get_current_user)):
    await db.appointments.delete_one(scope_query(user, {"appointment_id": appointment_id}))
    return {"ok": True}


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
    """Records the outcome of a phone call. Optionally creates a follow-up callback
    if the outcome indicates a reschedule (reschedule_at or reschedule_delta_min).
    """
    log_id = f"cl_{uuid.uuid4().hex[:12]}"
    doc = {
        "log_id": log_id,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        "contact_id": body.contact_id,
        "callback_id": body.callback_id,
        "appointment_id": body.appointment_id,
        "phone": body.phone,
        "outcome_id": body.outcome_id,
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
                "last_call_outcome_id": body.outcome_id,
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
    doc = {
        "invite_token": tok,
        "created_by": user["user_id"],
        "trial_days": body.trial_days,
        "note": body.note,
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
    user_doc = {
        "user_id": uid,
        "email": body.email.lower().strip(),
        "password_hash": pw_hash,
        "name": body.name,
        "role": "owner",
        "areas": ["energy", "network"],
        "parent_user_id": None,
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
    token_jwt = jwt.encode({"sub": uid, "email": user_doc["email"]}, JWT_SECRET, algorithm=JWT_ALG)
    return {
        "token": token_jwt,
        "user": {"user_id": uid, "email": user_doc["email"], "name": user_doc["name"], "role": "owner", "areas": user_doc["areas"]},
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
# Health
# =========================
@api_router.get("/")
async def root():
    return {"message": "ProSync CRM API", "ok": True}


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


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
