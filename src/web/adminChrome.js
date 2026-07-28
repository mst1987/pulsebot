// Server-rendered admin chrome (sidebar + topbar) for the SSR log-check pages.
// An admin who opens a report at /r/<id> keeps the same navigation as the React
// admin instead of landing on a bare public page.
//
// The tab list mirrors src/web-client/src/components/Shell.tsx's TABS and the
// icons/styles mirror src/web-client/src/components/icons.tsx + the shell block
// of src/web-client/src/index.css — keep both sides in sync when the admin shell
// changes. (The report pages stay server-rendered because they are public links
// posted to Discord; only the chrome around them is duplicated, not a page.)

const ICONS = {
    crest: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linejoin=\"round\"><path d=\"M12 2 4 6v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6l-8-4Z\"/><path d=\"m9 12 2 2 4-4\" stroke-linecap=\"round\"/></svg>",
    burger: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"><path d=\"M4 6h16M4 12h16M4 18h16\"/></svg>",
    home: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\"><rect x=\"3\" y=\"3\" width=\"7\" height=\"9\" rx=\"1.5\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"5\" rx=\"1.5\"/><rect x=\"14\" y=\"12\" width=\"7\" height=\"9\" rx=\"1.5\"/><rect x=\"3\" y=\"16\" width=\"7\" height=\"5\" rx=\"1.5\"/></svg>",
    recruitment: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/><path d=\"M19 8v6M22 11h-6\"/></svg>",
    cla: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 3v16a2 2 0 0 0 2 2h16\"/><path d=\"m7 14 3-4 3 3 4-6\"/></svg>",
    raids: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"3\" y=\"4\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"M16 2v4M8 2v4M3 10h18\"/></svg>",
    history: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 3v5h5\"/><path d=\"M3.05 13A9 9 0 1 0 6 5.3L3 8\"/><path d=\"M12 7v5l3 2\"/></svg>",
    channels: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 9h16M4 15h16M10 3 8 21M16 3l-2 18\"/></svg>",
    settings: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z\"/></svg>",
};

// Same order/grouping as Shell.tsx's TABS; hrefs carry the SPA's /admin basename.
const TABS = [
    { id: "home", label: "Übersicht", href: "/admin", group: "Verwaltung", icon: ICONS.home },
    { id: "recruitment", label: "Recruitment", href: "/admin/recruitment", group: "Verwaltung", icon: ICONS.recruitment },
    { id: "cla", label: "CLA / Logcheck", href: "/admin/cla", group: "Verwaltung", icon: ICONS.cla },
    { id: "raids", label: "Raid-Events", href: "/admin/raids", group: "Verwaltung", icon: ICONS.raids },
    { id: "history", label: "Historie & Loot", href: "/admin/history", group: "Verwaltung", icon: ICONS.history },
    { id: "channels", label: "Kanäle", href: "/admin/channels", group: "Verwaltung", icon: ICONS.channels },
    { id: "settings", label: "Einstellungen", href: "/admin/settings", group: "System", icon: ICONS.settings },
];

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
  .nav-item { display:flex; align-items:center; gap:12px; padding:9px 12px; border-radius:8px; color:var(--muted); font-weight:600; font-size:14.5px; text-decoration:none; border:1px solid transparent; transition:background .12s, color .12s, border-color .12s; }
  .nav-item svg { width:19px; height:19px; flex:0 0 auto; }
  .nav-item:hover { background:var(--panel2); color:var(--text); }
  .nav-item.active { background:var(--accent-soft); color:var(--text); border-color:var(--accent-soft); position:relative; }
  .nav-item.active::before { content:""; position:absolute; left:-10px; top:8px; bottom:8px; width:3px; border-radius:3px; background:var(--accent); }
  .nav-item.active svg { color:var(--accent); }
  .nav-item.area-cla.active { background:var(--area-cla-soft); border-color:var(--area-cla-soft); }
  .nav-item.area-cla.active::before { background:var(--area-cla); }
  .nav-item.area-cla.active svg { color:var(--area-cla); }
  .side-foot { padding:12px 14px; border-top:1px solid var(--line-soft); display:flex; align-items:center; gap:10px; }
  .avatar { width:34px; height:34px; border-radius:50%; background:var(--panel2); display:grid; place-items:center; font-weight:800; color:var(--accent); border:1px solid var(--line); flex:0 0 auto; }
  .ub-meta { min-width:0; flex:1; }
  .u-name { font-size:13.5px; font-weight:700; line-height:1.2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .u-role { font-size:11.5px; color:var(--muted); }
  .u-logout { font-size:12px; color:var(--muted); text-decoration:none; }
  .u-logout:hover { color:var(--accent); }
  .main { display:flex; flex-direction:column; min-width:0; }
  .topbar { display:flex; align-items:center; gap:14px; padding:12px 24px; border-bottom:1px solid var(--line); background:var(--bg); position:sticky; top:0; z-index:5; flex-wrap:wrap; }
  .crumbs { font-size:13.5px; color:var(--muted); }
  .crumbs b { color:var(--text); font-weight:700; }
  .crumbs a { color:inherit; text-decoration:none; }
  .crumbs a:hover { color:var(--accent); text-decoration:underline; }
  .crumb-sep { opacity:.45; }
  .top-actions { margin-left:auto; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .menu-toggle { display:none; }
  .content { padding:24px; max-width:1080px; width:100%; }
  @media (max-width:900px) {
    .app { grid-template-columns:1fr; }
    .side { position:fixed; z-index:30; width:264px; transform:translateX(-102%); transition:transform .2s; box-shadow:0 8px 28px rgba(0,0,0,.35); }
    .side.open { transform:none; }
    .menu-toggle { display:inline-grid; place-items:center; width:38px; height:38px; border-radius:8px; border:1px solid var(--line); background:var(--panel2); color:var(--text); cursor:pointer; }
    .menu-toggle svg { width:18px; height:18px; }
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
        return `${label}<a class="nav-item area-${tab.id}${active}" href="${tab.href}">${tab.icon}<span>${tab.label}</span></a>`;
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
    <a class="brand" href="/admin">
      <div class="crest">${ICONS.crest}</div>
      <div>
        <div class="brand-name">EventHelper</div>
        <div class="brand-sub">Gilden-Admin</div>
      </div>
    </a>
    <nav class="menu">${navHtml(activeTab)}</nav>
    <div class="side-foot">
      <div class="avatar">${esc(initial)}</div>
      <div class="ub-meta">
        <div class="u-name">${esc(name)}</div>
        <div class="u-role">Administrator</div>
      </div>
      <a class="u-logout" href="/auth/logout">Logout</a>
    </div>
  </aside>
  <div class="main">
    <header class="topbar">
      <button class="menu-toggle" id="menuBtn" type="button" aria-label="Menü">${ICONS.burger}</button>
      <div class="crumbs">${crumbHtml}</div>
      <div class="top-actions">${actions}</div>
    </header>
    <div class="content">${body}</div>
  </div>
</div>
<script>${CHROME_SCRIPT}</script>`;
}

module.exports = { renderAdminChrome, CHROME_STYLE, TABS, ICONS };
