"""tests/core_guards — tag 2026-10-19 (blocchi) — BLOCCHI per licenza: catalogo in codice, stato per organizzazione (org_blocks),
switch SOLO SuperMaster, menu dinamico (solo abilitati), pagina /blocchi/<key>, Axon informato dei blocchi attivi."""
import os
import re

HERE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ROOT = os.path.dirname(HERE)


def _src(rel):
    return open(os.path.join(ROOT, rel), encoding="utf-8").read()


def _catalog():
    s = _src("backend/routes/axon_blocks.py")
    seg = s[s.index("BLOCKS_CATALOG: List[Dict[str, Any]] = ["):s.index("_BLOCK_KEYS")]
    ns = {"List": list, "Dict": dict, "Any": object}
    exec(seg, ns)
    return ns["BLOCKS_CATALOG"]


def test_catalog_initial_blocks_and_children():
    cat = _catalog()
    keys = [b["key"] for b in cat]
    assert keys == ["energia", "efficientamento", "ristorante"]
    energia = cat[0]
    assert [c["label"] for c in energia["children"]] == ["ANT", "Fotovoltaico"]
    assert all({"key", "label", "icon", "color", "description", "children"} <= set(b) for b in cat), "schema estendibile: ogni blocco ha gli stessi campi"
    assert len({c["key"] for b in cat for c in b["children"]} | set(keys)) == 5, "chiavi univoche"


def test_endpoints_and_super_master_only():
    s = _src("backend/routes/axon_blocks.py")
    assert '@api_router.get("/blocks")' in s and "Depends(get_current_user)" in s
    assert '@api_router.get("/admin/blocks")' in s and '@api_router.put("/admin/blocks/{tid}/{key}")' in s
    admin = s[s.index('@api_router.get("/admin/blocks")'):]
    assert admin.count("Depends(require_super_admin)") == 2, "gli switch sono SOLO del SuperMaster"
    assert "db.org_blocks.update_one" in s and "upsert=True" in s and '"$addToSet"' in s and '"$pull"' in s
    assert "blocks_enabled_for_tenant(tenant_id(user))" in s
    assert "_blocks_prev_nav_intercept = _nav_intercept" in s and "non è incluso nella tua licenza" in s, "«apri Fotovoltaico» deterministico + messaggio licenza"
    assert "_blocks_prev_prepare_prompt = _prepare_assistant_prompt" in s and 'not prep.get("listino_lock")' in s, "Axon informato, ma il lucchetto listino resta intatto"
    init = _src("backend/routes/__init__.py")
    assert init.index('"axon_blocks.py"') > init.index('"axon_honesty_rule.py"') and init.index('"axon_blocks.py"') < init.index('"37_app_startup_scheduler.py"')
    g = _src("backend/routes/axon_nav_guard.py")
    assert '"/blocchi/", "/admin/blocks/",' in g and '"/admin/blocks",' in g


def test_frontend_menu_shows_only_enabled_blocks():
    mc = _src("frontend/src/menuCategories.ts")
    assert 'blocks: { key: "blocks", label: "BLOCCHI"' in mc and '| "blocks"' in mc
    hook = _src("frontend/src/useBlocks.ts")
    assert 'api<{ items: Block[] }>("/blocks")' in hook and "items.filter((b) => b.enabled)" in hook
    assert "for (const c of b.children || [])" in hook, "sottovoci (ANT, Fotovoltaico) nel menu"
    for rel in ("frontend/src/DrawerMenu.tsx", "frontend/src/DesktopSidebar.tsx"):
        s = _src(rel)
        assert "useBlocks()" in s and 'cat.key === "blocks" ? (blockMenuItems(enabledBlocks)' in s, rel
    nav = _src("frontend/src/navRoutes.ts")
    assert '"/admin/blocks",' in nav and 'DYNAMIC_PREFIXES = ["/blocchi/",' in nav
    assert os.path.exists(os.path.join(ROOT, "frontend/app/blocchi/[key].tsx")) and os.path.exists(os.path.join(ROOT, "frontend/app/admin/blocks.tsx"))
    master = _src("frontend/app/master.tsx")
    assert re.search(r'label: "Blocchi per licenza".*onGoto\("/admin/blocks"\).*superAdminOnly: true', master)
    adm = _src("frontend/app/admin/blocks.tsx")
    assert "<Switch" in adm and "/admin/blocks/${org.tenant_id}/${key}" in adm
    page = _src("frontend/app/blocchi/[key].tsx")
    assert "Blocco non incluso nella tua licenza" in page and 'testID="block-children"' in page


def test_manual_updated():
    m = _src("backend/routes/axon_manual_data.py")
    assert "BLOCCHI — moduli attivabili per licenza" in m and "Blocchi per licenza (SuperMaster)" in m
