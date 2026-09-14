// Server-rendered admin chrome (sidebar + topbar) for the SSR log-check pages.
// An admin who opens a report at /r/<id> keeps the same navigation as the React
// admin instead of landing on a bare public page.
//
// The menu entries come from src/config/menu.js — the same list the React shell
// (src/web-client/src/components/Shell.tsx) renders, WoW icons included — so the
// two menus can no longer drift apart (this copy once lacked Roster and
// Loot-Council). The styles mirror the shell block of
// src/web-client/src/index.css. (The report pages stay server-rendered because
// they are public links posted to Discord; only the chrome around them is
// duplicated, not a page.)
const { MENU, wowIconUrl } = require("../config/menu");

// Line icons for the pure UI functions (brand, burger, logout) — everything with
// a game meaning is a WoW icon.
const ICONS = {
    crest: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linejoin=\"round\"><path d=\"M12 2 4 6v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6l-8-4Z\"/><path d=\"m9 12 2 2 4-4\" stroke-linecap=\"round\"/></svg>",
    burger: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"><path d=\"M4 6h16M4 12h16M4 18h16\"/></svg>",
    logout: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.9\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3\"/><path d=\"M10 17l5-5-5-5M15 12H4\"/></svg>",
};

// The menu as the chrome renders it: every entry of config/menu.js with its
// icon url resolved.
const TABS = MENU.map((entry) => ({ ...entry, iconUrl: wowIconUrl(entry.wowIcon, 24) }));

// One accent per section for the active entry, the --area-* tokens of render.js.
const AREA_STYLE = MENU.map((e) => `  .nav-item.area-${e.id} { --area:var(--area-${e.id}); --area-soft:var(--area-${e.id}-soft); }`).join("\n");

// Shell layout, ported from the "sidebar app shell" block of index.css so the
// SSR pages line up pixel-wise with the React admin.
const CHROME_STYLE = `
  .app { display:grid; grid-template-columns:248px 1fr; min-height:100vh; }
  .side { background:var(--panel); border-right:1px solid var(--line); display:flex; flex-direction:column; position:sticky; top:0; height:100vh; align-self:start; }
  .brand { display:flex; align-items:center; gap:12px; padding:18px 18px 16px; border-bottom:1px solid var(--line-soft); text-decoration:none; color:inherit; }
  .crest { width:40px; height:40px; border-radius:10px; flex:0 0 auto; display:grid; place-items:center; background:linear-gradient(150deg, var(--accent), var(--accent-2)); color:var(--accent-ink); }
  .crest svg { width:22px; height:22px; }
  .brand-name { font-weight:800; font-size:16px; }
  .brand-sub { font-size:10.5px; font-family:var(--font-mono); color:var(--muted); text-transform:uppercase; letter-spacing:1.2px; margin-top:1px; }
  nav.menu { padding:12px 10px; display:flex; flex-direction:column; gap:2px; flex:1; overflow-y:auto; }
  .menu-label { font-size:10.5px; font-family:var(--font-mono); text-transform:uppercase; letter-spacing:1.3px; color:var(--muted); opacity:.7; padding:14px 12px 6px; }
  .nav-item { --area:var(--accent); --area-soft:var(--accent-soft); display:flex; align-items:center; gap:12px; padding:7px 12px; border-radius:8px; color:var(--muted); font-weight:600; font-size:14.5px; text-decoration:none; border:1px solid transparent; position:relative; transition:background .12s, color .12s, border-color .12s; }
  .nav-item .wi { width:24px; height:24px; border-radius:6px; border:1px solid var(--line); flex:0 0 auto; object-fit:cover; filter:saturate(.45) brightness(.8); transition:filter .12s, box-shadow .12s, border-color .12s; }
  .nav-item:hover { background:var(--panel2); color:var(--text); }
  .nav-item:hover .wi, .nav-item:focus-visible .wi { filter:none; }
  .nav-item.active { background:var(--area-soft); color:var(--text); border-color:var(--area-soft); }
  .nav-item.active::before { content:""; position:absolute; left:-10px; top:8px; bottom:8px; width:3px; border-radius:3px; background:var(--area); }
  .nav-item.active .wi { filter:none; border-color:var(--area); box-shadow:0 0 0 2px var(--area-soft); }
${AREA_STYLE}
  .side-foot { padding:12px 14px; border-top:1px solid var(--line-soft); display:flex; align-items:center; gap:10px; }
  .avatar { width:34px; height:34px; border-radius:50%; background:var(--panel2); display:grid; place-items:center; font-weight:800; color:var(--accent); border:1px solid var(--line); flex:0 0 auto; }
  .ub-meta { min-width:0; flex:1; }
  .u-name { font-size:13.5px; font-weight:700; line-height:1.2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .u-role { font-size:11.5px; color:var(--muted); }
  .ibtn { width:38px; height:38px; display:inline-grid; place-items:center; padding:0; flex:0 0 auto; border-radius:8px; border:1px solid var(--line); background:var(--panel2); color:var(--muted); cursor:pointer; text-decoration:none; transition:color .12s, border-color .12s, background-color .12s; }
  .ibtn svg { width:17px; height:17px; }
  .ibtn.sm { width:32px; height:32px; }
  .ibtn.sm svg { width:15px; height:15px; }
  .ibtn:hover { color:var(--text); border-color:var(--accent); background:var(--panel3); }
  .main { display:flex; flex-direction:column; min-width:0; }
  .topbar { display:flex; align-items:center; gap:14px; padding:12px 24px; border-bottom:1px solid var(--line); background:var(--bg); position:sticky; top:0; z-index:5; flex-wrap:wrap; }
  .crumbs { font-size:13.5px; color:var(--muted); }
  .crumbs b { color:var(--text); font-weight:700; }
  .crumbs a { color:inherit; text-decoration:none; }
  .crumbs a:hover { color:var(--accent); text-decoration:underline; }
  .crumb-sep { opacity:.45; }
  .top-actions { margin-left:auto; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .ibtn.menu-toggle { display:none; }
  .content { padding:24px; max-width:1080px; width:100%; }
  @media (max-width:900px) {
    .app { grid-template-columns:1fr; }
    .side { position:fixed; z-index:30; width:264px; transform:translateX(-102%); transition:transform .2s; box-shadow:0 8px 28px rgba(0,0,0,.35); }
    .side.open { transform:none; }
    .ibtn.menu-toggle { display:inline-grid; }
    .content { padding:18px 14px; }
  }`;

// Toggles the off-canvas sidebar on small screens (the React shell's menuOpen state).
const CHROME_SCRIPT = `
(function(){
  var btn=document.getElementById("menuBtn"), side=document.getElementById("sideNav");
  if(!btn||!side) return;
  btn.addEventListener("click",function(){ side.classList.toggle("open"); });
})();`;

function navHtml(activeTab) {
    let lastGroup = null;
    return TABS.map((tab) => {
        const label = tab.group !== lastGroup ? `<div class="menu-label">${tab.group}</div>` : "";
        lastGroup = tab.group;
        const active = tab.id === activeTab ? " active" : "";
        return `${label}<a class="nav-item area-${tab.id}${active}" href="${tab.href}"><img class="wi" src="${tab.iconUrl}" alt=""><span>${tab.label}</span></a>`;
    }).join("");
}

/**
 * Renders the admin sidebar + topbar around a page body.
 * @param {object} opts
 *   user     — the logged-in admin ({ name })
 *   activeTab— TABS id to highlight (e.g. "cla")
 *   crumbs   — [{ label, href? }]; the last entry renders bold
 *   body     — page HTML placed inside .content
 *   actions  — extra HTML for the topbar's right side (theme toggle etc.)
 *   esc      — the caller's HTML escaper (render.js owns it)
 */
function renderAdminChrome({ user, activeTab, crumbs = [], body = "", actions = "", esc }) {
    const name = (user && user.name) || "Admin";
    const initial = name.slice(0, 1).toUpperCase() || "A";
    const crumbHtml = crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        const label = esc(c.label);
        const item = !last && c.href ? `<a href="${esc(c.href)}">${label}</a>` : `<b>${label}</b>`;
        return (i ? " <span class=\"crumb-sep\">/</span> " : "") + item;
    }).join("");

    return `<div class="app">
  <aside class="side" id="sideNav">
    <a class="brand" href="/">
      <div class="crest">${ICONS.crest}</div>
      <div>
        <div class="brand-name">EventHelper</div>
        <div class="brand-sub">Gildenmenü</div>
      </div>
    </a>
    <nav class="menu">${navHtml(activeTab)}</nav>
    <div class="side-foot">
      <div class="avatar">${esc(initial)}</div>
      <div class="ub-meta">
        <div class="u-name">${esc(name)}</div>
        <div class="u-role">Administrator</div>
      </div>
      <a class="ibtn sm u-logout" href="/auth/logout" aria-label="Logout" data-tip="Logout" data-tip-sub="Vom Gildenmenü abmelden">${ICONS.logout}</a>
    </div>
  </aside>
  <div class="main">
    <header class="topbar">
      <button class="ibtn menu-toggle" id="menuBtn" type="button" aria-label="Menü" data-tip="Menü">${ICONS.burger}</button>
      <div class="crumbs">${crumbHtml}</div>
      <div class="top-actions">${actions}</div>
    </header>
    <div class="content">${body}</div>
  </div>
</div>
<script>${CHROME_SCRIPT}</script>`;
}

module.exports = { renderAdminChrome, CHROME_STYLE, TABS, ICONS };
