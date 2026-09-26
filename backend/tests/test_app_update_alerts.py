"""V50.z379 — avvisi aggiornamento APK: una sola notifica per versione disponibile, nessun avviso se installata ≥ disponibile."""
import os, requests, pymongo
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
BASE="http://localhost:8001/api"; s=requests.Session()
r=s.post(f"{BASE}/auth/login",json={"email":"test@dalpastro.it","password":"Test1234!"}); s.headers["Authorization"]=f"Bearer {r.json().get('token') or r.json().get('access_token')}"
c=pymongo.MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
uid=c.users.find_one({"email":"test@dalpastro.it"})["user_id"]
def hb(dev, ver, build, platform="android"):
    return s.post(f"{BASE}/axon/system/heartbeat", json={"device_key":dev,"platform":platform,"app_version":ver,"build_number":build,"js_version":"2.0.0","device_name":"Test","os_version":"14","expo_sdk":"54","app_env":"standalone"}).json()
def open_alerts():
    return [(a["title"], a.get("latest_version")) for a in c.axon_proactive_log.find({"user_id":uid,"type":"app_update","dismissed_at":None})]
def notifs():
    return c.axon_notifications.count_documents({"user_id":uid,"title":{"$regex":"Aggiornamento disponibile"}})
c.axon_client_versions.delete_many({"user_id":uid}); c.axon_proactive_log.delete_many({"user_id":uid,"type":"app_update"}); c.axon_notifications.delete_many({"user_id":uid,"title":{"$regex":"Aggiornamento disponibile"}})
hb("dev-user","1.0.80","80")
for v in ("1.0.81","1.0.85","1.0.88","1.0.90"):
    hb("dev-fleet",v,v.split(".")[-1],"ios"); s.get(f"{BASE}/axon/app-info?device_key=dev-user")
print("1) avvisi aperti dopo 4 versioni intermedie:", open_alerts(), "| notifiche:", notifs())
j=s.get(f"{BASE}/axon/app-info?device_key=dev-user&installed_version=1.0.90&build_number=90").json()
print("2) installed:", j["device"]["installed_version"], "latest:", j["latest_version"], "| avvisi:", open_alerts(), "| notifiche:", notifs())
hb("dev-user-2","1.0.90","90"); s.get(f"{BASE}/axon/app-info?device_key=dev-user")
c.axon_client_versions.update_one({"user_id":uid,"device_key":"dev-user"},{"$set":{"app_version":"1.0.80"}}); s.get(f"{BASE}/axon/app-info?device_key=dev-user")
print("3) avvisi con doc vecchio residuo (stesso telefono reinstallato):", open_alerts())
c.axon_client_versions.delete_many({"user_id":uid,"device_key":{"$in":["dev-user","dev-user-2","dev-fleet"]}}); c.axon_proactive_log.delete_many({"user_id":uid,"type":"app_update"})
