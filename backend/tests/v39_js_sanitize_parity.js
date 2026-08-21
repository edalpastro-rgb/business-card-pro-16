// Standalone parity check: mirrors the exact regex pattern shipped in
// /app/frontend/src/BillFieldRenderers.tsx (sanitizeAiText) and
// /app/frontend/src/BillsSection.tsx (local sanitizeAi). Verifies that
// the JS implementation produces the same results as the Python one
// tested in /app/backend/tests/test_v39_html_sanitize.py.

function sanitizeAiText(s) {
  return String(s ?? "")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/p\s*>/gi, "\n\n")
    .replace(/<\s*p(?:\s[^>]*)?>/gi, "")
    .replace(/<\s*\/li\s*>/gi, "\n")
    .replace(/<\s*li(?:\s[^>]*)?>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const cases = [
  { in: "Ciao<br>mondo",              out: "Ciao\nmondo" },
  { in: "<p>Intro</p><p>Fine</p>",    out: "Intro\n\nFine" },
  { in: "<script>evil</script>testo", out: "eviltesto" },
  { in: "&nbsp;spazi&nbsp;",          out: "spazi" }, // trim removes the leading/trailing spaces
  { in: "",                            out: "" },
  { in: null,                          out: "" },
  { in: "Enel<br>Energia",            out: "Enel\nEnergia" },
  { in: "<li>uno</li><li>due</li>",   out: "• uno\n• due" },
  { in: "A&amp;B",                    out: "A&B" },
  { in: "&quot;hi&quot;",             out: '"hi"' },
];

let failed = 0;
for (const c of cases) {
  const got = sanitizeAiText(c.in);
  const ok = got === c.out;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  in=${JSON.stringify(c.in)}  expected=${JSON.stringify(c.out)}  got=${JSON.stringify(got)}`);
}
console.log(failed === 0 ? "\nAll JS parity cases passed." : `\n${failed} JS parity FAILURES.`);
process.exit(failed === 0 ? 0 : 1);
