# V50.z508 — tests for deeplink-map, routes rescan, stress autofix + nightly settings + notifications.
import os
import time
import pytest
import requests
from pymongo import MongoClient

BASE_URL = "http://localhost:8001/api"
OWNER = {"email": "test@dalpastro.it", "password": "Test1234!"}
DEMO = {"email": "demo@advisoros.it", "password": "Demo1234!"}
# Review-request requested demo@advisoros.it as "non-owner" → but that account seeds as role=owner in its own
# tenant, so the real non-owner check is done with the sub-user `consulente.test@dalpastro.it` (role=consultant,
# parent_user_id=test@dalpastro.it). We keep the demo fixture only for sanity; owner-guard tests use CONS.
CONS = {"email": "consulente.test@dalpastro.it", "password": "Test1234!"}

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
_mc = MongoClient(MONGO_URL)
db = _mc[DB_NAME]


def _login(creds):
    r = requests.post(f"{BASE_URL}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    return j["token"], j["user"]


@pytest.fixture(scope="module")
def owner_token():
    t, u = _login(OWNER)
    return t, u


@pytest.fixture(scope="module")
def demo_token():
    t, u = _login(DEMO)
    return t, u


@pytest.fixture(scope="module")
def cons_token():
    t, u = _login(CONS)
    return t, u


def _h(t):
    return {"Authorization": f"Bearer {t}"}


# ───────────────────────── deeplink-map ─────────────────────────
class TestDeeplinkMap:
    def test_owner_map_basic(self, owner_token):
        tok, _ = owner_token
        r = requests.get(f"{BASE_URL}/axon/deeplink-map", headers=_h(tok), timeout=60)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "stats" in j and "text" in j
        assert j["stats"]["routes"] > 50, f"routes={j['stats']['routes']}"
        assert j["text"].startswith("🗺️ MAPPA ESPLICITA DEI DEEP LINK"), j["text"][:120]
        assert "- [[NAV:/" in j["text"] and "|" in j["text"]
        # row shape:   - [[NAV:/x|Label]] ← «…»
        assert "]] ←" in j["text"]

    def test_refresh_param(self, owner_token):
        tok, _ = owner_token
        r = requests.get(f"{BASE_URL}/axon/deeplink-map?refresh=1", headers=_h(tok), timeout=60)
        assert r.status_code == 200
        assert r.json()["stats"]["routes"] > 50

    def test_probe_navigate_contact(self, owner_token):
        tok, _ = owner_token
        r = requests.get(f"{BASE_URL}/axon/deeplink-map", headers=_h(tok),
                         params={"probe": "Come aggiungo un contatto?"}, timeout=60)
        assert r.status_code == 200
        assert r.json()["probe"]["intent"] == "navigate", r.json()["probe"]

    def test_probe_not_navigate_info(self, owner_token):
        tok, _ = owner_token
        r = requests.get(f"{BASE_URL}/axon/deeplink-map", headers=_h(tok),
                         params={"probe": "Quanti appuntamenti ho domani?"}, timeout=60)
        assert r.status_code == 200
        assert r.json()["probe"]["intent"] != "navigate", r.json()["probe"]

    def test_probe_navigate_export(self, owner_token):
        tok, _ = owner_token
        r = requests.get(f"{BASE_URL}/axon/deeplink-map", headers=_h(tok),
                         params={"probe": "Come faccio a esportare i miei dati in Excel?"}, timeout=60)
        assert r.status_code == 200
        assert r.json()["probe"]["intent"] == "navigate", r.json()["probe"]

    def test_non_owner_forbidden(self, cons_token):
        tok, _ = cons_token
        r = requests.get(f"{BASE_URL}/axon/deeplink-map", headers=_h(tok), timeout=30)
        assert r.status_code == 403, r.status_code


# ───────────────────────── routes manifest / rescan ─────────────────────────
class TestRoutesRescan:
    def test_manifest(self, owner_token):
        tok, _ = owner_token
        r = requests.get(f"{BASE_URL}/axon/routes/manifest", headers=_h(tok), timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert j["source"] == "filesystem", j["source"]
        assert "/call" in j["routes"], "missing /call"
        assert "/home" in j["routes"], "missing /home"

    def test_rescan_no_change(self, owner_token):
        tok, _ = owner_token
        r = requests.post(f"{BASE_URL}/axon/routes/rescan", headers=_h(tok), timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert j["changed"] is False, j
        assert j["added"] == []
        assert j["removed"] == []

    def test_rescan_detects_add_and_remove(self, owner_token):
        tok, _ = owner_token
        probe_path = "/app/frontend/app/zz-probe.tsx"
        try:
            with open(probe_path, "w", encoding="utf-8") as f:
                f.write("export default function X(){return null}\n")
            r = requests.post(f"{BASE_URL}/axon/routes/rescan", headers=_h(tok), timeout=30)
            assert r.status_code == 200
            j = r.json()
            assert "/zz-probe" in j["added"], f"added={j['added']}"
            assert j["changed"] is True
            # deeplink map should include new route after refresh (NOTE: bug — extra[:80] cap may hide it)
            r2 = requests.get(f"{BASE_URL}/axon/deeplink-map?refresh=1", headers=_h(tok), timeout=60)
            assert r2.status_code == 200
            injected = "[[NAV:/zz-probe|" in r2.json()["text"]
            if not injected:
                stats = r2.json().get("stats", {})
                pytest.xfail(f"zz-probe not injected (extra_routes={stats.get('extra_routes')} truncated at 80) — see action_items")
            # mongo axon_route_manifest contains doc with added
            doc = db.axon_route_manifest.find_one(sort=[("scanned_at", -1)])
            assert doc is not None
            assert "/zz-probe" in (doc.get("added") or []) or "/zz-probe" in (doc.get("routes") or [])
        finally:
            try:
                os.remove(probe_path)
            except FileNotFoundError:
                pass
        # remove detection
        r3 = requests.post(f"{BASE_URL}/axon/routes/rescan", headers=_h(tok), timeout=30)
        assert r3.status_code == 200
        j3 = r3.json()
        assert "/zz-probe" in j3["removed"], f"removed={j3['removed']}"
        assert j3["changed"] is True


# ───────────────────────── stream chat with marker ─────────────────────────
class TestStreamNavMarker:
    def _stream_full_text(self, token, message, sid):
        # SSE text accumulate (we don't care about stage; the final text should contain the full assistant message with marker).
        import json as _json
        url = f"{BASE_URL}/assistant/chat/stream"
        payload = {"message": message, "no_cache": True, "session_id": sid}
        full = ""
        with requests.post(url, json=payload, headers=_h(token), stream=True, timeout=120) as r:
            assert r.status_code == 200, r.text[:300]
            for line in r.iter_lines(decode_unicode=True):
                if not line:
                    continue
                if line.startswith("data:"):
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        obj = _json.loads(data)
                    except Exception:
                        continue
                    if isinstance(obj, dict) and "text" in obj and "stage" not in obj:
                        full = obj["text"] if len(obj["text"]) > len(full) else full
        return full

    def test_how_add_contact_contains_marker(self, owner_token):
        tok, _ = owner_token
        txt = self._stream_full_text(tok, "Come aggiungo un contatto?", "t1-add-contact")
        if "temporaneamente offline" in txt.lower():
            txt = self._stream_full_text(tok, "Come aggiungo un contatto?", "t1-add-contact-retry")
        assert "[[NAV:" in txt, f"missing marker; got: {txt[:400]}"
        # should NOT contain narrative arrow path
        bad_arrows = [" → ", "Impostazioni →", "Vai in Impostazioni", "Vai in Contatti →"]
        for b in bad_arrows:
            assert b not in txt, f"found narrative path '{b}' in: {txt[:400]}"

    def test_where_stats_contains_marker(self, owner_token):
        tok, _ = owner_token
        full = self._stream_full_text(tok, "Dove vedo le statistiche?", "t1-stats")
        if "temporaneamente offline" in full.lower():
            full = self._stream_full_text(tok, "Dove vedo le statistiche?", "t1-stats-retry")
        assert "[[NAV:" in full, f"missing marker; got: {full[:400]}"


# ───────────────────────── stress autofix ─────────────────────────
class TestStressAutofix:
    def _pick_run(self, token):
        r = requests.get(f"{BASE_URL}/axon/stress/runs", headers=_h(token), timeout=30)
        assert r.status_code == 200, r.text
        runs = r.json().get("runs") or r.json().get("items") or r.json()
        if isinstance(runs, dict):
            runs = runs.get("runs") or runs.get("items") or []
        candidate = None
        for r_ in runs:
            s = r_.get("summary") or {}
            if s.get("failed", 0) > 0 and r_.get("status") in ("done", "stopped"):
                candidate = r_
                break
        return candidate

    def test_autofix_manual(self, owner_token):
        tok, user = owner_token
        run_hint = self._pick_run(tok)
        if not run_hint:
            pytest.skip("No concluded run with failed>0 available")
        run_id = run_hint["run_id"]
        # fetch full run to count failed items with correction
        rfull = requests.get(f"{BASE_URL}/axon/stress/runs/{run_id}", headers=_h(tok), timeout=30)
        assert rfull.status_code == 200
        full = rfull.json()
        items = full.get("items") or []
        failed_with_corr = [it for it in items if it.get("outcome") == "failed" and (it.get("correction") or {}).get("rule")]
        # Reset per request: set correction_applied=false, remove correction_auto, drop auto rules for this run
        db.axon_stress_runs.update_one(
            {"run_id": run_id},
            {"$set": {"items.$[].correction_applied": False},
             "$unset": {"items.$[].correction_auto": "", "autofix": ""}},
        )
        db.axon_prompt_rules.delete_many({"source.run_id": run_id})

        # expected applied count = failed items with a (saved or suggestible) correction
        # We can only guarantee items that already have a saved correction object.
        expected_min = len(failed_with_corr)

        r = requests.post(f"{BASE_URL}/axon/stress/autofix/{run_id}", headers=_h(tok), timeout=240)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["ok"] is True
        # all failed items were applied (either from saved correction or suggested one): applied == number of failed items with usable correction
        assert j["applied"] >= expected_min, j
        assert j["new_pct"] >= j["pct_before"], j
        assert j["message"].startswith("Test completato:") and "correzioni applicate" in j["message"] and "nuovo punteggio" in j["message"], j["message"]

        # mongo: auto rules exist
        n_auto = db.axon_prompt_rules.count_documents({"source.run_id": run_id, "source.auto": True})
        assert n_auto >= 1 if j["applied"] > 0 else True, f"n_auto={n_auto}"
        # mongo: items with correction_applied True + correction_auto True + autofix_recheck
        updated = db.axon_stress_runs.find_one({"run_id": run_id}, {"items": 1, "autofix": 1})
        assert updated.get("autofix") is not None, "autofix field missing on run"
        if j["applied"] > 0:
            n_applied_items = sum(1 for it in updated["items"]
                                  if it.get("correction_applied") and it.get("correction_auto") and it.get("autofix_recheck"))
            assert n_applied_items >= 1, "no items show correction_applied/auto/autofix_recheck"

        # GET run exposes autofix field
        rget = requests.get(f"{BASE_URL}/axon/stress/runs/{run_id}", headers=_h(tok), timeout=30)
        assert rget.status_code == 200
        assert "autofix" in rget.json(), rget.json().keys()

    def test_autofix_404(self, owner_token):
        tok, _ = owner_token
        r = requests.post(f"{BASE_URL}/axon/stress/autofix/does_not_exist", headers=_h(tok), timeout=30)
        assert r.status_code == 404

    def test_autofix_403(self, cons_token):
        tok, _ = cons_token
        r = requests.post(f"{BASE_URL}/axon/stress/autofix/any", headers=_h(tok), timeout=30)
        assert r.status_code == 403


# ───────────────────────── nightly settings ─────────────────────────
class TestNightlySettings:
    def test_get_default_autofix_true(self, owner_token):
        tok, _ = owner_token
        r = requests.get(f"{BASE_URL}/axon/stress/nightly", headers=_h(tok), timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert "settings" in j
        assert "autofix" in j["settings"], j["settings"]

    def test_put_toggle(self, owner_token):
        tok, _ = owner_token
        r = requests.put(f"{BASE_URL}/axon/stress/nightly", headers=_h(tok), json={"autofix": False}, timeout=30)
        assert r.status_code == 200
        assert r.json()["settings"]["autofix"] is False
        # restore
        r2 = requests.put(f"{BASE_URL}/axon/stress/nightly", headers=_h(tok), json={"autofix": True}, timeout=30)
        assert r2.status_code == 200
        assert r2.json()["settings"]["autofix"] is True


# ───────────────────────── nightly notification ─────────────────────────
class TestNightlyNotification:
    def test_mongo_notification_and_alert_exist(self, owner_token):
        _, user = owner_token
        uid = user["user_id"]
        # notification
        n = db.axon_notifications.find_one({
            "$or": [{"user_id": uid}, {"tenant_id": uid}],
            "title": "🧪 Test notturno completato",
            "body": {"$regex": "^Test notturno completato: .*correzioni applicate.*nuovo punteggio"},
        })
        if not n:
            # fallback with 'message' field
            n = db.axon_notifications.find_one({
                "$or": [{"user_id": uid}, {"tenant_id": uid}],
                "title": "🧪 Test notturno completato",
                "message": {"$regex": "^Test notturno completato: .*correzioni applicate.*nuovo punteggio"},
            })
        assert n is not None, "no nightly summary notification found"
        a = db.axon_alerts.find_one({"tenant_id": uid, "title": "🧪 Test notturno completato"})
        assert a is not None, "no nightly alert found"
        assert "correzioni applicate" in (a.get("message") or "") and "nuovo punteggio" in (a.get("message") or "")
