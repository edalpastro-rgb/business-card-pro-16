# landing_cms.py — V50.z530 — Landing pubblica «Axon Core» + CMS admin
#
# • GET /public/landing (NESSUN login): contenuti (default + override salvati dal CMS) e contatori «posti Founder rimasti»
#   calcolati in tempo reale: limite − account registrati con quel piano (users.plan: builder | professional; gli account
#   senza piano contano come professional — decisione cliente).
# • CMS: singleton Mongo `landing_content` (_id="global"), stesso pattern del libretto. Protezione DOPPIA: Super Admin
#   (36_admin_clients.require_super_admin) + password dedicata LANDING_CMS_PASSWORD (.env) nell'header X-CMS-Password.
#   GET /landing/cms/content · PUT /landing/cms/content · POST /landing/cms/reset · POST /landing/cms/unlock (verifica password).
import asyncio
import copy
import hashlib
import hmac
import os
import re
import uuid
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from fastapi import Depends, Header, HTTPException
from pydantic import BaseModel, Field

LANDING_DEFAULTS: Dict[str, Any] = {
    "hero": {
        "badge": "🚀 Offerta Lancio: Diventa un Fondatore (Prezzo bloccato per sempre)",
        "title": "L'Intelligenza Artificiale che lavora per te. E custodisce la tua vita.",
        "subtitle": "Scopri l'ecosistema modulare protetto dal GDPR europeo. Fai decollare la tua produttività con il CRM AdvisorOS o custodisci i tuoi ricordi per sempre nel caveau privato di AxonOS. Senza che un solo dato venga mai regalato ai cloud americani.",
        "cta_primary": "Attiva AxonLite (Promo Founder)",
        "cta_secondary": "Scopri AdvisorOS per Professionisti",
        # V50.z545 — fascia numeri sotto le CTA (modificabile dal CMS)
        "stats": [
            {"n": "186", "label": "funzioni integrate tra AdvisorOS e AxonOS", "accent": True},
            {"n": "2", "label": "mondi, un solo cervello italiano", "accent": False},
            {"n": "100%", "label": "dati su server in Italia · GDPR", "accent": False},
        ],
    },
    "worlds": {
        "title": "I due mondi",
        "left_kicker": "AdvisorOS",
        "left_title": "Produttività Aziendale senza Limiti",
        "left_text": "Il CRM intelligente progettato per azzerare i tempi morti. Scannerizza documenti fiscali, compila automaticamente il tuo calendario e riassumi le note dei clienti in tempo reale. Un'AI integrata e potenziata sui nostri server privati, libera dai limiti soffocanti dei software tradizionali.",
        "right_kicker": "AxonOS · AxonLite",
        "right_title": "Il Custode della tua Storia e del tuo Studio",
        "right_text": "Un assistente vocale ambientale con microfono sempre aperto e ascolto locale protetto, pensato per conoscerti intimamente giorno dopo giorno. Carica i tuoi libri di testo, i tuoi appunti privati o le tue riflessioni quotidiane in un'area totalmente blindata e isolata dal mondo, creando la tua vera memoria ereditaria digitale.",
    },
    "manifesto": {
        "title": "La tua mente e il tuo lavoro non sono in vendita.",
        "pillars": [
            {"icon": "shield-checkmark", "title": "Privacy Sovrana", "text": "Tutto viene elaborato e protetto su infrastrutture dedicate in Italia (Server Aruba). Nessun dato fa addestramento."},
            {"icon": "wallet", "title": "Zero Costi Nascosti", "text": "Grazie al motore vettoriale proprietario inserito nel Core, carichi e interroghi libri e file fino a 20MB senza spendere patrimoni in token."},
            {"icon": "infinite", "title": "La Memoria ti Segue", "text": "Se chiudi la tua attività lavorativa, l'intelligenza di Core scollega il CRM ma non ti abbandona: tutti i tuoi dati e i tuoi ricordi migrano istantaneamente nella tua app privata AxonOS."},
        ],
    },
    "plans": {
        "title": "Piani Founder",
        "subtitle": "Prezzo bloccato per sempre per i primi 100 di ogni piano.",
        "builder": {
            "badge": "LIMITED FOUNDERS EDITION",
            "name": "Piano Builder Founder",
            "price_old": 25, "price": 19, "limit": 100,
            "features": ["Assistente vocale ambientale", "Area Vita Privata su server italiano", "20MB Knowledge Base (5.000 frammenti vettoriali locali)"],
            "cta": "Blocca il prezzo a 19€",
        },
        "professional": {
            "badge": "PROFESSIONAL FOUNDER",
            "name": "Piano Professional Founder",
            "price_old": 49, "price": 30, "limit": 100,
            "features": ["Tutto il piano Personal incluso", "Ecosistema CRM completo", "Automazione calendario", "Note clienti intelligenti", "Scanner documenti aziendali"],
            "cta": "Blocca il prezzo a 30€",
        },
        "seats_label": "posti rimasti su {limit}",
        "sold_out_label": "Posti Founder esauriti",
    },
    "footer": {"text": "Axon Core · AdvisorOS · AxonOS — Infrastruttura dedicata in Italia, GDPR europeo."},
}


def _landing_merge(base: Any, over: Any) -> Any:
    if isinstance(base, dict) and isinstance(over, dict):
        out = dict(base)
        for k, v in over.items():
            out[k] = _landing_merge(base.get(k), v) if k in base else v
        return out
    return over if over is not None else base


async def _landing_content() -> Dict[str, Any]:
    doc = await db.landing_content.find_one({"_id": "global"}, {"_id": 0, "content": 1, "updated_at": 1, "updated_by": 1})  # noqa: F821
    content = _landing_merge(copy.deepcopy(LANDING_DEFAULTS), (doc or {}).get("content") or {})
    return {"content": content, "is_default": not doc, "updated_at": (doc or {}).get("updated_at"), "updated_by": (doc or {}).get("updated_by")}


async def _landing_seats(content: Dict[str, Any]) -> Dict[str, Dict[str, int]]:
    base_q = {"role": "owner", "parent_user_id": {"$in": [None, ""]}}
    builder = await db.users.count_documents({**base_q, "plan": "builder"})  # noqa: F821
    professional = await db.users.count_documents({**base_q, "plan": {"$ne": "builder"}})  # noqa: F821 — senza piano = professional
    out = {}
    for key, taken in (("builder", builder), ("professional", professional)):
        limit = int((content.get("plans", {}).get(key, {}) or {}).get("limit") or 100)
        out[key] = {"limit": limit, "taken": taken, "left": max(0, limit - taken)}
    return out


@api_router.get("/public/landing")  # noqa: F821
async def public_landing():
    data = await _landing_content()
    return {"content": data["content"], "seats": await _landing_seats(data["content"]), "updated_at": data["updated_at"].isoformat() if data.get("updated_at") else None}


# ───────────────────────────── CMS (Super Admin + password dedicata) ─────────────────────────────
def _cms_password_ok(pw: Optional[str]) -> bool:
    expected = (os.environ.get("LANDING_CMS_PASSWORD") or "").strip()
    return bool(expected) and bool(pw) and hmac.compare_digest(expected, (pw or "").strip())


def _cms_can_admin(user: dict) -> bool:
    """V50.z531 — Amministratore del CMS: Super Admin (flag/ADVISOR_SUPER_ADMIN_EMAILS) OPPURE Master radice del workspace
    (role owner senza parent) OPPURE email in SUPER_MASTER_EMAILS — stessa logica del libretto (V50.z290: in produzione il flag
    super_admin non coincideva con l'account del Master e il pannello restava bloccato). La password CMS resta il 2° fattore."""
    try:
        if is_super_admin(user):  # noqa: F821 — 36_admin_clients
            return True
    except Exception:  # noqa: BLE001
        pass
    try:
        _require_super_master(user)  # noqa: F821 — 27_teach_ai_kb (Master radice o SUPER_MASTER_EMAILS)
        return True
    except HTTPException:
        return False


async def _require_cms_admin(user=Depends(get_current_user)):  # noqa: F821
    if not _cms_can_admin(user):
        raise HTTPException(status_code=403, detail="Sezione riservata all'amministratore (Master)")
    return user


@api_router.get("/landing/cms/permission")  # noqa: F821
async def landing_cms_permission(user=Depends(get_current_user)):  # noqa: F821
    return {"can": _cms_can_admin(user), "password_configured": bool((os.environ.get("LANDING_CMS_PASSWORD") or "").strip())}


async def _require_cms(user=Depends(_require_cms_admin), x_cms_password: Optional[str] = Header(default=None, alias="X-CMS-Password")):
    if not (os.environ.get("LANDING_CMS_PASSWORD") or "").strip():
        raise HTTPException(status_code=503, detail="LANDING_CMS_PASSWORD non configurata nel .env del server")
    if not _cms_password_ok(x_cms_password):
        raise HTTPException(status_code=401, detail="Password CMS errata")
    return user


class CmsUnlockIn(BaseModel):
    password: str = Field(min_length=1, max_length=200)


class CmsContentIn(BaseModel):
    content: Dict[str, Any]


@api_router.post("/landing/cms/unlock")  # noqa: F821
async def landing_cms_unlock(body: CmsUnlockIn, user=Depends(_require_cms_admin)):
    if not (os.environ.get("LANDING_CMS_PASSWORD") or "").strip():
        raise HTTPException(status_code=503, detail="LANDING_CMS_PASSWORD non configurata nel .env del server")
    if not _cms_password_ok(body.password):
        raise HTTPException(status_code=401, detail="Password CMS errata")
    return {"ok": True}


@api_router.get("/landing/cms/content")  # noqa: F821
async def landing_cms_get(user=Depends(_require_cms)):
    data = await _landing_content()
    return {**data, "updated_at": data["updated_at"].isoformat() if data.get("updated_at") else None, "defaults": LANDING_DEFAULTS, "seats": await _landing_seats(data["content"])}


@api_router.put("/landing/cms/content")  # noqa: F821
async def landing_cms_put(body: CmsContentIn, user=Depends(_require_cms)):
    content = body.content or {}
    for key in ("builder", "professional"):
        plan = (content.get("plans") or {}).get(key) or {}
        for f in ("price_old", "price", "limit"):
            if f in plan and plan[f] is not None:
                try:
                    plan[f] = int(plan[f]) if f == "limit" else float(plan[f])
                except (TypeError, ValueError):
                    raise HTTPException(status_code=400, detail=f"Valore non numerico per plans.{key}.{f}")
        if plan.get("limit") is not None and plan["limit"] < 0:
            raise HTTPException(status_code=400, detail="Il limite posti non può essere negativo")
    await db.landing_content.replace_one({"_id": "global"}, {"_id": "global", "content": content, "updated_at": utcnow(), "updated_by": user.get("email") or user.get("user_id")}, upsert=True)  # noqa: F821
    data = await _landing_content()
    return {"ok": True, "content": data["content"], "seats": await _landing_seats(data["content"])}


@api_router.post("/landing/cms/reset")  # noqa: F821
async def landing_cms_reset(user=Depends(_require_cms)):
    await db.landing_content.delete_one({"_id": "global"})  # noqa: F821
    return {"ok": True, "content": LANDING_DEFAULTS}


# ───────────────────────────── V50.z533 — FAQ gestibili dal CMS + ricerca in /help + conoscenza per Axon ─────────────────────────────
# Singleton Mongo `faq_content` (_id="global", items=[...]); se assente → FAQ_DEFAULTS. Pubbliche (GET /public/faq), modificabili
# dal CMS (stessa protezione della landing: Master/Super Admin + X-CMS-Password). `_build_faq_section(msg)` → le 3 FAQ più
# pertinenti al messaggio (sovrapposizione di parole chiave) come sezione del prompt di Axon, così «dove trovo X» ha la risposta giusta.
FAQ_DEFAULTS: List[Dict[str, str]] = [
    {
        "id": "faq_01",
        "icon": "school-outline",
        "q": "Come carico un contratto esempio per addestrare Axon?",
        "a": "Vai in Axon Lab › Area Master › Addestramento (Fase 2 · Moduli). Clicca \"Carica contratto compilato di esempio\" e seleziona il file da Drive, Dropbox o dal tuo dispositivo. Axon lo analizza e impara automaticamente la struttura e i campi da compilare."
    },
    {
        "id": "faq_02",
        "icon": "swap-vertical-outline",
        "q": "Posso modificare l'ordine delle pagine nel documento finale?",
        "a": "Sì. Prima di salvare puoi trascinare le sezioni nell'ordine che preferisci, oppure impostare un ordine predefinito nel pannello Master che si applica automaticamente a ogni nuovo documento."
    },
    {
        "id": "faq_03",
        "icon": "save-outline",
        "q": "Dove si salva il documento compilato?",
        "a": "Al termine della compilazione puoi scegliere: cartella del cliente, database Master, condivisione via email o link, o stampa diretta via WiFi. Puoi salvare in più posti contemporaneamente."
    },
    {
        "id": "faq_04",
        "icon": "documents-outline",
        "q": "Axon può compilare qualsiasi tipo di contratto?",
        "a": "Axon funziona con qualsiasi documento PDF che hai caricato come modello. Più esempi compilati gli fornisci, più diventa preciso. Contratti energia, telco, bancari, assicurativi — se hai il modello, Axon lo compila."
    },
    {
        "id": "faq_05",
        "icon": "create-outline",
        "q": "Cosa succede se Axon sbaglia a compilare un campo?",
        "a": "Prima di salvare puoi revisionare e correggere ogni campo manualmente. Axon mostra in anteprima tutto il documento compilato e segnala i campi su cui non è sicuro."
    },
    {
        "id": "faq_06",
        "icon": "phone-portrait-outline",
        "q": "Posso usare AdvisorOS da mobile e desktop contemporaneamente?",
        "a": "Sì. AdvisorOS è sincronizzato in tempo reale su tutti i dispositivi. Puoi iniziare una pratica da desktop e completarla da mobile senza perdere nulla."
    },
    {
        "id": "faq_07",
        "icon": "add-circle-outline",
        "q": "Come aggiungo un nuovo fornitore o modello di contratto?",
        "a": "Da Axon Lab › Addestramento › Fase 2, carica il modulo vuoto del nuovo fornitore e un esempio compilato. Axon lo riconosce automaticamente e lo aggiunge ai modelli disponibili."
    },
    {
        "id": "faq_08",
        "icon": "lock-closed-outline",
        "q": "I dati dei miei clienti sono al sicuro?",
        "a": "Tutti i dati dei clienti sono crittografati e accessibili solo a te e ai collaboratori che autorizzi. Nessun dato viene condiviso con terze parti."
    },
    {
        "id": "faq_09",
        "icon": "people-outline",
        "q": "Posso condividere l'accesso con un collaboratore?",
        "a": "Sì. Dal pannello Master puoi aggiungere collaboratori con livelli di accesso personalizzati — puoi decidere cosa possono vedere e cosa possono modificare."
    },
    {
        "id": "faq_10",
        "icon": "calendar-outline",
        "q": "Come funziona il briefing pre-appuntamento di Axon?",
        "a": "Prima di ogni appuntamento in calendario Axon ti invia un riepilogo automatico: chi incontri, cosa ha acquistato in passato, chi lo ha referenziato, le scadenze aperte e i punti da affrontare. Tutto senza che tu debba chiedere nulla."
    },
    {
        "id": "faq_11",
        "icon": "book-outline",
        "q": "Dove carico i miei libri e appunti perché Axon li ricordi?",
        "a": "Vai in Axon (hub) › «La mia Knowledge Base», oppure Profilo › «La mia Knowledge Base». Puoi caricare PDF/TXT fino a 20 MB o incollare un testo: Axon lo indicizza sul server (senza costi AI) e lo usa quando fai domande in chat. I documenti sono privati e visibili solo a te."
    },
    {
        "id": "faq_12",
        "icon": "chatbubbles-outline",
        "q": "Cosa sono i crediti AI e cosa succede quando finiscono?",
        "a": "I crediti AI mensili coprono SOLO la chat con Axon (testo e voce): 1 messaggio = 1 credito. Tutte le altre funzioni AI (analisi documenti e bollette, trascrizione chiamate, email automatiche, OCR) sono incluse senza limiti. Quando finiscono si ricaricano il 1° del mese; dalla chat puoi richiedere un pacchetto add-on. Il saldo è nel Profilo."
    },
    {
        "id": "faq_13",
        "icon": "gift-outline",
        "q": "Come funziona «Porta un amico»?",
        "a": "In Profilo › «Porta un amico» trovi il tuo codice e il link da condividere. Quando l'amico si registra ricevi 30 crediti AI bonus; quando attiva un piano a pagamento ne riceve 30 anche lui. I crediti bonus non scadono."
    },
    {
        "id": "faq_14",
        "icon": "call-outline",
        "q": "Dove gestisco le call telefoniche programmate?",
        "a": "Nel modulo Call (menu › Call): il bottone «+ Call» crea una nuova call con titolo, data/ora e tipo; dalla lista registri l'esito. Le call compaiono anche in Calendario e nella Home tra le ritelefonate del giorno."
    },
    {
        "id": "faq_15",
        "icon": "color-palette-outline",
        "q": "Come cambio tema (chiaro/scuro) o la voce di Axon?",
        "a": "Profilo › Impostazioni › Aspetto per il tema (Luce, Pearl, Slate, Midnight). Profilo › Impostazioni › Assistente per nome, voce, lingua e tono di Axon."
    },
    {
        "id": "faq_16",
        "icon": "help-buoy-outline",
        "q": "Come segnalo un bug o chiedo assistenza?",
        "a": "Tab Help in basso: compila il modulo «Descrivi il problema» (puoi spuntare i problemi ricorrenti e allegare screenshot). Axon prova a risolvere subito; se serve la richiesta passa al Master. Trovi anche i contatti di supporto e il form «Invia un consiglio»."
    }
]


async def _faq_items() -> List[Dict[str, str]]:
    doc = await db.faq_content.find_one({"_id": "global"}, {"_id": 0, "items": 1})  # noqa: F821
    items = (doc or {}).get("items")
    if isinstance(items, list) and items:
        return items
    out = copy.deepcopy(FAQ_DEFAULTS)
    for it in out:  # V50.z541 — ruoli di default sulle FAQ storiche
        it.setdefault("roles", _FAQ_DEFAULT_ROLES.get(it["id"], []))
    return out + copy.deepcopy(FAQ_ROLE_DEFAULTS)


# ───────────────────────────── V50.z541 — FAQ PER RUOLO + FAQ landing / italianbrain.it / inviti ─────────────────────────────
# Ogni FAQ ha `roles` ⊆ {superadmin, master, manager, collab}; vuoto = visibile a tutti. Il ruolo del lettore si ricava dal
# token (se presente): super_admin → superadmin (vede TUTTO), owner → master, admin → manager, member/consultant → collab,
# anonimo → solo FAQ generali. Un Collaboratore non vede le guide del Master; un Master non vede quelle del Supermaster.
FAQ_ROLES = ("superadmin", "master", "manager", "collab")
_FAQ_DEFAULT_ROLES: Dict[str, List[str]] = {
    "faq_01": ["master", "manager"], "faq_07": ["master", "manager"], "faq_09": ["master", "manager"], "faq_13": ["master"],
}
FAQ_ROLE_DEFAULTS: List[Dict[str, Any]] = [
    {"id": "faq_17", "icon": "globe-outline", "roles": ["master"],
     "q": "Cos'è la landing page italianbrain.it e come la uso?",
     "a": "italianbrain.it è la pagina pubblica di presentazione di AxonOS: spiega il Manifesto Privacy, i piani e i posti Founder rimasti. È fuori dall'app (sito statico): condividila a chi vuoi presentare AxonOS. Chi clicca «Inizia» arriva alla registrazione dell'app. Il link è in Pannello Master › Condividi landing e nella Business Card."},
    {"id": "faq_18", "icon": "link-outline", "roles": ["master", "manager"],
     "q": "Come invito i miei utenti: link via email o creazione manuale?",
     "a": "Due modi, entrambi da Pannello Master. 1) Link di registrazione: Invita collaboratore › scegli il ruolo (Collaboratore, Manager, Master figlio) › Crea link › invialo via email, WhatsApp o QR; chi lo apre si registra ed entra nella tua organizzazione. 2) Creazione manuale: Gestione Team › «Aggiungi» › inserisci nome, email, password e aree: l'utente è pronto subito. Ogni Manager può creare i propri Collaboratori."},
    {"id": "faq_19", "icon": "layers-outline", "roles": ["master"],
     "q": "Quanti utenti posso avere? Come funzionano i piani?",
     "a": "Il piano scelto alla registrazione fissa il totale di utenti della tua organizzazione (tu + Manager + Collaboratori di ogni livello): Collaboratore singolo (1 utente), Master fino a 10, Master fino a 50, oltre 50 su preventivo. Al limite, inviti e creazioni manuali vengono bloccati con l'avviso «Limite del piano raggiunto»: fai l'upgrade da Gestione Team › «Passa al piano superiore» (pagamento o richiesta al Supermaster)."},
    {"id": "faq_20", "icon": "git-network-outline", "roles": ["master", "manager"],
     "q": "Che differenza c'è tra Master, Manager e Collaboratore?",
     "a": "Master: titolare dell'organizzazione, gestisce piani, team, inviti, aree, Libretto e addestramento di Axon. Manager: coordina i propri Collaboratori (li crea, assegna aree, vede le loro statistiche) ma non i piani. Collaboratore: lavoro operativo su contatti, appuntamenti, contratti e Axon. Il Supermaster è il gestore della piattaforma e vede tutte le organizzazioni."},
    {"id": "faq_21", "icon": "people-outline", "roles": ["collab"],
     "q": "Cosa posso fare come Collaboratore?",
     "a": "Tutto il lavoro operativo: contatti e CRM, calendario e call, contratti compilati da Axon, Knowledge Base personale, chat con Axon, scanner documenti. Le impostazioni di squadra (aree, inviti, Libretto, addestramento) sono del tuo Manager/Master: se ti serve qualcosa di quel tipo chiedi a lui dal tab Help › «Chiedi al Master»."},
    {"id": "faq_22", "icon": "person-add-outline", "roles": ["manager"],
     "q": "Come aggiungo un Collaboratore alla mia squadra?",
     "a": "Pannello Master › Gestione Team › «Aggiungi»: nome, email, password provvisoria e almeno un'area. Il Collaboratore comparirà sotto di te nella gerarchia e vedrai le sue statistiche in Team Insights. Se il Master ha raggiunto il limite utenti del piano l'aggiunta viene bloccata: chiedi al Master l'upgrade."},
    {"id": "faq_23", "icon": "shield-checkmark-outline", "roles": ["superadmin"],
     "q": "Dove gestisco tutti gli utenti registrati (ruoli, piani, eliminazione)?",
     "a": "Pannello Master › sezione Super Admin › «Utenti registrati» (/admin/users): elenco di tutti gli utenti di tutte le organizzazioni con ricerca e filtri. Azioni per utente: Cambia ruolo (Master/Manager/Collaboratore/Consulente), Sposta sotto un altro Master o Manager, Assegna piano, Reinvia email di benvenuto, Verifica email, Elimina (con eliminazione a cascata se ha utenti sotto)."},
    {"id": "faq_24", "icon": "pricetags-outline", "roles": ["superadmin"],
     "q": "Come modifico piani e prezzi senza toccare il codice?",
     "a": "Pannello Master › Super Admin › «Piani e prezzi»: etichetta, prezzo mensile, numero massimo di utenti, badge e flag «preventivo» per ogni piano. Le modifiche sono immediate nel modulo di registrazione, nel paywall (pagamento Stripe) e nei controlli di limite utenti."},
    {"id": "faq_25", "icon": "mail-open-outline", "roles": ["superadmin"],
     "q": "L'email di benvenuto non è arrivata a un nuovo iscritto: cosa faccio?",
     "a": "L'email parte subito alla registrazione e viene ritentata alla verifica del codice. In /admin/users il filtro «Senza benvenuto» mostra chi non l'ha ricevuta e l'eventuale errore del provider; il tasto «Reinvia benvenuto» la rimanda. Il testo si modifica in Super Admin › «Email di benvenuto» (deve essere attiva)."},
    {"id": "faq_26", "icon": "chatbubbles-outline", "roles": ["superadmin"],
     "q": "Come gestisco le FAQ per ruolo?",
     "a": "CMS Landing › sezione FAQ: ogni domanda ha i chip Supermaster / Master / Manager / Collaboratore. Nessun chip = visibile a tutti. Il Centro Assistenza mostra a ogni utente solo le FAQ del suo ruolo (più quelle generali) e Axon usa le stesse FAQ come fonte di verità nelle risposte."},
]


def _faq_role_of(user: Optional[dict]) -> Optional[str]:
    if not user:
        return None
    if is_super_admin(user):  # noqa: F821
        return "superadmin"
    r = user.get("role") or "member"
    return "master" if r == "owner" else "manager" if r == "admin" else "collab"


def _faq_visible(items: List[Dict[str, Any]], role: Optional[str]) -> List[Dict[str, Any]]:
    if role == "superadmin":
        return items
    return [it for it in items if not it.get("roles") or (role and role in it.get("roles", []))]


async def _faq_optional_user(authorization: Optional[str]) -> Optional[dict]:
    if not authorization:
        return None
    try:
        return await get_current_user(authorization)  # noqa: F821
    except Exception:  # noqa: BLE001
        return None


async def _faq_items_for(authorization: Optional[str]) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    role = _faq_role_of(await _faq_optional_user(authorization))
    return _faq_visible(await _faq_items(), role), role


@api_router.get("/public/faq")  # noqa: F821
async def public_faq(authorization: Optional[str] = Header(None)):
    items, role = await _faq_items_for(authorization)
    return {"items": items, "role": role}


class FaqItemIn(BaseModel):
    id: Optional[str] = None
    icon: Optional[str] = "help-circle-outline"
    q: str = Field(min_length=3, max_length=300)
    a: str = Field(min_length=3, max_length=3000)
    roles: Optional[List[str]] = None  # V50.z541


class FaqPutIn(BaseModel):
    items: List[FaqItemIn] = Field(max_length=200)


@api_router.put("/landing/cms/faq")  # noqa: F821
async def landing_cms_faq_put(body: FaqPutIn, user=Depends(_require_cms)):
    items = []
    for i, it in enumerate(body.items, 1):
        roles = [r for r in (it.roles or []) if r in FAQ_ROLES]
        items.append({"id": (it.id or "").strip() or f"faq_{uuid.uuid4().hex[:8]}", "icon": (it.icon or "help-circle-outline").strip(), "q": it.q.strip(), "a": it.a.strip(), "roles": roles})
    await db.faq_content.replace_one({"_id": "global"}, {"_id": "global", "items": items, "updated_at": utcnow(), "updated_by": user.get("email") or user.get("user_id")}, upsert=True)  # noqa: F821
    _faq_vec_cache.clear()
    return {"ok": True, "items": items}


@api_router.post("/landing/cms/faq/reset")  # noqa: F821
async def landing_cms_faq_reset(user=Depends(_require_cms)):
    await db.faq_content.delete_one({"_id": "global"})  # noqa: F821
    _faq_vec_cache.clear()
    return {"ok": True, "items": FAQ_DEFAULTS}


# ───────────────────────────── V50.z536 — FAQ suggerite SEMANTICHE (MiniLM locale, zero crediti AI) ─────────────────────────────
# Mentre l'utente digita nel Centro Assistenza, GET /public/faq/suggest?q=… restituisce le 3 FAQ più vicine per significato
# (cosine su embedding all-MiniLM-L6-v2 — lo stesso motore ONNX della Knowledge Base). Gli embedding delle FAQ sono calcolati una
# volta e messi in cache in memoria (invalidata quando il CMS pubblica nuove FAQ). Fallback keyword se il modello non è disponibile.
_faq_vec_cache: Dict[str, Any] = {}
FAQ_SUGGEST_MIN_SIM = 0.30


def _faq_sig(items: List[Dict[str, str]]) -> str:
    return hashlib.sha1("\x1f".join(f"{it.get('id')}|{it.get('q')}|{it.get('a')}" for it in items).encode("utf-8")).hexdigest()


async def _faq_vectors(items: List[Dict[str, str]]) -> List[List[float]]:
    sig = _faq_sig(items)
    if _faq_vec_cache.get("sig") != sig:
        texts = [f"{it.get('q', '')}\n{(it.get('a', '') or '')[:400]}" for it in items]
        vecs = await asyncio.to_thread(_kb_embedder.embed, texts)  # noqa: F821 — axon_knowledge_base
        _faq_vec_cache.update({"sig": sig, "vecs": vecs})
    return _faq_vec_cache["vecs"]


async def _faq_semantic_top(query: str, k: int = 3, items: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    items = await _faq_items() if items is None else items
    if not items:
        return []
    q = (query or "").strip()[:500]
    if _kb_embedder.available:  # noqa: F821
        vecs = await _faq_vectors(items)
        qv = (await asyncio.to_thread(_kb_embedder.embed, [q]))[0]  # noqa: F821
        qa = np.asarray(qv, dtype=np.float32)
        sims = np.asarray(vecs, dtype=np.float32) @ qa
        # piccolo bonus lessicale: parole della domanda presenti nella FAQ (aiuta con termini propri come "Libretto", "CRT")
        q_tok = _faq_tokens(q)
        order = np.argsort(-sims)
        out = []
        for i in order[: max(k * 3, 6)]:
            it = items[int(i)]
            lex = len(q_tok & (_faq_tokens(it.get("q", "")) | _faq_tokens(it.get("a", ""))))
            score = float(sims[int(i)]) + 0.05 * min(lex, 3)
            if score >= FAQ_SUGGEST_MIN_SIM:
                out.append({**it, "score": round(score, 3)})
        out.sort(key=lambda x: -x["score"])
        return out[:k]
    # fallback keyword (stesso scoring di _build_faq_section)
    q_tok = _faq_tokens(q)
    scored = []
    for it in items:
        score = 2.0 * len(q_tok & _faq_tokens(it.get("q", ""))) + 0.5 * len(q_tok & _faq_tokens(it.get("a", "")))
        if score > 0:
            scored.append((score, it))
    scored.sort(key=lambda x: -x[0])
    return [{**it, "score": s} for s, it in scored[:k]]


@api_router.get("/public/faq/suggest")  # noqa: F821
async def public_faq_suggest(q: str = "", k: int = 3, authorization: Optional[str] = Header(None)):
    q = (q or "").strip()
    if len(q) < 3:
        return {"items": [], "engine": "none"}
    visible, _role = await _faq_items_for(authorization)  # V50.z541 — solo FAQ del ruolo del lettore
    items = await _faq_semantic_top(q, max(1, min(int(k or 3), 6)), items=visible)
    return {"items": items, "engine": "minilm-local" if _kb_embedder.available else "keyword"}  # noqa: F821


_FAQ_STOP = {"come", "dove", "cosa", "che", "chi", "quando", "quale", "quali", "posso", "puoi", "devo", "fare", "faccio", "trovo", "trovare", "sono", "essere",
             "il", "lo", "la", "i", "gli", "le", "un", "una", "uno", "di", "del", "della", "dei", "delle", "degli", "a", "al", "alla", "ai", "alle", "da", "dal", "dalla",
             "in", "nel", "nella", "nei", "nelle", "con", "su", "sul", "sulla", "per", "tra", "fra", "e", "o", "ma", "non", "si", "mi", "ti", "ci", "vi", "se", "è", "ho", "hai",
             "ha", "c'è", "ce", "questo", "questa", "quello", "quella", "anche", "più", "molto", "tutto", "tutti", "axon", "app", "advisoros"}
_FAQ_RX_WORD = re.compile(r"[a-zàèéìòù0-9]{3,}")


def _faq_tokens(text: str) -> set:
    toks = set()
    for w in _FAQ_RX_WORD.findall((text or "").lower()):
        if w in _FAQ_STOP:
            continue
        toks.add(w[:-1] if len(w) > 5 and w[-1] in "aeio" else w)  # stem grezzo: libri/libro, crediti/credito
    return toks


async def _build_faq_section(msg: str, k: int = 3, user: Optional[dict] = None) -> str:
    q_tok = _faq_tokens(msg)
    if len(q_tok) < 1:
        return ""
    scored = []
    for it in _faq_visible(await _faq_items(), _faq_role_of(user)) if user else await _faq_items():
        t_q = _faq_tokens(it.get("q", ""))
        t_a = _faq_tokens(it.get("a", ""))
        score = 2.0 * len(q_tok & t_q) + 0.5 * len(q_tok & t_a)
        if score >= 2.0:
            scored.append((score, it))
    if not scored:
        return ""
    scored.sort(key=lambda x: -x[0])
    lines = ["\n\nFAQ UFFICIALI DELL'APP (pertinenti alla domanda — usale per rispondere con il percorso corretto; sono la fonte di verità su dove si trovano le funzioni):"]
    for _, it in scored[:k]:
        lines.append(f"D: {it['q']}\nR: {it['a']}")
    return "\n".join(lines) + "\n"
