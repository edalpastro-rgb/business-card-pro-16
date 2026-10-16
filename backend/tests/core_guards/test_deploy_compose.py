"""tests/core_guards — V50.z571 — TEST BLOCCANTI sul pacchetto di deploy (build_package.sh li esegue PRIMA di creare il .tgz).
Incidente V50.z570: nginx aveva `depends_on: [axon-core]` ma il servizio era stato rinominato axon-core-a/b → Docker rifiutava
l'intero progetto («service "nginx" depends on undefined service "axon-core"»). Qui si valida il compose e gli script SENZA docker."""
import os
import subprocess

import pytest
import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
DEPLOY = os.path.join(ROOT, "deploy", "axon-core")
COMPOSE = os.path.join(DEPLOY, "docker-compose.yml")
SCRIPTS = os.path.join(DEPLOY, "scripts")


def _compose():
    with open(COMPOSE, encoding="utf-8") as f:
        return yaml.safe_load(f)


def test_compose_depends_on_point_to_existing_services():
    services = _compose()["services"]
    for name, svc in services.items():
        deps = svc.get("depends_on") or {}
        deps = list(deps) if isinstance(deps, (list, dict)) else []
        for d in deps:
            assert d in services, f"servizio «{name}» dipende da «{d}» che NON esiste nel compose (servizi: {sorted(services)})"


def test_compose_blue_green_services_present():
    services = _compose()["services"]
    for required in ("axon-core-a", "axon-core-b", "nginx", "mongodb", "clamav"):
        assert required in services, f"servizio «{required}» mancante"
    assert "axon-core" not in services, "il servizio legacy «axon-core» non deve coesistere con axon-core-a/b"
    for color in ("a", "b"):
        svc = services[f"axon-core-{color}"]
        assert svc.get("container_name") == f"axon-core-{color}"
        assert svc.get("image") == f"axon-core:{color}"
        assert "8001" in [str(p) for p in svc.get("expose", [])]


def test_nginx_does_not_depend_on_a_specific_color():
    # In blue-green nginx deve partire indipendentemente dal colore attivo (un depends_on su entrambi li avvierebbe tutti e due).
    nginx = _compose()["services"]["nginx"]
    assert not nginx.get("depends_on"), "nginx non deve avere depends_on sul backend (blue-green)"


def test_upstream_conf_points_to_a_blue_green_color():
    path = os.path.join(DEPLOY, "nginx", "conf.d", "00-upstream.conf")
    with open(path, encoding="utf-8") as f:
        txt = f.read()
    assert "upstream axon_core" in txt
    assert "server axon-core-a:8001" in txt or "server axon-core-b:8001" in txt
    with open(os.path.join(DEPLOY, "nginx", "conf.d", "axon-core.conf"), encoding="utf-8") as f:
        assert "upstream axon_core {" not in f.read(), "upstream duplicato: deve stare SOLO in 00-upstream.conf"


@pytest.mark.parametrize("script", ["upgrade_vps.sh", "install_web_on_vps.sh", "build_package.sh", "build_web_package.sh"])
def test_shell_scripts_have_valid_syntax(script):
    res = subprocess.run(["bash", "-n", os.path.join(SCRIPTS, script)], capture_output=True, text=True)
    assert res.returncode == 0, f"{script}: {res.stderr}"


def test_upgrade_script_has_compose_precheck():
    with open(os.path.join(SCRIPTS, "upgrade_vps.sh"), encoding="utf-8") as f:
        txt = f.read()
    assert "docker compose config -q" in txt, "upgrade_vps.sh deve validare il compose prima del deploy blue-green"
    assert "SKIP_SMOKE_GATE" in txt and "non è più supportato" in txt
