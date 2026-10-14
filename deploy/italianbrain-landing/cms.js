/* italianbrain.it — V50.z546 — pagine di approfondimento: i testi di default sono già nell'HTML (SEO + fallback),
   questo script li sovrascrive con quelli pubblicati dal CMS (/admin/landing-cms) via GET /api/public/landing/page/<slug>
   (same-origin: nginx fa proxy verso axon-core). Se il backend non risponde la pagina resta com'è. */
(function () {
  var slug = document.body.getAttribute("data-page");
  if (!slug) return;
  var PLAN = slug === "axon" ? "builder" : "professional";

  // V50.z547 — link Vimeo/YouTube incollato nel CMS → URL del player (dnt / nocookie)
  function toEmbed(raw) {
    var u = String(raw || "").trim(), m;
    if (!u) return "";
    if (/player\.vimeo\.com\/video\/\d+/.test(u)) return u;
    m = u.match(/vimeo\.com\/(?:video\/)?(\d+)(?:\/([a-zA-Z0-9]+))?/);
    if (m) return "https://player.vimeo.com/video/" + m[1] + "?dnt=1" + (m[2] ? "&h=" + m[2] : "");
    if (/youtube(-nocookie)?\.com\/embed\//.test(u)) return u;
    m = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/))([A-Za-z0-9_-]{6,})/);
    if (m) return "https://www.youtube-nocookie.com/embed/" + m[1];
    return u;
  }
  function applyVideos(page) {
    document.querySelectorAll("[data-cms-video]").forEach(function (box) {
      var src = toEmbed(get(page, box.getAttribute("data-cms-video")));
      if (!src) return;
      var f = document.createElement("iframe");
      f.src = src; f.loading = "lazy"; f.allow = "autoplay; fullscreen; picture-in-picture"; f.allowFullscreen = true;
      f.title = box.getAttribute("aria-label") || "Video";
      box.innerHTML = ""; box.appendChild(f); box.classList.add("video-live");
    });
  }

  function get(obj, path) { return path.split(".").reduce(function (a, k) { return a == null ? undefined : a[k]; }, obj); }
  function fmt(n) { return Number.isInteger(n) ? n + "€" : String(n.toFixed(2)).replace(".", ",") + "€"; }
  function sub(str, vars) { return String(str).replace(/\{(left|limit|price|price_old|taken)\}/g, function (_, k) { return vars[k] != null ? vars[k] : ""; }); }

  function apply(data) {
    var page = data.page || data.content || {}, plans = data.plans || (data.content || {}).plans || {}, seats = (data.seats || {})[PLAN] || {}, plan = plans[PLAN] || {};
    applyVideos(page);
    if (slug === "home") return; // home: solo i video dei due mondi (testi dell'index restano statici)
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
    // V50.z548 — tabella comparativa del modal: colonne/righe/celle dal CMS (array), ricostruita da zero
    document.querySelectorAll("[data-cms-table]").forEach(function (tbl) {
      var md = get(page, tbl.getAttribute("data-cms-table"));
      if (!md || !Array.isArray(md.columns) || !Array.isArray(md.rows) || !md.rows.length) return;
      var thead = tbl.querySelector("thead tr"), tbody = tbl.querySelector("tbody");
      if (!thead || !tbody) return;
      var first = thead.querySelector("th"); thead.innerHTML = ""; thead.appendChild(first);
      md.columns.forEach(function (c, i) { var th = document.createElement("th"); th.textContent = c; if (i === 0) th.className = "cmp-us"; thead.appendChild(th); });
      tbody.innerHTML = "";
      md.rows.forEach(function (r) {
        var tr = document.createElement("tr"), th = document.createElement("th"); th.scope = "row"; th.textContent = r.need || ""; tr.appendChild(th);
        md.columns.forEach(function (_, i) { var td = document.createElement("td"); td.textContent = (r.cells || [])[i] || "—"; if (i === 0) td.className = "cmp-us"; tr.appendChild(td); });
        tbody.appendChild(tr);
      });
    });
    // stato ✅ ⏱️ / 🟡 / ❌ nelle celle del confronto → colore
    document.querySelectorAll(".cmp td").forEach(function (td) {
      var t = td.textContent.trim();
      td.classList.remove("ok", "mid", "no");
      if (t.indexOf("✅") === 0 || t.indexOf("⏱") === 0) td.classList.add("ok"); else if (t.indexOf("🟡") === 0) td.classList.add("mid"); else if (t.indexOf("❌") === 0) td.classList.add("no");
    });
    var sold = seats.left != null && seats.left <= 0;
    document.querySelectorAll("[data-cms-founder]").forEach(function (el) { el.classList.toggle("sold", sold); });
  }

  // V50.z548 — modal confronto tecnico: overlay, blocco scroll, X / backdrop / Esc per chiudere (nessun link esterno)
  var modal = document.getElementById("compare-modal"), opener = document.getElementById("open-compare");
  if (modal && opener) {
    var openM = function () { modal.hidden = false; document.body.classList.add("modal-open"); modal.querySelector(".modal-x").focus(); };
    var closeM = function () { modal.hidden = true; document.body.classList.remove("modal-open"); opener.focus(); };
    opener.addEventListener("click", openM);
    modal.querySelectorAll("[data-close]").forEach(function (el) { el.addEventListener("click", closeM); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !modal.hidden) closeM(); });
  }

  var url = slug === "home" ? "/api/public/landing" : "/api/public/landing/page/" + encodeURIComponent(slug);
  fetch(url, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); }).then(apply).catch(function () {
    // fallback: dominio dell'app (CORS aperto sul backend) se il proxy same-origin non è ancora configurato
    fetch("https://core.italianbrain.it" + url, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); }).then(apply).catch(function () {});
  });
})();
