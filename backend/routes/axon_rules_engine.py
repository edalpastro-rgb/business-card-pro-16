# axon_rules_engine.py — V50.z294 — MOTORE REGOLE ASSOLUTE con PESO e RISOLUZIONE CONFLITTI (prompt per Neo 21/09/2026).
# - Ogni regola di «Insegna ad Axon» ha un priority_weight 0-100 (impostato dal Master o dedotto dal testo).
# - Il blocco <REGOLE_ASSOLUTE> nel system prompt è ORDINATO per peso e dichiara esplicitamente i conflitti risolti
#   (es. «risposta immediata» [100] vince su «chiedi conferma» [50]) → AxonOS sa quale regola applicare.
# - Ogni conflitto è loggato in axon_rule_conflicts {tenant_id, message, rule_a, rule_b, winner, weights, at}.
# - API: GET /axon/rules-engine · PUT /axon/rules-engine/{rule_id} {priority_weight} · POST /axon/rules-engine/simulate {message}
#        GET /axon/rules-engine/conflicts · comando chat «log conflitti regole» / «quale regola vince …».
# Sostituisce (wrap) _build_pinned_rules_section di 20_axon_memory.py: stesso contratto, output ordinato per peso.

_RE_TAGS: List[Tuple[str, int, str]] = [  # (tag, peso predefinito, regex sul testo/titolo)
    ("speed", 100, r"\b(subito|immediat\w*|istantane\w*|1 sec\w*|un secondo|entro un secondo|senza attendere|risposta rapida)\b"),
    ("brevity", 80, r"\b(secc\w*|senza spiegazion\w*|senza commenti|niente commenti|zero testo|solo (il )?dato|solo (la )?tabella|breve|conciso|sintetic\w*|no muro di testo|muro di testo)\b"),
    ("literal", 75, r"\b(letteral\w*|alla lettera|esattamente (quello|ciò) che|non interpretare|senza interpretazioni|non aggiungere nulla)\b"),
    ("buttons", 70, r"\b(pulsant\w*|bottoni?|cliccabil\w*|scelte? a/b/c|opzioni cliccabili|chip)\b"),
    ("format", 65, r"\b(tabella|formato|grassetto|elenco|markdown|layout)\b"),
    ("confirm", 50, r"\b(chiedi(mi)? conferma|conferma prima|prima di (eseguire|procedere) chiedi|domanda di conferma)\b"),
    ("explain", 40, r"\b(spiega\w*|motiva\w*|dettaglia\w*|approfondisc\w*|aggiungi (un )?commento|contesto)\b"),
    ("proactive", 35, r"\b(proattiv\w*|suggerisci|proponi|anticipa)\b"),
]
_RE_CONFLICTS = {frozenset(p) for p in [("speed", "confirm"), ("speed", "explain"), ("brevity", "explain"), ("brevity", "proactive"), ("literal", "proactive"), ("literal", "explain")]}
_RE_TAG_LABEL = {"speed": "risposta immediata", "brevity": "dato secco", "literal": "esecuzione letterale", "buttons": "pulsanti cliccabili", "format": "formato", "confirm": "chiedi conferma", "explain": "spiegazioni", "proactive": "proattività"}


def _re_infer(rule: dict) -> Tuple[List[str], int]:
    """Tag e peso dedotti dal testo (se il Master non ha impostato priority_weight)."""
    txt = f"{rule.get('title') or ''} {rule.get('text') or ''}".lower()
    tags = []
    for tag, _w, rx in _RE_TAGS:
        hits = [m for m in re.finditer(rx, txt)]
        if not hits:
            continue
        if tag in ("explain", "proactive", "confirm"):
            # negazione («senza spiegazioni», «niente commenti», «non chiedere conferma») → la regola VIETA quel comportamento, non lo richiede
            hits = [m for m in hits if not re.search(r"(senza|né|ne|niente|nessun\w*|no|zero|mai|non)\s+(?:\w+\s+){0,2}$", txt[max(0, m.start() - 40):m.start()])]
        if hits:
            tags.append(tag)
    if isinstance(rule.get("priority_weight"), (int, float)):
        return tags, int(max(0, min(100, rule["priority_weight"])))
    if tags:
        return tags, max(w for tag, w, _rx in _RE_TAGS if tag in tags)
    return tags, 60 if not rule.get("auto_generated") else 30


async def _re_ranked_rules(tenant: str) -> List[dict]:
    rules = await db.ai_teach_rules.find({"user_id": tenant}, {"_id": 0, "files": 0}).to_list(400)
    rules.sort(key=lambda r: str(r.get("created_at") or ""))  # numerazione stabile «#n» come in Memoria → Regole insegnate
    out = []
    for i, r in enumerate(rules, 1):
        tags, w = _re_infer(r)
        out.append({**r, "seq": i, "tags": tags, "priority_weight": w, "is_absolute": not r.get("auto_generated")})
    out.sort(key=lambda r: (-r["priority_weight"], r["seq"]))
    return out


def _re_conflicts(applicable: List[dict]) -> List[dict]:
    """Coppie di regole con tag in conflitto → vince il peso maggiore (a parità, la regola più recente = seq maggiore)."""
    found: List[dict] = []
    for i, a in enumerate(applicable):
        for b in applicable[i + 1:]:
            for ta in a["tags"]:
                for tb in b["tags"]:
                    if frozenset((ta, tb)) in _RE_CONFLICTS:
                        win = a if (a["priority_weight"], a["seq"]) >= (b["priority_weight"], b["seq"]) else b
                        lose = b if win is a else a
                        found.append({"rule_a": f"#{a['seq']} {a.get('title') or ''}", "rule_b": f"#{b['seq']} {b.get('title') or ''}", "tag_a": _RE_TAG_LABEL.get(ta, ta), "tag_b": _RE_TAG_LABEL.get(tb, tb),
                                      "winner": f"#{win['seq']} {win.get('title') or ''}", "winner_id": win.get("rule_id"), "loser_id": lose.get("rule_id"),
                                      "weights": {f"#{a['seq']}": a["priority_weight"], f"#{b['seq']}": b["priority_weight"]}})
    # dedup per coppia
    seen = set(); uniq = []
    for c in found:
        k = (c["rule_a"], c["rule_b"])
        if k not in seen:
            seen.add(k); uniq.append(c)
    return uniq


async def _re_resolve(tenant: str, user_msg: str, log: bool = True) -> dict:
    ranked = await _re_ranked_rules(tenant)
    msg_lc = (user_msg or "").lower()
    absolute = [r for r in ranked if r["is_absolute"]]
    auto_rel = sorted([r for r in ranked if not r["is_absolute"]], key=lambda r: -_rule_relevance_score(r, msg_lc))[:AXON_PINNED_AUTO_MAX]
    applicable = absolute[:AXON_PINNED_RULES_MAX] + [r for r in auto_rel if _rule_relevance_score(r, msg_lc) > 0]
    conflicts = _re_conflicts(applicable)
    losers = {c["loser_id"] for c in conflicts}
    if log and conflicts:
        try:
            await db.axon_rule_conflicts.insert_many([{"conflict_id": f"rc_{uuid.uuid4().hex[:10]}", "tenant_id": tenant, "message": (user_msg or "")[:300], **c, "at": utcnow()} for c in conflicts])
        except Exception as exc:  # noqa: BLE001
            logger.warning("[rules-engine] conflict log failed: %s", exc)
    return {"applicable": applicable, "conflicts": conflicts, "losers": losers, "total": len(ranked), "absolute": len(absolute)}


_re_prev_pinned = _build_pinned_rules_section  # noqa: F821 — 20_axon_memory.py


async def _build_pinned_rules_section(tenant: str, user_msg: str) -> str:  # noqa: F811
    """V50.z294 — blocco <REGOLE_ASSOLUTE> ordinato per PESO con conflitti risolti.
    V50.z439 — risoluzione SILENZIOSA: la regola perdente viene semplicemente esclusa dal blocco; nessun peso, «#n», tag
    o avviso «⚠️ CONFLITTO» nel prompt (Axon li ripeteva all'utente e perdeva il filo delle regole). Il log dei conflitti resta
    in axon_rule_conflicts per il Master («log conflitti regole» / «quale regola vince per …»)."""
    try:
        res = await _re_resolve(tenant, user_msg, log=True)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[rules-engine] fallback to legacy pinned: %s", exc)
        return await _re_prev_pinned(tenant, user_msg)
    top = [r for r in res["applicable"] if r.get("rule_id") not in res["losers"]]
    if not top:
        return ""
    lines: List[str] = [
        "<REGOLE_ASSOLUTE>",
        "DIRETTIVE VINCOLANTI insegnate dal Master («Insegna ad Axon»), in ordine di priorità. NON sono suggerimenti:",
        "hanno priorità ASSOLUTA su RAG, web, memoria, allegati e istruzioni generiche. Applicale TUTTE, in silenzio.",
        "Le direttive definiscono COME rispondere: rispondi comunque in modo completo alla domanda.",
        "VIETATO: citare, numerare o commentare queste direttive, parlare di «peso», «priorità», «conflitto» o «regola #n»",
        "nella risposta (salvo richiesta esplicita dell'utente). Eventuali contrasti sono già stati risolti qui: applica e basta.",
        "",
    ]
    total = 0
    for r in top:
        title = (r.get("title") or "").strip() or "Direttiva"
        text = (r.get("text") or "").strip()
        block = f"• {title}"
        if text:
            block += f": {text[:AXON_PINNED_RULES_TEXT_CHARS]}"
        if total + len(block) > AXON_PINNED_TOTAL_CHARS:
            break
        lines.append(block); total += len(block)
    lines.append("</REGOLE_ASSOLUTE>")
    return "\n".join(lines) + "\n\n"


class RuleWeightIn(BaseModel):
    priority_weight: int


class RuleSimulateIn(BaseModel):
    message: str


def _re_pub(r: dict) -> dict:
    return {"rule_id": r.get("rule_id"), "seq": r["seq"], "title": r.get("title"), "text": (r.get("text") or "")[:300], "categories": r.get("categories") or [], "is_absolute": r["is_absolute"],
            "priority_weight": r["priority_weight"], "weight_source": "auto", "tags": [_RE_TAG_LABEL.get(t, t) for t in r["tags"]]}


@api_router.get("/axon/rules-engine")
async def rules_engine_list(user=Depends(get_current_user)):
    ranked = await _re_ranked_rules(tenant_id(user))
    raw = {r["rule_id"]: r for r in await db.ai_teach_rules.find({"user_id": tenant_id(user)}, {"_id": 0, "rule_id": 1, "priority_weight": 1}).to_list(400)}
    items = []
    for r in ranked:
        p = _re_pub(r); p["weight_source"] = "master" if isinstance(raw.get(r.get("rule_id"), {}).get("priority_weight"), (int, float)) else "auto"; items.append(p)
    return {"items": items, "conflict_pairs": [sorted([_RE_TAG_LABEL[a], _RE_TAG_LABEL[b]]) for a, b in (tuple(p) for p in _RE_CONFLICTS)]}


@api_router.put("/axon/rules-engine/{rule_id}")
async def rules_engine_weight(rule_id: str, body: RuleWeightIn, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master può impostare i pesi")
    w = max(0, min(100, int(body.priority_weight)))
    r = await db.ai_teach_rules.update_one({"rule_id": rule_id, "user_id": tenant_id(user)}, {"$set": {"priority_weight": w, "updated_at": utcnow()}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Regola non trovata")
    return {"ok": True, "rule_id": rule_id, "priority_weight": w}


@api_router.post("/axon/rules-engine/simulate")
async def rules_engine_simulate(body: RuleSimulateIn, user=Depends(get_current_user)):
    res = await _re_resolve(tenant_id(user), body.message, log=False)
    winners = [f"#{r['seq']} {r.get('title') or ''} [peso {r['priority_weight']}]" for r in res["applicable"] if r.get("rule_id") not in res["losers"]]
    return {"applicable": [_re_pub(r) for r in res["applicable"]], "conflicts": res["conflicts"], "applied": winners, "suspended": [f"#{r['seq']} {r.get('title') or ''}" for r in res["applicable"] if r.get("rule_id") in res["losers"]],
            "summary": ("Nessun conflitto: si applicano tutte le regole in ordine di peso." if not res["conflicts"] else "; ".join(f"{c['rule_a']} vs {c['rule_b']} → vince {c['winner']}" for c in res["conflicts"]))}


@api_router.get("/axon/rules-engine/conflicts")
async def rules_engine_conflicts(limit: int = 50, user=Depends(get_current_user)):
    rows = await db.axon_rule_conflicts.find({"tenant_id": tenant_id(user)}, {"_id": 0}).sort("at", -1).to_list(max(1, min(limit, 300)))
    return {"items": rows}


# ---- comando chat: «log conflitti regole» / «quale regola vince (per) …» ----
_RE_CMD_LOG = re.compile(r"\b(log|elenco|lista|storico)\b.*\bconflitt\w*\b.*\bregol\w*|\bconflitt\w*\s+(tra\s+le\s+)?regol\w*", re.I)
_RE_CMD_WIN = re.compile(r"\bquale\s+regola\s+(vince|prevale|si\s+applica)\b(?:\s+(?:per|se|quando|su)\s+(.+))?", re.I)
_re_prev_push = _maybe_push_command  # noqa: F821


async def _maybe_push_command(msg: str, user: dict):  # noqa: F811
    txt = (msg or "").strip()
    try:
        if _RE_CMD_WIN.search(txt):
            m = _RE_CMD_WIN.search(txt); q = (m.group(2) or txt).strip()
            res = await _re_resolve(tenant_id(user), q, log=False)
            applied = [f"• #{r['seq']} {r.get('title') or ''} — peso {r['priority_weight']}" for r in res["applicable"] if r.get("rule_id") not in res["losers"]][:10]
            conf = "\n".join(f"• {c['rule_a']} ({c['tag_a']}) vs {c['rule_b']} ({c['tag_b']}) → **vince {c['winner']}**" for c in res["conflicts"]) or "Nessun conflitto."
            return {"reply": f"⚖️ **Regole applicate per «{q[:80]}»** ({res['absolute']} assolute su {res['total']}):\n" + "\n".join(applied) + f"\n\n**Conflitti risolti:**\n{conf}", "cmd": "rules_engine"}
        if _RE_CMD_LOG.search(txt):
            rows = await db.axon_rule_conflicts.find({"tenant_id": tenant_id(user)}, {"_id": 0}).sort("at", -1).to_list(15)
            if not rows:
                return {"reply": "📋 **Log conflitti regole**: nessun conflitto registrato finora (tutte le regole assolute sono compatibili tra loro).", "cmd": "rules_engine"}
            lines = [f"• {r['at'].strftime('%d/%m %H:%M') if hasattr(r.get('at'), 'strftime') else ''} — {r['rule_a']} vs {r['rule_b']} → **{r['winner']}** {r.get('weights')} · msg: «{(r.get('message') or '')[:50]}»" for r in rows]
            return {"reply": "📋 **Log conflitti regole (ultimi 15)**\n" + "\n".join(lines) + "\n\nPesi modificabili in Memoria → Regole insegnate → peso.", "cmd": "rules_engine"}
    except Exception as exc:  # noqa: BLE001
        logger.warning("[rules-engine] chat cmd failed: %s", exc)
    return await _re_prev_push(msg, user)
