// HTML rendering for the web admin menu. Reuses the shared page shell (layout)
// + esc/authBar/themeToggleBtn from render.js and adds the admin sidebar shell.

const { layout, esc, authBar, themeToggleBtn } = require("./render");
const { logPostedAt } = require("./reportList");
const { formatTimestampToDateString } = require("../utils/date");
const {
    SPEC_CATALOG, SPEC_LINE_RE, resolveSpec, parseWantedBlock, buildSpecLine, insertSpecLine, removeSpecLine,
} = require("../utils/recruitmentSpecs");
const { CLASS_COLORS, classSpecIconUrl } = require("../utils/setupView");

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
  /* "Spektrum": each section keeps its own accent for the active state, not just the default blue */
  .nav-item.area-recruitment.active { background:var(--area-recruitment-soft); border-color:var(--area-recruitment-soft); }
  .nav-item.area-recruitment.active::before { background:var(--area-recruitment); }
  .nav-item.area-recruitment.active svg { color:var(--area-recruitment); }
  .nav-item.area-cla.active { background:var(--area-cla-soft); border-color:var(--area-cla-soft); }
  .nav-item.area-cla.active::before { background:var(--area-cla); }
  .nav-item.area-cla.active svg { color:var(--area-cla); }
  .nav-item.area-history.active { background:var(--area-history-soft); border-color:var(--area-history-soft); }
  .nav-item.area-history.active::before { background:var(--area-history); }
  .nav-item.area-history.active svg { color:var(--area-history); }
  .nav-item.area-channels.active { background:var(--area-channels-soft); border-color:var(--area-channels-soft); }
  .nav-item.area-channels.active::before { background:var(--area-channels); }
  .nav-item.area-channels.active svg { color:var(--area-channels); }
  .nav-item.area-settings.active { background:var(--area-settings-soft); border-color:var(--area-settings-soft); }
  .nav-item.area-settings.active::before { background:var(--area-settings); }
  .nav-item.area-settings.active svg { color:var(--area-settings); }
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
  .top-actions { margin-left:auto; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .menu-toggle { display:none; }
  .content { padding:24px; max-width:1080px; width:100%; }
  .page-title { font-size:24px; font-weight:800; letter-spacing:-.3px; margin:0 0 18px; }
  /* ===== admin components ===== */
  .cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:14px; }
  .navcard {
    display:block; background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:18px; text-decoration:none;
    transition:background-color .15s ease, border-color .15s ease, transform .15s ease, box-shadow .15s ease; }
  .navcard:hover { background:var(--panel2); border-color:var(--accent); transform:translateY(-2px); box-shadow:0 10px 28px -10px var(--accent); }
  .navcard h3 { margin:0 0 6px; font-size:17px; }
  .navcard p { margin:0; color:var(--muted); font-size:13.5px; }
  .navcard .ico { display:inline-grid; place-items:center; width:38px; height:38px; border-radius:9px; background:var(--accent-soft); color:var(--accent); margin-bottom:10px; }
  .navcard .ico svg { width:20px; height:20px; }
  form.card-form { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:18px; margin:0 0 16px; }
  .field { margin-bottom:16px; }
  .field label { display:block; font-size:13px; color:var(--muted); margin-bottom:7px; font-weight:600; line-height:1.3; }
  /* every text-like input type (not just text/url) gets the same box — number, date, time,
     password, search, tel, email, … so nothing falls back to unstyled browser chrome.
     Capped max-width so short values (dates, IDs, numbers) don't stretch across the whole card. */
  .field input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]):not([type=submit]):not([type=button]),
  .field select {
    width:100%; max-width:440px; background:var(--bg); color:var(--text); border:1px solid var(--line); border-radius:8px;
    padding:9px 12px; font:inherit; transition:border-color .15s ease, box-shadow .15s ease, background-color .15s ease; }
  .field input[type=date], .field input[type=time], .field input[type=datetime-local] { max-width:190px; }
  .field input[type=number] { max-width:130px; }
  .field textarea {
    width:100%; background:var(--bg); color:var(--text); border:1px solid var(--line); border-radius:8px;
    padding:10px 12px; font:inherit; min-height:160px; resize:vertical;
    transition:border-color .15s ease, box-shadow .15s ease, background-color .15s ease; }
  .field input:focus, .field textarea:focus, .field select:focus {
    border-color:var(--accent); outline:none; box-shadow:0 0 0 3px var(--accent-soft), 0 0 18px -6px var(--accent); }
  .field .hint { color:var(--muted); font-size:12px; margin-top:5px; line-height:1.4; }
  .field input[disabled] { opacity:.6; cursor:not-allowed; box-shadow:none; }
  /* file upload: dashed drop-style box + a real accent button for the native picker */
  .field input[type=file] {
    width:100%; background:var(--bg); color:var(--muted); border:1.5px dashed var(--line); border-radius:8px;
    padding:9px 12px; font:inherit; font-size:13.5px; cursor:pointer; transition:border-color .15s ease, box-shadow .15s ease; }
  .field input[type=file]:hover, .field input[type=file]:focus-visible {
    border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-soft); outline:none; }
  .field input[type=file]::file-selector-button {
    background:var(--accent); color:var(--accent-ink); border:0; border-radius:6px; padding:7px 14px;
    font-weight:700; font-size:13px; cursor:pointer; margin-right:12px; transition:filter .15s ease, transform .1s ease; }
  .field input[type=file]::file-selector-button:hover { filter:brightness(1.08); }
  .field input[type=file]::file-selector-button:active { transform:scale(.97); }
  /* custom checkbox — replaces the native browser box everywhere, not just inside .field */
  input[type=checkbox] {
    appearance:none; -webkit-appearance:none; width:18px; height:18px; min-width:18px; margin:0;
    border:1.5px solid var(--line); border-radius:5px; background:var(--bg); cursor:pointer; position:relative;
    transition:background-color .15s ease, border-color .15s ease, box-shadow .15s ease; flex:0 0 auto; }
  input[type=checkbox]:hover { border-color:var(--accent); }
  input[type=checkbox]:checked {
    background-color:var(--accent); border-color:var(--accent);
    box-shadow:0 0 0 3px var(--accent-soft), 0 0 10px -3px var(--accent); }
  input[type=checkbox]:checked::after {
    content:""; position:absolute; left:3px; top:3px; width:8px; height:5px;
    border:2px solid var(--accent-ink); border-top:0; border-right:0; transform:rotate(-45deg);
    animation:chk-pop .2s cubic-bezier(.34,1.56,.64,1); }
  @keyframes chk-pop { from { transform:rotate(-45deg) scale(.3); opacity:0; } to { transform:rotate(-45deg) scale(1); opacity:1; } }
  input[type=checkbox]:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  input[type=checkbox]:disabled { opacity:.5; cursor:not-allowed; box-shadow:none; }
  /* toggle switch — for a single on/off setting (as opposed to multi-select checkbox lists) */
  .switch { position:relative; display:inline-flex; align-items:center; flex:0 0 auto; cursor:pointer; }
  .switch input[type=checkbox] {
    position:absolute; inset:0; width:36px; height:20px; margin:0; opacity:0; border:0; background:none; cursor:pointer; box-shadow:none; }
  .switch input[type=checkbox]::after { content:none; }
  .switch-track {
    width:36px; height:20px; border-radius:999px; background:var(--panel3); border:1.5px solid var(--line);
    transition:background-color .2s ease, border-color .2s ease, box-shadow .2s ease; flex:0 0 auto; position:relative; }
  .switch-thumb {
    position:absolute; top:2px; left:2px; width:14px; height:14px; border-radius:50%; background:var(--muted);
    transition:transform .25s cubic-bezier(.34,1.56,.64,1), background-color .2s ease; }
  .switch input[type=checkbox]:checked + .switch-track {
    background:var(--accent); border-color:var(--accent);
    box-shadow:0 0 0 3px var(--accent-soft), 0 0 12px -3px var(--accent); }
  .switch input[type=checkbox]:checked + .switch-track .switch-thumb { transform:translateX(16px); background:var(--accent-ink); }
  .switch input[type=checkbox]:focus-visible + .switch-track { outline:2px solid var(--accent); outline-offset:2px; }
  .switch-row { display:flex; align-items:center; gap:10px; cursor:pointer; }
  .btn {
    display:inline-block; background:var(--accent); color:var(--accent-ink); border:0; border-radius:8px; padding:9px 18px;
    font-weight:700; font-size:14px; cursor:pointer; text-decoration:none;
    transition:filter .15s ease, box-shadow .2s ease, transform .1s ease; }
  .btn:hover { filter:brightness(1.08); }
  .btn:not(.btn-ghost):not(.btn-danger):hover { box-shadow:0 4px 22px -6px var(--accent); transform:translateY(-1px); }
  .btn:not(.btn-ghost):active { transform:translateY(0); }
  .btn-ghost { background:var(--panel2); color:var(--text); border:1px solid var(--line); }
  .btn-ghost:hover { filter:none; background:var(--panel3); border-color:var(--accent); }
  .btn-danger { background:var(--high-bg); color:var(--high); border:1px solid var(--high); }
  .btn-danger:hover { filter:none; background:var(--high); color:#fff; box-shadow:0 4px 22px -8px var(--high); transform:translateY(-1px); }
  .btn-sm { padding:6px 12px; font-size:13px; }
  /* round icon-only row action (open / delete a log entry) */
  .btn-icon { display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; padding:0; border-radius:9px; flex:0 0 auto; }
  .btn-icon svg { width:16px; height:16px; }
  @media (prefers-reduced-motion:reduce) {
    input[type=checkbox]:checked::after, .switch-thumb, .btn, .navcard, .rolebox,
    .field input, .field textarea, .field select, .emoji-panel { transition:none !important; animation:none !important; }
  }
  /* compact inline select for in-table forms (e.g. the log→event assignment) */
  .sel-sm { max-width:270px; background:var(--bg); color:var(--text); border:1px solid var(--line); border-radius:8px; padding:6px 8px; font:inherit; font-size:13px; }
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
  /* inline pill badges (loot source / response) — distinct from render.js's corner .badge */
  .lbadge { display:inline-block; padding:2px 8px; border-radius:999px; font-size:12px; font-weight:700; line-height:1.5; border:1px solid var(--line); background:var(--panel2); color:var(--muted); }
  .lbadge-ok { background:var(--good-bg); color:var(--good); border-color:var(--good); }
  .lbadge-neutral { background:var(--accent-soft); color:var(--accent); border-color:var(--accent-soft); }
  .lbadge-warn { background:var(--high-bg); color:var(--high); border-color:var(--high); }
  /* inline flash (kept for contextual, in-content errors) */
  .flash { border-radius:8px; padding:10px 14px; margin-bottom:16px; font-size:14px; }
  .flash-ok { background:var(--good-bg); color:var(--good); border:1px solid var(--good); }
  .flash-err { background:var(--high-bg); color:var(--high); border:1px solid var(--high); }
  /* toast notifications (post-redirect ok/err feedback) */
  .toast-wrap { position:fixed; top:16px; right:16px; z-index:1000; display:flex; flex-direction:column; gap:8px; max-width:min(360px,calc(100vw - 32px)); pointer-events:none; }
  /* solid (opaque) background so the toast stays readable over any content it overlays */
  .toast { pointer-events:auto; display:flex; align-items:flex-start; gap:10px; padding:12px 14px; border-radius:10px; font-size:14px; line-height:1.4; box-shadow:0 8px 28px rgba(0,0,0,.35); background:var(--panel); border:1px solid var(--line); border-left:4px solid var(--line); color:var(--text); animation:toast-in .22s ease; }
  .toast-ok { border-left-color:var(--good); }
  .toast-ok .toast-ico { color:var(--good); }
  .toast-err { border-left-color:var(--high); }
  .toast-err .toast-ico { color:var(--high); }
  .toast-ico { flex:0 0 auto; font-weight:800; }
  .toast-msg { flex:1; }
  .toast-x { background:none; border:0; color:inherit; font-size:18px; line-height:1; cursor:pointer; opacity:.7; padding:0; margin:-2px -2px 0 0; }
  .toast-x:hover { opacity:1; }
  .toast.hide { animation:toast-out .22s ease forwards; }
  @keyframes toast-in { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:none; } }
  @keyframes toast-out { from { opacity:1; transform:none; } to { opacity:0; transform:translateX(20px); } }
  @media (prefers-reduced-motion:reduce) { .toast, .toast.hide { animation:none; } }
  .serverbar { display:flex; align-items:center; gap:8px; margin:0; flex-wrap:wrap; }
  .serverbar label { color:var(--muted); font-size:13px; font-weight:600; margin:0; }
  .serverbar select { background:var(--panel2); color:var(--text); border:1px solid var(--line); border-radius:8px; padding:6px 10px; font:inherit; }
  .serverbar .hint { color:var(--medium); font-size:12.5px; }
  a.mlink { color:var(--accent); text-decoration:none; }
  a.mlink:hover { text-decoration:underline; }
  .rolegrid { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:6px; max-height:220px; overflow-y:auto; border:1px solid var(--line); border-radius:8px; padding:10px; background:var(--bg); }
  .rolegrid.rolegrid-flat { max-height:none; overflow-y:visible; }
  .rolebox {
    display:flex; align-items:flex-start; gap:8px; font-size:13.5px; color:var(--text); font-weight:500; cursor:pointer;
    padding:5px 7px; border-radius:7px; border:1px solid transparent; transition:background-color .12s, border-color .12s; }
  /* checkbox sits on the first line of a (possibly multi-line) label, not centred against the whole block */
  .rolebox input[type=checkbox] { margin-top:1px; }
  .rolebox:hover { background:var(--panel2); }
  .rolebox:has(input:checked) { background:var(--accent-soft); border-color:var(--accent-soft); box-shadow:0 0 14px -8px var(--accent); }
  /* emoji picker */
  .emoji-picker { position:relative; display:inline-block; margin-top:2px; }
  .emoji-panel {
    display:none; position:absolute; z-index:20; top:calc(100% + 6px); left:0; width:288px; background:var(--panel);
    border:1px solid var(--line); border-radius:10px; padding:10px; box-shadow:0 12px 32px -6px rgba(0,0,0,.4), 0 0 0 1px var(--line);
    transform-origin:top left; }
  .emoji-panel.open { display:block; animation:emoji-pop .16s cubic-bezier(.2,.9,.3,1.2) both; }
  @keyframes emoji-pop { from { opacity:0; transform:scale(.92) translateY(-4px); } to { opacity:1; transform:none; } }
  .emoji-search {
    width:100%; background:var(--bg); color:var(--text); border:1px solid var(--line); border-radius:8px; padding:7px 10px;
    font:inherit; margin-bottom:8px; transition:border-color .15s ease, box-shadow .15s ease; }
  .emoji-search:focus { border-color:var(--accent); outline:none; box-shadow:0 0 0 3px var(--accent-soft); }
  .emoji-grid { display:grid; grid-template-columns:repeat(6,1fr); gap:4px; max-height:220px; overflow-y:auto; }
  .emoji-item {
    display:grid; place-items:center; padding:5px; background:transparent; border:1px solid transparent; border-radius:7px;
    cursor:pointer; transition:background-color .12s ease, border-color .12s ease, transform .1s ease; }
  .emoji-item:hover { background:var(--accent-soft); border-color:var(--accent-soft); transform:translateY(-1px); }
  .emoji-item:active { transform:scale(.9); }
  .emoji-item:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
  .emoji-item img { width:26px; height:26px; object-fit:contain; }
  .hr-row:hover { background:var(--panel2); }
  .emoji-empty { color:var(--muted); font-size:12.5px; padding:6px 2px; }
  /* recruitment "gesuchte Klassen/Specs" picker: pills + add-dropdown */
  .spec-picker { display:flex; flex-direction:column; gap:10px; }
  .spec-pills { display:flex; flex-wrap:wrap; gap:6px; min-height:32px; }
  .spec-pill {
    display:inline-flex; align-items:center; gap:6px; background:var(--accent-soft); border:1px solid var(--accent-soft);
    color:var(--text); border-radius:999px; padding:4px 6px 4px 8px; font-size:13px; font-weight:600;
    animation:spec-pop .18s cubic-bezier(.34,1.56,.64,1) both; }
  .spec-pill img { width:18px; height:18px; border-radius:4px; flex:0 0 auto; }
  .spec-pill-q {
    width:18px; height:18px; border-radius:4px; background:var(--panel3); color:var(--muted); font-size:11px; font-weight:800;
    display:grid; place-items:center; flex:0 0 auto; }
  .spec-pill-custom { background:var(--panel2); border-color:var(--line); }
  .spec-pill-x {
    background:none; border:0; color:inherit; opacity:.6; cursor:pointer; font-size:15px; line-height:1; padding:2px;
    border-radius:50%; display:grid; place-items:center; transition:opacity .12s ease, background-color .12s ease; }
  .spec-pill-x:hover { opacity:1; background:rgba(0,0,0,.12); }
  @keyframes spec-pop { from { transform:scale(.85); opacity:0; } to { transform:none; opacity:1; } }
  /* icon dropdown to add another spec — same interaction/visual pattern as .emoji-picker */
  .spec-add { position:relative; display:inline-block; }
  .spec-add-panel {
    display:none; position:absolute; z-index:20; top:calc(100% + 6px); left:0; width:260px; background:var(--panel);
    border:1px solid var(--line); border-radius:10px; padding:10px; box-shadow:0 12px 32px -6px rgba(0,0,0,.4), 0 0 0 1px var(--line);
    transform-origin:top left; }
  .spec-add-panel.open { display:block; animation:emoji-pop .16s cubic-bezier(.2,.9,.3,1.2) both; }
  .spec-add-search {
    width:100%; background:var(--bg); color:var(--text); border:1px solid var(--line); border-radius:8px; padding:7px 10px;
    font:inherit; margin-bottom:8px; transition:border-color .15s ease, box-shadow .15s ease; }
  .spec-add-search:focus { border-color:var(--accent); outline:none; box-shadow:0 0 0 3px var(--accent-soft); }
  .spec-add-list { display:flex; flex-direction:column; gap:2px; max-height:230px; overflow-y:auto; }
  .spec-option {
    display:flex; align-items:center; gap:8px; width:100%; padding:6px 8px; background:transparent; border:1px solid transparent;
    border-radius:7px; cursor:pointer; font:inherit; font-size:13px; color:var(--text); text-align:left;
    transition:background-color .12s ease, border-color .12s ease; }
  .spec-option:hover { background:var(--accent-soft); border-color:var(--accent-soft); }
  .spec-option img { width:20px; height:20px; border-radius:4px; flex:0 0 auto; }
  .spec-empty { color:var(--muted); font-size:12.5px; padding:6px 2px; }
  @media (prefers-reduced-motion:reduce) { .spec-pill, .spec-add-panel.open { animation:none; } }
  /* setup (raidplan comp), grouped into raid groups 1-5 */
  .setup-summary { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px; }
  .setup-count { background:var(--panel2); border:1px solid var(--line); border-radius:999px; padding:4px 12px; font-size:13px; color:var(--muted); }
  .setup-count b { color:var(--text); font-variant-numeric:tabular-nums; }
  .setup-count.setup-total { border-color:var(--accent-soft); background:var(--accent-soft); }
  /* raid-roster avatar stack (real signups, class-coloured initials) */
  .avatar-stack { display:flex; align-items:center; }
  .avatar-stack .av {
    width:28px; height:28px; border-radius:50%; border:2px solid var(--panel); margin-left:-9px;
    font-size:10.5px; font-weight:800; display:flex; align-items:center; justify-content:center; flex:0 0 auto;
  }
  .avatar-stack .av:first-child { margin-left:0; }
  .avatar-stack .av.more { background:var(--panel2); color:var(--muted); border-color:var(--line); }
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
  .tab-count { display:inline-block; margin-left:6px; padding:0 7px; border-radius:999px; font-size:11.5px; font-weight:700; background:var(--panel2); color:var(--muted); border:1px solid var(--line); }
  .tab-btn.active .tab-count { background:var(--accent-soft); color:var(--accent); border-color:var(--accent-soft); }
  .sheetcard { background:var(--panel2); border:1px solid var(--line); border-radius:10px; padding:14px; margin-bottom:12px; }
  table.idx td.small { white-space:nowrap; color:var(--muted); font-size:12.5px; }
  /* sortable table headers + pager — class-only (not "a.sort-link") since
     lootTable() uses a <button> here, unlike claSortHeader()'s <a> */
  .sort-link { background:none; border:0; margin:0; padding:0; font:inherit; color:inherit; text-decoration:none; display:inline-flex; align-items:center; gap:2px; white-space:nowrap; cursor:pointer; }
  .sort-link:hover { color:var(--accent); }
  .sort-link.active { color:var(--accent); }
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
  /* recruitment applications list */
  .applist { display:flex; flex-direction:column; gap:12px; }
  .app-card-head { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:10px; }
  .app-card-head .app-name { font-size:15px; font-weight:800; }
  dl.app-meta { display:grid; grid-template-columns:auto 1fr; gap:5px 16px; margin:0; font-size:13.5px; align-items:baseline; }
  dl.app-meta dt { color:var(--muted); font-weight:600; white-space:nowrap; }
  dl.app-meta dd { margin:0; min-width:0; word-break:break-word; }
  /* dashboard */
  .dash-hero { position:relative; }
  .fx-orbs { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; opacity:.6; }
  .dash-hero-content { position:relative; z-index:1; }
  .tiles { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin-bottom:20px; }
  .tile { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:20px 22px;
    transition:transform .18s cubic-bezier(.34,1.56,.64,1), box-shadow .18s ease, border-color .18s ease; }
  .tile:hover { transform:translateY(-3px); border-color:var(--accent); box-shadow:0 14px 32px -14px var(--accent); }
  .tile.accent { border-top:2px solid var(--accent); }
  .tile .t-icon { width:36px; height:36px; border-radius:10px; background:var(--accent-soft); color:var(--accent);
    display:flex; align-items:center; justify-content:center; margin-bottom:14px; }
  .tile .t-icon svg { width:18px; height:18px; }
  .tile .t-label { font-size:12.5px; color:var(--muted); font-weight:600; }
  .tile .t-value { font-size:32px; font-weight:800; letter-spacing:-.5px; margin-top:6px; line-height:1; font-variant-numeric:tabular-nums; }
  .tile .t-sub { font-size:12.5px; color:var(--muted); margin-top:6px; }
  @media (prefers-reduced-motion:reduce) { .tile { transition:none; } .tile:hover { transform:none; } }
  /* "Spektrum": each dashboard tile picks up its section's accent for icon + hover glow */
  .tile.area-recruitment .t-icon { background:var(--area-recruitment-soft); color:var(--area-recruitment); }
  .tile.area-recruitment:hover { border-color:var(--area-recruitment); box-shadow:0 14px 32px -14px var(--area-recruitment); }
  .tile.area-cla .t-icon { background:var(--area-cla-soft); color:var(--area-cla); }
  .tile.area-cla:hover { border-color:var(--area-cla); box-shadow:0 14px 32px -14px var(--area-cla); }
  .tile.accent.area-cla { border-top-color:var(--area-cla); }
  .tile.area-channels .t-icon { background:var(--area-channels-soft); color:var(--area-channels); }
  .tile.area-channels:hover { border-color:var(--area-channels); box-shadow:0 14px 32px -14px var(--area-channels); }
  .tile.area-settings .t-icon { background:var(--area-settings-soft); color:var(--area-settings); }
  .tile.area-settings:hover { border-color:var(--area-settings); box-shadow:0 14px 32px -14px var(--area-settings); }
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
  /* Full-page loading overlay for long operations (softres create, sheet fill, posting). */
  .page-loader { position:fixed; inset:0; z-index:9999; display:none; align-items:center; justify-content:center;
    background:rgba(9,11,18,.66); backdrop-filter:blur(5px) saturate(1.1); -webkit-backdrop-filter:blur(5px) saturate(1.1); }
  .page-loader.show { display:flex; animation:pl-fade .18s ease both; }
  @keyframes pl-fade { from { opacity:0 } to { opacity:1 } }
  .pl-box { display:flex; flex-direction:column; align-items:center; gap:20px; padding:8px; }
  .pl-rune { position:relative; width:96px; height:96px; }
  .pl-rune span { position:absolute; border-radius:50%; }
  .pl-rune .r1 { inset:0; border:3px solid transparent; border-top-color:var(--accent); border-right-color:var(--accent);
    animation:pl-spin 1s cubic-bezier(.6,.2,.4,.8) infinite; }
  .pl-rune .r2 { inset:13px; border:3px solid transparent; border-bottom-color:var(--accent); opacity:.6;
    animation:pl-spin 1.5s linear infinite reverse; }
  .pl-rune .r3 { inset:32px; background:radial-gradient(circle at 50% 40%, #fff, var(--accent) 70%); box-shadow:0 0 26px 2px var(--accent);
    animation:pl-pulse 1.2s ease-in-out infinite; }
  @keyframes pl-spin { to { transform:rotate(360deg) } }
  @keyframes pl-pulse { 0%,100% { transform:scale(.55); opacity:.55 } 50% { transform:scale(1); opacity:1 } }
  .pl-text { color:#fff; font-weight:800; letter-spacing:.4px; font-size:15px; text-shadow:0 1px 8px rgba(0,0,0,.5); }
  .pl-dots::after { content:""; animation:pl-dots 1.4s steps(4,end) infinite; }
  @keyframes pl-dots { 0% { content:"" } 25% { content:"." } 50% { content:".." } 75% { content:"..." } 100% { content:"" } }
  @media (prefers-reduced-motion:reduce) {
    .pl-rune .r1,.pl-rune .r2,.pl-rune .r3,.pl-dots::after,.page-loader.show { animation-duration:.001ms; animation-iteration-count:1; }
  }
  /* history char: gear paperdoll (character-sheet layout: slot columns left/right,
     class portrait center, weapons below; WoW-style dark hover tooltips) */
  /* .dash-card clips overflow for rounded table corners; the tile tooltips are
     absolutely positioned and need to escape that clip to stay visible. */
  .gear-card { overflow:visible; }
  .gear-doll { display:grid; grid-template-columns:auto 1fr auto; gap:14px 20px; padding:18px; }
  .gear-col { display:flex; flex-direction:column; gap:9px; }
  .gear-col-right { align-items:flex-end; }
  .gear-center { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; }
  .gear-portrait { width:96px; height:96px; border-radius:14px; border:2px solid var(--line); object-fit:cover; box-shadow:0 0 24px rgba(0,0,0,.35); }
  .gear-avg { text-align:center; background:var(--panel2); border:1px solid var(--line); border-radius:10px; padding:6px 16px; }
  .gear-avg b { display:block; font-size:22px; line-height:1.1; font-variant-numeric:tabular-nums; }
  .gear-avg span { font-size:11px; color:var(--muted); }
  .gear-doll-bottom { grid-column:1 / -1; display:flex; justify-content:center; gap:12px; margin-top:4px; }
  .gear-tile { position:relative; width:52px; }
  .gear-icon { position:relative; display:block; width:52px; height:52px; border:2px solid var(--line); border-radius:8px; overflow:hidden; background:var(--panel2); box-shadow:0 0 8px rgba(0,0,0,.25); }
  .gear-icon img { width:100%; height:100%; display:block; }
  .gear-icon-ph { display:block; width:100%; height:100%; background:var(--panel3); }
  .gear-empty-ph { border-style:dashed; opacity:.45; }
  .gear-enchmark { position:absolute; top:1px; left:1px; width:13px; height:13px; line-height:13px; text-align:center; background:rgba(0,0,0,.68); color:#1eff00; font-size:11px; font-weight:800; border-radius:3px; }
  .gear-gems { position:absolute; right:2px; bottom:2px; display:flex; gap:2px; }
  .gear-gem { width:7px; height:7px; border-radius:2px; border:1px solid rgba(0,0,0,.5); display:inline-block; }
  .gear-tile-ilvl { margin-top:2px; text-align:center; font-size:11px; font-weight:700; color:var(--muted); font-variant-numeric:tabular-nums; min-height:14px; }
  /* WoW-style tooltip: always dark, item name in quality color, green enchant
     lines, gem icons — opens sideways per column so it stays inside the card */
  .gear-tip {
    display:none; position:absolute; z-index:40; top:0; width:252px;
    background:rgba(9,9,20,.97); border:1px solid #50506a; border-radius:8px; padding:10px 12px;
    box-shadow:0 14px 34px rgba(0,0,0,.55); color:#e8e8f0; font-size:12.5px; text-align:left;
  }
  .gear-tile:hover .gear-tip { display:block; }
  .gear-tile-left .gear-tip { left:calc(100% + 10px); }
  .gear-tile-right .gear-tip { right:calc(100% + 10px); }
  .gear-tile-bottom .gear-tip { top:auto; bottom:calc(100% + 10px); left:50%; transform:translateX(-50%); }
  /* invisible bridge over the gap so the tooltip stays open while moving the
     mouse into it (the item name inside is a link) */
  .gear-tile-left .gear-tip::before { content:""; position:absolute; right:100%; top:0; height:100%; width:12px; }
  .gear-tile-right .gear-tip::before { content:""; position:absolute; left:100%; top:0; height:100%; width:12px; }
  .gear-tile-bottom .gear-tip::before { content:""; position:absolute; top:100%; left:0; width:100%; height:12px; }
  .gt-name { display:block; font-weight:700; font-size:13.5px; text-decoration:none; margin-bottom:2px; }
  .gt-meta { color:#9a9ab0; font-size:11.5px; margin-bottom:6px; }
  .gt-ench { color:#1eff00; margin-top:2px; }
  .gt-gem { display:flex; align-items:center; gap:6px; margin-top:3px; color:#e8e8f0; }
  .gt-gem.gt-empty { color:#8a8a9a; }
  .gt-gemicon { width:16px; height:16px; border-radius:3px; border:1px solid rgba(0,0,0,.6); flex:0 0 auto; }
  .gear-gem-dot { width:9px; height:9px; border-radius:2px; border:1px solid var(--muted); flex:0 0 auto; }
  @media (max-width:640px) {
    .gear-doll { grid-template-columns:auto 1fr auto; gap:10px 8px; padding:12px; }
    .gear-portrait { width:64px; height:64px; }
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
    history: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 3v5h5\"/><path d=\"M3.05 13A9 9 0 1 0 6 5.3L3 8\"/><path d=\"M12 7v5l3 2\"/></svg>",
};

// icon-only row actions (log lists: open the evaluation / delete the tracked log)
const ACTION_ICONS = {
    open: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6\"/><path d=\"M15 3h6v6\"/><path d=\"M10 14 21 3\"/></svg>",
    trash: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 6h18\"/><path d=\"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\"/><path d=\"m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6\"/><path d=\"M10 11v6M14 11v6\"/></svg>",
};

// A small round icon-only button for a row action (open / delete). `kind` picks the
// color scheme ("ghost" = neutral, "danger" = destructive); `label` is used for the
// tooltip and accessible name since the icon alone carries no text.
function iconBtn(tag, kind, icon, label, attrs = "") {
    const cls = `btn btn-icon ${kind === "danger" ? "btn-danger" : "btn-ghost"}`;
    return `<${tag} class="${cls}" title="${esc(label)}" aria-label="${esc(label)}" ${attrs}>${ACTION_ICONS[icon]}</${tag}>`;
}

const TABS = [
    { id: "home", label: "Übersicht", href: "/", group: "Verwaltung" },
    { id: "recruitment", label: "Recruitment", href: "/admin/recruitment", group: "Verwaltung" },
    { id: "cla", label: "CLA / Logcheck", href: "/admin/cla", group: "Verwaltung" },
    { id: "raids", label: "Raid-Events", href: "/admin/raids", group: "Verwaltung" },
    { id: "history", label: "Historie & Loot", href: "/admin/history", group: "Verwaltung" },
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
        out += `<a class="nav-item area-${t.id}${t.id === active ? " active" : ""}" href="${t.href}">${NAV_ICONS[t.id] || ""}<span>${esc(t.label)}</span></a>`;
    }
    return `<nav class="menu">${out}</nav>`;
}

function tabLabel(active) {
    const t = TABS.find((x) => x.id === active);
    return t ? t.label : "Admin";
}

// Builds the clickable "Admin / Kategorie / Detail" trail in the topbar. `crumb`
// is an optional label for a page nested under the tab (e.g. a single event or
// character); when given, the tab segment becomes a link back to its list page,
// so every page can get back to its category in one click.
function breadcrumbTrail(active, crumb) {
    const tab = TABS.find((t) => t.id === active);
    const segments = [{ label: "Admin", href: "/" }];
    segments.push(crumb ? { label: tabLabel(active), href: tab ? tab.href : "/" } : { label: tabLabel(active), href: null });
    if (crumb) segments.push({ label: crumb, href: null });
    return segments
        .map((s) => (s.href ? `<a href="${s.href}">${esc(s.label)}</a>` : `<b>${esc(s.label)}</b>`))
        .join(" <span style=\"opacity:.45\">/</span> ");
}

// Post-redirect ok/err feedback is shown as an auto-dismissing toast (top-right),
// not as an inline banner. Inline, in-content errors still use the .flash-* classes.
function flash(msg) {
    if (!msg) return "";
    const ok = msg.type !== "err";
    return `<div class="toast-wrap"><div class="toast ${ok ? "toast-ok" : "toast-err"}" role="status" aria-live="polite">`
        + `<span class="toast-ico" aria-hidden="true">${ok ? "&#10003;" : "&#33;"}</span>`
        + `<span class="toast-msg">${esc(msg.text)}</span>`
        + "<button class=\"toast-x\" type=\"button\" aria-label=\"Schließen\">&times;</button>"
        + "</div></div>"
        + "<script>(function(){var s=document.currentScript,w=s.previousElementSibling,t=w.querySelector(\".toast\");"
        + "function close(){t.classList.add(\"hide\");setTimeout(function(){w.remove();},220);}"
        + "t.querySelector(\".toast-x\").addEventListener(\"click\",close);setTimeout(close,4500);})();</script>";
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

/**
 * A self-contained tab group. `groupId` must be unique on the page; `items` is
 * [{ id, label, content, active }] where `label` may contain HTML (e.g. a count
 * badge) and `content` is the panel HTML. The toggle script is scoped to the
 * group so multiple groups can coexist. Falls back to the first tab as active.
 */
function tabGroup(groupId, items) {
    const list = items.filter(Boolean);
    if (!list.length) return "";
    const activeIdx = Math.max(0, list.findIndex((t) => t.active));
    const btns = list.map((t, i) => `<button type="button" class="tab-btn${i === activeIdx ? " active" : ""}" data-tab="${esc(t.id)}" role="tab">${t.label}</button>`).join("");
    const panels = list.map((t, i) => `<div class="tab-panel${i === activeIdx ? " active" : ""}" data-panel="${esc(t.id)}" role="tabpanel">${t.content}</div>`).join("");
    return `<div class="tabwrap" id="${esc(groupId)}">
        <div class="tabs" role="tablist">${btns}</div>
        ${panels}
      </div>
      <script>(function(){
        var root=document.getElementById(${JSON.stringify(groupId)});if(!root)return;
        var btns=[].slice.call(root.querySelectorAll(".tabs > .tab-btn"));
        var panels=[].slice.call(root.children).filter(function(n){return n.classList&&n.classList.contains("tab-panel");});
        btns.forEach(function(b){b.addEventListener("click",function(){
          var t=b.getAttribute("data-tab");
          btns.forEach(function(x){x.classList.toggle("active",x===b);});
          panels.forEach(function(p){p.classList.toggle("active",p.getAttribute("data-panel")===t);});
        });});
      })();</script>`;
}

// Small count pill for a tab label.
function tabCount(n) {
    return `<span class="tab-count">${esc(String(n))}</span>`;
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
// The event's page INSIDE the admin tool — the default target for an event name,
// so a click stays in the tool instead of jumping to raid-helper.xyz.
function eventDetailUrl(eventId) {
    return `/admin/raids/detail?event=${encodeURIComponent(eventId)}`;
}
function eventDetailLink(event) {
    const label = (event && (event.title || event.id)) || "";
    return `<a class="mlink" href="${eventDetailUrl(event.id)}" data-loader="Event wird geladen">${esc(label)}</a>`;
}
// The bot may run in a UTC container (the Docker image sets no TZ), so every
// `toLocaleString` MUST pin the timeZone explicitly — otherwise German raid
// times render in the host zone (2h early in summer). See date.js for the
// Luxon-based formatters used elsewhere.
const DISPLAY_TZ = "Europe/Berlin";
function formatEventTime(startTime) {
    const secs = Number(startTime);
    if (!secs) return "";
    return new Date(secs * 1000).toLocaleString("de-DE", {
        timeZone: DISPLAY_TZ,
        weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
}

const CREST_SVG = "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linejoin=\"round\"><path d=\"M12 2 4 6v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6l-8-4Z\"/><path d=\"m9 12 2 2 4-4\" stroke-linecap=\"round\"/></svg>";
const BURGER_SVG = "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"><path d=\"M4 6h16M4 12h16M4 18h16\"/></svg>";

/** Wrap admin page body in the sidebar app shell (nav + topbar + content).
 * `extra.wowheadIconize` opts this page into Wowhead item icons + auto-names. */
function adminLayout(title, active, user, body, msg, nav, extra = {}) {
    const name = (user && user.name) || "Admin";
    const initial = esc(name.slice(0, 1).toUpperCase() || "A");
    const label = esc(tabLabel(active));
    const crumbs = breadcrumbTrail(active, extra.crumb);
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
            <div class="crumbs">${crumbs}</div>
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
      <div class="page-loader" id="pageLoader" aria-hidden="true" role="status" aria-live="polite">
        <div class="pl-box">
          <div class="pl-rune"><span class="r1"></span><span class="r2"></span><span class="r3"></span></div>
          <div class="pl-text"><span id="plText">Wird verarbeitet</span><span class="pl-dots"></span></div>
        </div>
      </div>
      <script>(function(){
        var t=document.getElementById("adminMenuToggle"),s=document.getElementById("adminSide");
        if(t&&s)t.addEventListener("click",function(){s.classList.toggle("open");});
        // Full-page loader: any form opting in via data-loader shows it on submit and
        // it stays up through the navigation to the redirected page. Also shown on
        // clicks of links marked data-loader (e.g. a slow detail page).
        var el=document.getElementById("pageLoader"), txt=document.getElementById("plText");
        function show(label){ if(!el)return; if(label&&txt)txt.textContent=label; el.classList.add("show"); el.setAttribute("aria-hidden","false"); }
        function hide(){ if(el){ el.classList.remove("show"); el.setAttribute("aria-hidden","true"); } }
        document.addEventListener("submit",function(e){
          var f=e.target; if(f&&f.getAttribute&&f.hasAttribute("data-loader")){ show(f.getAttribute("data-loader")||null); }
        },true);
        document.addEventListener("click",function(e){
          var a=e.target&&e.target.closest?e.target.closest("[data-loader]"):null;
          if(a&&a.tagName==="A"&&!e.metaKey&&!e.ctrlKey&&a.target!=="_blank"){ show(a.getAttribute("data-loader")||null); }
        },true);
        // If the page is restored from bfcache (back button), make sure the loader is gone.
        window.addEventListener("pageshow",function(e){ if(e.persisted) hide(); });
      })();</script>`;
    return layout(title, shell, { bare: true, bodyClass: "admin", wowheadIconize: Boolean(extra.wowheadIconize) });
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

// One event's logs: the WCL link itself, plus the CLA report when evaluated.
// Shared by the dashboard's "Latest Events" card and the History page's raid
// tables (see raidTable()).
function logsCell(ev) {
    const logs = ev.logs || [];
    if (!logs.length) return "<span class=\"sub\">—</span>";
    return logs.map((l) => {
        const url = logWclUrl(l);
        const name = l.title || l.reportId || "(Log)";
        const link = url
            ? `<a class="mlink" href="${esc(url)}" target="_blank" rel="noopener">${esc(name)} ↗</a>`
            : esc(name);
        const report = (l.status === "done" && (l.reportUrl || l.reportRefId))
            ? ` · <a class="mlink" href="${esc(l.reportUrl || `/r/${l.reportRefId}`)}">Auswertung</a>`
            : "";
        return `<div>${link}${report}</div>`;
    }).join("");
}

function lootCell(ev) {
    return ev.lootCount
        ? `<a class="mlink" href="/admin/history/event?event=${esc(ev.id)}">${esc(String(ev.lootCount))} Items</a>`
        : "<a class=\"mlink\" href=\"/admin/history\">importieren</a>";
}

function linksCell(ev, guildId) {
    const links = [];
    if (guildId && ev.channelId) {
        links.push(`<a class="mlink" href="${eventPostUrl(guildId, ev.channelId, ev.id)}" target="_blank" rel="noopener">Discord</a>`);
    }
    links.push(`<a class="mlink" href="${raidplanUrl(ev.id)}" target="_blank" rel="noopener">Setup/Comp</a>`);
    if (ev.softres && ev.softres.url) {
        links.push(`<a class="mlink" href="${esc(ev.softres.url)}" target="_blank" rel="noopener">Softres</a>`);
    }
    return links.join(" · ");
}

/**
 * A table of raids (upcoming or past), each row linking to its details, its
 * Warcraft-Log/CLA evaluation, its imported loot and its Discord/setup/softres
 * links. Shared by the dashboard's "Latest Events" card and the History page's
 * "Alle Raids" tab.
 * @param {object[]} events  each optionally carrying `.logs`/`.lootCount`/`.softres`
 * @param {string} guildId   for the Discord-post link
 * @param {{ error?: string, emptyMessage: string }} opts
 */
function raidTable(events, guildId, { error, emptyMessage }) {
    let rows;
    if (error) {
        rows = `<tr><td colspan="5" class="sub" style="padding:16px;color:var(--high)">${esc(error)}</td></tr>`;
    } else if (!events.length) {
        rows = `<tr><td colspan="5" class="sub" style="padding:16px">${esc(emptyMessage)}</td></tr>`;
    } else {
        rows = events.map((ev) => `<tr>
            <td><strong>${eventDetailLink(ev)}</strong>${ev.channelName ? `<div class="small">#${esc(ev.channelName)}</div>` : ""}</td>
            <td class="small">${esc(formatEventTime(ev.startTime))}</td>
            <td class="small">${logsCell(ev)}</td>
            <td class="small">${lootCell(ev)}</td>
            <td class="small">${linksCell(ev, guildId)}</td>
          </tr>`).join("");
    }

    return `<table class="idx">
          <thead><tr><th>Event</th><th>Termin</th><th>Logs</th><th>Loot</th><th>Links</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
}

/**
 * "Latest Events" — the raids that already happened, with everything that gets
 * attached to them afterwards: the Warcraft-Logs posted in the log channels (and
 * their CLA evaluation, if one exists), the imported loot and the soft-reserve
 * list. Rendered on the dashboard right below the upcoming events.
 * @param {object} recent { events, error } from server.loadRecentEvents
 * @param {object} nav    the server-selector context (for the guild id)
 */
function latestEventsCard(recent, nav) {
    const data = recent || { events: [], error: null };
    const guildId = (nav && nav.activeGuildId) || "";
    return `<div class="dash-card" style="margin-bottom:16px">
        <div class="dash-card-head"><h3>Latest Events</h3><a class="mlink" href="/admin/history">Historie &amp; Loot →</a></div>
        ${raidTable(data.events, guildId, { error: data.error, emptyMessage: "Keine vergangenen Events gefunden." })}
      </div>`;
}

// The dashboard — the app's start page. Shows key figures plus quick links.
function renderDashboard(user, opts = {}) {
    const s = opts.stats || {};
    const recent = opts.recentReports || [];
    const upcoming = opts.upcoming || { events: [], error: null };
    const n = (v) => esc(String(v || 0));

    const sheetBadge = (sheet) => sheet
        ? `<span class="pill" style="background:var(--good-bg);color:var(--good)" title="Gefüllt am ${esc(new Date(sheet.filledAt).toLocaleString("de-DE", { timeZone: DISPLAY_TZ }))}${sheet.playerCount ? ` · ${esc(sheet.playerCount)} Spieler` : ""}">Sheet ✓</span>`
        : "<span class=\"pill\">Sheet fehlt</span>";
    const upcomingRows = upcoming.error
        ? `<tr><td colspan="4" class="sub" style="padding:16px;color:var(--high)">${esc(upcoming.error)}</td></tr>`
        : (upcoming.events.length
            ? upcoming.events.map((ev) => `<tr>
                <td>${eventDetailLink(ev)}</td>
                <td class="small">${esc(ev.channelName || "")}</td>
                <td class="small">${esc(formatEventTime(ev.startTime))}</td>
                <td>${sheetBadge(ev.sheet)}</td>
              </tr>`).join("")
            : "<tr><td colspan=\"4\" class=\"sub\" style=\"padding:16px\">Keine anstehenden Events mit fertigem Setup.</td></tr>");

    const tile = (icon, label, value, sub, accent) =>
        `<div class="tile area-${icon}${accent ? " accent" : ""}"><div class="t-icon">${NAV_ICONS[icon]}</div><div class="t-label">${esc(label)}</div><div class="t-value">${n(value)}</div><div class="t-sub">${sub}</div></div>`;
    const tiles = `<div class="tiles">
        ${tile("cla", "Log-Check-Auswertungen", s.reportsTotal, `${n(s.reportsWithIssues)} mit Problemen`, true)}
        ${tile("recruitment", "Recruitment-Vorlagen", s.templates, `${n(s.posts)} gepostete Nachrichten`)}
        ${tile("channels", "Event-Kategorien", s.categories, "in den Einstellungen gepflegt")}
        ${tile("settings", "Admin-Rollen", s.adminRoles, s.adminRoles ? "konfiguriert" : "noch keine gesetzt")}
      </div>`;

    const recentRows = recent.length
        ? recent.map((r) => {
            const when = r.generatedAt ? new Date(r.generatedAt).toLocaleDateString("de-DE", { timeZone: DISPLAY_TZ }) : "";
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
      <div class="dash-hero">
        <canvas class="fx-orbs" aria-hidden="true"></canvas>
        <div class="dash-hero-content">${tiles}</div>
      </div>
      <div class="dash-card" style="margin-bottom:16px">
        <div class="dash-card-head"><h3>Upcoming Events</h3><a class="mlink" href="/admin/raids">Alle →</a></div>
        <table class="idx">
          <thead><tr><th>Event</th><th>Kanal</th><th>Termin</th><th>Sheet</th></tr></thead>
          <tbody>${upcomingRows}</tbody>
        </table>
      </div>
      ${latestEventsCard(opts.recentEvents, opts.nav)}
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
      </div>
      ${DASH_ORBS_SCRIPT}`;
    return adminLayout("Übersicht — EventHelper Admin", "home", user, body, opts.msg, opts.nav);
}

// Soft drifting colour-orb background behind the dashboard tiles ("Spektrum"
// design). Reads the --area-* tokens so the colours always match the current
// theme; a single static frame is drawn under prefers-reduced-motion.
const DASH_ORBS_SCRIPT = `<script>(function(){
  var canvas = document.querySelector(".fx-orbs");
  if (!canvas) return;
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var cs = getComputedStyle(document.documentElement);
  var colors = ["--area-cla","--area-recruitment","--area-channels","--area-settings"].map(function(v){
    return cs.getPropertyValue(v).trim() || "#7ab7ff";
  });
  var ctx = canvas.getContext("2d");
  function resize(){ canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight; }
  resize();
  var orbs = colors.map(function(c){ return {
    x: Math.random()*canvas.width, y: Math.random()*canvas.height,
    r: 70+Math.random()*50, c: c, vx: (Math.random()-.5)*.15, vy: (Math.random()-.5)*.15,
  };});
  function toRgba(hex, a){
    var h = hex.replace("#","");
    if (h.length === 3) h = h.split("").map(function(x){ return x+x; }).join("");
    var r = parseInt(h.substr(0,2),16), g = parseInt(h.substr(2,2),16), b = parseInt(h.substr(4,2),16);
    return "rgba("+r+","+g+","+b+","+a+")";
  }
  function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    orbs.forEach(function(o){
      var g = ctx.createRadialGradient(o.x,o.y,0,o.x,o.y,o.r);
      g.addColorStop(0, toRgba(o.c,.28)); g.addColorStop(1, toRgba(o.c,0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(o.x,o.y,o.r,0,7); ctx.fill();
    });
  }
  if (reduce) { draw(); return; }
  function frame(){
    orbs.forEach(function(o){
      o.x += o.vx; o.y += o.vy;
      if (o.x < -o.r || o.x > canvas.width+o.r) o.vx *= -1;
      if (o.y < -o.r || o.y > canvas.height+o.r) o.vy *= -1;
    });
    draw();
    requestAnimationFrame(frame);
  }
  frame();
  window.addEventListener("resize", resize, { passive:true });
})();</script>`;

function hiddenCsrf(csrf) {
    return `<input type="hidden" name="_csrf" value="${esc(csrf)}">`;
}

// Client-side glue for the emoji picker: inserts an emoji's Discord code
// (`<:name:id>`) into the last-focused text field of the picker's form. Guarded
// so it binds only once even if several pickers are on the page.
const EMOJI_PICKER_SCRIPT = "<script>(function(){if(window.__emojiPicker)return;window.__emojiPicker=1;"
    + "var last=null;"
    + "document.addEventListener('focusin',function(e){var el=e.target;if(el&&(el.tagName==='TEXTAREA'||(el.tagName==='INPUT'&&el.type==='text'))&&!el.closest('.emoji-panel')&&!el.closest('.spec-add-panel'))last=el;});"
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

/**
 * Client-side glue for the recruitment "gesuchte Klassen/Specs" picker. The
 * actual parsing/rewriting logic lives once in utils/recruitmentSpecs.js and
 * is embedded here verbatim (Function#toString) so server (initial state
 * isn't even needed — the picker parses the textarea's own value on load)
 * and browser share the exact same source instead of two hand-kept regexes.
 * `emojis` is the active guild's custom emoji list (for turning a spec's
 * icon key into a real Discord `<:name:id>` code when one is available).
 */
function specPickerScript(emojis) {
    return `<script>(function(){
      var SPEC_CATALOG=${JSON.stringify(SPEC_CATALOG)};
      var GUILD_EMOJIS=${JSON.stringify(emojis || [])};
      var SPEC_LINE_RE=${SPEC_LINE_RE.toString()};
      ${resolveSpec.toString()}
      ${parseWantedBlock.toString()}
      ${buildSpecLine.toString()}
      ${insertSpecLine.toString()}
      ${removeSpecLine.toString()}
      function escHtml(s){var d=document.createElement("div");d.textContent=s==null?"":String(s);return d.innerHTML;}
      // The guild's own custom emoji for a spec's classlist.js icon key, if one is
      // uploaded — exact name match first, then a same-prefix fallback for near-miss
      // spellings (a guild's "beastmastery" emoji vs. classlist's "beastmaster" key).
      function findGuildEmoji(icon){
        icon=(icon||"").toLowerCase();
        var exact=GUILD_EMOJIS.find(function(e){return (e.name||"").toLowerCase()===icon;});
        if(exact)return exact;
        var pre=GUILD_EMOJIS.find(function(e){var n=(e.name||"").toLowerCase();return n.length>3&&icon.length>3&&(n.indexOf(icon)===0||icon.indexOf(n)===0);});
        return pre||null;
      }
      // Prefer the real Discord server emoji (what actually ends up in the message);
      // fall back to the generic WoW spec icon only when the guild has none uploaded.
      function specIconHtml(spec){
        var emoji=findGuildEmoji(spec.icon);
        if(emoji&&emoji.url)return "<img src=\\""+emoji.url+"\\" alt=\\"\\">";
        return "<img src=\\"https://wow.zamimg.com/images/wow/icons/large/"+spec.icon.toLowerCase()+".jpg\\" alt=\\"\\">";
      }
      function initPicker(root){
        var ta=document.getElementById(root.getAttribute("data-target"));
        if(!ta)return;
        var pillsEl=root.querySelector(".spec-pills");
        var trigger=root.querySelector(".spec-add-trigger");
        var panel=root.querySelector(".spec-add-panel");
        var search=root.querySelector(".spec-add-search");
        var list=root.querySelector(".spec-add-list");
        var available=[];
        function renderList(filter){
          var q=(filter||"").toLowerCase();
          var rows=available.filter(function(s){return !q||s.name.toLowerCase().indexOf(q)!==-1;});
          list.innerHTML=rows.map(function(s){
            return "<button type=\\"button\\" class=\\"spec-option\\" data-key=\\""+s.key+"\\">"+specIconHtml(s)+"<span>"+escHtml(s.name)+"</span></button>";
          }).join("")||"<div class=\\"spec-empty\\">Keine Treffer.</div>";
        }
        function render(){
          var parsed=parseWantedBlock(ta.value);
          pillsEl.innerHTML=parsed.entries.map(function(entry){
            var spec=entry.spec;
            var label=spec?spec.name:entry.label;
            var iconHtml=spec?specIconHtml(spec):"<span class=\\"spec-pill-q\\">?</span>";
            var cls=spec?"spec-pill":"spec-pill spec-pill-custom";
            return "<span class=\\""+cls+"\\" data-index=\\""+entry.index+"\\">"+iconHtml+"<span>"+escHtml(label)+"</span>"
              +"<button type=\\"button\\" class=\\"spec-pill-x\\" aria-label=\\"Entfernen\\">&times;</button></span>";
          }).join("")||"<span class=\\"hint\\">Noch nichts ausgewählt — mit „+ Klasse/Spec hinzufügen“ unten.</span>";
          var selectedKeys={};
          parsed.entries.forEach(function(e){if(e.spec)selectedKeys[e.spec.key]=true;});
          available=SPEC_CATALOG.filter(function(s){return !selectedKeys[s.key];});
          renderList(search.value);
        }
        pillsEl.addEventListener("click",function(e){
          var btn=e.target.closest(".spec-pill-x");
          if(!btn)return;
          var idx=parseInt(btn.closest(".spec-pill").getAttribute("data-index"),10);
          ta.value=removeSpecLine(ta.value,idx);
          render();
        });
        trigger.addEventListener("click",function(e){
          e.preventDefault();
          document.querySelectorAll(".spec-add-panel.open").forEach(function(o){if(o!==panel)o.classList.remove("open");});
          panel.classList.toggle("open");
          if(panel.classList.contains("open")){search.value="";renderList("");search.focus();}
        });
        list.addEventListener("click",function(e){
          var opt=e.target.closest(".spec-option");
          if(!opt)return;
          var spec=SPEC_CATALOG.find(function(s){return s.key===opt.getAttribute("data-key");});
          if(!spec)return;
          var emoji=findGuildEmoji(spec.icon);
          ta.value=insertSpecLine(ta.value,spec,emoji?emoji.code:"");
          panel.classList.remove("open");
          render();
        });
        search.addEventListener("input",function(){renderList(search.value);});
        document.addEventListener("click",function(e){if(!root.contains(e.target))panel.classList.remove("open");});
        var t;
        ta.addEventListener("input",function(){clearTimeout(t);t=setTimeout(render,200);});
        render();
      }
      function init(){document.querySelectorAll(".spec-picker").forEach(initPicker);}
      if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
    })();</script>`;
}

/**
 * "Gesuchte Klassen/Specs" picker: pills for the specs currently detected in
 * `targetFieldId`'s textarea + an icon dropdown (same interaction as the emoji
 * picker) to add another. Icons prefer the guild's real Discord custom emoji
 * so what's shown always matches what actually gets inserted; adding/removing
 * rewrites the "## <emoji> Spec Name" block in that textarea in place, leaving
 * the rest of the text (and manual edits) untouched. `targetFieldId` must be
 * the id of the body textarea already rendered on the page.
 */
function specPicker(targetFieldId, emojis) {
    return `<div class="spec-picker" data-target="${esc(targetFieldId)}">
      <div class="spec-pills"></div>
      <div class="spec-add">
        <button type="button" class="btn btn-ghost btn-sm spec-add-trigger">+ Klasse/Spec hinzufügen</button>
        <div class="spec-add-panel">
          <input type="text" class="spec-add-search" placeholder="Suchen …" autocomplete="off">
          <div class="spec-add-list"></div>
        </div>
      </div>
    </div>${specPickerScript(emojis)}`;
}

// A short single-line excerpt of a longer text, for list rows.
function textPreview(s, max = 60) {
    const clean = String(s || "").replace(/\s+/g, " ").trim();
    if (!clean) return "";
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function templateListItem(t) {
    return `<tr>
      <td><strong>${esc(t.name || "(ohne Name)")}</strong></td>
      <td class="sub" style="margin:0">${esc(textPreview(t.content || t.title))}</td>
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
function renderPostEditBody(opts) {
    const p = opts.editingPost;
    const csrfField = hiddenCsrf(opts.csrf || "");
    return `
      <h2>Gepostete Nachricht bearbeiten</h2>
      <p class="note">In #${esc(p.channelName || p.channelId)} · <a class="mlink" href="${messageUrl(p)}" target="_blank" rel="noopener">Nachricht öffnen</a>. Änderungen werden direkt in Discord aktualisiert.</p>
      <form class="card-form" method="POST" action="/admin/recruitment/post-update">
        ${csrfField}
        <input type="hidden" name="id" value="${esc(p.id)}">
        <div class="field">
          <label>Nachrichtentext</label>
          <textarea name="content" id="postContent" style="min-height:380px">${esc(p.content)}</textarea>
          <div class="hint">Der eigentliche Nachrichtentext — inkl. Emojis. Custom-Emojis als <code>&lt;:name:id&gt;</code>, Discord-Markdown erlaubt.</div>
          ${emojiPicker(opts.emojis)}
        </div>
        <div class="field">
          <label>Gesuchte Klassen/Specs</label>
          ${specPicker("postContent", opts.emojis)}
          <div class="hint">Wird automatisch im Nachrichtentext oben ein-/ausgetragen — dort weiterhin frei editierbar.</div>
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
}

// Render an application field value that is expected to hold a URL as a link,
// falling back to escaped plain text (so a hand-typed non-URL still shows).
function applicationLinkCell(value) {
    const v = String(value || "").trim();
    if (!v) return "<span class=\"sub\">—</span>";
    if (/^https?:\/\//i.test(v)) return `<a class="mlink" href="${esc(v)}" target="_blank" rel="noopener">${esc(v)}</a>`;
    return esc(v);
}

// One application (a thread in the application channel) as a details card. The
// class/spec is shown as a badge; every remaining detail from the embed goes into
// the definition list so nothing from the form is lost.
function applicationCard(a) {
    const title = a.character || a.name || "Bewerbung";
    const badges = [];
    if (a.classSpec) badges.push(`<span class="cat-badge">${esc(a.classSpec)}</span>`);
    if (a.archived) badges.push("<span class=\"lbadge\">archiviert</span>");

    const who = a.displayName || a.discordName || (a.applicantId ? "Discord-Mitglied" : "");
    const whoExtra = a.discordName && a.discordName !== a.displayName
        ? ` <span class="sub">(${esc(a.discordName)})</span>` : "";
    const rows = [
        ["Bewerber", who ? `${esc(who)}${whoExtra}` : ""],
        ["Charakter", a.character ? esc(a.character) : ""],
        ["Armory", a.armory ? applicationLinkCell(a.armory) : ""],
        ["WarcraftLogs", a.wcl ? applicationLinkCell(a.wcl) : ""],
        ["Über den Bewerber", a.description ? esc(a.description).replace(/\n/g, "<br>") : ""],
        ["Eingereicht", a.date ? esc(a.date) : ""],
    ].filter(([, v]) => v);
    const dl = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("");

    return `<div class="sheetcard">
      <div class="app-card-head">
        <span class="app-name">${esc(title)}</span>
        ${badges.join(" ")}
        <a class="mlink" style="margin-left:auto" href="${esc(a.url)}" target="_blank" rel="noopener">Thread öffnen ↗</a>
      </div>
      <dl class="app-meta">${dl}</dl>
    </div>`;
}

// The "Bewerbungen" tab body: config hint / error / empty state / list of cards.
function recruitmentApplications(opts) {
    if (!opts.applicationChannelId) {
        return "<p class=\"sub\">Es ist noch kein Bewerbungs-Channel konfiguriert. Lege ihn in den "
            + "<a class=\"mlink\" href=\"/admin/settings\">Einstellungen</a> fest, damit die Bewerbungen hier erscheinen.</p>";
    }
    if (opts.applicationsError) {
        return `<div class="flash flash-err">${esc(opts.applicationsError)}</div>`;
    }
    const apps = opts.applications || [];
    if (!apps.length) {
        return "<p class=\"sub\">Noch keine Bewerbungen im Bewerbungs-Channel gefunden.</p>";
    }
    return `<div class="applist">${apps.map(applicationCard).join("")}</div>`;
}

/**
 * Recruitment page. Three sub-views via a submenu: "posts" (post a template +
 * manage already-posted messages, the default), "templates" (edit template
 * texts) and "applications" (the applications posted as threads in the
 * application channel). Editing a template forces the templates view; editing
 * a posted message renders its own full-page form.
 * @param {object} opts { view, templates, editing, posts, editingPost, channels,
 *   applications, applicationsError, applicationChannelId, activeGuildId, csrf, msg, nav }
 */
function renderRecruitmentBody(opts = {}) {
    const templates = opts.templates || [];
    const posts = opts.posts || [];
    const channels = opts.channels || [];
    const activeGuildId = opts.activeGuildId || "";
    const editing = opts.editing || null;
    const csrfField = hiddenCsrf(opts.csrf || "");
    // Editing a template always lands on the templates view; otherwise honour ?view=,
    // defaulting to "posts" — the first/standard tab.
    const view = editing
        ? "templates"
        : (["templates", "applications"].includes(opts.view) ? opts.view : "posts");

    // --- templates: list + create/edit form ---
    const list = templates.length
        ? `<table class="idx" style="margin-bottom:18px">
             <thead><tr><th>Name</th><th>Vorschau</th><th></th></tr></thead>
             <tbody>${templates.map(templateListItem).join("").split("__CSRF__").join(csrfField)}</tbody>
           </table>`
        : "<p class=\"sub\">Noch keine Vorlagen. Lege unten die erste an.</p>";

    const e = editing || { id: "", name: "", content: "", title: "", body: "", buttonLabel: "" };
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
          <label>Nachrichtentext</label>
          <textarea name="content" id="tplContent" placeholder="Nachrichtentext …" style="min-height:380px">${esc(e.content)}</textarea>
          <div class="hint">Der eigentliche Nachrichtentext — inkl. Emojis. Custom-Emojis als &lt;:name:id&gt;, Discord-Markdown erlaubt.</div>
          ${emojiPicker(opts.emojis)}
        </div>
        <div class="field">
          <label>Gesuchte Klassen/Specs</label>
          ${specPicker("tplContent", opts.emojis)}
          <div class="hint">Wird automatisch im Nachrichtentext oben ein-/ausgetragen (Zeile „## Icon Spec-Name") — dort weiterhin frei editierbar.</div>
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
             <thead><tr><th>Channel</th><th>Vorschau</th><th class="small">Quelle</th><th></th></tr></thead>
             <tbody>${posts.map((p) => `<tr>
               <td>#${esc(p.channelName || p.channelId)}</td>
               <td>${esc(textPreview(p.content || p.title) || "(kein Text)")} · <a class="mlink" href="${messageUrl(p)}" target="_blank" rel="noopener">öffnen</a></td>
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

    // --- sub-view tabs ---
    const appCount = opts.applications ? opts.applications.length : null;
    const tab = (id, label, count) => `<a class="subnav-item${view === id ? " active" : ""}" href="/admin/recruitment?view=${id}">${esc(label)}${count ? ` <span class="subnav-count">${esc(String(count))}</span>` : ""}</a>`;
    const subnav = "<div class=\"subnav\">"
        + tab("posts", "Nachrichten", posts.length)
        + tab("templates", "Vorlagen", templates.length)
        + tab("applications", "Bewerbungen", appCount)
        + "</div>";

    let content;
    if (view === "applications") {
        content = `
      <h2>Bewerbungen</h2>
      <p class="note">Bewerbungen aus den Threads im Bewerbungs-Channel — mit allen Details aus dem Bewerbungsformular. Es werden die letzten 10 Bewerbungen der vergangenen 6 Wochen angezeigt (neueste zuerst).</p>
      ${recruitmentApplications(opts)}`;
    } else if (view === "posts") {
        content = `
      <h2>Nachricht posten</h2>
      ${postSection}
      <h2>Gepostete Nachrichten</h2>
      ${scanForm}
      ${postsTable}`;
    } else {
        content = `
      <h2>Recruitment-Vorlagen</h2>
      <p class="note">Vorlagen-Texte, die der Bot beim Posten nutzt (auch via Discord-Befehl <code>/recruitment</code>).</p>
      ${list}
      ${templateForm}`;
    }

    return `${subnav}${content}`;
}

// Recruitment forms submit via fetch() instead of a normal navigation, so saving
// a template or a posted message doesn't flash the whole page and drop the admin
// back on the wrong tab (see server.js's isAjax()/recruitmentResult()). This is
// the only page doing this — everywhere else a plain POST-redirect is enough.
// Scripts inserted via innerHTML/outerHTML never execute, so embedding this
// inside the swappable fragment is safe: it runs once, on the real page load,
// and registers delegated listeners on `document` that survive later swaps.
const RECRUITMENT_AJAX_SCRIPT = `<script>(function(){
  var root=document.getElementById("recruitment-view");if(!root)return;
  function toast(ok,text){
    var wrap=document.createElement("div");wrap.className="toast-wrap";
    wrap.innerHTML='<div class="toast '+(ok?"toast-ok":"toast-err")+'" role="status" aria-live="polite">'
      +'<span class="toast-ico" aria-hidden="true">'+(ok?"&#10003;":"&#33;")+'</span>'
      +'<span class="toast-msg"></span>'
      +'<button class="toast-x" type="button" aria-label="Schließen">&times;</button></div>';
    wrap.querySelector(".toast-msg").textContent=text;
    document.body.appendChild(wrap);
    var t=wrap.querySelector(".toast");
    function close(){t.classList.add("hide");setTimeout(function(){wrap.remove();},220);}
    wrap.querySelector(".toast-x").addEventListener("click",close);
    setTimeout(close,4500);
  }
  document.addEventListener("submit",function(e){
    if(e.defaultPrevented)return;
    var form=e.target;
    if(!form||!form.closest||!form.closest("#recruitment-view"))return;
    if((form.getAttribute("method")||"GET").toUpperCase()!=="POST")return;
    e.preventDefault();
    fetch(form.getAttribute("action"),{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded","X-Requested-With":"fetch"},
      body:new URLSearchParams(new FormData(form)),
    }).then(function(r){return r.json();}).then(function(data){
      var view=document.getElementById("recruitment-view");
      if(data.html&&view)view.outerHTML=data.html;
      toast(!!data.ok,data.message||(data.ok?"Gespeichert.":"Fehler."));
      if(data.url)history.replaceState(null,"",data.url);
    }).catch(function(){form.submit();});
  });
})();</script>`;

/** The recruitment page's content region — the initial full-page render and the
 * AJAX fragment swapped in after saving share this exact markup (see
 * RECRUITMENT_AJAX_SCRIPT above), so the server only has to render it once. */
function renderRecruitmentFragment(opts = {}) {
    const inner = opts.editingPost ? renderPostEditBody(opts) : renderRecruitmentBody(opts);
    return `<div id="recruitment-view">${inner}</div>${RECRUITMENT_AJAX_SCRIPT}`;
}

function renderRecruitment(user, opts = {}) {
    const title = opts.editingPost ? "Recruitment — Nachricht bearbeiten" : "Recruitment — Pulsebot Admin";
    const extra = opts.editingPost ? { crumb: "Nachricht bearbeiten" } : {};
    return adminLayout(title, "recruitment", user, renderRecruitmentFragment(opts), opts.msg, opts.nav, extra);
}

// WCL report link for a detected log (prefer the stored link, else derive it).
function logWclUrl(l) {
    return l.link || (l.reportId ? `https://classic.warcraftlogs.com/reports/${l.reportId}` : "");
}

// "vor/nach Start" hint for a candidate event: how far the log post sits from the
// event's start time (ms; positive = posted after the start).
function formatMatchOffset(diffMs) {
    const ms = Number(diffMs) || 0;
    const mins = Math.round(Math.abs(ms) / 60000);
    const hours = Math.floor(mins / 60);
    const rest = mins % 60;
    const span = hours ? `${hours} h${rest ? ` ${rest} min` : ""}` : `${mins} min`;
    if (mins === 0) return "pünktlich zum Start";
    return ms >= 0 ? `${span} nach Start` : `${span} vor Start`;
}

// A candidate label for the assignment dropdown: event title, its start and how
// far the log post is away from it.
function matchOptionLabel(c) {
    const when = c.startTime ? formatEventTime(c.startTime) : "";
    return `${c.title || c.eventId}${when ? ` · ${when}` : ""} (${formatMatchOffset(c.diffMs)})`;
}

/**
 * The "Event" cell of a detected-log row: either the existing assignment with a
 * remove button, or a dropdown of the events whose start time is close enough to
 * the log's post time (best guess preselected).
 */
function logEventCell(l, csrfField) {
    if (l.eventId) {
        const label = l.eventLabel || l.eventId;
        const when = l.eventStartTime ? formatEventTime(l.eventStartTime) : "";
        const auto = l.eventLinkSource === "auto" ? " · automatisch zugeordnet" : "";
        const title = `${label}${when ? ` — ${when}` : ""}${auto}`;
        return `<div class="row-actions" style="flex-wrap:nowrap;gap:6px">
          <span class="pill" title="${esc(title)}">${esc(label)}</span>
          <form method="POST" action="/admin/cla/log-unlink" style="margin:0" onsubmit="return confirm('Zuordnung zu diesem Event entfernen?')">
            ${csrfField}<input type="hidden" name="logId" value="${esc(l.id)}">
            <button class="btn btn-ghost btn-sm" type="submit" title="Zuordnung entfernen">×</button>
          </form>
        </div>`;
    }
    const cands = l.candidates || [];
    if (!cands.length) return "<span class=\"sub\" title=\"Kein Event mit passender Startzeit gefunden\">—</span>";
    const options = cands.map((c, i) => `<option value="${esc(c.eventId)}"${i === 0 ? " selected" : ""}>${esc(matchOptionLabel(c))}</option>`).join("");
    const hint = l.matchAmbiguous
        ? "<div class=\"hint\">mehrere Events passen — bitte prüfen</div>"
        : "";
    return `<form method="POST" action="/admin/cla/log-link" class="row-actions" style="margin:0;gap:6px;flex-wrap:wrap">
      ${csrfField}<input type="hidden" name="logId" value="${esc(l.id)}">
      <select name="eventId" class="sel-sm">${options}</select>
      <button class="btn btn-ghost btn-sm" type="submit">Zuordnen</button>
      ${hint}
    </form>`;
}

// A single row in the "detected logs" table (from the log channels). The date
// column shows when the log was POSTED in the channel (derived from the Discord
// message id / postedAt), not when the bot detected it.
function logRow(l, csrfField) {
    const posted = logPostedAt(l);
    const when = posted ? new Date(posted).toLocaleString("de-DE", { timeZone: DISPLAY_TZ }) : "";
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
            ? iconBtn("a", "ghost", "open", "Öffnen", `href="${esc(l.reportUrl || `/r/${l.reportRefId}`)}"`)
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
      <td>${category}</td>
      <td>${logEventCell(l, csrfField)}</td>
      <td>${src}</td>
      <td>${status}</td>
      <td class="small">${esc(when)}</td>
      <td class="cell-actions"><div class="row-actions" style="justify-content:flex-end">
        ${action}
        <form method="POST" action="/admin/cla/log-delete" style="margin:0" onsubmit="return confirm('Log aus der Liste entfernen?')">
          ${csrfField}<input type="hidden" name="logId" value="${esc(l.id)}">
          ${iconBtn("button", "danger", "trash", "Löschen", "type=\"submit\"")}
        </form>
      </div></td>
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
 *                        matchEvents, matchEventsError, unlinkedCount,
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
            // Both buttons act on the whole list, so they share one row.
            const autoForm = (opts.unlinkedCount && (opts.matchEvents || []).length)
                ? `<form method="POST" action="/admin/cla/log-automatch" style="margin:0" onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').textContent='Ordne zu …'">
                     ${csrfField}
                     <button class="btn btn-ghost" type="submit" title="Ordnet jedes offene Log dem Event zu, dessen Startzeit eindeutig passt">Logs automatisch Events zuordnen</button>
                   </form>`
                : "";
            const eventsHint = opts.matchEventsError
                ? `<p class="hint">Events für die Zuordnung konnten nicht geladen werden: ${esc(opts.matchEventsError)}</p>`
                : "";
            const scanForm = `<div class="row-actions" style="margin:0 0 14px">
                 <form method="POST" action="/admin/cla/scan" style="margin:0" onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').textContent='Suche läuft …'">
                   ${csrfField}
                   <button class="btn btn-ghost" type="submit">Log-Channels nach neuen Logs durchsuchen</button>
                 </form>
                 ${autoForm}
               </div>${eventsHint}`;
            const table = lp.items.length
                ? `<table class="idx">
                     <thead><tr>
                       ${lh("title", "Log")}
                       <th>Kategorie</th>
                       <th>Event</th>
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
      <p class="note">In der Spalte <strong>Event</strong> wird jedes Log dem Raid zugeordnet, dessen Startzeit zur Post-Zeit passt (Vorschlag vorausgewählt, Zuordnung jederzeit über „×" wieder entfernbar).</p>
      ${logsSection}`;
    } else {
        // --- report evaluations ---
        const rp = opts.reportPage || { items: [], sort: "date", dir: "desc", page: 1, totalPages: 1, total: 0 };
        const REPORT_DIR = { title: "asc", zone: "asc", date: "desc", players: "desc", issues: "desc" };
        const rh = (key, label) => claSortHeader("reports", rp, REPORT_DIR, key, label);
        const reportRow = (r) => {
            const when = r.generatedAt ? new Date(r.generatedAt).toLocaleString("de-DE", { timeZone: DISPLAY_TZ }) : "";
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
      <form class="card-form" method="POST" action="/admin/cla" data-loader="Auswertung wird erstellt" onsubmit="this.querySelector('button[type=submit]').disabled=true;this.querySelector('button[type=submit]').textContent='Erstelle Auswertung …'">
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
        // One tab per Discord category; the panel holds that category's event
        // table plus its "＋ Event" (format pre-filled from the latest event).
        const tabs = groups.map((g, i) => {
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
                  <td class="cell-actions"><div class="row-actions" style="justify-content:flex-end"><a class="btn btn-ghost btn-sm" href="/admin/raids/detail?event=${esc(ev.id)}" data-loader="Event wird geladen">Details</a></div></td>
                </tr>`;
            }).join("");
            // "＋ Event" pre-fills the create form by reusing this category's most
            // recent event as the template (title/template/channel-name format).
            const latest = g.events.slice().sort((a, b) => (b.startTime || 0) - (a.startTime || 0))[0];
            const newHref = "/admin/raids/new"
                + (latest ? `?source=${esc(latest.id)}` : "")
                + (g.categoryId ? `${latest ? "&" : "?"}category=${esc(g.categoryId)}` : "");
            const content = `
                <div class="row-actions" style="justify-content:flex-end;margin-bottom:12px">
                  <a class="btn btn-ghost btn-sm" href="${newHref}" title="Neues Event in dieser Kategorie anlegen (Format vorbelegt)">＋ Event</a>
                </div>
                <table class="idx" style="margin:0">
                  <thead><tr><th>Event</th><th>Termin</th><th>Anm.</th><th>Links</th><th></th></tr></thead>
                  <tbody>${rows}</tbody>
                </table>`;
            return { id: `cat-${g.categoryId || "none"}-${i}`, label: `${esc(g.categoryName || "Ohne Kategorie")}${tabCount(g.events.length)}`, content };
        });
        listing = tabGroup("raidCatTabs", tabs);
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

    return adminLayout("Raid-Events — Pulsebot Admin", "raids", user, `${createForm}${templateSection}`, opts.msg, opts.nav, { crumb: "Neues Event" });
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

    // Quick actions top-right of the meta card: open/post the sheet, open/post the
    // softres list, or (when none exists yet) jump to the Softres tab to create one.
    const eventSoftres = opts.eventSoftres;
    const channelLabel = esc(opts.channelName || ev.channelId);
    const sheetLink = opts.eventSheet && opts.eventSheet.url;
    const sheetBtn = sheetLink
        ? `<a class="btn sheet-btn" href="${esc(opts.eventSheet.url)}" target="_blank" rel="noopener">📄 Sheet öffnen</a>`
        : "";
    const quickPost = (action, label, title) => `<form method="POST" action="${action}" data-loader="Wird gepostet" style="margin:0" onsubmit="this.querySelector('button').disabled=true">
            ${csrfField}<input type="hidden" name="event" value="${esc(ev.id)}">
            <button class="btn btn-ghost" type="submit" title="${title}">${label}</button>
          </form>`;
    const headerBtns = [];
    if (sheetLink) {
        headerBtns.push(sheetBtn);
        headerBtns.push(quickPost("/admin/raids/post-sheet", "📤 Sheet posten", `Sheet-Link in #${channelLabel} posten`));
    }
    if (eventSoftres && eventSoftres.url) {
        headerBtns.push(`<a class="btn btn-ghost" href="${esc(eventSoftres.url)}" target="_blank" rel="noopener">🔗 Softres öffnen</a>`);
        headerBtns.push(quickPost("/admin/raids/post-softres", "📤 Softres posten", `Softres-Link in #${channelLabel} posten`));
    } else {
        headerBtns.push("<button type=\"button\" class=\"btn btn-ghost\" onclick=\"var t=document.querySelector('[data-tab=softres]'); if(t) t.click();\">➕ Softres erstellen</button>");
    }
    const headerActions = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:flex-end">${headerBtns.join("")}</div>`;

    // Quick overview stats — signups vs. expected headcount, setup size, missing
    // raiders, chosen softres instances — so the key numbers are visible without
    // switching tabs.
    const signupTarget = Number(opts.signupTarget) || 0;
    const statSpans = [
        `<span class="setup-count setup-total"><b>${esc(String(ev.signupCount || 0))}${signupTarget ? ` / ${esc(String(signupTarget))}` : ""}</b> Anmeldungen</span>`,
    ];
    if (setup && setup.total) statSpans.push(`<span class="setup-count"><b>${esc(String(setup.total))}</b> im Setup</span>`);
    if (attendanceRoleIds.length) statSpans.push(`<span class="setup-count"><b>${esc(String(attendance.missing.length))}</b> fehlt</span>`);
    if (eventSoftres && eventSoftres.instances && eventSoftres.instances.length) {
        statSpans.push(`<span class="setup-count"><b>${esc(String(eventSoftres.instances.length))}</b> Softres-Instanz(en)</span>`);
    }
    const overviewStats = `<div class="setup-summary" style="margin-top:10px">${statSpans.join("")}</div>`;

    // Raid-roster avatar stack: real signups from the current setup (raidplan),
    // class-coloured initials, capped with a "+N" overflow chip.
    const rosterAvatars = (() => {
        if (!setup || !setup.total) return "";
        const players = setup.groups.flatMap((g) => g.players);
        const shown = players.slice(0, 10);
        const rest = players.length - shown.length;
        const chips = shown.map((p) => {
            const initials = esc(String(p.name || "??").trim().slice(0, 2).toUpperCase());
            const color = p.classColor || "#9aa0aa";
            return `<span class="av" style="background:${color}2e;color:${color};border-color:${color}" title="${esc(p.name)}${p.className ? ` · ${esc(p.className)}` : ""}">${initials}</span>`;
        }).join("");
        const more = rest > 0 ? `<span class="av more">+${esc(String(rest))}</span>` : "";
        return `<div class="avatar-stack" style="margin-top:10px">${chips}${more}</div>`;
    })();

    const meta = `
      <div class="dash-card" style="margin-bottom:16px">
        <div class="dash-card-head" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <h3 style="margin:0">${esc(ev.title || "(ohne Titel)")}</h3>
          ${headerActions}
        </div>
        <div style="padding:14px 16px" class="small">
          <div>Termin: <strong>${esc(formatEventTime(ev.startTime)) || "—"}</strong></div>
          <div>Channel: #${esc(opts.channelName || ev.channelId)} · Kategorie: ${esc(opts.categoryName || "—")}</div>
          <div style="margin-top:8px">
            <a class="mlink" href="${eventPostUrl(guildId, ev.channelId, ev.id)}" target="_blank" rel="noopener">Discord-Post</a> ·
            <a class="mlink" href="${channelUrl(guildId, ev.channelId)}" target="_blank" rel="noopener">Channel</a> ·
            <a class="mlink" href="${raidplanUrl(ev.id)}" target="_blank" rel="noopener">Setup / Comp</a>
          </div>
          ${overviewStats}
          ${rosterAvatars}
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
      <form class="card-form" method="POST" action="/admin/raids/notify" data-loader="Wird gepostet">
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
      <form class="card-form" method="POST" action="/admin/raids/fill" data-loader="Sheet wird erstellt &amp; gefüllt" onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').textContent='Erstelle Sheet …'">
        ${csrfField}
        <input type="hidden" name="event" value="${esc(ev.id)}">
        <input type="hidden" name="eventTitle" value="${esc(ev.title || "")}">
        <input type="hidden" name="eventStartTime" value="${esc(String(ev.startTime || ""))}">
        <div class="field"><label>Vorlage (Ausgangssheet)</label><select name="sheetId" required>${sheetOptions}</select><div class="hint">${matchHint}</div></div>
        ${tank3Field}
        <div class="row-actions"><button class="btn" type="submit">Neues Sheet erstellen &amp; füllen</button></div>
      </form>`;
    }

    // --- Anwesenheit: role holders who have not reacted to the signup yet.
    // Members with a known class/spec (from a past signup, see buildSpecHistory
    // in utils/attendance.js) get the same icon + class-colour chip as the setup. ---
    const nameList = (people) => people.length
        ? `<div class="rolegrid rolegrid-flat">${people.map((p) => {
            const prof = p.profile;
            const label = esc(p.displayName || p.id) + (p.character ? ` (${esc(p.character)})` : "");
            if (!prof) return `<span class="rolebox">${label}</span>`;
            return `<span class="rolebox setup-player" style="border-left-color:${esc(prof.classColor || "var(--line)")}" title="${esc(prof.specName || "")}">
              ${prof.iconUrl ? `<img class="setup-ico" src="${esc(prof.iconUrl)}" alt="${esc(prof.className || "")}" loading="lazy">` : "<span class=\"setup-ico setup-ico-blank\"></span>"}
              <span class="sp-name">${label}</span>
            </span>`;
        }).join("")}</div>`
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
            ? `<form class="card-form" method="POST" action="/admin/raids/ping-missing" data-loader="Wird gepostet" style="margin-top:16px" onsubmit="this.querySelector('button').disabled=true">
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

    // --- Post the filled raidsheet link into the event channel (shown whenever a
    // sheet exists, independent of whether raidsheet templates are configured).
    // Once a message was posted, its channelId/messageId are tracked in
    // eventSheetStore.js — re-submitting then edits that message in place
    // instead of posting a new one (see /admin/raids/post-sheet in server.js). ---
    const evSheet = opts.eventSheet;
    const sheetPosted = Boolean(evSheet && evSheet.postedChannelId && evSheet.postedMessageId);
    const postSheetSection = evSheet && evSheet.url
        ? `<form class="card-form" method="POST" action="/admin/raids/post-sheet" data-loader="Wird gepostet" style="margin-top:8px" onsubmit="this.querySelector('button').disabled=true">
        ${csrfField}
        <input type="hidden" name="event" value="${esc(ev.id)}">
        <div class="field">
          <label>Nachricht (optional)</label>
          <input type="text" name="message" value="${esc(evSheet.postedMessage || "")}" placeholder="z. B. Das Raidsheet für heute Abend – bitte eintragen!">
          <div class="hint">${sheetPosted
        ? `Bereits gepostet in #${esc(opts.channelName || ev.channelId)} — <a class="mlink" href="${messageUrl({ guildId, channelId: evSheet.postedChannelId, messageId: evSheet.postedMessageId })}" target="_blank" rel="noopener">Nachricht öffnen</a>. Speichern aktualisiert diese Nachricht.`
        : `Postet den Sheet-Link (📄 mit Button) in #${esc(opts.channelName || ev.channelId)}.`}</div>
        </div>
        <div class="row-actions"><button class="btn" type="submit">${sheetPosted ? "🔄 Nachricht aktualisieren" : "📄 Sheet in Channel posten"}</button></div>
      </form>`
        : "<p class=\"sub\">Noch kein gefülltes Sheet vorhanden — fülle oben zuerst ein Raidsheet, dann kannst du den Link hier in den Channel posten.</p>";

    // --- Softres (softres.it soft-reserve list) ---
    const so = eventSoftres;
    const catalogue = opts.softresCatalogue || [];
    const suggested = new Set(opts.softresSuggested || []);
    const softresLinkForm = `
      <details class="softres-link-details">
        <summary style="cursor:pointer">${so && so.url ? "Anderen Softres-Link verwenden" : "Schon eine Liste auf softres.it? Link manuell hinterlegen"}</summary>
        <form class="card-form" style="margin-top:10px" method="POST" action="/admin/raids/softres/link">
          ${csrfField}
          <input type="hidden" name="event" value="${esc(ev.id)}">
          <div class="field"><label>Softres-Link (Ansehen)</label><input type="url" name="softresUrl" placeholder="https://softres.it/raid/..." value="${so ? esc(so.url) : ""}" required></div>
          <div class="field"><label>Softres-Link (Bearbeiten, optional)</label><input type="url" name="softresEditUrl" placeholder="https://softres.it/raid/.../token" value="${so ? esc(so.editUrl) : ""}"></div>
          <div class="row-actions"><button class="btn" type="submit">Link speichern</button></div>
        </form>
      </details>`;
    // Once posted, channelId/messageId are tracked in eventSoftresStore.js —
    // re-submitting then edits that message in place (mirrors the sheet form above).
    const softresPosted = Boolean(so && so.postedChannelId && so.postedMessageId);
    const postSoftresSection = so && so.url
        ? `<form class="card-form" method="POST" action="/admin/raids/post-softres" data-loader="Wird gepostet" style="margin-top:12px" onsubmit="this.querySelector('button').disabled=true">
        ${csrfField}
        <input type="hidden" name="event" value="${esc(ev.id)}">
        <div class="field">
          <label>Nachricht (optional)</label>
          <input type="text" name="message" value="${esc(so.postedMessage || "")}" placeholder="z. B. Bitte bis Raidbeginn eintragen!">
          <div class="hint">${softresPosted
        ? `Bereits gepostet in #${esc(opts.channelName || ev.channelId)} — <a class="mlink" href="${messageUrl({ guildId, channelId: so.postedChannelId, messageId: so.postedMessageId })}" target="_blank" rel="noopener">Nachricht öffnen</a>. Speichern aktualisiert diese Nachricht.`
        : `Postet den Softres-Link (🎁 mit Button) in #${esc(opts.channelName || ev.channelId)}.`}</div>
        </div>
        <div class="row-actions"><button class="btn" type="submit">${softresPosted ? "🔄 Nachricht aktualisieren" : "📤 Softres in Channel posten"}</button></div>
      </form>`
        : "";
    const existingSoftres = so && so.url
        ? `<div class="sheetcard" id="softres-existing">
          <div><strong>Softres-Liste:</strong>
            <a class="mlink" href="${esc(so.url)}" target="_blank" rel="noopener">Ansehen</a>
            · <a class="mlink" href="${esc(so.editUrl)}" target="_blank" rel="noopener">Bearbeiten (mit Token)</a>
          </div>
          <div class="hint">${esc(String(so.amount || 1))} Softres/Spieler · ${esc(String((so.instances || []).length))} Instanz(en)${so.hardReserveCount ? ` · ${esc(String(so.hardReserveCount))} Hardreserve(s)` : ""}. Neu erstellen ersetzt den Link unten nicht automatisch auf softres.it.</div>
          ${softresLinkForm}
          ${postSoftresSection}
        </div>`
        : softresLinkForm;
    const instGroups = catalogue.map((g) => `
        <fieldset class="softres-ed" style="border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin:0 0 10px">
          <legend class="small" style="padding:0 6px">${esc(g.label)}</legend>
          <div class="rolegrid">
            ${g.instances.map((i) => `<label class="rolebox"><input type="checkbox" name="inst_${esc(i.code)}" value="1" data-edition="${esc(g.edition)}" class="softres-inst"${suggested.has(i.code) ? " checked" : ""}> ${esc(i.name)}</label>`).join("")}
          </div>
        </fieldset>`).join("");
    const softresSection = existingSoftres + `
      <form class="card-form" method="POST" action="/admin/raids/softres" data-loader="Softres wird erstellt" onsubmit="this.querySelector('button[type=submit]').disabled=true;this.querySelector('button[type=submit]').textContent='Erstelle Softres …'">
        ${csrfField}
        <input type="hidden" name="event" value="${esc(ev.id)}">
        <div class="field">
          <label>Instanzen (Raids)</label>
          ${instGroups}
          <div class="hint">Aus dem Event-Titel vorausgewählt. Alle gewählten Instanzen müssen zur selben Erweiterung gehören — beim Ankreuzen wird die Auswahl automatisch auf eine Erweiterung beschränkt.</div>
        </div>
        <div class="field" style="max-width:220px"><label>Softres pro Spieler</label><input type="number" name="amount" min="1" max="6" value="1"></div>
        <div class="field" style="max-width:220px"><label>Fraktion</label><select name="faction"><option value="Horde" selected>Horde</option><option value="Alliance">Alliance</option></select></div>
        <div class="field">
          <label>Hardreserved Items (optional)</label>
          <div style="position:relative">
            <input type="text" id="hrSearch" placeholder="Item-Namen suchen (Wowhead) …" autocomplete="off">
            <div id="hrResults" class="hr-results" style="display:none;position:absolute;z-index:20;left:0;right:0;background:var(--panel);border:1px solid var(--line);border-radius:8px;max-height:260px;overflow:auto;box-shadow:0 8px 28px rgba(0,0,0,.35)"></div>
          </div>
          <ul id="hrList" style="list-style:none;padding:0;margin:8px 0 0;display:flex;flex-direction:column;gap:6px"></ul>
          <input type="hidden" name="hardReserves" id="hrData" value="[]">
          <div class="hint">Diese Items werden auf softres.it als Hardreserve (gebannt für Softres) markiert.</div>
        </div>
        <div class="row-actions"><button class="btn" type="submit">Softres-Liste erstellen</button></div>
      </form>
      <script>(function(){
        var boxes=[].slice.call(document.querySelectorAll(".softres-inst"));
        function currentEdition(){ for(var i=0;i<boxes.length;i++){ if(boxes[i].checked) return boxes[i].getAttribute("data-edition"); } return "tbc"; }
        boxes.forEach(function(b){ b.addEventListener("change",function(){
          if(b.checked){ var ed=b.getAttribute("data-edition"); boxes.forEach(function(x){ if(x.getAttribute("data-edition")!==ed) x.checked=false; }); }
        }); });
        var search=document.getElementById("hrSearch");
        var results=document.getElementById("hrResults");
        var listEl=document.getElementById("hrList");
        var dataEl=document.getElementById("hrData");
        var items=[]; var t=null;
        function save(){ dataEl.value=JSON.stringify(items.map(function(i){return {id:i.id,name:i.name};})); render(); }
        function render(){
          listEl.innerHTML="";
          items.forEach(function(it,idx){
            var li=document.createElement("li");
            li.className="rolebox"; li.style.display="flex"; li.style.justifyContent="space-between"; li.style.alignItems="center";
            var left=document.createElement("span");
            if(it.iconUrl){ var img=document.createElement("img"); img.src=it.iconUrl; img.width=18; img.height=18; img.style.verticalAlign="middle"; img.style.marginRight="6px"; img.style.borderRadius="3px"; left.appendChild(img); }
            left.appendChild(document.createTextNode(it.name+" (#"+it.id+")"));
            var rm=document.createElement("button"); rm.type="button"; rm.textContent="✕"; rm.className="btn"; rm.style.padding="2px 8px";
            rm.addEventListener("click",function(){ items.splice(idx,1); save(); });
            li.appendChild(left); li.appendChild(rm); listEl.appendChild(li);
          });
        }
        function pick(it){ if(!items.some(function(x){return x.id===it.id;})) items.push(it); search.value=""; results.style.display="none"; results.innerHTML=""; save(); }
        function query(q){
          fetch("/admin/raids/softres/item-search?edition="+encodeURIComponent(currentEdition())+"&q="+encodeURIComponent(q))
            .then(function(r){return r.json();}).then(function(d){
              var list=(d&&d.items)||[]; results.innerHTML="";
              if(!list.length){ results.style.display="none"; return; }
              list.forEach(function(it){
                var row=document.createElement("div"); row.style.padding="6px 10px"; row.style.cursor="pointer"; row.className="hr-row";
                if(it.iconUrl){ var img=document.createElement("img"); img.src=it.iconUrl; img.width=18; img.height=18; img.style.verticalAlign="middle"; img.style.marginRight="6px"; img.style.borderRadius="3px"; row.appendChild(img); }
                row.appendChild(document.createTextNode(it.name));
                row.addEventListener("mousedown",function(e){ e.preventDefault(); pick(it); });
                results.appendChild(row);
              });
              results.style.display="block";
            })["catch"](function(){ results.style.display="none"; });
        }
        if(search){ search.addEventListener("input",function(){
          var q=search.value.trim(); clearTimeout(t);
          if(q.length<2){ results.style.display="none"; return; }
          t=setTimeout(function(){ query(q); },250);
        });
        search.addEventListener("blur",function(){ setTimeout(function(){ results.style.display="none"; },200); }); }
      })();</script>`;

    // --- Loot (dropped items from this raid), imported directly on the event page
    // instead of having to go through Historie & Loot and pick the event by hand. ---
    const lootItems = opts.lootItems || [];
    const lootToolOptions = ["auto", "gargul", "rclc"].map((v) => {
        const label = v === "auto" ? "Auto-Erkennung" : LOOT_TOOL_LABELS[v];
        return `<option value="${v}"${v === (opts.lootTool || "auto") ? " selected" : ""}>${label}</option>`;
    }).join("");
    const lootExisting = lootItems.length
        ? `<div class="dash-card" style="margin-bottom:16px">
          <div class="dash-card-head">
            <h3>Bereits importiert</h3>
            <span class="small" style="margin-left:auto">${esc(String(lootItems.length))} Item(s)</span>
            <form method="POST" action="/admin/history/clear" style="margin:0 0 0 8px" onsubmit="return confirm('Gesamten Loot dieses Events löschen?')">
              ${csrfField}<input type="hidden" name="event" value="${esc(ev.id)}"><input type="hidden" name="origin" value="raid">
              <button class="btn btn-danger btn-sm" type="submit">Loot löschen</button>
            </form>
          </div>
          ${lootTable(lootItems)}
        </div>`
        : "";
    const lootSection = lootExisting + `
      <form class="card-form" method="POST" action="/admin/history/import" id="raidLootImportForm">
        ${csrfField}
        <input type="hidden" name="event" value="${esc(ev.id)}">
        <input type="hidden" name="origin" value="raid">
        <div class="field">
          <label>Loot-Tool</label>
          <select name="tool">${lootToolOptions}</select>
          <div class="hint">Wird aus der Kategorie-Markierung vorbelegt. „Auto" erkennt JSON (RCLootcouncil) bzw. CSV (Gargul) selbst.</div>
        </div>
        <div class="field">
          <label>Export einfügen</label>
          <textarea name="data" id="raidLootData" rows="6" placeholder="RCLootcouncil-JSON oder Gargul-CSV hier einfügen …"></textarea>
        </div>
        <div class="field">
          <label>… oder Datei hochladen</label>
          <input type="file" id="raidLootFile" accept=".json,.csv,.txt,.tsv">
          <div class="hint">Die Datei wird lokal in das Feld oben geladen — kein separater Upload.</div>
        </div>
        <div class="row-actions"><button class="btn" type="submit">Loot importieren</button></div>
      </form>
      <script>(function(){
        var file=document.getElementById("raidLootFile");
        var data=document.getElementById("raidLootData");
        if(file&&data){file.addEventListener("change",function(e){
          var f=e.target.files[0];if(!f)return;var r=new FileReader();
          r.onload=function(){data.value=r.result;};r.readAsText(f);
        });}
      })();</script>`;

    // --- Logs (Warcraft-Logs assigned to this raid): already-linked logs with
    // their evaluate/unlink actions, plus a picker to assign a still-unassigned
    // detected log to this event. Mirrors the CLA logs tab's per-row actions,
    // but scoped to one event so it can be worked from the raid page directly.
    const eventLogs = opts.eventLogs || [];
    const unlinkedLogs = opts.unlinkedLogs || [];
    const eventLogRow = (l) => {
        const wclUrl = logWclUrl(l);
        const name = l.title || l.reportId || "(unbekannt)";
        const link = wclUrl
            ? `<a class="mlink" href="${esc(wclUrl)}" target="_blank" rel="noopener">${esc(name)} ↗</a>`
            : esc(name);
        const status = l.status === "done"
            ? "<span class=\"pill\" style=\"background:var(--good-bg);color:var(--good)\">ausgewertet</span>"
            : "<span class=\"pill\">offen</span>";
        const action = l.status === "done"
            ? (l.reportUrl || l.reportRefId
                ? `<a class="btn btn-ghost btn-sm" href="${esc(l.reportUrl || `/r/${l.reportRefId}`)}">Öffnen</a>`
                : "")
            : `<form method="POST" action="/admin/cla/eval" style="margin:0" onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').textContent='Läuft …'">
                 ${csrfField}<input type="hidden" name="logId" value="${esc(l.id)}">
                 <button class="btn btn-sm" type="submit">Auswerten</button>
               </form>`;
        return `<div class="row-actions" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line-soft)">
          <div>${link} ${status}</div>
          <div class="row-actions" style="gap:6px">
            ${action}
            <form method="POST" action="/admin/cla/log-unlink" style="margin:0" onsubmit="return confirm('Zuordnung zu diesem Raid entfernen?')">
              ${csrfField}<input type="hidden" name="logId" value="${esc(l.id)}">
              <input type="hidden" name="event" value="${esc(ev.id)}">
              <input type="hidden" name="returnTo" value="event">
              <button class="btn btn-ghost btn-sm" type="submit" title="Zuordnung entfernen">✕</button>
            </form>
          </div>
        </div>`;
    };
    const linkLogForm = unlinkedLogs.length
        ? `<form method="POST" action="/admin/cla/log-link" class="row-actions" style="gap:8px;margin-top:12px;flex-wrap:wrap">
             ${csrfField}
             <input type="hidden" name="eventId" value="${esc(ev.id)}">
             <input type="hidden" name="returnTo" value="event">
             <select name="logId" class="sel-sm">
               ${unlinkedLogs.map((l) => `<option value="${esc(l.id)}">${esc(l.title || l.reportId || "(unbekannt)")}</option>`).join("")}
             </select>
             <button class="btn btn-ghost btn-sm" type="submit">Log zuordnen</button>
           </form>`
        : "<p class=\"sub\">Keine noch nicht zugeordneten Logs vorhanden.</p>";
    const logsSection = `
      ${eventLogs.length ? eventLogs.map(eventLogRow).join("") : "<p class=\"sub\">Für dieses Event ist noch kein Log zugeordnet.</p>"}
      <h2>Log zuordnen</h2>
      <p class="note">Ordnet ein bereits erkanntes, aber noch keinem Event zugeordnetes Log diesem Raid zu.</p>
      ${linkLogForm}`;

    const body = `
      <p class="note"><a class="mlink" href="/admin/raids">← Zurück zur Event-Übersicht</a></p>
      ${opts.eventsWarning ? `<div class="flash flash-err">${esc(opts.eventsWarning)}</div>` : ""}
      ${meta}
      <div class="tabs" role="tablist">
        <button type="button" class="tab-btn active" data-tab="setup" role="tab">Setup</button>
        <button type="button" class="tab-btn" data-tab="attendance" role="tab">Anwesenheit</button>
        <button type="button" class="tab-btn" data-tab="actions" role="tab">Anmeldung &amp; Sheet</button>
        <button type="button" class="tab-btn" data-tab="loot" role="tab">Loot${lootItems.length ? tabCount(lootItems.length) : ""}</button>
        <button type="button" class="tab-btn" data-tab="softres" role="tab">Softres</button>
        <button type="button" class="tab-btn" data-tab="logs" role="tab">Logs${eventLogs.length ? tabCount(eventLogs.length) : ""}</button>
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
        <h2>Raidsheet in Channel posten</h2>
        <p class="note">Postet den Link zum gefüllten Raidsheet als Nachricht mit Button in den Event-Channel — optional mit eigener Nachricht.</p>
        ${postSheetSection}
      </div>
      <div class="tab-panel" data-panel="softres" role="tabpanel" id="softres">
        <h2 style="margin-top:0">Softres-Liste erstellen</h2>
        <p class="note">Legt eine Soft-Reserve-Liste auf softres.it an — die Instanzen sind aus dem Event-Titel vorausgewählt. Wähle die Anzahl der Softres pro Spieler und markiere optional hardreservten Loot. Du bekommst danach einen Ansehen- und einen Bearbeiten-Link.</p>
        ${softresSection}
      </div>
      <div class="tab-panel" data-panel="loot" role="tabpanel">
        <h2 style="margin-top:0">Gedroppten Loot importieren</h2>
        <p class="note">RCLootcouncil-Export (JSON) oder Gargul-CSV dieses Raids einfügen oder hochladen — landet direkt in der <a class="mlink" href="/admin/history">Event-Historie</a>. Bereits importierter Loot wird beim erneuten Import automatisch übersprungen (Duplikat-Erkennung).</p>
        ${lootSection}
      </div>
      <div class="tab-panel" data-panel="logs" role="tabpanel">
        <h2 style="margin-top:0">Zugeordnete Logs</h2>
        <p class="note">Warcraft-Logs, die diesem Raid zugeordnet sind, sowie noch offene, erkannte Logs zum Zuordnen.</p>
        ${logsSection}
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
    return adminLayout("Event-Details — Pulsebot Admin", "raids", user, body, opts.msg, opts.nav, { crumb: ev.title || ev.id || "Event-Details", wowheadIconize: true });
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
    return adminLayout("Aufruf-Vorlagen — Pulsebot Admin", "raids", user, body, opts.msg, opts.nav, { crumb: "Aufruf-Vorlagen" });
}

/**
 * Settings page: admin role IDs and raid defaults, stored in the DB (settings store).
 * @param {object} opts { config, csrf, msg }
 */
function renderSettings(user, opts = {}) {
    const config = opts.config || { adminRoleIds: [], raidDefaults: {} };
    const rd = config.raidDefaults || {};
    const bz = config.blizzard || {};
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
          <label class="switch-row" style="font-weight:600">
            <span class="switch"><input type="checkbox" name="cat:${esc(cat.id)}" value="1"${isEvent ? " checked" : ""}><span class="switch-track"><span class="switch-thumb"></span></span></span>
            ${esc(cat.name)}${cat.unknown ? " <span class=\"hint\" style=\"font-weight:400\">(unbekannte ID — abwählen zum Entfernen)</span>" : ""}
          </label>
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
            <div class="hint">Mitglieder mit einer dieser Rollen erhalten Admin-Zugang. Änderungen greifen für bereits angemeldete Nutzer innerhalb von ca. 5 Minuten, ohne erneuten Login. Die <code>ADMIN_USER_ID</code> aus der .env behält immer Zugang (Notfall-Zugang).</div>
          </div>
          <div class="field">
            <label>Discord-Server-ID (Guild-ID)</label>
            <input type="text" name="guildId" value="${esc(config.guildId || "")}" placeholder="Discord-Server-ID">
            <div class="hint">Der Server, gegen den der Admin-Rollencheck oben läuft. Nicht zu verwechseln mit der Server-Auswahl im Menü.</div>
          </div>
          <div class="field">
            <label>Raid-Helper Server-ID</label>
            <input type="text" name="raidhelperServerId" value="${esc(config.raidhelperServerId || "")}" placeholder="Server-ID von raid-helper.xyz">
            <div class="hint">Wird für alle Raid-Helper-API-Aufrufe verwendet (Events, Setups, Anmeldungen). Der API-Key selbst bleibt in der .env.</div>
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

          <h2>Armory / Battle.net API</h2>
          <p class="hint" style="margin:-6px 0 12px">Optional: Mit Battle.net-API-Zugang zeigt die Char-Historie das Live-Gear (Paperdoll) direkt an. Ohne Zugang wird pro Char auf classic-armory.org verlinkt. Client anlegen unter <code>develop.battle.net</code>. Hinweis: Die Classic-Profile-API ist nur teilweise verfügbar — bei fehlenden Daten wird automatisch auf den Armory-Link zurückgefallen.</p>
          <div class="field">
            <label>Battle.net Client-ID</label>
            <input type="text" name="blizzardClientId" value="${esc(bz.clientId || "")}" placeholder="Client-ID von develop.battle.net" autocomplete="off">
          </div>
          <div class="field">
            <label>Battle.net Client-Secret</label>
            <input type="password" name="blizzardClientSecret" value="" placeholder="${bz.clientSecret ? "•••••••• (gespeichert – leer lassen, um es zu behalten)" : "Client-Secret"}" autocomplete="off">
            <div class="hint">Leer lassen behält das gespeicherte Secret. Zum Entfernen ein einzelnes Minus <code>-</code> eintragen.</div>
          </div>
          <div class="field">
            <label>Region</label>
            <input type="text" name="blizzardRegion" value="${esc(bz.region || "eu")}" placeholder="eu">
          </div>
          <div class="field">
            <label>Realm-Slug</label>
            <input type="text" name="blizzardRealmSlug" value="${esc(bz.realmSlug || "thunderstrike")}" placeholder="thunderstrike">
            <div class="hint">Kleingeschrieben, Bindestriche statt Leerzeichen (z.B. <code>thunderstrike</code>).</div>
          </div>
          <div class="field">
            <label>Profile-Namespace (optional)</label>
            <input type="text" name="blizzardNamespace" value="${esc(bz.namespace || "")}" placeholder="leer = automatisch (profile-classicann-${esc(bz.region || "eu")})">
            <div class="hint">Leer lassen = automatisch <code>profile-classicann-${esc(bz.region || "eu")}</code> (bestätigt korrekt für die Anniversary-Realms wie Thunderstrike). Nur überschreiben, falls nötig (z.B. <code>profile-classic-${esc(bz.region || "eu")}</code> oder <code>profile-classic1x-${esc(bz.region || "eu")}</code>). Die Char-Seite zeigt Level + „zuletzt online" zur Kontrolle.</div>
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

// ===== Event history & loot ==================================================

const LOOT_TOOL_LABELS = { gargul: "Gargul", rclc: "RCLootcouncil" };
function sourceBadge(source) {
    const label = LOOT_TOOL_LABELS[source] || source || "?";
    return `<span class="lbadge">${esc(label)}</span>`;
}

// --- character class/spec cells (Historie & Loot) ---
// Where a stored class/spec came from, so a wrong entry can be traced back.
const CLASS_SOURCE_LABELS = {
    export: "Loot-Export",
    report: "Auswertung",
    wcl: "Warcraft Log",
    manual: "manuell",
};
function classSourceBadge(source) {
    const label = CLASS_SOURCE_LABELS[source];
    return label ? `<span class="lbadge">${esc(label)}</span>` : "<span class=\"sub\">—</span>";
}
// Class and spec as ONE label — "Holy Paladin" — with the spec's icon in front.
// Without a known spec it stays the plain class; an unknown class is a dash.
function classSpecLabel(className, spec) {
    return spec ? `${spec} ${className}` : className;
}
function specIcon(className, spec) {
    const url = classSpecIconUrl(className, spec);
    return url
        ? `<img src="${esc(url)}" alt="" width="18" height="18" loading="lazy" style="border-radius:4px;vertical-align:-4px;margin-right:6px">`
        : "";
}
function classSpecCell(className, spec) {
    if (!className) return "<span class=\"sub\">—</span>";
    const color = CLASS_COLORS[className];
    return `${specIcon(className, spec)}<span style="font-weight:700${color ? `;color:${esc(color)}` : ""}">${esc(classSpecLabel(className, spec))}</span>`;
}
// "· Holy Paladin" behind a character's name, as far as it is known.
function charClassSuffix(info) {
    const className = (info && info.className) || "";
    if (!className) return "";
    const spec = (info && info.spec) || "";
    const color = CLASS_COLORS[className];
    return ` <span style="font-weight:700${color ? `;color:${esc(color)}` : ""}">· ${specIcon(className, spec)}${esc(classSpecLabel(className, spec))}</span>`;
}
// A character's name linking to their history page, class-coloured when known.
function charLink(c) {
    const color = CLASS_COLORS[c.className];
    return `<a class="mlink" href="/admin/history/char?name=${encodeURIComponent(c.character)}"${color ? ` style="color:${esc(color)}"` : ""}>${esc(c.character)}</a>`;
}
// Format an epoch-ms timestamp for the German UI (loot awardedAt / importedAt).
function fmtMs(ms, withTime = true) {
    const n = Number(ms);
    if (!n) return "";
    return new Date(n).toLocaleString("de-DE", withTime
        ? { timeZone: DISPLAY_TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }
        : { timeZone: DISPLAY_TZ, day: "2-digit", month: "2-digit", year: "numeric" });
}
// Fill a {char} URL template (armory / WCL) for a character name.
function fillCharTemplate(tpl, character) {
    return String(tpl || "").replace("{char}", encodeURIComponent(String(character || "").trim()));
}

/**
 * Event-history & loot landing page: import panel (per event, paste + upload),
 * per-category loot-tool marking, the imported-loot-per-event list, the tracked
 * Warcraft-Logs list and a quick character index.
 * @param {object} opts { events, upcomingRaids, pastRaids, lootEvents, logs,
 *                         categories, categoryLootTool, chars, guildId, csrf,
 *                         msg, nav, activeGuildId }
 */
function renderHistory(user, opts = {}) {
    const events = opts.events || [];
    const upcomingRaids = opts.upcomingRaids || { events: [], error: null };
    const pastRaids = opts.pastRaids || { events: [], error: null };
    const lootEvents = opts.lootEvents || [];
    const logs = opts.logs || [];
    const categories = opts.categories || [];
    const catTool = opts.categoryLootTool || {};
    const chars = opts.chars || [];
    const csrfField = hiddenCsrf(opts.csrf || "");
    const guildId = opts.guildId || (opts.nav && opts.nav.activeGuildId) || "";

    // --- Alle Raids: every raid, upcoming and already past, with the same
    // details/loot/WCL/evaluation links as the dashboard's "Latest Events". ---
    const raidsSection = `
      <div class="dash-card" style="margin-bottom:18px">
        <div class="dash-card-head"><h3>Kommende Raids</h3><span class="small" style="margin-left:auto">${upcomingRaids.events.length}</span></div>
        ${raidTable(upcomingRaids.events, guildId, { error: upcomingRaids.error, emptyMessage: "Keine anstehenden Raids gefunden." })}
      </div>
      <div class="dash-card">
        <div class="dash-card-head"><h3>Vergangene Raids</h3><span class="small" style="margin-left:auto">${pastRaids.events.length}</span></div>
        ${raidTable(pastRaids.events, guildId, { error: pastRaids.error, emptyMessage: "Keine vergangenen Raids gefunden." })}
      </div>`;

    const toolOptions = (sel) => ["auto", "gargul", "rclc"].map((v) => {
        const label = v === "auto" ? "Auto-Erkennung" : LOOT_TOOL_LABELS[v];
        return `<option value="${v}"${v === sel ? " selected" : ""}>${label}</option>`;
    }).join("");

    // --- import panel ---
    const eventOptions = events.map((ev) => {
        const cat = ev.categoryId || "";
        const tool = catTool[cat] || "";
        const label = `${ev.title || "(ohne Titel)"}${ev.startTime ? ` · ${formatEventTime(ev.startTime)}` : ""}`;
        return `<option value="${esc(ev.id)}" data-label="${esc(ev.title || "")}" data-category="${esc(cat)}" data-tool="${esc(tool)}">${esc(label)}</option>`;
    }).join("");
    const importPanel = `
      <div class="dash-card" style="margin-bottom:18px">
        <div class="dash-card-head"><h3>Loot importieren</h3></div>
        <form class="card-form" method="POST" action="/admin/history/import" style="padding:14px 16px" id="lootImportForm">
          ${csrfField}
          <div class="field">
            <label>Event</label>
            <select name="event" id="lootEventSelect">
              <option value="__auto__" data-tool="" selected>— Automatisch anhand des Datums im Export zuordnen —</option>
              ${eventOptions}
              <option value="__manual__" data-tool="">— Anderes / vergangenes Event (manuell benennen) —</option>
            </select>
            <div class="hint">„Automatisch" ordnet dem Raid-Helper-Event des gleichen Tages zu; passt keins oder mehrere, muss unten manuell gewählt/benannt werden.</div>
          </div>
          <div class="field" id="lootManualField">
            <label>Titel (optional)</label>
            <input type="text" name="manualLabel" placeholder="z.B. SSC/TK — 12.07.2026">
            <div class="hint">Nur nötig, wenn kein Event automatisch gefunden wird oder ein eigener Titel gewünscht ist.</div>
          </div>
          <div class="field">
            <label>Loot-Tool</label>
            <select name="tool" id="lootToolSelect">${toolOptions("auto")}</select>
            <div class="hint">Wird aus der Kategorie-Markierung vorbelegt. „Auto" erkennt JSON (RCLootcouncil) bzw. CSV (Gargul) selbst.</div>
          </div>
          <div class="field">
            <label>Export einfügen</label>
            <textarea name="data" id="lootData" rows="6" placeholder="RCLootcouncil-JSON oder Gargul-CSV hier einfügen …"></textarea>
          </div>
          <div class="field">
            <label>… oder Datei hochladen</label>
            <input type="file" id="lootFile" accept=".json,.csv,.txt,.tsv">
            <div class="hint">Die Datei wird lokal in das Feld oben geladen — kein separater Upload.</div>
          </div>
          <div class="row-actions"><button class="btn" type="submit">Loot importieren</button></div>
        </form>
      </div>
      <script>(function(){
        var sel=document.getElementById("lootEventSelect");
        var manual=document.getElementById("lootManualField");
        var tool=document.getElementById("lootToolSelect");
        var file=document.getElementById("lootFile");
        var data=document.getElementById("lootData");
        function apply(){
          var o=sel.options[sel.selectedIndex];
          var v=o?o.value:"";
          if(manual) manual.style.display=(v==="__auto__"||v==="__manual__")?"":"none";
          var t=o?o.getAttribute("data-tool"):"";
          if(t&&tool){for(var i=0;i<tool.options.length;i++){if(tool.options[i].value===t){tool.selectedIndex=i;break;}}}
        }
        if(sel){sel.addEventListener("change",apply);apply();}
        if(file&&data){file.addEventListener("change",function(e){
          var f=e.target.files[0];if(!f)return;var r=new FileReader();
          r.onload=function(){data.value=r.result;};r.readAsText(f);
        });}
      })();</script>`;

    // --- per-category loot-tool marking ---
    const catRows = categories.length
        ? categories.map((c) => {
            const cur = catTool[c.id] || "";
            const opt = (v, label) => `<option value="${v}"${v === cur ? " selected" : ""}>${label}</option>`;
            return `<tr>
              <td><strong>${esc(c.name)}</strong></td>
              <td class="row-actions">
                <form method="POST" action="/admin/history/category-tool" class="row-actions" style="margin:0">
                  ${csrfField}<input type="hidden" name="categoryId" value="${esc(c.id)}">
                  <select name="tool">${opt("", "— nicht gesetzt —")}${opt("gargul", "Gargul")}${opt("rclc", "RCLootcouncil")}</select>
                  <button class="btn btn-ghost btn-sm" type="submit">Speichern</button>
                </form>
              </td>
            </tr>`;
        }).join("")
        : "<tr><td colspan=\"2\" class=\"sub\">Keine Kategorien gefunden (Server gewählt?).</td></tr>";
    const categorySection = `
      <div class="dash-card" style="margin-bottom:18px">
        <div class="dash-card-head"><h3>Loot-Tool je Kategorie</h3></div>
        <table class="idx" style="margin:0"><tbody>${catRows}</tbody></table>
      </div>`;

    // --- imported loot per event ---
    const lootRows = lootEvents.map((e) => {
        const label = e.label || e.eventId;
        const badges = (e.sources || []).map(sourceBadge).join(" ");
        return `<tr>
          <td><strong>${esc(label)}</strong></td>
          <td class="small">${esc(fmtMs(e.awardedAt || e.importedAt, false))}</td>
          <td class="small">${esc(String(e.count))}</td>
          <td class="small">${badges}</td>
          <td class="cell-actions"><div class="row-actions" style="justify-content:flex-end">
            <a class="btn btn-ghost btn-sm" href="/admin/history/event?event=${esc(e.eventId)}">Loot ansehen</a>
          </div></td>
        </tr>`;
    }).join("");
    const lootSection = lootEvents.length
        ? `<div class="dash-card" style="margin-bottom:18px">
             <div class="dash-card-head"><h3>Importierter Loot</h3><span class="small" style="margin-left:auto">${lootEvents.length} Event(s)</span></div>
             <table class="idx" style="margin:0">
               <thead><tr><th>Event</th><th>Datum</th><th>Items</th><th>Quelle</th><th></th></tr></thead>
               <tbody>${lootRows}</tbody>
             </table>
           </div>`
        : "<p class=\"sub\">Noch kein Loot importiert.</p>";

    // --- tracked Warcraft Logs (direct links), formatted like CLA's "Erkannte Logs" ---
    const logRows = logs.map((l) => {
        const url = logWclUrl(l);
        const when = logPostedAt(l);
        const status = l.status === "done"
            ? "<span class=\"pill\" style=\"background:var(--good-bg);color:var(--good)\">ausgewertet</span>"
            : "<span class=\"pill\">offen</span>";
        const openAction = (l.status === "done" && (l.reportUrl || l.reportRefId))
            ? iconBtn("a", "ghost", "open", "Öffnen", `href="${esc(l.reportUrl || `/r/${l.reportRefId}`)}"`)
            : "";
        return `<tr>
          <td>${url ? `<a class="mlink" href="${esc(url)}" target="_blank" rel="noopener">${esc(l.title || l.reportId || "(Log)")} ↗</a>` : esc(l.title || "(Log)")}</td>
          <td class="small">${esc(when ? new Date(when).toLocaleDateString("de-DE", { timeZone: DISPLAY_TZ }) : "")}</td>
          <td class="small">${esc(l.zone || "")}</td>
          <td class="small">${l.eventId
        ? `<span class="pill" title="${esc(l.eventStartTime ? formatEventTime(l.eventStartTime) : "")}">${esc(l.eventLabel || l.eventId)}</span>`
        : "<span class=\"sub\">—</span>"}</td>
          <td>${status}</td>
          <td class="cell-actions"><div class="row-actions" style="justify-content:flex-end">
            ${openAction}
            <form method="POST" action="/admin/history/log-delete" style="margin:0" onsubmit="return confirm('Log aus der Liste entfernen?')">
              ${csrfField}<input type="hidden" name="logId" value="${esc(l.id)}">
              ${iconBtn("button", "danger", "trash", "Löschen", "type=\"submit\"")}
            </form>
          </div></td>
        </tr>`;
    }).join("");
    const logsSection = logs.length
        ? `<div class="dash-card" style="margin-bottom:18px">
             <div class="dash-card-head"><h3>Warcraft Logs</h3><span class="small" style="margin-left:auto">${logs.length}</span></div>
             <table class="idx" style="margin:0">
               <thead><tr><th>Log</th><th>Datum</th><th>Zone</th><th>Event</th><th>Status</th><th></th></tr></thead>
               <tbody>${logRows}</tbody>
             </table>
           </div>`
        : "<p class=\"sub\">Keine Warcraft-Logs erfasst (Log-Channels in den Einstellungen konfigurieren).</p>";

    // --- character index: chips for a quick jump, plus the class/spec list ---
    const charChips = chars.length
        ? chars.map((c) => `<a class="btn btn-ghost btn-sm" href="/admin/history/char?name=${encodeURIComponent(c.character)}">${esc(c.character)} <span class="small">(${esc(String(c.count))})</span></a>`).join(" ")
        : "<span class=\"sub\">Noch keine Charaktere mit Loot.</span>";
    const charRows = chars.map((c) => `<tr>
        <td>${charLink(c)}</td>
        <td>${classSpecCell(c.className, c.spec)}</td>
        <td class="small">${esc(String(c.count))}</td>
        <td class="small">${classSourceBadge(c.source)}</td>
      </tr>`).join("");
    const missingClasses = chars.filter((c) => !c.className || !c.spec).length;
    const charTable = chars.length
        ? `<table class="idx" style="margin:0">
             <thead><tr><th>Charakter</th><th>Klasse &amp; Spec</th><th>Items</th><th>Quelle</th></tr></thead>
             <tbody>${charRows}</tbody>
           </table>`
        : "<p class=\"sub\" style=\"padding:14px 16px\">Noch keine Charaktere mit Loot.</p>";
    const resolveForm = chars.length
        ? `<form method="POST" action="/admin/history/characters-resolve" style="margin:0" onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').textContent='Suche läuft …'">
             ${csrfField}
             <button class="btn btn-ghost btn-sm" type="submit" title="Nimmt die Klasse aus dem Loot-Export bzw. einer vorhandenen Auswertung und liest den Rest aus dem Warcraft-Log des Raids">Klassen &amp; Specs ergänzen${missingClasses ? ` (${missingClasses} offen)` : ""}</button>
           </form>`
        : "";
    const charSection = `
      <div class="dash-card" style="margin-bottom:18px">
        <div class="dash-card-head"><h3>Charaktere</h3>${resolveForm ? `<span style="margin-left:auto">${resolveForm}</span>` : ""}</div>
        ${charTable}
      </div>
      <div class="dash-card">
        <div class="dash-card-head"><h3>Schnellzugriff</h3></div>
        <div class="row-actions" style="padding:14px 16px">${charChips}</div>
      </div>`;

    const activeTab = opts.tab || "raids";
    const body = `
      <p class="note">Loot pro Event importieren (RCLootcouncil-JSON oder Gargul-CSV), Warcraft-Logs verlinken und pro Charakter die Loot-Historie samt Armory einsehen.</p>
      ${tabGroup("historyTabs", [
        { id: "raids", label: `Alle Raids${tabCount(upcomingRaids.events.length + pastRaids.events.length)}`, content: raidsSection, active: activeTab === "raids" },
        { id: "import", label: "Import", content: importPanel, active: activeTab === "import" },
        { id: "loot", label: `Importierter Loot${tabCount(lootEvents.length)}`, content: lootSection, active: activeTab === "loot" },
        { id: "logs", label: `Warcraft Logs${tabCount(logs.length)}`, content: logsSection, active: activeTab === "logs" },
        { id: "cats", label: "Loot-Tools", content: categorySection },
        { id: "chars", label: `Charaktere${tabCount(chars.length)}`, content: charSection },
    ])}`;
    return adminLayout("Historie & Loot — Pulsebot Admin", "history", user, body, opts.msg, opts.nav);
}

// Click-to-sort headers for lootTable(), entirely client-side: this page's tabs
// (setup/attendance/actions/loot/softres) toggle in the browser with no URL
// state, so a claSortHeader()-style link that reloads the page would kick the
// admin back to the first tab. Column defaults mirror the React port's
// LootTable.tsx SORT_DEFAULTS.
const LOOT_SORT_DEFAULTS = { item: "asc", character: "asc", response: "asc", boss: "asc", event: "asc", time: "desc", source: "asc" };
function lootSortTh(key, label) {
    return `<th data-default="${LOOT_SORT_DEFAULTS[key] || "asc"}"><button type="button" class="sort-link" data-label="${esc(label)}">${esc(label)}</button></th>`;
}
// Delegated (not per-row) so it keeps working after lootTable() re-renders;
// reorders <tr> elements by each cell's data-sort attribute (raw, lowercased
// value — not the formatted/markup cell content).
const LOOT_SORT_SCRIPT = "<script>(function(){if(window.__lootSort)return;window.__lootSort=1;"
    + "document.addEventListener('click',function(e){"
    + "var btn=e.target.closest('table.idx.sortable .sort-link');if(!btn)return;"
    + "var th=btn.closest('th');var table=btn.closest('table');var tbody=table.querySelector('tbody');"
    + "var ths=[].slice.call(table.querySelectorAll('thead th'));var idx=ths.indexOf(th);"
    + "var dir=th.hasAttribute('data-dir')?(th.getAttribute('data-dir')==='asc'?'desc':'asc'):(th.getAttribute('data-default')||'asc');"
    + "ths.forEach(function(t){t.removeAttribute('data-dir');var b=t.querySelector('.sort-link');if(b){b.classList.remove('active');b.textContent=b.getAttribute('data-label');}});"
    + "th.setAttribute('data-dir',dir);btn.classList.add('active');btn.textContent=btn.getAttribute('data-label')+(dir==='asc'?' ▲':' ▼');"
    + "var rows=[].slice.call(tbody.querySelectorAll('tr'));"
    + "rows.sort(function(a,b){"
    + "var av=a.children[idx].getAttribute('data-sort')||'';var bv=b.children[idx].getAttribute('data-sort')||'';"
    + "var an=parseFloat(av),bn=parseFloat(bv);var cmp;"
    + "if(!isNaN(an)&&!isNaN(bn)&&String(an)===av&&String(bn)===bv)cmp=an-bn;else cmp=av<bv?-1:(av>bv?1:0);"
    + "return dir==='asc'?cmp:-cmp;});"
    + "rows.forEach(function(r){tbody.appendChild(r);});"
    + "});"
    + "})();</script>";

// A shared loot table (item, player→char page, response, boss, time). Pre-sorted
// by character on render — that's how a raid lead checks "who got what" right
// after an import — then sortable by any column via LOOT_SORT_SCRIPT.
function lootTable(items, { showEvent = false } = {}) {
    const sorted = [...items].sort((a, b) => String(a.character || "").localeCompare(String(b.character || "")));
    const rows = sorted.map((it) => {
        const itemName = it.itemName || ("Item " + it.itemId);
        const icon = it.itemIconUrl
            ? `<img src="${esc(it.itemIconUrl)}" alt="" width="20" height="20" loading="lazy" style="border-radius:4px;vertical-align:-5px;margin-right:6px">`
            : "";
        const item = it.itemLink
            ? `${icon}<a class="mlink" href="${esc(it.itemLink)}" target="_blank" rel="noopener">${esc(itemName)}</a>`
            : `${icon}${esc(itemName)}`;
        const respText = it.response || (it.offspec ? "Off Spec" : "Main Spec");
        const resp = it.offspec
            ? `<span class="lbadge lbadge-neutral">${esc(respText)}</span>`
            : `<span class="lbadge lbadge-ok">${esc(respText)}</span>`;
        const sourceLabel = LOOT_TOOL_LABELS[it.source] || it.source || "?";
        return `<tr>
          <td data-sort="${esc(itemName.toLowerCase())}">${item}</td>
          <td data-sort="${esc(String(it.character || "").toLowerCase())}"><a class="mlink" href="/admin/history/char?name=${encodeURIComponent(it.character)}">${esc(it.character)}</a></td>
          <td class="small" data-sort="${esc(respText.toLowerCase())}">${resp}</td>
          <td class="small" data-sort="${esc(String(it.boss || "").toLowerCase())}">${esc(it.boss || "")}</td>
          ${showEvent ? `<td class="small" data-sort="${esc(String(it.eventLabel || it.eventId || "").toLowerCase())}">${esc(it.eventLabel || it.eventId || "")}</td>` : ""}
          <td class="small" data-sort="${it.awardedAt || 0}">${esc(fmtMs(it.awardedAt))}</td>
          <td class="small" data-sort="${esc(sourceLabel.toLowerCase())}">${sourceBadge(it.source)}</td>
        </tr>`;
    }).join("");
    const head = `<tr>${lootSortTh("item", "Item")}${lootSortTh("character", "Charakter")}${lootSortTh("response", "Response")}${lootSortTh("boss", "Boss")}${showEvent ? lootSortTh("event", "Event") : ""}${lootSortTh("time", "Zeit")}${lootSortTh("source", "Quelle")}</tr>`;
    return `<table class="idx sortable" style="margin:0"><thead>${head}</thead><tbody>${rows}</tbody></table>${LOOT_SORT_SCRIPT}`;
}

/**
 * Loot of a single event.
 * @param {object} opts { eventId, label, items, csrf, msg, nav }
 */
function renderHistoryEvent(user, opts = {}) {
    const items = opts.items || [];
    const label = opts.label || opts.eventId || "Event";
    const csrfField = hiddenCsrf(opts.csrf || "");
    const table = items.length
        ? lootTable(items)
        : "<p class=\"sub\">Kein Loot für dieses Event gespeichert.</p>";
    const body = `
      <p class="note"><a class="mlink" href="/admin/history">← Zurück zur Historie</a></p>
      <div class="dash-card">
        <div class="dash-card-head">
          <h3>${esc(label)}</h3>
          <span class="small" style="margin-left:auto">${items.length} Item(s)</span>
          <form method="POST" action="/admin/history/clear" style="margin:0" onsubmit="return confirm('Gesamten Loot dieses Events löschen?')">
            ${csrfField}<input type="hidden" name="event" value="${esc(opts.eventId || "")}">
            <button class="btn btn-danger btn-sm" type="submit">Loot löschen</button>
          </form>
        </div>
        ${table}
      </div>`;
    return adminLayout("Event-Loot — Pulsebot Admin", "history", user, body, opts.msg, opts.nav, { wowheadIconize: true, crumb: label });
}

// Classic character-sheet slot layout: armor down the left, accessories down
// the right, weapons centered underneath (matches the in-game paperdoll).
const GEAR_LEFT = ["HEAD", "NECK", "SHOULDER", "BACK", "CHEST", "SHIRT", "TABARD", "WRIST"];
const GEAR_RIGHT = ["HANDS", "WAIST", "LEGS", "FEET", "FINGER_1", "FINGER_2", "TRINKET_1", "TRINKET_2"];
const GEAR_BOTTOM = ["MAIN_HAND", "OFF_HAND", "RANGED"];
const GEAR_SLOT_LABELS = {
    HEAD: "Kopf", NECK: "Hals", SHOULDER: "Schulter", BACK: "Rücken", CHEST: "Brust", SHIRT: "Hemd", TABARD: "Wappenrock",
    WRIST: "Handgelenk", HANDS: "Hände", WAIST: "Taille", LEGS: "Beine", FEET: "Füße",
    FINGER_1: "Ring 1", FINGER_2: "Ring 2", TRINKET_1: "Schmuck 1", TRINKET_2: "Schmuck 2",
    MAIN_HAND: "Haupthand", OFF_HAND: "Nebenhand", RANGED: "Fernkampf",
};
const GEAR_QUALITY_COLOR = {
    POOR: "#9d9d9d", COMMON: "#ffffff", UNCOMMON: "#1eff00", RARE: "#0070dd",
    EPIC: "#a335ee", LEGENDARY: "#ff8000", ARTIFACT: "#e6cc80", HEIRLOOM: "#00ccff",
};
const GEAR_GEM_COLOR = {
    RED: "#c0392b", YELLOW: "#e0b73a", BLUE: "#3d7dd6", META: "#d8d8d8",
    PRISMATIC: "linear-gradient(135deg, #e05d5d, #e0c65d, #5d8ee0)",
};
const GEAR_SOCKET_DE = { RED: "Rot", YELLOW: "Gelb", BLUE: "Blau", META: "Meta", PRISMATIC: "Prismatisch" };

// One equipment tile in the paperdoll: icon with quality border, iLvl below,
// socket dots + enchant marker on the icon, and a WoW-style dark hover tooltip
// (item name in quality color, green enchant lines, gem icons). `side` picks
// which way the tooltip opens so it stays inside the card; a missing item
// renders as a dimmed placeholder so the sheet keeps its shape.
function gearTile(g, side) {
    if (!g) return `<div class="gear-tile gear-tile-${side}"><span class="gear-icon gear-empty-ph"></span></div>`;
    const color = GEAR_QUALITY_COLOR[g.quality] || "var(--line)";
    const label = GEAR_SLOT_LABELS[g.slot] || g.slot || "";
    const enchants = g.enchants || [];
    const sockets = g.sockets || [];
    const iconImg = g.iconUrl
        ? `<img src="${esc(g.iconUrl)}" alt="" loading="lazy">`
        : "<span class=\"gear-icon-ph\"></span>";
    const enchMark = enchants.length ? "<span class=\"gear-enchmark\">+</span>" : "";
    const gemDot = (s) => `<span class="gear-gem" style="background:${s.gemName ? (GEAR_GEM_COLOR[s.type] || "#888") : "transparent"};border-color:${GEAR_GEM_COLOR[s.type] || "var(--muted)"}"></span>`;
    const gems = sockets.length ? `<span class="gear-gems">${sockets.map(gemDot).join("")}</span>` : "";
    // Deliberately a <span>, not a Wowhead <a>: the page's Wowhead widget
    // (power.js, loaded for the loot tab) rewrites wowhead links — injecting
    // its own repeated icon into the tile and stacking its tooltip over ours.
    // The Wowhead link lives on the item name inside the tooltip instead.
    const icon = `<span class="gear-icon" style="border-color:${color}">${iconImg}${enchMark}${gems}</span>`;
    const tipName = g.itemId
        ? `<a class="gt-name" style="color:${color}" href="https://www.wowhead.com/tbc/item=${esc(String(g.itemId))}" target="_blank" rel="noopener">${esc(g.name || ("Item " + g.itemId))}</a>`
        : `<span class="gt-name" style="color:${color}">${esc(g.name || label)}</span>`;
    const tipMeta = `<div class="gt-meta">${esc(label)}${g.level ? ` · Gegenstandsstufe ${esc(String(g.level))}` : ""}</div>`;
    const tipEnch = enchants.map((e) => `<div class="gt-ench">${esc(e)}</div>`).join("");
    const tipSockets = sockets.map((s) => {
        const gemIcon = s.gemIconUrl
            ? `<img class="gt-gemicon" src="${esc(s.gemIconUrl)}" alt="" loading="lazy">`
            : `<span class="gear-gem-dot" style="background:${s.gemName ? (GEAR_GEM_COLOR[s.type] || "#888") : "transparent"};border-color:${GEAR_GEM_COLOR[s.type] || "var(--muted)"}"></span>`;
        const text = s.gemName ? esc(s.gemName) : `Leerer Sockel (${esc(GEAR_SOCKET_DE[s.type] || s.type || "?")})`;
        return `<div class="gt-gem${s.gemName ? "" : " gt-empty"}">${gemIcon}${text}</div>`;
    }).join("");
    return `<div class="gear-tile gear-tile-${side}">
      ${icon}
      <div class="gear-tile-ilvl">${g.level ? esc(String(g.level)) : ""}</div>
      <div class="gear-tip">${tipName}${tipMeta}${tipEnch}${tipSockets}</div>
    </div>`;
}

// The full paperdoll: left/right slot columns around a class portrait + Ø iLvl,
// weapons row underneath — same shape as render.js's logcheck player paperdoll.
function gearPaperdoll(gear, { classIconUrl = "", itemLevel = 0 } = {}) {
    const bySlot = new Map(gear.map((g) => [g.slot, g]));
    const known = new Set([...GEAR_LEFT, ...GEAR_RIGHT, ...GEAR_BOTTOM]);
    const extras = gear.filter((g) => !known.has(g.slot));
    const col = (slots, side) => slots.map((s) => gearTile(bySlot.get(s), side)).join("");
    const bottom = [
        ...GEAR_BOTTOM.map((s) => gearTile(bySlot.get(s), "bottom")),
        ...extras.map((g) => gearTile(g, "bottom")),
    ].join("");
    const ilvls = gear.map((g) => g.level).filter((n) => n > 0);
    const avg = itemLevel || (ilvls.length ? Math.round(ilvls.reduce((a, b) => a + b, 0) / ilvls.length) : 0);
    const portrait = classIconUrl ? `<img class="gear-portrait" src="${esc(classIconUrl)}" alt="">` : "";
    const avgBadge = avg ? `<div class="gear-avg"><b>${esc(String(avg))}</b><span>Ø iLvl</span></div>` : "";
    return `<div class="gear-doll">
      <div class="gear-col gear-col-left">${col(GEAR_LEFT, "left")}</div>
      <div class="gear-center">${portrait}${avgBadge}</div>
      <div class="gear-col gear-col-right">${col(GEAR_RIGHT, "right")}</div>
      <div class="gear-doll-bottom">${bottom}</div>
    </div>`;
}

/**
 * A character's loot history + armory/WCL links + optional live gear (paperdoll).
 * @param {object} opts { character, realm, items, armoryUrl, wclUrl, gear,
 *                         gearConfigured, gearError, csrf, msg, nav }
 */
function renderHistoryChar(user, opts = {}) {
    const character = opts.character || "";
    const items = opts.items || [];
    const links = `
      <div class="row-actions">
        ${opts.armoryUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(opts.armoryUrl)}" target="_blank" rel="noopener">Armory ↗</a>` : ""}
        ${opts.wclUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(opts.wclUrl)}" target="_blank" rel="noopener">Warcraft Logs ↗</a>` : ""}
      </div>`;

    const reloadBtn = `<a class="btn btn-ghost btn-sm" href="/admin/history/char?name=${encodeURIComponent(character)}">↻ Paperdoll neu laden</a>`;
    let gearInner;
    if (Array.isArray(opts.gear) && opts.gear.length) {
        const info = opts.info || {};
        const doll = gearPaperdoll(opts.gear, {
            classIconUrl: info.className ? classSpecIconUrl(info.className, info.spec || "") : "",
            itemLevel: (opts.charSummary && opts.charSummary.itemLevel) || 0,
        });
        gearInner = `<div class="dash-card gear-card">
            <div class="dash-card-head"><h3>Aktuelles Gear (Paperdoll)</h3><span class="small" style="margin-left:auto">Battle.net API</span></div>
            ${doll}
          </div>`;
    } else if (opts.gearConfigured) {
        gearInner = `<div class="flash flash-err" style="margin:0 0 12px">${esc(opts.gearError || "Kein Live-Gear von der Battle.net-API verfügbar.")}</div>
          <p class="sub">Nutze solange den Armory-Link oben. „Paperdoll neu laden" fragt erneut ab.</p>`;
    } else {
        gearInner = "<p class=\"sub\">Für Live-Gear (Paperdoll) Battle.net-Zugang in den <a href=\"/admin/settings\">Einstellungen</a> hinterlegen. Ohne Zugang steht der Armory-Link oben zur Verfügung.</p>";
    }
    // Diagnostics strip: character level / iLvl / last-login / realm + the queried
    // namespace. Reveals a wrong-namespace hit (e.g. a level 60/80 result on a
    // level-70 TBC char → wrong-era gear like old Naxxramas pieces).
    const s = opts.charSummary;
    const nsBadge = opts.gearNamespace ? `<span class="lbadge" title="abgefragter Profile-Namespace">${esc(opts.gearNamespace)}</span>` : "";
    let summaryStrip = "";
    if (s) {
        const parts = [];
        if (s.level) parts.push(`<strong>Level ${esc(String(s.level))}</strong>`);
        if (s.className) parts.push(esc(s.className));
        if (s.itemLevel) parts.push(`Ø iLvl ${esc(String(s.itemLevel))}`);
        if (s.realm) parts.push(`Realm: ${esc(s.realm)}`);
        if (s.lastLogin) parts.push(`zuletzt online ${esc(fmtMs(s.lastLogin, false))}`);
        const wrongLevel = s.level && Number(s.level) !== 70;
        const warn = wrongLevel
            ? `<div class="flash flash-err" style="margin:10px 0 0">Die Blizzard-API meldet <strong>Level ${esc(String(s.level))}</strong> — wahrscheinlich der falsche Namespace/Char (nicht dein TBC-Char auf Level 70). Passe den Profile-Namespace in den <a href="/admin/settings">Einstellungen</a> an (z.B. profile-classicann-…).</div>`
            : "";
        summaryStrip = `<div class="sheetcard" style="margin-bottom:12px"><div class="small">${parts.join(" · ")}</div>${warn}</div>`;
    }
    const gearTab = `
      <div class="row-actions" style="margin-bottom:12px;align-items:center">
        ${opts.gearConfigured ? reloadBtn : "<a class=\"btn btn-ghost btn-sm\" href=\"/admin/settings\">Battle.net einrichten</a>"}
        ${opts.gearConfigured ? nsBadge : ""}
      </div>
      ${summaryStrip}
      ${gearInner}`;

    const lootTab = items.length
        ? `<div class="dash-card">
             <div class="dash-card-head"><h3>Loot-Historie</h3><span class="small" style="margin-left:auto">${items.length} Item(s)</span></div>
             ${lootTable(items, { showEvent: true })}
           </div>`
        : "<p class=\"sub\">Kein Loot für diesen Charakter gespeichert.</p>";

    const body = `
      <p class="note"><a class="mlink" href="/admin/history">← Zurück zur Historie</a></p>
      <h2 style="margin-top:0">${esc(character)}${opts.realm ? ` <span class="sub">· ${esc(opts.realm)}</span>` : ""}${charClassSuffix(opts.info)}</h2>
      ${links}
      <div style="height:14px"></div>
      ${tabGroup("charTabs", [
        { id: "gear", label: "Gear (Paperdoll)", content: gearTab, active: true },
        { id: "loot", label: `Loot-Historie${tabCount(items.length)}`, content: lootTab },
    ])}`;
    return adminLayout(`${character || "Charakter"} — Pulsebot Admin`, "history", user, body, opts.msg, opts.nav, { wowheadIconize: true, crumb: character || "Charakter" });
}

module.exports = {
    adminLayout, adminNav, renderDashboard, renderAdminDenied,
    renderRecruitment, renderRecruitmentFragment, renderCla, renderRaids, renderRaidCreate,
    renderEventDetail, renderNotifyTemplates, renderChannels, renderSettings,
    renderHistory, renderHistoryEvent, renderHistoryChar,
    fillCharTemplate, hiddenCsrf, esc,
    formatEventTime, fmtMs, formatMatchOffset,
};
