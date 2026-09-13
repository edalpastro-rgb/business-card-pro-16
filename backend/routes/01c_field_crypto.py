# 01c_field_crypto.py — V50.z217 — Cifratura TRASPARENTE a livello di campo per `master_profiles` (modulo ISOLATO)
#
# Campi sensibili cifrati a riposo nel DB: codice fiscale (tax_id), data di nascita (birth_date), indirizzi (address, address_second,
# address_relative), telefono (phone). Nome, cognome, mail, ruolo restano in chiaro (ricerca). L'utente non vede nulla: la cifratura
# avviene PRIMA della scrittura (update_one/insert_one/replace_one → $set/$setOnInsert) e la decifratura ALLA LETTURA (find_one/find).
# Meccanismo: `db.master_profiles` viene sostituito da un proxy (`_FcCollection`) che avvolge la collection Motor → ogni modulo che fa
# `db.master_profiles.find_one(...)` / `update_one(...)` è coperto senza modifiche. Formato: "enc:v1:<fernet>" (valori legacy in chiaro
# restano leggibili e vengono migrati all'avvio). Chiave: FIELD_ENC_KEY (Fernet urlsafe base64) oppure derivata da JWT_SECRET (sha256).
# Limite noto (voluto): i campi cifrati NON sono filtrabili con query Mongo (es. find by phone).

import hashlib as _fc_hashlib
from cryptography.fernet import Fernet as _FcFernet, InvalidToken as _FcInvalidToken

_FC_FIELDS = ("tax_id", "birth_date", "address", "address_second", "address_relative", "phone")
_FC_PREFIX = "enc:v1:"


def _fc_make_fernet() -> _FcFernet:
    key = (os.environ.get("FIELD_ENC_KEY") or "").strip()
    if not key:
        seed = (os.environ.get("JWT_SECRET") or "advisoros-field-crypto").encode()
        key = base64.urlsafe_b64encode(_fc_hashlib.sha256(b"advisoros:field-crypto:v1:" + seed).digest()).decode()
    return _FcFernet(key.encode() if isinstance(key, str) else key)


_FC_FERNET = _fc_make_fernet()


def fc_encrypt(v):
    if not isinstance(v, str) or not v or v.startswith(_FC_PREFIX):
        return v
    return _FC_PREFIX + _FC_FERNET.encrypt(v.encode("utf-8")).decode("ascii")


def fc_decrypt(v):
    if not isinstance(v, str) or not v.startswith(_FC_PREFIX):
        return v
    try:
        return _FC_FERNET.decrypt(v[len(_FC_PREFIX):].encode("ascii")).decode("utf-8")
    except (_FcInvalidToken, Exception):  # noqa: BLE001
        return ""


def _fc_enc_doc(doc):
    if isinstance(doc, dict):
        for f in _FC_FIELDS:
            if f in doc:
                doc[f] = fc_encrypt(doc[f])
    return doc


def _fc_dec_doc(doc):
    if isinstance(doc, dict):
        for f in _FC_FIELDS:
            if f in doc:
                doc[f] = fc_decrypt(doc[f])
    return doc


def _fc_enc_update(upd):
    if not isinstance(upd, dict):
        return upd
    out = dict(upd)
    for op in ("$set", "$setOnInsert"):
        if isinstance(out.get(op), dict):
            out[op] = _fc_enc_doc(dict(out[op]))
    if not any(k.startswith("$") for k in out):  # replace-style document
        out = _fc_enc_doc(out)
    return out


class _FcCursor:
    def __init__(self, cur):
        self._cur = cur

    def __getattr__(self, name):
        attr = getattr(self._cur, name)
        if name in ("sort", "limit", "skip", "batch_size", "hint", "collation"):
            def _chain(*a, **k):
                attr(*a, **k)
                return self
            return _chain
        return attr

    def __aiter__(self):
        return self

    async def __anext__(self):
        d = await self._cur.__anext__()
        return _fc_dec_doc(d)

    async def to_list(self, length=None):
        return [_fc_dec_doc(d) for d in await self._cur.to_list(length)]


class _FcCollection:
    """Proxy trasparente della collection Motor: cifra in scrittura, decifra in lettura."""

    def __init__(self, real):
        self._real = real

    def __getattr__(self, name):
        return getattr(self._real, name)

    async def find_one(self, *a, **k):
        return _fc_dec_doc(await self._real.find_one(*a, **k))

    def find(self, *a, **k):
        return _FcCursor(self._real.find(*a, **k))

    async def update_one(self, flt, upd, *a, **k):
        return await self._real.update_one(flt, _fc_enc_update(upd), *a, **k)

    async def update_many(self, flt, upd, *a, **k):
        return await self._real.update_many(flt, _fc_enc_update(upd), *a, **k)

    async def insert_one(self, doc, *a, **k):
        return await self._real.insert_one(_fc_enc_doc(dict(doc)), *a, **k)

    async def replace_one(self, flt, doc, *a, **k):
        return await self._real.replace_one(flt, _fc_enc_doc(dict(doc)), *a, **k)

    async def find_one_and_update(self, flt, upd, *a, **k):
        return _fc_dec_doc(await self._real.find_one_and_update(flt, _fc_enc_update(upd), *a, **k))


_fc_real_master_profiles = db.master_profiles
db.master_profiles = _FcCollection(_fc_real_master_profiles)


@app.on_event("startup")
async def _fc_migrate_plaintext():
    """Migra una tantum i valori legacy in chiaro → cifrati (idempotente)."""
    try:
        n = 0
        async for d in _fc_real_master_profiles.find({}, {"_id": 1, **{f: 1 for f in _FC_FIELDS}}):
            upd = {f: fc_encrypt(d[f]) for f in _FC_FIELDS if isinstance(d.get(f), str) and d[f] and not d[f].startswith(_FC_PREFIX)}
            if upd:
                await _fc_real_master_profiles.update_one({"_id": d["_id"]}, {"$set": upd})
                n += 1
        if n:
            logger.info("[field-crypto] master_profiles: %d profili migrati a campi cifrati", n)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[field-crypto] migrazione fallita: %s", exc)
