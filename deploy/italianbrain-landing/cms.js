/* italianbrain.it — V50.z546 — pagine di approfondimento: i testi di default sono già nell'HTML (SEO + fallback),
   questo script li sovrascrive con quelli pubblicati dal CMS (/admin/landing-cms) via GET /api/public/landing/page/<slug>
   (same-origin: nginx fa proxy verso axon-core). Se il backend non risponde la pagina resta com'è. */
(function () {
  var slug = document.body.getAttribute("data-page");
  if (!slug) return;
  var PLAN = slug === "axon" ? "builder" : "professional";

  function get(obj, path) { return path.split(".").reduce(function (a, k) { return a == null ? undefined : a[k]; }, obj); }
  function fmt(n) { return Number.isInteger(n) ? n + "€" : String(n.toFixed(2)).replace(".", ",") + "€"; }
  function sub(str, vars) { return String(str).replace(/\{(left|limit|price|price_old|taken)\}/g, function (_, k) { return vars[k] != null ? vars[k] : ""; }); }

  function apply(data) {
    var page = data.page || {}, plans = data.plans || {}, seats = (data.seats || {})[PLAN] || {}, plan = plans[PLAN] || {};
    var vars = { left: seats.left, limit: seats.limit, taken: seats.taken, price: plan.price != null ? fmt(plan.price) : "", price_old: plan.price_old != null ? fmt(plan.price_old) : "" };

    document.querySelectorAll("[data-cms]").forEach(function (el) {
      var v = get(page, el.getAttribute("data-cms"));
      if (typeof v === "string" && v.trim()) el.textContent = sub(v, vars);
    });
    document.querySelectorAll("[data-cms-var]").forEach(function (el) {
      var k = el.getAttribute("data-cms-var");
      if (vars[k] != null && vars[k] !== "") el.textContent = vars[k];
    });
    document.querySelectorAll("[data-cms-list]").forEach(function (box) {
      var items = get(page, box.getAttribute("data-cms-list"));
      var tpl = box.querySelector("template");
      if (!Array.isArray(items) || !items.length) return;
      Array.prototype.slice.call(box.children).forEach(function (c) { if (c !== tpl) box.removeChild(c); });
      items.forEach(function (it) {
        if (typeof it === "string") { var li = document.createElement("li"); li.textContent = sub(it, vars); box.appendChild(li); return; } // liste di stringhe (bullets)
        if (!tpl) return;
        var node = tpl.content.cloneNode(true);
        node.querySelectorAll("[data-f]").forEach(function (f) { var val = it[f.getAttribute("data-f")]; if (val != null) f.textContent = sub(val, vars); });
        box.appendChild(node);
      });
    });
    document.querySelectorAll("[data-cms-mail]").forEach(function (a) {
      var mail = get(page, a.getAttribute("data-cms-mail")), subject = get(page, a.getAttribute("data-cms-subject") || "");
      if (mail) a.setAttribute("href", "mailto:" + mail + (subject ? "?subject=" + encodeURIComponent(subject) : ""));
    });
    // stato ✅ / 🟡 / ❌ nelle celle del confronto → colore
    document.querySelectorAll(".cmp td").forEach(function (td) {
      var t = td.textContent.trim().charAt(0);
      td.classList.remove("ok", "mid", "no");
      if (t === "✅") td.classList.add("ok"); else if (t === "🟡") td.classList.add("mid"); else if (t === "❌") td.classList.add("no");
    });
    var sold = seats.left != null && seats.left <= 0;
    document.querySelectorAll("[data-cms-founder]").forEach(function (el) { el.classList.toggle("sold", sold); });
  }

  var url = "/api/public/landing/page/" + encodeURIComponent(slug);
  fetch(url, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); }).then(apply).catch(function () {
    // fallback: dominio dell'app (CORS aperto sul backend) se il proxy same-origin non è ancora configurato
    fetch("https://core.italianbrain.it" + url, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); }).then(apply).catch(function () {});
  });
})();
