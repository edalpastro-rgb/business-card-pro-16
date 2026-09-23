"""V50.z343 — AXON LAB backend tests.

Copre: login, /lab/access, /lab/training checklist (12 doc), upload manuale iban,
upload timbro (Gemini vision) con derivazione phone/email, delegates, extra,
sources, moduli PDF (Gemini detection), pratiche, fill, sign, PDF, archive,
delete.
"""
import base64
import io
import os
import time

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
EMAIL = "test@dalpastro.it"
PASSWORD = "Test1234!"


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    tok = r.json()["token"]
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


def _stamp_jpeg_b64() -> str:
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("RGB", (900, 400), "white")
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 40)
    except Exception:
        font = ImageFont.load_default()
    lines = [
        "ACME ENERGIA SRL",
        "Via Roma 10 - 35100 Padova (PD)",
        "P.IVA 01234567890",
        "Tel. 049 1234567 - Cell. 333 1234567",
        "info@acme.it - PEC acme@pec.it",
    ]
    y = 20
    for L in lines:
        d.text((30, y), L, fill="black", font=font)
        y += 65
    d.rectangle([(5, 5), (895, 395)], outline="black", width=6)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return base64.b64encode(buf.getvalue()).decode()


def _module_pdf_b64() -> str:
    import pymupdf
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    labels = [
        ("Ragione sociale:", 60), ("Partita IVA:", 110), ("IBAN:", 160),
        ("Telefono:", 210), ("Email:", 260), ("POD:", 310),
        ("Data:", 360), ("Luogo:", 410), ("Timbro e firma:", 480),
    ]
    for lbl, y in labels:
        page.insert_text((50, y), lbl, fontsize=12)
        page.draw_line((180, y + 2), (540, y + 2), width=0.5)
    if hasattr(page, "draw_rect"):
        page.draw_rect(pymupdf.Rect(180, 465, 540, 560))
    raw = doc.tobytes()
    doc.close()
    return base64.b64encode(raw).decode()


# ---------- tests ----------

def test_login_returns_token(session):
    assert session.headers.get("Authorization")


def test_lab_access(session):
    r = session.get(f"{API}/lab/access", timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["is_master"] is True
    assert j["can_train"] is True
    docs = j["docs"]
    expected = ["id_card", "visura", "iban", "sdi", "stamp", "bill_electric",
                "bill_gas", "cte", "phone_company", "mobile_referent",
                "email_referent", "pec"]
    got = [d["id"] for d in docs]
    assert got == expected, got
    assert isinstance(j["key_labels"], dict) and "iban" in j["key_labels"]


def test_lab_training_get(session):
    r = session.get(f"{API}/lab/training", timeout=30)
    assert r.status_code == 200
    j = r.json()
    assert set(j["docs"].keys()) == {
        "id_card", "visura", "iban", "sdi", "stamp", "bill_electric",
        "bill_gas", "cte", "phone_company", "mobile_referent",
        "email_referent", "pec"}
    c = j["completion"]
    assert c["total"] == 12 and "percent" in c


def test_iban_upload_confirm_flow(session):
    body = {"manual": {"iban": "IT60 X054 2811 1010 0000 0123 456", "bank": "Banca Test"}}
    r = session.post(f"{API}/lab/training/docs/iban", json=body, timeout=60)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["extracted"]["iban"] == "IT60X0542811101000000123456"
    assert j["entry"]["status"] == "uploaded"

    # confirm
    r2 = session.put(f"{API}/lab/training/docs/iban",
                     json={"values": {"iban": "IT60X0542811101000000123456", "bank": "Banca Test"},
                           "status": "confirmed"}, timeout=60)
    assert r2.status_code == 200
    j2 = r2.json()
    assert j2["entry"]["status"] == "confirmed"
    assert j2["completion"]["confirmed"] >= 1

    # discard round-trip: verify status → 'none' then re-confirm to leave data
    r3 = session.put(f"{API}/lab/training/docs/iban", json={"values": {}, "status": "discarded"}, timeout=30)
    assert r3.status_code == 200
    assert r3.json()["entry"]["status"] == "none"

    # re-upload + confirm to leave IBAN in place
    session.post(f"{API}/lab/training/docs/iban", json=body, timeout=60)
    session.put(f"{API}/lab/training/docs/iban",
                json={"values": {"iban": "IT60X0542811101000000123456", "bank": "Banca Test"},
                      "status": "confirmed"}, timeout=60)


def test_manual_endpoint_validation(session):
    r = session.post(f"{API}/lab/training/docs/phone_company", json={}, timeout=30)
    assert r.status_code == 400, r.text
    r2 = session.post(f"{API}/lab/training/docs/inesistente", json={"manual": {"foo": "bar"}}, timeout=30)
    assert r2.status_code == 400


def test_extra_create_delete(session):
    r = session.post(f"{API}/lab/training/extra",
                     json={"label": "Codice agente", "value": "AG-77"}, timeout=30)
    assert r.status_code == 200
    extras = r.json()["extra"]
    xid = None
    for x in extras:
        if x["label"] == "Codice agente":
            xid = x["id"]
    assert xid
    r2 = session.delete(f"{API}/lab/training/extra/{xid}", timeout=30)
    assert r2.status_code == 200
    labels = [x["label"] for x in r2.json()["extra"]]
    assert "Codice agente" not in labels


def test_stamp_upload_with_llm(session):
    b64 = _stamp_jpeg_b64()
    body = {"name": "timbro.jpg", "mime": "image/jpeg", "data_base64": b64}
    r = session.post(f"{API}/lab/training/docs/stamp", json=body, timeout=180)
    assert r.status_code == 200, r.text
    j = r.json()
    ex = j.get("extracted") or {}
    # LLM may return partial; require at least one strong field
    found = any(k in ex for k in ("company_name", "phone", "mobile", "email", "vat_number"))
    assert found, f"stamp extraction empty: {ex}"

    # derived: phone_company should be uploaded if stamp has phone
    tr = session.get(f"{API}/lab/training", timeout=30).json()
    docs = tr["docs"]
    if ex.get("phone"):
        assert docs["phone_company"]["status"] in ("uploaded", "confirmed")
        assert docs["phone_company"].get("derived_from", "").startswith("stamp.")

    # confirm stamp with whatever LLM gave
    conf_values = {k: v for k, v in ex.items() if v}
    conf_values.setdefault("stamp_text", "ACME ENERGIA SRL")
    r2 = session.put(f"{API}/lab/training/docs/stamp",
                     json={"values": conf_values, "status": "confirmed"}, timeout=60)
    assert r2.status_code == 200
    assert r2.json()["entry"]["status"] == "confirmed"


def test_sources_lists_defaults_and_specials(session):
    r = session.get(f"{API}/lab/sources", timeout=30)
    assert r.status_code == 200
    ids = [s["id"] for s in r.json()["sources"]]
    for want in ("iban.iban", "stamp.company_name", "bill_electric.pod",
                 "manual", "empty", "sign_date", "sign_place", "stamp.image"):
        assert want in ids, f"missing source {want}"


# ---------- Module lifecycle ----------
@pytest.fixture(scope="module")
def module_id(session):
    body = {"name": "Modulo Test V50z343", "pdf_base64": _module_pdf_b64()}
    r = session.post(f"{API}/lab/modules", json=body, timeout=180)
    assert r.status_code == 200, r.text
    j = r.json()
    assert len(j.get("fields") or []) > 0
    assert isinstance(j.get("mapping"), dict) and len(j["mapping"]) > 0
    assert j.get("mapping_source") == "default"
    assert j.get("trained") is False
    assert j.get("sources")
    # verify some default rules
    fields = j["fields"]
    mapping = j["mapping"]
    for f in fields:
        k = f.get("key")
        rule = mapping.get(f["id"])
        if k == "date_today":
            assert rule == "sign_date"
        elif k == "place_today":
            assert rule == "sign_place"
        elif k == "iban":
            assert rule == "iban.iban"
    return j["template_id"]


def test_modules_list(session, module_id):
    r = session.get(f"{API}/lab/modules", timeout=30)
    assert r.status_code == 200
    items = r.json()["items"]
    match = [t for t in items if t["template_id"] == module_id]
    assert match and "mapping_count" in match[0]


def test_module_get_and_mapping_update(session, module_id):
    r = session.get(f"{API}/lab/modules/{module_id}", timeout=30)
    assert r.status_code == 200
    j = r.json()
    mapping = dict(j["mapping"])
    # inject an invalid rule for a random field
    if mapping:
        first = next(iter(mapping))
        mapping[first] = mapping[first]  # keep valid one
    # add invalid entry that must be ignored (unknown field id + bad source)
    mapping["invalid_field_xyz"] = "foo.bar"
    r2 = session.put(f"{API}/lab/modules/{module_id}/mapping",
                     json={"mapping": mapping, "trained": True}, timeout=30)
    assert r2.status_code == 200
    j2 = r2.json()
    assert j2["trained"] is True
    assert "invalid_field_xyz" not in (j2.get("mapping") or {})


def test_form_template_page_preview(session, module_id):
    r = session.get(f"{API}/form-templates/{module_id}/page/0", timeout=60)
    assert r.status_code == 200
    j = r.json()
    du = j.get("data_url") or j.get("dataUrl") or ""
    assert du.startswith("data:image/"), f"unexpected: {list(j.keys())}"


# ---------- Practice lifecycle ----------
@pytest.fixture(scope="module")
def contact_id(session):
    r = session.get(f"{API}/contacts", timeout=30)
    assert r.status_code == 200
    items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    assert items, "no contacts available"
    return items[0]["contact_id"]


@pytest.fixture(scope="module")
def practice_id(session, contact_id):
    r = session.post(f"{API}/lab/practices", json={"contact_id": contact_id}, timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["status"] == "docs"
    return j["practice_id"]


def test_practice_get(session, practice_id):
    r = session.get(f"{API}/lab/practices/{practice_id}", timeout=30)
    assert r.status_code == 200
    j = r.json()
    assert "docs" in j and isinstance(j.get("forms"), list)
    assert isinstance(j.get("modules"), list)


def test_practice_docs_and_fill(session, practice_id, module_id):
    # upload iban
    r = session.post(f"{API}/lab/practices/{practice_id}/docs/iban",
                     json={"manual": {"iban": "IT00A0000000000000000000000"}}, timeout=60)
    assert r.status_code == 200
    session.put(f"{API}/lab/practices/{practice_id}/docs/iban",
                json={"values": {"iban": "IT00A0000000000000000000000"}, "status": "confirmed"}, timeout=30)

    # stamp
    b64 = _stamp_jpeg_b64()
    r = session.post(f"{API}/lab/practices/{practice_id}/docs/stamp",
                     json={"name": "timbro.jpg", "mime": "image/jpeg", "data_base64": b64}, timeout=180)
    assert r.status_code == 200
    ex = r.json().get("extracted") or {}
    conf = {k: v for k, v in ex.items() if v}
    conf.setdefault("stamp_text", "ACME ENERGIA SRL")
    session.put(f"{API}/lab/practices/{practice_id}/docs/stamp",
                json={"values": conf, "status": "confirmed"}, timeout=30)

    # fill
    r = session.post(f"{API}/lab/practices/{practice_id}/fill",
                     json={"template_ids": [module_id]}, timeout=180)
    assert r.status_code == 200, r.text
    forms = r.json()["forms"]
    assert forms
    f0 = forms[0]
    assert "values" in f0 and "rules" in f0
    # sign_date/place fields must be EMPTY (not auto-filled)
    for fid, rule in f0["rules"].items():
        if rule in ("sign_date", "sign_place"):
            assert not f0["values"].get(fid), f"auto-filled {rule}"
    # store form_id for downstream tests
    pytest.form_id = f0["form_id"]


def test_practice_sign_and_pdf(session, practice_id):
    # invalid date
    r_bad = session.put(f"{API}/lab/practices/{practice_id}/sign",
                        json={"sign_date": "abc"}, timeout=30)
    assert r_bad.status_code == 400

    r = session.put(f"{API}/lab/practices/{practice_id}/sign",
                    json={"sign_date": "23/09/2026", "sign_place": "Padova"}, timeout=30)
    assert r.status_code == 200
    j = r.json()
    assert j["sign_date"] == "2026-09-23"
    assert j["forms_updated"] >= 1

    fid = getattr(pytest, "form_id", None)
    assert fid, "form_id missing from previous test"
    rf = session.get(f"{API}/filled-forms/{fid}", timeout=30)
    assert rf.status_code == 200
    ff = rf.json()
    values = ff.get("values") or {}
    rules = ff.get("rules") or {}
    date_set = place_set = False
    for f_id, rule in rules.items():
        if rule == "sign_date" and values.get(f_id) == "23/09/2026":
            date_set = True
        if rule == "sign_place" and values.get(f_id) == "Padova":
            place_set = True
    assert date_set, "sign_date not propagated"
    assert place_set, "sign_place not propagated"

    # PDF
    rp = session.get(f"{API}/filled-forms/{fid}/pdf", timeout=120)
    assert rp.status_code == 200
    b64 = rp.json().get("data_base64") or rp.json().get("pdf_base64") or ""
    assert b64
    raw = base64.b64decode(b64)
    import pymupdf
    doc = pymupdf.open(stream=raw, filetype="pdf")
    text = "\n".join(p.get_text() for p in doc)
    doc.close()
    assert "23/09/2026" in text or "23-09-2026" in text
    assert "Padova" in text


def test_filled_form_manual_edit(session):
    fid = getattr(pytest, "form_id", None)
    r = session.get(f"{API}/filled-forms/{fid}", timeout=30)
    values = dict(r.json().get("values") or {})
    if not values:
        pytest.skip("no values to edit")
    first = next(iter(values))
    r2 = session.put(f"{API}/filled-forms/{fid}",
                     json={"values": {**values, first: "NUOVO"}}, timeout=30)
    assert r2.status_code == 200
    r3 = session.get(f"{API}/filled-forms/{fid}", timeout=30)
    assert (r3.json().get("values") or {}).get(first) == "NUOVO"


def test_archive_and_cleanup(session, practice_id, module_id):
    r = session.post(f"{API}/lab/practices/{practice_id}/archive", timeout=120)
    assert r.status_code == 200
    saved = r.json().get("saved") or []
    assert len(saved) >= 1
    file_id = saved[0]["file_id"]
    # verify appears in master-files
    rmf = session.get(f"{API}/master-files?category=files", timeout=30)
    assert rmf.status_code == 200
    body = rmf.json()
    items = body if isinstance(body, list) else body.get("items", [])
    found = [f for f in items if f.get("file_id") == file_id]
    assert found, "archived file not found in master-files"
    assert found[0].get("source") == "axon_lab"

    # cleanup practice + module
    rd = session.delete(f"{API}/lab/practices/{practice_id}", timeout=30)
    assert rd.status_code == 200
    rm = session.delete(f"{API}/lab/modules/{module_id}", timeout=30)
    assert rm.status_code == 200


def test_delegates_endpoints(session):
    r = session.get(f"{API}/lab/delegates", timeout=30)
    assert r.status_code == 200
    j = r.json()
    assert "members" in j and "delegates" in j


def test_regression_form_templates_and_crt(session):
    r1 = session.get(f"{API}/form-templates", timeout=30)
    assert r1.status_code == 200
    r2 = session.get(f"{API}/crt", timeout=30)
    assert r2.status_code == 200
