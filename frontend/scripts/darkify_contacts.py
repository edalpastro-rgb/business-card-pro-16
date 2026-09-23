#!/usr/bin/env python3
"""V50.z335 — Conversione dark/premium (palette HT di src/homeTheme.ts) dei componenti della sezione Contatti.
Uso: python3 scripts/darkify_contacts.py <file.tsx> [...]
Sostituisce token chiari (theme.color.*, hex pastello/light) con gli equivalenti HT e aggiunge l'import.
"""
import re
import sys

TOKEN_MAP = [
    # theme tokens
    (r"theme\.color\.surfaceSecondary", "HT.card2"),
    (r"theme\.color\.surfaceTertiary", "HT.card2"),
    (r"theme\.color\.surface\b", "HT.card2"),
    (r"theme\.color\.border\b", "HT.border"),
    (r"theme\.color\.divider\b", "HT.border"),
    (r"theme\.color\.onSurfaceTertiary", "HT.text2"),
    (r"theme\.color\.onSurfaceSecondary", "HT.text2"),
    (r"theme\.color\.onSurface\b", "HT.text"),
    (r"theme\.color\.muted\b", "HT.muted"),
    (r"theme\.color\.brandTertiary", "HT.brandTint"),
    (r"theme\.color\.brandPrimary", "HT.brand"),
    (r"theme\.color\.success\b", "HT.success"),
    (r"theme\.color\.error\b", "HT.danger"),
    (r"theme\.color\.warning\b", "HT.warning"),
    (r"theme\.color\.info\b", "HT.axon"),
]

# backgroundColor light → dark (solo quando è un backgroundColor / borderColor, per non toccare icone bianche)
BG_MAP = {
    "#FFF": "HT.card", "#FFFFFF": "HT.card", "#fff": "HT.card", "#ffffff": "HT.card",
    "#F8FAFC": "HT.card2", "#F1F5F9": "HT.card2", "#F9FAFB": "HT.card2", "#F3F4F6": "HT.card2", "#FAFAFA": "HT.card2", "#F5F7FA": "HT.card2", "#FBFCFD": "HT.card2",
    "#E2E8F0": "HT.border", "#E5E7EB": "HT.border", "#CBD5E1": "HT.borderStrong", "#D1D5DB": "HT.borderStrong", "#EEF0F4": "HT.border",
    # tinte pastello → tint rgba
    "#FEF3C7": "HT.warningTint", "#FDE68A": "HT.warning + '66'", "#FFFBEB": "HT.warningTint", "#FEF9C3": "HT.warningTint",
    "#DCFCE7": "HT.successTint", "#BBF7D0": "HT.success + '66'", "#F0FDF4": "HT.successTint", "#ECFDF5": "HT.successTint", "#D1FAE5": "HT.successTint",
    "#FEE2E2": "HT.dangerTint", "#FECACA": "HT.danger + '66'", "#FEF2F2": "HT.dangerTint",
    "#DBEAFE": "HT.axonTint", "#E0F2FE": "HT.axonTint", "#BAE6FD": "HT.axonLine", "#F0F9FF": "HT.axonTint", "#BFDBFE": "HT.axonLine", "#EFF6FF": "HT.axonTint",
    "#F5F3FF": "HT.violetTint", "#EEF2FF": "HT.violetTint", "#EDE9FE": "HT.violetTint", "#DDD6FE": "HT.violet + '66'", "#E0E7FF": "HT.violetTint", "#C7D2FE": "HT.violet + '66'",
    "#FFF7ED": "HT.brandTint", "#FFEDD5": "HT.brandTint", "#FED7AA": "HT.brandLine", "#FFF1E9": "HT.brandTint",
}

# colori testo scuri → chiari (in qualsiasi posizione: color, borderColor, icon color)
FG_MAP = {
    "#0F172A": "HT.text", "#111827": "HT.text", "#1E293B": "HT.text", "#0F2438": "HT.text", "#1B2B4B": "HT.text", "#111820": "HT.text",
    "#334155": "HT.text2", "#374151": "HT.text2", "#475569": "HT.text2", "#4B5563": "HT.text2",
    "#64748B": "HT.muted", "#64758B": "HT.muted", "#6B7280": "HT.muted", "#94A3B8": "HT.muted", "#9CA3AF": "HT.muted", "#7A8794": "HT.muted", "#7F8FA4": "HT.muted",
    "#B45309": "HT.warning", "#92400E": "#FDBA74", "#78350F": "#FDBA74", "#9A3412": "#FDBA74", "#C2410C": "#FDBA74", "#A16207": "HT.warning", "#854D0E": "HT.warning",
    "#166534": "HT.success", "#15803D": "HT.success", "#14532D": "HT.success", "#065F46": "HT.success", "#047857": "HT.success",
    "#B91C1C": "HT.danger", "#991B1B": "HT.danger", "#7F1D1D": "HT.danger",
    "#0369A1": "HT.axon", "#1D4ED8": "HT.axon", "#1E40AF": "HT.axon", "#075985": "HT.axon", "#0C4A6E": "HT.axon", "#3730A3": "HT.axon", "#1E3A8A": "HT.axon",
    "#5B21B6": "HT.violet", "#4C1D95": "HT.violet", "#6D28D9": "HT.violet",
}


def darkify(src: str) -> str:
    out = src
    for pat, rep in TOKEN_MAP:
        out = re.sub(pat, rep, out)
    # backgroundColor / borderColor / borderBottomColor ... : "#XXX"
    def bg_sub(m):
        key = m.group(2)
        rep = BG_MAP.get(key) or BG_MAP.get(key.upper())
        if rep is None:
            # sfondo scuro/saturo: proteggilo dalla mappa FG (virgolette singole → non matcha la regex FG)
            return f"{m.group(1)}'{key}'"
        return f"{m.group(1)}{rep}"
    out = re.sub(r"((?:backgroundColor|borderColor|borderTopColor|borderBottomColor|borderLeftColor|borderRightColor)\s*:\s*)\"(#[0-9A-Fa-f]{3,6})\"", bg_sub, out)
    # style={{ backgroundColor: "#FFF" }} già coperto; ora colori di testo/icone scuri
    def fg_sub(m):
        key = m.group(1).upper()
        rep = FG_MAP.get(key)
        return rep if rep else m.group(0)
    # solo hex tra virgolette (stringhe), per evitare di rompere altre cose
    out = re.sub(r"\"(#[0-9A-Fa-f]{6})\"", fg_sub, out)
    # import HT se manca e se usato
    if "HT." in out and "from \"@/src/homeTheme\"" not in out:
        # inserisci dopo l'ultimo import
        lines = out.split("\n")
        last_imp = max(i for i, l in enumerate(lines) if l.startswith("import "))
        lines.insert(last_imp + 1, 'import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium')
        out = "\n".join(lines)
    # rimuovi import theme se non più usato
    if "theme." not in out:
        out = re.sub(r"^import \{ theme \} from \"@/src/theme\";\n", "", out, flags=re.M)
    return out


if __name__ == "__main__":
    for p in sys.argv[1:]:
        s = open(p).read()
        n = darkify(s)
        if n != s:
            open(p, "w").write(n)
            print("darkified", p)
        else:
            print("unchanged", p)
