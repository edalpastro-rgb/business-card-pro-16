# axon_wizard_anagrafica.py — V50.z212 — BLOCCO 2 · Step 1 «Anagrafica»: codice fiscale, sync bidirezionale Anagrafica ⇄ AxonOS (ISOLATO)
#
# Fonte di verità UNICA: `master_profiles` (la stessa di /anagrafica-master e di GET/PUT /master/profile) → ogni modifica fatta nel
# wizard, nella pagina Anagrafica o in chat aggiorna lo stesso documento: nessun dato viene mai richiesto due volte.
# • `POST /axon/anagrafica/cf-decode` {tax_id, first_name?, last_name?} → dati codificati nel CF (data di nascita, sesso, comune) +
#   controllo carattere di controllo + coerenza con nome/cognome; suggerisce nome/cognome dall'account se mancanti (il CF contiene solo
#   le consonanti: nome e cognome per esteso non sono ricostruibili con certezza → l'utente conferma o modifica).
# • Prompt: sezione «ANAGRAFICA UTENTE (già fornita)» nel contesto di Axon con la regola «mai chiedere di reinserire».
# • Chat → Anagrafica: «il mio telefono è …», «la mia mail è …», «il mio indirizzo è …», «usa la mail X per rispondermi».

_CF_RE = re.compile(r"^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$")
_CF_MONTHS = {"A": 1, "B": 2, "C": 3, "D": 4, "E": 5, "H": 6, "L": 7, "M": 8, "P": 9, "R": 10, "S": 11, "T": 12}
_CF_OMO = {"L": "0", "M": "1", "N": "2", "P": "3", "Q": "4", "R": "5", "S": "6", "T": "7", "U": "8", "V": "9"}
_CF_ODD = {**{str(i): v for i, v in enumerate([1, 0, 5, 7, 9, 13, 15, 17, 19, 21])},
           **dict(zip("ABCDEFGHIJKLMNOPQRSTUVWXYZ", [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23]))}
_CF_EVEN = {**{str(i): i for i in range(10)}, **{c: i for i, c in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZ")}}
_ANAG_FIELDS = ("first_name", "last_name", "birth_date", "tax_id", "phone", "emails", "primary_email", "address", "address_second", "address_relative", "primary_address")


class CfDecodeIn(BaseModel):
    tax_id: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None


def _cf_digits(s: str) -> str:
    return "".join(_CF_OMO.get(c, c) for c in s)


def _cf_check_char(cf15: str) -> str:
    tot = sum((_CF_ODD if i % 2 == 0 else _CF_EVEN)[c] for i, c in enumerate(cf15))
    return "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[tot % 26]


def _cf_name_code(s: str, is_name: bool) -> str:
    s = re.sub(r"[^A-Z]", "", (s or "").upper())
    cons = [c for c in s if c not in "AEIOU"]; vow = [c for c in s if c in "AEIOU"]
    if is_name and len(cons) >= 4:
        cons = [cons[0], cons[2], cons[3]]
    return ("".join(cons) + "".join(vow) + "XXX")[:3]


def _cf_decode(cf: str) -> dict:
    cf = re.sub(r"\s", "", (cf or "").upper())
    if not _CF_RE.match(cf):
        return {"valid": False, "reason": "Formato non valido: servono 16 caratteri (es. RSSMRA80A01H501U)"}
    if _cf_check_char(cf[:15]) != cf[15]:
        return {"valid": False, "reason": "Carattere di controllo errato: ricontrolla il codice"}
    yy = int(_cf_digits(cf[6:8])); mo = _CF_MONTHS[cf[8]]; dd = int(_cf_digits(cf[9:11]))
    sex = "F" if dd > 40 else "M"
    if dd > 40:
        dd -= 40
    now_yy = datetime.now(timezone.utc).year % 100
    year = 2000 + yy if yy <= now_yy - 14 else 1900 + yy   # una persona ha almeno 14 anni
    try:
        birth = datetime(year, mo, dd).strftime("%Y-%m-%d")
    except ValueError:
        return {"valid": False, "reason": "Data di nascita non valida nel codice"}
    return {"valid": True, "tax_id": cf, "birth_date": birth, "sex": sex, "birth_place_code": cf[11:15], "surname_code": cf[:3], "name_code": cf[3:6]}


@api_router.post("/axon/anagrafica/cf-decode")
async def anag_cf_decode(body: CfDecodeIn, user=Depends(get_current_user)):
    d = _cf_decode(body.tax_id)
    if not d["valid"]:
        return d
    prof = await db.master_profiles.find_one({"user_id": user["user_id"]}, {"_id": 0, "first_name": 1, "last_name": 1}) or {}
    first = (body.first_name or prof.get("first_name") or "").strip()
    last = (body.last_name or prof.get("last_name") or "").strip()
    if not first or not last:
        parts = (user.get("name") or "").strip().split()
        if len(parts) >= 2:
            first = first or parts[0]; last = last or " ".join(parts[1:])
    d["suggest"] = {"first_name": first, "last_name": last, "birth_date": d["birth_date"]}
    d["consistency"] = {
        "first_name": (_cf_name_code(first, True) == d["name_code"]) if first else None,
        "last_name": (_cf_name_code(last, False) == d["surname_code"]) if last else None,
    }
    d["note"] = ("Nome e cognome combaciano con il codice." if all(v for v in d["consistency"].values() if v is not None) and first and last
                 else "Il codice contiene solo le consonanti di nome e cognome: controlla che siano scritti per esteso correttamente.")
    return d


# ============================================================================ PROMPT: anagrafica già fornita → mai richiederla
def _anag_summary(p: dict) -> str:
    if not p:
        return ""
    emails = p.get("emails") or ([p["primary_email"]] if p.get("primary_email") else [])
    rows = [("Nome", f"{p.get('first_name', '')} {p.get('last_name', '')}".strip()), ("Data di nascita", p.get("birth_date")), ("Codice fiscale", p.get("tax_id")),
            ("Telefono", p.get("phone")), ("Email", ", ".join(emails) + (f" (per risposte e file: {p['primary_email']})" if p.get("primary_email") else "")),
            ("Indirizzo principale", p.get("address")), ("Seconda abitazione", p.get("address_second")), ("Indirizzo parente", p.get("address_relative"))]
    if p.get("primary_address") in ("second", "relative"):
        rows.append(("Indirizzo da usare come principale", {"second": "seconda abitazione", "relative": "indirizzo parente"}[p["primary_address"]]))
    lines = [f"- {k}: {v}" for k, v in rows if v]
    return "\n".join(lines)


_anag_prev_prepare_prompt = _prepare_assistant_prompt


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _anag_prev_prepare_prompt(user, body)
    try:
        if prep.get("system_message"):
            p = await db.master_profiles.find_one({"user_id": user["user_id"]}, {"_id": 0})
            summ = _anag_summary(p or {})
            if summ:
                prep["system_message"] += ("\n\n=== ANAGRAFICA UTENTE (già fornita nel wizard/Anagrafica: NON chiedere mai di reinserire questi dati; se l'utente ne comunica uno nuovo "
                                           "l'app lo salva da sola) ===\n" + summ)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[anagrafica] prompt failed: %s", exc)
    return prep


# ============================================================================ CHAT → ANAGRAFICA («il mio telefono è …», «usa la mail X»)
_ANAG_SET_RE = re.compile(
    r"^\s*(?:il mio|la mia|mio|mia)\s+(?:nuovo |nuova )?(telefono|cellulare|numero(?: di telefono)?|mail|e-?mail|indirizzo(?: principale| di casa)?|seconda (?:casa|abitazione)|indirizzo (?:del |di un )?parente|codice fiscale|data di nascita)\s+(?:è|e'|:|=)\s*(.+?)\s*[.!]?\s*$",
    re.IGNORECASE)
_ANAG_MAIL_PRIMARY_RE = re.compile(r"\b(?:usa|usare|rispondimi|rispondi|scrivimi|mandami|inviami|invia|manda)\b.*?\b(?:su|sulla|sull'|a|alla|all'|con|la|usando|verso)?\s*(?:la\s+)?(?:mail|e-?mail|casella|indirizzo)?\s*([\w.+-]+@[\w-]+\.[\w.-]+)", re.IGNORECASE)
_anag_prev_maybe_push_command = _maybe_push_command


async def _maybe_push_command(msg: str, user: dict) -> Optional[dict]:  # noqa: F811
    txt = (msg or "").strip()
    try:
        if txt and len(txt) <= 200:
            m = _ANAG_SET_RE.match(txt)
            if m:
                what, val = m.group(1).lower(), m.group(2).strip()
                upd: Dict[str, Any] = {}; label = ""
                if what.startswith(("telefono", "cellulare", "numero")):
                    upd["phone"] = val; label = "telefono"
                elif "mail" in what:
                    val = val.lower(); label = "email"
                    p = await db.master_profiles.find_one({"user_id": user["user_id"]}, {"_id": 0, "emails": 1}) or {}
                    emails = [e for e in (p.get("emails") or []) if e != val] + [val]
                    upd["emails"] = emails[-5:]; upd["primary_email"] = val
                elif what.startswith("seconda"):
                    upd["address_second"] = val; label = "seconda abitazione"
                elif "parente" in what:
                    upd["address_relative"] = val; label = "indirizzo del parente"
                elif what.startswith("indirizzo"):
                    upd["address"] = val; label = "indirizzo principale"
                elif what.startswith("codice"):
                    d = _cf_decode(val)
                    if not d["valid"]:
                        return {"reply": f"⚠️ Codice fiscale non valido: {d['reason']}", "cmd": "anag_cf_invalid"}
                    upd.update({"tax_id": d["tax_id"], "birth_date": d["birth_date"], "sex": d["sex"], "birth_place_code": d["birth_place_code"], "cf_confirmed": True}); label = "codice fiscale (e data di nascita)"
                elif what.startswith("data"):
                    upd["birth_date"] = val; label = "data di nascita"
                if upd:
                    upd["updated_at"] = utcnow()
                    await db.master_profiles.update_one({"user_id": user["user_id"]}, {"$set": {**upd, "user_id": user["user_id"], "tenant_id": tenant_id(user)}}, upsert=True)
                    return {"reply": f"✅ Aggiornato il tuo {label}: **{val}**. Lo trovi già in Anagrafica: non te lo chiederò più.", "cmd": "anag_update"}
            mp = _ANAG_MAIL_PRIMARY_RE.search(txt)
            if mp and "mail" in txt.lower():
                val = mp.group(1).lower()
                p = await db.master_profiles.find_one({"user_id": user["user_id"]}, {"_id": 0, "emails": 1}) or {}
                emails = [e for e in (p.get("emails") or []) if e != val] + [val]
                await db.master_profiles.update_one({"user_id": user["user_id"]}, {"$set": {"emails": emails[-5:], "primary_email": val, "updated_at": utcnow(), "user_id": user["user_id"], "tenant_id": tenant_id(user)}}, upsert=True)
                return {"reply": f"✅ D'ora in poi rispondo e invio i file a **{val}**.", "cmd": "anag_primary_mail"}
    except Exception as exc:  # noqa: BLE001
        logger.warning("[anagrafica] chat failed: %s", exc)
    return await _anag_prev_maybe_push_command(msg, user)
