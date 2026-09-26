"""Codemod V50.z374 — tastiera globale.
A) File con <TextInput> e <ScrollView> (react-native) senza KeyboardAvoidingView → <KScrollView> (KeyboardAwareScrollView).
B) File con <Modal> contenente <TextInput> e nessuna ScrollView/KAV dentro la Modal → figli avvolti in <KModalBody>.
C) File che usano KeyboardAvoidingView di react-native con behavior condizionale → import da react-native-keyboard-controller + behavior="padding".
Uso: python scripts/keyboard_codemod.py [--dry]
"""
import re, sys, subprocess, pathlib

ROOT = pathlib.Path("/app/frontend")
DRY = "--dry" in sys.argv
IMPORT_LINE = 'import { KScrollView, KModalBody } from "@/src/ui/keyboard"; // V50.z374 — tastiera: campo attivo sempre visibile\n'
SKIP = {"src/ui/keyboard.tsx"}


def files_with(pattern):
    out = subprocess.run(["grep", "-rlE", pattern, "app", "src", "--include=*.tsx"], cwd=ROOT, capture_output=True, text=True).stdout.split()
    return [f for f in out if f not in SKIP]


def tag_end(src, start):
    """indice del '>' che chiude il tag aperto a `start` (gestisce {} e => negli attributi)."""
    depth, i, n = 0, start, len(src)
    in_str = None
    while i < n:
        c = src[i]
        if in_str:
            if c == in_str and src[i - 1] != "\\":
                in_str = None
        elif c in "\"'`" and depth > 0:
            in_str = c
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        elif c == ">" and depth == 0 and src[i - 1] != "=":
            return i
        i += 1
    return -1


def matching_close(src, frm, tag):
    """indice di `</tag>` che chiude il tag aperto (gestisce annidamenti dello stesso tag)."""
    depth, pos = 1, frm
    rx = re.compile(r"<" + tag + r"\b|</" + tag + r">")
    while depth:
        m = rx.search(src, pos)
        if not m:
            return -1
        if m.group(0).startswith("</"):
            depth -= 1
            if depth == 0:
                return m.start()
            pos = m.end()
        else:
            e = tag_end(src, m.start())
            if e < 0:
                return -1
            if src[e - 1] != "/":
                depth += 1
            pos = e + 1
    return -1


def add_import(src):
    if 'from "@/src/ui/keyboard"' in src:
        return src
    m = re.search(r'^import [^\n]*from "react-native";\n', src, re.M)
    if not m:
        m = re.search(r'^import [^\n]*;\n', src, re.M)
    return src[:m.end()] + IMPORT_LINE + src[m.end():]


def strip_rn_import(src, name):
    """rimuove `name` dall'import di react-native se non è più usato nel file (oltre all'import)."""
    m = re.search(r'^import \{([^}]*)\} from "react-native";', src, re.M)
    if not m:
        return src
    body = src[:m.start()] + src[m.end():]
    if re.search(r"\b" + name + r"\b", body):
        return src
    names = [n.strip() for n in m.group(1).split(",") if n.strip() and n.strip() != name]
    return src[:m.start()] + "import { " + ", ".join(names) + ' } from "react-native";' + src[m.end():]


def convert_scrollviews(src):
    if not re.search(r"<ScrollView\b", src) or not re.search(r'^import \{[^}]*\bScrollView\b[^}]*\} from "react-native"', src, re.M):
        return src, 0
    n, pos = 0, 0
    while True:
        m = re.search(r"<ScrollView\b", src[pos:])
        if not m:
            break
        start = pos + m.start()
        end = tag_end(src, start)
        if end < 0:
            break
        attrs = src[start:end]
        if re.search(r"\bhorizontal\b", attrs):  # righe di chip orizzontali: restano ScrollView normali
            pos = end
            continue
        if src[end - 1] == "/":
            src = src[:start] + "<KScrollView" + src[start + len("<ScrollView"):]
            pos = end + 1
            n += 1
            continue
        close = matching_close(src, end, "ScrollView")
        if close < 0:
            break
        src = src[:start] + "<KScrollView" + src[start + len("<ScrollView"):close] + "</KScrollView>" + src[close + len("</ScrollView>"):]
        pos = close
        n += 1
    if not n:
        return src, 0
    src = add_import(src)
    src = strip_rn_import(src, "ScrollView")
    return src, n


def wrap_modals(src):
    count, pos = 0, 0
    while True:
        m = re.search(r"<Modal\b", src[pos:])
        if not m:
            break
        start = pos + m.start()
        end = tag_end(src, start)
        if end < 0 or src[end - 1] == "/":
            pos = start + 6
            continue
        close = src.find("</Modal>", end)
        if close < 0:
            break
        inner = src[end + 1:close]
        if "<TextInput" in inner and "KScrollView" not in inner and "<ScrollView" not in inner and "KeyboardAvoidingView" not in inner and "KModalBody" not in inner:
            src = src[:end + 1] + "<KModalBody>" + inner + "</KModalBody>" + src[close:]
            count += 1
            close += len("<KModalBody></KModalBody>")
        pos = close
    if count:
        src = add_import(src)
    return src, count


def fix_rn_kav(src):
    if not re.search(r'^import \{[^}]*\bKeyboardAvoidingView\b[^}]*\} from "react-native"', src, re.M):
        return src, 0
    src = re.sub(r'behavior=\{Platform\.OS === "ios" \? "padding" : (?:undefined|"height"|"padding")\}', 'behavior="padding"', src)
    m = re.search(r'^import \{([^}]*)\} from "react-native";', src, re.M)
    names = [n.strip() for n in m.group(1).split(",") if n.strip() and n.strip() != "KeyboardAvoidingView"]
    src = src[:m.start()] + "import { " + ", ".join(names) + ' } from "react-native";\n' + 'import { KeyboardAvoidingView } from "react-native-keyboard-controller"; // V50.z374 — behavior "padding" valido su iOS e Android' + src[m.end():]
    src = strip_rn_import(src, "Platform")
    return src, 1


def main():
    targets = set(files_with("<TextInput"))
    report = []
    for rel in sorted(targets):
        p = ROOT / rel
        src = p.read_text()
        orig = src
        a = b = c = 0
        if "KeyboardAvoidingView" not in src:
            src, a = convert_scrollviews(src)
            src, b = wrap_modals(src)
        else:
            src, c = fix_rn_kav(src)
            src, b = wrap_modals(src)
        if src != orig:
            report.append(f"{rel}: scroll={a} modal={b} kav={c}")
            if not DRY:
                p.write_text(src)
    print("\n".join(report))
    print(f"--- {len(report)} file modificati{' (dry)' if DRY else ''}")


main()
