# V50.z505 — Home layout personalizzabile (Super Master)
import os, pytest, requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

def _login(email, pwd):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]

@pytest.fixture(scope="module")
def super_token():
    return _login("test@dalpastro.it", "Test1234!")

@pytest.fixture(scope="module")
def demo_token():
    return _login("demo@advisoros.it", "Demo1234!")

def H(t): return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}

EXPECTED_IDS = {"master","pun","callbacks","appointments","calendar","stats","deadlines","company","beta"}

# GET layout: super master allowed=true
def test_get_super(super_token):
    r = requests.get(f"{API}/home/layout", headers=H(super_token), timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j["allowed"] is True
    ids = {b["id"] for b in j["blocks"]}
    assert ids == EXPECTED_IDS, f"missing/extra ids: {ids}"
    for b in j["blocks"]:
        assert b["pos"] in ("left","right","full")
        assert isinstance(b["visible"], bool)
        assert isinstance(b["order"], int)

# GET layout: demo allowed=false
def test_get_demo(demo_token):
    r = requests.get(f"{API}/home/layout", headers=H(demo_token), timeout=15)
    assert r.status_code == 200
    assert r.json()["allowed"] is False

# PUT as super: save order, visible, pos; GET consistent
def test_put_super_persists(super_token):
    body = {"blocks":[
        {"id":"deadlines","visible":True,"pos":"full"},
        {"id":"calendar","visible":True,"pos":"left"},
        {"id":"stats","visible":False,"pos":"full"},
        {"id":"unknown_x","visible":True,"pos":"full"},  # ignored
    ]}
    r = requests.put(f"{API}/home/layout", json=body, headers=H(super_token), timeout=15)
    assert r.status_code == 200, r.text
    g = requests.get(f"{API}/home/layout", headers=H(super_token), timeout=15).json()
    blocks = g["blocks"]
    assert g["customized"] is True
    # Order of first 3 preserved as saved
    assert blocks[0]["id"] == "deadlines"
    assert blocks[1]["id"] == "calendar" and blocks[1]["pos"] == "left"
    assert blocks[2]["id"] == "stats" and blocks[2]["visible"] is False
    # Missing blocks appended with defaults
    appended_ids = {b["id"] for b in blocks[3:]}
    assert appended_ids == EXPECTED_IDS - {"deadlines","calendar","stats"}
    # unknown ignored
    assert all(b["id"] in EXPECTED_IDS for b in blocks)

# PUT invalid pos → 400
def test_put_invalid_pos(super_token):
    r = requests.put(f"{API}/home/layout",
                     json={"blocks":[{"id":"calendar","visible":True,"pos":"middle"}]},
                     headers=H(super_token), timeout=15)
    assert r.status_code == 400

# PUT as demo → 403
def test_put_demo_forbidden(demo_token):
    r = requests.put(f"{API}/home/layout",
                     json={"blocks":[{"id":"calendar","visible":True,"pos":"full"}]},
                     headers=H(demo_token), timeout=15)
    assert r.status_code == 403

# DELETE as demo → 403
def test_delete_demo_forbidden(demo_token):
    r = requests.delete(f"{API}/home/layout", headers=H(demo_token), timeout=15)
    assert r.status_code == 403

# DELETE as super → ripristino default (run last to clean up)
def test_delete_super_resets(super_token):
    r = requests.delete(f"{API}/home/layout", headers=H(super_token), timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j["customized"] is False
    g = requests.get(f"{API}/home/layout", headers=H(super_token), timeout=15).json()
    assert g["customized"] is False
    # default order: master, pun, callbacks, appointments, calendar, stats, deadlines, company, beta
    default_order = ["master","pun","callbacks","appointments","calendar","stats","deadlines","company","beta"]
    assert [b["id"] for b in g["blocks"]] == default_order
    # default pos: callbacks=left, appointments=right, others=full
    pos_map = {b["id"]: b["pos"] for b in g["blocks"]}
    assert pos_map["callbacks"] == "left"
    assert pos_map["appointments"] == "right"
    assert pos_map["master"] == "full"
