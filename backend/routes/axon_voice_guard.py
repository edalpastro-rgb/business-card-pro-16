# axon_voice_guard.py — V50.z371 — SISTEMA VOCALE · BLOCCO 4: comandi critici → conferma PIN o impronta/Face ID, SEMPRE
# (anche per la voce del proprietario). Mai eseguire comandi distruttivi solo su input vocale.
# Categorie: delete (cancella/elimina/azzera…), settings (impostazioni/account/password/abbonamento/permessi/moduli),
# sensitive (dati sensibili clienti: codice fiscale, IBAN, documenti, P.IVA…).
#   GET  /voice-guard                 → {has_pin, categories}
#   PUT  /voice-guard/pin {pin, current_pin?}  → imposta/cambia PIN a 6 cifre (bcrypt)
#   POST /voice-guard/verify {pin}    → {guard_token} (JWT kind voice_guard, 90 s, uso singolo per comando)
#   POST /voice-guard/biometric-ok    → {guard_token} dopo impronta/Face ID riuscita sul telefono
#   vg_is_critical(text) / vg_check_token(user, token) usati da /viola-wake/route e /voice/copilot/execute.

VG_TOKEN_TTL_S = 90
VG_RULES = {
    "delete": r"\b(cancell\w*|elimin\w*|rimuov\w*|azzer\w*|svuot\w*|resett\w*|distrugg\w*|butta via|pulisci tutto)\b",
    "settings": r"\b(impostazion\w*|password|account|abbonament\w*|piano\b|permess\w*|disattiv\w*|attiva (il )?modul\w*|cambia (la )?voce|fattur\w+ azienda|ragione sociale|partita iva aziend\w*)\b",
    "sensitive": r"\b(codice fiscale|iban|carta di credito|numero (di )?carta|document\w* (d'|di )?identit\w*|patente|passaporto|dati sensibil\w*|password del cliente|conto corrente)\b",
}


def vg_is_critical(text: str) -> Optional[str]:
    t = (text or "").lower()
    for cat, rx in VG_RULES.items():
        if re.search(rx, t):
            return cat
    return None


def _vg_token(uid: str, category: str) -> str:
    return jwt.encode({"kind": "voice_guard", "user_id": uid, "cat": category, "jti": uuid.uuid4().hex[:12],
                       "exp": int((utcnow() + timedelta(seconds=VG_TOKEN_TTL_S)).timestamp())}, JWT_SECRET, algorithm=JWT_ALG)


async def vg_check_token(user: dict, token: Optional[str]) -> bool:
    if not token:
        return False
    try:
        p = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        if p.get("kind") != "voice_guard" or p.get("user_id") != user["user_id"]:
            return False
        if await db.voice_guard_used.find_one({"jti": p["jti"]}):
            return False
        await db.voice_guard_used.insert_one({"jti": p["jti"], "user_id": user["user_id"], "at": utcnow()})
        return True
    except Exception:
        return False


class VgPinIn(BaseModel):
    pin: str = Field(min_length=6, max_length=6)
    current_pin: Optional[str] = None


class VgVerifyIn(BaseModel):
    pin: str = Field(min_length=6, max_length=6)
    category: str = "delete"


class VgBioIn(BaseModel):
    category: str = "delete"


@api_router.get("/voice-guard")
async def vg_status(user=Depends(get_current_user)):
    row = await db.voice_guard.find_one({"user_id": user["user_id"]}, {"_id": 0, "updated_at": 1})
    return {"has_pin": bool(row), "updated_at": row["updated_at"].isoformat() if row else None, "categories": list(VG_RULES.keys()), "ttl_s": VG_TOKEN_TTL_S}


@api_router.put("/voice-guard/pin")
async def vg_set_pin(body: VgPinIn, user=Depends(get_current_user)):
    if not body.pin.isdigit():
        raise HTTPException(status_code=400, detail="Il PIN deve avere 6 cifre")
    row = await db.voice_guard.find_one({"user_id": user["user_id"]})
    if row and not (body.current_pin and verify_password(body.current_pin, row["pin_hash"])):
        raise HTTPException(status_code=403, detail="PIN attuale errato")
    await db.voice_guard.update_one({"user_id": user["user_id"]}, {"$set": {"pin_hash": hash_password(body.pin), "updated_at": utcnow()}}, upsert=True)
    return {"ok": True}


@api_router.post("/voice-guard/verify")
async def vg_verify(body: VgVerifyIn, user=Depends(get_current_user)):
    row = await db.voice_guard.find_one({"user_id": user["user_id"]})
    if not row:
        raise HTTPException(status_code=404, detail="Nessun PIN impostato: crealo in Impostazioni → Voce")
    fails = await db.voice_guard_fail.count_documents({"user_id": user["user_id"], "at": {"$gte": utcnow() - timedelta(minutes=10)}})
    if fails >= 5:
        raise HTTPException(status_code=429, detail="Troppi tentativi: riprova tra 10 minuti")
    if not verify_password(body.pin, row["pin_hash"]):
        await db.voice_guard_fail.insert_one({"user_id": user["user_id"], "at": utcnow()})
        raise HTTPException(status_code=403, detail="PIN errato")
    await db.voice_guard_fail.delete_many({"user_id": user["user_id"]})  # PIN corretto → azzera i tentativi falliti
    return {"guard_token": _vg_token(user["user_id"], body.category), "ttl_s": VG_TOKEN_TTL_S}


@api_router.post("/voice-guard/biometric-ok")
async def vg_biometric(body: VgBioIn, user=Depends(get_current_user)):
    """Il telefono ha verificato impronta/Face ID (expo-local-authentication) → token di conferma."""
    return {"guard_token": _vg_token(user["user_id"], body.category), "ttl_s": VG_TOKEN_TTL_S}
