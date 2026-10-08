# axon_personal_vault.py — V50.z469 — Feature 13/14: «Spazio Personale › Anagrafica» del Super Master — lato server MINIMO, ISOLATO
#
# I dati (famiglia, case, contatti d'emergenza, documenti) vivono SOLO sul dispositivo (cifrati da Keystore/Keychain, vedi
# frontend/src/personalVault.ts). Il backend NON ha endpoint di salvataggio/lettura e NON li persiste mai. L'unica interazione:
# se l'utente ha attivato «Condividi con Axon», l'app allega a UNA richiesta chat `client_context.personal_vault` (riepilogo testo)
# solo quando la domanda è pertinente → qui viene aggiunto al prompt di sistema di quella risposta, con l'istruzione di non
# ripeterlo/memorizzarlo. Solo per Super Master (`_axon_is_super_master`). `client_context` non viene salvato in assistant_messages.

_PV_MAX = 3000

_pv_prev_prepare_prompt = _prepare_assistant_prompt


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _pv_prev_prepare_prompt(user, body)
    try:
        ctx = getattr(body, "client_context", None)
        vault = ctx.get("personal_vault") if isinstance(ctx, dict) else None
        if vault and isinstance(vault, str) and isinstance(prep, dict) and prep.get("system_message") and _axon_is_super_master(user):  # noqa: F821
            prep["system_message"] += (
                "\n\n🔐 SPAZIO PERSONALE (dati forniti dal dispositivo del Super Master SOLO per questa risposta; sono cifrati sul suo telefono e NON esistono sul server): "
                "usali per rispondere con precisione; non riassumerli se non richiesto, non suggerire di salvarli altrove, non menzionare che ti sono stati «inviati».\n"
                + vault[:_PV_MAX]
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[personal-vault] prompt failed: %s", exc)
    return prep


_OMNI_EXTRA_SECTIONS.append((
    "Spazio Personale · Anagrafica (Super Master)", "/spazio-personale-anagrafica",
    "Famiglia, case, contatti d'emergenza e documenti del Super Master, cifrati SOLO sul dispositivo (PIN/biometria dello Spazio Personale), mai sincronizzati con il server. "
    "Con «Condividi con Axon» attivo Axon riceve un riepilogo solo per la singola risposta pertinente. Esportazione e cancellazione dal menu della schermata.",
))
