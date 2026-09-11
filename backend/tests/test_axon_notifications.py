"""Test notifiche AxonOS (axon_notifications.py) — contro il server in esecuzione."""
import requests, time, os, sys, asyncio
B = "https://business-card-pro-16.preview.emergentagent.com/api"


def login(e, p):
    r = requests.post(B + "/auth/login", json={"email": e, "password": p}); r.raise_for_status()
    j = r.json(); return {"Authorization": "Bearer " + j["token"]}, j["user"]["user_id"]


HM, MID = login("demo@advisoros.it", "Demo1234!")
HC, CID = login("collab.demo@advisoros.it", "Demo1234!")
ts = str(int(time.time()))

# 1) prefs default
p = requests.get(B + "/axon-notifications/prefs", headers=HC).json()
assert p["enabled"] is True and set(p["kinds"]) == {"cgym_due", "callback_urgent", "credits", "weekly_report", "axon_message"} and p["is_owner"] is False
pm = requests.get(B + "/axon-notifications/prefs", headers=HM).json()
assert pm["is_owner"] and "credits_used_month" in pm
print("1 prefs OK", pm["credits_used_month"], "/", pm["credits_plan_monthly"])

# 2) collab non può notificare altri; può notificare sé stesso → Master riceve copia [Team]
r = requests.post(B + "/axon-notifications/send", headers=HC, json={"user_id": MID, "title": "x", "body": "y"})
assert r.status_code == 403, r.text
r = requests.post(B + "/axon-notifications/send", headers=HC, json={"title": "Prova collab " + ts, "body": "corpo", "deeplink": "/callback", "dedupe_key": "t1-" + ts})
assert r.status_code == 200 and r.json()["notification"]["kind"] == "axon_message", r.text
# dedupe
r2 = requests.post(B + "/axon-notifications/send", headers=HC, json={"title": "Prova collab " + ts, "body": "corpo", "dedupe_key": "t1-" + ts})
assert r2.json()["deduplicated"] is True
lc = requests.get(B + "/axon-notifications", headers=HC).json()
assert any(i["title"] == "Prova collab " + ts for i in lc["items"]) and lc["unread"] >= 1
print("2 send self + dedupe OK, unread collab", lc["unread"])
# la copia del team: il collab ha inviato a sé stesso (team_copy=False per self) → il Master NON deve averla
lm = requests.get(B + "/axon-notifications", headers=HM).json()
assert not any(("Prova collab " + ts) in i["title"] for i in lm["items"])
print("2b nessuna copia Master per auto-notifica OK")

# 3) Master notifica il collaboratore → il collab la riceve; il Master (mittente) NON la vede se non team copy... (Master notifica collab → copia [Team] al Master stesso)
r = requests.post(B + "/axon-notifications/send", headers=HM, json={"user_id": CID, "title": "Dal Master " + ts, "body": "fai la richiamata", "kind": "callback_urgent", "dedupe_key": "t2-" + ts})
assert r.status_code == 200, r.text
lc = requests.get(B + "/axon-notifications?unread_only=true", headers=HC).json()
assert any(i["title"] == "Dal Master " + ts for i in lc["items"])
lm = requests.get(B + "/axon-notifications", headers=HM).json()
assert any(("[Team" in i["title"] and ("Dal Master " + ts) in i["title"]) for i in lm["items"]), [i["title"] for i in lm["items"][:5]]
print("3 Master→collab + copia [Team] al Master OK")

# 4) il collaboratore NON vede le notifiche del Master
assert not any(i["user_id"] != CID for i in lc["items"])
print("4 visibilità collab OK")

# 5) read / read-all / unread-count / delete
nid = lc["items"][0]["notif_id"]
r = requests.post(B + f"/axon-notifications/{nid}/read", headers=HC).json(); assert "unread" in r
u = requests.get(B + "/axon-notifications/unread-count", headers=HC).json()["unread"]
r = requests.post(B + "/axon-notifications/read-all", headers=HC).json(); assert r["unread"] == 0
assert requests.get(B + "/axon-notifications/unread-count", headers=HC).json()["unread"] == 0
d = requests.delete(B + f"/axon-notifications/{nid}", headers=HC).json(); assert d["deleted"] == 1
# non posso cancellare quella di un altro
other = lm["items"][0]["notif_id"]
assert requests.delete(B + f"/axon-notifications/{other}", headers=HC).json()["deleted"] == 0
print("5 read/read-all/delete OK")

# 6) prefs: disabilito kind → la notifica è creata in-app ma push non inviato (push_sent False); collab non può cambiare piano crediti
r = requests.put(B + "/axon-notifications/prefs", headers=HC, json={"kinds": {"axon_message": False}, "credits_plan_monthly": 5}).json()
assert r["kinds"]["axon_message"] is False and r["credits_plan_monthly"] == 1000
r = requests.post(B + "/axon-notifications/send", headers=HC, json={"title": "Silenziosa " + ts, "body": "b", "dedupe_key": "t3-" + ts}).json()
assert r["notification"]["push_sent"] is False
requests.put(B + "/axon-notifications/prefs", headers=HC, json={"kinds": {"axon_message": True}})
r = requests.put(B + "/axon-notifications/prefs", headers=HM, json={"credits_plan_monthly": 20}).json(); assert r["credits_plan_monthly"] == 20
print("6 prefs OK")

# 7) test push endpoint + run-checks (Master) — con piano 20 i crediti probabilmente superano il 50% → notifica credits
t = requests.post(B + "/axon-notifications/test", headers=HC).json(); assert t["notification"]["kind"] == "axon_message"
assert requests.post(B + "/axon-notifications/run-checks", headers=HC).status_code == 403
rc = requests.post(B + "/axon-notifications/run-checks", headers=HM).json()
print("7 run-checks:", rc)
lm = requests.get(B + "/axon-notifications", headers=HM).json()
kinds = {i["kind"] for i in lm["items"]}
print("   kinds Master:", kinds)
requests.put(B + "/axon-notifications/prefs", headers=HM, json={"credits_plan_monthly": 1000})
print("ALL OK")
