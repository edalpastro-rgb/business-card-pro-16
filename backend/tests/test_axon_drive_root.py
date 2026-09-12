"""V50.z201 — test Drive ROOT files (routes/axon_drive_root.py) con servizio Drive simulato. Uso: python tests/test_axon_drive_root.py"""
import asyncio, os, sys, io
os.chdir('/app/backend'); sys.path.insert(0, '/app/backend')
from dotenv import load_dotenv; load_dotenv('/app/backend/.env')
import server  # namespace condiviso (tutti i moduli)


def check(c, label):
    print(("✅" if c else "❌"), label); return bool(c)


class _Exec:
    def __init__(self, v): self.v = v
    def execute(self): return self.v


class FakeFiles:
    """Struttura: 00_POWER(root) → [01_ANALISI/, 02_FATTURE/, Link Corporate Club Library.pdf (SHORTCUT→pdf9), MODELLO POWER.pdf]"""
    META = {
        "root": {"id": "root", "name": "00_POWER", "mimeType": "application/vnd.google-apps.folder"},
        "f1": {"id": "f1", "name": "01_ANALISI ENERGETICA", "mimeType": "application/vnd.google-apps.folder"},
        "f2": {"id": "f2", "name": "02_FATTURE BOOK", "mimeType": "application/vnd.google-apps.folder"},
        "sc1": {"id": "sc1", "name": "Link Corporate Club Library.pdf", "mimeType": "application/vnd.google-apps.shortcut", "shortcutDetails": {"targetId": "pdf9", "targetMimeType": "application/pdf"}},
        "pdf9": {"id": "pdf9", "name": "Corporate Club Library ORIG.pdf", "mimeType": "application/pdf", "size": "1000", "modifiedTime": "2026-01-01T00:00:00Z", "parents": ["altrove"]},
        "pdf1": {"id": "pdf1", "name": "MODELLO POWER_v.2026070.pdf", "mimeType": "application/pdf", "size": "2000", "modifiedTime": "2026-07-01T00:00:00Z", "parents": ["root"]},
        "pdf2": {"id": "pdf2", "name": "Analisi Rossi.pdf", "mimeType": "application/pdf", "size": "3000", "modifiedTime": "2026-08-01T00:00:00Z", "parents": ["f1"]},
        "pdf3": {"id": "pdf3", "name": "MODELLO POWER_v.2026070.pdf", "mimeType": "application/pdf", "size": "2000", "modifiedTime": "2026-07-02T00:00:00Z", "parents": ["f2"]},
    }
    CHILDREN = {"root": ["f1", "f2", "sc1", "pdf1"], "f1": ["pdf2"], "f2": ["pdf3"]}

    def list(self, q, **kw):
        fid = q.split("'")[1]
        return _Exec({"files": [dict(self.META[c]) for c in self.CHILDREN.get(fid, [])]})

    def get(self, fileId, **kw):
        return _Exec(dict(self.META[fileId]))


class FakeService:
    def files(self): return FakeFiles()


def main():
    ok = True
    import googleapiclient.discovery as gd
    real_build = gd.build
    gd.build = lambda *a, **k: FakeService()
    try:
        files, scanned = server._drive_walk_and_collect(None, [{"id": "root", "name": "00_POWER"}], [], 80, 6, 300)
    finally:
        gd.build = real_build
    names = [(f["name"], f["_folder_path"], f["_is_root"], bool(f.get("_shortcut"))) for f in files]
    print(names)
    ok &= check(scanned == 3 and len(files) == 4, f"walk: {scanned} cartelle, {len(files)} file")
    ok &= check(("Link Corporate Club Library.pdf", "00_POWER", True, True) in names, "shortcut nella root risolto al PDF target, nome dello shortcut, is_root=True")
    ok &= check(("MODELLO POWER_v.2026070.pdf", "00_POWER", True, False) in names and ("MODELLO POWER_v.2026070.pdf", "00_POWER/02_FATTURE BOOK", False, False) in names, "stesso nome in root e sottocartella: due file distinti (path diverso)")
    ok &= check(names[0][2] is True and names[1][2] is True, "i file root vengono raccolti PRIMA delle sottocartelle (mai tagliati dal max_files)")

    # OCR fallback: PDF senza testo (pagina bianca con disegno) → _extract_pdf_text_bytes vuoto → OCR Gemini
    import fitz
    doc = fitz.open(); page = doc.new_page()
    page.insert_text((72, 72), "CONTRATTO POWER 2026 — Cliente Rossi Mario — Prezzo 0,118 EUR/kWh", fontsize=14)
    pix = page.get_pixmap(dpi=120); img_pdf = fitz.open(); p2 = img_pdf.new_page(width=page.rect.width, height=page.rect.height)
    p2.insert_image(p2.rect, stream=pix.tobytes("png")); data = img_pdf.tobytes()
    ok &= check((server._extract_pdf_text_bytes(data) or "").strip() == "", "PDF scansionato: nessun layer testo (prima: indicizzato vuoto)")
    txt = server._adr_ocr_pdf_sync(data, "scan.pdf")
    ok &= check("Rossi" in txt and ("0,118" in txt or "118" in txt), f"OCR Gemini → {txt[:80]!r}")

    async def prompt_test():
        db = server.db; uid = "user_test_drive_root"
        await db.google_drive_folders.delete_many({"user_id": uid}); await db.drive_snapshots.delete_many({"user_id": uid})
        await db.google_drive_folders.insert_one({"user_id": uid, "folder_id": "root", "folder_name": "00_POWER"})
        await db.drive_snapshots.insert_many([
            {"user_id": uid, "file_id": "pdf1", "name": "MODELLO POWER_v.2026070.pdf", "folder_path": "00_POWER", "modified_time": "2020-01-01T00:00:00Z", "text": "Modello contratto POWER: prezzo fisso 12 mesi", "mime": "application/pdf"},
            {"user_id": uid, "file_id": "pdf9", "name": "Link Corporate Club Library.pdf", "folder_path": "00_POWER", "modified_time": "2020-01-02T00:00:00Z", "text": "", "mime": "application/pdf"},
        ] + [{"user_id": uid, "file_id": f"x{i}", "name": f"Analisi {i}.pdf", "folder_path": "00_POWER/01_ANALISI ENERGETICA", "modified_time": f"2026-08-{(i % 28) + 1:02d}T00:00:00Z", "text": "analisi", "mime": "application/pdf"} for i in range(45)])
        out = await server._fetch_teach_drive_pdfs_for_query(uid, "cosa dice il modello power?")
        print(out[:900])
        r = True
        r &= check("[ROOT FILES]" in out and "[ROOT] MODELLO POWER_v.2026070.pdf" in out and "[ROOT] Link Corporate Club Library.pdf" in out, "sezione [ROOT FILES] completa anche se i file root sono i più vecchi (fuori dai 40 recenti)")
        r &= check("nessun testo estraibile" in out, "file root senza testo segnalato")
        r &= check("File Drive [ROOT]: 00_POWER/MODELLO POWER" in out or "File Drive: 00_POWER/MODELLO POWER" in out, "testo del PDF root pertinente incluso nel contesto")
        await db.google_drive_folders.delete_many({"user_id": uid}); await db.drive_snapshots.delete_many({"user_id": uid})
        return r
    ok &= asyncio.run(prompt_test())
    print("\nRISULTATO:", "TUTTO OK" if ok else "CI SONO ERRORI")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
