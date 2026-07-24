// HTML rendering for the web admin menu. Reuses the shared page shell (layout)
// + esc/authBar/themeToggleBtn from render.js and adds the admin sidebar shell.

const { layout, esc, authBar, themeToggleBtn } = require("./render");

// admin-specific styling, injected once per admin page (in addition to layout's base <style>)
const ADMIN_STYLE = `<style>
  /* ===== sidebar app shell ===== */
  .app { display:grid; grid-template-columns:248px 1fr; min-height:100vh; }
  .side { background:var(--panel); border-right:1px solid var(--line); display:flex; flex-direction:column; position:sticky; top:0; height:100vh; align-self:start; }
  .brand { display:flex; align-items:center; gap:12px; padding:18px 18px 16px; border-bottom:1px solid var(--line-soft); }
  .crest { width:40px; height:40px; border-radius:10px; flex:0 0 auto; display:grid; place-items:center; background:linear-gradient(150deg,var(--accent),var(--accent-2)); color:var(--accent-ink); }
  .crest svg { width:22px; height:22px; }
  .brand-name { font-weight:800; font-size:16px; }
  .brand-sub { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:1.2px; margin-top:1px; }
  nav.menu { padding:12px 10px; display:flex; flex-direction:column; gap:2px; flex:1; overflow-y:auto; }
  .menu-label { font-size:11px; text-transform:uppercase; letter-spacing:1.3px; color:var(--muted); opacity:.7; padding:14px 12px 6px; }
  .nav-item { display:flex; align-items:center; gap:12px; padding:9px 12px; border-radius:8px; color:var(--muted); font-weight:600; font-size:14.5px; text-decoration:none; border:1px solid transparent; transition:background .12s,color .12s,border-color .12s; }
  .nav-item svg { width:19px; height:19px; flex:0 0 auto; }
  .nav-item:hover { background:var(--panel2); color:var(--text); }
  .nav-item.active { background:var(--accent-soft); color:var(--text); border-color:var(--accent-soft); position:relative; }
  .nav-item.active::before { content:""; position:absolute; left:-10px; top:8px; bottom:8px; width:3px; border-radius:3px; background:var(--accent); }
  .nav-item.active svg { color:var(--accent); }
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
  .crumbs b { color:var(--text); }
  .top-actions { margin-left:auto; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .menu-toggle { display:none; }
  .content { padding:24px; max-width:1080px; width:100%; }
  .page-title { font-size:24px; font-weight:800; letter-spacing:-.3px; margin:0 0 18px; }
  /* ===== admin components ===== */
  .cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:14px; }
  .navcard { display:block; background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:18px; text-decoration:none; transition:background .12s, border-color .12s; }
  .navcard:hover { background:var(--panel2); border-color:var(--accent); }
  .navcard h3 { margin:0 0 6px; font-size:17px; }
  .navcard p { margin:0; color:var(--muted); font-size:13.5px; }
  .navcard .ico { display:inline-grid; place-items:center; width:38px; height:38px; border-radius:9px; background:var(--accent-soft); color:var(--accent); margin-bottom:10px; }
  .navcard .ico svg { width:20px; height:20px; }
  form.card-form { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:18px; margin:0 0 16px; }
  .field { margin-bottom:14px; }
  .field label { display:block; font-size:13px; color:var(--muted); margin-bottom:5px; font-weight:600; }
  .field input[type=text], .field input[type=url], .field textarea, .field select {
    width:100%; background:var(--bg); color:var(--text); border:1px solid var(--line); border-radius:8px; padding:9px 11px; font:inherit; }
  .field input:focus, .field textarea:focus, .field select:focus { border-color:var(--accent); outline:none; }
  .field textarea { min-height:120px; resize:vertical; }
  .field .hint { color:var(--muted); font-size:12px; margin-top:4px; }
  .btn { display:inline-block; background:var(--accent); color:var(--accent-ink); border:0; border-radius:8px; padding:9px 18px; font-weight:700; font-size:14px; cursor:pointer; text-decoration:none; }
  .btn:hover { filter:brightness(1.08); }
  .btn-ghost { background:var(--panel2); color:var(--text); border:1px solid var(--line); }
  .btn-ghost:hover { filter:none; background:var(--panel3); }
  .btn-danger { background:var(--high-bg); color:var(--high); border:1px solid var(--high); }
  .btn-danger:hover { filter:none; background:var(--high); color:#fff; }
  .row-actions { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  .flash { border-radius:8px; padding:10px 14px; margin-bottom:16px; font-size:14px; }
  .flash-ok { background:var(--good-bg); color:var(--good); border:1px solid var(--good); }
  .flash-err { background:var(--high-bg); color:var(--high); border:1px solid var(--high); }
  .serverbar { display:flex; align-items:center; gap:8px; margin:0; flex-wrap:wrap; }
  .serverbar label { color:var(--muted); font-size:13px; font-weight:600; margin:0; }
  .serverbar select { background:var(--panel2); color:var(--text); border:1px solid var(--line); border-radius:8px; padding:6px 10px; font:inherit; }
  .serverbar .hint { color:var(--medium); font-size:12.5px; }
  a.mlink { color:var(--accent); text-decoration:none; }
  a.mlink:hover { text-decoration:underline; }
  .rolegrid { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:6px; max-height:220px; overflow-y:auto; border:1px solid var(--line); border-radius:8px; padding:10px; background:var(--bg); }
  .rolebox { display:flex; align-items:center; gap:8px; font-size:13.5px; color:var(--text); font-weight:500; cursor:pointer; }
  .rolebox input { width:auto; }
  /* emoji picker */
  .emoji-picker { position:relative; display:inline-block; margin-top:2px; }
  .emoji-panel { display:none; position:absolute; z-index:20; top:calc(100% + 6px); left:0; width:288px; background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:10px; box-shadow:0 8px 28px rgba(0,0,0,.35); }
  .emoji-panel.open { display:block; }
  .emoji-search { width:100%; background:var(--bg); color:var(--text); border:1px solid var(--line); border-radius:8px; padding:7px 10px; font:inherit; margin-bottom:8px; }
  .emoji-search:focus { border-color:var(--accent); outline:none; }
  .emoji-grid { display:grid; grid-template-columns:repeat(6,1fr); gap:4px; max-height:220px; overflow-y:auto; }
  .emoji-item { display:grid; place-items:center; padding:5px; background:transparent; border:1px solid transparent; border-radius:7px; cursor:pointer; }
  .emoji-item:hover { background:var(--panel2); border-color:var(--line); }
  .emoji-item img { width:26px; height:26px; object-fit:contain; }
  .emoji-empty { color:var(--muted); font-size:12.5px; padding:6px 2px; }
  /* setup (raidplan comp) */
  .setup-summary { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px; }
  .setup-count { background:var(--panel2); border:1px solid var(--line); border-radius:999px; padding:4px 12px; font-size:13px; color:var(--muted); }
  .setup-count b { color:var(--text); font-variant-numeric:tabular-nums; }
  .setup-count.setup-total { border-color:var(--accent-soft); background:var(--accent-soft); }
  .setup-role { margin-bottom:16px; }
  .setup-role-head { font-size:12.5px; text-transform:uppercase; letter-spacing:.7px; color:var(--muted); margin:0 0 8px; }
  .setup-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:8px; }
  .setup-player { display:flex; align-items:center; gap:9px; background:var(--panel); border:1px solid var(--line); border-left:3px solid var(--line); border-radius:8px; padding:7px 11px; min-width:0; }
  .setup-ico { width:24px; height:24px; border-radius:5px; flex:0 0 auto; }
  .setup-ico-blank { background:var(--panel2); border:1px solid var(--line); }
  .setup-player .sp-name { font-weight:700; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .setup-player .sp-spec { font-size:12px; color:var(--muted); margin-left:auto; white-space:nowrap; flex:0 0 auto; }
  .sheetcard { background:var(--panel2); border:1px solid var(--line); border-radius:10px; padding:14px; margin-bottom:12px; }
  table.idx td.small { white-space:nowrap; color:var(--muted); font-size:12.5px; }
  /* dashboard */
  .tiles { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-bottom:20px; }
  .tile { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:15px 16px; }
  .tile.accent { border-top:2px solid var(--accent); }
  .tile .t-label { font-size:12.5px; color:var(--muted); font-weight:600; }
  .tile .t-value { font-size:28px; font-weight:800; letter-spacing:-.5px; margin-top:6px; line-height:1; font-variant-numeric:tabular-nums; }
  .tile .t-sub { font-size:12.5px; color:var(--muted); margin-top:6px; }
  .dash-grid { display:grid; grid-template-columns:1.5fr 1fr; gap:16px; }
  .dash-card { background:var(--panel); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
  .dash-card-head { display:flex; align-items:center; gap:10px; padding:13px 16px; border-bottom:1px solid var(--line-soft); }
  .dash-card-head h3 { font-size:15px; margin:0; }
  .dash-card-head .mlink { margin-left:auto; font-size:13px; }
  .dash-card table.idx { margin:0; }
  .dash-card table.idx th, .dash-card table.idx td { padding:9px 16px; }
  .quick { display:flex; flex-direction:column; }
  .quick a { display:flex; align-items:center; gap:12px; padding:12px 16px; border-top:1px solid var(--line-soft); color:var(--text); text-decoration:none; font-weight:600; font-size:14px; }
  .quick a:first-child { border-top:0; }
  .quick a:hover { background:var(--panel2); }
  .quick a .qi { width:32px; height:32px; border-radius:8px; display:grid; place-items:center; background:var(--accent-soft); color:var(--accent); flex:0 0 auto; }
  .quick a .qi svg { width:17px; height:17px; }
  @media (max-width:900px) {
    .app { grid-template-columns:1fr; }
    .side { position:fixed; z-index:30; width:264px; transform:translateX(-102%); transition:transform .2s; box-shadow:0 8px 28px rgba(0,0,0,.35); }
    .side.open { transform:none; }
    .menu-toggle { display:inline-grid; place-items:center; width:38px; height:38px; border-radius:8px; border:1px solid var(--line); background:var(--panel2); color:var(--text); cursor:pointer; }
    .content { padding:18px 14px; }
    .tiles { grid-template-columns:repeat(2,1fr); }
    .dash-grid { grid-template-columns:1fr; }
  }
</style>`;

// inline nav icons (stroke = currentColor)
const NAV_ICONS = {
    home: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\"><rect x=\"3\" y=\"3\" width=\"7\" height=\"9\" rx=\"1.5\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"5\" rx=\"1.5\"/><rect x=\"14\" y=\"12\" width=\"7\" height=\"9\" rx=\"1.5\"/><rect x=\"3\" y=\"16\" width=\"7\" height=\"5\" rx=\"1.5\"/></svg>",
    recruitment: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/><path d=\"M19 8v6M22 11h-6\"/></svg>",
    cla: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 3v16a2 2 0 0 0 2 2h16\"/><path d=\"m7 14 3-4 3 3 4-6\"/></svg>",
    raids: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"3\" y=\"4\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"M16 2v4M8 2v4M3 10h18\"/></svg>",
    channels: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 9h16M4 15h16M10 3 8 21M16 3l-2 18\"/></svg>",
    settings: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z\"/></svg>",
};

const TABS = [
    { id: "home", label: "Übersicht", href: "/", group: "Verwaltung" },
    { id: "recruitment", label: "Recruitment", href: "/admin/recruitment", group: "Verwaltung" },
    { id: "cla", label: "CLA / Logcheck", href: "/admin/cla", group: "Verwaltung" },
    { id: "raids", label: "Raid-Events", href: "/admin/raids", group: "Verwaltung" },
    { id: "channels", label: "Kanäle", href: "/admin/channels", group: "Verwaltung" },
    { id: "settings", label: "Einstellungen", href: "/admin/settings", group: "System" },
];

// Sidebar navigation (grouped by TABS[].group), active item highlighted.
function adminNav(active) {
    let out = "";
    let lastGroup = null;
    for (const t of TABS) {
        if (t.group !== lastGroup) {
            out += `<div class="menu-label">${esc(t.group)}</div>`;
            lastGroup = t.group;
        }
        out += `<a class="nav-item${t.id === active ? " active" : ""}" href="${t.href}">${NAV_ICONS[t.id] || ""}<span>${esc(t.label)}</span></a>`;
    }
    return `<nav class="menu">${out}</nav>`;
}

function tabLabel(active) {
    const t = TABS.find((x) => x.id === active);
    return t ? t.label : "Admin";
}

function flash(msg) {
    if (!msg) return "";
    const ok = msg.type !== "err";
    return `<div class="flash ${ok ? "flash-ok" : "flash-err"}">${esc(msg.text)}</div>`;
}

/** Server selector shown at the top of every admin page. nav = { guilds, activeGuildId, csrf }. */
function renderServerBar(nav) {
    if (!nav) return "";
    const guilds = nav.guilds || [];
    if (!guilds.length) {
        return "<div class=\"serverbar\"><span class=\"hint\">Bot ist mit keinem Server verbunden (noch nicht bereit?).</span></div>";
    }
    const active = nav.activeGuildId || "";
    const options = (active ? "" : "<option value=\"\">— Server wählen —</option>")
        + guilds.map((g) => `<option value="${esc(g.id)}"${g.id === active ? " selected" : ""}>${esc(g.name)}</option>`).join("");
    const warn = active ? "" : "<span class=\"hint\">← bitte zuerst einen Server wählen</span>";
    return `<form method="POST" action="/admin/server" class="serverbar">
      ${hiddenCsrf(nav.csrf || "")}
      <label>Server:</label>
      <select name="guildId" onchange="this.form.submit()">${options}</select>
      <noscript><button class="btn btn-ghost" type="submit">Wechseln</button></noscript>
      ${warn}
    </form>`;
}

/** A channel <select> (falls back to a text input when no server/channels are available). */
function channelSelect(name, channels, selectedId, opts = {}) {
    if (!channels || !channels.length) {
        return `<input type="text" name="${name}" value="${esc(selectedId || "")}" placeholder="Channel-ID (kein Server gewählt)"${opts.required ? " required" : ""}>`;
    }
    const options = (opts.allowEmpty ? "<option value=\"\">— Channel wählen —</option>" : "")
        + channels.map((c) => `<option value="${esc(c.id)}"${c.id === selectedId ? " selected" : ""}>#${esc(c.name)}${c.category ? ` · ${esc(c.category)}` : ""}</option>`).join("");
    return `<select name="${name}"${opts.required ? " required" : ""}>${options}</select>`;
}

function messageUrl(p) {
    return `https://discord.com/channels/${esc(p.guildId)}/${esc(p.channelId)}/${esc(p.messageId)}`;
}

// --- event link helpers (Discord post / channel / Raid-Helper raidplan) ---
function eventPostUrl(guildId, channelId, eventId) {
    return `https://discord.com/channels/${esc(guildId)}/${esc(channelId)}/${esc(eventId)}`;
}
function channelUrl(guildId, channelId) {
    return `https://discord.com/channels/${esc(guildId)}/${esc(channelId)}`;
}
function raidplanUrl(eventId) {
    return `https://raid-helper.xyz/raidplan/${esc(eventId)}`;
}
function formatEventTime(startTime) {
    const secs = Number(startTime);
    if (!secs) return "";
    return new Date(secs * 1000).toLocaleString("de-DE", {
        weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
}

const CREST_SVG = "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linejoin=\"round\"><path d=\"M12 2 4 6v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6l-8-4Z\"/><path d=\"m9 12 2 2 4-4\" stroke-linecap=\"round\"/></svg>";
const BURGER_SVG = "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"><path d=\"M4 6h16M4 12h16M4 18h16\"/></svg>";

/** Wrap admin page body in the sidebar app shell (nav + topbar + content). */
function adminLayout(title, active, user, body, msg, nav) {
    const name = (user && user.name) || "Admin";
    const initial = esc(name.slice(0, 1).toUpperCase() || "A");
    const label = esc(tabLabel(active));
    const shell = `${ADMIN_STYLE}
      <div class="app">
        <aside class="side" id="adminSide">
          <div class="brand">
            <div class="crest">${CREST_SVG}</div>
            <div><div class="brand-name">EventHelper</div><div class="brand-sub">Gilden-Admin</div></div>
          </div>
          ${adminNav(active)}
          <div class="side-foot">
            <div class="avatar">${initial}</div>
            <div class="ub-meta"><div class="u-name">${esc(name)}</div><div class="u-role">Administrator</div></div>
            <a class="u-logout" href="/auth/logout">Logout</a>
          </div>
        </aside>
        <div class="main">
          <header class="topbar">
            <button class="menu-toggle" id="adminMenuToggle" type="button" aria-label="Menü">${BURGER_SVG}</button>
            <div class="crumbs">Admin <span style="opacity:.45">/</span> <b>${label}</b></div>
            <div class="top-actions">
              ${renderServerBar(nav)}
              ${themeToggleBtn()}
            </div>
          </header>
          <div class="content">
            <h1 class="page-title">${label}</h1>
            ${flash(msg)}
            ${body}
          </div>
        </div>
      </div>
      <script>(function(){var t=document.getElementById("adminMenuToggle"),s=document.getElementById("adminSide");if(t&&s)t.addEventListener("click",function(){s.classList.toggle("open");});})();</script>`;
    return layout(title, shell, { bare: true, bodyClass: "admin" });
}

/** Shown when the visitor is not logged in or lacks admin access. */
function renderAdminDenied(user) {
    const body = user
        ? "<div class=\"empty\">Dein Discord-Konto hat keinen Admin-Zugang zu diesem Menü.</div>"
        : `<div class="empty" style="display:flex;flex-direction:column;gap:14px;align-items:center">
             <p>Bitte melde dich mit Discord an, um das Admin-Menü zu nutzen.</p>
             ${authBar(null)}
           </div>`;
    return layout("Admin — Zugang", `${ADMIN_STYLE}<h1>Pulsebot Admin</h1>${body}`);
}

// The dashboard — the app's start page. Shows key figures plus quick links.
function renderDashboard(user, opts = {}) {
    const s = opts.stats || {};
    const recent = opts.recentReports || [];
    const n = (v) => esc(String(v || 0));

    const tile = (label, value, sub, accent) =>
        `<div class="tile${accent ? " accent" : ""}"><div class="t-label">${esc(label)}</div><div class="t-value">${n(value)}</div><div class="t-sub">${sub}</div></div>`;
    const tiles = `<div class="tiles">
        ${tile("Log-Check-Auswertungen", s.reportsTotal, `${n(s.reportsWithIssues)} mit Problemen`, true)}
        ${tile("Recruitment-Vorlagen", s.templates, `${n(s.posts)} gepostete Nachrichten`)}
        ${tile("Event-Kategorien", s.categories, "in den Einstellungen gepflegt")}
        ${tile("Admin-Rollen", s.adminRoles, s.adminRoles ? "konfiguriert" : "noch keine gesetzt")}
      </div>`;

    const recentRows = recent.length
        ? recent.map((r) => {
            const when = r.generatedAt ? new Date(r.generatedAt).toLocaleDateString("de-DE") : "";
            return `<tr>
              <td><a class="mlink" href="/r/${esc(r.id)}">${esc(r.title || r.id)}</a></td>
              <td>${esc(r.zone || "")}</td>
              <td class="small">${esc(when)}</td>
              <td><span class="pill">${esc(r.issueCount)}</span></td>
            </tr>`;
        }).join("")
        : "<tr><td colspan=\"4\" class=\"sub\" style=\"padding:16px\">Noch keine Auswertungen.</td></tr>";

    const quick = (href, icon, label) =>
        `<a href="${href}"><span class="qi">${icon}</span>${esc(label)}</a>`;

    const body = `
      ${tiles}
      <div class="dash-grid">
        <div class="dash-card">
          <div class="dash-card-head"><h3>Letzte Auswertungen</h3><a class="mlink" href="/admin/cla">Alle →</a></div>
          <table class="idx">
            <thead><tr><th>Report</th><th>Zone</th><th>Erstellt</th><th>Probleme</th></tr></thead>
            <tbody>${recentRows}</tbody>
          </table>
        </div>
        <div class="dash-card">
          <div class="dash-card-head"><h3>Schnellzugriff</h3></div>
          <div class="quick">
            ${quick("/admin/recruitment", NAV_ICONS.recruitment, "Recruitment verwalten")}
            ${quick("/admin/cla", NAV_ICONS.cla, "Neue Log-Auswertung")}
            ${quick("/admin/raids", NAV_ICONS.raids, "Raid-Event anlegen")}
            ${quick("/admin/channels", NAV_ICONS.channels, "Kanäle verwalten")}
            ${quick("/admin/settings", NAV_ICONS.settings, "Einstellungen")}
          </div>
        </div>
      </div>`;
    return adminLayout("Übersicht — EventHelper Admin", "home", user, body, opts.msg, opts.nav);
}

function hiddenCsrf(csrf) {
    return `<input type="hidden" name="_csrf" value="${esc(csrf)}">`;
}

// Client-side glue for the emoji picker: inserts an emoji's Discord code
// (`<:name:id>`) into the last-focused text field of the picker's form. Guarded
// so it binds only once even if several pickers are on the page.
const EMOJI_PICKER_SCRIPT = "<script>(function(){if(window.__emojiPicker)return;window.__emojiPicker=1;"
    + "var last=null;"
    + "document.addEventListener('focusin',function(e){var el=e.target;if(el&&(el.tagName==='TEXTAREA'||(el.tagName==='INPUT'&&el.type==='text')))last=el;});"
    + "function target(p){var f=p.closest('form');if(last&&f&&f.contains(last))return last;return f?f.querySelector('textarea, input[type=text]'):last;}"
    + "document.addEventListener('click',function(e){"
    + "var t=e.target.closest('.emoji-trigger');if(t){e.preventDefault();var pn=t.parentNode.querySelector('.emoji-panel');document.querySelectorAll('.emoji-panel.open').forEach(function(o){if(o!==pn)o.classList.remove('open');});if(pn){pn.classList.toggle('open');var s=pn.querySelector('.emoji-search');if(s&&pn.classList.contains('open'))s.focus();}return;}"
    + "var it=e.target.closest('.emoji-item');if(it){e.preventDefault();var fld=target(it.closest('.emoji-picker'));if(fld){var c=it.getAttribute('data-code');var a=fld.selectionStart==null?fld.value.length:fld.selectionStart;var b=fld.selectionEnd==null?a:fld.selectionEnd;fld.value=fld.value.slice(0,a)+c+fld.value.slice(b);var pos=a+c.length;fld.focus();try{fld.setSelectionRange(pos,pos);}catch(_){}last=fld;}return;}"
    + "if(!e.target.closest('.emoji-panel'))document.querySelectorAll('.emoji-panel.open').forEach(function(o){o.classList.remove('open');});"
    + "});"
    + "document.addEventListener('input',function(e){if(e.target.classList&&e.target.classList.contains('emoji-search')){var q=e.target.value.toLowerCase();e.target.closest('.emoji-panel').querySelectorAll('.emoji-item').forEach(function(i){i.style.display=(i.getAttribute('data-name')||'').indexOf(q)===-1?'none':'';});}});"
    + "})();</script>";

/**
 * Emoji picker: a "Emoji einfügen" button + dropdown of the server's custom
 * emojis. Clicking one inserts its Discord code into the last-focused text field
 * of the same form. Returns "" when the server has no custom emojis.
 */
function emojiPicker(emojis) {
    const list = emojis || [];
    if (!list.length) return "";
    const items = list.map((em) =>
        `<button type="button" class="emoji-item" data-code="${esc(em.code)}" data-name="${esc((em.name || "").toLowerCase())}" title=":${esc(em.name)}:">`
        + `<img src="${esc(em.url)}" alt=":${esc(em.name)}:" loading="lazy"></button>`
    ).join("");
    return `<div class="emoji-picker">
      <button type="button" class="btn btn-ghost emoji-trigger">😀 Emoji einfügen</button>
      <div class="emoji-panel">
        <input type="text" class="emoji-search" placeholder="Emoji suchen …" autocomplete="off">
        <div class="emoji-grid">${items}</div>
      </div>
    </div>${EMOJI_PICKER_SCRIPT}`;
}

function templateListItem(t) {
    return `<tr>
      <td><strong>${esc(t.name || "(ohne Name)")}</strong></td>
      <td class="sub" style="margin:0">${esc(t.title || "")}</td>
      <td class="row-actions">
        <a class="btn btn-ghost" href="/admin/recruitment?edit=${esc(t.id)}">Bearbeiten</a>
        <form method="POST" action="/admin/recruitment/delete" onsubmit="return confirm('Vorlage wirklich löschen?')" style="margin:0">
          <input type="hidden" name="id" value="${esc(t.id)}">__CSRF__
          <button class="btn btn-danger" type="submit">Löschen</button>
        </form>
      </td>
    </tr>`;
}

// Edit form for a message the bot already posted (updates the Discord embed).
function renderPostEdit(user, opts) {
    const p = opts.editingPost;
    const csrfField = hiddenCsrf(opts.csrf || "");
    const body = `
      <h2>Gepostete Nachricht bearbeiten</h2>
      <p class="note">In #${esc(p.channelName || p.channelId)} · <a class="mlink" href="${messageUrl(p)}" target="_blank" rel="noopener">Nachricht öffnen</a>. Änderungen werden direkt in Discord aktualisiert.</p>
      <form class="card-form" method="POST" action="/admin/recruitment/post-update">
        ${csrfField}
        <input type="hidden" name="id" value="${esc(p.id)}">
        <div class="field">
          <label>Nachrichtentext</label>
          <textarea name="content" style="min-height:160px">${esc(p.content)}</textarea>
          <div class="hint">Der eigentliche Nachrichtentext — inkl. Emojis. Custom-Emojis als <code>&lt;:name:id&gt;</code>, Discord-Markdown erlaubt.</div>
          ${emojiPicker(opts.emojis)}
        </div>
        <div class="field">
          <label>Embed-Titel (optional)</label>
          <input type="text" name="title" value="${esc(p.title)}" placeholder="Wir suchen Verstärkung!">
          <div class="hint">Nur falls die Nachricht ein Embed nutzt.</div>
        </div>
        <div class="field">
          <label>Embed-Text (optional)</label>
          <textarea name="body">${esc(p.body)}</textarea>
        </div>
        <div class="field">
          <label>Button-Beschriftung</label>
          <input type="text" name="buttonLabel" value="${esc(p.buttonLabel)}" placeholder="Jetzt bewerben">
        </div>
        <div class="row-actions">
          <button class="btn" type="submit">Speichern &amp; in Discord aktualisieren</button>
          <a class="btn btn-ghost" href="/admin/recruitment">Abbrechen</a>
        </div>
      </form>`;
    return adminLayout("Recruitment — Nachricht bearbeiten", "recruitment", user, body, opts.msg, opts.nav);
}

/**
 * Recruitment page: templates (edit text), post a template to a channel, and
 * manage messages the bot already posted (edit in place / scan / remove).
 * @param {object} opts { templates, editing, posts, editingPost, channels, activeGuildId, csrf, msg, nav }
 */
function renderRecruitment(user, opts = {}) {
    if (opts.editingPost) return renderPostEdit(user, opts);

    const templates = opts.templates || [];
    const posts = opts.posts || [];
    const channels = opts.channels || [];
    const activeGuildId = opts.activeGuildId || "";
    const editing = opts.editing || null;
    const csrfField = hiddenCsrf(opts.csrf || "");

    // --- templates: list + create/edit form ---
    const list = templates.length
        ? `<table class="idx" style="margin-bottom:18px">
             <thead><tr><th>Name</th><th>Titel</th><th></th></tr></thead>
             <tbody>${templates.map(templateListItem).join("").split("__CSRF__").join(csrfField)}</tbody>
           </table>`
        : "<p class=\"sub\">Noch keine Vorlagen. Lege unten die erste an.</p>";

    const e = editing || { id: "", name: "", title: "", body: "", buttonLabel: "" };
    const formTitle = editing ? `Vorlage bearbeiten: ${esc(editing.name || "")}` : "Neue Vorlage anlegen";
    const templateForm = `
      <h2>${formTitle}</h2>
      <form class="card-form" method="POST" action="/admin/recruitment">
        ${csrfField}
        <input type="hidden" name="id" value="${esc(e.id)}">
        <div class="field">
          <label>Name (interne Bezeichnung)</label>
          <input type="text" name="name" value="${esc(e.name)}" placeholder="z.B. Heiler-Recruitment" required>
          <div class="hint">Nur zur Auswahl — nicht Teil der geposteten Nachricht.</div>
        </div>
        <div class="field">
          <label>Titel der Nachricht</label>
          <input type="text" name="title" value="${esc(e.title)}" placeholder="Wir suchen Verstärkung!">
        </div>
        <div class="field">
          <label>Text</label>
          <textarea name="body" placeholder="Beschreibungstext …">${esc(e.body)}</textarea>
          <div class="hint">Discord-Markdown ist erlaubt (**fett**, *kursiv*, Zeilenumbrüche).</div>
          ${emojiPicker(opts.emojis)}
        </div>
        <div class="field">
          <label>Button-Beschriftung (optional)</label>
          <input type="text" name="buttonLabel" value="${esc(e.buttonLabel)}" placeholder="Jetzt bewerben">
        </div>
        <div class="row-actions">
          <button class="btn" type="submit">${editing ? "Speichern" : "Vorlage anlegen"}</button>
          ${editing ? "<a class=\"btn btn-ghost\" href=\"/admin/recruitment\">Abbrechen</a>" : ""}
        </div>
      </form>`;

    // --- post a template to a channel ---
    let postSection;
    if (!activeGuildId) {
        postSection = "<p class=\"sub\">Wähle oben einen Server, um eine Nachricht zu posten.</p>";
    } else if (!templates.length) {
        postSection = "<p class=\"sub\">Lege zuerst eine Vorlage an, um sie posten zu können.</p>";
    } else {
        const tplOptions = templates.map((t) => `<option value="${esc(t.id)}">${esc(t.name || "(ohne Name)")}</option>`).join("");
        postSection = `
      <form class="card-form" method="POST" action="/admin/recruitment/post">
        ${csrfField}
        <div class="field"><label>Vorlage</label><select name="templateId" required>${tplOptions}</select></div>
        <div class="field"><label>Ziel-Channel</label>${channelSelect("channelId", channels, "", { required: true, allowEmpty: true })}</div>
        <div class="row-actions"><button class="btn" type="submit">In Channel posten</button></div>
      </form>`;
    }

    // --- messages the bot already posted ---
    const scanForm = activeGuildId
        ? `<form method="POST" action="/admin/recruitment/scan" style="margin:0 0 14px" onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').textContent='Suche läuft …'">
             ${csrfField}
             <button class="btn btn-ghost" type="submit">Server nach Bot-Nachrichten durchsuchen</button>
           </form>`
        : "";
    const postsTable = posts.length
        ? `<table class="idx">
             <thead><tr><th>Channel</th><th>Titel</th><th class="small">Quelle</th><th></th></tr></thead>
             <tbody>${posts.map((p) => `<tr>
               <td>#${esc(p.channelName || p.channelId)}</td>
               <td>${esc(p.title || "(kein Titel)")} · <a class="mlink" href="${messageUrl(p)}" target="_blank" rel="noopener">öffnen</a></td>
               <td class="small">${esc(p.source || "")}</td>
               <td class="row-actions">
                 <a class="btn btn-ghost" href="/admin/recruitment?editpost=${esc(p.id)}">Bearbeiten</a>
                 <form method="POST" action="/admin/recruitment/post-delete" onsubmit="return confirm('Aus der Verwaltung entfernen? (Die Discord-Nachricht bleibt bestehen.)')" style="margin:0">
                   ${csrfField}<input type="hidden" name="id" value="${esc(p.id)}">
                   <button class="btn btn-danger" type="submit">Entfernen</button>
                 </form>
               </td>
             </tr>`).join("")}</tbody>
           </table>`
        : "<p class=\"sub\">Noch keine geposteten Nachrichten getrackt. Poste oben eine Vorlage oder durchsuche den Server.</p>";

    const body = `
      <h2>Recruitment-Vorlagen</h2>
      <p class="note">Vorlagen-Texte, die der Bot beim Posten nutzt (auch via Discord-Befehl <code>/recruitment</code>).</p>
      ${list}
      ${templateForm}
      <h2>Nachricht posten</h2>
      ${postSection}
      <h2>Gepostete Nachrichten</h2>
      ${scanForm}
      ${postsTable}`;
    return adminLayout("Recruitment — Pulsebot Admin", "recruitment", user, body, opts.msg, opts.nav);
}

// A single row in the "detected logs" table (from the log channels).
function logRow(l, csrfField) {
    const when = l.detectedAt ? new Date(l.detectedAt).toLocaleString("de-DE") : "";
    const title = l.title || l.reportId || "(unbekannt)";
    const src = l.guildId && l.channelId && l.messageId
        ? `<a class="mlink" href="https://discord.com/channels/${esc(l.guildId)}/${esc(l.channelId)}/${esc(l.messageId)}" target="_blank" rel="noopener">Nachricht</a>`
        : `<a class="mlink" href="${esc(l.link || "#")}" target="_blank" rel="noopener">Log</a>`;
    const status = l.status === "done"
        ? "<span class=\"pill\" style=\"background:var(--good-bg);color:var(--good)\">ausgewertet</span>"
        : "<span class=\"pill\">offen</span>";
    const action = l.status === "done"
        ? (l.reportUrl || l.reportRefId
            ? `<a class="btn btn-ghost" href="${esc(l.reportUrl || `/r/${l.reportRefId}`)}">Öffnen</a>`
            : "")
        : `<form method="POST" action="/admin/cla/eval" style="margin:0" onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').textContent='Läuft …'">
             ${csrfField}<input type="hidden" name="logId" value="${esc(l.id)}">
             <button class="btn" type="submit">Auswerten</button>
           </form>`;
    return `<tr>
      <td>${esc(title)}</td>
      <td class="small">${esc(l.reportId || "")}</td>
      <td>${src}</td>
      <td>${status}</td>
      <td class="small">${esc(when)}</td>
      <td class="row-actions">
        ${action}
        <form method="POST" action="/admin/cla/log-delete" style="margin:0" onsubmit="return confirm('Log aus der Liste entfernen?')">
          ${csrfField}<input type="hidden" name="logId" value="${esc(l.id)}">
          <button class="btn btn-danger" type="submit">×</button>
        </form>
      </td>
    </tr>`;
}

/**
 * CLA / Logcheck page: a form to run a report from a WCL link + recent reports,
 * plus the logs detected in the configured log channels (evaluate with one click).
 * @param {object} opts { reports, logs, logChannelIds, activeGuildId, csrf, msg, nav }
 */
function renderCla(user, opts = {}) {
    const reports = opts.reports || [];
    const logs = opts.logs || [];
    const logChannelIds = opts.logChannelIds || [];
    const csrfField = hiddenCsrf(opts.csrf || "");

    // --- logs detected in the log channels ---
    let logsSection;
    if (!logChannelIds.length) {
        logsSection = "<p class=\"sub\">Es sind noch keine Log-Channels konfiguriert. Lege sie in den <a href=\"/admin/settings\">Einstellungen</a> fest, damit der Bot automatisch Logs erkennt.</p>";
    } else {
        const scanForm = `<form method="POST" action="/admin/cla/scan" style="margin:0 0 14px" onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').textContent='Suche läuft …'">
             ${csrfField}
             <button class="btn btn-ghost" type="submit">Log-Channels nach neuen Logs durchsuchen</button>
           </form>`;
        const table = logs.length
            ? `<table class="idx">
                 <thead><tr><th>Log</th><th>Report-ID</th><th>Quelle</th><th>Status</th><th>Erkannt</th><th></th></tr></thead>
                 <tbody>${logs.map((l) => logRow(l, csrfField)).join("")}</tbody>
               </table>`
            : "<p class=\"sub\">Noch keine Logs erkannt. Sobald im Log-Channel ein Warcraft-Logs-Link gepostet wird, taucht er hier auf.</p>";
        logsSection = `${scanForm}${table}`;
    }

    const recent = reports.length
        ? `<table class="idx">
             <thead><tr><th>Report</th><th>Zone</th><th>Erstellt</th><th>Spieler</th><th>Probleme</th></tr></thead>
             <tbody>${reports.slice(0, 15).map((r) => {
        const when = r.generatedAt ? new Date(r.generatedAt).toLocaleString("de-DE") : "";
        return `<tr>
                 <td><a href="/r/${esc(r.id)}">${esc(r.title || r.id)}</a></td>
                 <td>${esc(r.zone || "")}</td>
                 <td>${esc(when)}</td>
                 <td>${esc(r.playerCount)}</td>
                 <td><span class="pill">${esc(r.issueCount)}</span></td>
               </tr>`;
    }).join("")}</tbody>
           </table>`
        : "<p class=\"sub\">Noch keine Auswertungen.</p>";

    const body = `
      <h2>Neue Auswertung</h2>
      <form class="card-form" method="POST" action="/admin/cla">
        ${csrfField}
        <div class="field">
          <label>Warcraft-Logs-Report-Link oder Report-ID</label>
          <input type="text" name="link" placeholder="https://classic.warcraftlogs.com/reports/abc123…" required>
          <div class="hint">Die Auswertung kann einige Sekunden dauern — nach dem Absenden bitte kurz warten.</div>
        </div>
        <div class="row-actions">
          <button class="btn" type="submit">Auswertung erstellen</button>
        </div>
      </form>
      <h2>Erkannte Logs aus dem Log-Channel</h2>
      <p class="note">Vom Bot automatisch erkannte Warcraft-Logs. „Auswerten" erstellt die Auswertung — jeder Report nur einmal.</p>
      ${logsSection}
      <h2>Letzte Auswertungen</h2>
      ${recent}
      <p class="sub" style="margin-top:10px"><a href="/">→ Alle Auswertungen &amp; Übersicht</a></p>`;
    return adminLayout("CLA / Logcheck — Pulsebot Admin", "cla", user, body, opts.msg, opts.nav);
}

/**
 * A Raid-Helper template picker: an input with a <datalist> of known templates.
 * Lets the admin pick a saved template OR type any template ID by hand, so it
 * never blocks event creation even when the template list is empty.
 */
function raidTemplateField(templates, selectedId) {
    const options = (templates || [])
        .map((t) => `<option value="${esc(t.id)}">${esc(t.name || "(ohne Name)")}</option>`)
        .join("");
    return `<input type="text" name="templateId" list="raidTemplateList" value="${esc(selectedId || "")}" placeholder="Template wählen oder ID eintippen" autocomplete="off" required>
      <datalist id="raidTemplateList">${options}</datalist>`;
}

/**
 * Raid-events overview: every server event grouped by Discord category, with
 * links to the Discord post / Raid-Helper setup and a per-event detail page.
 * @param {object} opts { groups, guildId, activeGuildId, error, csrf, msg, nav }
 */
function renderRaids(user, opts = {}) {
    const groups = opts.groups || [];
    const guildId = opts.guildId || "";
    const actions = `
      <div class="row-actions" style="margin-bottom:16px">
        <a class="btn" href="/admin/raids/new">＋ Neues Event</a>
        <a class="btn btn-ghost" href="/admin/raids/templates">Aufruf-Vorlagen</a>
      </div>`;

    let listing;
    if (!opts.activeGuildId) {
        listing = "<p class=\"sub\">Wähle oben einen Server, um die Events zu sehen.</p>";
    } else if (opts.error) {
        listing = `<div class="flash flash-err">${esc(opts.error)}</div>`;
    } else if (!groups.length) {
        listing = "<p class=\"sub\">Keine anstehenden Events gefunden.</p>";
    } else {
        listing = groups.map((g) => {
            const rows = g.events.map((ev) => {
                const links = [
                    `<a class="mlink" href="${eventPostUrl(guildId, ev.channelId, ev.id)}" target="_blank" rel="noopener">Discord</a>`,
                    `<a class="mlink" href="${raidplanUrl(ev.id)}" target="_blank" rel="noopener">Setup/Comp</a>`,
                ].join(" · ");
                return `<tr>
                  <td><strong>${esc(ev.title || "(ohne Titel)")}</strong><div class="small">#${esc(ev.channelName || ev.channelId)}</div></td>
                  <td class="small">${esc(formatEventTime(ev.startTime))}</td>
                  <td class="small">${esc(String(ev.signupCount || 0))}</td>
                  <td class="small">${links}</td>
                  <td class="row-actions"><a class="btn btn-ghost" href="/admin/raids/detail?event=${esc(ev.id)}">Details</a></td>
                </tr>`;
            }).join("");
            return `<div class="dash-card" style="margin-bottom:16px">
                <div class="dash-card-head"><h3>${esc(g.categoryName || "Ohne Kategorie")}</h3><span class="small" style="margin-left:auto">${g.events.length} Event(s)</span></div>
                <table class="idx" style="margin:0">
                  <thead><tr><th>Event</th><th>Termin</th><th>Anm.</th><th>Links</th><th></th></tr></thead>
                  <tbody>${rows}</tbody>
                </table>
              </div>`;
        }).join("");
    }

    const body = `
      <p class="note">Alle anstehenden Events des Servers, gruppiert nach Discord-Kategorie. Über „Details" pro Event einen Anmelde-Aufruf posten oder das Raidsheet füllen.</p>
      ${actions}
      ${listing}`;
    return adminLayout("Raid-Events — Pulsebot Admin", "raids", user, body, opts.msg, opts.nav);
}

/**
 * Raid-event creation form (posts a Raid-Helper event).
 * @param {object} opts { defaults, leaderId, channels, csrf, msg, nav }
 */
function renderRaidCreate(user, opts = {}) {
    const d = opts.defaults || { templateId: "", channelId: "" };
    const leaderId = opts.leaderId || "";
    const templates = opts.templates || [];
    const csrfField = hiddenCsrf(opts.csrf || "");
    const createForm = `
      <p class="note"><a class="mlink" href="/admin/raids">← Zurück zur Event-Übersicht</a></p>
      <h2>Neues Raid-Event anlegen</h2>
      <p class="note">Legt über die Raid-Helper-API ein echtes Event mit Signup-Nachricht an. Standardwerte kommen aus den <a href="/admin/settings">Einstellungen</a>.</p>
      <form class="card-form" method="POST" action="/admin/raids/new">
        ${csrfField}
        <div class="field">
          <label>Titel</label>
          <input type="text" name="title" placeholder="GDKP Karazhan" required>
        </div>
        <div class="field">
          <label>Datum (TT-MM-JJJJ)</label>
          <input type="text" name="date" placeholder="24-07-2026" required>
        </div>
        <div class="field">
          <label>Uhrzeit (HH:MM)</label>
          <input type="text" name="time" placeholder="20:00" required>
        </div>
        <div class="field">
          <label>Template</label>
          ${raidTemplateField(templates, d.templateId)}
          <div class="hint">${templates.length
        ? "Aus der Liste wählen oder eine eigene Raid-Helper-Template-ID eintippen."
        : "Noch keine Templates hinterlegt — Raid-Helper-Template-ID eintippen oder unten laden/anlegen."}</div>
        </div>
        <div class="field">
          <label>Channel</label>
          ${channelSelect("channelId", opts.channels || [], d.channelId, { required: true, allowEmpty: true })}
          <div class="hint">Text-Channels des oben gewählten Servers.</div>
        </div>
        <div class="field">
          <label>Event-Leiter (Discord-User-ID)</label>
          <input type="text" name="leaderId" value="${esc(leaderId)}" required>
          <div class="hint">Vorbelegt mit deiner ID.</div>
        </div>
        <div class="field">
          <label>Beschreibung (optional)</label>
          <textarea name="description" placeholder="Weitere Infos zum Raid …"></textarea>
        </div>
        <div class="row-actions">
          <button class="btn" type="submit">Event anlegen</button>
          <a class="btn btn-ghost" href="/admin/raids">Abbrechen</a>
        </div>
      </form>`;

    // --- template management: list + delete, add by hand, import from Raid-Helper ---
    const templateRows = templates.length
        ? `<table class="idx" style="margin-bottom:14px">
             <thead><tr><th>Name</th><th class="small">Template-ID</th><th></th></tr></thead>
             <tbody>${templates.map((t) => `<tr>
               <td><strong>${esc(t.name || "(ohne Name)")}</strong></td>
               <td class="small">${esc(t.id)}</td>
               <td class="row-actions">
                 <form method="POST" action="/admin/raid-templates/delete" onsubmit="return confirm('Template aus der Liste entfernen?')" style="margin:0">
                   ${csrfField}<input type="hidden" name="id" value="${esc(t.id)}">
                   <button class="btn btn-danger" type="submit">Entfernen</button>
                 </form>
               </td>
             </tr>`).join("")}</tbody>
           </table>`
        : "<p class=\"sub\">Noch keine Templates gespeichert.</p>";

    const templateSection = `
      <h2>Raid-Helper-Templates</h2>
      <p class="note">Raid-Helper bietet keinen Endpunkt zum Auflisten von Templates. Der Bot pflegt daher eine eigene Liste — automatisch aus den bestehenden Events deines Servers geladen oder von Hand ergänzt. Sie füllt die Auswahl oben.</p>
      ${templateRows}
      <div class="row-actions" style="margin-bottom:14px">
        <form method="POST" action="/admin/raid-templates/import" style="margin:0" onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').textContent='Lädt …'">
          ${csrfField}
          <button class="btn btn-ghost" type="submit">Aus Raid-Helper laden</button>
        </form>
      </div>
      <form class="card-form" method="POST" action="/admin/raid-templates">
        ${csrfField}
        <div class="field">
          <label>Template-ID</label>
          <input type="text" name="id" placeholder="z.B. 3" required>
        </div>
        <div class="field">
          <label>Name</label>
          <input type="text" name="name" placeholder="z.B. GDKP Karazhan">
        </div>
        <div class="row-actions"><button class="btn" type="submit">Template speichern</button></div>
      </form>`;

    return adminLayout("Raid-Events — Pulsebot Admin", "raids", user, `${createForm}${templateSection}`, opts.msg, opts.nav);
}

/**
 * Channel management page: create a new channel, or duplicate an existing one
 * (full clone, editable name, same category).
 * @param {object} opts { categories, channels, activeGuildId, csrf, msg, nav }
 */
function renderChannels(user, opts = {}) {
    const categories = opts.categories || [];
    const channels = opts.channels || [];
    const activeGuildId = opts.activeGuildId || "";
    const csrfField = hiddenCsrf(opts.csrf || "");

    if (!activeGuildId) {
        const body = "<p class=\"sub\">Wähle oben einen Server, um Kanäle zu verwalten.</p>";
        return adminLayout("Kanäle — Pulsebot Admin", "channels", user, body, opts.msg, opts.nav);
    }

    const categoryOptions = "<option value=\"\">— keine Kategorie —</option>"
        + categories.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");

    const createForm = `
      <h2>Neuen Kanal erstellen</h2>
      <form class="card-form" method="POST" action="/admin/channels/create">
        ${csrfField}
        <div class="field">
          <label>Name</label>
          <input type="text" name="name" placeholder="z.B. kara-signup" required>
        </div>
        <div class="field">
          <label>Typ</label>
          <select name="type">
            <option value="text">Text</option>
            <option value="voice">Voice</option>
            <option value="announcement">Ankündigung</option>
            <option value="forum">Forum</option>
            <option value="stage">Stage</option>
          </select>
        </div>
        <div class="field">
          <label>Kategorie</label>
          <select name="parentId">${categoryOptions}</select>
        </div>
        <div class="row-actions"><button class="btn" type="submit">Kanal erstellen</button></div>
      </form>`;

    let duplicateForm;
    if (!channels.length) {
        duplicateForm = "<p class=\"sub\">Keine Kanäle zum Duplizieren gefunden.</p>";
    } else {
        const channelOptions = channels
            .map((c) => `<option value="${esc(c.id)}" data-name="${esc(c.name)}">#${esc(c.name)} · ${esc(c.typeLabel || "Kanal")}${c.category ? ` · ${esc(c.category)}` : ""}</option>`)
            .join("");
        duplicateForm = `
      <form class="card-form" method="POST" action="/admin/channels/duplicate">
        ${csrfField}
        <div class="field">
          <label>Kanal duplizieren</label>
          <select name="channelId" id="dupSource" required>${channelOptions}</select>
          <div class="hint">Vollständiger Klon (Rechte, Thema, Slowmode) in derselben Kategorie wie das Original.</div>
        </div>
        <div class="field">
          <label>Name des Duplikats</label>
          <input type="text" name="name" id="dupName" placeholder="Name übernehmen &amp; anpassen">
          <div class="hint">Vorbelegt mit dem Original-Namen — hier anpassen. Leer = Name des Originals.</div>
        </div>
        <div class="row-actions"><button class="btn" type="submit">Duplizieren</button></div>
      </form>
      <script>(function(){
        var sel=document.getElementById("dupSource"),name=document.getElementById("dupName");
        function sync(){var o=sel.options[sel.selectedIndex];if(o&&!name.value)name.value=o.getAttribute("data-name")||"";}
        function force(){var o=sel.options[sel.selectedIndex];if(o)name.value=o.getAttribute("data-name")||"";}
        if(sel&&name){sync();sel.addEventListener("change",force);}
      })();</script>`;
    }

    const body = `
      ${createForm}
      <h2>Kanal duplizieren</h2>
      ${duplicateForm}`;
    return adminLayout("Kanäle — Pulsebot Admin", "channels", user, body, opts.msg, opts.nav);
}

/**
 * Per-event detail page: links plus the two per-event functions —
 * post an Anmelde-Aufruf (role ping) and fill the matching raidsheet.
 * @param {object} opts { event, channelName, categoryName, guildId, notifyTemplates,
 *                         roles, raidsheets, matchedSheetId, csrf, msg, nav }
 */
function renderEventDetail(user, opts = {}) {
    const ev = opts.event || {};
    const csrfField = hiddenCsrf(opts.csrf || "");
    const guildId = opts.guildId || "";
    const notifyTemplates = opts.notifyTemplates || [];
    const roles = opts.roles || [];
    const raidsheets = opts.raidsheets || [];
    const setup = opts.setup || null;

    const meta = `
      <div class="dash-card" style="margin-bottom:16px">
        <div class="dash-card-head"><h3>${esc(ev.title || "(ohne Titel)")}</h3></div>
        <div style="padding:14px 16px" class="small">
          <div>Termin: <strong>${esc(formatEventTime(ev.startTime)) || "—"}</strong></div>
          <div>Channel: #${esc(opts.channelName || ev.channelId)} · Kategorie: ${esc(opts.categoryName || "—")}</div>
          <div style="margin-top:8px">
            <a class="mlink" href="${eventPostUrl(guildId, ev.channelId, ev.id)}" target="_blank" rel="noopener">Discord-Post</a> ·
            <a class="mlink" href="${channelUrl(guildId, ev.channelId)}" target="_blank" rel="noopener">Channel</a> ·
            <a class="mlink" href="${raidplanUrl(ev.id)}" target="_blank" rel="noopener">Setup / Comp</a>
          </div>
        </div>
      </div>`;

    // --- Setup (Raidplan comp), grouped by role with class icons/colours ---
    let setupSection;
    if (opts.setupError) {
        setupSection = `<div class="flash flash-err">Setup konnte nicht geladen werden: ${esc(opts.setupError)}</div>`;
    } else if (!setup || !setup.total) {
        setupSection = "<p class=\"sub\">Für dieses Event ist noch kein Setup (Raidplan) angelegt.</p>";
    } else {
        const summary = `<div class="setup-summary">${setup.groups
            .map((g) => `<span class="setup-count"><b>${esc(String(g.players.length))}</b> ${esc(g.label)}</span>`)
            .join("")}<span class="setup-count setup-total"><b>${esc(String(setup.total))}</b> gesamt</span></div>`;
        const groups = setup.groups.map((g) => `
      <div class="setup-role">
        <h4 class="setup-role-head">${esc(g.label)} · ${esc(String(g.players.length))}</h4>
        <div class="setup-grid">${g.players.map((p) => `
          <span class="setup-player" style="border-left-color:${esc(p.classColor || "var(--line)")}">
            ${p.iconUrl ? `<img class="setup-ico" src="${esc(p.iconUrl)}" alt="${esc(p.className || "")}" title="${esc(p.className || "")}" loading="lazy">` : "<span class=\"setup-ico setup-ico-blank\"></span>"}
            <span class="sp-name">${esc(p.name)}</span>
            <span class="sp-spec">${esc(p.specName)}</span>
          </span>`).join("")}</div>
      </div>`).join("");
        setupSection = summary + groups;
    }

    // --- Anmelde-Aufruf ---
    let notifySection;
    if (!notifyTemplates.length) {
        notifySection = "<p class=\"sub\">Noch keine Aufruf-Vorlagen. Lege zuerst unter <a class=\"mlink\" href=\"/admin/raids/templates\">Aufruf-Vorlagen</a> eine an.</p>";
    } else {
        const tplOptions = notifyTemplates.map((t) => `<option value="${esc(t.id)}">${esc(t.name || "(ohne Name)")}</option>`).join("");
        const roleBoxes = roles.length
            ? `<div class="rolegrid">${roles.map((r) => `<label class="rolebox"><input type="checkbox" name="role_${esc(r.id)}" value="1"> @${esc(r.name)}</label>`).join("")}</div>`
            : "<p class=\"sub\">Keine Rollen gefunden (Server gewählt?).</p>";
        notifySection = `
      <form class="card-form" method="POST" action="/admin/raids/notify">
        ${csrfField}
        <input type="hidden" name="event" value="${esc(ev.id)}">
        <input type="hidden" name="channelId" value="${esc(ev.channelId)}">
        <div class="field"><label>Aufruf-Vorlage</label><select name="templateId" required>${tplOptions}</select></div>
        <div class="field">
          <label>Rollen pingen</label>
          ${roleBoxes}
          <div class="hint">Die ausgewählten Rollen werden im Event-Channel angepingt.</div>
        </div>
        <div class="row-actions"><button class="btn" type="submit">Anmelde-Aufruf posten</button></div>
      </form>`;
    }

    // --- Raidsheet füllen ---
    let fillSection;
    if (!raidsheets.length) {
        fillSection = "<p class=\"sub\">Keine Raidsheets konfiguriert. Lege sie in den <a class=\"mlink\" href=\"/admin/settings\">Einstellungen</a> an.</p>";
    } else {
        const sheetOptions = raidsheets.map((s) =>
            `<option value="${esc(s.id)}"${s.id === opts.matchedSheetId ? " selected" : ""}>${esc(s.name || s.id)}</option>`).join("");
        const matchHint = opts.matchedSheetId
            ? "Automatisch anhand des Event-Titels vorausgewählt — bei Bedarf ändern."
            : "Kein Raidsheet passte automatisch zum Titel — bitte manuell wählen.";
        fillSection = `
      <form class="card-form" method="POST" action="/admin/raids/fill" onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').textContent='Fülle Sheet …'">
        ${csrfField}
        <input type="hidden" name="event" value="${esc(ev.id)}">
        <div class="field"><label>Raidsheet</label><select name="sheetId" required>${sheetOptions}</select><div class="hint">${matchHint}</div></div>
        <div class="field">
          <label>Tank 3 (optional)</label>
          <input type="text" name="tank3" placeholder="Name des 3. Tanks">
          <div class="hint">Wird manuell in die Tank-Zeile eingetragen.</div>
        </div>
        <div class="row-actions"><button class="btn" type="submit">Raidsheet füllen</button></div>
      </form>`;
    }

    const body = `
      <p class="note"><a class="mlink" href="/admin/raids">← Zurück zur Event-Übersicht</a></p>
      ${meta}
      <h2>Setup</h2>
      <p class="note">Aktueller Raidplan dieses Events, gruppiert nach Rolle. Icons und Farben richten sich nach der WoW-Klasse.</p>
      ${setupSection}
      <h2>Anmelde-Aufruf</h2>
      <p class="note">Postet eine Aufruf-Nachricht in den Event-Channel und pingt die gewählten Rollen.</p>
      ${notifySection}
      <h2>Raidsheet füllen</h2>
      <p class="note">Überträgt das Raid-Helper-Setup dieses Events in das passende Google-Sheet.</p>
      ${fillSection}`;
    return adminLayout("Event-Details — Pulsebot Admin", "raids", user, body, opts.msg, opts.nav);
}

/**
 * Anmelde-Aufruf templates: list + create/edit form (like recruitment, no button).
 * @param {object} opts { templates, editing, csrf, msg, nav }
 */
function renderNotifyTemplates(user, opts = {}) {
    const templates = opts.templates || [];
    const editing = opts.editing || null;
    const csrfField = hiddenCsrf(opts.csrf || "");

    const list = templates.length
        ? `<table class="idx" style="margin-bottom:18px">
             <thead><tr><th>Name</th><th>Titel</th><th></th></tr></thead>
             <tbody>${templates.map((t) => `<tr>
               <td><strong>${esc(t.name || "(ohne Name)")}</strong></td>
               <td class="sub" style="margin:0">${esc(t.title || "")}</td>
               <td class="row-actions">
                 <a class="btn btn-ghost" href="/admin/raids/templates?edit=${esc(t.id)}">Bearbeiten</a>
                 <form method="POST" action="/admin/raids/templates/delete" onsubmit="return confirm('Vorlage wirklich löschen?')" style="margin:0">
                   ${csrfField}<input type="hidden" name="id" value="${esc(t.id)}">
                   <button class="btn btn-danger" type="submit">Löschen</button>
                 </form>
               </td>
             </tr>`).join("")}</tbody>
           </table>`
        : "<p class=\"sub\">Noch keine Aufruf-Vorlagen. Lege unten die erste an.</p>";

    const e = editing || { id: "", name: "", title: "", body: "" };
    const formTitle = editing ? `Vorlage bearbeiten: ${esc(editing.name || "")}` : "Neue Aufruf-Vorlage anlegen";
    const form = `
      <h2>${formTitle}</h2>
      <form class="card-form" method="POST" action="/admin/raids/templates">
        ${csrfField}
        <input type="hidden" name="id" value="${esc(e.id)}">
        <div class="field">
          <label>Name (interne Bezeichnung)</label>
          <input type="text" name="name" value="${esc(e.name)}" placeholder="z.B. Kara-Reminder" required>
          <div class="hint">Nur zur Auswahl — nicht Teil der geposteten Nachricht.</div>
        </div>
        <div class="field">
          <label>Titel der Nachricht (optional)</label>
          <input type="text" name="title" value="${esc(e.title)}" placeholder="Anmeldung offen!">
        </div>
        <div class="field">
          <label>Text</label>
          <textarea name="body" placeholder="Bitte tragt euch für den Raid ein …">${esc(e.body)}</textarea>
          <div class="hint">Discord-Markdown erlaubt. Die Rollen-Pings werden beim Posten pro Event ausgewählt.</div>
        </div>
        <div class="row-actions">
          <button class="btn" type="submit">${editing ? "Speichern" : "Vorlage anlegen"}</button>
          ${editing ? "<a class=\"btn btn-ghost\" href=\"/admin/raids/templates\">Abbrechen</a>" : ""}
        </div>
      </form>`;

    const body = `
      <p class="note"><a class="mlink" href="/admin/raids">← Zurück zur Event-Übersicht</a></p>
      <h2>Aufruf-Vorlagen</h2>
      <p class="note">Nachrichten-Vorlagen, die der Bot pro Event mit Rollen-Ping postet.</p>
      ${list}
      ${form}`;
    return adminLayout("Aufruf-Vorlagen — Pulsebot Admin", "raids", user, body, opts.msg, opts.nav);
}

/**
 * Settings page: admin role IDs and raid defaults, stored in the DB (settings store).
 * @param {object} opts { config, csrf, msg }
 */
function renderSettings(user, opts = {}) {
    const config = opts.config || { adminRoleIds: [], raidDefaults: {} };
    const rd = config.raidDefaults || {};
    const raidsheets = opts.raidsheets || [];
    const csrfField = hiddenCsrf(opts.csrf || "");

    // A single raidsheet edit card (or the "new" form when sheet is null).
    const sheetForm = (sheet) => {
        const s = sheet || { id: "", name: "", spreadsheetId: "", sheetName: "Setup", gid: "", keywords: [] };
        const keywords = Array.isArray(s.keywords) ? s.keywords.join(", ") : (s.keywords || "");
        return `<form class="sheetcard" method="POST" action="/admin/settings/raidsheets">
          ${csrfField}
          <input type="hidden" name="id" value="${esc(s.id)}">
          <div class="field"><label>Name (Content)</label><input type="text" name="name" value="${esc(s.name)}" placeholder="z.B. Tier 6 / SWP" required></div>
          <div class="field"><label>Spreadsheet-ID</label><input type="text" name="spreadsheetId" value="${esc(s.spreadsheetId)}" placeholder="Google-Sheet-ID"></div>
          <div class="field"><label>Tab-Name</label><input type="text" name="sheetName" value="${esc(s.sheetName || "Setup")}" placeholder="Setup"></div>
          <div class="field"><label>Tab-GID</label><input type="text" name="gid" value="${esc(s.gid === undefined || s.gid === null ? "" : String(s.gid))}" placeholder="0"></div>
          <div class="field"><label>Keywords (kommagetrennt)</label><input type="text" name="keywords" value="${esc(keywords)}" placeholder="kara, gruul, maggi"><div class="hint">Passt ein Keyword auf den Event-Titel, wird dieses Sheet automatisch vorgeschlagen.</div></div>
          <div class="row-actions">
            <button class="btn" type="submit">${s.id ? "Speichern" : "Raidsheet anlegen"}</button>
            ${s.id ? "<button class=\"btn btn-danger\" type=\"submit\" formaction=\"/admin/settings/raidsheets/delete\" onclick=\"return confirm('Raidsheet wirklich löschen?')\">Löschen</button>" : ""}
          </div>
        </form>`;
    };
    const raidsheetSection = `
      <h2>Raidsheets</h2>
      <p class="note">Google-Sheets nach Content aufgeteilt (Tier 4/5 usw.). Beim Füllen wird anhand der Keywords das passende Sheet vorgeschlagen.</p>
      ${raidsheets.map((s) => sheetForm(s)).join("")}
      <h3 style="margin-top:18px">Neues Raidsheet</h3>
      ${sheetForm(null)}`;

    const body = `
      <p class="note">Alle Werte werden in der Datenbank gespeichert und greifen ohne Bot-Neustart. IDs bekommst du in Discord per Rechtsklick → „ID kopieren" (Entwicklermodus).</p>
      <form class="card-form" method="POST" action="/admin/settings">
        ${csrfField}
        <h2 style="margin-top:0">Admin-Zugang</h2>
        <div class="field">
          <label>Admin-Rollen (Discord-Rollen-IDs, kommagetrennt)</label>
          <input type="text" name="adminRoleIds" value="${esc((config.adminRoleIds || []).join(", "))}" placeholder="123456789012345678, 234567890123456789">
          <div class="hint">Mitglieder mit einer dieser Rollen erhalten Admin-Zugang. Die <code>ADMIN_USER_ID</code> aus der .env behält immer Zugang (Notfall-Zugang).</div>
        </div>

        <h2>Recruitment</h2>
        <div class="field">
          <label>Bewerbungs-Channel-ID</label>
          <input type="text" name="applicationChannelId" value="${esc(config.applicationChannelId || "")}" placeholder="Discord-Channel-ID">
          <div class="hint">Channel, in dem neue Bewerbungen als Thread gepostet werden.</div>
        </div>
        <div class="field">
          <label>Offizier-Rollen-ID</label>
          <input type="text" name="officerRoleId" value="${esc(config.officerRoleId || "")}" placeholder="Discord-Rollen-ID">
          <div class="hint">Wird bei neuen Bewerbungen gepingt. Leer lassen für keinen Ping.</div>
        </div>

        <h2>Auktionen</h2>
        <div class="field">
          <label>Höchstgebote-Channel-ID</label>
          <input type="text" name="highestBidsChannelId" value="${esc(config.highestBidsChannelId || "")}" placeholder="Discord-Channel-ID">
        </div>
        <div class="field">
          <label>Höchstgebote-Message-ID</label>
          <input type="text" name="highestBidsMessageId" value="${esc(config.highestBidsMessageId || "")}" placeholder="Discord-Message-ID">
          <div class="hint">Die Nachricht mit der Höchstgebote-Übersicht, die der Bot aktualisiert.</div>
        </div>

        <h2>Event-Kategorien</h2>
        <div class="field">
          <label>Kategorie-IDs (kommagetrennt)</label>
          <input type="text" name="categoryIds" value="${esc((config.categoryIds || []).join(", "))}" placeholder="111…, 222…, 333…">
          <div class="hint">Discord-Kategorien, deren Channels Raid-Events enthalten.</div>
        </div>

        <h2>Log-Auswertung</h2>
        <div class="field">
          <label>Log-Channel-IDs (kommagetrennt)</label>
          <input type="text" name="logChannelIds" value="${esc((config.logChannelIds || []).join(", "))}" placeholder="111…, 222…">
          <div class="hint">Channels, in denen automatisch Warcraft-Logs gepostet werden. Der Bot bietet dort per Button die Auswertung an.</div>
        </div>

        <h2>Raid-Standardwerte</h2>
        <div class="field">
          <label>Standard-Template-ID</label>
          <input type="text" name="raidTemplateId" value="${esc(rd.templateId || "")}" placeholder="Raid-Helper Template-ID">
        </div>
        <div class="field">
          <label>Standard-Channel-ID</label>
          <input type="text" name="raidChannelId" value="${esc(rd.channelId || "")}" placeholder="Discord-Channel-ID">
        </div>

        <div class="row-actions">
          <button class="btn" type="submit">Speichern</button>
        </div>
      </form>
      ${raidsheetSection}`;
    return adminLayout("Einstellungen — Pulsebot Admin", "settings", user, body, opts.msg, opts.nav);
}

module.exports = {
    adminLayout, adminNav, renderDashboard, renderAdminDenied,
    renderRecruitment, renderCla, renderRaids, renderRaidCreate,
    renderEventDetail, renderNotifyTemplates, renderChannels, renderSettings, hiddenCsrf, esc,
};
