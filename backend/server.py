from fastapi import FastAPI, APIRouter, Depends, HTTPException, Header, status
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import bcrypt
import jwt
import httpx
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

    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
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


class SettingsModel(BaseModel):
    energy_title: str = "Consulente Energetico"
    energy_color: str = "#C83232"
    network_title: str = "Networker"
    network_color: str = "#1B6CB0"
    app_name: str = "Dal Pastro CRM"
    custom_appointment_types: List[str] = Field(default_factory=list)
    custom_product_categories: List[Dict[str, Any]] = Field(default_factory=list)


AreaLiteral = Literal["energy", "network"]


class ContactNote(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    kind: Literal["text", "audio", "photo", "link"] = "text"
    text: Optional[str] = None
    audio_base64: Optional[str] = None
    audio_mime: Optional[str] = None
    photo_base64: Optional[str] = None
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
    fiscal_code: str = ""
    vat_number: str = ""
    website: str = ""
    linkedin: str = ""
    instagram: str = ""
    facebook: str = ""
    area: AreaLiteral = "energy"
    source: Literal["personal", "referral"] = "personal"
    referred_by_contact_id: Optional[str] = None
    referral_type: Optional[Literal["direct", "from_contact"]] = None
    referral_note: str = ""
    email_note: str = ""
    general_note: str = ""
    tags: List[str] = Field(default_factory=list)


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
    fiscal_code: Optional[str] = None
    vat_number: Optional[str] = None
    website: Optional[str] = None
    linkedin: Optional[str] = None
    instagram: Optional[str] = None
    facebook: Optional[str] = None
    area: Optional[AreaLiteral] = None
    source: Optional[Literal["personal", "referral"]] = None
    referred_by_contact_id: Optional[str] = None
    referral_type: Optional[Literal["direct", "from_contact"]] = None
    referral_note: Optional[str] = None
    email_note: Optional[str] = None
    general_note: Optional[str] = None
    tags: Optional[List[str]] = None
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


class CallbackIn(BaseModel):
    contact_id: Optional[str] = None
    title: str
    area: AreaLiteral = "energy"
    scheduled_at: datetime
    note: str = ""


class CallbackUpdate(BaseModel):
    title: Optional[str] = None
    area: Optional[AreaLiteral] = None
    scheduled_at: Optional[datetime] = None
    note: Optional[str] = None
    done: Optional[bool] = None


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
    token = create_jwt(user["user_id"])
    strip_id(user)
    user.pop("password_hash", None)
    return {"token": token, "user": UserOut(**user).model_dump()}


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
async def list_contacts(area: Optional[str] = None, q: Optional[str] = None, user=Depends(get_current_user)):
    query: Dict[str, Any] = scope_query(user)
    if area in ("energy", "network"):
        query["area"] = area
    if q:
        query["$or"] = [
            {"first_name": {"$regex": q, "$options": "i"}},
            {"last_name": {"$regex": q, "$options": "i"}},
            {"phone": {"$regex": q, "$options": "i"}},
            {"email": {"$regex": q, "$options": "i"}},
        ]
    items = await db.contacts.find(query, {"_id": 0, "notes": 0, "files": 0}).sort("last_name", 1).to_list(1000)
    return {"items": items}


@api_router.post("/contacts")
async def create_contact(body: ContactIn, user=Depends(get_current_user)):
    check_area_allowed(user, body.area)
    cid = f"c_{uuid.uuid4().hex[:12]}"
    doc = {
        "contact_id": cid,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        **body.model_dump(),
        "notes": [],
        "files": [],
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.contacts.insert_one(doc)
    strip_id(doc)
    return doc


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
    return {"period": period, "start": start.isoformat(), "end": end.isoformat(), "stats": result}


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


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
