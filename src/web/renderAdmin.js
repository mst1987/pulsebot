// HTML rendering for the web admin menu. Reuses the shared page shell (layout)
// + esc/authBar/themeToggleBtn from render.js and adds the admin sidebar shell.

const { layout, esc, authBar, themeToggleBtn } = require("./render");
const { logPostedAt } = require("./reportList");
const { formatTimestampToDateString } = require("../utils/date");

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
  .btn-sm { padding:6px 12px; font-size:13px; }
  .row-actions { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  /* action cell stays a real table-cell so its row divider aligns with the rest */
  td.cell-actions { text-align:right; white-space:nowrap; vertical-align:middle; }
  /* native date/time pickers follow the active theme (calendar/clock popup + icon) */
  input[type=date], input[type=time], input[type=datetime-local] { color-scheme:dark; }
  :root[data-theme="light"] input[type=date],
  :root[data-theme="light"] input[type=time],
  :root[data-theme="light"] input[type=datetime-local] { color-scheme:light; }
  input[type=date]::-webkit-calendar-picker-indicator,
  input[type=time]::-webkit-calendar-picker-indicator,
  input[type=datetime-local]::-webkit-calendar-picker-indicator { filter:var(--picker-filter,none); cursor:pointer; opacity:.85; }
  input[type=date]::-webkit-calendar-picker-indicator:hover,
  input[type=time]::-webkit-calendar-picker-indicator:hover,
  input[type=datetime-local]::-webkit-calendar-picker-indicator:hover { opacity:1; }
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
  /* setup (raidplan comp), grouped into raid groups 1-5 */
  .setup-summary { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px; }
  .setup-count { background:var(--panel2); border:1px solid var(--line); border-radius:999px; padding:4px 12px; font-size:13px; color:var(--muted); }
  .setup-count b { color:var(--text); font-variant-numeric:tabular-nums; }
  .setup-count.setup-total { border-color:var(--accent-soft); background:var(--accent-soft); }
  .setup-groups { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:14px; }
  .setup-group { background:var(--panel2); border:1px solid var(--line); border-radius:10px; padding:10px 12px; }
  .setup-group-head { font-size:12.5px; text-transform:uppercase; letter-spacing:.7px; color:var(--muted); margin:0 0 8px; display:flex; justify-content:space-between; align-items:center; }
  .setup-group-n { background:var(--panel); border:1px solid var(--line); border-radius:999px; padding:1px 8px; font-size:11px; color:var(--text); font-variant-numeric:tabular-nums; }
  .setup-group-list { display:flex; flex-direction:column; gap:6px; }
  .setup-player { display:flex; align-items:center; gap:9px; background:var(--panel); border:1px solid var(--line); border-left:3px solid var(--line); border-radius:8px; padding:6px 10px; min-width:0; }
  .setup-ico { width:22px; height:22px; border-radius:5px; flex:0 0 auto; }
  .setup-ico-blank { background:var(--panel2); border:1px solid var(--line); }
  .setup-player .sp-name { font-weight:700; font-size:13.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
  /* prominent "open sheet" button in the event meta card */
  .sheet-btn { flex:0 0 auto; background:var(--accent); color:#fff; border:1px solid var(--accent); font-weight:700; box-shadow:0 0 0 4px var(--accent-soft), 0 2px 10px rgba(0,0,0,.25); }
  .sheet-btn:hover { filter:brightness(1.08); text-decoration:none; }
  /* tabs on the event detail page */
  .tabs { display:flex; gap:4px; border-bottom:1px solid var(--line); margin:4px 0 18px; flex-wrap:wrap; }
  .tab-btn { appearance:none; background:transparent; border:1px solid transparent; border-bottom:none; color:var(--muted); font:inherit; font-weight:600; padding:9px 16px; border-radius:9px 9px 0 0; cursor:pointer; margin-bottom:-1px; }
  .tab-btn:hover { color:var(--text); background:var(--panel2); }
  .tab-btn.active { color:var(--text); background:var(--panel); border-color:var(--line); border-bottom-color:var(--panel); }
  .tab-panel { display:none; }
  .tab-panel.active { display:block; }
  .sheetcard { background:var(--panel2); border:1px solid var(--line); border-radius:10px; padding:14px; margin-bottom:12px; }
  table.idx td.small { white-space:nowrap; color:var(--muted); font-size:12.5px; }
  /* sortable table headers + pager */
  a.sort-link { color:inherit; text-decoration:none; display:inline-flex; align-items:center; gap:2px; white-space:nowrap; }
  a.sort-link:hover { color:var(--accent); }
  a.sort-link.active { color:var(--accent); }
  .pager { display:flex; align-items:center; gap:12px; margin-top:12px; flex-wrap:wrap; }
  .pager-info { font-size:13px; color:var(--muted); font-variant-numeric:tabular-nums; }
  .pager-btn { display:inline-block; padding:6px 12px; border:1px solid var(--line); border-radius:8px; background:var(--panel2); color:var(--text); text-decoration:none; font-size:13.5px; font-weight:600; }
  .pager-btn:hover { border-color:var(--accent); color:var(--accent); }
  .pager-btn.disabled { opacity:.45; pointer-events:none; }
  /* submenu (sub-view tabs) */
  .subnav { display:flex; gap:6px; border-bottom:1px solid var(--line); margin:0 0 18px; flex-wrap:wrap; }
  .subnav-item { display:inline-flex; align-items:center; gap:7px; padding:9px 14px; color:var(--muted); text-decoration:none; font-weight:600; font-size:14.5px; border-bottom:2px solid transparent; margin-bottom:-1px; }
  .subnav-item:hover { color:var(--text); }
  .subnav-item.active { color:var(--accent); border-bottom-color:var(--accent); }
  .subnav-count { font-size:12px; font-weight:700; background:var(--panel2); color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:1px 8px; font-variant-numeric:tabular-nums; }
  .subnav-item.active .subnav-count { color:var(--accent); border-color:var(--accent-soft); }
  .cat-badge { display:inline-block; font-size:12px; font-weight:600; background:var(--accent-soft); color:var(--accent); border:1px solid var(--accent-soft); border-radius:999px; padding:2px 10px; white-space:nowrap; }
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
    const upcoming = opts.upcoming || { events: [], error: null };
    const n = (v) => esc(String(v || 0));

    const sheetBadge = (sheet) => sheet
        ? `<span class="pill" style="background:var(--good-bg);color:var(--good)" title="Gefüllt am ${esc(new Date(sheet.filledAt).toLocaleString("de-DE"))}${sheet.playerCount ? ` · ${esc(sheet.playerCount)} Spieler` : ""}">Sheet ✓</span>`
        : "<span class=\"pill\">Sheet fehlt</span>";
    const upcomingRows = upcoming.error
        ? `<tr><td colspan="4" class="sub" style="padding:16px;color:var(--high)">${esc(upcoming.error)}</td></tr>`
        : (upcoming.events.length
            ? upcoming.events.map((ev) => `<tr>
                <td><a class="mlink" href="${raidplanUrl(ev.id)}" target="_blank" rel="noopener">${esc(ev.title || ev.id)}</a></td>
                <td class="small">${esc(ev.channelName || "")}</td>
                <td class="small">${esc(formatEventTime(ev.startTime))}</td>
                <td>${sheetBadge(ev.sheet)}</td>
              </tr>`).join("")
            : "<tr><td colspan=\"4\" class=\"sub\" style=\"padding:16px\">Keine anstehenden Events mit fertigem Setup.</td></tr>");

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
      <div class="dash-card" style="margin-bottom:16px">
        <div class="dash-card-head"><h3>Upcoming Events</h3><a class="mlink" href="/admin/raids">Alle →</a></div>
        <table class="idx">
          <thead><tr><th>Event</th><th>Kanal</th><th>Termin</th><th>Sheet</th></tr></thead>
          <tbody>${upcomingRows}</tbody>
        </table>
      </div>
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

// WCL report link for a detected log (prefer the stored link, else derive it).
function logWclUrl(l) {
    return l.link || (l.reportId ? `https://classic.warcraftlogs.com/reports/${l.reportId}` : "");
}

// A single row in the "detected logs" table (from the log channels). The date
// column shows when the log was POSTED in the channel (derived from the Discord
// message id / postedAt), not when the bot detected it.
function logRow(l, csrfField) {
    const posted = logPostedAt(l);
    const when = posted ? new Date(posted).toLocaleString("de-DE") : "";
    const name = l.title || l.reportId || "(unbekannt)";
    const wclUrl = logWclUrl(l);
    // The log name itself IS the WCL link, so it can be checked before evaluating.
    const logCell = wclUrl
        ? `<a class="mlink" href="${esc(wclUrl)}" target="_blank" rel="noopener">${esc(name)} ↗</a>`
        : esc(name);
    const src = l.guildId && l.channelId && l.messageId
        ? `<a class="mlink" href="https://discord.com/channels/${esc(l.guildId)}/${esc(l.channelId)}/${esc(l.messageId)}" target="_blank" rel="noopener">Nachricht</a>`
        : "<span class=\"sub\">—</span>";
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
    const category = l.categoryName
        ? `<span class="cat-badge"${l.channelName ? ` title="#${esc(l.channelName)}"` : ""}>${esc(l.categoryName)}</span>`
        : "<span class=\"sub\">—</span>";
    return `<tr>
      <td>${logCell}</td>
      <td class="small">${esc(l.reportId || "")}</td>
      <td>${category}</td>
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

// A sortable <th>: toggles asc/desc on the active column, resets to page 1, keeps
// the current view, and shows a direction arrow. `defaults` sets the initial
// direction per key (text asc, date/number desc).
function claSortHeader(view, page, defaults, key, label) {
    const active = page.sort === key;
    const nextDir = active ? (page.dir === "asc" ? "desc" : "asc") : (defaults[key] || "desc");
    const arrow = active ? (page.dir === "asc" ? " ▲" : " ▼") : "";
    return `<th><a class="sort-link${active ? " active" : ""}" href="/admin/cla?view=${view}&sort=${key}&dir=${nextDir}&page=1">${esc(label)}${arrow}</a></th>`;
}

// Prev/next pager that preserves the view + current sort.
function claPager(view, page) {
    if (!page.total) return "";
    const link = (p, label, disabled) => (disabled
        ? `<span class="pager-btn disabled">${esc(label)}</span>`
        : `<a class="pager-btn" href="/admin/cla?view=${view}&sort=${page.sort}&dir=${page.dir}&page=${p}">${esc(label)}</a>`);
    return `<div class="pager">
             ${link(page.page - 1, "‹ Zurück", page.page <= 1)}
             <span class="pager-info">Seite ${esc(String(page.page))} / ${esc(String(page.totalPages))} · ${esc(String(page.total))} gesamt</span>
             ${link(page.page + 1, "Weiter ›", page.page >= page.totalPages)}
           </div>`;
}

/**
 * CLA / Logcheck page. Two sub-views selected via a submenu: "reports" (the log
 * evaluations, default) and "logs" (logs detected in the log channels). Both are
 * sortable + paged; the active one is passed in as reportPage / logPage.
 * @param {object} opts { view, reportPage, logPage, counts, logChannelIds,
 *                        activeGuildId, csrf, msg, nav }
 */
function renderCla(user, opts = {}) {
    const view = opts.view === "logs" ? "logs" : "reports";
    const counts = opts.counts || { reports: 0, logs: 0 };
    const logChannelIds = opts.logChannelIds || [];
    const csrfField = hiddenCsrf(opts.csrf || "");

    const tab = (id, label, count) => `<a class="subnav-item${view === id ? " active" : ""}" href="/admin/cla?view=${id}">${esc(label)}${count ? ` <span class="subnav-count">${esc(String(count))}</span>` : ""}</a>`;
    const subnav = `<div class="subnav">${tab("reports", "Auswertungen", counts.reports)}${tab("logs", "Erkannte Logs", counts.logs)}</div>`;

    let content;
    if (view === "logs") {
        // --- detected logs ---
        const lp = opts.logPage || { items: [], sort: "date", dir: "desc", page: 1, totalPages: 1, total: 0 };
        const LOG_DIR = { title: "asc", status: "asc", date: "desc" };
        const lh = (key, label) => claSortHeader("logs", lp, LOG_DIR, key, label);
        let logsSection;
        if (!logChannelIds.length) {
            logsSection = "<p class=\"sub\">Es sind noch keine Log-Channels konfiguriert. Lege sie in den <a href=\"/admin/settings\">Einstellungen</a> fest, damit der Bot automatisch Logs erkennt.</p>";
        } else {
            const scanForm = `<form method="POST" action="/admin/cla/scan" style="margin:0 0 14px" onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').textContent='Suche läuft …'">
                 ${csrfField}
                 <button class="btn btn-ghost" type="submit">Log-Channels nach neuen Logs durchsuchen</button>
               </form>`;
            const table = lp.items.length
                ? `<table class="idx">
                     <thead><tr>
                       ${lh("title", "Log")}
                       <th>Report-ID</th>
                       <th>Kategorie</th>
                       <th>Quelle</th>
                       ${lh("status", "Status")}
                       ${lh("date", "Gepostet")}
                       <th></th>
                     </tr></thead>
                     <tbody>${lp.items.map((l) => logRow(l, csrfField)).join("")}</tbody>
                   </table>
                   ${claPager("logs", lp)}`
                : "<p class=\"sub\">Noch keine Logs erkannt. Sobald im Log-Channel ein Warcraft-Logs-Link gepostet wird, taucht er hier auf.</p>";
            logsSection = `${scanForm}${table}`;
        }
        content = `
      <h2>Erkannte Logs aus dem Log-Channel</h2>
      <p class="note">Vom Bot automatisch erkannte Warcraft-Logs, neueste zuerst (nach Post-Zeit im Channel). Über den WCL-Link vorab prüfen, dann „Auswerten" — jeder Report nur einmal.</p>
      ${logsSection}`;
    } else {
        // --- report evaluations ---
        const rp = opts.reportPage || { items: [], sort: "date", dir: "desc", page: 1, totalPages: 1, total: 0 };
        const REPORT_DIR = { title: "asc", zone: "asc", date: "desc", players: "desc", issues: "desc" };
        const rh = (key, label) => claSortHeader("reports", rp, REPORT_DIR, key, label);
        const reportRow = (r) => {
            const when = r.generatedAt ? new Date(r.generatedAt).toLocaleString("de-DE") : "";
            const wcl = r.reportUrl
                ? `<a class="mlink" href="${esc(r.reportUrl)}" target="_blank" rel="noopener">WCL ↗</a>`
                : "<span class=\"sub\">—</span>";
            return `<tr>
                     <td><a href="/r/${esc(r.id)}">${esc(r.title || r.id)}</a></td>
                     <td>${esc(r.zone || "")}</td>
                     <td class="small">${esc(when)}</td>
                     <td>${esc(r.playerCount)}</td>
                     <td><span class="pill">${esc(r.issueCount)}</span></td>
                     <td>${wcl}</td>
                   </tr>`;
        };
        const table = rp.items.length
            ? `<table class="idx">
                 <thead><tr>
                   ${rh("title", "Report")}
                   ${rh("zone", "Zone")}
                   ${rh("date", "Erstellt")}
                   ${rh("players", "Spieler")}
                   ${rh("issues", "Probleme")}
                   <th>WCL</th>
                 </tr></thead>
                 <tbody>${rp.items.map(reportRow).join("")}</tbody>
               </table>
               ${claPager("reports", rp)}`
            : "<p class=\"sub\">Noch keine Auswertungen.</p>";
        content = `
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
      <h2>Auswertungen</h2>
      ${table}`;
    }

    const body = `${subnav}${content}`;
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
                  <td class="cell-actions"><div class="row-actions" style="justify-content:flex-end"><a class="btn btn-ghost btn-sm" href="/admin/raids/detail?event=${esc(ev.id)}">Details</a></div></td>
                </tr>`;
            }).join("");
            // "＋ Event" pre-fills the create form by reusing this category's most
            // recent event as the template (title/template/channel-name format),
            // so a new raid keeps the same naming/format used in this category.
            const latest = g.events.slice().sort((a, b) => (b.startTime || 0) - (a.startTime || 0))[0];
            const newHref = "/admin/raids/new"
                + (latest ? `?source=${esc(latest.id)}` : "")
                + (g.categoryId ? `${latest ? "&" : "?"}category=${esc(g.categoryId)}` : "");
            return `<div class="dash-card" style="margin-bottom:16px">
                <div class="dash-card-head">
                  <h3>${esc(g.categoryName || "Ohne Kategorie")}</h3>
                  <span class="small" style="margin-left:auto">${g.events.length} Event(s)</span>
                  <a class="btn btn-ghost btn-sm" href="${newHref}" title="Neues Event in dieser Kategorie anlegen (Format vorbelegt)">＋ Event</a>
                </div>
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
 * @param {object} opts { defaults, leaderId, channels, reusableEvents, templates, csrf, msg, nav }
 */
function renderRaidCreate(user, opts = {}) {
    const d = opts.defaults || { templateId: "", channelId: "" };
    const leaderId = opts.leaderId || "";
    const templates = opts.templates || [];
    const reusableEvents = opts.reusableEvents || [];
    const csrfField = hiddenCsrf(opts.csrf || "");

    // Optional "reuse an existing event" picker. Selecting an event pre-fills the
    // form (title/template/description) and switches the channel input to a
    // clone-name field (see the toggle script below): a new channel is cloned
    // from the source event's channel and the new event is posted there.
    const preselect = (opts.defaults && opts.defaults.sourceEventId) || "";
    const reuseField = reusableEvents.length
        ? `<div class="field">
          <label>Vorhandenes Event wiederverwenden (optional)</label>
          <select name="sourceEventId" id="sourceEventSelect">
            <option value=""${preselect ? "" : " selected"}>— Neues Event von Grund auf —</option>
            ${reusableEvents.map((ev) => `<option value="${esc(ev.id)}"${ev.id === preselect ? " selected" : ""} data-title="${esc(ev.title || "")}" data-template="${esc(ev.templateId || "")}" data-desc="${esc(ev.description || "")}" data-channel="${esc(ev.channelName || "")}">${esc(ev.title || "(ohne Titel)")}${ev.channelName ? ` · #${esc(ev.channelName)}` : ""}</option>`).join("")}
          </select>
          <div class="hint">Übernimmt Titel, Template und Beschreibung. Der Channel des Events wird für das neue Datum geklont — den Namen unten anpassen.</div>
        </div>`
        : "";

    const createForm = `
      <p class="note"><a class="mlink" href="/admin/raids">← Zurück zur Event-Übersicht</a></p>
      <h2>Neues Raid-Event anlegen</h2>
      <p class="note">Legt über die Raid-Helper-API ein echtes Event mit Signup-Nachricht an. Standardwerte kommen aus den <a href="/admin/settings">Einstellungen</a>.</p>
      <form class="card-form" method="POST" action="/admin/raids/new" id="raidCreateForm">
        ${csrfField}
        ${reuseField}
        <div class="field">
          <label>Titel</label>
          <input type="text" name="title" placeholder="GDKP Karazhan" required>
        </div>
        <div class="field">
          <label>Datum</label>
          <input type="date" name="date" required>
        </div>
        <div class="field">
          <label>Uhrzeit</label>
          <input type="time" name="time" placeholder="20:00" required>
        </div>
        <div class="field">
          <label>Template</label>
          ${raidTemplateField(templates, d.templateId)}
          <div class="hint">${templates.length
        ? "Aus der Liste wählen oder eine eigene Raid-Helper-Template-ID eintippen."
        : "Noch keine Templates hinterlegt — Raid-Helper-Template-ID eintippen oder unten laden/anlegen."}</div>
        </div>
        <div class="field" id="channelPickField">
          <label>Channel</label>
          ${channelSelect("channelId", opts.channels || [], d.channelId, { required: true, allowEmpty: true })}
          <div class="hint">Text-Channels des oben gewählten Servers.</div>
        </div>
        <div class="field" id="channelNameField" style="display:none">
          <label>Channelname (neuer Klon)</label>
          <input type="text" name="channelName" id="channelNameInput" placeholder="z.B. gdkp-kara-24-07" disabled>
          <div class="hint">Aus dem gewählten Event vorbelegt — hier anpassen. Der Channel wird geklont (Rechte, Thema) und das neue Event darin gepostet.</div>
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
      </form>
      <script>(function(){
        var form=document.getElementById("raidCreateForm");if(!form)return;
        var src=form.querySelector("[name=sourceEventId]");if(!src)return;
        var pickField=document.getElementById("channelPickField");
        var pickInput=pickField?pickField.querySelector("select,input"):null;
        var nameField=document.getElementById("channelNameField");
        var nameInput=document.getElementById("channelNameInput");
        var titleInput=form.querySelector("[name=title]");
        var tplInput=form.querySelector("[name=templateId]");
        var descInput=form.querySelector("[name=description]");
        function apply(){
          var o=src.options[src.selectedIndex];
          if(o&&o.value){
            if(titleInput)titleInput.value=o.getAttribute("data-title")||"";
            if(tplInput)tplInput.value=o.getAttribute("data-template")||"";
            if(descInput)descInput.value=o.getAttribute("data-desc")||"";
            if(nameInput)nameInput.value=o.getAttribute("data-channel")||"";
            if(pickField)pickField.style.display="none";
            if(pickInput){pickInput.required=false;pickInput.disabled=true;}
            if(nameField)nameField.style.display="";
            if(nameInput){nameInput.required=true;nameInput.disabled=false;}
          }else{
            if(pickField)pickField.style.display="";
            if(pickInput){pickInput.required=true;pickInput.disabled=false;}
            if(nameField)nameField.style.display="none";
            if(nameInput){nameInput.required=false;nameInput.disabled=true;}
          }
        }
        src.addEventListener("change",apply);apply();
      })();</script>`;

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
    const attendance = opts.attendance || { responded: [], missing: [] };
    const attendanceRoleIds = opts.attendanceRoleIds || [];

    // Prominent "open sheet" button, shown top-right of the meta card once a
    // raid sheet has been created for this event.
    const sheetLink = opts.eventSheet && opts.eventSheet.url;
    const sheetBtn = sheetLink
        ? `<a class="btn sheet-btn" href="${esc(opts.eventSheet.url)}" target="_blank" rel="noopener">📄 Sheet öffnen</a>`
        : "";
    const meta = `
      <div class="dash-card" style="margin-bottom:16px">
        <div class="dash-card-head" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
          <h3 style="margin:0">${esc(ev.title || "(ohne Titel)")}</h3>
          ${sheetBtn}
        </div>
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

    // --- Setup (Raidplan comp), grouped into raid groups 1-5 with class icons/colours ---
    let setupSection;
    if (opts.setupError) {
        setupSection = `<div class="flash flash-err">Setup konnte nicht geladen werden: ${esc(opts.setupError)}</div>`;
    } else if (!setup || !setup.total) {
        setupSection = "<p class=\"sub\">Für dieses Event ist noch kein Setup (Raidplan) angelegt.</p>";
    } else {
        const summary = "<div class=\"setup-summary\">"
            + `<span class="setup-count setup-total"><b>${esc(String(setup.total))}</b> Raider</span>`
            + `<span class="setup-count"><b>${esc(String(setup.groups.length))}</b> Gruppen</span>`
            + "</div>";
        const groups = setup.groups.map((g) => `
      <div class="setup-group">
        <h4 class="setup-group-head">${esc(g.label)}<span class="setup-group-n">${esc(String(g.players.length))}</span></h4>
        <div class="setup-group-list">${g.players.map((p) => `
          <span class="setup-player" style="border-left-color:${esc(p.classColor || "var(--line)")}" title="${esc(p.specName)}">
            ${p.iconUrl ? `<img class="setup-ico" src="${esc(p.iconUrl)}" alt="${esc(p.className || "")}" title="${esc(p.specName)}" loading="lazy">` : "<span class=\"setup-ico setup-ico-blank\"></span>"}
            <span class="sp-name">${esc(p.name)}</span>
          </span>`).join("")}</div>
      </div>`).join("");
        setupSection = summary + `<div class="setup-groups">${groups}</div>`;
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
        // 3rd tank: a picker of all tank-capable raiders in the setup, falling
        // back to a free-text field when no candidates (or setup) are available.
        const tankCands = opts.tankCandidates || [];
        const tank3Field = tankCands.length
            ? `<div class="field">
          <label>Tank 3 (Off-Tank, optional)</label>
          <select name="tank3">
            <option value="">— keiner —</option>
            ${tankCands.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}${c.specName ? ` — ${esc(c.specName)}` : ""}</option>`).join("")}
          </select>
          <div class="hint">Auswahl aller tank-fähigen Raider im Setup. Wird in die 3. Tank-Zeile eingetragen.</div>
        </div>`
            : `<div class="field">
          <label>Tank 3 (optional)</label>
          <input type="text" name="tank3" placeholder="Name des 3. Tanks">
          <div class="hint">Wird manuell in die Tank-Zeile eingetragen.</div>
        </div>`;
        // Link to the copy already created for this event (if any), with its
        // scheduled deletion date.
        const es = opts.eventSheet;
        const existingSheet = es && es.url
            ? `<div class="sheetcard">
          <div><strong>Gefülltes Sheet:</strong> <a class="mlink" href="${esc(es.url)}" target="_blank" rel="noopener">${esc(es.eventTitle || "Sheet öffnen")}</a></div>
          <div class="hint">${es.deleteAfter ? `Wird am ${esc(formatTimestampToDateString(es.deleteAfter).split(" - ")[0].trim())} automatisch gelöscht.` : "Kopie ist angelegt."} Erneutes Füllen ersetzt diese Kopie.</div>
        </div>`
            : "";
        fillSection = existingSheet + `
      <form class="card-form" method="POST" action="/admin/raids/fill" onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').textContent='Erstelle Sheet …'">
        ${csrfField}
        <input type="hidden" name="event" value="${esc(ev.id)}">
        <div class="field"><label>Vorlage (Ausgangssheet)</label><select name="sheetId" required>${sheetOptions}</select><div class="hint">${matchHint}</div></div>
        ${tank3Field}
        <div class="row-actions"><button class="btn" type="submit">Neues Sheet erstellen &amp; füllen</button></div>
      </form>`;
    }

    // --- Anwesenheit: role holders who have not reacted to the signup yet ---
    const nameList = (people) => people.length
        ? `<div class="rolegrid">${people.map((p) => `<span class="rolebox">${esc(p.displayName || p.id)}</span>`).join("")}</div>`
        : "<p class=\"sub\">—</p>";
    let attendanceSection;
    if (!attendanceRoleIds.length) {
        attendanceSection = "<p class=\"sub\">Dieser Kategorie sind noch keine Raider-Rollen zugeordnet. Lege sie in den <a class=\"mlink\" href=\"/admin/settings\">Einstellungen → Events</a> fest, um zu sehen, wer noch fehlt.</p>";
    } else if (opts.membersError) {
        attendanceSection = `<div class="flash flash-err">Mitglieder konnten nicht geladen werden: ${esc(opts.membersError)}</div>`
            + "<p class=\"sub\">Für den Rollen-Abgleich muss im Discord Developer Portal der <strong>„Server Members Intent“</strong> aktiviert sein.</p>";
    } else {
        const expected = attendance.responded.length + attendance.missing.length;
        const summary = "<div class=\"setup-summary\">"
            + `<span class="setup-count setup-total"><b>${esc(String(expected))}</b> erwartet</span>`
            + `<span class="setup-count"><b>${esc(String(attendance.responded.length))}</b> reagiert</span>`
            + `<span class="setup-count"><b>${esc(String(attendance.missing.length))}</b> fehlt</span>`
            + "</div>";
        const pingForm = attendance.missing.length
            ? `<form class="card-form" method="POST" action="/admin/raids/ping-missing" style="margin-top:16px" onsubmit="this.querySelector('button').disabled=true">
        ${csrfField}
        <input type="hidden" name="event" value="${esc(ev.id)}">
        <div class="field">
          <label>Nachricht (optional)</label>
          <input type="text" name="text" placeholder="Bitte meldet euch für den Raid an oder ab.">
          <div class="hint">Wird im Event-Channel gepostet und pingt genau die ${esc(String(attendance.missing.length))} fehlenden Raider.</div>
        </div>
        <div class="row-actions"><button class="btn" type="submit">Fehlende Raider pingen</button></div>
      </form>`
            : "<p class=\"sub\" style=\"margin-top:12px\">Es haben schon alle erwarteten Raider reagiert. 🎉</p>";
        attendanceSection = summary
            + `<h4 style="margin:14px 0 6px">Fehlt (noch keine Reaktion)</h4>${nameList(attendance.missing)}`
            + `<h4 style="margin:14px 0 6px">Reagiert (an- oder abgemeldet)</h4>${nameList(attendance.responded)}`
            + pingForm;
    }

    const body = `
      <p class="note"><a class="mlink" href="/admin/raids">← Zurück zur Event-Übersicht</a></p>
      ${meta}
      <div class="tabs" role="tablist">
        <button type="button" class="tab-btn active" data-tab="setup" role="tab">Setup</button>
        <button type="button" class="tab-btn" data-tab="attendance" role="tab">Anwesenheit</button>
        <button type="button" class="tab-btn" data-tab="actions" role="tab">Anmeldung &amp; Sheet</button>
      </div>
      <div class="tab-panel active" data-panel="setup" role="tabpanel">
        <p class="note">Aktueller Raidplan dieses Events, in Raid-Gruppen 1–5 wie im Raid-Helper. Icons und Farben richten sich nach der WoW-Spec.</p>
        ${setupSection}
      </div>
      <div class="tab-panel" data-panel="attendance" role="tabpanel">
        <p class="note">Abgleich der Raider-Rollen dieser Kategorie mit den Raid-Helper-Anmeldungen: wer sich an- oder abgemeldet hat und wer noch gar nicht reagiert hat.</p>
        ${attendanceSection}
      </div>
      <div class="tab-panel" data-panel="actions" role="tabpanel">
        <h2 style="margin-top:0">Anmelde-Aufruf</h2>
        <p class="note">Postet eine Aufruf-Nachricht in den Event-Channel und pingt die gewählten Rollen.</p>
        ${notifySection}
        <h2>Raidsheet füllen</h2>
        <p class="note">Legt für diesen Raid eine eigene Kopie der Vorlage an, überträgt das Raid-Helper-Setup hinein und teilt sie per Link. Die Kopie wird 3 Tage nach dem Raid automatisch gelöscht; die Vorlage bleibt unangetastet.</p>
        ${fillSection}
      </div>
      <script>(function(){
        var btns=document.querySelectorAll(".tab-btn");
        var panels=document.querySelectorAll(".tab-panel");
        btns.forEach(function(b){ b.addEventListener("click",function(){
          var t=b.getAttribute("data-tab");
          btns.forEach(function(x){ x.classList.toggle("active", x===b); });
          panels.forEach(function(p){ p.classList.toggle("active", p.getAttribute("data-panel")===t); });
        }); });
      })();</script>`;
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
    const roles = opts.roles || [];
    const categories = opts.categories || [];
    const categoryRoles = config.categoryRoles || {};
    const csrfField = hiddenCsrf(opts.csrf || "");

    // Event categories are picked by NAME from the guild's real categories (not by
    // typing raw IDs), so they can be told apart. Each chosen category gets a grid
    // of raider-role checkboxes — filtered to raid/raider roles — which powers the
    // attendance / "ping missing raiders" feature on the event detail page.
    const configuredCatIds = config.categoryIds || [];
    // Show every guild category, plus any configured id the bot can't currently
    // resolve to a name (so a stale/unknown selection is never silently dropped).
    const knownCatIds = new Set(categories.map((c) => c.id));
    const catRows = [
        ...categories.map((c) => ({ id: c.id, name: c.name, unknown: false })),
        ...configuredCatIds.filter((id) => !knownCatIds.has(id)).map((id) => ({ id, name: id, unknown: true })),
    ];
    // Only offer roles that have to do with Raid / Raider.
    const raidRoles = roles.filter((r) => /raid/i.test(r.name || ""));

    let categoryRolesSection;
    if (!catRows.length) {
        categoryRolesSection = "<p class=\"hint\">Keine Kategorien geladen (Server gewählt und Bot online?). Die Auswahl ist verfügbar, sobald der Bot verbunden ist.</p>";
    } else {
        const roleHint = raidRoles.length
            ? ""
            : "<div class=\"hint\">Keine Raid-/Raider-Rollen gefunden. Es werden nur Rollen angeboten, deren Name „Raid“ enthält.</div>";
        categoryRolesSection = catRows.map((cat) => {
            const isEvent = configuredCatIds.includes(cat.id);
            const assigned = new Set(categoryRoles[cat.id] || []);
            const boxes = raidRoles.map((r) =>
                `<label class="rolebox"><input type="checkbox" name="catrole:${esc(cat.id)}:${esc(r.id)}" value="1"${assigned.has(r.id) ? " checked" : ""}> @${esc(r.name)}</label>`).join("");
            return `<div class="field">
          <label class="rolebox" style="font-weight:600"><input type="checkbox" name="cat:${esc(cat.id)}" value="1"${isEvent ? " checked" : ""}> ${esc(cat.name)}${cat.unknown ? " <span class=\"hint\" style=\"font-weight:400\">(unbekannte ID — abwählen zum Entfernen)</span>" : ""}</label>
          <div class="rolegrid" style="margin-top:8px">${boxes || "<span class=\"hint\">—</span>"}</div>
        </div>`;
        }).join("") + roleHint;
    }

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
      <p class="note">Google-Sheets nach Content aufgeteilt (Tier 4/5 usw.). Beim Füllen wird anhand der Keywords das passende Sheet vorgeschlagen.</p>
      ${raidsheets.map((s) => sheetForm(s)).join("")}
      <h3 style="margin-top:18px">Neues Raidsheet</h3>
      ${sheetForm(null)}`;

    const body = `
      <p class="note">Alle Werte werden in der Datenbank gespeichert und greifen ohne Bot-Neustart. IDs bekommst du in Discord per Rechtsklick → „ID kopieren" (Entwicklermodus).</p>
      <div class="tabs" role="tablist">
        <button type="button" class="tab-btn active" data-tab="zugang" role="tab">Zugang</button>
        <button type="button" class="tab-btn" data-tab="recruitment" role="tab">Recruitment</button>
        <button type="button" class="tab-btn" data-tab="auktionen" role="tab">Auktionen</button>
        <button type="button" class="tab-btn" data-tab="events" role="tab">Events</button>
        <button type="button" class="tab-btn" data-tab="logs" role="tab">Logs</button>
        <button type="button" class="tab-btn" data-tab="raidsheets" role="tab">Raidsheets</button>
      </div>
      <form class="card-form" method="POST" action="/admin/settings">
        ${csrfField}
        <div class="tab-panel active" data-panel="zugang" role="tabpanel">
          <h2 style="margin-top:0">Admin-Zugang</h2>
          <div class="field">
            <label>Admin-Rollen (Discord-Rollen-IDs, kommagetrennt)</label>
            <input type="text" name="adminRoleIds" value="${esc((config.adminRoleIds || []).join(", "))}" placeholder="123456789012345678, 234567890123456789">
            <div class="hint">Mitglieder mit einer dieser Rollen erhalten Admin-Zugang. Die <code>ADMIN_USER_ID</code> aus der .env behält immer Zugang (Notfall-Zugang).</div>
          </div>
        </div>

        <div class="tab-panel" data-panel="recruitment" role="tabpanel">
          <h2 style="margin-top:0">Recruitment</h2>
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
        </div>

        <div class="tab-panel" data-panel="auktionen" role="tabpanel">
          <h2 style="margin-top:0">Auktionen</h2>
          <div class="field">
            <label>Höchstgebote-Channel-ID</label>
            <input type="text" name="highestBidsChannelId" value="${esc(config.highestBidsChannelId || "")}" placeholder="Discord-Channel-ID">
          </div>
          <div class="field">
            <label>Höchstgebote-Message-ID</label>
            <input type="text" name="highestBidsMessageId" value="${esc(config.highestBidsMessageId || "")}" placeholder="Discord-Message-ID">
            <div class="hint">Die Nachricht mit der Höchstgebote-Übersicht, die der Bot aktualisiert.</div>
          </div>
        </div>

        <div class="tab-panel" data-panel="events" role="tabpanel">
          <h2 style="margin-top:0">Event-Kategorien &amp; Raider-Rollen</h2>
          <p class="hint">Wähle die Kategorien, deren Channels Raid-Events enthalten, und ordne jeder die erwarteten Raider-Rollen zu. Auf der Event-Detail-Seite wird dann angezeigt, wer sich angemeldet hat und wer (mit einer dieser Rollen) noch fehlt.</p>
          ${categoryRolesSection}

          <h2>Raid-Standardwerte</h2>
          <div class="field">
            <label>Standard-Template-ID</label>
            <input type="text" name="raidTemplateId" value="${esc(rd.templateId || "")}" placeholder="Raid-Helper Template-ID">
          </div>
          <div class="field">
            <label>Standard-Channel-ID</label>
            <input type="text" name="raidChannelId" value="${esc(rd.channelId || "")}" placeholder="Discord-Channel-ID">
          </div>
        </div>

        <div class="tab-panel" data-panel="logs" role="tabpanel">
          <h2 style="margin-top:0">Log-Auswertung</h2>
          <div class="field">
            <label>Log-Channel-IDs (kommagetrennt)</label>
            <input type="text" name="logChannelIds" value="${esc((config.logChannelIds || []).join(", "))}" placeholder="111…, 222…">
            <div class="hint">Channels, in denen automatisch Warcraft-Logs gepostet werden. Der Bot bietet dort per Button die Auswertung an.</div>
          </div>
        </div>

        <div class="row-actions settings-save">
          <button class="btn" type="submit">Speichern</button>
        </div>
      </form>

      <div class="tab-panel" data-panel="raidsheets" role="tabpanel">
        <h2 style="margin-top:0">Raidsheets</h2>
        ${raidsheetSection}
      </div>

      <script>(function(){
        var btns=document.querySelectorAll(".tabs .tab-btn");
        var panels=document.querySelectorAll(".tab-panel");
        var save=document.querySelector(".settings-save");
        btns.forEach(function(b){ b.addEventListener("click",function(){
          var t=b.getAttribute("data-tab");
          btns.forEach(function(x){ x.classList.toggle("active", x===b); });
          panels.forEach(function(p){ p.classList.toggle("active", p.getAttribute("data-panel")===t); });
          if(save){ save.style.display = t==="raidsheets" ? "none" : ""; }
        }); });
      })();</script>`;
    return adminLayout("Einstellungen — Pulsebot Admin", "settings", user, body, opts.msg, opts.nav);
}

module.exports = {
    adminLayout, adminNav, renderDashboard, renderAdminDenied,
    renderRecruitment, renderCla, renderRaids, renderRaidCreate,
    renderEventDetail, renderNotifyTemplates, renderChannels, renderSettings, hiddenCsrf, esc,
};
