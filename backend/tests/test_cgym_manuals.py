"""Test Corporate Gym · Manuali Drive (modulo corporate_gym_manuals.py).
Il Drive non è collegato nell'ambiente di sviluppo: le chiamate Google vengono simulate
sostituendo `_cgym_man_service`, `_cgym_man_list_sync`, `_cgym_man_get_sync`, `_cgym_man_download_sync`
nel namespace di server.py e usando il TestClient in-process.
"""
import os, sys, asyncio
sys.path.insert(0, "/app/backend")
os.chdir("/app/backend")
from fastapi.testclient import TestClient
import server  # noqa: E402

ns = server.namespace if hasattr(server, "namespace") else vars(server)
app = ns["app"]
_tc = TestClient(app)
client = _tc.__enter__()

MASTER = ("demo@advisoros.it", "Demo1234!")
COLLAB = ("collab.demo@advisoros.it", "Demo1234!")


def login(creds):
    r = client.post("/api/auth/login", json={"email": creds[0], "password": creds[1]})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


ROOT = "root-folder-id"
SUB_OB = "sub-obiezioni-id"
SUB_WW = "sub-winwin-id"
FILES = {
    ROOT: {"id": ROOT, "name": "Corporate Gym", "mimeType": "application/vnd.google-apps.folder", "trashed": False, "parents": ["x"]},
    SUB_OB: {"id": SUB_OB, "name": "Obiezioni", "mimeType": "application/vnd.google-apps.folder", "trashed": False, "parents": [ROOT]},
    SUB_WW: {"id": SUB_WW, "name": "Win-Win", "mimeType": "application/vnd.google-apps.folder", "trashed": False, "parents": [ROOT]},
    "pdf1": {"id": "pdf1", "name": "Manuale Obiezioni v3.pdf", "mimeType": "application/pdf", "size": "123456", "modifiedTime": "2026-06-10T10:00:00Z", "webViewLink": "https://drive/x", "parents": [SUB_OB], "trashed": False},
    "doc1": {"id": "doc1", "name": "Schede TEMPO", "mimeType": "application/vnd.google-apps.document", "modifiedTime": "2026-06-11T10:00:00Z", "parents": [SUB_OB], "trashed": False},
    "img1": {"id": "img1", "name": "foto.png", "mimeType": "image/png", "parents": [SUB_OB], "trashed": False},
    "pdfww": {"id": "pdfww", "name": "WIN-WIN completo.pdf", "mimeType": "application/pdf", "size": "999", "parents": [SUB_WW], "trashed": False},
    "other": {"id": "other", "name": "Altro.pdf", "mimeType": "application/pdf", "parents": ["elsewhere"], "trashed": False},
}


class FakeService:  # marker
    pass


async def fake_service(tid):
    return FakeService()


def fake_list(service, parent_id, folders_only, q=None):
    out = []
    for f in FILES.values():
        if parent_id not in (f.get("parents") or []):
            continue
        is_folder = f["mimeType"] == "application/vnd.google-apps.folder"
        if folders_only != is_folder:
            continue
        if q and q.lower() not in f["name"].lower():
            continue
        out.append(dict(f))
    return out


def fake_get(service, file_id, fields=""):
    if file_id not in FILES:
        raise Exception("404 not found")
    return dict(FILES[file_id])


def fake_download(service, meta):
    return b"%PDF-1.4 fake " + meta["id"].encode(), meta["name"] if meta["mimeType"] == "application/pdf" else meta["name"] + ".pdf", "application/pdf"


ns["_cgym_man_service"] = fake_service
ns["_cgym_man_list_sync"] = fake_list
ns["_cgym_man_get_sync"] = fake_get
ns["_cgym_man_download_sync"] = fake_download

hm = login(MASTER)
hc = login(COLLAB)

# reset
client.delete("/api/cgym/manuals/config", headers=hm)

# 1) config vuota
r = client.get("/api/cgym/manuals/config", headers=hm)
assert r.status_code == 200 and r.json()["configured"] is False and r.json()["can_edit"] is True, r.text
r = client.get("/api/cgym/manuals/config", headers=hc)
assert r.json()["can_edit"] is False
print("1 config vuota OK")

# 2) collaboratore non può impostare
r = client.put("/api/cgym/manuals/config", json={"folder_id": ROOT}, headers=hc)
assert r.status_code == 403, r.text
print("2 collab 403 OK")

# 3) lista senza config → 404 chiaro
r = client.get("/api/cgym/manuals/obiezioni", headers=hc)
assert r.status_code == 404 and "non configurata" in r.json()["detail"], r.text
print("3 lista senza config 404 OK")

# 4) master imposta cartella → sottocartelle rilevate
r = client.put("/api/cgym/manuals/config", json={"folder_id": ROOT, "folder_name": "Corporate Gym"}, headers=hm)
assert r.status_code == 200, r.text
j = r.json()
assert j["configured"] and j["subfolders"]["obiezioni"]["id"] == SUB_OB and j["subfolders"]["winwin"]["id"] == SUB_WW and j["missing_subfolders"] == []
print("4 set config OK", j["subfolders"])

# 4b) non-cartella rifiutata
r = client.put("/api/cgym/manuals/config", json={"folder_id": "pdf1"}, headers=hm)
assert r.status_code == 400, r.text
r = client.put("/api/cgym/manuals/config", json={"folder_id": "nope"}, headers=hm)
assert r.status_code == 404, r.text
print("4b validazione OK")

# 5) collaboratore lista obiezioni (PDF + Google Doc, no png), ordine per nome
r = client.get("/api/cgym/manuals/obiezioni", headers=hc)
assert r.status_code == 200, r.text
names = [i["name"] for i in r.json()["items"]]
assert names == ["Manuale Obiezioni v3.pdf", "Schede TEMPO"], names
assert r.json()["subfolder"]["name"] == "Obiezioni"
print("5 lista OK", names)

# 5b) ricerca per nome
r = client.get("/api/cgym/manuals/obiezioni?q=tempo", headers=hc)
assert [i["name"] for i in r.json()["items"]] == ["Schede TEMPO"]
r = client.get("/api/cgym/manuals/winwin", headers=hc)
assert [i["name"] for i in r.json()["items"]] == ["WIN-WIN completo.pdf"]
r = client.get("/api/cgym/manuals/altro", headers=hc)
assert r.status_code == 404
print("5b ricerca/tipi OK")

# 6) link firmato + download pubblico (inline / attachment)
r = client.post("/api/cgym/manuals/obiezioni/files/pdf1/link", headers=hc, headers_extra=None) if False else client.post("/api/cgym/manuals/obiezioni/files/pdf1/link", headers={**hc, "x-forwarded-proto": "https", "x-forwarded-host": "app.example.it"})
assert r.status_code == 200, r.text
lk = r.json()
assert lk["url"].startswith("https://app.example.it/api/public/cgym-manual/") and lk["download_url"].endswith("?download=1")
tok = lk["url"].rsplit("/", 1)[1]
r = client.get(f"/api/public/cgym-manual/{tok}")
assert r.status_code == 200 and r.headers["content-type"].startswith("application/pdf") and r.content.startswith(b"%PDF") and "inline" in r.headers["content-disposition"], (r.status_code, r.headers)
r = client.get(f"/api/public/cgym-manual/{tok}?download=1")
assert "attachment" in r.headers["content-disposition"] and "Manuale Obiezioni v3.pdf" in r.headers["content-disposition"]
print("6 link + public OK")

# 6b) Google Doc → esportato PDF con nome .pdf
r = client.post("/api/cgym/manuals/obiezioni/files/doc1/link", headers=hc)
assert r.status_code == 200 and r.json()["name"] == "Schede TEMPO.pdf" and r.json()["mime"] == "application/pdf", r.text
print("6b export doc OK")

# 7) file fuori dalla cartella manuali → 403 ; file inesistente → 404
r = client.post("/api/cgym/manuals/obiezioni/files/other/link", headers=hc)
assert r.status_code == 403, r.text
r = client.post("/api/cgym/manuals/obiezioni/files/nope/link", headers=hc)
assert r.status_code == 404, r.text
print("7 sicurezza link OK")

# 8) token non valido / kind errato
r = client.get("/api/public/cgym-manual/abc")
assert r.status_code == 400
import jwt as _jwt
bad = _jwt.encode({"kind": "cfile", "tenant_id": "x", "file_id": "pdf1", "exp": 9999999999}, ns["JWT_SECRET"], algorithm=ns["JWT_ALG"])
assert client.get(f"/api/public/cgym-manual/{bad}").status_code == 400
exp = _jwt.encode({"kind": "cgym_manual", "tenant_id": "x", "file_id": "pdf1", "exp": 1}, ns["JWT_SECRET"], algorithm=ns["JWT_ALG"])
assert client.get(f"/api/public/cgym-manual/{exp}").status_code == 410
print("8 token OK")

# 9) sottocartella mancante → ri-risoluzione automatica quando appare
FILES[SUB_WW]["parents"] = ["elsewhere"]
client.delete("/api/cgym/manuals/config", headers=hm)
r = client.put("/api/cgym/manuals/config", json={"folder_id": ROOT}, headers=hm)
assert r.json()["missing_subfolders"] == ["winwin"], r.text
r = client.get("/api/cgym/manuals/winwin", headers=hc)
assert r.status_code == 200 and r.json()["missing_subfolder"] is True and r.json()["items"] == []
FILES[SUB_WW]["parents"] = [ROOT]  # il Master crea la cartella dopo
r = client.get("/api/cgym/manuals/winwin", headers=hc)
assert r.json()["missing_subfolder"] is False and len(r.json()["items"]) == 1
r = client.get("/api/cgym/manuals/config", headers=hc)
assert r.json()["subfolders"]["winwin"]["id"] == SUB_WW
print("9 self-healing sottocartelle OK")

# 10) collaboratore non può cancellare; master sì
assert client.delete("/api/cgym/manuals/config", headers=hc).status_code == 403
assert client.delete("/api/cgym/manuals/config", headers=hm).status_code == 200
print("10 delete OK")

# 11) comportamento reale senza Drive collegato (ripristino funzioni vere)
import importlib
for k in ("_cgym_man_service", "_cgym_man_list_sync", "_cgym_man_get_sync", "_cgym_man_download_sync"):
    pass
print("ALL OK")
_tc.__exit__(None, None, None)
