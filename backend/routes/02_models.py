# 02_models.py — Modelli Pydantic condivisi
# Estratto da server.py (righe originali 512-1116). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# Models
# =========================
class RegisterInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str
    product: Optional[Literal["advisor", "lite"]] = None  # V50.z323 — Axon Core: app di provenienza (default advisor)
    plan: Optional[Literal["builder", "professional"]] = None  # V50.z530 — piano Founder scelto dalla landing (contatori posti)
    last_name: Optional[str] = None  # V50.z433 — Cognome (campo separato nel modulo)
    promo_code: Optional[str] = None  # V50.z433 — codice promozionale (stesso sistema Master/landing: promo_codes + AMICO-)
    # V50.z434 — anti-bot «Fort Knox» (vedi axon_register_security.py) + consensi
    challenge_id: Optional[str] = None
    pow_nonce: Optional[str] = None
    turnstile_token: Optional[str] = None
    hp: Optional[str] = None  # honeypot: deve restare vuoto
    privacy_accepted: bool = False
    newsletter: bool = False


class DeviceIn(BaseModel):
    """V50.z293 — identità del dispositivo che effettua il login (registro dispositivi: 1 telefono + 1 tablet + 1 PC)."""
    device_id: str
    type: str = "phone"  # phone | tablet | pc
    name: Optional[str] = None
    platform: Optional[str] = None


class LoginInput(BaseModel):
    email: EmailStr
    password: str
    device: Optional[DeviceIn] = None


class TwoFAVerifyInput(BaseModel):
    temp_token: str
    code: str
    device: Optional[DeviceIn] = None


class TwoFAConfirmInput(BaseModel):
    code: str


class TwoFADisableInput(BaseModel):
    password: Optional[str] = None
    code: Optional[str] = None  # TOTP or backup code (alternative to password)


class GoogleSessionInput(BaseModel):
    session_id: str
    device: Optional[DeviceIn] = None
    product: Optional[Literal["advisor", "lite"]] = None  # V50.z323


class UserOut(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    role: str = "owner"
    areas: List[str] = Field(default_factory=lambda: ["energy", "network"])
    parent_user_id: Optional[str] = None
    product: str = "advisor"  # V50.z323 — Axon Core: advisor | lite
    email_verified: Optional[bool] = None  # V50.z433 — False = account da attivare con codice email (None = utenti storici/Google)
    avatar_base64: Optional[str] = None
    two_factor_enabled: bool = False
    additional_emails: List[str] = Field(default_factory=list)  # V38H
    # V38I — Report branding
    company_name: Optional[str] = None
    company_logo_base64: Optional[str] = None
    # V38U — Report header extras (slogan + contacts printed as header)
    report_slogan: Optional[str] = None
    report_contacts: Optional[str] = None
    # V50.z140 — Header tabelle AxonOS (logo + nome azienda in testa a ogni tabella esportata)
    table_header_name: Optional[str] = None
    table_header_logo_base64: Optional[str] = None


class TeamInviteInput(BaseModel):
    email: EmailStr
    name: str
    password: str = Field(min_length=6)
    areas: List[Literal["energy", "network"]] = Field(default_factory=lambda: ["energy", "network"])


class TeamUpdateInput(BaseModel):
    areas: Optional[List[Literal["energy", "network"]]] = None
    name: Optional[str] = None
    # V28.z — Codice agente (testo libero, solo Master può modificarlo)
    agent_code: Optional[str] = None


class SensitivePasswordIn(BaseModel):
    # V28.z — La password è cifrata server-side (Fernet).
    # "Cifratura lato client prima della trasmissione" è garantita da TLS/HTTPS.
    # Solo Master e diretto interessato possono leggere/scrivere.
    value: str


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
    # V29.as — Tipi appuntamento "default" nascosti dall'utente (permette di
    # rimuovere anche i default come "Personale" o "Altro" senza toccare il
    # codice frontend). Deduplicati e ordinati.
    hidden_appointment_types: List[str] = Field(default_factory=list)
    custom_product_categories: List[Dict[str, Any]] = Field(default_factory=list)
    custom_areas: List[Dict[str, Any]] = Field(default_factory=list)
    # V50.z113 — Metadati delle aree built-in (energy/network): descrizione uso,
    # sottocategorie, permessi di accesso (ruoli), archiviata.
    # {"energy": {"description": str, "subcategories": [..], "allowed_roles": [..], "archived": bool}, "network": {...}}
    area_meta: Dict[str, Any] = Field(default_factory=dict)
    appointment_outcomes: List[Dict[str, Any]] = Field(default_factory=list)
    call_outcomes: List[Dict[str, Any]] = Field(default_factory=list)
    callback_notify_default_advance_min: int = 10
    disable_callback_notifications: bool = False
    contact_source_options: List[Dict[str, Any]] = Field(default_factory=list)
    # V27 — Referral / Call script templates (configured by Master, used by all agents)
    wa_referral_template: str = ""  # WhatsApp message for "Chiedi Referenze" (customer → their contacts). Supports {name} placeholder.
    call_script: str = ""  # Floating script overlay for agents during phone calls
    # V28.f — Multiple named scripts (freddo/caldo/prospect). Legacy `call_script`
    # remains supported (rendered as the "Default" entry when no items exist).
    # Each entry: {"id": str, "name": str, "content": str}
    call_scripts: List[Dict[str, Any]] = Field(default_factory=list)
    # V49 — "Comunica con l'azienda" panel (Home). Configurable by Master; visible
    # to all tenant users. Phones and email are tappable to start call / open mail.
    communica_azienda_name: str = ""
    communica_azienda_email: str = ""
    # Each entry: {"id": str, "label": str, "number": str}
    communica_azienda_phones: List[Dict[str, Any]] = Field(default_factory=list)
    # V50.z71 — Indirizzo ufficio: usato come origine di default per calcolo distanze indirizzi cliente
    office_address: str = ""


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
    folder: Optional[str] = None  # V50.z424 — percorso relativo originale (import da cartella: "Asolo Pneus/Visure/")


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
    # V29.av — Referente Energia (persona di riferimento per pratiche energia)
    energy_ref_name: str = ""
    energy_ref_phone: str = ""
    energy_ref_email: str = ""
    birthday_alert_days_before: int = 1
    birthday_auto_send: bool = False
    birthday_message: str = ""
    birthday_message_photo: Optional[str] = None
    birthday_message_link: Optional[str] = None
    # V38H: sender/recipient selection + active client flag
    birthday_sender_email: Optional[str] = None
    birthday_recipient_email: Optional[str] = None
    is_active_client: bool = False
    client_since: Optional[str] = None  # V50.z424 — data attivazione cliente (YYYY-MM-DD), impostabile anche retroattiva
    legal_form: Optional[str] = None    # V50.z424 — forma giuridica (SRL, SNC, ditta individuale…)
    pec: Optional[str] = None
    sdi_code: Optional[str] = None
    bank_name: Optional[str] = None
    iban: Optional[str] = None
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
    # V50.z114 — Sottocategoria scelta per ciascuna area del contatto: {"energy": "Gas", "area_x": "Vita"}
    area_subcategories: Dict[str, str] = Field(default_factory=dict)
    # V50.z115 — Gerarchia a 3 livelli: {"energy": {"category": "Luce", "subcategory": "Domestico"}}
    area_categories: Dict[str, Dict[str, str]] = Field(default_factory=dict)
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
    # V28.f — Customer type per assigned area: {"energy": "business"|"private", ...}
    customer_types: Dict[str, str] = Field(default_factory=dict)
    # V28.q — Bidirectional peer references (chip list mostrata nella scheda).
    # NB: la sync bidirezionale è gestita dagli endpoint dedicati; il campo qui esiste
    # solo per permettere set iniziale in fase di creazione (raro).
    reference_contact_ids: List[str] = Field(default_factory=list)
    # V50.z67 — Campi personalizzati definiti dal Master
    custom_fields: Dict[str, Any] = Field(default_factory=dict)
    # V50.z71 — Indirizzo preferito (main | legacy | work | residence) — mostrato in cima nella scheda
    preferred_address: Optional[str] = None
    # V50.z278 — Anagrafica adattiva (biglietto da visita): azienda/ruolo, fax, elenco recapiti con etichetta e flag principale,
    # altri referenti sul biglietto, preferenze di contatto, immagine del biglietto (JPEG ritagliato, base64)
    company: str = ""
    role: str = ""
    fax: str = ""
    phones: List[Dict[str, Any]] = Field(default_factory=list)   # [{label, number, type: mobile|landline|fax|other, primary}]
    emails: List[Dict[str, Any]] = Field(default_factory=list)   # [{label, address, primary}]
    people: List[Dict[str, Any]] = Field(default_factory=list)   # [{name, role, phone, email}]
    contact_prefs: Dict[str, Any] = Field(default_factory=dict)  # {channels: [call|whatsapp|email|sms], best_time, note}
    business_card: Optional[Dict[str, Any]] = None               # {data_base64, mime, created_at}


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
    # V29.av — Referente Energia (update-only fields)
    energy_ref_name: Optional[str] = None
    energy_ref_phone: Optional[str] = None
    energy_ref_email: Optional[str] = None
    birthday_alert_days_before: Optional[int] = None
    birthday_auto_send: Optional[bool] = None
    birthday_message: Optional[str] = None
    birthday_message_photo: Optional[str] = None
    birthday_message_link: Optional[str] = None
    birthday_sender_email: Optional[str] = None  # V38H
    birthday_recipient_email: Optional[str] = None  # V38H
    is_active_client: Optional[bool] = None  # V38H
    client_since: Optional[str] = None  # V50.z424
    legal_form: Optional[str] = None
    pec: Optional[str] = None
    sdi_code: Optional[str] = None
    bank_name: Optional[str] = None
    iban: Optional[str] = None
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
    area_subcategories: Optional[Dict[str, str]] = None
    area_categories: Optional[Dict[str, Dict[str, str]]] = None
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
    # V28.f — Customer type per area
    customer_types: Optional[Dict[str, str]] = None
    # V28.q — Bidirectional peer references (opzionale: normalmente si usa endpoint dedicato)
    reference_contact_ids: Optional[List[str]] = None
    # V50.z67 — Campi personalizzati anagrafica (chiavi definite dal master)
    custom_fields: Optional[Dict[str, Any]] = None
    # V50.z71 — Indirizzo preferito (main | legacy | work | residence)
    preferred_address: Optional[str] = None
    # V50.z278 — Anagrafica adattiva
    company: Optional[str] = None
    role: Optional[str] = None
    fax: Optional[str] = None
    phones: Optional[List[Dict[str, Any]]] = None
    emails: Optional[List[Dict[str, Any]]] = None
    people: Optional[List[Dict[str, Any]]] = None
    contact_prefs: Optional[Dict[str, Any]] = None
    business_card: Optional[Dict[str, Any]] = None
    # V50.z256 — Frequenza ripasso (giorni: 30/60/90/120 o personalizzato; 0 = nessuna)
    revisit_every_days: Optional[int] = None


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
    # V50.z140 — Header tabelle AxonOS
    table_header_name: Optional[str] = None
    table_header_logo_base64: Optional[str] = None


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
    recurrence: Literal["none", "daily", "weekly", "monthly", "yearly", "custom"] = "none"
    recurrence_days: List[int] = Field(default_factory=list)  # V50.z410 — custom: giorni settimana 0=Lun … 6=Dom
    participant_contact_ids: List[str] = Field(default_factory=list)
    value_amount: float = 0.0
    appointment_type_tags: List[str] = Field(default_factory=list)
    product_categories: List[str] = Field(default_factory=list)
    # Broadcast fields (admin/owner only)
    is_broadcast: bool = False
    broadcast_scope: Optional[Literal["all", "subtree", "custom"]] = None
    broadcast_to_user_ids: List[str] = Field(default_factory=list)
    broadcast_notify_advance_min: int = 15
    # V50.z80 — Condivisione appuntamento col cliente (WhatsApp/Email + reminder auto)
    client_reminder_hours: Optional[int] = None  # ore prima dell'appuntamento (es. 24, 3)
    client_reminder_channels: List[Literal["whatsapp", "email"]] = Field(default_factory=list)
    client_reminder_message: Optional[str] = None  # template personalizzato (fallback = generato)
    client_reminder_sent_at: Optional[datetime] = None  # anti-duplicato


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
    recurrence: Optional[Literal["none", "daily", "weekly", "monthly", "yearly", "custom"]] = None
    recurrence_days: Optional[List[int]] = None
    participant_contact_ids: Optional[List[str]] = None
    value_amount: Optional[float] = None
    appointment_type_tags: Optional[List[str]] = None
    product_categories: Optional[List[str]] = None
    outcome_ids: Optional[List[str]] = None
    rescheduled_to: Optional[str] = None
    # V38W — allow linking / relinking a contact from the appointment detail
    contact_id: Optional[str] = None
    # V50.z80 — Condivisione appuntamento col cliente
    client_reminder_hours: Optional[int] = None
    client_reminder_channels: Optional[List[Literal["whatsapp", "email"]]] = None
    client_reminder_message: Optional[str] = None


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
