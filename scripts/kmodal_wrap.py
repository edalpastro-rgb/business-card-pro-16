"""V50.z397 — Avvolge in <KModalBody> ogni <Modal> che contiene (direttamente, non nelle Modal annidate) un <TextInput>
e non ha già una protezione tastiera (KeyboardAvoidingView / KModalBody / kbHeight / AndroidKeyboardPadding).
Uso: python3 kmodal_wrap.py [--apply] file1.tsx file2.tsx ...
"""
import re
import sys

IMPORT = 'import { KModalBody } from "@/src/ui/keyboard"; // V50.z397 — tastiera: campo attivo sempre visibile nelle Modal'
GUARD = re.compile(r"KModalBody|KeyboardAvoidingView|kbHeight|useKeyboardHeight|AndroidKeyboardPadding|KeyboardStickyView")
OPEN = re.compile(r"<Modal(?=[\s>])")


def tag_end(src: str, start: int) -> int:
    """Indice dopo il '>' che chiude il tag di apertura in `start`; -1 se self-closing. Gestisce {…}, stringhe, =>."""
    i, depth, n = start, 0, len(src)
    while i < n:
        c = src[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        elif c in "\"'`":
            j = i + 1
            while j < n and src[j] != c:
                j += 2 if src[j] == "\\" else 1
            i = j
        elif depth == 0 and c == "/" and i + 1 < n and src[i + 1] == ">":
            return -1
        elif depth == 0 and c == ">" and src[i - 1] != "=":
            return i + 1
        i += 1
    return -1


def find_modals(src: str, start: int, stop: int):
    """Lista di (open_start, open_end, close_start) per le Modal di primo livello in [start, stop)."""
    res, pos = [], start
    while True:
        m = OPEN.search(src, pos, stop)
        if not m:
            return res
        oe = tag_end(src, m.start())
        if oe < 0:
            pos = m.end()
            continue
        # chiusura corrispondente con conteggio annidamento
        depth, i = 1, oe
        while depth and i < stop:
            nm = OPEN.search(src, i, stop)
            nc = src.find("</Modal>", i, stop)
            if nc < 0:
                return res
            if nm and nm.start() < nc and tag_end(src, nm.start()) > 0:
                depth += 1
                i = tag_end(src, nm.start())
            elif nm and nm.start() < nc:
                i = nm.end()
            else:
                depth -= 1
                i = nc + 8
        close = i - 8
        res.append((m.start(), oe, close))
        pos = close + 8


def collect(src: str, start: int, stop: int, acc: list):
    for (os_, oe, cl) in find_modals(src, start, stop):
        inner = find_modals(src, oe, cl)
        own = src[oe:cl]
        for (ios, ioe, icl) in inner:  # tolgo le modali annidate dal corpo proprio
            own = own.replace(src[ios:icl + 8], " ")
        if "<TextInput" in own and not GUARD.search(own):
            acc.append((oe, cl))
        collect(src, oe, cl, acc)


def process(path: str, apply: bool) -> int:
    src = open(path, encoding="utf-8").read()
    spots: list = []
    collect(src, 0, len(src), spots)
    if not spots:
        print(f"{path}: 0")
        return 0
    out = src
    for (oe, cl) in sorted(spots, key=lambda t: -t[0]):  # dal fondo, così gli indici restano validi
        out = out[:oe] + "<KModalBody>" + out[oe:cl] + "</KModalBody>" + out[cl:]
    if "KModalBody" not in src:
        lines = out.split("\n")
        last = max(i for i, l in enumerate(lines) if l.startswith("import ") or l.startswith("} from "))
        lines.insert(last + 1, IMPORT)
        out = "\n".join(lines)
    if apply:
        open(path, "w", encoding="utf-8").write(out)
    print(f"{path}: {len(spots)}")
    return len(spots)


if __name__ == "__main__":
    apply = "--apply" in sys.argv
    files = [a for a in sys.argv[1:] if not a.startswith("--")]
    print("TOTAL", sum(process(f, apply) for f in files))
