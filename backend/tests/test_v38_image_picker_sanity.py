"""Backend sanity checks after web-image-picker fix (frontend-only change).
Verifies core endpoints impacted by user's testing scope still work."""
import os
import pytest
import requests

BASE_URL = (os.environ.get('EXPO_BACKEND_URL') or 'https://business-card-pro-16.preview.emergentagent.com').rstrip('/')
OWNER_EMAIL = 'test@dalpastro.it'
OWNER_PASSWORD = 'Test1234!'


@pytest.fixture(scope='module')
def token():
    r = requests.post(f'{BASE_URL}/api/auth/login',
                      json={'email': OWNER_EMAIL, 'password': OWNER_PASSWORD}, timeout=30)
    assert r.status_code == 200, f'login failed: {r.status_code} {r.text[:200]}'
    data = r.json()
    assert 'token' in data
    return data['token']


@pytest.fixture(scope='module')
def headers(token):
    return {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}


# -- Auth --

def test_login_ok(token):
    assert token


def test_auth_me(headers):
    r = requests.get(f'{BASE_URL}/api/auth/me', headers=headers, timeout=15)
    assert r.status_code == 200
    body = r.json()
    # /auth/me may return either flat or wrapped { user: {...} }
    email = body.get('email') or (body.get('user') or {}).get('email')
    assert email == OWNER_EMAIL


# -- Contacts --

def test_contacts_list(headers):
    r = requests.get(f'{BASE_URL}/api/contacts', headers=headers, timeout=20)
    assert r.status_code == 200
    data = r.json()
    items = data if isinstance(data, list) else data.get('items')
    assert isinstance(items, list)


# -- Business Card (master) --

def test_business_card_get(headers):
    r = requests.get(f'{BASE_URL}/api/master/business-card', headers=headers, timeout=15)
    # OK if returns 200 with data or 404 if not created yet
    assert r.status_code in (200, 404), f'unexpected: {r.status_code} {r.text[:200]}'


def test_business_card_upsert_and_get(headers):
    # tiny 1x1 png data URL
    tiny_png = ('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAI'
                'AAAUAAeImBZsAAAAASUVORK5CYII=')
    payload = {
        'display_name': 'TEST Dal Pastro',
        'title': 'Consulente',
        'company': 'TEST Co',
        'phone': '+390000000',
        'email': OWNER_EMAIL,
        'logo_base64': tiny_png,
        'logo_mime': 'image/png',
    }
    r = requests.put(f'{BASE_URL}/api/master/business-card', headers=headers,
                     json=payload, timeout=30)
    assert r.status_code in (200, 201), f'upsert failed: {r.status_code} {r.text[:300]}'
    got = requests.get(f'{BASE_URL}/api/master/business-card', headers=headers, timeout=15)
    assert got.status_code == 200
    body = got.json()
    assert body.get('display_name') == 'TEST Dal Pastro'
    # logo should have been persisted (either as base64 or via data URL somewhere)
    assert body.get('logo_base64') or body.get('logo_url') or body.get('logo_mime')
