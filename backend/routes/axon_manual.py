# axon_manual.py — V50.z554 — MANUALE COMPLETO DELL'APP (Help Center) + AXON COME GUIDA.
# - GET /public/manual            → tutti gli articoli visibili al ruolo (manuale + FAQ), con categorie
# - GET /public/manual/search?q=  → ricerca FULL-TEXT (titolo, percorso, corpo, parole chiave, risposta FAQ): "scanner",
#                                   "Axon Lab", "landing page", "nota vocale"… → articolo giusto. Lessicale con prefissi +
#                                   bonus semantico (MiniLM) se disponibile.
# - Prompt Axon: avvolge _prepare_assistant_prompt → inietta i 5 articoli più pertinenti al messaggio e la REGOLA:
#   ogni risposta su una funzione dell'app include SEMPRE il percorso di navigazione e, se esiste, il chip [[NAV:route|label]].
# Fonte dati: axon_manual_data.MANUAL (un articolo per schermata/funzione). Carica DOPO landing_cms (usa _faq_items_for).
import re as _mn_re
import unicodedata as _mn_ud
from typing import Any, Dict, List, Optional, Tuple

from fastapi import Header

from routes.axon_manual_data import MANUAL


_CAT_OF_PATH = (("Barra in basso", "Schermate principali"), ("Menu → CRM Core", "CRM Core"), ("Menu → AI & Axon", "AI & Axon"),
                ("Menu → Comunicazioni", "Comunicazioni"), ("Menu → Anagrafica", "Anagrafica & DB Master"), ("Menu → Team", "Team & Insights"),
                ("Menu → Amministrazione", "Amministrazione"), ("Pannello Master", "Pannello Master"), ("Pagine pubbliche", "Pagine pubbliche"),
                ("Ecosistema", "Ecosistema AdvisorOS completo"))  # V50.z563 — domini e sottopagine del VPS (solo Super Master)


def _mn_norm(s: str) -> str:
    s = _mn_ud.normalize("NFKD", (s or "").lower())
    s = "".join(c for c in s if not _mn_ud.combining(c))
    return _mn_re.sub(r"[^a-z0-9/]+", " ", s).strip()


def _mn_cat(path: str) -> str:
    for pref, cat in _CAT_OF_PATH:
        if path.startswith(pref):
            return cat
    return "Altro"


_MN_HOW_RX = _mn_re.compile(
    r"^(tocca|scorri|trascina|di'|dì|filtra|conferma|usa|premi|apri|seleziona|compila|digita|tieni|scegli|attiva|imposta|carica|fotografa|"
    r"inserisci|chiedi|scrivi|programma|registra|modifica|segna|mappa|controlla|scarica|collega|clicca|vai|da |con voce|più veloce|pulsanti|"
    r"passi|per |se |quando |basta|puoi|tocc|prem|tap|parla|detta|invia|incolla|trova|cerca|avvia|crea|aggiungi|elimina|esporta|importa|"
    r"condividi|stampa|abilita|disabilita|accendi|spegni|collegati|accedi|entra)",
    _mn_re.I,
)


def _mn_split_how(body: str, how: str, path: str, title: str) -> Tuple[str, str]:
    """V50.z561 — Ogni voce del manuale espone «descrizione breve» e «come si usa» separati. Se l'articolo non ha un campo
    `how` esplicito, le frasi operative (imperativi: Tocca…, Scorri…, Di'…) vengono separate dalla descrizione."""
    if how:
        return body.strip(), how.strip()
    sents = [s.strip() for s in _mn_re.split(r"(?<=[.!?])\s+(?=[A-ZÀ-Ü«“'])", body or "") if s.strip()]
    desc, steps = [], []
    for i, s in enumerate(sents):
        if i > 0 and _MN_HOW_RX.match(s):
            steps.append(s)
        elif steps:
            steps.append(s)
        else:
            desc.append(s)
    if not steps:
        steps = [f"Apri «{path}» e usa i comandi in schermata; oppure chiedi ad Axon «apri {title}»."]
    return " ".join(desc) or body.strip(), " ".join(steps)


def _mn_articles() -> List[Dict[str, Any]]:
    out = []
    for i, a in enumerate(MANUAL):
        desc, how = _mn_split_how(a["body"], a.get("how", ""), a["path"], a["title"])
        out.append({"id": f"man_{i:03d}", "kind": "manual", "title": a["title"], "path": a["path"], "route": a["route"] or None,
                    "category": _mn_cat(a["path"]), "body": a["body"], "desc": desc, "how": how, "kw": a.get("kw", ""), "roles": a.get("roles") or []})
    return out


_ARTICLES = _mn_articles()


def _mn_visible(a: Dict[str, Any], role: Optional[str]) -> bool:
    return not a.get("roles") or (role in a["roles"])


def _mn_faq_as_articles(faq_items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [{"id": f["id"], "kind": "faq", "title": f.get("q", ""), "path": "Aiuto → FAQ", "route": f"/faq?id={f['id']}", "category": "FAQ",
             "body": f.get("a", ""), "kw": "", "roles": f.get("roles") or []} for f in faq_items]


_MN_ECO_TOKENS = {"axon", "axonos", "core", "landing", "italian", "brain", "italianbrain", "dominio", "domini", "ecosistema", "mirror", "vps", "sito"}


def _mn_score(a: Dict[str, Any], q_norm: str, q_tokens: List[str]) -> float:
    title, path, body, kw = _mn_norm(a["title"]), _mn_norm(a["path"]), _mn_norm(a["body"]), _mn_norm(a.get("kw", ""))
    full = f"{title} {path} {body} {kw} {_mn_norm(a.get('route') or '')}"
    score = 0.5 if a.get("kind") == "manual" else 0.0  # a parità, l'articolo del manuale (percorso + deep link) precede la FAQ
    # V50.z563 — richiesta Super Master: «landing», «italian brain», «axon», «core» devono far emergere l'Ecosistema (domini VPS)
    if path.startswith("ecosistema") and any(t in _MN_ECO_TOKENS for t in q_tokens):
        score += 1.2
    if q_norm and q_norm in title:
        score += 6
    elif q_norm and q_norm in full:
        score += 3.5
    for t in q_tokens:
        if len(t) < 2:
            continue
        if _mn_re.search(rf"\b{_mn_re.escape(t)}", title):
            score += 2.2
        elif _mn_re.search(rf"\b{_mn_re.escape(t)}", kw):
            score += 1.8
        elif _mn_re.search(rf"\b{_mn_re.escape(t)}", path):
            score += 1.4
        elif _mn_re.search(rf"\b{_mn_re.escape(t)}", body):
            score += 1.0
        elif len(t) >= 5 and t[:5] in full:  # radice (es. "modific" → "modifica")
            score += 0.5
    return score


def manual_search(q: str, articles: List[Dict[str, Any]], limit: int = 8) -> List[Tuple[float, Dict[str, Any]]]:
    q_norm = _mn_norm(q)
    toks = [t for t in q_norm.split() if t not in {"come", "dove", "trovo", "si", "fa", "il", "la", "lo", "le", "gli", "un", "una", "di", "da", "in", "per", "a", "e", "che", "del", "della", "dei", "posso", "faccio", "usa", "trova", "mi", "al", "alla", "cosa"}]
    scored = [(_mn_score(a, q_norm, toks), a) for a in articles]
    scored = [x for x in scored if x[0] >= 1.0]
    scored.sort(key=lambda x: -x[0])
    return scored[:limit]


@api_router.get("/public/manual")  # noqa: F821
async def public_manual(authorization: Optional[str] = Header(None)):
    faq_items, role = await _faq_items_for(authorization)  # noqa: F821
    arts = [a for a in _ARTICLES if _mn_visible(a, role)] + _mn_faq_as_articles(faq_items)
    cats = []
    for a in arts:
        if a["category"] not in cats:
            cats.append(a["category"])
    return {"items": arts, "categories": cats, "role": role, "total": len(arts)}


@api_router.get("/public/manual/search")  # noqa: F821
async def public_manual_search(q: str = "", k: int = 8, authorization: Optional[str] = Header(None)):
    q = (q or "").strip()
    if len(q) < 2:
        return {"items": [], "q": q}
    faq_items, role = await _faq_items_for(authorization)  # noqa: F821
    arts = [a for a in _ARTICLES if _mn_visible(a, role)] + _mn_faq_as_articles(faq_items)
    res = manual_search(q, arts, max(1, min(int(k or 8), 20)))
    return {"items": [dict(a, score=round(s, 2)) for s, a in res], "q": q}


# ───────────────────────────── Axon come guida: iniezione nel prompt ─────────────────────────────
_MN_HOWTO_RE = _mn_re.compile(r"\b(come|dove|cos'?[eè]|a cosa serve|quale|quali|mostrami|spiegami|aiutami|modific|configur|imposta|attiv|trov|aggiung|cre[ao]|apr[io]|cambi|funzion|manuale|guida|landing|cms|scanner|nota vocale|offline|notific|statistic|report)", _mn_re.I)

_mn_prev_prepare_prompt = _prepare_assistant_prompt  # noqa: F821


def _mn_manual_section(user: dict, msg: str) -> str:
    """V50.z555 — Blocco «MAPPA DELL'APP» (articoli del manuale pertinenti alla domanda) da appendere al system prompt.
    Condiviso fra stream (_prepare_assistant_prompt) e non-stream (/assistant/chat, voce/Viola). Stringa vuota se non pertinente."""
    if not msg or not _MN_HOWTO_RE.search(msg):
        return ""
    role = _faq_role_of(user)  # noqa: F821
    arts = [a for a in _ARTICLES if _mn_visible(a, role)]
    best = manual_search(msg, arts, 5)
    if not best:
        return ""
    logger.info("[manual] prompt: %d articoli → %s", len(best), ", ".join(a["title"][:30] for _, a in best))
    lines = []
    for _, a in best:
        if (a.get("route") or "").startswith("http"):
            link = f" · LINK ESTERNO (citalo per esteso, cliccabile): {a['route']}"  # V50.z563 — ecosistema domini
        else:
            link = f" · deep link: [[NAV:{a['route']}|{a['title']}]]" if a.get("route") and not a["route"].endswith("/") else ""
        lines.append(f"- {a['title']} — PERCORSO: {a['path']}{link}\n  Cosa fa: {a.get('desc') or a['body']}\n  Come si usa: {a.get('how') or ''}")
    return (
        "\n\n🗺️ MAPPA DELL'APP (Manuale ufficiale — articoli pertinenti alla domanda):\n" + "\n".join(lines) +
        "\nREGOLA OBBLIGATORIA: quando rispondi su una funzione dell'app indica SEMPRE (1) il PERCORSO di navigazione esatto "
        "(es. «Menu → Contatti → Scheda cliente»), (2) i passi operativi in ordine, (3) il chip di apertura diretta nel formato ESATTO "
        "[[NAV:<route>|<etichetta>]] se la route è indicata sopra. Usa SOLO le route elencate; non inventarne. "
        "Se l'utente chiede DOVE si trova qualcosa, rispondi prima con il percorso, poi con il chip."
    )


_MN_ERR_REPLY_RE = _mn_re.compile(r"^(sono temporaneamente offline|⏱️|non ho ricevuto una risposta|non riesco)", _mn_re.I)


def _mn_nav_fallback(user: dict, msg: str, reply: str) -> str:
    """V50.z555 — Rete di sicurezza deterministica: se la domanda è un «come/dove» sull'app e il modello ha omesso il chip
    [[NAV:…]], restituisce il chip dell'articolo più pertinente (score ≥ 3 e route apribile) da accodare alla risposta.
    Stringa vuota se non pertinente, se il chip c'è già o se la risposta è un messaggio di errore/offline."""
    if not msg or not reply or _MN_ERR_REPLY_RE.match(reply.strip()) or not _MN_HOWTO_RE.search(msg):
        return ""
    has_chip = "[[NAV:" in reply
    has_path = ("→" in reply) or ("Percorso" in reply)
    if has_chip and has_path:
        return ""
    role = _faq_role_of(user)  # noqa: F821
    best = manual_search(msg, [a for a in _ARTICLES if _mn_visible(a, role)], 1)
    if not best or best[0][0] < 3.0:
        return ""
    a = best[0][1]
    out = ""
    if not has_path and a.get("path"):
        out += f"\n\n📍 Percorso: {a['path']}"  # V50.z561 — il percorso di menu c'è SEMPRE, anche nelle risposte rapide/cache
    if not has_chip and a.get("route") and not a["route"].endswith("/") and not a["route"].startswith("http"):
        logger.info("[manual] chip fallback → %s (%s)", a["title"][:30], a["route"])
        out += f"\n\n[[NAV:{a['route']}|Apri: {a['title']}]]"
    return out


# V50.z555 — Intento «navigate» anche per le domande how-to in forma libera («Spiegami dove registro una nota vocale…»): la regex
# _DL_HOWTO_RX di axon_deeplink_map richiede «come/dove» a INIZIO frase, quindi il Navigatore classificava «crm» e rimuoveva il chip
# [[NAV]] che il manuale aveva appena fatto generare. Qui: domanda how-to + articolo del manuale con route (score ≥ 3) → navigate.
_mn_prev_nav_intent = _nav_intent  # noqa: F821


def _mn_is_howto(msg: str) -> bool:
    if not msg or len(msg) > 220 or not _MN_HOWTO_RE.search(msg):
        return False
    try:
        if _nav_is_creative(msg) or _nav_is_info_query(msg):  # noqa: F821
            return False
    except Exception:  # noqa: BLE001
        pass
    best = manual_search(msg, _ARTICLES, 1)
    return bool(best and best[0][0] >= 3.0 and best[0][1].get("route") and not best[0][1]["route"].endswith("/"))


def _nav_intent(msg: str) -> str:  # noqa: F811
    r = _mn_prev_nav_intent(msg)
    if r == "crm" and _mn_is_howto(msg):
        return "navigate"
    return r


# V50.z555 — Il template deterministico «Apri X» del Navigatore («Dove trovo lo scanner…») ora antepone il PERCORSO di menu
# preso dal manuale (📍 Percorso: Barra in basso → Scanner), così anche le risposte istantanee insegnano dove sta la funzione.
_mn_prev_template_reply = _nav_template_reply  # noqa: F821
_MN_BY_ROUTE: Dict[str, Dict[str, Any]] = {a["route"]: a for a in _ARTICLES if a.get("route")}


def _nav_template_reply(msg: str, user: dict):  # noqa: F811
    r = _mn_prev_template_reply(msg, user)
    try:
        if r and r.get("reply"):
            m = _mn_re.search(r"\[\[NAV:([^|\]]+)\|", r["reply"])
            a = _MN_BY_ROUTE.get(m.group(1).split("?")[0]) if m else None
            if a and a.get("path") and "Percorso" not in r["reply"]:
                r["reply"] = f"📍 Percorso: {a['path']}\n" + r["reply"]
    except Exception:  # noqa: BLE001
        pass
    return r


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _mn_prev_prepare_prompt(user, body)
    try:
        if isinstance(prep, dict) and prep.get("query_class") != "simple" and prep.get("system_message"):
            prep["system_message"] += _mn_manual_section(user, getattr(body, "message", "") or "")
    except Exception as exc:  # noqa: BLE001
        logger.warning("[manual] prompt failed: %s", exc)
    return prep
