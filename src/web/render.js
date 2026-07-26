// HTML rendering for the logcheck report website.
// Uses the Wowhead tooltip widget (power.js) + zamimg icon CDN — no local assets.

const CLASS_COLORS = {
    Druid: "#FF7D0A", Hunter: "#ABD473", Mage: "#69CCF0", Paladin: "#F58CBA",
    Priest: "#FFFFFF", Rogue: "#FFF569", Shaman: "#0070DE", Warlock: "#9482C9", Warrior: "#C79C6E",
};

// Discord brand mark for the "Sign in with Discord" button
const DISCORD_LOGO = "<svg viewBox=\"0 0 24 18\" width=\"22\" height=\"17\" fill=\"currentColor\" aria-hidden=\"true\"><path d=\"M20.317 1.492A19.79 19.79 0 0 0 15.4 0c-.21.38-.456.89-.626 1.295a18.27 18.27 0 0 0-5.548 0A12.6 12.6 0 0 0 8.6 0 19.74 19.74 0 0 0 3.677 1.492C.533 6.186-.32 10.763.099 15.276a19.9 19.9 0 0 0 6.063 3.058c.49-.666.927-1.375 1.302-2.118a12.9 12.9 0 0 1-2.05-.978c.172-.126.34-.258.502-.392a14.2 14.2 0 0 0 12.166 0c.164.14.332.272.502.392-.654.386-1.34.714-2.05.978.375.743.81 1.452 1.302 2.118a19.84 19.84 0 0 0 6.063-3.058c.5-5.234-.838-9.77-3.582-13.784ZM8.02 12.5c-1.183 0-2.157-1.085-2.157-2.42 0-1.334.955-2.42 2.157-2.42 1.21 0 2.176 1.095 2.157 2.42 0 1.335-.955 2.42-2.157 2.42Zm7.96 0c-1.183 0-2.157-1.085-2.157-2.42 0-1.334.955-2.42 2.157-2.42 1.21 0 2.176 1.095 2.157 2.42 0 1.335-.946 2.42-2.157 2.42Z\"/></svg>";

function esc(s) {
    return String(s === undefined || s === null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function iconUrl(icon) {
    const name = icon ? String(icon).replace(/\.(jpg|jpeg|png|gif)$/i, "").toLowerCase() : "inv_misc_questionmark";
    return `https://wow.zamimg.com/images/wow/icons/large/${name}.jpg`;
}

function classIconUrl(type) {
    return `https://wow.zamimg.com/images/wow/icons/large/classicon_${String(type || "").toLowerCase()}.jpg`;
}

function tagClass(severity) {
    return severity === "high" ? "tag tag-high" : "tag tag-medium";
}

function issueRow(issue) {
    const icon = `<img class="icon" src="${esc(iconUrl(issue.icon))}" loading="lazy" alt="">`;
    let name;
    if (issue.itemId) {
        name = `<a class="item" href="https://www.wowhead.com/tbc/item=${esc(issue.itemId)}" target="_blank" rel="noopener">${icon}<span>${esc(issue.itemName)}</span></a>`;
    } else {
        name = `<span class="item">${icon}<span>${esc(issue.itemName)}</span></span>`;
    }
    return `<li>${name}<span class="${tagClass(issue.severity)}">${esc(issue.label)}</span></li>`;
}

function nameInner(p) {
    const color = CLASS_COLORS[p.type] || "#ddd";
    return `<img src="${esc(classIconUrl(p.type))}" alt="${esc(p.type)}" title="${esc(p.type)}"><span style="color:${color};font-weight:700">${esc(p.name)}</span>`;
}

function classCell(p, href) {
    const inner = nameInner(p);
    return href
        ? `<a class="pname-cell" href="${esc(href)}">${inner}</a>`
        : `<span class="pname-cell">${inner}</span>`;
}

function playerCard(p, href) {
    const head = href
        ? `<a class="player" href="${esc(href)}">`
        : "<div class=\"player\">";
    const headEnd = href ? "</a>" : "</div>";
    const color = CLASS_COLORS[p.type] || "#ddd";
    const issues = p.issues || [];
    const rows = issues.map(issueRow).join("");
    const sev = issues.some((i) => i.severity === "high") ? "sev-high" : issues.length ? "sev-med" : "sev-ok";
    return `
    <section class="card ${sev}">
      ${head}
        <img class="classicon" src="${esc(classIconUrl(p.type))}" alt="${esc(p.type)}" title="${esc(p.type)}">
        <span class="pname" style="color:${color}">${esc(p.name)}</span>
        <span class="count">${issues.length}</span>
      ${headEnd}
      <ul class="issues">${rows}</ul>
    </section>`;
}

function pctCell(v) {
    const cls = v >= 100 ? "pct-full" : v > 0 ? "pct-part" : "pct-none";
    return `<span class="pct ${cls}">${v}%</span>`;
}

function yesNo(v) {
    return v ? "<span class=\"pct pct-full\">ja</span>" : "<span class=\"pct pct-none\">nein</span>";
}

// small inline icon for table headers / labels
function hicon(icon, title) {
    if (!icon) return "";
    return `<img class="hicon" src="${esc(iconUrl(icon))}" alt="" title="${esc(title || "")}">`;
}
function colHead(icon, label) {
    return `${hicon(icon, label)}<span>${esc(label)}</span>`;
}

// A theme-toggle button. The shared script (below) paints its icon and wires the click.
function themeToggleBtn() {
    return "<button class=\"theme-toggle\" id=\"themeBtn\" type=\"button\" aria-label=\"Design umschalten\" title=\"Hell/Dunkel\"></button>";
}

/**
 * Full HTML page shell. Shared by the log-check pages and the admin menu so both
 * get the same tokens + light/dark theming.
 * @param {object} opts { bare } — bare:true drops the centered .wrap + footer + floating
 *   toggle so a page (e.g. the admin sidebar shell) can supply its own outer structure.
 */
function layout(title, body, opts = {}) {
    const bare = !!opts.bare;
    const inner = bare
        ? body
        : `<div class="float-toggle">${themeToggleBtn()}</div>
<div class="wrap">
${body}
<footer>EventHelper · Log-Check · Tooltips by Wowhead</footer>
</div>`;
    return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<script>/* set theme before first paint to avoid a flash */
(function(){try{var t=localStorage.getItem("eh-theme");if(t)document.documentElement.setAttribute("data-theme",t);}catch(e){}})();
</script>
<style>
  /* ---- theme tokens: dark is the default palette ---- */
  :root {
    --bg:#16181d; --panel:#1f232b; --panel2:#272c36; --panel3:#30353f;
    --text:#e6e6e6; --muted:#9aa0aa; --line:#2c313b; --line-soft:#23272f;
    --high:#e0524f; --high-bg:rgba(224,82,79,.16);
    --medium:#e0a23a; --medium-bg:rgba(224,162,58,.16);
    --good:#7fd17f; --good-bg:rgba(120,200,120,.16);
    --accent:#7ab7ff; --accent-2:#4d92e6; --accent-soft:rgba(122,183,255,.15); --accent-ink:#0b1522;
    --portrait-1:#1a1d24; --portrait-2:#14161b;
  }
  @media (prefers-color-scheme: light) {
    :root:not([data-theme="dark"]) {
      --bg:#f2f4f8; --panel:#ffffff; --panel2:#eef1f6; --panel3:#e2e6ee;
      --text:#1b1e27; --muted:#5b616e; --line:#dde1eb; --line-soft:#e8ebf2;
      --high:#cf3b37; --high-bg:rgba(207,59,55,.12);
      --medium:#9a6c12; --medium-bg:rgba(154,108,18,.14);
      --good:#2b9440; --good-bg:rgba(43,148,64,.12);
      --accent:#2f6fd6; --accent-2:#2559b0; --accent-soft:rgba(47,111,214,.12); --accent-ink:#ffffff;
      --portrait-1:#e9edf4; --portrait-2:#dce2ec;
    }
  }
  :root[data-theme="light"] {
    --bg:#f2f4f8; --panel:#ffffff; --panel2:#eef1f6; --panel3:#e2e6ee;
    --text:#1b1e27; --muted:#5b616e; --line:#dde1eb; --line-soft:#e8ebf2;
    --high:#cf3b37; --high-bg:rgba(207,59,55,.12);
    --medium:#9a6c12; --medium-bg:rgba(154,108,18,.14);
    --good:#2b9440; --good-bg:rgba(43,148,64,.12);
    --accent:#2f6fd6; --accent-2:#2559b0; --accent-soft:rgba(47,111,214,.12); --accent-ink:#ffffff;
    --portrait-1:#e9edf4; --portrait-2:#dce2ec;
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; transition:background .2s, color .2s; }
  a { color:inherit; }
  .wrap { max-width:1100px; margin:0 auto; padding:24px 16px 64px; }
  h1 { font-size:22px; margin:0 0 4px; }
  h2 { font-size:18px; margin:24px 0 12px; }
  .sub { color:var(--muted); margin:0 0 16px; font-size:14px; }
  .sub a { color:var(--accent); text-decoration:none; }
  /* theme toggle */
  .theme-toggle { width:36px; height:36px; display:inline-grid; place-items:center; padding:0; border-radius:8px; border:1px solid var(--line); background:var(--panel2); color:var(--muted); cursor:pointer; transition:color .12s, border-color .12s; }
  .theme-toggle:hover { color:var(--text); border-color:var(--muted); }
  .theme-toggle svg { width:17px; height:17px; }
  .float-toggle { position:fixed; top:14px; right:16px; z-index:50; }
  .summary { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px 16px; margin-bottom:16px; }
  /* masonry-style columns: short cards fill the vertical space, no row gaps */
  .grid { column-width:330px; column-gap:14px; }
  .grid .card { break-inside:avoid; -webkit-column-break-inside:avoid; margin:0 0 14px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:10px; overflow:hidden; border-left:3px solid var(--line); }
  .card.sev-high { border-left-color:var(--high); }
  .card.sev-med { border-left-color:var(--medium); }
  .card.sev-ok { border-left-color:var(--good); }
  .card.sev-med .count { background:var(--medium-bg); color:var(--medium); }
  .potions { display:inline-flex; gap:12px; }
  .potcell { display:inline-flex; align-items:center; gap:4px; }
  .player { display:flex; align-items:center; gap:10px; padding:10px 14px; background:var(--panel2); border-bottom:1px solid var(--line); text-decoration:none; }
  a.player:hover { background:var(--panel3); }
  .classicon { width:24px; height:24px; border-radius:4px; }
  .pname { font-weight:700; font-size:16px; flex:1; }
  .count { background:var(--high-bg); color:var(--high); font-weight:700; border-radius:12px; padding:1px 9px; font-size:13px; }
  ul.issues { list-style:none; margin:0; padding:8px 12px; }
  ul.issues li { display:flex; align-items:center; gap:8px; padding:5px 0; border-bottom:1px solid var(--line-soft); }
  ul.issues li:last-child { border-bottom:0; }
  .item { display:flex; align-items:center; gap:8px; flex:1; min-width:0; text-decoration:none; }
  .item span { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .icon { width:22px; height:22px; border-radius:4px; flex:0 0 auto; }
  .tag { flex:0 0 auto; font-size:12px; font-weight:600; padding:2px 8px; border-radius:6px; }
  .tag-high { background:var(--high-bg); color:var(--high); }
  .tag-medium { background:var(--medium-bg); color:var(--medium); }
  .empty { color:var(--muted); padding:40px; text-align:center; }
  table.idx { width:100%; border-collapse:collapse; }
  table.idx th, table.idx td { text-align:left; padding:9px 12px; border-bottom:1px solid var(--line); }
  table.idx th { color:var(--muted); font-weight:600; font-size:13px; }
  table.idx tr:hover td { background:var(--panel2); }
  .pill { display:inline-block; background:var(--high-bg); color:var(--high); border-radius:10px; padding:0 8px; font-size:12px; font-weight:700; }
  .pct { font-weight:700; border-radius:6px; padding:1px 8px; font-size:13px; display:inline-block; min-width:46px; text-align:center; }
  .pct-full { background:var(--good-bg); color:var(--good); }
  .pct-part { background:var(--medium-bg); color:var(--medium); }
  .pct-none { background:var(--high-bg); color:var(--high); }
  .pname-cell { display:inline-flex; align-items:center; gap:8px; text-decoration:none; }
  .pname-cell img { width:20px; height:20px; border-radius:4px; }
  .srval { font-weight:700; }
  .sritems { color:var(--muted); font-size:12.5px; }
  .sritems a, a.pname-cell:hover span { text-decoration:underline; }
  .note { color:var(--muted); font-size:12.5px; margin:-6px 0 12px; }
  nav.tabs { display:flex; gap:6px; flex-wrap:wrap; margin:8px 0 20px; border-bottom:1px solid var(--line); }
  nav.tabs button { background:none; border:0; border-bottom:2px solid transparent; color:var(--muted); padding:9px 14px; font-size:14px; cursor:pointer; border-radius:6px 6px 0 0; }
  nav.tabs button:hover { color:var(--text); background:var(--panel2); }
  nav.tabs button.active { color:var(--text); border-bottom-color:var(--accent); font-weight:700; }
  .tabpanel { display:none; }
  .tabpanel.active { display:block; }
  .armory { display:grid; grid-template-columns:repeat(auto-fill,minmax(330px,1fr)); gap:8px; }
  .arow { display:flex; align-items:center; gap:10px; background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:8px 10px; }
  .aslot { width:80px; flex:0 0 auto; color:var(--muted); font-size:12px; }
  .aitem { flex:1; min-width:0; }
  .aitem .item { font-weight:600; }
  .ameta { display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-top:3px; }
  .ench-ok { color:var(--good); font-size:12px; }
  .gem { text-decoration:none; font-size:13px; }
  .gem-bad { filter:grayscale(1); opacity:.6; }
  .gem-empty { opacity:.7; }
  .hicon { width:18px; height:18px; border-radius:3px; vertical-align:-4px; margin-right:5px; }
  th .hicon { margin-right:4px; }
  /* hero header */
  .hero { position:relative; overflow:hidden; border-radius:14px; border:1px solid var(--line); background:var(--panel); padding:18px 20px; margin:6px 0 22px; display:flex; align-items:center; gap:16px; }
  .hero-bg { position:absolute; inset:0; background:radial-gradient(120% 160% at 0% 0%, color-mix(in srgb, var(--cc) 28%, transparent), transparent 60%); pointer-events:none; }
  .hero-class { width:64px; height:64px; border-radius:12px; border:2px solid var(--cc); position:relative; z-index:1; }
  .hero-main { position:relative; z-index:1; }
  .hero-name { font-size:26px; font-weight:800; line-height:1.1; }
  .hero-sub { color:var(--muted); margin-bottom:8px; }
  .chips { display:flex; flex-wrap:wrap; gap:8px; }
  .chip { background:var(--panel2); border:1px solid var(--line); border-radius:20px; padding:3px 11px; font-size:13px; display:inline-flex; align-items:center; gap:2px; }
  .chip b { margin-right:4px; }
  .chip-warn { color:var(--high); border-color:rgba(224,82,79,.4); }
  .chip-ok { color:var(--good); border-color:rgba(120,200,120,.4); }
  /* paperdoll (armory-style) */
  .doll { display:grid; grid-template-columns:1fr minmax(180px,260px) 1fr; gap:16px; margin-bottom:12px; align-items:start; }
  .pd-col { display:flex; flex-direction:column; gap:9px; }
  .pd-center { display:flex; flex-direction:column; align-items:center; gap:14px; padding-top:6px; }
  .portrait { position:relative; width:190px; height:230px; border-radius:14px; border:1px solid var(--line);
    background:radial-gradient(120% 80% at 50% 0%, color-mix(in srgb, var(--cc) 30%, var(--portrait-1)), var(--portrait-2) 75%);
    display:flex; align-items:center; justify-content:center; overflow:hidden;
    box-shadow:inset 0 0 60px rgba(0,0,0,.35); }
  .portrait::after { content:""; position:absolute; inset:0; border-radius:14px; box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--cc) 40%, transparent); }
  .portrait img { width:96px; height:96px; border-radius:14px; opacity:.92; filter:drop-shadow(0 6px 18px rgba(0,0,0,.6)); }
  .ilvl-badge { display:flex; flex-direction:column; align-items:center; justify-content:center; width:96px; height:96px; border-radius:50%;
    border:3px solid var(--cc); background:var(--panel); }
  .ilvl-badge b { font-size:30px; font-weight:800; line-height:1; }
  .ilvl-badge span { color:var(--muted); font-size:11px; margin-top:3px; }
  .pd-col-left, .pd-col-right { align-items:stretch; }
  .doll-bottom { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:10px; margin-bottom:12px; }
  .slot { display:flex; align-items:center; gap:11px; background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:8px 11px; width:100%; transition:background .12s; }
  .slot:hover { background:var(--panel2); }
  .slot-right { flex-direction:row-reverse; text-align:right; }
  .slot-icon { position:relative; width:42px; height:42px; flex:0 0 auto; border:2px solid var(--line); border-radius:8px; overflow:hidden; display:block; box-shadow:0 0 8px rgba(0,0,0,.25); }
  .slot-icon img { width:100%; height:100%; display:block; }
  .slot-info { min-width:0; flex:1; }
  .slot-name { display:block; font-size:12.5px; font-weight:600; text-decoration:none; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .slot-ench { font-size:11px; line-height:1.3; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .slot-ench.ok { color:var(--good); } .slot-ench.bad { color:var(--medium); } .slot-ench.miss { color:var(--high); }
  .slot-gems { display:flex; gap:3px; margin-top:3px; }
  .slot-right .slot-gems { justify-content:flex-end; }
  .gemicon { width:16px; height:16px; border-radius:3px; display:inline-block; overflow:hidden; border:1px solid #0006; line-height:0; }
  .gemicon img { width:100%; height:100%; display:block; }
  .gem-bad { filter:grayscale(.7); opacity:.65; }
  .gem-empty { background:transparent; border:1px dashed var(--high); }
  .badge { position:absolute; right:-4px; bottom:-4px; width:17px; height:17px; border-radius:50%; font-size:11px; line-height:17px; text-align:center; font-weight:800; color:#fff; border:1px solid #0008; }
  .b-ok { background:#3a8a3a; } .b-bad { background:#b8862a; } .b-miss { background:#b33; }
  .empty-slot { opacity:.4; } .slot-ph { width:42px; height:42px; border:1px dashed var(--line); border-radius:8px; }
  @media (max-width:720px){ .doll { grid-template-columns:1fr; } .pd-center { order:-1; } .pd-col-left, .pd-col-right { align-items:stretch; } .slot { max-width:none; } }
  /* index search/paging */
  .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; }
  .toolbar input, .toolbar select { background:var(--panel2); color:var(--text); border:1px solid var(--line); border-radius:8px; padding:7px 11px; font-size:14px; }
  .toolbar input { flex:1; min-width:180px; }
  .pager { display:flex; gap:6px; justify-content:center; margin-top:14px; }
  .pager button { background:var(--panel2); color:var(--text); border:1px solid var(--line); border-radius:8px; padding:6px 12px; cursor:pointer; }
  .pager button:disabled { opacity:.4; cursor:default; }
  .pager .pginfo { color:var(--muted); padding:6px 8px; }
  .del { background:none; border:0; cursor:pointer; font-size:15px; opacity:.6; }
  .del:hover { opacity:1; }
  .discord-btn { display:inline-flex; align-items:center; gap:9px; background:#5865F2; color:#fff; text-decoration:none;
    font-weight:600; font-size:14px; padding:9px 16px; border-radius:8px; transition:background .12s; box-shadow:0 1px 2px rgba(0,0,0,.3); }
  .discord-btn:hover { background:#4752C4; }
  .discord-btn svg { display:block; }
  footer { color:var(--muted); font-size:12px; margin-top:40px; text-align:center; }
</style>
</head>
<body${opts.bodyClass ? ` class="${opts.bodyClass}"` : ""}>
${inner}
<script>
document.addEventListener("click",function(e){
  var b=e.target.closest("[data-tab]"); if(!b) return;
  document.querySelectorAll("nav.tabs [data-tab]").forEach(function(x){x.classList.toggle("active",x===b);});
  var t=b.getAttribute("data-tab");
  document.querySelectorAll(".tabpanel").forEach(function(p){p.classList.toggle("active",p.id==="tab-"+t);});
});
(function(){
  var root=document.documentElement, btn=document.getElementById("themeBtn"); if(!btn) return;
  var SUN='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>';
  function eff(){ return root.getAttribute("data-theme") || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"); }
  function paint(){ btn.innerHTML = eff()==="dark" ? SUN : MOON; }
  btn.addEventListener("click",function(){ var n=eff()==="dark"?"light":"dark"; root.setAttribute("data-theme",n); try{localStorage.setItem("eh-theme",n);}catch(e){} paint(); });
  paint();
})();
</script>
<script>const whTooltips={colorLinks:true,iconizeLinks:${opts.wowheadIconize ? "true" : "false"},renameLinks:${opts.wowheadIconize ? "true" : "false"}};</script>
<script src="https://wow.zamimg.com/widgets/power.js"></script>
</body>
</html>`;
}

function renderGearPanel(players, linkFor) {
    if (!players || players.length === 0) {
        return "<div class=\"empty\">✅ Keine Gear-Probleme gefunden!</div>";
    }
    const total = players.reduce((n, p) => n + (p.issues || []).length, 0);
    return `<div class="summary"><strong>${players.length}</strong> Spieler mit insgesamt <strong>${total}</strong> Problem(en).</div>
      <div class="grid">${players.map((p) => playerCard(p, linkFor(p.name))).join("")}</div>`;
}

function renderConsumablesPanel(consumables, linkFor) {
    const rows = (consumables && consumables.players) || [];
    if (rows.length === 0) return "<div class=\"empty\">Keine Daten.</div>";
    const ic = (consumables && consumables.icons) || {};
    const body = rows.map((p) => `<tr>
      <td>${classCell(p, linkFor(p.name))}</td>
      <td>${pctCell(p.flask)}</td>
      <td>${pctCell(p.elixir)}</td>
      <td>${pctCell(p.buffed)}</td>
      <td>${pctCell(p.food)}</td>
      <td>${yesNo(p.weaponOiled)}</td>
    </tr>`).join("");
    return `<p class="note">Abdeckung in % der Boss-Kämpfe. Flask &amp; Elixiere schließen sich aus — „Flask/Elixiere" = Flask <em>oder</em> beide Elixiere aktiv.</p>
    <table class="idx">
      <tr><th>Spieler</th><th>${colHead(ic.flask, "Flask")}</th><th>${colHead(ic.battle, "Elixiere")}</th><th>Flask/Elixiere</th><th>${colHead(ic.food, "Food")}</th><th>Waffe geölt</th></tr>
      ${body}
    </table>`;
}

function renderPotionsPanel(potions, linkFor) {
    const rows = (potions && potions.players) || [];
    if (rows.length === 0) return "<div class=\"empty\">Keine Tränke gefunden.</div>";
    const ic = (potions && potions.icons) || {};
    const body = rows.map((p) => `<tr>
      <td>${classCell(p, linkFor(p.name))}</td>
      <td class="srval">${esc(p.destruction)}</td>
      <td class="srval">${esc(p.haste)}</td>
      <td class="srval">${esc(p.mana)}</td>
      <td class="srval">${esc(p.total)}</td>
    </tr>`).join("");
    return `<table class="idx">
      <tr><th>Spieler</th><th>${colHead(ic.destruction, "Destruction")}</th><th>${colHead(ic.haste, "Haste")}</th><th>${colHead(ic.mana, "Mana")}</th><th>Gesamt</th></tr>
      ${body}
    </table>`;
}

function renderShadowResiPanel(sr, linkFor) {
    if (!sr || !sr.players || sr.players.length === 0) return "<div class=\"empty\">Kein Mother-Shahraz-Kampf im Report.</div>";
    const body = sr.players.map((p) => {
        const items = p.items.map((it) =>
            `<a href="https://www.wowhead.com/tbc/item=${esc(it.itemId)}" target="_blank" rel="noopener">${esc(it.itemName)} (+${esc(it.sr)})</a>`
        ).join(", ");
        return `<tr><td>${classCell(p, linkFor(p.name))}</td><td class="srval">${esc(p.sr)}</td><td class="sritems">${items || "—"}</td></tr>`;
    }).join("");
    return `<p class="note">${esc(sr.note)}</p>
    <table class="idx">
      <tr><th>Spieler</th><th>SR (Gear)</th><th>Quellen</th></tr>
      ${body}
    </table>`;
}

function renderDrumsPanel(drums, linkFor) {
    const rows = (drums && drums.players) || [];
    if (rows.length === 0) return "<div class=\"empty\">Keine Drums gefunden.</div>";
    const body = rows.map((p) => {
        const parts = Object.entries(p.byType).map(([k, v]) => `${k}: ${v}`).join(", ");
        return `<tr><td>${classCell(p, linkFor(p.name))}</td><td class="srval">${esc(p.total)}</td><td class="sritems">${esc(parts)}</td></tr>`;
    }).join("");
    return `<table class="idx">
      <tr><th>Spieler</th><th>${colHead(drums && drums.icon, "Drums gesamt")}</th><th>Aufschlüsselung</th></tr>
      ${body}
    </table>`;
}

function issueCountCell(n) {
    if (!n) return "<span class=\"pct pct-full\">0</span>";
    return `<span class="pct pct-none">${n}</span>`;
}

function potionCells(ic, pot) {
    const cell = (icon, n) => `<span class="potcell">${hicon(icon, "")}${esc(n || 0)}</span>`;
    return cell(ic.destruction, pot.destruction) + cell(ic.haste, pot.haste) + cell(ic.mana, pot.mana);
}

function renderRosterPanel(report, linkFor) {
    const roster = report.roster || [];
    if (roster.length === 0) return "<div class=\"empty\">Keine Raider gefunden.</div>";
    const ic = report.icons || {};
    const body = roster.map((p) => {
        const pot = p.potions || {};
        return `<tr>
          <td>${classCell(p, linkFor(p.name))}</td>
          <td>${issueCountCell((p.issues || []).length)}</td>
          <td><span class="potions">${potionCells(ic, pot)}</span></td>
          <td><a class="sub" href="${esc(linkFor(p.name))}">Details →</a></td>
        </tr>`;
    }).join("");
    return `<table class="idx">
      <tr><th>Spieler</th><th>Gear-Probleme</th><th>${hicon(ic.destruction)}${hicon(ic.haste)}${hicon(ic.mana)} Potions</th><th></th></tr>
      ${body}
    </table>`;
}

function renderSunderPanel(rows, linkFor) {
    if (!rows || rows.length === 0) return "<div class=\"empty\">Keine Sunder-Armor-Daten gefunden.</div>";
    const body = rows.map((p) => {
        const warn = p.below5 > 0 ? "pct-part" : "pct-full";
        return `<tr>
          <td>${classCell(p, linkFor(p.name))}</td>
          <td class="srval">${esc(p.total)}</td>
          <td><span class="pct ${warn}">${esc(p.below5)}</span></td>
        </tr>`;
    }).join("");
    return `<p class="note">„&lt; 5 Stacks" = Sunder, die angewandt wurden, während der Boss noch keine 5 Stacks hatte (Stack-Aufbau).</p>
    <table class="idx">
      <tr><th>Spieler</th><th>Sunder gesamt</th><th>davon bei &lt; 5 Stacks</th></tr>
      ${body}
    </table>`;
}

function uptimeCell(v) {
    const cls = v >= 95 ? "pct-full" : v >= 70 ? "pct-part" : "pct-none";
    return `<span class="pct ${cls}">${v}%</span>`;
}

function renderBossUptimesPanel(data) {
    if (!data || !data.rows || data.rows.length === 0) return "<div class=\"empty\">Keine Boss-Daten gefunden.</div>";
    const head = data.metrics.map((m) => `<th>${esc(m.label)}</th>`).join("");
    const body = data.rows.map((r) => {
        const cells = data.metrics.map((m) => `<td>${uptimeCell(r[m.key] || 0)}</td>`).join("");
        const boss = r.kill ? esc(r.boss) : `${esc(r.boss)} <span class="sritems">(Wipe)</span>`;
        return `<tr><td>${boss}</td>${cells}</tr>`;
    }).join("");
    return `<p class="note">Debuff-Uptime pro Boss-Kampf (in % der Kampfdauer).</p>
    <table class="idx">
      <tr><th>Boss</th>${head}</tr>
      ${body}
    </table>`;
}

function renderReportPage(report, user) {
    const players = report.players || [];
    const dateStr = report.date ? esc(report.date) : "";
    const sub = [
        report.zone ? `Zone: ${esc(report.zone)}` : "",
        dateStr,
        report.reportUrl ? `<a href="${esc(report.reportUrl)}" target="_blank" rel="noopener">→ Warcraft Logs</a>` : "",
    ].filter(Boolean).join(" · ");

    // map player name -> detail page url
    const idxByName = {};
    (report.roster || []).forEach((p, i) => { idxByName[p.name] = i; });
    const linkFor = (name) => (idxByName[name] !== undefined ? `/r/${report.id}/p/${idxByName[name]}` : null);

    const hasConsum = report.consumables && report.consumables.players && report.consumables.players.length;
    const hasPotions = report.potions && report.potions.players && report.potions.players.length;
    const hasShadow = report.shadowResi && report.shadowResi.players && report.shadowResi.players.length;
    const hasDrums = report.drums && report.drums.players && report.drums.players.length;
    const hasRoster = report.roster && report.roster.length;
    const hasSunder = report.sunder && report.sunder.length;
    const hasBoss = report.bossUptimes && report.bossUptimes.rows && report.bossUptimes.rows.length;

    const tabDefs = [
        { id: "roster", label: "👥 Raider", show: hasRoster, html: renderRosterPanel(report, linkFor) },
        { id: "gear", label: "🛡️ Gear Issues", show: true, html: renderGearPanel(players, linkFor) },
        { id: "consumables", label: "🧪 Consumables", show: hasConsum, html: renderConsumablesPanel(report.consumables, linkFor) },
        { id: "potions", label: "⚗️ Potions", show: hasPotions, html: renderPotionsPanel(report.potions, linkFor) },
        { id: "drums", label: "🥁 Drums", show: hasDrums, html: renderDrumsPanel(report.drums, linkFor) },
        { id: "sunder", label: "🪓 Sunder Armor", show: hasSunder, html: renderSunderPanel(report.sunder, linkFor) },
        { id: "bosses", label: "📊 Bosse", show: hasBoss, html: renderBossUptimesPanel(report.bossUptimes) },
        { id: "shadowresi", label: "🌑 Shadow-Resi", show: hasShadow, html: renderShadowResiPanel(report.shadowResi, linkFor) },
    ].filter((t) => t.show);

    const buttons = tabDefs.map((t, i) =>
        `<button data-tab="${t.id}"${i === 0 ? " class=\"active\"" : ""}>${t.label}</button>`).join("");
    const panels = tabDefs.map((t, i) =>
        `<div id="tab-${t.id}" class="tabpanel${i === 0 ? " active" : ""}">${t.html}</div>`).join("");

    const body = `
      <div style="text-align:right;margin-bottom:8px">${authBar(user)}</div>
      <h1>${esc(report.title || "Log-Check")}</h1>
      <p class="sub">${sub} · <a href="/">alle Auswertungen</a></p>
      <nav class="tabs">${buttons}</nav>
      ${panels}`;

    return layout(report.title ? `Log-Check: ${report.title}` : "Log-Check", body);
}

const QUALITY_COLOR = { 0: "#9d9d9d", 1: "#ffffff", 2: "#1eff00", 3: "#0070dd", 4: "#a335ee", 5: "#ff8000" };

// Wowhead item link with enchant + gems so the tooltip shows the authoritative TBC data.
function wowheadItemUrl(it) {
    const params = [];
    if (it.enchant && it.enchant.enchantId) params.push(`ench=${encodeURIComponent(it.enchant.enchantId)}`);
    const gemIds = (it.gems || []).map((g) => g.id).filter(Boolean);
    if (gemIds.length) params.push(`gems=${gemIds.join(":")}`);
    const qs = params.length ? `?${params.join("&")}` : "";
    return `https://www.wowhead.com/tbc/item=${esc(it.itemId)}${qs}`;
}

// one equipment slot in the paperdoll (side = "left"/"right"/"bottom" controls alignment)
function paperdollSlot(it, side) {
    if (!it) return `<div class="slot empty-slot slot-${side}"><div class="slot-ph"></div></div>`;
    const q = QUALITY_COLOR[it.quality] !== undefined ? QUALITY_COLOR[it.quality] : "#2c313b";
    const href = wowheadItemUrl(it);
    const img = `<img src="${esc(iconUrl(it.icon))}" loading="lazy" alt="">`;
    // enchant badge + status line (value comes from the Wowhead tooltip, not WCL)
    let badge = "";
    let ench = "";
    if (it.enchant.status === "missing") {
        badge = "<span class=\"badge b-miss\" title=\"keine Verzauberung\">✗</span>";
        ench = "<div class=\"slot-ench miss\">keine Verzauberung</div>";
    } else if (it.enchant.status === "bad") {
        badge = `<span class="badge b-bad" title="${esc(it.enchant.reason || "suboptimale Verzauberung")}">!</span>`;
        ench = `<div class="slot-ench bad">suboptimale Verzauberung${it.enchant.reason ? ` · ${esc(it.enchant.reason)}` : ""}</div>`;
    } else if (it.enchant.status === "ok") {
        badge = "<span class=\"badge b-ok\" title=\"verzaubert (Details im Tooltip)\">✓</span>";
        ench = "<div class=\"slot-ench ok\">verzaubert</div>";
    }
    // real gem icons + empty sockets
    let gems = (it.gems || []).map((g) =>
        `<a class="gemicon ${g.bad ? "gem-bad" : ""}" href="https://www.wowhead.com/tbc/item=${esc(g.id)}" target="_blank" rel="noopener" title="${g.bad ? "suboptimaler Edelstein" : "Edelstein"}"><img src="${esc(iconUrl(g.icon))}" alt=""></a>`).join("");
    for (let i = 0; i < (it.emptySockets || 0); i++) gems += "<span class=\"gemicon gem-empty\" title=\"leerer Sockel\"></span>";
    const gemsRow = gems ? `<div class="slot-gems">${gems}</div>` : "";
    return `<div class="slot slot-${side}">
      <a class="slot-icon" style="border-color:${q}" href="${href}" target="_blank" rel="noopener" title="${esc(it.itemName)}">${img}${badge}</a>
      <div class="slot-info">
        <a class="slot-name" style="color:${q}" href="${href}" target="_blank" rel="noopener">${esc(it.itemName)}</a>
        ${ench}
        ${gemsRow}
      </div>
    </div>`;
}

function renderPlayerPage(report, idx, user) {
    const p = (report.roster || [])[idx];
    if (!p) return renderNotFound();
    const color = CLASS_COLORS[p.type] || "#ddd";
    const pot = p.potions || {};
    const ic = report.icons || {};
    const bySlot = {};
    for (const it of p.armory || []) bySlot[it.slot] = it;

    const ilvls = (p.armory || []).map((i) => i.itemLevel).filter((n) => n > 0);
    const avgIlvl = ilvls.length ? Math.round(ilvls.reduce((a, b) => a + b, 0) / ilvls.length) : 0;
    const issueCount = (p.issues || []).length;

    const LEFT = [0, 1, 2, 14, 4, 8];
    const RIGHT = [9, 5, 6, 7, 10, 11, 12, 13];
    const BOTTOM = [15, 16, 17];
    const left = LEFT.map((s) => paperdollSlot(bySlot[s], "left")).join("");
    const right = RIGHT.map((s) => paperdollSlot(bySlot[s], "right")).join("");
    const bottom = BOTTOM.map((s) => paperdollSlot(bySlot[s], "bottom")).join("");

    const potChip = (icon, label, n) => `<span class="chip">${hicon(icon, label)}<b>${esc(n || 0)}</b> ${esc(label)}</span>`;

    const issues = issueCount
        ? `<ul class="issues" style="background:var(--panel);border:1px solid #2c313b;border-radius:10px">${p.issues.map(issueRow).join("")}</ul>`
        : "<div class=\"empty\">Keine Gear-Probleme 🎉</div>";

    const body = `
      <div style="text-align:right;margin-bottom:8px">${authBar(user)}</div>
      <p class="sub"><a href="/r/${esc(report.id)}">← zurück zum Report</a> · ${esc(report.title || "")}</p>
      <div class="hero" style="--cc:${color}">
        <div class="hero-bg"></div>
        <img class="hero-class" src="${esc(classIconUrl(p.type))}" alt="${esc(p.type)}">
        <div class="hero-main">
          <div class="hero-name" style="color:${color}">${esc(p.name)}</div>
          <div class="hero-sub">Stufe 70 · ${esc(p.type)}</div>
          <div class="chips">
            <span class="chip ${issueCount ? "chip-warn" : "chip-ok"}"><b>${issueCount}</b> Gear-Probleme</span>
            ${potChip(ic.destruction, "Destruction", pot.destruction)}
            ${potChip(ic.haste, "Haste", pot.haste)}
            ${potChip(ic.mana, "Mana", pot.mana)}
          </div>
        </div>
      </div>
      <div class="doll" style="--cc:${color}">
        <div class="pd-col pd-col-left">${left}</div>
        <div class="pd-center">
          <div class="portrait" style="--cc:${color}">
            <img src="${esc(classIconUrl(p.type))}" alt="">
          </div>
          <div class="ilvl-badge"><b>${avgIlvl}</b><span>⌀ iLvl</span></div>
        </div>
        <div class="pd-col pd-col-right">${right}</div>
      </div>
      <div class="doll-bottom">${bottom}</div>
      <h2>Gear-Probleme</h2>
      ${issues}`;

    return layout(`${p.name} — ${report.title || ""}`, body);
}

function authBar(user) {
    if (user && user.name) {
        const admin = user.isAdmin ? " · <a href=\"/admin\" style=\"color:var(--accent);text-decoration:none\">Admin-Menü</a>" : "";
        return `<span class="sub">Eingeloggt als <strong>${esc(user.name)}</strong>${admin} · <a href="/auth/logout">Logout</a></span>`;
    }
    return `<a class="discord-btn" href="/auth/login">${DISCORD_LOGO}<span>Mit Discord einloggen</span></a>`;
}

function renderNotFound() {
    return layout("Nicht gefunden", "<h1>404</h1><p class=\"sub\">Diese Seite existiert nicht (mehr). <a href=\"/\">Zur Übersicht</a></p>");
}

function renderError(title, message) {
    return layout(title, `<h1>${esc(title)}</h1><p class="sub">${esc(message)}</p><p class="sub"><a href="/">Zur Übersicht</a> · <a href="/auth/login">Erneut einloggen</a></p>`);
}

module.exports = { renderReportPage, renderPlayerPage, renderNotFound, renderError, layout, esc, authBar, themeToggleBtn };
