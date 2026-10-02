# 22_axon_alarm_commit_teach.py — AxonOS: comandi sveglia, impegni, distillazione regole
# Estratto da server.py (righe originali 15108-16033). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# V50.z125 — Axon Alarm commands (voce/testo): "imposta timer 15 minuti",
# "sveglia domani alle 7", "ricordami di chiamare Mario stasera".
# Flusso: regex di pre-filtro → parser (regex veloce per i timer semplici,
# altrimenti LLM JSON) → creazione doc in axon_alarms → risposta di conferma.
# Il client riceve `alarm` nell'evento `done` e schedula la notifica locale.
# =========================================================================
_ALARM_INTENT_RE = re.compile(
    r"\b(timer|sveglia|sveglie|svegliami|ricordami|ricordamelo|promemoria|conto alla rovescia|"
    r"countdown|avvisami|avvertimi|cronometro)\b",
    re.IGNORECASE,
)
_ALARM_TIMER_RE = re.compile(
    r"\b(?:timer|conto alla rovescia|countdown)\b.*?(?:di\s+|da\s+)?"
    r"(\d{1,3}|un[o']?|una|due|tre|quattro|cinque|dieci|quindici|venti|trenta|quarantacinque|sessanta)"
    r"\s*(?:'|′)?\s*(second[oi]|sec|s|minut[oi]|min|m|or[ae]|h)\b(?:\s*e\s*(mezz[ao]|un quarto|tre quarti|(\d{1,2})\s*(?:minut[oi]|min)?))?",
    re.IGNORECASE,
)
_ALARM_NUM_WORDS = {
    "un": 1, "uno": 1, "un'": 1, "una": 1, "due": 2, "tre": 3, "quattro": 4, "cinque": 5,
    "dieci": 10, "quindici": 15, "venti": 20, "trenta": 30, "quarantacinque": 45, "sessanta": 60,
}
_ALARM_WEEKDAYS_IT = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"]


def _rome_now() -> datetime:
    import zoneinfo as _zi
    return utcnow().astimezone(_zi.ZoneInfo("Europe/Rome"))


def _fmt_duration_it(seconds: int) -> str:
    h, rem = divmod(int(seconds), 3600)
    m, s = divmod(rem, 60)
    parts = []
    if h: parts.append(f"{h} or{'a' if h == 1 else 'e'}")
    if m: parts.append(f"{m} minut{'o' if m == 1 else 'i'}")
    if s and not h: parts.append(f"{s} second{'o' if s == 1 else 'i'}")
    return " e ".join(parts) or "0 secondi"


def _parse_timer_fast(txt: str) -> Optional[int]:
    """Parser regex per timer semplici → durata in secondi, None se non matcha."""
    m = _ALARM_TIMER_RE.search(txt)
    if not m:
        return None
    raw_n, unit, extra, extra_min = m.group(1), m.group(2).lower(), (m.group(3) or "").lower(), m.group(4)
    n = _ALARM_NUM_WORDS.get(raw_n.lower().rstrip("'"), None)
    if n is None:
        try:
            n = int(raw_n)
        except Exception:
            return None
    if unit.startswith("or") or unit == "h":
        secs = n * 3600
        if extra.startswith("mezz"): secs += 1800
        elif extra == "un quarto": secs += 900
        elif extra == "tre quarti": secs += 2700
        elif extra_min: secs += int(extra_min) * 60
    elif unit.startswith("min") or unit == "m":
        secs = n * 60
        if extra.startswith("mezz"): secs += 30
    else:
        secs = n
    return secs if 0 < secs <= 24 * 3600 else None


async def _parse_alarm_llm(msg: str) -> Optional[dict]:
    """Chiede a un modello veloce di estrarre il comando in JSON strutturato."""
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        return None
    now = _rome_now()
    weekday_it = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"][now.weekday()]
    system = (
        "Sei il parser comandi di Axon, assistente di un CRM italiano. Trasformi richieste in linguaggio "
        "naturale (anche da trascrizione vocale, quindi con possibili errori) in un comando JSON per creare "
        "timer, sveglie o promemoria. Rispondi SOLO con JSON valido, senza testo attorno."
    )
    prompt = f"""ORA ATTUALE (Europe/Rome): {now.strftime('%Y-%m-%d %H:%M')} ({weekday_it})

MESSAGGIO UTENTE: «{msg.strip()}»

Rispondi con questo JSON:
{{"action": "create" | "none",
 "kind": "timer" | "alarm" | "reminder" | null,
 "label": "etichetta breve (max 60 caratteri)",
 "duration_seconds": int | null,
 "time": "HH:MM" | null,
 "weekdays": [0-6] | null,
 "trigger_at": "YYYY-MM-DDTHH:MM" | null,
 "missing": "domanda da porre all'utente se manca un dato essenziale" | null}}

REGOLE:
- timer: durata relativa ("timer 15 minuti", "avvisami tra un'ora e mezza", "conto alla rovescia 90 secondi") → kind timer, duration_seconds. label es. "Timer" o "Timer pasta" se c'è uno scopo.
- alarm (sveglia): un orario del giorno ("sveglia alle 7", "svegliami domani alle 6 e mezza", "sveglia ogni lunedì alle 8") → kind alarm, time in 24h. weekdays SOLO se ricorrente (0=Domenica,1=Lunedì,...,6=Sabato; "giorni feriali"=[1,2,3,4,5], "tutti i giorni"=[0,1,2,3,4,5,6]); per "domani"/one-shot usa []. label "Sveglia".
- reminder (promemoria): "ricordami di X ...", "promemoria: X alle 18", "avvisami domani alle 10 di chiamare Rossi" → kind reminder, trigger_at in ora locale Europe/Rome, label = cosa fare (es. "Chiamare Mario Rossi"). Se manca l'orario ma c'è il giorno usa: "stasera"=20:00, "domattina"/"mattina"=08:30, "pomeriggio"=15:00, "pranzo"=13:00, "sera"=20:00; "tra X minuti/ore" → ora attuale + X. Il trigger_at deve essere nel FUTURO (se l'orario di oggi è già passato e non è indicato il giorno, usa domani).
- "alle 7" senza altro → se le 7 di oggi sono già passate → domani alle 7 (comunque per alarm serve solo time).
- action "none" se l'utente NON chiede di creare qualcosa (domanda, elenco, "quali sveglie ho", "cancella il timer", conversazione generica) → missing null.
- action "none" + missing compilato se vuole creare ma manca un dato essenziale (es. "ricordami di chiamare Mario" senza quando → missing "Per quando vuoi il promemoria per chiamare Mario?")."""
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(api_key=key, session_id=f"alarm-nlp-{uuid.uuid4().hex[:8]}", system_message=system).with_model("openai", "gpt-5.4-mini")
        r = await asyncio.wait_for(chat.send_message(UserMessage(text=prompt)), timeout=20)
        txt = (r or "").strip()
        if txt.startswith("```"):
            txt = re.sub(r"^```(?:json)?\n?|\n?```$", "", txt).strip()
        import json as _json
        return _json.loads(txt)
    except Exception as e:
        logger.warning("[axon-alarm-nlp] parse failed: %s", e)
        return None


async def _maybe_alarm_command(msg: str, user: dict) -> Optional[dict]:
    """Se il messaggio è un comando per creare timer/sveglia/promemoria, lo esegue
    e ritorna {"reply", "cmd", "alarm"}. Ritorna None se non è un comando."""
    txt = (msg or "").strip()
    if not txt or len(txt) > 300 or not _ALARM_INTENT_RE.search(txt):
        return None
    import zoneinfo as _zi
    rome = _zi.ZoneInfo("Europe/Rome")

    payload: Optional[dict] = None
    # Fast path: timer semplice (nessuna chiamata LLM)
    fast = _parse_timer_fast(txt)
    if fast:
        payload = {"kind": "timer", "label": "Timer", "duration_seconds": fast}
    else:
        parsed = await _parse_alarm_llm(txt)
        if not parsed or not isinstance(parsed, dict):
            return None
        if parsed.get("action") != "create":
            missing = (parsed.get("missing") or "").strip()
            if missing:
                return {"reply": f"⏰ {missing}", "cmd": "alarm_ask", "alarm": None}
            # Domanda sull'elenco ("quali sveglie ho?", "ho timer attivi?") → lista dal DB
            if re.search(r"\b(quali|quante|quanti|elenca|mostra|lista|ho|attiv[ie])\b", txt, re.IGNORECASE):
                items = await db.axon_alarms.find({"user_id": user["user_id"], "enabled": True}, {"_id": 0}).sort("created_at", -1).to_list(50)
                if not items:
                    return {"reply": "⏰ Non hai timer, sveglie o promemoria attivi.", "cmd": "alarm_list", "alarm": None}
                lines = [f"⏰ **Attivi ({len(items)})**\n"]
                for a in items:
                    k = a.get("kind")
                    if k == "alarm":
                        wds = a.get("weekdays") or []
                        when = ("ogni " + ", ".join(_ALARM_WEEKDAYS_IT[d] for d in wds)) if wds else "one-shot"
                        lines.append(f"• ⏰ {a.get('label')} — {a.get('time')} ({when})")
                    else:
                        try:
                            tl = datetime.fromisoformat(a["trigger_at"]).astimezone(rome).strftime("%d/%m %H:%M")
                        except Exception:
                            tl = "?"
                        lines.append(f"• {'⏱️' if k == 'timer' else '🔔'} {a.get('label')} — {tl}")
                return {"reply": "\n".join(lines), "cmd": "alarm_list", "alarm": None}
            return None
        kind = (parsed.get("kind") or "").lower()
        label = (parsed.get("label") or "").strip() or {"timer": "Timer", "alarm": "Sveglia"}.get(kind, "Promemoria")
        payload = {"kind": kind, "label": label}
        if kind == "timer":
            try:
                payload["duration_seconds"] = int(parsed.get("duration_seconds") or 0)
            except Exception:
                payload["duration_seconds"] = 0
        elif kind == "alarm":
            payload["time"] = (parsed.get("time") or "").strip()
            wd = parsed.get("weekdays") or []
            payload["weekdays"] = [int(d) for d in wd if isinstance(d, (int, float)) and 0 <= int(d) <= 6]
        elif kind == "reminder":
            raw = (parsed.get("trigger_at") or "").strip()
            try:
                local_dt = datetime.fromisoformat(raw)
                if local_dt.tzinfo is None:
                    local_dt = local_dt.replace(tzinfo=rome)
            except Exception:
                return {"reply": "⏰ Per quando vuoi impostare il promemoria? Dimmi giorno e ora.", "cmd": "alarm_ask", "alarm": None}
            if local_dt <= _rome_now() + timedelta(seconds=30):
                return {"reply": "⏰ L'orario indicato è già passato. Per quando vuoi il promemoria?", "cmd": "alarm_ask", "alarm": None}
            payload["trigger_at"] = local_dt.astimezone(timezone.utc).isoformat()
        else:
            return None

    try:
        doc = await _create_axon_alarm_doc(user, payload)
    except HTTPException as he:
        logger.info("[axon-alarm-nlp] invalid payload %s: %s", payload, he.detail)
        return {"reply": "⏰ Non ho capito bene quando impostarlo: puoi ripetere indicando durata o orario?", "cmd": "alarm_ask", "alarm": None}

    kind = doc["kind"]
    if kind == "timer":
        end_local = datetime.fromisoformat(doc["trigger_at"]).astimezone(rome)
        reply = f"⏱️ Timer di {_fmt_duration_it(doc['duration_seconds'])} impostato: suonerà alle {end_local.strftime('%H:%M')}."
    elif kind == "alarm":
        wds = doc.get("weekdays") or []
        if wds:
            when = "tutti i giorni" if len(wds) == 7 else "ogni " + ", ".join(_ALARM_WEEKDAYS_IT[d] for d in wds)
        else:
            now_l = _rome_now()
            h, m = (int(x) for x in doc["time"].split(":"))
            when = "oggi" if (h, m) > (now_l.hour, now_l.minute) else "domani"
        reply = f"⏰ Sveglia impostata alle {doc['time']} ({when})."
    else:
        trig_local = datetime.fromisoformat(doc["trigger_at"]).astimezone(rome)
        today = _rome_now().date()
        d = trig_local.date()
        if d == today: day_s = "oggi"
        elif d == today + timedelta(days=1): day_s = "domani"
        else: day_s = f"{_ALARM_WEEKDAYS_IT[(trig_local.weekday() + 1) % 7]} {trig_local.strftime('%d/%m')}"
        reply = f"🔔 Promemoria «{doc['label']}» impostato per {day_s} alle {trig_local.strftime('%H:%M')}."
    reply += "\n\nLo trovi in *Timer & Sveglie*."
    return {"reply": reply, "cmd": "alarm_create", "alarm": doc}


# =========================================================================
# V50.z129 — Cattura automatica impegni di Axon ("da ora farò X").
# Quando la risposta contiene una frase di impegno esplicito ("da ora in
# avanti…", "d'ora in poi…", "da adesso…", "da questo momento…") la regola
# viene salvata SUBITO in `ai_teach_rules` (auto_generated=True), senza
# attendere la distillazione notturna delle 04:00.
# =========================================================================
_AXON_COMMITMENT_RE = re.compile(
    r"(?:\bd[a']\s*ora\s+in\s+(?:avanti|poi)|\bda\s+ora\b|\bda\s+adesso\b|\bda\s+questo\s+momento\b|"
    r"\bda\s+oggi\s+in\s+(?:avanti|poi))",
    re.IGNORECASE,
)
_AXON_COMMITMENT_VERB_RE = re.compile(
    r"\b(far[òo]|user[òo]|applicher[òo]|terr[òo]|considerer[òo]|risponder[òo]|ricorder[òo]|includer[òo]|"
    r"eviter[òo]|indicher[òo]|mostrer[òo]|calcoler[òo]|tratter[òo]|proporr[òo]|segnaler[òo]|"
    r"utilizzer[òo]|verificher[òo]|controller[òo]|scriver[òo]|chiamer[òo]|salver[òo]|aggiunger[òo]|formatter[òo]|"
    r"non\s+\w+r[òo]|mi\s+ricorder[òo]|ti\s+\w+r[òo])\b",
    re.IGNORECASE,
)


def _extract_axon_commitments(reply: str) -> List[str]:
    """Ritorna le frasi della risposta che contengono un impegno esplicito di Axon."""
    if not reply or len(reply) > 20000:
        return []
    out: List[str] = []
    for raw in re.split(r"(?<=[.!?])\s+|\n+", reply):
        s = raw.strip().strip("*-•> ").strip()
        if len(s) < 15 or len(s) > 400:
            continue
        if _AXON_COMMITMENT_RE.search(s) and _AXON_COMMITMENT_VERB_RE.search(s):
            out.append(s)
        if len(out) >= 3:
            break
    return out


async def _auto_capture_commitment_rules(user: dict, user_msg: str, reply: str) -> int:
    """Salva come regole `ai_teach_rules` gli impegni espliciti trovati nella risposta.
    Dedup per testo normalizzato. Ritorna il numero di regole create."""
    try:
        sentences = _extract_axon_commitments(reply)
        if not sentences:
            return 0
        tid = tenant_id(user)
        created = 0
        for s in sentences:
            norm = re.sub(r"\s+", " ", s).strip().lower()
            exists = await db.ai_teach_rules.find_one(
                {"user_id": tid, "$or": [{"text_norm": norm}, {"text": s}]}, {"_id": 0, "rule_id": 1}
            )
            if exists:
                continue
            title = _AXON_COMMITMENT_RE.sub("", s).replace("**", "").replace("__", "").strip(" ,;:-").strip()
            title = (title[:1].upper() + title[1:]) if title else s
            if len(title) > 70:
                title = title[:67].rstrip() + "…"
            now = utcnow()
            doc = {
                "rule_id": f"aitr_{uuid.uuid4().hex[:12]}",
                "user_id": tid,
                "created_by": user["user_id"],
                "categories": ["Generale"],
                "category": "Generale",
                "title": title,
                "text": s,
                "text_norm": norm,
                "files": [],
                # V50.z144 — gli impegni "da ora farò X" sono PINNED (direttive vincolanti), non suggerimenti
                "auto_generated": False,
                "pinned": True,
                "source": "chat_commitment",
                "source_user_message": (user_msg or "")[:500],
                "created_at": now,
                "updated_at": now,
            }
            await db.ai_teach_rules.insert_one(doc)
            created += 1
            logger.info("[axon-auto-rule] tenant=%s regola catturata: %s", tid, title)
        return created
    except Exception as exc:
        logger.warning("[axon-auto-rule] capture failed: %s", exc)
        return 0


# =========================================================================
# V50.z130 — Distillazione regole ON-DEMAND ("lezioni" insegnate in chat).
# Quando l'utente insegna qualcosa ad Axon ("ricorda che…", "da ora in poi…",
# "quando ti chiedo X fai Y", "non usare mai…") la lezione viene distillata
# SUBITO in una regola `ai_teach_rules` (LLM Haiku, JSON) e persiste da quel
# momento, senza attendere il job notturno delle 04:00 (che resta invariato).
# Trigger: automatico dopo ogni risposta (se il messaggio utente ha intento
# didattico) + manuale `POST /axon/teach/distill-now` sulla sessione.
# =========================================================================
_TEACH_INTENT_RE = re.compile(
    r"(ricord(a|ati|atelo|atevi)\s+(che|di|sempre|questo)|\bimpara\b|\bimparalo\b|\bmemorizza\b|tieni\s+(presente|a\s+mente)|"
    r"\bd[a']\s*ora\s+in\s+(avanti|poi)|\bda\s+adesso\b|\bda\s+ora\b|\bda\s+oggi\b|quando\s+ti\s+chied|"
    r"\bregola\s*:|nuova\s+regola|non\s+fare\s+pi[uù]|non\s+devi\s+(mai|pi[uù])|devi\s+sempre|usa\s+sempre|"
    r"non\s+usare\s+mai|considera\s+sempre|\binsegn|sappi\s+che|per\s+il\s+futuro|la\s+prossima\s+volta|"
    r"ogni\s+volta\s+che|d[a']\s*ora\s+in\s+avanti|non\s+includere\s+mai|includi\s+sempre|rispondi\s+sempre)",
    re.IGNORECASE,
)


def _is_teach_intent(msg: str) -> bool:
    m = (msg or "").strip()
    return 8 <= len(m) <= 3000 and bool(_TEACH_INTENT_RE.search(m))


async def _llm_extract_lessons(dialog: str, existing_titles: List[str], max_rules: int = 3) -> List[dict]:
    """Chiede a Claude Haiku di estrarre le lezioni (istruzioni per l'assistente)
    presenti nel dialogo. Ritorna [{title, category, text}]."""
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key or not dialog.strip():
        return []
    cats_csv = ", ".join(_RULE_PROPOSAL_CATEGORIES)
    system_prompt = (
        "Sei il modulo di apprendimento di Axon, assistente AI per consulenti energetici italiani. "
        "Ricevi uno scambio di chat e devi estrarre le LEZIONI che l'utente ha insegnato esplicitamente "
        "all'assistente (preferenze, procedure, regole, correzioni, 'da ora in poi fai X', 'ricorda che Y').\n"
        "Trasforma ogni lezione in una regola ISTRUTTIVA per l'assistente ('Quando…, fai…' / 'Usa sempre…').\n"
        "NON creare regole da semplici domande, da dati CRM puntuali (nomi clienti, appuntamenti) o da "
        "informazioni che l'assistente ha fornito di sua iniziativa. "
        f"Max {max_rules} regole. Titolo max 60 char; text 1-4 righe, chiaro e autonomo. "
        "Categoria SEMPRE una tra: " + cats_csv + ".\n"
        "OUTPUT: JSON puro, senza markdown: {\"rules\": [{\"title\": \"...\", \"category\": \"...\", \"text\": \"...\"}]}. "
        "Se non c'è nessuna lezione esplicita: {\"rules\": []}."
    )
    user_prompt = (
        "Regole già esistenti (NON duplicare): " + (", ".join(existing_titles[:40]) or "nessuna") + "\n\n"
        "=== SCAMBIO ===\n" + dialog[:12000]
    )
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(api_key=key, session_id=f"teach_now_{uuid.uuid4().hex[:8]}", system_message=system_prompt).with_model("anthropic", "claude-haiku-4-5")
        raw = (await asyncio.wait_for(chat.send_message(UserMessage(text=user_prompt)), timeout=40) or "").strip()
    except Exception as exc:
        logger.warning("[teach-now] LLM failed: %s", exc)
        return []
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\n?|\n?```$", "", raw).strip()
    import json as _json
    try:
        data = _json.loads(raw)
    except Exception:
        m = re.search(r"\{[\s\S]*\}", raw)
        if not m:
            return []
        try:
            data = _json.loads(m.group(0))
        except Exception:
            return []
    rules = data.get("rules") if isinstance(data, dict) else None
    out: List[dict] = []
    for r in (rules or [])[:max_rules]:
        if not isinstance(r, dict):
            continue
        title = str(r.get("title") or "").strip()[:120]
        text = str(r.get("text") or "").strip()
        cat = str(r.get("category") or "Generale").strip()
        if not title or len(text) < 15:
            continue
        if cat not in _RULE_PROPOSAL_CATEGORIES:
            cat = "Generale"
        out.append({"title": title, "category": cat, "text": text})
    return out


async def _save_distilled_rules(user: dict, rules: List[dict], source: str, source_msg: str = "", pinned: bool = False) -> List[dict]:
    """Inserisce le regole distillate in ai_teach_rules (dedup su titolo/testo normalizzati).
    V50.z143 — `pinned=True` salva come regola MANUALE (`auto_generated=False`) = priorità PINNED."""
    tid = tenant_id(user)
    created: List[dict] = []
    for r in rules:
        text_norm = re.sub(r"\s+", " ", r["text"]).strip().lower()
        title_norm = re.sub(r"\s+", " ", r["title"]).strip().lower()
        dup = await db.ai_teach_rules.find_one(
            {"user_id": tid, "$or": [{"text_norm": text_norm}, {"title_norm": title_norm}]},
            {"_id": 0, "rule_id": 1},
        )
        if dup:
            continue
        # Dedup "soft" sul titolo (case-insensitive) contro regole manuali senza title_norm
        dup2 = await db.ai_teach_rules.find_one(
            {"user_id": tid, "title": {"$regex": f"^{re.escape(r['title'])}$", "$options": "i"}}, {"_id": 0, "rule_id": 1}
        )
        if dup2:
            continue
        now = utcnow()
        doc = {
            "rule_id": f"aitr_{uuid.uuid4().hex[:12]}",
            "user_id": tid,
            "created_by": user["user_id"],
            "categories": [r["category"]],
            "category": r["category"],
            "title": r["title"],
            "text": r["text"],
            "text_norm": text_norm,
            "title_norm": title_norm,
            "files": [],
            "auto_generated": not pinned,
            "source": source,
            "source_user_message": (source_msg or "")[:500],
            "created_at": now,
            "updated_at": now,
        }
        await db.ai_teach_rules.insert_one(doc)
        doc.pop("_id", None)
        created.append(doc)
        logger.info("[teach-now] tenant=%s regola distillata (%s): %s", tid, source, r["title"])
    return created


async def _distill_lesson_now(user: dict, user_msg: str, reply: str) -> List[dict]:
    """Distilla immediatamente la lezione contenuta nello scambio utente→Axon."""
    try:
        if not _is_teach_intent(user_msg):
            return []
        tid = tenant_id(user)
        # Se la cattura impegni (V50.z129) ha già salvato una regola per QUESTO messaggio, evita doppioni.
        already = await db.ai_teach_rules.find_one(
            {"user_id": tid, "source": "chat_commitment", "source_user_message": (user_msg or "")[:500]}, {"_id": 0, "rule_id": 1}
        )
        if already:
            return []
        titles_docs = await db.ai_teach_rules.find({"user_id": tid}, {"_id": 0, "title": 1}).to_list(200)
        titles = [t.get("title") or "" for t in titles_docs]
        dialog = f"[USER] {(user_msg or '').strip()[:3000]}\n[AXON] {(reply or '').strip()[:2500]}"
        rules = await _llm_extract_lessons(dialog, titles, max_rules=2)
        return await _save_distilled_rules(user, rules, source="chat_teach", source_msg=user_msg)
    except Exception as exc:
        logger.warning("[teach-now] distill failed: %s", exc)
        return []


async def _post_reply_learning(user: dict, user_msg: str, reply: str) -> None:
    """Hook fire-and-forget dopo ogni risposta: 1) cattura impegni espliciti di
    Axon (V50.z129); 2) distilla la lezione insegnata dall'utente (V50.z130)."""
    n = await _auto_capture_commitment_rules(user, user_msg, reply)
    if n == 0:
        await _distill_lesson_now(user, user_msg, reply)


class AxonTeachDistillNowIn(BaseModel):
    session_id: Optional[str] = None
    max_rules: int = 5


@api_router.post("/axon/teach/distill-now")
async def axon_teach_distill_now(body: AxonTeachDistillNowIn = Body(default=AxonTeachDistillNowIn()), user=Depends(get_current_user)):
    """V50.z130 — Trigger manuale: distilla SUBITO le lezioni della sessione chat
    corrente (o dell'ultima) in regole `ai_teach_rules`, senza attendere le 04:00."""
    _require_master(user)
    sid = body.session_id
    if not sid:
        latest = await db.assistant_messages.find_one({"user_id": user["user_id"]}, {"session_id": 1}, sort=[("created_at", -1)])
        if not latest:
            return {"created": [], "count": 0, "session_id": None}
        sid = latest["session_id"]
    msgs = await db.assistant_messages.find(
        {"user_id": user["user_id"], "session_id": sid}, {"_id": 0, "role": 1, "content": 1}
    ).sort("created_at", 1).to_list(200)
    lines = []
    for m in msgs[-40:]:
        c = (m.get("content") or "").replace("\n", " ").strip()
        if c:
            lines.append(f"[{'USER' if m.get('role') == 'user' else 'AXON'}] {c[:600]}")
    if not lines:
        return {"created": [], "count": 0, "session_id": sid}
    tid = tenant_id(user)
    titles_docs = await db.ai_teach_rules.find({"user_id": tid}, {"_id": 0, "title": 1}).to_list(200)
    rules = await _llm_extract_lessons("\n".join(lines), [t.get("title") or "" for t in titles_docs], max_rules=max(1, min(int(body.max_rules or 5), 8)))
    created = await _save_distilled_rules(user, rules, source="chat_teach_manual")
    return {"created": created, "count": len(created), "session_id": sid}


# =========================================================================
# V50.z143 — "Distilla conversazione in regole" (Master)
# L'utente incolla una chat storica (o sceglie una sessione salvata): il testo
# viene passato a Claude (`_llm_extract_lessons`, JSON strutturato) e le regole
# comportamentali estratte vengono salvate come regole PINNED
# (`auto_generated=False`) in `ai_teach_rules`, dedup su titolo/testo.
# =========================================================================

class AxonDistillConversationIn(BaseModel):
    text: Optional[str] = None
    session_id: Optional[str] = None
    max_rules: int = 8


@api_router.get("/assistant/sessions")
async def assistant_sessions(limit: int = 30, user=Depends(get_current_user)):
    """V50.z143 — Elenco sessioni chat dell'utente (per scegliere una chat storica da distillare)."""
    limit = max(1, min(int(limit or 30), 100))
    pipeline = [
        {"$match": {"user_id": user["user_id"]}},
        {"$sort": {"created_at": 1}},
        {"$group": {
            "_id": "$session_id",
            "count": {"$sum": 1},
            "last_at": {"$max": "$created_at"},
            "first_at": {"$min": "$created_at"},
            "preview": {"$first": {"$cond": [{"$eq": ["$role", "user"]}, "$content", None]}},
            "any_user": {"$push": {"$cond": [{"$eq": ["$role", "user"]}, "$content", "$$REMOVE"]}},
        }},
        {"$sort": {"last_at": -1}},
        {"$limit": limit},
    ]
    out = []
    async for s in db.assistant_messages.aggregate(pipeline):
        users_msgs = s.get("any_user") or []
        preview = (s.get("preview") or (users_msgs[0] if users_msgs else "") or "").replace("\n", " ").strip()[:120]
        out.append({
            "session_id": s["_id"],
            "count": s.get("count", 0),
            "last_at": s.get("last_at"),
            "first_at": s.get("first_at"),
            "preview": preview or "(senza testo)",
        })
    return {"sessions": out}


@api_router.post("/axon/teach/distill-conversation")
async def axon_teach_distill_conversation(body: AxonDistillConversationIn, user=Depends(get_current_user)):
    """V50.z143 — Distilla una conversazione (testo incollato o sessione storica) in regole PINNED."""
    _require_master(user)
    text = (body.text or "").strip()
    sid = (body.session_id or "").strip() or None
    if not text and not sid:
        raise HTTPException(status_code=400, detail="Incolla il testo della conversazione o scegli una chat storica")
    if sid and not text:
        msgs = await db.assistant_messages.find(
            {"user_id": user["user_id"], "session_id": sid}, {"_id": 0, "role": 1, "content": 1}
        ).sort("created_at", 1).to_list(400)
        lines = []
        for m in msgs:
            c = (m.get("content") or "").replace("\n", " ").strip()
            if c:
                lines.append(f"[{'USER' if m.get('role') == 'user' else 'AXON'}] {c[:1200]}")
        text = "\n".join(lines)
        if not text:
            raise HTTPException(status_code=404, detail="Sessione vuota o non trovata")
    else:
        text = "Trascrizione di una chat storica incollata dal Master (le indicazioni del Master sono lezioni da apprendere).\n" + text
    if len(text) < 20:
        raise HTTPException(status_code=400, detail="Testo troppo breve per estrarre regole")

    max_rules = max(1, min(int(body.max_rules or 8), 12))
    tid = tenant_id(user)
    titles_docs = await db.ai_teach_rules.find({"user_id": tid}, {"_id": 0, "title": 1, "text": 1}).sort("updated_at", -1).to_list(40)
    # Titolo + inizio testo: aiuta Claude a riconoscere duplicati semantici (non solo di titolo)
    titles = [f"{(t.get('title') or '').strip()} — {(t.get('text') or '').strip()[:90]}" for t in titles_docs if t.get("title")]

    # Chunking per conversazioni lunghe (max 3 blocchi da ~11k char), dedup per titolo tra i blocchi
    CHUNK = 11000
    chunks = [text[i:i + CHUNK] for i in range(0, min(len(text), CHUNK * 3), CHUNK)] or [text]
    extracted: List[dict] = []
    seen_titles = {(t.get("title") or "").strip().lower() for t in titles_docs if t.get("title")}
    for ch in chunks:
        remaining = max_rules - len(extracted)
        if remaining <= 0:
            break
        try:
            part = await _llm_extract_lessons(ch, titles + [r["title"] for r in extracted], max_rules=remaining)
        except Exception as exc:
            logger.warning("[distill-conversation] chunk failed: %s", exc)
            part = []
        for r in part:
            k = (r.get("title") or "").strip().lower()
            if not k or k in seen_titles:
                continue
            seen_titles.add(k)
            extracted.append(r)
    created = await _save_distilled_rules(user, extracted, source="conversation_distill", pinned=True)
    return {
        "created": created,
        "count": len(created),
        "extracted": len(extracted),
        "skipped_duplicates": max(0, len(extracted) - len(created)),
        "chunks": len(chunks),
        "chars": len(text),
        "session_id": sid,
    }


@api_router.post("/assistant/chat/stream")
async def assistant_chat_stream(body: AssistantChatStreamIn, user=Depends(get_current_user)):
    """SSE streaming variant of /assistant/chat.

    Event format (each event ends with a blank line):
      event: meta         → {"session_id","assistant_name","from_cache",...}
      event: delta        → {"text":"...partial..."}
      event: done         → {"used_web_search","web_sources","from_cache"}
      event: error        → {"error":"..."}
    """
    from fastapi.responses import StreamingResponse
    import json as _json_mod

    def sse(event: str, data: dict) -> str:
        return f"event: {event}\ndata: {_json_mod.dumps(data, ensure_ascii=False, default=str)}\n\n"

    async def event_stream():
        # V50.z142 — ACK immediato: primo evento emesso PRIMA di qualsiasi await
        # (intercept slash/quick-action/sveglie, preflight, LLM). L'utente vede
        # "Sto ragionando…" entro <1s indipendentemente dal modello usato.
        yield sse("progress", {"stage": "ack", "text": "Ci sto pensando…"})

        # V50.z126 — Azione rapida in streaming: arricchisci il prompt come
        # faceva POST /axon/quick-action (che era bloccante e superava il
        # timeout dell'ingress senza mostrare nulla all'utente).
        _qa_label = (body.quick_label or "").strip()[:120]
        if _qa_label:
            # V50.z245 — Azioni rapide deterministiche (calcolatore PUN): stessa risposta di POST /axon/quick-action,
            # anche quando il client passa allo streaming (cache_only miss / errore rete). Zero LLM, output identico.
            try:
                _det = await _qa_deterministic(_qa_label, body.message or "", user)
            except Exception:  # noqa: BLE001
                _det = None
            if _det and _det.get("reply"):
                _sid = body.session_id or f"asst_{user['user_id']}_{uuid.uuid4().hex[:10]}"
                _mid = uuid.uuid4().hex[:16]
                try:
                    await db.assistant_messages.insert_many([
                        {"user_id": user["user_id"], "session_id": _sid, "role": "user", "content": body.message or "", "created_at": utcnow()},
                        {"message_id": _mid, "user_id": user["user_id"], "session_id": _sid, "role": "assistant", "content": _det["reply"], "created_at": utcnow()},
                    ])
                except Exception:
                    pass
                yield sse("meta", {"session_id": _sid, "message_id": _mid, "from_cache": True, "slash": "pun_table"})
                yield sse("delta", {"text": _det["reply"]})
                yield sse("done", {"session_id": _sid, "message_id": _mid, "used_web_search": False, "web_sources": [], "from_cache": True, "slash": "pun_table", "qa_updated_at": _det.get("updated_at")})
                return
            body.message = _qa_enrich_prompt(body.message or "")

        # V50.m — Slash commands intercept: /aiuto, /bolletta, /scadenze,
        # /pun, /team → risposta istantanea senza chiamare la LLM (o con
        # prompt riscritto se `rebuild_msg`).
        _slash_result = await _maybe_slash_command(body.message or "", user)
        if _slash_result and _slash_result.get("reply") is not None:
            _sid = body.session_id or f"asst_{user['user_id']}_{uuid.uuid4().hex[:10]}"
            yield sse("meta", {"session_id": _sid, "from_cache": False, "slash": _slash_result.get("cmd")})
            yield sse("delta", {"text": _slash_result["reply"]})
            yield sse("done", {"session_id": _sid, "used_web_search": False, "web_sources": [], "from_cache": False, "slash": _slash_result.get("cmd")})
            return
        if _slash_result and _slash_result.get("rebuild_msg"):
            body.message = _slash_result["rebuild_msg"]

        # V50.z31 — Quick-action intercept (natural language, senza `/`):
        # "Qual è il mio prossimo appuntamento?" → risposta dal DB in <1s,
        # nessun preflight LLM. Bug: la quick action prima passava per la LLM
        # con 20s di attesa e Tavily/GME canonical fetch inutili.
        _qa_result = await _maybe_quick_action_intercept(body.message or "", user)
        if _qa_result and _qa_result.get("reply") is not None:
            _sid = body.session_id or f"asst_{user['user_id']}_{uuid.uuid4().hex[:10]}"
            _mid = uuid.uuid4().hex[:16]
            # Persist both messages so history and feedback still work
            try:
                await db.assistant_messages.insert_many([
                    {"user_id": user["user_id"], "session_id": _sid, "role": "user",
                     "content": body.message or "", "created_at": utcnow()},
                    {"message_id": _mid, "user_id": user["user_id"], "session_id": _sid,
                     "role": "assistant", "content": _qa_result["reply"], "created_at": utcnow()},
                ])
            except Exception:
                pass
            yield sse("meta", {"session_id": _sid, "message_id": _mid, "from_cache": False, "slash": _qa_result.get("cmd")})
            yield sse("delta", {"text": _qa_result["reply"]})
            yield sse("done", {"session_id": _sid, "message_id": _mid, "used_web_search": False,
                               "web_sources": [], "from_cache": False, "slash": _qa_result.get("cmd")})
            return

        # V50.z184 — Comandi notifiche push ("mandami una notifica: …", "avvisami se ho
        # ritelefonate urgenti", "notifica di prova") → axon_chat_push.py. PRIMA del comando
        # sveglie perché "avvisami" è anche un intent promemoria.
        user["_client_ctx"] = getattr(body, "client_context", None)  # V50.z291 — posizione utente disponibile agli intercettori
        _al_result = await _maybe_push_command(body.message or "", user)
        # V50.z125 — Comandi timer/sveglia/promemoria ("imposta timer 15 minuti",
        # "ricordami di chiamare Mario stasera"): crea la sveglia e conferma.
        if not _al_result:
            _al_result = await _maybe_alarm_command(body.message or "", user)
        if _al_result and _al_result.get("reply") is not None:
            _sid = body.session_id or f"asst_{user['user_id']}_{uuid.uuid4().hex[:10]}"
            _mid = uuid.uuid4().hex[:16]
            try:
                await db.assistant_messages.insert_many([
                    {"user_id": user["user_id"], "session_id": _sid, "role": "user",
                     "content": body.message or "", "created_at": utcnow()},
                    {"message_id": _mid, "user_id": user["user_id"], "session_id": _sid,
                     "role": "assistant", "content": _al_result["reply"], "created_at": utcnow()},
                ])
            except Exception:
                pass
            yield sse("meta", {"session_id": _sid, "message_id": _mid, "from_cache": False, "slash": _al_result.get("cmd")})
            yield sse("delta", {"text": _al_result["reply"]})
            yield sse("done", {"session_id": _sid, "message_id": _mid, "used_web_search": False,
                               "web_sources": [], "from_cache": False, "slash": _al_result.get("cmd"),
                               "alarm": _al_result.get("alarm")})
            return

        # V50.k — Progress event: preflight iniziato (l'utente vede subito
        # "Sto raccogliendo il contesto…" invece di attendere silenziosamente).
        yield sse("progress", {"stage": "preflight", "text": "Sto raccogliendo il contesto…"})

        # V50.z53 — ROLLBACK EMERGENCY: streaming ACK con citazione regole
        # DISATTIVATO (il modello lo interpretava come la risposta finale e
        # rispondeva solo con scuse). Ripristinato comportamento V50.z50.

        # --- Preflight: build prompt (raises HTTPException on error) ---
        # V50.z126 — Il preflight (RAG, Tavily, KB…) può durare decine di
        # secondi: lo eseguiamo come task e nel frattempo emettiamo heartbeat
        # `progress` ogni 6s, così il proxy non chiude la connessione per
        # inattività e l'utente vede che Axon sta lavorando.
        _prep_task = asyncio.create_task(_prepare_assistant_prompt(user, body))
        _prep_started = asyncio.get_event_loop().time()
        _hb_msgs = ["Sto verificando…", "Sto raccogliendo dati aggiornati…", "Ancora un momento, sto preparando la risposta…"]
        _hb_i = 0
        while True:
            try:
                prep = await asyncio.wait_for(asyncio.shield(_prep_task), timeout=6.0)
                break
            except asyncio.TimeoutError:
                yield sse("progress", {"stage": "preflight", "text": _hb_msgs[_hb_i % len(_hb_msgs)], "elapsed": round(asyncio.get_event_loop().time() - _prep_started)})
                _hb_i += 1
                continue
            except HTTPException as he:
                yield sse("error", {"error": he.detail, "status": he.status_code})
                return
            except Exception as e:
                yield sse("error", {"error": f"prep failed: {e}"})
                return

        msg = prep["msg"]
        if os.environ.get("AXON_PROMPT_DUMP"):  # V50.z421 — dump del prompt FINALE (dopo tutti i wrapper) per l'analisi dei costi (solo dev)
            try:
                with open(os.environ["AXON_PROMPT_DUMP"] + ".final", "w", encoding="utf-8") as _fh:
                    _fh.write(prep.get("system_message") or "")
            except Exception:  # noqa: BLE001
                pass
        session_id = prep["session_id"]
        assistant_name = prep["assistant_name"]
        used_web_search = prep["used_web_search"]
        web_sources = prep["web_sources"]
        has_attachments = prep["has_attachments"]
        has_history = prep["history_len"] > 0
        _tenant_val = tenant_id(user)

        # --- Cache lookup (fast path) ---
        cache_eligible = _is_query_cacheable(msg, has_attachments, has_history) and not getattr(body, "no_cache", False)  # V50.z260
        if cache_eligible:
            yield sse("progress", {"stage": "cache", "text": "Controllo se ho già risposto a qualcosa di simile…"})
            cached = await _semantic_cache_lookup(msg, tenant=_tenant_val, product=_axon_cache_product(user))  # noqa: F821 — V50.z327
            if cached:
                # Persist both messages
                now = utcnow()
                cached_message_id = uuid.uuid4().hex[:16]
                await db.assistant_messages.insert_many([
                    {"user_id": user["user_id"], "session_id": session_id, "role": "user", "content": msg, "created_at": now},
                    {
                        "message_id": cached_message_id,
                        "user_id": user["user_id"], "session_id": session_id,
                        "role": "assistant", "content": cached["reply"], "created_at": utcnow(),
                    },
                ])
                # Emit meta + one big delta + done (client can render instantly)
                yield sse("meta", {
                    "session_id": session_id,
                    "message_id": cached_message_id,
                    "assistant_name": assistant_name,
                    "from_cache": True,
                    "cache_similarity": cached.get("_similarity", 1.0),
                })
                # Chunk the cached reply so the UI still feels alive (~40 char/chunk)
                reply = cached["reply"]
                chunk_size = 60
                for i in range(0, len(reply), chunk_size):
                    yield sse("delta", {"text": reply[i:i+chunk_size]})
                    # tiny yield to let the loop breathe
                    await asyncio.sleep(0)
                yield sse("done", {
                    "message_id": cached_message_id,
                    "used_web_search": bool(cached.get("used_web_search")),
                    "web_sources": cached.get("web_sources") or [],
                    "from_cache": True,
                    "session_id": session_id,
                })
                return

        # --- LLM streaming path ---
        assistant_message_id = uuid.uuid4().hex[:16]
        # V41 — Insert placeholder rows NOW (before streaming) so feedback POSTs
        # from the client can find the message even if it disconnects mid-stream.
        # We'll $set the final `content` at done. On disconnect the row stays with
        # whatever partial content was streamed (persist step below still fires
        # unless the coroutine is force-killed).
        _stream_now = utcnow()
        try:
            await db.assistant_messages.insert_many([
                {"user_id": user["user_id"], "session_id": session_id, "role": "user", "content": msg, "created_at": _stream_now},
                {
                    "message_id": assistant_message_id,
                    "user_id": user["user_id"], "session_id": session_id,
                    "role": "assistant", "content": "", "created_at": _stream_now,
                },
            ])
            _stream_persisted = True
        except Exception as exc:
            logger.warning("[assistant-stream] placeholder persist failed: %s", exc)
            _stream_persisted = False

        yield sse("meta", {
            "session_id": session_id,
            "message_id": assistant_message_id,
            "assistant_name": assistant_name,
            "from_cache": False,
        })

        try:
            from emergentintegrations.llm.chat import LlmChat, UserMessage, TextDelta, StreamDone
        except Exception as e:
            yield sse("error", {"error": f"llm import failed: {e}"})
            return

        # V50.k — Router modello Haiku/Sonnet basato su euristica veloce.
        # Query semplici (chit-chat, saluti, domande brevi senza analisi)
        # → Haiku 4.5 (1-2s first token). Query analitiche/tabelle/allegati
        # → Sonnet 4.5 (6-8s). Invisibile all'utente ma dimezza il tempo medio.
        _model_choice = _pick_axon_model(
            msg=msg,
            has_attachments=has_attachments,
            has_rag_context=bool(prep.get("has_rag_context")),
            has_web=used_web_search,
        )
        if prep.get("query_class") == "simple":  # V50.z413 — domande semplici → sempre Haiku 4.5
            _model_choice = "haiku"
        _model_id = "claude-haiku-4-5" if _model_choice == "haiku" else "claude-sonnet-4-5"

        yield sse("progress", {
            "stage": "thinking",
            "text": "Sto ragionando…" if _model_choice == "haiku" else "Sto analizzando in profondità…",
            "model": _model_choice,
        })

        chat = LlmChat(
            api_key=prep["api_key"],
            session_id=session_id,
            system_message=prep["system_message"],
        ).with_model("anthropic", _model_id)

        collected: List[str] = []
        try:
            async for ev in chat.stream_message(UserMessage(text=prep["user_prompt"])):
                if isinstance(ev, TextDelta):
                    if ev.content:
                        collected.append(ev.content)
                        yield sse("delta", {"text": ev.content})
                elif isinstance(ev, StreamDone):
                    # end handled below
                    break
        except Exception as e:
            yield sse("error", {"error": f"Errore LLM: {e}"})
            return

        reply_text = ("".join(collected)).strip() or "Non ho ricevuto una risposta. Riprova."

        # Update the assistant placeholder with the full reply.
        # (User message was already persisted at meta time.)
        try:
            if _stream_persisted:
                await db.assistant_messages.update_one(
                    {"message_id": assistant_message_id, "user_id": user["user_id"]},
                    {"$set": {"content": reply_text, "created_at": utcnow()}},
                )
            else:
                # Placeholder failed earlier — insert both now as fallback.
                await db.assistant_messages.insert_many([
                    {"user_id": user["user_id"], "session_id": session_id, "role": "user", "content": msg, "created_at": _stream_now},
                    {
                        "message_id": assistant_message_id,
                        "user_id": user["user_id"], "session_id": session_id,
                        "role": "assistant", "content": reply_text, "created_at": utcnow(),
                    },
                ])
        except Exception as exc:
            logger.warning("[assistant-stream] finalize persist failed: %s", exc)

        # Fire-and-forget memory distillation
        try:
            asyncio.create_task(_maybe_save_memory(user["user_id"], session_id, assistant_name))
        except Exception:
            pass

        # V50.z129/z130 — Apprendimento immediato: impegni di Axon + lezioni dell'utente → ai_teach_rules
        try:
            asyncio.create_task(_post_reply_learning(user, msg, reply_text))
        except Exception:
            pass

        # Save to semantic cache if eligible (V50.k: with tenant_id for team-shared cache)
        if cache_eligible:
            try:
                asyncio.create_task(_semantic_cache_save(
                    msg=msg,
                    reply=reply_text,
                    used_web_search=used_web_search,
                    web_sources=web_sources,
                    assistant_name=assistant_name,
                    tenant=_tenant_val,
                    product=_axon_cache_product(user),  # noqa: F821 — V50.z327
                ))
            except Exception:
                pass

        # V50.z126 — Persisti la risposta dell'azione rapida nella cache QA
        _qa_updated_at: Optional[str] = None
        if _qa_label and reply_text:
            try:
                _qa_now = utcnow()
                await db.axon_qa_cache.update_one(
                    {"user_id": user["user_id"], "label": _qa_label},
                    {"$set": {"user_id": user["user_id"], "label": _qa_label, "reply": reply_text,
                              "updated_at": _qa_now, "web_sources": web_sources or [],
                              "used_web_search": bool(used_web_search)}},
                    upsert=True,
                )
                _qa_updated_at = _qa_now.isoformat()
            except Exception as exc:
                logger.warning("[assistant-stream] qa cache persist failed: %s", exc)

        yield sse("done", {
            "message_id": assistant_message_id,
            "used_web_search": used_web_search,
            "web_sources": web_sources,
            "from_cache": False,
            "session_id": session_id,
            "model": _model_choice,
            "qa_updated_at": _qa_updated_at,
        })

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",  # disable proxy buffering
            "Connection": "keep-alive",
        },
    )


# =========================================================================
