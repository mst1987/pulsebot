// HTML rendering for the logcheck report website.
// Uses the Wowhead tooltip widget (power.js) + zamimg icon CDN — no local assets.
//
// Report pages are public (their links are posted to Discord), so they stay
// server-rendered. Visitors with admin rights get the same sidebar/topbar chrome
// as the React admin around them (see adminChrome.js) so a log-check is a normal
// stop inside the admin menu instead of a dead end.

const { renderAdminChrome, CHROME_STYLE, ICONS } = require("./adminChrome");
const rpbData = require("../config/rpbData");
const { ribbonChart, markerChart, lineChart, fmtTime, bandStats, CHART_STYLE, PX_PER_SEC } = require("./charts");
const { bossIconUrl } = require("../config/bosses");
const { itemLink: wowheadItemLink } = require("../utils/wowhead");
const { armoryUrlFor } = require("./charLinks");
const { TANK_AURAS } = require("../config/healerSpells");
const { ROLE_LABELS: BUFF_ROLE_LABELS } = require("../config/raidBuffs");
const { applyReview } = require("../utils/logcheck/recommendations");
const { dipShare } = require("../utils/logcheck/fightSeries");
const { plural } = require("../utils/text");

const CLASS_COLORS = {
    Druid: "#FF7D0A", Hunter: "#ABD473", Mage: "#69CCF0", Paladin: "#F58CBA",
    Priest: "#FFFFFF", Rogue: "#FFF569", Shaman: "#0070DE", Warlock: "#9482C9", Warrior: "#C79C6E",
};

// ---- report page, design #226: area groups with metric cards, detail dialogs, one-line findings,
// icon buttons, the four-section raider card and the focused player page. Tokens only, light + dark. ----
const REPORT_STYLE = `
  /* buttons: .btn-run starts a job, .ibtn is the square icon button */
  .btn .hicon, .btn-ghost .hicon { width:18px; height:18px; margin:0; border-radius:4px; }
  .btn svg { width:15px; height:15px; flex:0 0 auto; }
  .btn:disabled { opacity:.5; cursor:default; filter:none; transform:none; box-shadow:none; }
  .btn-run { background:var(--panel2); color:var(--text); border:1px solid color-mix(in srgb, var(--accent-2) 55%, transparent); }
  .btn-run::after { content:""; width:7px; height:7px; border-radius:50%; background:var(--accent-2); margin-left:2px; }
  .btn-run:hover { filter:none; border-color:var(--accent-2); box-shadow:none; background:var(--panel3); }
  .ibtn { width:32px; height:32px; border-radius:8px; border:1px solid var(--line); background:var(--panel2); display:inline-grid; place-items:center; color:var(--muted); flex:0 0 auto; padding:0; cursor:pointer; text-decoration:none; font:inherit; }
  .ibtn svg { width:16px; height:16px; display:block; }
  .ibtn .hicon { width:22px; height:22px; margin:0; border-radius:4px; }
  .ibtn:hover { border-color:var(--accent); color:var(--text); }
  .ibtn.ok { color:var(--good); border-color:color-mix(in srgb, var(--good) 45%, transparent); background:var(--good-bg); }
  .ibtn.bad { color:var(--high); border-color:color-mix(in srgb, var(--high) 45%, transparent); background:var(--high-bg); }
  .mute { color:var(--muted); }
  .mono { font-family:var(--font-mono); font-variant-numeric:tabular-nums; }
  .cn { color:var(--cc, var(--text)); font-weight:700; }
  @media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) .who .cn, :root:not([data-theme="dark"]) .kv .cn, :root:not([data-theme="dark"]) .ptitle-cn { color:color-mix(in srgb, var(--cc) 70%, #000); } }
  :root[data-theme="light"] .who .cn, :root[data-theme="light"] .kv .cn, :root[data-theme="light"] .ptitle-cn { color:color-mix(in srgb, var(--cc) 70%, #000); }
  /* area group: a card with the area head and its metric cards */
  .gcard { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:12px; display:flex; flex-direction:column; gap:12px; }
  .part-head.gh { margin:0; justify-content:flex-start; flex-wrap:nowrap; }
  .gh-title { display:flex; flex-direction:column; line-height:1.25; min-width:0; }
  .gh-title b { font-size:15px; font-weight:800; }
  .gh .grow { flex:1 1 auto; }
  .gh .btn { flex:0 0 auto; }
  .mgrid { display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:10px; }
  .mcard { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px 14px; display:flex; flex-direction:column; gap:8px; min-width:0; cursor:pointer; transition:border-color .12s ease, box-shadow .12s ease; }
  .mcard.wide { grid-column:span 2; }
  .mcard:hover, .mcard:focus-visible { border-color:var(--accent); box-shadow:0 10px 26px -18px #000; outline:none; }
  .mc-head { display:flex; align-items:center; gap:10px; }
  .mc-head .hicon { width:30px; height:30px; border-radius:7px; border:1px solid var(--line); margin:0; }
  .mc-label { font-weight:700; font-size:14px; flex:1; min-width:0; text-decoration:underline dotted var(--line); text-underline-offset:4px; }
  .mc-open { color:var(--muted); width:26px; height:26px; border-radius:7px; display:grid; place-items:center; border:1px solid transparent; flex:0 0 auto; }
  .mc-open svg { width:14px; height:14px; }
  .mcard:hover .mc-open { color:var(--accent); border-color:var(--line); background:var(--panel2); }
  .mc-row { display:flex; flex-direction:column; gap:8px; }
  .mcard.wide .mc-row { flex-direction:row; align-items:baseline; gap:18px; flex-wrap:wrap; }
  .mc-val { font-size:24px; font-weight:800; font-family:var(--font-mono); line-height:1.1; letter-spacing:-.02em; font-variant-numeric:tabular-nums; }
  .mc-val small { font-size:12.5px; font-weight:600; color:var(--muted); font-family:-apple-system,Segoe UI,Roboto,sans-serif; letter-spacing:0; margin-left:6px; }
  .mc-val.bad { color:var(--high); } .mc-val.mid { color:var(--medium); } .mc-val.ok { color:var(--good); }
  .mc-foot { display:flex; align-items:center; gap:6px; flex-wrap:wrap; min-height:24px; }
  .mc-who { display:flex; align-items:center; gap:6px; flex-wrap:wrap; font-size:13px; border-top:1px solid var(--line-soft); padding-top:8px; min-height:31px; margin-top:auto; }
  .who { display:inline-flex; align-items:center; gap:6px; font-weight:700; white-space:nowrap; min-width:0; }
  .who .cls { width:18px; height:18px; border-radius:4px; border:1px solid var(--line); }
  .mc-table { border:1px solid var(--line); border-radius:8px; overflow:hidden; }
  .mc-table table.idx td { padding:5px 12px; }
  @media (max-width:560px) { .mcard.wide { grid-column:auto; } }
  /* one-line findings with a foldable body */
  .rlist { display:flex; flex-direction:column; border:1px solid var(--line); border-radius:10px; overflow:hidden; margin:0; padding:0; }
  .rec.rrow-d { border:0; margin:0; padding:0; background:transparent; border-bottom:1px solid var(--line-soft); }
  .rec.rrow-d:last-child { border-bottom:0; }
  .rrow { display:grid; grid-template-columns:78px minmax(0,1fr) auto 118px auto; align-items:center; gap:12px; padding:9px 12px; min-height:52px; cursor:pointer; list-style:none; }
  .rrow::-webkit-details-marker { display:none; }
  .rrow > * { min-width:0; }
  .rrow .t { font-weight:700; font-size:14.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .rrow .ev { display:flex; gap:6px; flex-wrap:wrap; }
  .rrow .ev .badge { max-width:220px; overflow:hidden; text-overflow:ellipsis; }
  .rrow .acts { display:flex; gap:6px; justify-content:flex-end; align-items:center; }
  .rrow .acts .exp-lbl { margin-left:0; }
  .rrow .acts.rec-review { margin:0; padding:0; border:0; flex-wrap:nowrap; }
  .rec.rrow-d[open] > .rrow { background:var(--accent-soft); box-shadow:inset 3px 0 0 var(--accent); }
  .rec.rec-state-rejected { opacity:.62; }
  .rbody { padding:10px 12px 14px 102px; background:color-mix(in srgb, var(--accent-soft) 40%, transparent); box-shadow:inset 3px 0 0 var(--accent); display:flex; flex-direction:column; gap:8px; }
  .rbody p { margin:0; font-size:14px; }
  .rbody .rec-rule { color:var(--muted); }
  .rbody .row-btns { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  .rbody .rec-edit { display:flex; flex-direction:column; gap:6px; }
  .rbody .rec-text { flex:none; width:100%; border-radius:8px; }
  .rec-empty { color:var(--muted); padding:14px; }
  @media (max-width:760px) { .rrow { grid-template-columns:70px minmax(0,1fr) auto; } .rrow .ev, .rrow .st { display:none; } .rbody { padding-left:14px; } }
  /* detail dialogs: tool row, WCL bars with fixed column width */
  dialog.dlg.detail .dlg-body { display:flex; flex-direction:column; gap:12px; padding:16px 20px; }
  dialog.dlg.detail .dlg-body > *, dialog.dlg.detail .dscope > * { flex-shrink:0; }
  dialog.dlg .dlg-head .tile { flex:0 0 auto; }
  .dtools { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .dtools .grow { flex:1 1 auto; }
  .seg.sm { margin:0; }
  .seg.sm .seg-btn { padding:5px 12px; font-size:13.5px; }
  .seg.sm .seg-btn svg { width:16px; height:16px; }
  .field { display:inline-flex; align-items:center; gap:8px; height:36px; border-radius:8px; border:1px solid var(--line); background:var(--panel2); color:var(--muted); padding:0 12px; }
  .field svg { width:16px; height:16px; flex:0 0 auto; }
  .field input { border:0; background:transparent; color:var(--text); font:inherit; font-size:14px; outline:none; width:170px; padding:0; }
  .dsub { font-size:13px; font-weight:800; margin:6px 0 0; display:flex; align-items:center; gap:8px; }
  .dscope { display:flex; flex-direction:column; gap:10px; }
  .tbox { border:1px solid var(--line); border-radius:10px; overflow:auto; }
  .tbox table.idx { margin:0; }
  .tbox table.idx tr:last-child td { border-bottom:0; }
  table.idx.rpb .bar { width:92px; }
  table.idx th[data-tip] { text-decoration:underline dotted; text-decoration-color:var(--muted); text-underline-offset:4px; cursor:default; }
  .badges { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
  /* raider card: three badges, icon buttons in the head, four sections, boxes side by side */
  .raider-card > summary .ibtn { margin-left:2px; }
  .raider-card > summary .exp-lbl { margin-left:6px; }
  .raider-card > summary .vcard-chips { justify-content:flex-start; }
  .cols3 { display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:10px; }
  .box { border:1px solid var(--line); border-radius:10px; overflow:hidden; display:flex; flex-direction:column; min-width:0; }
  .box-head { display:flex; align-items:center; gap:10px; padding:8px 12px; background:var(--panel2); border-bottom:1px solid var(--line); }
  .box-head b { font-size:14px; flex:1; }
  .box-head .hicon { width:20px; height:20px; margin:0; }
  .kv { display:flex; align-items:center; gap:10px; padding:7px 12px; border-bottom:1px solid var(--line-soft); font-size:14px; min-height:40px; }
  .kv:last-child { border-bottom:0; }
  .kv .k { flex:1; display:flex; align-items:center; gap:8px; min-width:0; }
  .kv .k > span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .kv .k .hicon { width:22px; height:22px; margin:0; border-radius:4px; }
  .kv .bar { width:110px; flex:0 0 auto; }
  .kv .iconrow { padding:0; }
  .kv.stack { flex-direction:column; align-items:stretch; }
  .raider-foot .btns { display:flex; gap:8px; flex-wrap:wrap; }
  .raider-tools .field input { width:180px; }
  /* player page */
  .phead { align-items:center; }
  .phead-icon { width:64px; height:64px; border-radius:12px; border:2px solid var(--cc); flex:0 0 auto; }
  .ptitle-cn { color:var(--cc); }
  .page-head .vcard-meta { margin-top:6px; }
  .pgrp { background:var(--panel); border:1px solid var(--line); border-radius:12px; }
  .pgrp > summary { list-style:none; cursor:pointer; padding:8px; }
  .pgrp > summary::-webkit-details-marker { display:none; }
  .pgrp > summary .exp-lbl { margin-left:8px; }
  .pgrp-body { padding:4px 12px 12px; }
  .pfights td .who .hicon { width:30px; height:30px; border-radius:6px; margin:0; }
  .pfights td .bar.b90 { width:90px; }
  .pfights tr[hidden] { display:none; }
  .pstack { display:flex; flex-direction:column; gap:16px; }
  /* send dialog: badges in the head, Discord look */
  .send-item-head .hicon { width:18px; height:18px; margin:0; }
  .dm-head { display:flex; align-items:center; gap:8px; }
  .dm-head .crest { width:26px; height:26px; border-radius:7px; display:grid; place-items:center; background:linear-gradient(150deg, var(--accent), var(--accent-2)); color:var(--accent-ink); }
  .dm-head .crest svg { width:15px; height:15px; }
  .dm { border-left-color:#5865F2; }
  .dm a { color:var(--accent); text-decoration:none; display:inline-flex; align-items:center; gap:4px; }
  .dm a svg { width:13px; height:13px; }
  /* icon tiles: an icon on a tinted square, the colour is the area's tone */
  .tile { width:34px; height:34px; border-radius:9px; display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto; background:var(--accent-soft); }
  .tile .hicon { width:22px; height:22px; margin:0; }
  .tile.bad { background:var(--high-bg); } .tile.mid { background:var(--medium-bg); } .tile.ok { background:var(--good-bg); } .tile.none { background:var(--panel2); }
  .tile.cls { background:color-mix(in srgb, var(--cc) 18%, transparent); }
  .tile.cls .hicon { border-radius:6px; }
  /* boss tabs of a raider's own timeline (the Kampfverlauf dialog of the raider card) */
  .boss-tabs { display:flex; flex-wrap:wrap; gap:8px; margin:0 0 14px; }
  .boss-tab { display:inline-flex; align-items:center; gap:10px; padding:8px 16px 8px 8px; border:1px solid var(--line); border-radius:10px; background:var(--panel); color:var(--muted); font:inherit; font-size:15px; font-weight:600; cursor:pointer; }
  .boss-tab img { width:36px; height:36px; border-radius:6px; border:1px solid var(--line); display:block; }
  .boss-tab:hover { color:var(--text); border-color:var(--muted); }
  .boss-tab.active { color:var(--text); border-color:var(--accent); background:var(--accent-soft); }
  .boss-tries { font-size:12px; font-weight:600; padding:2px 8px; border-radius:10px; background:var(--panel2); color:var(--muted); font-family:var(--font-mono); }
  .boss-tab.active .boss-kill { background:var(--good-bg); color:var(--good); }
  .boss-tab.active .boss-wipe { background:var(--high-bg); color:var(--high); }
  .rec-text { font:inherit; font-size:14px; padding:8px 10px; background:var(--panel); color:var(--text); border:1px solid var(--line); resize:vertical; }
  .badge.ev-b { font-weight:500; }
  .badge.ev-b b { color:var(--text); font-weight:700; }
  .slot-badge { display:grid; place-items:center; }
  .slot-badge svg { width:11px; height:11px; }
  .dscope .tview-a { display:none; }
  .dscope.va .tview-p { display:none; }
  .dscope.va .tview-a { display:block; }
`;

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
        name = `<a class="item" href="${esc(wowheadItemLink(issue.itemId))}" target="_blank" rel="noopener">${icon}<span>${esc(issue.itemName)}</span></a>`;
    } else {
        name = `<span class="item">${icon}<span>${esc(issue.itemName)}</span></span>`;
    }
    return `<li>${name}<span class="${tagClass(issue.severity)}">${esc(issue.label)}</span></li>`;
}

function nameInner(p) {
    const color = CLASS_COLORS[p.type] || "#ddd";
    // no tooltip on the class icon: the class already shows in the icon and in the
    // name's colour, and a box popping up on every row hover is pure noise
    return `<img src="${esc(classIconUrl(p.type))}" alt="${esc(p.type)}"><span style="color:${color};font-weight:700">${esc(p.name)}</span>`;
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
        <img class="classicon" src="${esc(classIconUrl(p.type))}" alt="${esc(p.type)}" data-tip="${esc(p.type)}">
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

const CHEV_SVG = "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M6 9l6 6 6-6\"/></svg>";

/** The expand control of a <summary>: "Details" and a round chevron button; the CSS turns and fills it when the details are open. */
function expBtn() {
    return `<span class="exp-lbl"><span class="exp-w">Details</span><span class="exp">${CHEV_SVG}</span></span>`;
}

/** An icon on a tinted tile; the tone (ok / mid / bad / none / cls) is the area's colour. */
function tile(icon, tone) {
    return `<span class="tile${tone ? ` ${tone}` : ""}">${hicon(icon, "")}</span>`;
}

/** A badge: a word, optionally an icon, a tone (ok / mid / bad / accent) and `count` for the round counter form. */
function badge(text, tone, icon, count) {
    return `<span class="badge${tone ? ` ${tone}` : ""}${count ? " count" : ""}">${icon ? hicon(icon, "") : ""}${esc(text)}</span>`;
}

// ---- line icons: only for pure UI functions (close, search, external, back, expand, verdicts, orientation) ----
const svgLine = (d, w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const LINE = {
    check: svgLine("<path d=\"m5 12 5 5 9-10\"/>", 2.4),
    ban: svgLine("<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"m5.7 5.7 12.6 12.6\"/>"),
    pencil: svgLine("<path d=\"M12 20h9\"/><path d=\"M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z\"/>"),
    close: svgLine("<path d=\"M6 6l12 12M18 6 6 18\"/>", 2.2),
    search: svgLine("<circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"m20 20-3.5-3.5\"/>"),
    external: svgLine("<path d=\"M14 3h7v7M21 3l-9 9\"/><path d=\"M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5\"/>"),
    back: svgLine("<path d=\"M19 12H5M11 18l-6-6 6-6\"/>"),
    expand: svgLine("<path d=\"M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7\"/>"),
    undo: svgLine("<path d=\"M9 14 4 9l5-5\"/><path d=\"M4 9h11a5 5 0 0 1 0 10h-3\"/>"),
    rows: svgLine("<path d=\"M3 6h18M3 12h18M3 18h18\"/>"),
    cols: svgLine("<path d=\"M6 3v18M12 3v18M18 3v18\"/>"),
    expandAll: svgLine("<path d=\"m7 8 5 5 5-5M7 14l5 5 5-5\"/>"),
    collapseAll: svgLine("<path d=\"m7 16 5-5 5 5M7 10l5-5 5 5\"/>"),
};

/** A square icon button (32 px) with the page's tooltip; `tone` ok / bad marks an active verdict. */
function ibtn(inner, tip, sub, attrs = "", tone = "") {
    return `<button type="button" class="ibtn${tone ? ` ${tone}` : ""}" data-tip="${esc(tip)}"${sub ? ` data-tip-sub="${esc(sub)}"` : ""} aria-label="${esc(tip)}"${attrs ? ` ${attrs}` : ""}>${inner}</button>`;
}

// The armory of a raider, where the page's own gear numbers can be checked.
// What the report shows is the gear the log SAW on that night — the armory is
// what the character wears now, which is exactly the question anyone asks when
// a gear finding looks wrong. "" when no armory template is configured
// (web/charLinks.js), so a guild without one simply gets no button.
const ARMORY_TIP = "Armory öffnen";
const ARMORY_SUB = "Der Charakter, wie er jetzt aussieht. Der Report zeigt die Ausrüstung aus dem Log dieses Abends.";

/** The armory as an icon button, for a card head. */
function armoryButton(character) {
    const url = armoryUrlFor(character);
    if (!url) return "";
    return `<a class="ibtn" href="${esc(url)}" target="_blank" rel="noopener" data-tip="${esc(ARMORY_TIP)}" data-tip-sub="${esc(ARMORY_SUB)}" aria-label="${esc(ARMORY_TIP)}">${hicon("inv_shirt_guildtabard_01", "")}</a>`;
}

/** The armory as a labelled link, for a page head. */
function armoryLink(character, cls) {
    const url = armoryUrlFor(character);
    if (!url) return "";
    return `<a class="${esc(cls)}" href="${esc(url)}" target="_blank" rel="noopener" data-tip="${esc(ARMORY_TIP)}" data-tip-sub="${esc(ARMORY_SUB)}">${hicon("inv_shirt_guildtabard_01", "")}Armory</a>`;
}

/** The close button of a dialog head. */
function dlgClose() {
    // no tooltip: the dialog focuses this button on open, and a box popping up there is noise
    return `<button type="button" class="ibtn" data-close aria-label="Schließen">${LINE.close}</button>`;
}

/**
 * The shared area head (Bereichskopf): a tinted band with the icon tile in the
 * area's tone, the title, the breadcrumb under it and at most one action on
 * the right (a button or a count badge).
 */
function groupHead(icon, tone, title, crumb, action) {
    return `<div class="part-head gh">${tile(icon, tone)}<div class="gh-title"><b>${title}</b>${crumb ? `<span class="kicker">${esc(crumb)}</span>` : ""}</div><span class="grow"></span>${action || ""}</div>`;
}

/**
 * A detail modal after the pattern of chartDialog: head with tile, title and
 * breadcrumb, the body, a foot with only "Schließen". Opened by any
 * [data-dialog="dlg-<id>"] through DIALOG_SCRIPT.
 */
function detailDialog(id, icon, tone, title, crumb, bodyHtml, footNote) {
    return `<dialog class="dlg detail" id="dlg-${esc(id)}">
      <div class="dlg-head">${tile(icon, tone)}<div class="dlg-main"><div class="dlg-title">${title}</div>${crumb ? `<div class="kicker">${esc(crumb)}</div>` : ""}</div>${dlgClose()}</div>
      <div class="dlg-body">${bodyHtml}</div>
      <div class="dlg-foot"><span class="note">${footNote ? esc(footNote) : ""}</span><div class="btns"><button type="button" class="btn btn-sm" data-close>Schließen</button></div></div>
    </dialog>`;
}

/** "Auffällig" names: up to three raiders in class colour, an optional value after each, "+n" for the rest. */
function whoList(label, list, valueOf) {
    if (!list || !list.length) return "";
    const shown = list.slice(0, 3).map((p) => `<span class="who"><img class="cls" src="${esc(classIconUrl(p.type))}" alt=""><span class="cn" style="--cc:${esc(classColorOf(p.type) || "var(--text)")}">${esc(p.name)}</span></span>${valueOf ? `<span class="mono mute">${esc(valueOf(p))}</span>` : ""}`).join("");
    const more = list.length > 3 ? `<span class="mute">+${list.length - 3}</span>` : "";
    return `<div class="mc-who"><span class="kicker">${esc(label)}</span>${shown}${more}</div>`;
}

/** The same line for things that are not raiders (bosses, trash). */
function whatList(label, names) {
    if (!names || !names.length) return "";
    return `<div class="mc-who"><span class="kicker">${esc(label)}</span><span>${esc(names.slice(0, 3).join(", "))}${names.length > 3 ? ` +${names.length - 3}` : ""}</span></div>`;
}

/**
 * A metric card (Kennzahl-Kachel): WoW icon, title with the explanation in the
 * tooltip, one big value, one or two badges and the "Auffällig" line. The whole
 * card opens its detail dialog.
 */
function metricCard({ id, icon, label, value, unit, tone, badges, who, tip, extra, wide }) {
    return `<div class="mcard${wide ? " wide" : ""}" id="rs-${esc(id)}" role="button" tabindex="0" data-dialog="dlg-rs-${esc(id)}">
      <div class="mc-head">${hicon(icon, "")}<span class="mc-label" data-tip="${esc(label)}"${tip ? ` data-tip-sub="${esc(tip)}"` : ""}>${esc(label)}</span><span class="mc-open">${LINE.expand}</span></div>
      <div class="mc-row"><div class="mc-val${tone ? ` ${tone}` : ""}">${esc(value)}${unit ? `<small>${esc(unit)}</small>` : ""}</div><div class="mc-foot">${(badges || []).join("")}</div></div>
      ${extra || ""}${who || ""}
    </div>`;
}

/**
 * A WCL-style bar cell: the number on a bar whose length is `pct` (0–100) —
 * its share of the column's maximum, so the eye reads the ranking without
 * comparing digits. `tone` colours the bar and the number (good / medium /
 * high), `tip`/`sub` feed the page's tooltip box.
 */
function barCell(text, pct, tone, tip, sub) {
    const w = Math.max(0, Math.min(100, Number(pct) || 0));
    const t = tip ? ` data-tip="${esc(tip)}"${sub ? ` data-tip-sub="${esc(sub)}"` : ""}` : "";
    const cls = tone ? ` class="${esc(tone)}"` : "";
    return `<span class="bar"${t}><i${cls} style="width:${w.toFixed(0)}%"></i><b${cls}>${esc(text)}</b></span>`;
}

/**
 * Healing and overheal in one bar, the way Warcraft Logs draws it: the solid
 * part is what landed, the hatched part what went over full health, and the
 * whole bar is the row's share of `max` (the largest healing + overheal in
 * the column). The effective amount sits on the left, the overheal share on
 * the right, toned from 35 % (medium) and 50 % (high).
 */
function healBar(total, overheal, max, pct, tip, sub) {
    const t = Math.max(0, Number(total) || 0);
    const o = Math.max(0, Number(overheal) || 0);
    const m = Math.max(1, Number(max) || 0);
    const a = Math.min(100, (t / m) * 100);
    const b = Math.min(100 - a, (o / m) * 100);
    const tone = pct >= 50 ? "high" : pct >= 35 ? "medium" : "";
    const tipAttr = tip ? ` data-tip="${esc(tip)}"${sub ? ` data-tip-sub="${esc(sub)}"` : ""}` : "";
    return `<span class="bar bar-heal"${tipAttr}><i class="main" style="width:${a.toFixed(0)}%"></i><i class="over" style="left:${a.toFixed(0)}%;width:${b.toFixed(0)}%"></i><b>${esc(fmtK(t))}</b><em class="${tone}">${esc(pct)} %</em></span>`;
}

const HEAL_BAR_HOW = "Der gestreifte Teil ging über volle Lebenspunkte (Overheal). Der ganze Balken ist der Anteil am größten Wert der Spalte, Heilung und Overheal zusammen.";

/** A percentage as a bar of its own length, toned like the fight charts (pctTone). */
function barPct(v, tip, sub) {
    return barCell(`${v} %`, v, pctTone(v), tip, sub);
}

function yesNo(v) {
    return v ? "<span class=\"pct pct-full\">ja</span>" : "<span class=\"pct pct-none\">nein</span>";
}

// small inline icon for table headers / labels
function hicon(icon, title) {
    if (!icon) return "";
    const tip = title ? ` data-tip="${esc(title)}"` : "";
    return `<img class="hicon" src="${esc(iconUrl(icon))}" alt=""${tip}>`;
}
function colHead(icon, label) {
    return `${hicon(icon, "")}<span>${esc(label)}</span>`;
}

// --- icon tiles + nested tabs (shared by the RPB panels) ------------------

/**
 * Config name -> icon, built once from the generated RPB reference data.
 *
 * Reports saved before icons were recorded carry none on their rows, but they do
 * carry the config's own `name`. Looking the icon up here means those older
 * reports show real icons too, without having to be evaluated again.
 */
const ICON_BY_NAME = (() => {
    const map = {};
    const add = (list) => {
        for (const e of list || []) if (e && e.name && e.icon && !map[e.name]) map[e.name] = e.icon;
    };
    for (const key of ["DAMAGE_TAKEN", "DEBUFFS", "TRINKETS_AND_RACIALS", "ENGINEERING", "OTHER_CASTS", "ABSORBS"]) {
        add(rpbData[key]);
    }
    for (const key of ["SINGLE_TARGET_CASTS", "AOE_CASTS", "CLASS_COOLDOWNS"]) {
        for (const list of Object.values(rpbData[key] || {})) add(list);
    }
    return map;
})();

/** Wowhead target for a tracked thing — item pages win over spell pages. */
function wowheadHref(o) {
    if (o.itemId) return wowheadItemLink(o.itemId);
    if (o.spellId) return `https://www.wowhead.com/tbc/spell=${o.spellId}`;
    return "";
}

/**
 * One square icon with an optional count badge. Links to Wowhead when the id is
 * known, so hovering gives the authoritative tooltip instead of our own label.
 * @param {object} o { icon, label, count, itemId, spellId, tone, note }
 */
function iconTile(o) {
    const icon = o.icon || ICON_BY_NAME[o.name] || "";
    const hasCount = o.count !== undefined && o.count !== null;
    const head = hasCount ? `${o.label} ×${o.count}` : o.label;
    const badge = hasCount ? `<span class="n">${esc(o.count)}</span>` : "";
    const href = wowheadHref(o);
    // Wowhead's power.js would attach a second tooltip to these links; its own
    // opt-out attribute keeps the link clickable but leaves the hover to us, since
    // only we know the cast count and the downrank note.
    const tip = ` data-tip="${esc(head)}"${o.note ? ` data-tip-sub="${esc(o.note)}"` : ""} data-disable-wowhead-tooltip="true"`;
    // Nothing resolved at all — the label reads better than a question mark.
    if (!icon) {
        const cls = `ipill${o.tone ? ` ${o.tone}` : ""}`;
        const inner = `<span>${esc(o.label)}</span>${badge}`;
        return href
            ? `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener"${tip}>${inner}</a>`
            : `<span class="${cls}"${tip}>${inner}</span>`;
    }
    const img = `<img src="${esc(iconUrl(icon))}" loading="lazy" alt="">`;
    const cls = `itile${o.tone ? ` ${o.tone}` : ""}`;
    return href
        ? `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener"${tip}>${img}${badge}</a>`
        : `<span class="${cls}"${tip}>${img}${badge}</span>`;
}

/** A wrapping row of icon tiles, or an em dash when there is nothing to show. */
function iconRow(tiles) {
    if (!tiles.length) return "<span class=\"sritems\">–</span>";
    return `<div class="iconrow">${tiles.join("")}</div>`;
}

// A theme-toggle button. The shared script (below) paints its icon and wires the click.
function themeToggleBtn() {
    return "<button class=\"theme-toggle\" id=\"themeBtn\" type=\"button\" aria-label=\"Design umschalten\" data-tip=\"Hell / Dunkel umschalten\"></button>";
}

/**
 * Full HTML page shell. Shared by the log-check pages and the admin chrome so both
 * get the same tokens + light/dark theming.
 * @param {object} opts { bare, extraStyle } — bare:true drops the centered .wrap +
 *   footer so a page (e.g. the admin sidebar chrome from adminChrome.js) can supply
 *   its own outer structure; extraStyle appends CSS to the page's style block.
 */
function layout(title, body, opts = {}) {
    const bare = !!opts.bare;
    const inner = bare
        ? body
        : `<div class="wrap">
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
    --accent:#8a7cff; --accent-2:#35d6c4; --accent-soft:rgba(138,124,255,.16); --accent-ink:#130f26;
    --portrait-1:#1a1d24; --portrait-2:#14161b;
    --font-mono: ui-monospace, "Cascadia Code", Consolas, "SFMono-Regular", Menlo, monospace;
    color-scheme: light dark;
    /* ---- "Spektrum" area accents: one hue per admin section (nav icons, dashboard tiles) ---- */
    --area-recruitment:#34d399; --area-recruitment-soft:rgba(52,211,153,.16);
    --area-cla:#ff8a65; --area-cla-soft:rgba(255,138,101,.16);
    --area-history:#f472b6; --area-history-soft:rgba(244,114,182,.16);
    --area-channels:#4dd0c8; --area-channels-soft:rgba(77,208,200,.16);
    --area-settings:#b083f0; --area-settings-soft:rgba(176,131,240,.16);
    --area-home:#8a7cff; --area-home-soft:rgba(138,124,255,.16);
    --area-profile:#38bdf8; --area-profile-soft:rgba(56,189,248,.16);
    --area-signups:#4ade80; --area-signups-soft:rgba(74,222,128,.16);
    --area-raids:#60a5fa; --area-raids-soft:rgba(96,165,250,.16);
    --area-roster:#a3e635; --area-roster-soft:rgba(163,230,53,.16);
    --area-lootcouncil:#e879f9; --area-lootcouncil-soft:rgba(232,121,249,.16);
  }
  @media (prefers-color-scheme: light) {
    :root:not([data-theme="dark"]) {
      --bg:#f2f4f8; --panel:#ffffff; --panel2:#eef1f6; --panel3:#e2e6ee;
      --text:#1b1e27; --muted:#5b616e; --line:#dde1eb; --line-soft:#e8ebf2;
      --high:#cf3b37; --high-bg:rgba(207,59,55,.12);
      --medium:#9a6c12; --medium-bg:rgba(154,108,18,.14);
      --good:#2b9440; --good-bg:rgba(43,148,64,.12);
      --accent:#6a4fe0; --accent-2:#0f8f82; --accent-soft:rgba(106,79,224,.10); --accent-ink:#ffffff;
      --portrait-1:#e9edf4; --portrait-2:#dce2ec;
      --area-recruitment:#1f9d6c; --area-recruitment-soft:rgba(31,157,108,.12);
      --area-cla:#d95f39; --area-cla-soft:rgba(217,95,57,.12);
      --area-history:#c23f8f; --area-history-soft:rgba(194,63,143,.12);
      --area-channels:#1f978c; --area-channels-soft:rgba(31,151,140,.12);
      --area-settings:#7c4fd6; --area-settings-soft:rgba(124,79,214,.12);
      --area-home:#6a4fe0; --area-home-soft:rgba(106,79,224,.12);
      --area-profile:#0e7fb8; --area-profile-soft:rgba(14,127,184,.12);
      --area-signups:#16a34a; --area-signups-soft:rgba(22,163,74,.12);
      --area-raids:#2563c9; --area-raids-soft:rgba(37,99,201,.12);
      --area-roster:#5f8f12; --area-roster-soft:rgba(95,143,18,.12);
      --area-lootcouncil:#b03cc0; --area-lootcouncil-soft:rgba(176,60,192,.12);
    }
  }
  :root[data-theme="light"] {
    --bg:#f2f4f8; --panel:#ffffff; --panel2:#eef1f6; --panel3:#e2e6ee;
    --text:#1b1e27; --muted:#5b616e; --line:#dde1eb; --line-soft:#e8ebf2;
    --high:#cf3b37; --high-bg:rgba(207,59,55,.12);
    --medium:#9a6c12; --medium-bg:rgba(154,108,18,.14);
    --good:#2b9440; --good-bg:rgba(43,148,64,.12);
    --accent:#6a4fe0; --accent-2:#0f8f82; --accent-soft:rgba(106,79,224,.10); --accent-ink:#ffffff;
    --portrait-1:#e9edf4; --portrait-2:#dce2ec;
    --area-recruitment:#1f9d6c; --area-recruitment-soft:rgba(31,157,108,.12);
    --area-cla:#d95f39; --area-cla-soft:rgba(217,95,57,.12);
    --area-history:#c23f8f; --area-history-soft:rgba(194,63,143,.12);
    --area-channels:#1f978c; --area-channels-soft:rgba(31,151,140,.12);
    --area-settings:#7c4fd6; --area-settings-soft:rgba(124,79,214,.12);
    --area-home:#6a4fe0; --area-home-soft:rgba(106,79,224,.12);
    --area-profile:#0e7fb8; --area-profile-soft:rgba(14,127,184,.12);
    --area-signups:#16a34a; --area-signups-soft:rgba(22,163,74,.12);
    --area-raids:#2563c9; --area-raids-soft:rgba(37,99,201,.12);
    --area-roster:#5f8f12; --area-roster-soft:rgba(95,143,18,.12);
    --area-lootcouncil:#b03cc0; --area-lootcouncil-soft:rgba(176,60,192,.12);
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; transition:background .2s, color .2s; }
  a { color:inherit; }
  .wrap { max-width:1100px; margin:0 auto; padding:20px 16px 64px; }
  h1 { font-size:22px; margin:0 0 4px; }
  h2 { font-size:18px; margin:24px 0 12px; }
  .sub { color:var(--muted); margin:0 0 16px; font-size:14px; }
  .sub a { color:var(--accent); text-decoration:none; }
  a.mlink { color:var(--accent); text-decoration:none; }
  a.mlink:hover { text-decoration:underline; }
  /* page head + buttons (same vocabulary as the React admin's .page-title/.btn) */
  .page-head { display:flex; align-items:flex-start; gap:16px; flex-wrap:wrap; margin:0 0 18px; }
  .page-head-main { min-width:0; flex:1; }
  .page-title { font-size:24px; font-weight:800; letter-spacing:-.3px; margin:0 0 8px; }
  .page-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .btn { display:inline-flex; align-items:center; gap:7px; background:var(--accent); color:var(--accent-ink); border:0; border-radius:8px;
    padding:9px 18px; font-weight:700; font-size:14px; cursor:pointer; text-decoration:none;
    transition:filter .15s ease, box-shadow .2s ease, transform .1s ease; }
  .btn:hover { filter:brightness(1.08); box-shadow:0 4px 22px -6px var(--accent); transform:translateY(-1px); }
  .btn-ghost { background:var(--panel2); color:var(--text); border:1px solid var(--line); }
  .btn-ghost:hover { filter:none; background:var(--panel3); border-color:var(--accent); box-shadow:none; }
  .btn-sm { padding:6px 12px; font-size:13px; }
  /* theme toggle */
  .theme-toggle { width:36px; height:36px; display:inline-grid; place-items:center; padding:0; border-radius:8px; border:1px solid var(--line); background:var(--panel2); color:var(--muted); cursor:pointer; transition:color .12s, border-color .12s; }
  .theme-toggle:hover { color:var(--text); border-color:var(--muted); }
  .theme-toggle svg { width:17px; height:17px; }
  /* public top bar (anonymous/non-admin visitors; admins get the sidebar chrome) */
  .pubbar { display:flex; align-items:center; gap:12px; padding:12px 0 16px; margin-bottom:6px; border-bottom:1px solid var(--line); flex-wrap:wrap; }
  .pubbar .crest { width:36px; height:36px; border-radius:9px; flex:0 0 auto; display:grid; place-items:center;
    background:linear-gradient(150deg, var(--accent), var(--accent-2)); color:var(--accent-ink); }
  .pubbar .crest svg { width:20px; height:20px; }
  .pubbar-name { font-weight:800; font-size:15px; line-height:1.15; }
  .pubbar-sub { font-size:10.5px; font-family:var(--font-mono); color:var(--muted); text-transform:uppercase; letter-spacing:1.2px; }
  .pubbar-actions { margin-left:auto; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  /* masonry-style columns: short cards fill the vertical space, no row gaps */
  .grid { column-width:330px; column-gap:14px; }
  .grid .card { break-inside:avoid; -webkit-column-break-inside:avoid; margin:0 0 14px; }
  .card { background:var(--panel); border:1px solid var(--line); overflow:hidden; border-left:3px solid var(--line);
    clip-path:polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%); transition:border-color .15s ease, box-shadow .15s ease; }
  .card:hover { box-shadow:0 10px 26px -18px #000; }
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
  .count { background:var(--high-bg); color:var(--high); font-weight:700; border-radius:12px; padding:1px 9px; font-size:13px;
    font-family:var(--font-mono); font-variant-numeric:tabular-nums; }
  .card.sev-ok .count { background:var(--good-bg); color:var(--good); }
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
  .pct { font-weight:700; border-radius:6px; padding:1px 8px; font-size:13px; display:inline-block; min-width:46px; text-align:center;
    font-family:var(--font-mono); font-variant-numeric:tabular-nums; }
  .pct-full { background:var(--good-bg); color:var(--good); }
  .pct-part { background:var(--medium-bg); color:var(--medium); }
  .pct-none { background:var(--high-bg); color:var(--high); }
  .pct-na { background:transparent; color:var(--muted); font-weight:500; }
  .pct-wrong { background:transparent; color:var(--high); border:1px dashed var(--high); }
  .buff-matrix th.bh { text-align:center; padding:6px 4px; }
  .buff-matrix th.bh .hicon { width:22px; height:22px; margin:0; }
  .buff-matrix td.bc { text-align:center; padding:6px 4px; }
  .buff-matrix tr.cov td { border-bottom:2px solid var(--line); }
  .debuff-matrix th.bh { vertical-align:bottom; min-width:96px; }
  .debuff-matrix th.bh img { width:28px; height:28px; border-radius:6px; display:block; margin:0 auto 4px; }
  .debuff-matrix th.bh .boss-name, .debuff-matrix th.bh .sritems { display:block; }
  .debuff-matrix td.bc .sritems { font-size:11px; margin-top:2px; }
  .debuff-matrix td.dn, table.idx td.dn { white-space:nowrap; }
  .buff-list .tag { display:inline-flex; align-items:center; gap:4px; margin:2px 4px 2px 0; }
  .buff-list .tag .hicon { width:16px; height:16px; margin:0; }
  .pname-cell { display:inline-flex; align-items:center; gap:8px; text-decoration:none; }
  .pname-cell img { width:20px; height:20px; border-radius:4px; }
  .srval { font-weight:700; font-family:var(--font-mono); font-variant-numeric:tabular-nums; }
  .sritems { color:var(--muted); font-size:12.5px; }
  .sritems a, a.pname-cell:hover span { text-decoration:underline; }
  .note { color:var(--muted); font-size:12.5px; margin:-6px 0 12px; }
  .scrollx { overflow-x:auto; }
  /* ---- RPB panels: one shared geometry so every table lines up ---- */
  table.idx.rpb th { white-space:nowrap; vertical-align:bottom; }
  table.idx.rpb td.n, table.idx.rpb th.n { text-align:right; font-family:var(--font-mono); font-variant-numeric:tabular-nums; white-space:nowrap; }
  /* the player column stays put while the ability columns scroll */
  table.idx.rpb th.pcol, table.idx.rpb td.pcol { position:sticky; left:0; z-index:2; background:var(--panel);
    width:200px; min-width:200px; max-width:200px; overflow:hidden; text-overflow:ellipsis; }
  table.idx.rpb th.pcol { background:var(--panel2); }
  table.idx.rpb tr:hover td.pcol { background:var(--panel2); }
  /* Numeric tables get a fixed geometry, so a role with two raiders looks exactly
     like one with twelve instead of stretching its few columns across the page. */
  table.idx.rpb.fixed { table-layout:fixed; width:auto; }
  table.idx.rpb.fixed th.n, table.idx.rpb.fixed td.n { width:106px; }
  table.idx.rpb.fixed td { height:42px; }
  table.idx.rpb.fixed th { height:54px; }
  /* transposed view: one column per raider */
  th.rcol { width:96px; min-width:96px; text-align:center; }
  th.rcol .rcol-in { display:flex; flex-direction:column; align-items:center; gap:3px; }
  th.rcol img { width:22px; height:22px; border-radius:4px; }
  th.rcol span { font-size:11px; font-weight:600; max-width:72px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:block; }
  /* icon tiles (trinkets, cooldowns, spells) */
  .iconrow { display:flex; flex-wrap:wrap; gap:8px 9px; align-items:flex-start; padding:2px 0 4px; }
  .itile { position:relative; width:34px; height:34px; flex:0 0 auto; border-radius:7px; border:1px solid var(--line);
    display:block; line-height:0; text-decoration:none; transition:transform .12s ease, border-color .12s ease; }
  .itile img { width:100%; height:100%; display:block; border-radius:6px; }
  .itile:hover { transform:translateY(-2px); border-color:var(--accent); }
  .itile .n { position:absolute; right:-5px; bottom:-6px; min-width:17px; padding:0 4px; border-radius:9px;
    background:var(--panel3); border:1px solid var(--line); color:var(--text);
    font:700 11px/15px var(--font-mono); font-variant-numeric:tabular-nums; text-align:center; }
  .itile.warn { border-color:var(--high); box-shadow:0 0 0 1px var(--high-bg); }
  .itile.warn .n { background:var(--high); border-color:var(--high); color:#fff; }
  .itile.good .n { background:var(--good-bg); color:var(--good); border-color:var(--good-bg); }
  /* fallback for rows with no icon at all (reports saved before icons existed) */
  .ipill { display:inline-flex; align-items:center; gap:6px; padding:3px 9px; border-radius:7px; border:1px solid var(--line);
    background:var(--panel2); color:var(--text); font-size:12.5px; text-decoration:none; max-width:200px; }
  .ipill > span:first-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .ipill .n { font:700 11px/15px var(--font-mono); font-variant-numeric:tabular-nums; color:var(--muted); }
  .ipill.warn { border-color:var(--high); color:var(--high); }
  .ipill:hover { border-color:var(--accent); }
  /* custom tooltip — the native title box is slow to appear and cannot be styled */
  #tip { position:fixed; z-index:9999; pointer-events:none; opacity:0; transform:translateY(5px); max-width:330px;
    background:var(--panel); color:var(--text); border:1px solid var(--line); border-left:3px solid var(--accent);
    padding:8px 12px; font-size:12.5px; line-height:1.45; box-shadow:0 14px 38px -12px rgba(0,0,0,.65);
    clip-path:polygon(0 0, calc(100% - 9px) 0, 100% 9px, 100% 100%, 0 100%);
    transition:opacity .11s ease, transform .11s ease; }
  #tip.on { opacity:1; transform:translateY(0); }
  #tip b { display:block; font-size:13.5px; margin-bottom:3px; }
  #tip i { display:block; font-style:normal; color:var(--muted); }
  @media (prefers-reduced-motion: reduce) { #tip { transition:none; } }
  #tip i + i { margin-top:4px; }
  .stat[data-tip] .kicker, .kpi[data-tip] .kicker { text-decoration:underline dotted; text-decoration-color:var(--line); text-underline-offset:3px; }
  .chip[data-tip], .stat[data-tip], .kpi[data-tip] { cursor:default; }
  /* WCL-style bar cells: the number on a bar whose length is its share of the column's maximum */
  /* every bar has the same fixed width, whatever the neighbouring columns hold: a shorter spell name must not make a longer bar */
  .bar { position:relative; display:block; width:120px; height:24px; border-radius:5px; overflow:hidden; background:var(--panel2); }
  .bar i { position:absolute; left:0; top:0; bottom:0; background:var(--accent-soft); border-right:2px solid var(--accent); }
  .bar i.good { background:var(--good-bg); border-right-color:var(--good); }
  .bar i.medium { background:var(--medium-bg); border-right-color:var(--medium); }
  .bar i.high { background:var(--high-bg); border-right-color:var(--high); }
  .bar b { position:relative; display:block; padding:0 8px; line-height:24px; font-weight:600; font-size:13px; font-family:var(--font-mono); font-variant-numeric:tabular-nums; white-space:nowrap; }
  .bar b.high { color:var(--high); } .bar b.medium { color:var(--medium); }
  table.idx td:has(> .bar) { padding-top:5px; padding-bottom:5px; }
  /* healing + overheal in one bar: the solid part landed, the hatched part went over full health */
  .bar-heal { width:260px; }
  .bar i.over { background:repeating-linear-gradient(135deg, var(--high-bg) 0 4px, transparent 4px 8px); border-right:2px solid var(--high); }
  .bar em { position:absolute; right:8px; top:0; line-height:24px; font-size:12px; font-style:normal; font-family:var(--font-mono); font-variant-numeric:tabular-nums; color:var(--muted); }
  .bar em.high { color:var(--high); } .bar em.medium { color:var(--medium); }
  table.idx td.rank { width:28px; padding-right:0; color:var(--muted); font-family:var(--font-mono); font-size:12px; text-align:right; }
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
  .chips { display:flex; flex-wrap:wrap; gap:8px; }
  .chip { background:var(--panel2); border:1px solid var(--line); border-radius:20px; padding:3px 11px; font-size:13px; display:inline-flex; align-items:center; gap:2px; }
  .chip b { margin-right:4px; font-family:var(--font-mono); font-variant-numeric:tabular-nums; }
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
  .ilvl-badge b { font-size:30px; font-weight:800; line-height:1; font-family:var(--font-mono); font-variant-numeric:tabular-nums; }
  .ilvl-badge span { color:var(--muted); font-size:11px; margin-top:3px; font-family:var(--font-mono); text-transform:uppercase; letter-spacing:.05em; }
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
  .slot-badge { position:absolute; right:-4px; bottom:-4px; width:17px; height:17px; border-radius:50%; font-size:11px; line-height:17px; text-align:center; font-weight:800; color:#fff; border:1px solid #0008; }
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
  /* fight timeline (Kampfverlauf): boss tabs → try pills → topic switch */
  [hidden] { display:none !important; }
  .try-pills { display:flex; flex-wrap:wrap; gap:8px; margin:0 0 14px; }
  .try-pill { display:inline-flex; align-items:center; gap:8px; padding:8px 14px; border:1px solid var(--line); background:var(--panel2); color:var(--muted); font:inherit; font-size:14px; font-weight:600; cursor:pointer; }
  .try-pill .s { font-size:12px; font-weight:500; font-family:var(--font-mono); }
  .try-pill:hover { color:var(--text); border-color:var(--muted); }
  .try-pill.active { color:var(--accent-ink); background:var(--accent); border-color:var(--accent); }
  .try-pill.active .s { color:var(--accent-ink); opacity:.85; }
  .fight { background:var(--panel); border:1px solid var(--line); border-left:3px solid var(--accent); padding:16px 18px 18px; }
  .fight.fight-wipe { border-left-color:var(--high); }
  .fight-head { display:flex; align-items:baseline; gap:14px; flex-wrap:wrap; margin:0 0 14px; }
  .fight-head h3 { margin:0; font-size:22px; font-weight:700; }
  .fight-head .meta { color:var(--muted); font-size:14px; font-family:var(--font-mono); }
  .fight-series { margin:0 0 16px; padding:0 0 12px; border-bottom:1px solid var(--line); }
  .seg { display:inline-flex; border:1px solid var(--line); background:var(--panel2); margin:0 0 14px; }
  .seg-btn { padding:10px 18px; border:0; border-right:1px solid var(--line); background:transparent; color:var(--muted); font:inherit; font-size:15px; font-weight:600; cursor:pointer; }
  .seg-btn:last-child { border-right:0; }
  .seg-btn:hover { color:var(--text); }
  .seg-btn.active { background:var(--panel); color:var(--text); box-shadow:inset 0 -3px 0 var(--accent-2); }
  .seg-btn .n { margin-left:8px; font-size:12px; color:var(--muted); font-family:var(--font-mono); }
  .fight-deaths { margin:0; padding:0; list-style:none; font-size:15px; }
  .fight-deaths li { padding:6px 0; border-bottom:1px solid var(--line-soft); display:flex; align-items:center; gap:10px; }
  .fight-deaths b { font-family:var(--font-mono); font-variant-numeric:tabular-nums; }
  .fight-deaths .cn { color:var(--cc); font-weight:600; }
  @media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) .fight-deaths .cn { color:color-mix(in srgb, var(--cc) 70%, #000); } }
  :root[data-theme="light"] .fight-deaths .cn { color:color-mix(in srgb, var(--cc) 70%, #000); }
  /* Heilung: one block per healer in the fight, the Heiler tab's table */
  .heal-block { margin:0 0 18px; padding:0 0 14px; border-bottom:1px solid var(--line-soft); }
  .heal-block:last-child { border-bottom:0; margin-bottom:0; }
  .heal-h { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin:0 0 8px; font-size:17px; font-weight:700; }
  .heal-h .cn, .heal-table .cn { color:var(--cc); font-weight:700; }
  .heal-h .meta { color:var(--muted); font-size:13px; font-weight:500; font-family:var(--font-mono); }
  .heal-chips { display:flex; flex-wrap:wrap; gap:8px; margin:0 0 10px; }
  .heal-chips .chip { display:inline-flex; gap:6px; align-items:baseline; padding:4px 10px; border:1px solid var(--line); background:var(--panel2); font-size:13px; color:var(--muted); }
  .heal-chips .chip b { color:var(--text); font-family:var(--font-mono); font-variant-numeric:tabular-nums; }
  .heal-chips .chip-good b { color:var(--good); }
  .heal-chips .chip-medium b { color:var(--medium); }
  .heal-chips .chip-high b { color:var(--high); }
  .heal-spells { max-width:640px; }
  .heal-spells td.hi, .heal-table td.hi { color:var(--high); font-weight:600; }
  .heal-table td.mid { color:var(--medium); font-weight:600; }
  .heal-table .sh { display:inline-flex; align-items:center; gap:2px; margin-right:8px; font-family:var(--font-mono); font-size:13px; }
  @media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) .heal-h .cn, :root:not([data-theme="dark"]) .heal-table .cn { color:color-mix(in srgb, var(--cc) 70%, #000); } }
  :root[data-theme="light"] .heal-h .cn, :root[data-theme="light"] .heal-table .cn { color:color-mix(in srgb, var(--cc) 70%, #000); }
  /* Empfehlungen: send box */
  .rec-send { background:var(--panel); border:1px solid var(--line); border-left:3px solid var(--accent-2); padding:12px 14px; margin:0 0 18px; }
  .rec-send-head { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
  .rec-send-head b { font-size:15px; }
  .rec-send-meta { color:var(--muted); font-size:13px; font-family:var(--font-mono); margin-right:auto; }
  .rec-send-result { margin-top:10px; font-size:13.5px; display:flex; flex-direction:column; gap:4px; }
  .rec-send-row.ok { color:var(--good); } .rec-send-row.warn { color:var(--medium); } .rec-send-row.muted { color:var(--muted); }
  .rec-source { display:inline-block; font-size:10px; font-family:var(--font-mono); font-weight:700; letter-spacing:.06em; padding:1px 5px; margin-right:6px; border-radius:3px; background:var(--accent-soft); color:var(--accent); vertical-align:middle; }
  .rec-phrase-meta { display:block; margin-top:8px; }
  .rec-list { list-style:none; margin:0; padding:0; }
  .rec-status { font-size:12px; color:var(--muted); }
  /* ---- report v2: head, KPI cards, three views, boss/raider cards, section buttons, dialogs ---- */
  .kicker { font-family:var(--font-mono); font-size:10.5px; text-transform:uppercase; letter-spacing:1.3px; color:var(--muted); }
  .kicker.icons { display:flex; align-items:center; gap:6px; }
  .kicker .hicon { width:16px; height:16px; margin:0; }
  .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px; margin:0 0 18px; }
  .kpi { background:var(--panel); border:1px solid var(--line); border-top:3px solid var(--accent); border-radius:12px; padding:14px 16px; }
  .kpi.tone-high { border-top-color:var(--high); } .kpi.tone-medium { border-top-color:var(--medium); } .kpi.tone-good { border-top-color:var(--good); }
  .kpi-v { font-size:26px; font-weight:800; line-height:1.2; font-variant-numeric:tabular-nums; }
  .kpi-v.warn { color:var(--medium); } .kpi-v.bad { color:var(--high); } .kpi-v.good { color:var(--good); }
  .kpi-v small { font-size:14px; font-weight:600; color:var(--muted); }
  .kpi-v small.bad { color:var(--high); }
  .view-bar { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin:0 0 16px; }
  .seg { display:inline-flex; border:1px solid var(--line); background:var(--panel2); border-radius:10px; padding:3px; gap:2px; margin:0 0 14px; }
  .seg-btn { padding:8px 16px; border:0; border-radius:8px; background:transparent; color:var(--muted); font:inherit; font-size:14.5px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:8px; }
  .seg-btn:hover { color:var(--text); }
  .seg-btn.active { background:var(--panel); color:var(--text); box-shadow:0 1px 2px rgba(0,0,0,.12); }
  .seg-btn .n { margin-left:0; font-family:var(--font-mono); font-size:11.5px; color:var(--muted); background:var(--panel2); border-radius:10px; padding:0 7px; }
  .seg-btn .hicon { margin:0; }
  .seg.views { margin:0; }
  .seg.views .seg-btn { font-size:15px; }
  .view { display:flex; flex-direction:column; gap:12px; }
  .vcard { background:var(--panel); border:1px solid var(--line); border-radius:12px; }
  .vcard[open] { border-left:4px solid var(--accent); }
  .vcard > summary { display:flex; align-items:center; gap:14px; padding:12px 16px; cursor:pointer; list-style:none; }
  .vcard > summary::-webkit-details-marker { display:none; }
  .vcard[open] > summary { border-bottom:1px solid var(--line-soft); padding:14px 16px; }
  .vcard-icon { width:36px; height:36px; border-radius:8px; border:1px solid var(--line); flex:0 0 auto; background:linear-gradient(150deg, var(--portrait-1), var(--portrait-2)); }
  .vcard[open] .vcard-icon { width:44px; height:44px; }
  .raider-card .vcard-icon { width:40px; height:40px; border-radius:10px; }
  .raider-card[open] .vcard-icon { width:44px; height:44px; }
  .vcard-main { display:flex; flex-direction:column; min-width:0; }
  .boss-card .vcard-main { flex:1 1 auto; }
  .raider-card .vcard-main { flex:0 0 200px; }
  .vcard-title { font-size:17px; font-weight:700; }
  .vcard[open] .vcard-title { font-size:20px; font-weight:800; }
  .vcard-title.cn { color:var(--cc); }
  .vcard-meta { color:var(--muted); font-size:13px; font-family:var(--font-mono); }
  .vcard-chips { display:flex; gap:8px; flex-wrap:wrap; flex:1 1 auto; }
  .vcard-body { padding:0 16px 16px; }
  /* ---- the three head levels: card head (2-px line), part head (tinted band with a tile), table head (tinted, mono) ---- */
  .vcard[open] > summary { border-bottom:2px solid var(--line); }
  .vcard-meta { display:flex; gap:6px; flex-wrap:wrap; margin-top:3px; }
  table.idx th { background:var(--panel2); font-family:var(--font-mono); font-size:11.5px; text-transform:uppercase; letter-spacing:.04em; }
  /* badges: one word, an icon, a tone */
  .badge { display:inline-flex; align-items:center; gap:5px; padding:2px 8px; border-radius:6px; font-size:12px; font-weight:700; font-family:var(--font-mono); font-variant-numeric:tabular-nums; background:var(--panel2); color:var(--muted); border:1px solid var(--line); white-space:nowrap; line-height:1.5; }
  .badge.ok { background:var(--good-bg); color:var(--good); border-color:rgba(120,200,120,.35); }
  .badge.mid, .badge.warn { background:var(--medium-bg); color:var(--medium); border-color:rgba(224,162,58,.35); }
  .badge.bad { background:var(--high-bg); color:var(--high); border-color:rgba(224,82,79,.35); }
  .badge.accent { background:var(--accent-soft); color:var(--accent); border-color:rgba(138,124,255,.35); }
  .badge.count { border-radius:10px; padding:1px 7px; }
  .badge .hicon { width:14px; height:14px; margin:0; }
  /* icon tiles: an icon on a tinted square, the colour is the area's tone */
  /* the expand control: a round 30-px button with a chevron, filled and turned when open, "Details" before it when closed */
  .exp-lbl { display:inline-flex; align-items:center; gap:8px; margin-left:auto; flex:0 0 auto; font-size:13px; font-weight:600; color:var(--muted); }
  .exp { width:30px; height:30px; border-radius:50%; border:1px solid var(--line); background:var(--panel); display:inline-flex; align-items:center; justify-content:center; color:var(--accent); flex:0 0 auto; }
  .exp svg { width:18px; height:18px; display:block; }
  details[open] > summary .exp { background:var(--accent); border-color:var(--accent); color:var(--accent-ink); }
  details[open] > summary .exp svg { transform:rotate(180deg); }
  details[open] > summary .exp-w { display:none; }
  /* healer list: one row per healer, the details under it */
  .hlist { display:flex; flex-direction:column; border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  .hcols, .hrow > summary { display:grid; grid-template-columns:34px minmax(130px,1fr) 260px 128px 96px minmax(70px,1fr) 104px; align-items:center; gap:10px; padding:9px 12px; min-width:0; }
  .hrow > summary > * { min-width:0; }
  .hrow .exp-lbl { justify-content:flex-end; }
  .hcols { background:var(--panel2); border-bottom:1px solid var(--line); }
  .hrow > summary { cursor:pointer; list-style:none; border-bottom:1px solid var(--line-soft); }
  .hrow > summary::-webkit-details-marker { display:none; }
  .hrow:last-child > summary { border-bottom:0; }
  .hrow[open] > summary { background:var(--accent-soft); border-left:3px solid var(--accent); padding-left:9px; }
  .hrow .who { display:flex; align-items:center; gap:10px; min-width:0; }
  .hrow .who .hicon { width:30px; height:30px; border-radius:7px; border:1px solid var(--line); margin:0; }
  .hrow .who .cn { color:var(--cc); font-weight:700; }
  .hrow .who .sritems { display:block; }
  .hrow .hints { display:flex; gap:6px; flex-wrap:wrap; }
  .hrow-body { padding:12px 12px 14px 46px; border-left:3px solid var(--accent); border-bottom:1px solid var(--line-soft); background:color-mix(in srgb, var(--accent-soft) 40%, transparent); display:flex; flex-direction:column; gap:12px; }
  .hrow-body .heal-chips { margin:0; }
  .rank { width:26px; height:26px; border-radius:7px; display:inline-flex; align-items:center; justify-content:center; font-family:var(--font-mono); font-size:12.5px; font-weight:700; background:var(--panel2); color:var(--muted); }
  .rank.top { background:var(--accent); color:var(--accent-ink); }
  /* grouped lists: whatever belongs to a player sits under their head row */
  .glist { display:flex; flex-direction:column; border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  .grp > summary { display:flex; align-items:center; gap:10px; padding:8px 12px; background:var(--panel2); border-top:1px solid var(--line); cursor:pointer; list-style:none; }
  .grp:first-child > summary { border-top:0; }
  .grp > summary::-webkit-details-marker { display:none; }
  .grp > summary .cn { color:var(--cc); font-weight:800; font-size:15px; }
  .grp[open] > summary { border-left:3px solid var(--cc); padding-left:9px; }
  .grp .topic-table td:first-child { padding-left:56px; }
  .grp .topic-table th:first-child { padding-left:56px; }
  .grp .topic-table tr:last-child td { border-bottom:0; }
  @media (max-width:1000px) { .hcols { display:none; } .hrow > summary { grid-template-columns:34px 1fr 104px; } .hrow > summary .bar-heal, .hrow > summary .badge, .hrow > summary .hints { grid-column:2; } .hrow > summary .bar-heal { width:100%; } .hrow > summary .exp-lbl { grid-column:3; grid-row:1; } }
  .chip.warn { border-color:rgba(224,162,58,.4); background:var(--medium-bg); } .chip.warn b { color:var(--medium); }
  .chip.bad { border-color:rgba(224,82,79,.4); background:var(--high-bg); } .chip.bad b { color:var(--high); }
  .chip.ok b { color:var(--good); }
  .chip .hicon { width:16px; height:16px; margin:0 2px 0 0; }
  .chip.chip-x { border-radius:8px; padding:4px 10px; color:var(--muted); gap:6px; }
  .chip.chip-x b { margin:0; color:var(--text); }
  .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); border-bottom:1px solid var(--line-soft); margin:0 -16px 0; }
  .stat { padding:12px 16px; border-right:1px solid var(--line-soft); }
  .stat:last-child { border-right:0; }
  .stat-v { font-size:20px; font-weight:800; font-variant-numeric:tabular-nums; }
  .stat-v small { font-size:13px; font-weight:600; color:var(--muted); }
  .stat-v small.bad { color:var(--high); } .stat-v small.good { color:var(--good); }
  .stat-v.warn { color:var(--medium); } .stat-v.bad { color:var(--high); }
  .secs { display:flex; gap:8px; flex-wrap:wrap; padding:14px 0 0; }
  .sec { display:inline-flex; align-items:center; gap:8px; padding:8px 14px; border:1px solid var(--line); border-radius:9px; background:var(--panel); font:inherit; font-size:14px; font-weight:600; color:var(--text); cursor:pointer; }
  .sec .n { font-family:var(--font-mono); font-size:12px; font-weight:600; color:var(--muted); background:var(--panel2); border-radius:10px; padding:1px 7px; }
  .sec .n.mid { background:var(--medium-bg); color:var(--medium); } .sec .n.bad { background:var(--high-bg); color:var(--high); }
  .sec .hicon { margin:0; }
  .sec:hover { border-color:var(--muted); }
  .sec.active { border-color:var(--accent); background:var(--accent-soft); }
  .sec .dot { width:8px; height:8px; border-radius:50%; background:var(--good); flex:0 0 auto; }
  .sec .dot.mid { background:var(--medium); } .sec .dot.bad { background:var(--high); } .sec .dot.none { background:var(--line); }
  .part { padding:14px 0 4px; }
  .part-head { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin:0 0 12px; padding:10px 14px; background:var(--panel2); border:1px solid var(--line); border-radius:10px; }
  .part-title { display:flex; align-items:center; gap:10px; font-size:15px; font-weight:800; }
  .part-title .kicker { display:block; margin:0; font-weight:500; }
  .topic-table { margin:0; }
  .topic-table td .hicon { width:22px; height:22px; border-radius:5px; }
  .topic-table .tv { font-family:var(--font-mono); font-weight:700; }
  .topic-table .tv.good { color:var(--good); } .topic-table .tv.medium { color:var(--medium); } .topic-table .tv.high { color:var(--high); }
  .topic-table .mono { font-family:var(--font-mono); }
  .boss-recs { border-top:1px solid var(--line-soft); margin:14px -16px 0; padding:14px 16px 0; display:flex; flex-direction:column; gap:8px; }
  .boss-recs .rec-list { margin:0; }
  .fight { border:0; padding:0; background:transparent; }
  .fight.fight-wipe { border:0; }
  .try-pills { margin:14px 0 0; }
  .raider-tools { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .raider-tools input { padding:8px 12px; border:1px solid var(--line); border-radius:9px; background:var(--panel); color:var(--text); width:200px; font:inherit; }
  .raider-tools .seg { margin:0; }
  .raider-foot { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; padding:10px 16px 0; margin:12px -16px 0; border-top:1px solid var(--line-soft); }
  .raider-foot .rec-send-result { margin:0; font-size:13px; }
  .raider-empty { color:var(--muted); padding:20px 0; text-align:center; }
  .cn-strong { color:var(--cc); font-weight:700; }
  @media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) .vcard-title.cn, :root:not([data-theme="dark"]) .cn-strong { color:color-mix(in srgb, var(--cc) 70%, #000); } }
  :root[data-theme="light"] .vcard-title.cn, :root[data-theme="light"] .cn-strong { color:color-mix(in srgb, var(--cc) 70%, #000); }
  .mini { width:100%; border-collapse:collapse; font-size:14px; }
  .mini th { text-align:left; font-size:11.5px; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); font-weight:600; padding:6px 10px; border-bottom:1px solid var(--line); }
  .mini td { padding:8px 10px; border-bottom:1px solid var(--line-soft); vertical-align:middle; }
  .mini tr:last-child td { border-bottom:0; }
  .mini td .hicon { width:22px; height:22px; border-radius:5px; }
  dialog.dlg { border:1px solid var(--line); border-radius:14px; background:var(--panel); color:var(--text); padding:0; max-width:min(1040px, 96vw); width:min(1040px, 96vw); box-shadow:0 24px 60px rgba(0,0,0,.28); }
  dialog.dlg::backdrop { background:rgba(27,30,39,.45); }
  dialog.dlg.send { max-width:min(820px, 96vw); width:min(820px, 96vw); }
  /* a timeline is read sideways, so it gets what the screen has */
  dialog.dlg.chart { max-width:min(1400px, 96vw); width:min(1400px, 96vw); }
  /* one chart per player (totems): whose rows these are, above their own axis */
  .fc-block + .fc-block { margin-top:18px; padding-top:16px; border-top:1px solid var(--line); }
  .fc-owner { display:flex; align-items:center; gap:10px; margin:0 0 6px; font-weight:800; }
  .fc-owner .cn { color:var(--cc, var(--text)); }
  .fc-owner .sritems { color:var(--muted); font-weight:500; font-size:12.5px; }
  .dlg-head { display:flex; align-items:center; gap:14px; padding:16px 20px; border-bottom:1px solid var(--line-soft); }
  .dlg-head img.vcard-icon { width:36px; height:36px; }
  .dlg-head .dlg-main { flex:1 1 auto; display:flex; flex-direction:column; min-width:0; }
  .dlg-title { display:flex; align-items:center; gap:8px; font-size:18px; font-weight:800; }
  .dlg-title .hicon { width:22px; height:22px; margin:0; }
  .dlg-x { background:transparent; border:0; color:var(--text); font-size:20px; padding:4px 10px; cursor:pointer; border-radius:8px; }
  .dlg-x:hover { background:var(--panel2); }
  .dlg-body { padding:14px 20px 6px; max-height:70vh; overflow:auto; }
  .dlg-foot { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; padding:12px 20px 16px; border-top:1px solid var(--line-soft); }
  .dlg-foot .note { margin:0; }
  .dlg-foot .btns { display:flex; gap:8px; margin-left:auto; }
  .send-grid { display:grid; grid-template-columns:minmax(0,1fr) 300px; }
  .send-items { padding:16px 20px; display:flex; flex-direction:column; gap:14px; border-right:1px solid var(--line-soft); }
  .send-item { display:flex; flex-direction:column; gap:8px; border:1px solid var(--line); border-radius:10px; padding:12px 14px; }
  .send-item.on { border-color:var(--accent); background:var(--accent-soft); }
  .send-item-head { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .send-item-head b { flex:1 1 auto; }
  .send-item .seg { margin:0; }
  .send-item .seg-btn { padding:6px 12px; font-size:13px; }
  .send-text { width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid var(--line); border-radius:8px; background:var(--panel); color:var(--text); font:inherit; font-size:14px; line-height:1.5; resize:vertical; }
  .send-text[readonly] { background:var(--panel2); color:var(--muted); }
  .send-preview { padding:16px 20px; display:flex; flex-direction:column; gap:10px; background:var(--panel2); }
  .dm { border-left:4px solid var(--accent); background:var(--panel); border-radius:6px; padding:10px 12px; display:flex; flex-direction:column; gap:6px; font-size:13px; }
  .dm .note { margin:0; }
  @media (max-width:760px) { .send-grid { grid-template-columns:1fr; } .send-items { border-right:0; border-bottom:1px solid var(--line-soft); } .raider-card .vcard-main { flex:1 1 auto; } }
${REPORT_STYLE}
${CHART_STYLE}
${opts.extraStyle || ""}
</style>
</head>
<body${opts.bodyClass ? ` class="${opts.bodyClass}"` : ""}>
${inner}
<script>
/* Tooltips. One floating box for the whole page, driven by data-tip/data-tip-sub —
   the native title box takes a second to appear and cannot be styled. */
(function(){
  var el=null, cur=null;
  function box(){ if(!el){ el=document.createElement("div"); el.id="tip"; document.body.appendChild(el);} return el; }
  function place(t){
    var b=box(), r=t.getBoundingClientRect(), tb=b.getBoundingClientRect();
    var x=r.left+r.width/2-tb.width/2, y=r.top-tb.height-9;
    if(y<8){ y=r.bottom+9; }
    b.style.left=Math.max(8,Math.min(x,window.innerWidth-tb.width-8))+"px";
    b.style.top=y+"px";
  }
  function show(t){
    if(cur===t) return;
    cur=t; var b=box();
    var sub=t.getAttribute("data-tip-sub");
    b.innerHTML="<b></b>"+(sub?"<i></i>":"");
    b.querySelector("b").textContent=t.getAttribute("data-tip")||"";
    if(sub) b.querySelector("i").textContent=sub;
    b.classList.add("on"); place(t);
  }
  function hide(){ cur=null; if(el) el.classList.remove("on"); }
  document.addEventListener("mouseover",function(e){
    var t=e.target.closest("[data-tip]"); if(t) show(t); else if(cur&&!e.target.closest("#tip")) hide();
  });
  document.addEventListener("mouseout",function(e){ if(cur&&!e.relatedTarget) hide(); });
  document.addEventListener("focusin",function(e){ var t=e.target.closest("[data-tip]"); if(t) show(t); });
  document.addEventListener("focusout",hide);
  /* touch: a tap toggles the box (there is no hover), a tap elsewhere closes it */
  document.addEventListener("pointerdown",function(e){
    if(e.pointerType!=="touch") return;
    var t=e.target.closest("[data-tip]"); if(!t){ hide(); return; }
    if(cur===t) hide(); else show(t);
  });
  window.addEventListener("scroll",function(){ if(cur) place(cur); },true);
})();
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

// Slim public header for anonymous/non-admin visitors — admins get the sidebar chrome instead.
function publicBar(user) {
    return `<header class="pubbar">
      <div class="crest">${ICONS.crest}</div>
      <div>
        <div class="pubbar-name">EventHelper</div>
        <div class="pubbar-sub">Log-Check</div>
      </div>
      <div class="pubbar-actions">${authBar(user)}${themeToggleBtn()}</div>
    </header>`;
}

/**
 * Wraps a report/player body in the right shell: the admin sidebar + topbar for
 * admins, the public header + centered column for everyone else.
 * @param {object} opts { user, body, crumbs } — crumbs are only used by the admin chrome.
 */
function shellPage(title, { user, body, crumbs = [] }) {
    if (user && user.isAdmin) {
        const chrome = renderAdminChrome({
            user,
            activeTab: "cla",
            crumbs: [{ label: "Menü", href: "/" }, { label: "Log-Auswertung", href: "/cla" }, ...crumbs],
            body,
            actions: themeToggleBtn(),
            esc,
        });
        return layout(title, chrome, { bare: true, extraStyle: CHROME_STYLE });
    }
    return layout(title, `${publicBar(user)}${body}`);
}

function renderGearPanel(players, linkFor) {
    if (!players || players.length === 0) {
        return "<div class=\"empty\">Keine Gear-Probleme gefunden.</div>";
    }
    const total = players.reduce((n, p) => n + (p.issues || []).length, 0);
    return `<div class="badges">${badge(`${players.length} Spieler`, "", "inv_shield_06")}${badge(`${total} ${total === 1 ? "Problem" : "Probleme"}`, total ? "mid" : "ok")}</div>
      <div class="grid">${players.map((p) => playerCard(p, linkFor(p.name))).join("")}</div>`;
}

const CONS_HOW = "Abdeckung in % der Boss-Kämpfe. Flask und Elixiere schließen sich aus: „Flask/Elixiere“ heißt Flask oder beide Elixiere aktiv.";
const POTIONS_HOW = "Anzahl getrunkener Tränke. „Mana“ ist die Summe aller Manaquellen; die Spalten dahinter schlüsseln auf, welche, inklusive der zoneneigenen Gratis-Items und der Runen.";
const SUNDER_HOW = "„< 5 Stacks“ sind Sunder, die angewandt wurden, während der Boss noch keine 5 Stacks hatte (Stack-Aufbau).";
const DEBUFFS_HOW = "Debuffs auf dem Boss, gemittelt über alle Boss-Kämpfe. Erwartet wird, was die Aufstellung hergibt: ein Hexenmeister heißt Fluch der Elemente, ein Krieger Rüstung zerreißen; was nur eine Skillung liefert (Elend, Winterkälte), zählt erst, sobald es einmal im Log lag.";

function renderConsumablesPanel(consumables, linkFor) {
    const rows = (consumables && consumables.players) || [];
    if (rows.length === 0) return "<div class=\"empty\">Keine Daten.</div>";
    const ic = (consumables && consumables.icons) || {};
    const body = rows.map((p) => `<tr>
      <td>${classCell(p, linkFor(p.name))}</td>
      <td>${pctCell(p.flask)}</td>
      <td>${pctCell(p.elixir)}</td>
      <td>${barPct(p.buffed)}</td>
      <td>${barPct(p.food)}</td>
      <td>${yesNo(p.weaponOiled)}</td>
    </tr>`).join("");
    return `<div class="tbox"><table class="idx">
      <tr><th>Spieler</th><th>${colHead(ic.flask, "Flask")}</th><th>${colHead(ic.battle, "Elixiere")}</th><th data-tip="Flask oder beide Elixiere" data-tip-sub="${esc(CONS_HOW)}">Flask/Elixiere</th><th data-tip="Food" data-tip-sub="Anteil der Boss-Kämpfe mit Essensbuff.">${colHead(ic.food, "Food")}</th><th>Waffe geölt</th></tr>
      ${body}
    </table></div>`;
}

function renderPotionsPanel(potions, linkFor) {
    const rows = (potions && potions.players) || [];
    if (rows.length === 0) return "<div class=\"empty\">Keine Tränke gefunden.</div>";
    const ic = (potions && potions.icons) || {};
    // Every mana source that actually turned up in this raid gets its own column,
    // so "Mana" is not one opaque number any more; the column head names it.
    const manaTypes = ((potions && potions.types) || []).filter((t) => t.group === "mana");
    const manaHead = manaTypes.map((t) => `<th class="n" data-tip="${esc(t.label)}" data-tip-sub="Teil der Spalte „Mana“.">${hicon(t.icon, "")}</th>`).join("");
    const maxTotal = Math.max(1, ...rows.map((p) => Number(p.total) || 0));

    const body = rows.map((p) => {
        const byType = p.byType || {};
        const manaCells = manaTypes.map((t) => {
            const n = byType[t.key] || 0;
            return `<td class="n">${n ? esc(n) : "<span class=\"sritems\">·</span>"}</td>`;
        }).join("");
        return `<tr>
          <td class="pcol">${classCell(p, linkFor(p.name))}</td>
          <td class="n">${esc(p.destruction)}</td>
          <td class="n">${esc(p.haste)}</td>
          <td class="n"><strong>${esc(p.mana)}</strong></td>
          ${manaCells}
          <td>${barCell(String(p.total), ((Number(p.total) || 0) / maxTotal) * 100, "")}</td>
        </tr>`;
    }).join("");

    return `<div class="tbox scrollx"><table class="idx rpb">
      <tr>
        <th class="pcol">Spieler</th>
        <th class="n">${colHead(ic.destruction, "Zerstörung")}</th>
        <th class="n">${colHead(ic.haste, "Hast")}</th>
        <th class="n" data-tip="Mana" data-tip-sub="${esc(POTIONS_HOW)}">${colHead(ic.mana, "Mana")}</th>
        ${manaHead}
        <th data-tip="Gesamt" data-tip-sub="Der Balken ist der Anteil am höchsten Wert im Raid.">Gesamt</th>
      </tr>
      ${body}
    </table></div>`;
}

function renderShadowResiPanel(sr, linkFor) {
    if (!sr || !sr.players || sr.players.length === 0) return "<div class=\"empty\">Kein Mother-Shahraz-Kampf im Report.</div>";
    const body = sr.players.map((p) => {
        const items = p.items.map((it) =>
            `<a href="${esc(wowheadItemLink(it.itemId))}" target="_blank" rel="noopener">${esc(it.itemName)} (+${esc(it.sr)})</a>`
        ).join(", ");
        return `<tr><td>${classCell(p, linkFor(p.name))}</td><td class="srval">${esc(p.sr)}</td><td class="sritems">${items || "–"}</td></tr>`;
    }).join("");
    return `<div class="tbox"><table class="idx">
      <tr><th>Spieler</th><th data-tip="Schattenwiderstand aus Gear"${sr.note ? ` data-tip-sub="${esc(sr.note)}"` : ""}>SR (Gear)</th><th>Quellen</th></tr>
      ${body}
    </table></div>`;
}

function renderDrumsPanel(drums, linkFor) {
    const rows = (drums && drums.players) || [];
    if (rows.length === 0) return "<div class=\"empty\">Keine Drums gefunden.</div>";
    const body = rows.map((p) => {
        const parts = Object.entries(p.byType).map(([k, v]) => `${k}: ${v}`).join(", ");
        return `<tr><td>${classCell(p, linkFor(p.name))}</td><td class="srval">${esc(p.total)}</td><td class="sritems">${esc(parts)}</td></tr>`;
    }).join("");
    return `<div class="tbox"><table class="idx">
      <tr><th>Spieler</th><th>${colHead(drums && drums.icon, "Drums gesamt")}</th><th>Aufschlüsselung</th></tr>
      ${body}
    </table></div>`;
}

function potionCells(ic, pot) {
    const cell = (icon, n) => `<span class="potcell">${hicon(icon, "")}${esc(n || 0)}</span>`;
    return cell(ic.destruction, pot.destruction) + cell(ic.haste, pot.haste) + cell(ic.mana, pot.mana);
}

function renderSunderPanel(rows, linkFor) {
    if (!rows || rows.length === 0) return "<div class=\"empty\">Keine Sunder-Armor-Daten gefunden.</div>";
    const body = rows.map((p) => {
        const warn = p.below5 > 0 ? "mid" : "ok";
        return `<tr>
          <td>${classCell(p, linkFor(p.name))}</td>
          <td class="srval">${esc(p.total)}</td>
          <td>${badge(String(p.below5), warn, "", true)}</td>
        </tr>`;
    }).join("");
    return `<div class="tbox"><table class="idx">
      <tr><th>Spieler</th><th>Sunder gesamt</th><th data-tip="Davon bei weniger als 5 Stacks" data-tip-sub="${esc(SUNDER_HOW)}">davon bei &lt; 5 Stacks</th></tr>
      ${body}
    </table></div>`;
}

function uptimeCell(v) {
    return barPct(Number(v) || 0);
}

function renderBossUptimesPanel(data) {
    if (!data || !data.rows || data.rows.length === 0) return "<div class=\"empty\">Keine Boss-Daten gefunden.</div>";
    const head = data.metrics.map((m) => `<th data-tip="${esc(m.label)}" data-tip-sub="Debuff-Uptime pro Boss-Kampf in % der Kampfdauer. Ab 95 % grün, ab 70 % gelb.">${esc(m.label)}</th>`).join("");
    const body = data.rows.map((r) => {
        const cells = data.metrics.map((m) => `<td>${uptimeCell(r[m.key] || 0)}</td>`).join("");
        const boss = r.kill ? esc(r.boss) : `${esc(r.boss)} <span class="sritems">(Wipe)</span>`;
        return `<tr><td>${boss}</td>${cells}</tr>`;
    }).join("");
    return `<div class="tbox scrollx"><table class="idx">
      <tr><th>Boss</th>${head}</tr>
      ${body}
    </table></div>`;
}

// ---- Kampfverlauf: the fight timelines (report.timeline, utils/logcheck/fightTimeline.js) ----
//
// One boss at a time, one try at a time, one topic at a time: boss tabs (with
// the WCL boss icon), try pills under them, and a segmented switch for the
// topic — the DPS strip stays on top whichever topic is open. Every topic
// container on a fight is optional and drawn only when an analyzer filled it,
// so a report from before those analyzers still renders — with the bare fight
// axis and its deaths. The shapes the panel expects:
//   debuffs[]   { key, label, icon, bands | stacks, maxStacks, uptimePct, gapCount, longestGap, firstAt, timeToMax }
//   totems[]    { name, type, rows: [{ label, icon, markers, band, downtimes, uptimePct }] }
//   cooldowns   { windows: [{ label, from, to }], players: [{ name, type, rows: [{ label, icon, markers }] }] }
//   activity[]  { name, type, bands, gaps: [{ from, to, reason }], activePct }
//   series      { step, dps, hps, bossHp }

const classColorOf = (type) => CLASS_COLORS[type] || "";

function pctTone(v) {
    return v >= 95 ? "good" : v >= 70 ? "medium" : "high";
}

function fightOutcome(f) {
    if (f.kill) return "Kill";
    return `Wipe${Number.isFinite(f.fightPercentage) && f.fightPercentage !== null ? ` bei ${Math.round(f.fightPercentage)} %` : ""}`;
}

function classIconName(type) {
    return type ? `classicon_${String(type).toLowerCase()}` : "";
}

function deathsList(deaths, linkFor) {
    if (!deaths || deaths.length === 0) return "<div class=\"fc-empty\">Niemand ist gestorben.</div>";
    return `<ul class="fight-deaths">${deaths.map((d) => {
        const href = linkFor && linkFor(d.name);
        const name = href ? `<a class="cn" href="${esc(href)}">${esc(d.name)}</a>` : `<span class="cn">${esc(d.name)}</span>`;
        const why = d.ability ? ` <span class="sritems">· ${d.abilityIcon ? hicon(d.abilityIcon, "") : ""}${esc(d.ability)}</span>` : "";
        const tags = [
            d.avoidable ? "<span class=\"tag tag-high\">vermeidbar</span>" : "",
            d.early ? "<span class=\"tag tag-medium\">früh</span>" : "",
            d.repeat ? "<span class=\"tag tag-medium\">nach Kampfrez</span>" : "",
            d.nearEnd ? "<span class=\"tag\">kurz vor dem Kill</span>" : "",
        ].filter(Boolean).join("");
        return `<li style="--cc:${esc(classColorOf(d.type) || "var(--text)")}"><b>${fmtTime(d.at)}</b>${name}${why}${tags}</li>`;
    }).join("")}</ul>`;
}

/** Avoidable hits as marker rows: one row per mechanic (raid view) or per mechanic the raider took (player view). */
function mechanicRows(mech, only) {
    if (!mech) return [];
    if (only) {
        const p = (mech.players || []).find((x) => x.name === only);
        if (!p) return [];
        return Object.entries(p.byMechanic).map(([mkey, m]) => ({
            label: m.label, icon: m.icon,
            markers: p.hits.filter((h) => h.key === mkey).map((h) => ({ at: h.at, icon: h.icon, label: h.amount ? `${m.label} · ${h.amount.toLocaleString("de-DE")}` : m.label })),
            value: `${m.hits}×`,
            sub: m.amount ? `${Math.round(m.amount / 1000)}k Schaden` : "Debuff",
            tone: m.hits >= 3 ? "high" : m.hits === 2 ? "medium" : undefined,
        })).sort((a, b) => (b.markers.length - a.markers.length));
    }
    return (mech.mechanics || []).map((m) => {
        const hits = (mech.players || []).flatMap((p) => p.hits.filter((h) => h.key === m.key).map((h) => ({ at: h.at, icon: h.icon, label: `${p.name} · ${m.label}${h.amount ? ` · ${h.amount.toLocaleString("de-DE")}` : ""}` })));
        return {
            label: m.label, icon: m.icon,
            markers: hits.sort((a, b) => a.at - b.at),
            value: `${m.hits}×`,
            sub: `${m.players} Spieler${m.amount ? ` · ${Math.round(m.amount / 1000)}k` : ""}`,
            tone: m.players >= 5 ? "high" : m.players >= 2 ? "medium" : undefined,
        };
    });
}

/** One line under a debuff's headline number: when it reached full stacks, or its worst gap. */
function debuffSub(d) {
    if (d.maxStacks && Number.isFinite(d.timeToMax) && d.timeToMax !== null) return `${d.maxStacks}/${d.maxStacks} ab ${fmtTime(d.timeToMax)}`;
    if (d.missing) return "fehlt";
    if (d.longestGap > 3000) return `Lücke ${fmtTime(d.longestGap)}`;
    if (Number.isFinite(d.firstAt) && d.firstAt !== null) return `ab ${fmtTime(d.firstAt)}`;
    return "";
}

// Icon + German label per topic of a fight, for section buttons, dialogs and the raid view.
const TOPIC_META = {
    debuffs: { label: "Debuffs", icon: "spell_shadow_chilltouch" },
    buffs: { label: "Buffs", icon: "spell_magic_greaterblessingofkings" },
    healing: { label: "Heilung", icon: "spell_holy_flashheal" },
    cooldowns: { label: "Cooldowns", icon: "ability_rogue_preparation" },
    totems: { label: "Totems", icon: "spell_nature_windfury" },
    activity: { label: "Aktivität", icon: "inv_misc_pocketwatch_02" },
    mechanics: { label: "Mechaniken", icon: "spell_fire_selfdestruct" },
    deaths: { label: "Tode", icon: "ability_creature_cursed_05" },
    series: { label: "Kampfverlauf", icon: "inv_misc_pocketwatch_01" },
    fight: { label: "Kampf", icon: "inv_misc_pocketwatch_01" },
};

const normBand = (b) => (Array.isArray(b) ? { from: b[0], to: b[1] } : (b && typeof b === "object" ? { from: b.from, to: b.to } : null));

/**
 * The compact table of a topic: one row per chart row, with the icon, the
 * toned headline value and its sub line; band rows add gaps and the longest
 * gap, marker rows the count and the times. This is what a card shows first —
 * the chart with the same rows sits behind "Verlauf öffnen".
 */
function topicTable(rows, duration, kind) {
    const isBands = kind === "bands";
    const head = isBands
        ? "<tr><th>Zeile</th><th>Uptime</th><th>Details</th><th>Lücken</th><th>Längste Lücke</th></tr>"
        : "<tr><th>Zeile</th><th>Anzahl</th><th>Details</th><th>Zeitpunkte</th></tr>";
    const body = rows.map((r) => {
        const name = `${r.icon ? hicon(r.icon, "") : ""}${esc(r.label)}`;
        const value = r.value !== undefined && r.value !== null ? `<span class="tv${r.tone ? ` ${r.tone}` : ""}">${esc(r.value)}</span>` : "–";
        const sub = r.sub ? esc(r.sub) : "–";
        if (isBands) {
            const bands = (r.bands || []).map(normBand).filter((b) => b && b.to > b.from);
            const st = bandStats(bands, duration);
            return `<tr><td>${name}</td><td>${value}</td><td>${sub}</td><td class="mono">${esc(st.gapCount)}</td><td class="mono">${st.longestGap ? fmtTime(st.longestGap) : "–"}</td></tr>`;
        }
        const marks = (r.markers || []).filter((m) => m && Number.isFinite(m.at));
        const times = marks.slice(0, 8).map((m) => fmtTime(m.at)).join(", ") + (marks.length > 8 ? `, … (${marks.length})` : "");
        return `<tr><td>${name}</td><td>${value}</td><td>${sub}</td><td class="mono">${esc(times) || "–"}</td></tr>`;
    }).join("");
    return `<table class="idx fc-table topic-table">${head}${body}</table>`;
}

/**
 * Rows that belong to somebody, under that somebody: one <details> per
 * player (class tile, name in class colour, a badge with their result), the
 * rows as a topic table beneath. Ordered as given (the caller sorts by what
 * needs attention); `open` on a group opens it. A flat list of
 * "Dorn · Bloodlust, Brokk · Shield Wall, Dorn · Mana Tide" is unreadable —
 * the raid lead's words.
 *
 * @param {Array<{ name, type, rows, badge: { text, tone }, open }>} groups
 */
function groupedTable(groups, duration, kind) {
    return `<div class="glist">${groups.map((g) => `<details class="grp" style="--cc:${esc(classColorOf(g.type) || "var(--text)")}"${g.open ? " open" : ""}>
      <summary>${tile(classIconName(g.type), "cls")}<span class="cn">${esc(g.name)}</span><span class="sritems">${esc(g.type || "")}</span>${g.badge ? badge(g.badge.text, g.badge.tone) : ""}${g.extra || ""}${expBtn()}</summary>
      ${topicTable(g.rows, duration, kind)}
    </details>`).join("")}</div>`;
}

/**
 * The totem timeline, one chart per shaman instead of one flat list of rows.
 *
 * On a flat chart nothing says whose totem a row is — the rows carry an icon
 * and a percentage, and three shamans dropping earth totems look alike. Here
 * each shaman gets a head (class tile, name in class colour, their result) and
 * their own time axis, and the segment above filters to one of them: the same
 * `.dscope` mechanism the RPB tables use (DTOOLS_SCRIPT), so a name that is
 * filtered away simply hides its block.
 *
 * @param {Array<{ name, type, rows, badge: { text, tone } }>} groups  as groupedTable takes them
 */
function totemCharts(groups, common) {
    const seg = [
        `<button type="button" class="seg-btn active" data-frole="all">Alle<span class="n">${groups.length}</span></button>`,
        ...groups.map((g) => `<button type="button" class="seg-btn" data-frole="${esc(g.name)}">${tile(classIconName(g.type), "cls")}${esc(g.name)}<span class="n">${(g.rows || []).length}</span></button>`),
    ].join("");
    const tools = `<div class="dtools"><nav class="seg sm">${seg}</nav><span class="grow"></span><label class="field">${LINE.search}<input type="search" data-fsearch placeholder="Schamane suchen …" aria-label="Schamane suchen"></label></div>`;
    const blocks = groups.map((g) => `<section class="fc-block" data-role="${esc(g.name)}" data-name="${esc(g.name)}" style="--cc:${esc(classColorOf(g.type) || "var(--text)")}">
      <div class="fc-owner">${tile(classIconName(g.type), "cls")}<span class="cn">${esc(g.name)}</span><span class="sritems">${esc(g.type || "")}</span>${g.badge ? badge(g.badge.text, g.badge.tone) : ""}</div>
      ${markerChart({ ...common, rows: g.rows })}
    </section>`).join("");
    return `<div class="dscope" data-frole="all">${tools}${blocks}</div>`;
}

/**
 * The topic parts of one fight, only those with data:
 *   { id, key, label, icon, count, tone, table, chart }
 * `table` is the compact view a card opens with, `chart` the timeline
 * figure behind "Verlauf öffnen" (null for a list-only topic). `only`
 * restricts the rows to one raider, `ns` prefixes the element ids so the
 * same fight can sit on a page more than once (the boss card and every
 * raider's own slice).
 */
function fightParts(f, linkFor, only, ns = "") {
    const common = { duration: f.duration, deaths: f.deaths, classColor: classColorOf };
    const mine = (name) => !only || name === only;
    const parts = [];
    const key = (k) => `${ns}fp-${esc(f.id)}-${k}`;
    const part = (k, o) => parts.push({ id: key(k), key: k, label: TOPIC_META[k].label, icon: TOPIC_META[k].icon, chart: null, tone: undefined, ...o });
    const worst = (rows) => (rows.some((r) => r.tone === "high") ? "bad" : rows.some((r) => r.tone === "medium") ? "mid" : "ok");

    if (!only && f.debuffs && f.debuffs.length) {
        const rows = f.debuffs.map((d) => ({
            label: d.label, icon: d.icon,
            bands: d.stacks && d.stacks.length ? d.stacks : d.bands,
            maxStacks: d.maxStacks || 0,
            value: d.missing ? "fehlte" : (Number.isFinite(d.uptimePct) ? `${d.uptimePct}%` : undefined),
            sub: debuffSub(d),
            tone: d.missing ? "high" : (Number.isFinite(d.uptimePct) ? pctTone(d.uptimePct) : undefined),
        }));
        const missing = f.debuffs.filter((d) => d.expected && (d.missing || d.uptimePct === 0)).length;
        part("debuffs", { count: rows.length, tone: worst(rows), sub: missing ? `${missing} fehlt${missing === 1 ? "" : "en"}` : "", table: topicTable(rows, f.duration, "bands"), chart: ribbonChart({ ...common, rows }) });
    }

    const totems = (f.totems || []).filter((t) => mine(t.name));
    if (totems.length) {
        const rows = totems.flatMap((t) => (t.rows || []).map((r) => ({
            ...r,
            label: only ? r.label : `${t.name} · ${r.label}`,
            value: Number.isFinite(r.uptimePct) ? `${r.uptimePct}%` : r.value,
            sub: r.sub || ((r.downtimes || []).length ? `${r.downtimes.length} Lücke${r.downtimes.length === 1 ? "" : "n"}` : ""),
            tone: Number.isFinite(r.uptimePct) ? pctTone(r.uptimePct) : r.tone,
        })));
        const twisting = totems.filter((t) => t.twisting && t.twisting.detected).length;
        const groups = totems.map((t) => {
            const own = (t.rows || []).map((r) => ({ ...r, value: Number.isFinite(r.uptimePct) ? `${r.uptimePct}%` : r.value, sub: r.sub || ((r.downtimes || []).length ? `${r.downtimes.length} Lücke${r.downtimes.length === 1 ? "" : "n"}` : ""), tone: Number.isFinite(r.uptimePct) ? pctTone(r.uptimePct) : r.tone }));
            const gaps = own.reduce((n, r) => n + ((r.downtimes || []).length), 0);
            const tw = t.twisting && t.twisting.detected;
            return { name: t.name, type: t.type, rows: own, open: gaps > 0, badge: gaps ? { text: `${gaps} Lücke${gaps === 1 ? "" : "n"}`, tone: gaps >= 3 ? "bad" : "mid" } : { text: tw ? "Twisting" : "ok", tone: "ok" } };
        }).sort((a, b) => (b.badge.tone === "ok" ? 0 : 1) - (a.badge.tone === "ok" ? 0 : 1));
        part("totems", {
            count: rows.length, tone: worst(rows), sub: twisting ? "Twisting" : "",
            table: only ? topicTable(rows, f.duration, "markers") : groupedTable(groups, f.duration, "markers"),
            // One chart per shaman rather than one long list of icons: on a flat
            // chart nothing says whose totem a row is, and with three shamans
            // the rows of the one you are looking at sit apart from each other.
            chart: only || groups.length < 2 ? markerChart({ ...common, rows }) : totemCharts(groups, common),
        });
    }

    const cdPlayers = ((f.cooldowns && f.cooldowns.players) || []).filter((p) => mine(p.name));
    if (cdPlayers.length) {
        const rows = cdPlayers.flatMap((p) => (p.rows || []).map((r) => {
            const n = (r.markers || []).length;
            return { ...r, label: only ? r.label : `${p.name} · ${r.label}`, value: r.value !== undefined ? r.value : `${n}×`, sub: r.sub };
        }));
        const possible = rows.reduce((n, r) => n + (Number.isFinite(r.possibleUses) ? r.possibleUses : 0), 0);
        const missed = rows.reduce((n, r) => n + (Number.isFinite(r.missed) ? r.missed : 0), 0);
        const usedPct = possible ? Math.round(((possible - missed) / possible) * 100) : null;
        // per player: their cooldowns under their name, the one who missed most first, nothing missed = closed
        const groups = cdPlayers.map((p) => {
            const own = (p.rows || []).map((r) => ({ ...r, value: r.value !== undefined ? r.value : `${(r.markers || []).length}×` }));
            const pos = own.reduce((n, r) => n + (Number.isFinite(r.possibleUses) ? r.possibleUses : 0), 0);
            const mis = own.reduce((n, r) => n + (Number.isFinite(r.missed) ? r.missed : 0), 0);
            const used = pos - mis;
            return { name: p.name, type: p.type, rows: own, missed: mis, open: mis > 0, badge: pos ? { text: `${used} von ${pos} genutzt`, tone: mis === 0 ? "ok" : used * 2 >= pos ? "mid" : "bad" } : { text: (() => { const u = own.reduce((n, r) => n + (r.markers || []).length, 0); return `${u} ${u === 1 ? "Einsatz" : "Einsätze"}`; })(), tone: "" } };
        }).sort((a, b) => b.missed - a.missed || a.name.localeCompare(b.name));
        part("cooldowns", { count: rows.length, tone: usedPct === null ? "ok" : usedPct >= 80 ? "ok" : usedPct >= 50 ? "mid" : "bad", sub: usedPct === null ? "" : `${usedPct} % genutzt`, table: only ? topicTable(rows, f.duration, "markers") : groupedTable(groups, f.duration, "markers"), chart: markerChart({ ...common, rows, windows: f.cooldowns.windows || [] }) });
    }

    const activity = (f.activity || []).filter((a) => mine(a.name));
    if (activity.length) {
        const rows = activity.map((a) => ({
            label: a.name, icon: a.icon || classIconName(a.type),
            bands: a.bands,
            value: Number.isFinite(a.activePct) ? `${a.activePct}%` : undefined,
            sub: (a.gaps || []).length ? `${a.gaps.length} Lücke${a.gaps.length === 1 ? "" : "n"}` : "",
            tone: Number.isFinite(a.activePct) ? pctTone(a.activePct) : undefined,
        }));
        const avg = Math.round(activity.reduce((n, a) => n + (Number(a.activePct) || 0), 0) / activity.length);
        part("activity", { count: rows.length, tone: worst(rows), sub: `Ø ${avg} %`, table: topicTable(rows, f.duration, "bands"), chart: ribbonChart({ ...common, rows }) });
    }

    const mechRows = mechanicRows(f.mechanics, only);
    if (mechRows.length) {
        const hits = mechRows.reduce((n, r) => n + r.markers.length, 0);
        // per raider: their hits under their name, the most-hit first, one hit = closed
        const groups = only ? [] : ((f.mechanics && f.mechanics.players) || []).map((p) => {
            const own = mechanicRows(f.mechanics, p.name);
            const n = own.reduce((s, r) => s + r.markers.length, 0);
            const deaths = (f.deaths || []).filter((d) => d.name === p.name);
            const avoidable = deaths.filter((d) => d.avoidable).length;
            return { name: p.name, type: p.type, rows: own, hits: n, open: n >= 2 || avoidable > 0, badge: { text: `${n} Treffer`, tone: n >= 3 ? "bad" : n === 2 ? "mid" : "" }, extra: avoidable ? badge(`${avoidable} vermeidbar${avoidable === 1 ? "er Tod" : "e Tode"}`, "bad", "ability_creature_cursed_05") : (deaths.length ? badge(`${deaths.length} ${deaths.length === 1 ? "Tod" : "Tode"}`, "", "ability_creature_cursed_05") : "") };
        }).filter((g) => g.rows.length).sort((a, b) => b.hits - a.hits || a.name.localeCompare(b.name));
        part("mechanics", { count: hits, tone: worst(mechRows), sub: `${hits} Treffer`, table: only || !groups.length ? topicTable(mechRows, f.duration, "markers") : groupedTable(groups, f.duration, "markers"), chart: markerChart({ ...common, rows: mechRows }) });
    }

    const healing = healingParts(f, only, common, key("healing"));
    if (healing) part("healing", { count: healing.count, tone: healing.tone, sub: healing.sub, table: healing.table, chart: healing.chart });

    const buffs = buffParts(f, only, common);
    if (buffs) part("buffs", { count: buffs.count, tone: buffs.count ? "bad" : "ok", sub: buffs.count ? `${buffs.count} fehlten` : "alle da", table: buffs.table, chart: buffs.chart });

    if (only) {
        const own = playerSeries(f, only);
        if (own) part("series", { count: "", tone: "ok", sub: "", table: own.table, chart: own.chart });
    } else if (f.series && (f.series.dps || f.series.hps)) {
        part("series", { count: "", tone: "ok", sub: "", table: seriesTable(f), chart: fightSeries(f) });
    }

    const deaths = only ? (f.deaths || []).filter((d) => d.name === only) : (f.deaths || []);
    if (parts.length === 0) {
        // nothing but the skeleton yet: the fight itself is the one band, so the
        // axis and the deaths are still there to look at
        const rows = [{ label: f.kill ? "Kampf (Kill)" : "Kampf (Wipe)", bands: [[0, f.duration]], tone: f.kill ? "good" : "high", value: fmtTime(f.duration) }];
        part("fight", { count: 1, tone: "ok", sub: "", table: topicTable(rows, f.duration, "bands"), chart: ribbonChart({ ...common, deaths, rows }) });
    }
    part("deaths", { count: deaths.length, tone: deaths.some((d) => d.avoidable) ? "bad" : deaths.length ? "mid" : "ok", sub: "", table: deathsList(deaths, linkFor), chart: null });
    return parts;
}

/** The compact twin of the DPS/HPS strip: means, peaks and where the boss's health ended. */
function seriesTable(f) {
    const s = f.series || {};
    const mean = (arr) => (Array.isArray(arr) && arr.length ? Math.round(arr.reduce((a, v) => a + (Number(v) || 0), 0) / arr.length) : null);
    const peak = (arr) => (Array.isArray(arr) && arr.length ? Math.max(...arr.map((v) => Number(v) || 0)) : null);
    const hp = Array.isArray(s.bossHp) && s.bossHp.length ? s.bossHp.filter((v) => v !== null && v !== undefined) : [];
    const rows = [
        s.dps ? `<tr><td>${hicon("ability_dualwield", "")}Raid-DPS</td><td class="mono">Ø ${fmtK(mean(s.dps))}</td><td class="mono">max ${fmtK(peak(s.dps))}</td></tr>` : "",
        s.hps ? `<tr><td>${hicon("spell_holy_renew", "")}Raid-HPS</td><td class="mono">Ø ${fmtK(mean(s.hps))}</td><td class="mono">max ${fmtK(peak(s.hps))}</td></tr>` : "",
        hp.length ? `<tr><td>Boss-Leben</td><td class="mono">Ende ${esc(Math.round(hp[hp.length - 1]))} %</td><td class="mono">${esc(hp.length)} Messpunkte</td></tr>` : "",
    ].filter(Boolean).join("");
    return `<table class="idx fc-table topic-table"><tr><th>Kurve</th><th>Mittel</th><th>Spitze</th></tr>${rows}</table>`;
}

// ---- Heilung: the healers' topic of a fight (f.healers, utils/logcheck/healers.js) ----
//   healers[]  { name, type, diedAt, healing: { total, overheal, absorbs, overhealPct, spells[] }, mana: { available, step, values, min, minAt, regen[] }, potionMissing, dispels: { count, avgReactionMs } }
//   tank       { name, type } · shields[] { key, label, icon, source, bands | stacks, maxStacks, uptimePct, gapCount, fullStacksPct }
//   dispels    { total, missed: [{ at, ability, icon, target, targetType, durationMs }] }

function fmtK(n) {
    const v = Number(n) || 0;
    if (v >= 100000) return `${Math.round(v / 1000)}k`;
    if (v >= 1000) return `${(v / 1000).toFixed(1).replace(".", ",")}k`;
    return String(Math.round(v));
}

function fmtSecs(ms) {
    return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

/**
 * One healer's block, in two halves: `table` (headline chips + the spell
 * table — what the card shows) and `chart` (the mana curve with its
 * regeneration — what the dialog shows).
 */
function healerBlock(x, f, common) {
    const heal = x.healing || { total: 0, overheal: 0, absorbs: 0, overhealPct: 0, spells: [] };
    const mana = x.mana || { available: false };
    const tone = (v, hi, mid) => (v >= hi ? "high" : v >= mid ? "medium" : "good");
    const chips = [
        `<span class="chip" data-tip="Effektive Heilung in diesem Kampf" data-tip-sub="Ohne den Anteil, der über volle Lebenspunkte ging (Overheal)."><b>${fmtK(heal.total)}</b> Heilung</span>`,
        `<span class="chip chip-${tone(heal.overhealPct, 50, 35)}" data-tip="Anteil der Heilung, die über volle Lebenspunkte ging" data-tip-sub="Ab 35 % gelb, ab 50 % rot. Welcher Zauber es war, steht in der Tabelle."><b>${esc(heal.overhealPct)} %</b> Overheal</span>`,
        heal.absorbs ? `<span class="chip" data-tip="Absorbierter Schaden durch Schilde dieses Heilers"><b>${fmtK(heal.absorbs)}</b> Absorb</span>` : "",
        mana.available ? `<span class="chip chip-${mana.min < 10 ? "high" : mana.min < 20 ? "medium" : "good"}" data-tip="Niedrigster Manastand im Kampf und wann er erreicht war" data-tip-sub="Unter 20 % gelb, unter 10 % rot. Die Kurve mit Tränken und Regeneration steht hinter „Verlauf öffnen“."><b>${esc(mana.min)} %</b> Mana-Tiefstand bei ${fmtTime(mana.minAt)}</span>` : "",
        x.dispels && x.dispels.count ? `<span class="chip" data-tip="Dispels dieses Heilers im Kampf" data-tip-sub="Ø: mittlere Zeit vom Anlegen des Debuffs bis zum Dispel."><b>${esc(x.dispels.count)}</b> Dispels${x.dispels.avgReactionMs !== null && x.dispels.avgReactionMs !== undefined ? ` · Ø ${fmtSecs(x.dispels.avgReactionMs)}` : ""}</span>` : "",
        x.potionMissing ? "<span class=\"chip chip-medium\" data-tip=\"Kein Manatrank, obwohl der Kampf lang genug war und das Mana tief genug fiel\"><b>kein</b> Manatrank</span>" : "",
    ].filter(Boolean).join("");
    const manaChart = mana.available
        ? lineChart({
            duration: f.duration, deaths: f.deaths, classColor: common.classColor, step: mana.step, max: 100, unit: "%", markersLabel: "Regeneration",
            series: [{ key: "a", label: `Mana ${x.name}`, values: mana.values }],
            markers: (mana.regen || []).map((r) => ({ at: r.at, icon: r.icon, label: r.label, value: r.pct !== null && r.pct !== undefined ? `bei ${r.pct} %` : undefined })),
        })
        : "<div class=\"fc-empty\">Kein Manaverlauf im Log (keine Ressourcen-Events).</div>";
    // ranked by what landed, the strongest spell first; the bar carries the overheal on top of it
    const spells = (heal.spells || []).slice(0, 6).sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0));
    const maxRaw = Math.max(1, ...spells.map((s) => (Number(s.total) || 0) + (Number(s.overheal) || 0)));
    const table = spells.length
        ? `<table class="idx fc-table heal-spells"><tr><th></th><th>Zauber</th><th data-tip="Heilung und Overheal des Zaubers in einem Balken" data-tip-sub="${esc(HEAL_BAR_HOW)} Die Zahl rechts ist der Overheal-Anteil: ab 35 % gelb, ab 50 % rot.">Heilung · Overheal</th><th data-tip="Anteil an der gesamten Heilung dieses Heilers im Kampf">Anteil</th></tr>${spells.map((s, i) =>
            `<tr><td class="rank">${i + 1}</td><td>${s.icon ? hicon(s.icon, "") : ""}${esc(s.name)}</td><td>${healBar(s.total, s.overheal, maxRaw, s.overhealPct, `${num(s.total)} effektive Heilung, ${num(s.overheal)} Overheal (${s.overhealPct} %)${s.casts ? ` · ${s.casts} Casts` : ""}`, HEAL_BAR_HOW)}</td><td>${barCell(`${s.share} %`, s.share, "")}</td></tr>`).join("")}</table>`
        : "";
    const died = x.diedAt !== null && x.diedAt !== undefined ? ` · gestorben ${fmtTime(x.diedAt)}` : "";
    const head = `<h4 class="heal-h"><span class="cn">${esc(x.name)}</span><span class="meta">${esc(x.type)}${died}</span></h4>`;
    const style = `style="--cc:${esc(classColorOf(x.type) || "var(--text)")}"`;
    // the list row: rank, who, the one bar, mana and dispels as badges, the rest as hints; the block opens under it
    const row = (rank, maxRaw, dialogId) => {
        const manaBadge = mana.available
            ? badge(`${mana.min} % bei ${fmtTime(mana.minAt)}`, mana.min < 10 ? "bad" : mana.min < 20 ? "mid" : "ok", "inv_potion_137")
            : badge("kein Verlauf", "", "inv_potion_137");
        const dispelBadge = x.dispels && x.dispels.count
            ? badge(`${x.dispels.count}${x.dispels.avgReactionMs !== null && x.dispels.avgReactionMs !== undefined ? ` · Ø ${fmtSecs(x.dispels.avgReactionMs)}` : ""}`, "ok", "spell_holy_dispelmagic")
            : badge("0", "", "spell_holy_dispelmagic");
        const hints = [
            heal.absorbs ? badge(`${fmtK(heal.absorbs)} Absorb`, "", "inv_misc_gem_01") : "",
            x.diedAt !== null && x.diedAt !== undefined ? badge(`gestorben ${fmtTime(x.diedAt)}`, "bad", "ability_creature_cursed_05") : "",
            x.potionMissing ? badge("kein Manatrank", "mid", "inv_potion_137") : "",
        ].filter(Boolean).join("");
        const openChart = dialogId ? `<div style="display:flex;justify-content:flex-end"><button type="button" class="btn btn-ghost btn-sm" data-dialog="dlg-${esc(dialogId)}">${hicon("inv_misc_pocketwatch_01", "")}Manaverlauf öffnen${LINE.expand}</button></div>` : "";
        return `<details class="hrow" ${style}${rank === 1 ? " open" : ""}>
      <summary><span class="rank${rank === 1 ? " top" : ""}">${rank}</span><div class="who">${hicon(classIconName(x.type), "")}<div><span class="cn">${esc(x.name)}</span><span class="sritems">${esc(x.type)}</span></div></div>${healBar(heal.total, heal.overheal, maxRaw, heal.overhealPct, `${num(heal.total)} effektive Heilung, ${num(heal.overheal || 0)} Overheal (${heal.overhealPct} %)`, HEAL_BAR_HOW)}${manaBadge}${dispelBadge}<div class="hints">${hints}</div>${expBtn()}</summary>
      <div class="hrow-body"><div class="heal-chips">${chips}</div>${table}${openChart}</div>
    </details>`;
    };
    return {
        row,
        raw: (Number(heal.total) || 0) + (Number(heal.overheal) || 0),
        total: Number(heal.total) || 0,
        table: `<div class="heal-block" ${style}>${head}<div class="heal-chips">${chips}</div>${table}</div>`,
        chart: `<div class="heal-block" ${style}>${head}${manaChart}</div>`,
    };
}

/**
 * The Heilung topic of one fight: { count, tone, sub, table, chart }, or null
 * without healers. `only` restricts it to one raider. The table half carries
 * the healers' numbers and the never-removed debuffs, the chart half the mana
 * curves and the shields on the tank.
 */
function healingParts(f, only, common, partId) {
    const h = f.healers;
    if (!h || !(h.healers || []).length) return null;
    const healers = h.healers.filter((x) => !only || x.name === only);
    // the tank sees every aura on them, a healer only their own
    const isTank = !!(only && h.tank && h.tank.name === only);
    const shields = (h.shields || []).filter((r) => !only || isTank || r.source === only);
    if (!healers.length && !shields.length) return null;
    const blocks = healers.map((x) => healerBlock(x, f, common));
    // on the raid page: every healer as one row, ranked by what landed, the strongest open; their block under it
    const ranked = blocks.slice().sort((a, b) => b.total - a.total);
    const maxRaw = Math.max(1, ...ranked.map((b) => b.raw));
    const hlist = !only && ranked.length
        ? `<div class="hlist"><div class="hcols"><span class="kicker">#</span><span class="kicker">Heiler</span><span class="kicker" data-tip="Heilung und Overheal in einem Balken" data-tip-sub="${esc(HEAL_BAR_HOW)}">Heilung · Overheal</span><span class="kicker" data-tip="Niedrigster Manastand im Kampf und wann">Mana-Tiefstand</span><span class="kicker" data-tip="Dispels und die mittlere Reaktionszeit">Dispels</span><span class="kicker">Hinweise</span><span></span></div>${ranked.map((b, i) => b.row(i + 1, maxRaw, partId)).join("")}</div>`
        : "";
    let tankTable = "";
    let tankChart = "";
    if (h.tank && shields.length) {
        const rows = shields.map((r) => {
            const def = TANK_AURAS.find((a) => a.key === r.key) || {};
            return {
                label: `${r.label} (${r.source})`, icon: r.icon,
                bands: r.stacks && r.stacks.length ? r.stacks : r.bands, maxStacks: r.maxStacks || 0,
                value: `${r.uptimePct}%`,
                sub: r.maxStacks && r.fullStacksPct !== null && r.fullStacksPct !== undefined ? `${r.maxStacks}/${r.maxStacks}: ${r.fullStacksPct} %` : (r.gapCount ? `${r.gapCount} Lücke${r.gapCount === 1 ? "" : "n"}` : ""),
                tone: def.expectPct ? pctTone(r.uptimePct) : undefined,
            };
        });
        const head = `<h4 class="heal-h">Schilde &amp; HoTs auf ${esc(h.tank.name)}<span class="meta">Tank · ${esc(h.tank.type)}</span></h4>`;
        tankTable = `<div class="heal-block">${head}${topicTable(rows, f.duration, "bands")}</div>`;
        tankChart = `<div class="heal-block">${head}${ribbonChart({ ...common, rows })}</div>`;
    }
    let missed = "";
    const list = (h.dispels && h.dispels.missed) || [];
    if (!only && list.length) {
        missed = `<div class="heal-block"><h4 class="heal-h">Nie entfernte Debuffs<span class="meta">${list.length}</span></h4><ul class="fight-deaths">${list.map((m) =>
            `<li style="--cc:${esc(classColorOf(m.targetType) || "var(--text)")}"><b>${fmtTime(m.at)}</b><span class="cn">${esc(m.target)}</span><span class="sritems">· ${m.icon ? hicon(m.icon, "") : ""}${esc(m.ability)} · ${fmtTime(m.durationMs)} lang</span></li>`).join("")}</ul></div>`;
    }
    const lowMana = healers.filter((x) => x.mana && x.mana.available && x.mana.min < 10).length;
    const tone = lowMana || (!only && list.length >= 3) ? "bad" : healers.some((x) => x.healing && x.healing.overhealPct >= 35) ? "mid" : "ok";
    return {
        count: healers.length, tone,
        sub: only ? "" : `${healers.length} Heiler`,
        table: (hlist || blocks.map((b) => b.table).join("")) + tankTable + missed,
        chart: blocks.map((b) => b.chart).join("") + tankChart,
    };
}

/** The Heiler tab: one row per healer over the raid, the raid's missed dispels above. */
function renderHealersPanel(healers, linkFor) {
    const players = healers.players || [];
    const ranked = players.slice().sort((a, b) => (Number(b.healingTotal) || 0) - (Number(a.healingTotal) || 0));
    const maxRaw = Math.max(1, ...ranked.map((p) => (Number(p.healingTotal) || 0) + (Number(p.overhealTotal) || 0)));
    const rows = ranked.map((p, i) => {
        const href = linkFor && linkFor(p.name);
        const name = href ? `<a class="cn" href="${esc(href)}">${esc(p.name)}</a>` : `<span class="cn">${esc(p.name)}</span>`;
        const top = p.topOverheal ? `${p.topOverheal.icon ? hicon(p.topOverheal.icon, "") : ""}${esc(p.topOverheal.name)} <span class="sritems">${esc(p.topOverheal.overhealPct)} %</span>` : "–";
        const late = (p.potionPcts || []).filter((x) => x <= 15).length;
        const potions = `${esc(p.potions)}${late ? ` <span class="tag tag-medium">${late}× spät</span>` : ""}${p.potionMissingFights ? ` <span class="tag tag-medium">${esc(p.potionMissingFights)}× keiner</span>` : ""}`;
        const shields = (p.shields || []).map((s) => `<span class="sh" data-tip="${esc(s.label)}" data-tip-sub="${esc(`Ø ${s.uptimeAvg} % Uptime auf dem aktiven Tank in ${s.fights} Kämpfen`)}">${hicon(s.icon, "")}${esc(s.uptimeAvg)} %</span>`).join("") || "–";
        const mana = p.manaMinAvg === null || p.manaMinAvg === undefined ? "–" : `${esc(p.manaMinAvg)} %`;
        return `<tr style="--cc:${esc(classColorOf(p.type) || "var(--text)")}"><td class="rank">${i + 1}</td><td>${name}<div class="sritems">${esc(p.type)} · ${esc(p.fights)} ${p.fights === 1 ? "Kampf" : "Kämpfe"}</div></td><td>${healBar(p.healingTotal, p.overhealTotal, maxRaw, p.overhealPct, `${num(p.healingTotal)} effektive Heilung, ${num(p.overhealTotal || 0)} Overheal (${p.overhealPct} %) über ${p.fights} ${p.fights === 1 ? "Kampf" : "Kämpfe"}`, HEAL_BAR_HOW)}</td><td>${top}</td><td>${mana}${p.manaLowFights ? ` <span class="tag tag-high">${esc(p.manaLowFights)}× &lt; 10 %</span>` : ""}</td><td>${potions}</td><td>${esc(p.dispels)}${p.avgReactionMs !== null && p.avgReactionMs !== undefined ? ` <span class="sritems">Ø ${fmtSecs(p.avgReactionMs)}</span>` : ""}</td><td>${shields}</td></tr>`;
    }).join("");
    const raid = healers.raid || {};
    const missed = raid.dispelsMissed
        ? `<span class="badge mid" data-tip="${esc(`${raid.dispelsMissed} dispelbare Debuffs hat niemand entfernt`)}" data-tip-sub="${esc((raid.missedByAbility || []).slice(0, 4).map((m) => `${m.ability} (${m.count}×)`).join(", "))}">${hicon("spell_holy_dispelmagic", "")}${esc(raid.dispelsMissed)} nie dispellt</span>`
        : "";
    const tanks = (raid.tanks || []).length ? `<span class="badge" data-tip="Schild- und HoT-Uptimes gemessen auf dem aktiven Tank" data-tip-sub="Manaverlauf und Zauber pro Kampf stehen in der Sicht Bosse unter „Heilung“.">${hicon("inv_shield_06", "")}Tank: ${esc(raid.tanks.join(", "))}</span>` : "";
    return `${tanks || missed ? `<div class="badges">${tanks}${missed}</div>` : ""}<div class="tbox scrollx"><table class="idx heal-table"><tr><th></th><th>Heiler</th><th data-tip="Heilung und Overheal über alle Boss-Kämpfe in einem Balken, der stärkste Heiler zuerst" data-tip-sub="${esc(HEAL_BAR_HOW)} Die Zahl rechts ist der Overheal-Anteil: ab 35 % gelb, ab 50 % rot.">Heilung · Overheal</th><th data-tip="Der Zauber mit dem höchsten Overheal-Anteil">Größter Overheal</th><th data-tip="Niedrigster Manastand je Kampf, im Mittel" data-tip-sub="Dahinter: in wie vielen Kämpfen es unter 10 % fiel.">Ø Mana-Tiefstand</th><th data-tip="Manatränke über alle Kämpfe" data-tip-sub="Spät: erst unter 15 % Mana getrunken. Keiner: kein Trank in einem Kampf, der ihn hergegeben hätte.">Manatränke</th><th data-tip="Entfernte Debuffs und die mittlere Reaktionszeit">Dispels</th><th data-tip="Uptime der Schilde und HoTs auf dem aktiven Tank">Auf dem Tank</th></tr>${rows}</table></div>`;
}

// ---- Buffs: the raid buffs on the players of a fight (f.buffs, utils/logcheck/raidBuffs.js) ----
//   paladins, expected[]  · players[] { name, type, role, diedAt, buffs: [{ key, label, icon, status: full|late|partial|none, uptimePct, expected, wrong, bands }], missing[], late[], partial[], wrong[] }
//   (`late` — set after the pull, then kept — and `partial` — not there throughout: ran out or had a hole — were one
//   status before Sept 2026; a stored report may lack `late` and its counters, so every read of them has a fallback;
//   `unknown` is an inferred buff — Fortitude / Mark of the Wild, which the client leaves out of the combatant info —
//   that no event proved present or missing in this fight: never a finding, shown as "?")

const BUFF_STATUS = { full: "da", late: "spät gesetzt", partial: "nicht durchgehend", none: "fehlt", unknown: "nicht nachweisbar" };

function buffTone(c) {
    if (c.wrong) return "high";
    if (!c.expected || c.status === "unknown") return undefined;
    return c.status === "full" ? "good" : c.status === "late" || c.status === "partial" ? "medium" : "high";
}

/** The one-line explanation of an inferred buff, for tooltips and notes. */
const INFERRED_HOW = "Der Client loggt diesen Buff beim Pull nicht. Er gilt als da, wo der Log ihn später entfernt oder erneuert sieht (Tod, Auslaufen, Nachbuffen), und als fehlend, wo ein Tod alle anderen Buffs entfernt, diesen aber nicht. Ohne beides bleibt die Zelle offen (?) und zählt nicht als Fehlen.";

/** The same as a badge with the explanation in its tooltip, for the detail dialogs. */
function inferredBadge(list, unknownCells) {
    if (!list || !list.length) return "";
    const names = list.map((u) => `${u.label}${u.groupLabel ? ` / ${u.groupLabel}` : ""}`).join(", ");
    const open = unknownCells ? ` ${unknownCells} ${unknownCells === 1 ? "Zelle bleibt" : "Zellen bleiben"} ohne Nachweis.` : "";
    return `<span class="badge accent" data-tip="Aus dem Verlauf abgeleitet: ${esc(names)}" data-tip-sub="${esc(INFERRED_HOW + open)}">${list.map((u) => hicon(u.icon, "")).join("")}abgeleitet${unknownCells ? ` · ${esc(unknownCells)} ?` : ""}</span>`;
}

/** The number of things wrong with a player's buffs in a fight: missing, late, not throughout, wrong role. */
function buffIssues(p) {
    return (p.missing || []).length + (p.late || []).length + (p.partial || []).length + (p.wrong || []).length;
}

/** One player's chips: what was missing, what came late, what was not there throughout, what sat on the wrong role. */
function buffChips(p) {
    const byKey = new Map((p.buffs || []).map((c) => [c.key, c]));
    const chip = (key, cls, word) => {
        const c = byKey.get(key) || { label: key, icon: "" };
        return `<span class="tag ${cls}">${hicon(c.icon, "")}${esc(c.label)} ${word}</span>`;
    };
    return [
        ...(p.missing || []).map((k) => chip(k, "tag-high", "fehlt")),
        ...(p.late || []).map((k) => chip(k, "tag-medium", BUFF_STATUS.late)),
        ...(p.partial || []).map((k) => chip(k, "tag-medium", BUFF_STATUS.partial)),
        ...(p.wrong || []).map((k) => chip(k, "tag-medium", "· falsche Rolle")),
    ].join("");
}

/**
 * The Buffs topic of one fight: { count, html }, or null without data. On the
 * raid page a list of who lacked what (a ribbon per player and buff would be
 * two hundred rows); on the player page (`only`) that raider's buffs as
 * ribbons, so a buff that came late or ran out mid-fight is visible as such.
 */
function buffParts(f, only, common) {
    const b = f.buffs;
    if (!b || !(b.players || []).length) return null;
    const expectedLabels = (b.expected || []).map((k) => {
        const c = b.players.flatMap((p) => p.buffs || []).find((x) => x.key === k);
        return c ? c.label : k;
    });
    const inferred = (b.inferred || []).map((k) => {
        const c = b.players.flatMap((p) => p.buffs || []).find((x) => x.key === k);
        return c ? c.label : k;
    });
    const open = b.players.reduce((n, p) => n + (p.buffs || []).filter((c) => c.status === "unknown").length, 0);
    const inferredHint = inferred.length
        ? ` · <span data-tip="${esc(INFERRED_HOW)}">aus dem Verlauf abgeleitet: ${esc(inferred.join(", "))}${open ? ` (${esc(open)} ohne Nachweis)` : ""}</span>`
        : "";
    const head = `<p class="note">${esc(b.paladins || 0)} Paladin${b.paladins === 1 ? "" : "e"} · erwartet: ${expectedLabels.length ? esc(expectedLabels.join(", ")) : "nichts"}${inferredHint}</p>`;
    if (only) {
        const p = b.players.find((x) => x.name === only);
        if (!p) return null;
        const rows = (p.buffs || []).map((c) => ({
            label: `${c.label}${c.wrong ? " (falsche Rolle)" : ""}`, icon: c.icon,
            bands: c.bands || [],
            value: `${c.uptimePct}%`,
            sub: c.expected ? BUFF_STATUS[c.status] : (c.wrong ? "falsche Rolle" : "nicht erwartet"),
            tone: buffTone(c),
        }));
        return { count: buffIssues(p), table: head + topicTable(rows, f.duration, "bands"), chart: ribbonChart({ ...common, rows }) };
    }
    const lacking = b.players.filter((p) => buffIssues(p) > 0);
    if (!lacking.length) return { count: 0, table: `${head}<p class="note">Alle erwarteten Buffs auf allen Spielern.</p>`, chart: null };
    const list = lacking.map((p) =>
        `<li style="--cc:${esc(classColorOf(p.type) || "var(--text)")}"><span class="cn">${esc(p.name)}</span><span class="sritems">${esc(BUFF_ROLE_LABELS[p.role] || p.role)}${p.diedAt !== null && p.diedAt !== undefined ? ` · bis ${fmtTime(p.diedAt)}` : ""}</span><span class="buff-list">${buffChips(p)}</span></li>`).join("");
    return { count: lacking.length, table: `${head}<ul class="fight-deaths buff-lacking">${list}</ul>`, chart: null };
}

/** The Raid-Buffs tab: a player × buff matrix of "share of fights with the buff", the raid's coverage above. */
function renderRaidBuffsPanel(raidBuffs, linkFor) {
    const players = (raidBuffs.players || []).slice().sort((a, b) => (a.type + a.name).localeCompare(b.type + b.name));
    const blindKeys = new Set((raidBuffs.untracked || []).map((u) => u.key));
    // a buff the log cannot show is not a column: a grey column of "fehlt" would read as a raid without Fortitude;
    // an inferred one is, even where every cell is still open
    const cols = (raidBuffs.rows || []).filter((r) => !blindKeys.has(r.key) && (r.expected || r.seenPlayers > 0 || (r.unknown || 0) > 0));
    const blind = (raidBuffs.untracked || []).length
        ? `<span class="badge" data-tip="Im Log nicht nachweisbar: ${esc((raidBuffs.untracked || []).map((u) => `${u.label}${u.groupLabel ? ` / ${u.groupLabel}` : ""}`).join(", "))}" data-tip-sub="Der Client loggt diese Buffs beim Pull nicht (nur beim Nachbuffen), deshalb werden sie nicht bewertet.">${(raidBuffs.untracked || []).map((u) => hicon(u.icon, "")).join("")}nicht nachweisbar</span>`
        : "";
    const inferred = inferredBadge(raidBuffs.inferred, raidBuffs.unknownCells);
    const top = blind || inferred ? `<div class="badges">${blind}${inferred}</div>` : "";
    if (!players.length || !cols.length) return `${top}<div class="empty">Keine Raid-Buffs im Log.</div>`;
    // the group version counts like the single one, and the tooltip says so
    const head = cols.map((r) => `<th class="bh">${hicon(r.icon, `${r.label}${r.groupLabel ? ` / ${r.groupLabel}` : ""} (${r.provider})${r.inferred ? " · aus dem Verlauf abgeleitet" : ""}`)}</th>`).join("");
    const cover = cols.map((r) => `<td class="bc">${r.expected ? pctCell(r.coveragePct) : "<span class=\"pct pct-na\">–</span>"}</td>`).join("");
    const body = players.map((p) => {
        const href = linkFor && linkFor(p.name);
        const name = href ? `<a class="cn" href="${esc(href)}">${esc(p.name)}</a>` : `<span class="cn">${esc(p.name)}</span>`;
        const cells = cols.map((r) => {
            const c = p.buffs && p.buffs[r.key];
            if (!c) return "<td class=\"bc\"><span class=\"pct pct-na\">–</span></td>";
            const open = c.unknown ? `, ${c.unknown}× nicht nachweisbar` : "";
            const tip = `${c.full}× da, ${c.late || 0}× spät gesetzt, ${c.partial}× nicht durchgehend, ${c.none}× gefehlt${open}`;
            if (c.wrong) return `<td class="bc"><span class="pct pct-wrong" data-tip="${esc(r.label)}" data-tip-sub="${esc(`${c.wrong}× auf der falschen Rolle`)}">${esc(c.pct)}%</span></td>`;
            // nothing judged, only open cells: a question mark, not a percentage of nothing
            if (!c.expected && c.unknown) return `<td class="bc"><span class="pct pct-na" data-tip="${esc(r.label)}" data-tip-sub="${esc(`${c.unknown}× nicht nachweisbar`)}">?</span></td>`;
            if (!c.expected) return `<td class="bc"><span class="pct pct-na" data-tip="${esc(r.label)}" data-tip-sub="${esc(`nicht erwartet, ${c.present}× da`)}">${esc(c.pct)}%</span></td>`;
            return `<td class="bc" data-tip="${esc(r.label)}" data-tip-sub="${esc(tip)}">${pctCell(c.pct)}</td>`;
        }).join("");
        return `<tr style="--cc:${esc(classColorOf(p.type) || "var(--text)")}"><td>${name}<div class="sritems">${esc(p.type)} · ${esc(BUFF_ROLE_LABELS[p.role] || p.role)} · ${esc(p.fights)} ${p.fights === 1 ? "Kampf" : "Kämpfe"}</div></td>${cells}</tr>`;
    }).join("");
    const pal = raidBuffs.paladins || 0;
    const how = `Anteil der Bosskämpfe, in denen der Buff die ganze Zeit auf dem Spieler lag (bis zu seinem Tod). Erwartet wird, was die Aufstellung hergibt: ${pal} Paladin${pal === 1 ? "" : "e"} heißt ${pal === 1 ? "ein Segen" : `${pal} Segen`} pro Spieler, Macht auf Tanks und Nahkämpfer, Weisheit auf Heiler und Caster. Gruppenversionen (Große Segen, Gebete, Gabe der Wildnis, Arkane Brillanz) zählen wie die Einzelbuffs. Grau: nicht erwartet; gestrichelt: Segen auf der falschen Rolle. Wer wann was nicht hatte, steht in der Sicht Bosse unter „Buffs“.`;
    return `${top}<div class="tbox" style="overflow-x:auto"><table class="idx heal-table buff-matrix"><tr><th data-tip="Raid-Buffs je Spieler" data-tip-sub="${esc(how)}">Spieler</th>${head}</tr><tr class="cov"><td><b>Abdeckung</b><div class="sritems">Raid</div></td>${cover}</tr>${body}</table></div>`;
}

// ---- Raid-Debuffs: what the raid put on the boss (report.raidDebuffs, utils/logcheck/raidDebuffs.js) ----
//
// The raid summary (one row per debuff: expected?, mean uptime, on how many
// fights it was missing) comes from `raidDebuffs.rows`; the debuff × boss
// matrix under it is rendered purely from the timeline's per-fight rows
// (`timeline.fights[].debuffs`), nothing is stored for it.

/** A percentage toned like the fight charts (pctTone), with an optional tooltip. */
function toneCell(v, tip) {
    const cls = { good: "pct-full", medium: "pct-part", high: "pct-none" }[pctTone(v)];
    return `<span class="pct ${cls}"${tip ? ` data-tip="${esc(tip)}"` : ""}>${esc(v)}%</span>`;
}

function naCell(tip, text) {
    return `<span class="pct pct-na"${tip ? ` data-tip="${esc(tip)}"` : ""}>${esc(text || "–")}</span>`;
}

/**
 * Debuff × boss: per boss (in pull order, kills and wipes together) the mean
 * uptime over its tries, the tries themselves in the tooltip.
 *
 * The expectation is raid-wide — raidDebuffs.js derives it once from the
 * whole roster and stamps it on every fight's row as `expected` — so a debuff
 * has a row on every fight or on none; the one exception is an exclusive
 * group (Sunder/Expose, the judgements) covered by another member on that
 * pull, whose row is dropped. A boss without any row for the debuff therefore
 * reads "–": nothing was expected there. Expected and absent on every try is
 * "fehlte" (0 % in the high tone), not a blank.
 */
function debuffMatrix(rows, timeline) {
    const fights = (timeline && timeline.fights) || [];
    if (!rows.length || !fights.length) return "";
    const bosses = groupByBoss(fights);
    const head = bosses.map((b) => {
        const icon = bossIconUrl(b.encounterId);
        const kills = b.fights.filter((f) => f.kill).length;
        const state = kills ? `Kill${b.fights.length > 1 ? ` nach ${b.fights.length} Tries` : ""}` : `${b.fights.length} Wipe${b.fights.length === 1 ? "" : "s"}`;
        return `<th class="bh">${icon ? `<img src="${esc(icon)}" alt="">` : ""}<span class="boss-name">${esc(b.name)}</span><span class="sritems">${esc(state)}</span></th>`;
    }).join("");
    const body = rows.map((r) => {
        const cells = bosses.map((b) => {
            const tries = b.fights.map((f, j) => ({ f, no: j + 1, d: (f.debuffs || []).find((d) => d.key === r.key) })).filter((t) => t.d);
            if (!tries.length) return `<td class="bc">${naCell(`${r.label} auf ${b.name}: nicht erwartet`)}</td>`;
            const pct = (t) => (Number.isFinite(t.d.uptimePct) ? t.d.uptimePct : 0);
            const mean = Math.round(tries.reduce((n, t) => n + pct(t), 0) / tries.length);
            const detail = tries.map((t) => `Try ${t.no} (${fightOutcome(t.f)}): ${pct(t)} %`).join(" · ");
            const expected = tries.some((t) => t.d.expected);
            let cell;
            if (expected && tries.every((t) => t.d.missing || pct(t) === 0)) {
                cell = `<span class="pct pct-none" data-tip="${esc(`${r.label} fehlte auf ${b.name} · ${detail}`)}">0%</span>`;
            } else if (!expected) {
                cell = naCell(`${r.label} auf ${b.name}: nicht erwartet · ${detail}`, `${mean}%`);
            } else {
                cell = toneCell(mean, `${r.label} auf ${b.name}: ${detail}`);
            }
            let sub = "";
            if (r.maxStacks) {
                const ttm = tries.map((t) => t.d.timeToMax).filter((v) => Number.isFinite(v) && v !== null);
                if (ttm.length) sub = `<div class="sritems">max ab ${fmtTime(ttm.reduce((n, v) => n + v, 0) / ttm.length)}</div>`;
            }
            return `<td class="bc">${cell}${sub}</td>`;
        }).join("");
        return `<tr><td class="dn">${hicon(r.icon, "")}${esc(r.label)}<div class="sritems">${esc(r.provider)}${r.maxStacks ? ` · ${esc(r.maxStacks)} Stacks` : ""}</div></td>${cells}</tr>`;
    }).join("");
    return `<div class="dsub"><span data-tip="Debuff × Boss" data-tip-sub="Mittlere Uptime über alle Tries eines Bosses (Kills und Wipes zusammen); die einzelnen Tries stehen im Tooltip. „–“: dort nicht erwartet, weil kein Anbieter dabei war oder ein anderer Debuff derselben Gruppe lag. Bei stackenden Debuffs darunter, ab wann im Mittel die vollen Stacks lagen.">Debuff × Boss</span></div>
    <div class="tbox" style="overflow-x:auto"><table class="idx heal-table buff-matrix debuff-matrix"><tr><th>Debuff</th>${head}</tr>${body}</table></div>`;
}

/** The Raid-Debuffs tab: the raid summary per debuff, the debuff × boss matrix under it. */
function renderRaidDebuffsPanel(raidDebuffs, timeline) {
    const rows = (raidDebuffs && raidDebuffs.rows) || [];
    if (!rows.length) return "<div class=\"empty\">Keine Raid-Debuffs im Log.</div>";
    const body = rows.map((r) => {
        const fights = r.fights || 0;
        const stacks = r.maxStacks
            ? (r.avgBelowMax !== null && r.avgBelowMax !== undefined ? `${esc(r.avgBelowMax)}% unter ${esc(r.maxStacks)}` : `bis ${esc(r.maxStacks)}`)
            : "–";
        return `<tr>
          <td class="dn">${hicon(r.icon, "")}${esc(r.label)}<div class="sritems">${esc(r.provider)}</div></td>
          <td>${yesNo(r.expected)}</td>
          <td>${r.expected ? toneCell(r.avgUptime) : naCell("nicht erwartet", `${r.avgUptime}%`)}</td>
          <td>${r.expected ? (r.missing ? `<span class="pct pct-none">${esc(r.missing)}/${esc(fights)}</span>` : `<span class="pct pct-full">0/${esc(fights)}</span>`) : naCell("", "–")}</td>
          <td class="sritems">${stacks}</td>
        </tr>`;
    }).join("");
    return `<div class="tbox"><table class="idx">
      <tr><th>Debuff</th><th data-tip="Erwartet" data-tip-sub="${esc(DEBUFFS_HOW)}">Erwartet</th><th data-tip="Ø Uptime" data-tip-sub="Gemittelt über alle Boss-Kämpfe. Ab 95 % grün, ab 70 % gelb.">Ø Uptime</th><th>Gefehlt</th><th>Stacks</th></tr>
      ${body}
    </table></div>
    ${debuffMatrix(rows, timeline)}`;
}

/** The DPS/HPS strip above the topic switch. */
function fightSeries(f) {
    if (!f.series || !(f.series.dps || f.series.hps)) return "";
    const series = [];
    if (f.series.dps) series.push({ key: "a", label: "Raid-DPS", values: f.series.dps });
    if (f.series.hps) series.push({ key: "b", label: "Raid-HPS", values: f.series.hps });
    return `<div class="fight-series">${lineChart({ duration: f.duration, deaths: f.deaths, classColor: classColorOf, step: f.series.step, series, bossHp: f.series.bossHp })}</div>`;
}

/**
 * The player page's strip: the raider's own curve against the raid's mean
 * per player (the raid series over the number of raiders with a curve), on
 * the measure that is theirs — HPS for a healer of this fight or whoever
 * healed more than they hit, DPS otherwise. Their own death is the marker,
 * a Bloodlust window a mark at its start; the chips say how much of the
 * fight (alive) their output sat below half their own mean. Nothing without
 * a curve for this raider.
 */
function playerSeries(f, name) {
    const s = f.series;
    const mine = s && Array.isArray(s.players) ? s.players.find((p) => p && p.name === name) : null;
    if (!mine) return null;
    const sum = (arr) => (Array.isArray(arr) ? arr.reduce((a, v) => a + (Number(v) || 0), 0) : 0);
    const healer = ((f.healers && f.healers.healers) || []).some((h) => h.name === name) || sum(mine.hps) > sum(mine.dps);
    const key = healer && mine.hps ? "hps" : mine.dps ? "dps" : "hps";
    const label = key.toUpperCase();
    const own = mine[key];
    if (!Array.isArray(own) || !own.length) return null;
    const withKey = s.players.filter((p) => p && Array.isArray(p[key]) && p[key].length).length;
    const raid = Array.isArray(s[key]) && s[key].length && withKey
        ? s[key].map((v) => Math.round((Number(v) || 0) / withKey))
        : null;
    const series = [{ key: "a", label: `${label} ${name}`, values: own }];
    if (raid) series.push({ key: "b", label: `Raid-Mittel pro Spieler (${withKey})`, values: raid });
    const deaths = (f.deaths || []).filter((d) => d && d.name === name);
    const death = deaths.find((d) => Number.isFinite(d.at));
    const dips = dipShare(own, s.step, death ? death.at : null);
    const markers = ((f.cooldowns && f.cooldowns.windows) || [])
        .filter((w) => w && Number.isFinite(w.from))
        .map((w) => ({ at: w.from, label: w.label || "Bloodlust", icon: "spell_nature_bloodlust", value: `bis ${fmtTime(w.to)}` }));
    const tone = (v) => (v >= 40 ? "high" : v >= 25 ? "medium" : "good");
    const raidMean = raid ? Math.round(raid.reduce((a, v) => a + v, 0) / raid.length) : null;
    const chips = [
        dips ? `<span class="chip chip-${tone(dips.pct)}" data-tip="Anteil der Kampfzeit, in der ${esc(label)} unter der Hälfte des eigenen Schnitts lag" data-tip-sub="Bis zum eigenen Tod. Ab 25 % gelb, ab 40 % rot."><b>${esc(dips.pct)} %</b> der Zeit ${esc(label)}-Einbrüche</span>` : "",
        dips ? `<span class="chip"><b>Ø ${fmtK(dips.mean)}</b> ${esc(label)}</span>` : "",
        raidMean !== null ? `<span class="chip"><b>Ø ${fmtK(raidMean)}</b> Raid-Mittel pro Spieler</span>` : "",
    ].filter(Boolean).join("");
    return {
        table: `<div class="heal-chips">${chips}</div>`,
        chart: `<div class="fight-series player-series">${lineChart({
            title: `${label}-Verlauf ${name}`, duration: f.duration, deaths, classColor: classColorOf, step: s.step, series, bossHp: s.bossHp, markers, markersLabel: "Bloodlust",
        })}</div>`,
    };
}

/** Section buttons + panels for the parts of one fight, in `mode` "card" (table, chart behind a dialog button) or "inline" (table and chart stacked). */
function partPanels(f, parts, mode, ctx) {
    const seg = parts.map((p, i) =>
        `<button type="button" class="sec${i === 0 ? " active" : ""}" data-show="${p.id}">${hicon(p.icon, "")}${esc(p.label)}${p.count === "" ? "" : `<span class="n${p.tone === "bad" ? " bad" : p.tone === "mid" ? " mid" : ""}">${esc(p.count)}${p.sub ? ` · ${esc(p.sub)}` : ""}</span>`}</button>`).join("");
    const panels = parts.map((p, i) => {
        let chart = "";
        if (p.chart && mode === "inline") chart = `<div class="part-chart">${p.chart}</div>`;
        else if (p.chart) chart = chartDialog(p, f, ctx);
        const open = p.chart && mode !== "inline" ? `<button type="button" class="btn btn-ghost btn-sm" data-dialog="dlg-${p.id}">${hicon("inv_misc_pocketwatch_01", "")}Verlauf öffnen${LINE.expand}</button>` : "";
        const crumb = ctx && ctx.crumb ? `<span class="kicker">${esc(ctx.crumb)} › ${esc(p.label)}</span>` : "";
        return `<div id="${p.id}" class="fight-part part"${i === 0 ? "" : " hidden"}>
          <div class="part-head"><div class="part-title">${tile(p.icon, p.tone === "bad" ? "bad" : p.tone === "mid" ? "mid" : p.tone === "ok" ? "ok" : "none")}<div>${esc(p.label)}${ctx && ctx.subject ? ` · ${esc(ctx.subject)}` : ""}${crumb}</div></div>${open}</div>
          ${p.table}${chart}
        </div>`;
    }).join("");
    return `<nav class="secs">${seg}</nav>${panels}`;
}

/** The chart of one part in a modal dialog (VerlaufFenster): boss, topic, try meta, the chart, the scale note. */
function chartDialog(p, f, ctx) {
    const icon = ctx && ctx.iconUrl ? `<img class="vcard-icon" src="${esc(ctx.iconUrl)}" alt="">` : "";
    return `<dialog class="dlg chart" id="dlg-${p.id}">
      <div class="dlg-head">${icon}<div class="dlg-main"><div class="dlg-title">${hicon(p.icon, "")}${esc(f.boss)} · ${esc(p.label)}</div><div class="vcard-meta">${esc(fightOutcome(f))} · ${fmtTime(f.duration)} · ${PX_PER_SEC} px pro Sekunde, seitlich scrollen</div></div>${dlgClose()}</div>
      <div class="dlg-body">${p.chart}</div>
      <div class="dlg-foot"><span class="note">Tode als senkrechte Striche in Klassenfarbe · Tabellenansicht unter jeder Grafik aufklappbar</span><div class="btns"><button type="button" class="btn btn-ghost btn-sm" data-close>Schließen</button></div></div>
    </dialog>`;
}

/** The Kennzahlenzeile of one fight: Raid-DPS/HPS, Bloodlust, mean activity, expected/missing debuffs, deaths. */
function fightStats(f) {
    const mean = (arr) => (Array.isArray(arr) && arr.length ? Math.round(arr.reduce((a, v) => a + (Number(v) || 0), 0) / arr.length) : null);
    // every stat explains itself in the page's tooltip box: what the number is, where it comes from, when it turns yellow or red
    const stat = (icon, label, value, cls, tip, sub) => `<div class="stat"${tip ? ` data-tip="${esc(tip)}"` : ""}${sub ? ` data-tip-sub="${esc(sub)}"` : ""}><div class="kicker icons">${hicon(icon, "")}${esc(label)}</div><div class="stat-v${cls ? ` ${cls}` : ""}">${value}</div></div>`;
    const out = [];
    const s = f.series || {};
    if (s.dps) out.push(stat("ability_dualwield", "Raid-DPS", fmtK(mean(s.dps)), "", "Schaden des ganzen Raids pro Sekunde, im Mittel über den Kampf", "Aus der 5-Sekunden-Kurve von Warcraft Logs (v2-Zugang). Der Verlauf steht unter „Kampfverlauf“."));
    if (s.hps) out.push(stat("spell_holy_renew", "Raid-HPS", fmtK(mean(s.hps)), "", "Heilung des ganzen Raids pro Sekunde, im Mittel über den Kampf", "Effektive Heilung ohne Overheal, aus der 5-Sekunden-Kurve von Warcraft Logs."));
    // no Bloodlust stat: "0:08 · 13 s auseinander" told the raid lead nothing (their words); the windows stay in the Cooldowns chart
    const act = (f.activity || []).map((a) => Number(a.activePct)).filter(Number.isFinite);
    if (act.length) {
        const avg = Math.round(act.reduce((a, v) => a + v, 0) / act.length);
        out.push(stat("inv_misc_pocketwatch_02", "Aktivität Ø", `${avg} %`, avg >= 95 ? "" : avg >= 85 ? "warn" : "bad", `${avg} % der Kampfzeit war der Raid im Mittel am Wirken`, "Je Spieler der Anteil der Zeit bis zum eigenen Tod, in der ein Zauber oder Angriff lief (GCD belegt), gemittelt über alle. Ab 95 % grün, ab 85 % gelb, darunter rot. Wer wann Lücken hatte, steht unter „Aktivität“."));
    }
    if (f.debuffs && f.debuffs.length) {
        const expected = f.debuffs.filter((d) => d.expected).length;
        const missing = f.debuffs.filter((d) => d.expected && (d.missing || d.uptimePct === 0)).length;
        out.push(stat("spell_shadow_chilltouch", "Debuffs erwartet", `${expected} ${missing ? `<small class="bad">· ${missing} fehlte${missing === 1 ? "" : "n"}</small>` : ""}`, "", `${expected} Debuffs, die der Raid nach seiner Aufstellung auf den Boss bringen kann`, missing ? `${missing} davon ${missing === 1 ? "lag" : "lagen"} kein einziges Mal auf dem Boss. Die Uptimes stehen unter „Debuffs“.` : "Alle lagen mindestens zeitweise an; die Uptimes stehen unter „Debuffs“."));
    }
    const deaths = f.deaths || [];
    const first = deaths.find((d) => Number.isFinite(d.at));
    out.push(stat("ability_creature_cursed_05", "Tode", `${deaths.length} ${first ? `<small>· ${esc(first.name)} ${fmtTime(first.at)}</small>` : ""}`, deaths.some((d) => d.avoidable) ? "bad" : "", `${deaths.length} ${deaths.length === 1 ? "Tod" : "Tode"} in diesem Try${first ? `, der erste ${first.name} bei ${fmtTime(first.at)}` : ""}`, "Rot, wenn ein Tod als vermeidbar gewertet ist: durch eine Mechanik, der man ausweichen kann. Wer woran starb, steht unter „Mechaniken & Tode“."));
    return `<div class="stats">${out.join("")}</div>`;
}

/**
 * One try of a boss: the stats row (raid view), then the section buttons and
 * their panels. `mode` "card" keeps the charts behind dialogs, "inline"
 * stacks them under the tables (the player page).
 */
function renderFightSection(f, linkFor, only, tryNo, tries, active, mode, ns, ctx) {
    const parts = fightParts(f, linkFor, only, ns);
    const deaths = (f.deaths || []).length;
    const crumb = ctx && ctx.crumb ? `${ctx.crumb}${tries > 1 ? ` › Try ${tryNo}` : ""}` : "";
    return `<section class="fight${f.kill ? "" : " fight-wipe"}" id="${ns}fight-${esc(f.id)}"${active ? "" : " hidden"}>
      ${only ? `<div class="fight-head"><h3>${esc(f.boss)}</h3><span class="meta">${tries > 1 ? `Try ${tryNo}/${tries} · ` : ""}${esc(fightOutcome(f))} · ${fmtTime(f.duration)} · ${deaths} ${deaths === 1 ? "Tod" : "Tode"}</span></div>` : fightStats(f)}
      ${partPanels(f, parts, mode, { ...ctx, crumb })}
    </section>`;
}

/** Fights grouped per boss (by encounter id, else name), in pull order. */
function groupByBoss(fights) {
    const bosses = [];
    const byKey = new Map();
    for (const f of fights) {
        const k = f.encounterId ? `e${f.encounterId}` : `n${f.boss}`;
        if (!byKey.has(k)) {
            const boss = { key: k, name: f.boss, encounterId: f.encounterId, fights: [] };
            byKey.set(k, boss);
            bosses.push(boss);
        }
        byKey.get(k).fights.push(f);
    }
    return bosses;
}

// The one script the switches share: a click on [data-show] activates that button
// among its siblings and shows the matching panel among the siblings' panels.
const TIMELINE_SCRIPT = `<script>(function(){if(window.__ehShow)return;window.__ehShow=1;
document.addEventListener("click",function(e){var b=e.target.closest("[data-show]");if(!b)return;
var nav=b.parentElement,btns=nav.querySelectorAll("[data-show]");
for(var i=0;i<btns.length;i++){var x=btns[i],p=document.getElementById(x.getAttribute("data-show"));x.classList.toggle("active",x===b);if(p)p.hidden=x!==b;}});})();</script>`;

// <dialog> open/close: [data-dialog="id"] opens it modally, [data-close] and a click on the backdrop close it.
const DIALOG_SCRIPT = `<script>(function(){if(window.__ehDlg)return;window.__ehDlg=1;
document.addEventListener("click",function(e){var o=e.target.closest("[data-dialog]");if(o){if(o.closest("summary"))e.preventDefault();if(o.disabled)return;var d=document.getElementById(o.getAttribute("data-dialog"));if(d&&d.showModal){d.showModal();}return;}
var c=e.target.closest("[data-close]");if(c){var dl=c.closest("dialog");if(dl)dl.close();return;}
var dg=e.target.closest("dialog.dlg");if(dg&&e.target===dg){dg.close();}});
document.addEventListener("keydown",function(e){if(e.key!=="Enter"&&e.key!==" ")return;var o=e.target.closest&&e.target.closest("[role=button][data-dialog]");if(!o||o!==e.target)return;e.preventDefault();o.click();});})();</script>`;

// Tool rows of the detail dialogs: role segment and search hide every [data-role] cell or row of their scope
// (rows in the player orientation, whole columns in the ability orientation); the two icon buttons switch the orientation.
const DTOOLS_SCRIPT = `<script>(function(){if(window.__ehTools)return;window.__ehTools=1;
function apply(s){var role=s.getAttribute("data-frole")||"all",q=(s.getAttribute("data-fq")||"").toLowerCase();s.querySelectorAll("[data-role]").forEach(function(el){var ok=(role==="all"||el.getAttribute("data-role")===role)&&(!q||(el.getAttribute("data-name")||"").toLowerCase().indexOf(q)>=0);el.hidden=!ok;});}
document.addEventListener("click",function(e){var b=e.target.closest("[data-frole]");if(b&&b.tagName==="BUTTON"){var s=b.closest(".dscope");s.setAttribute("data-frole",b.getAttribute("data-frole"));b.parentElement.querySelectorAll("button[data-frole]").forEach(function(x){x.classList.toggle("active",x===b);});apply(s);return;}
var o=e.target.closest("[data-orient]");if(o){var sc=o.closest(".dscope"),a=o.getAttribute("data-orient")==="a";sc.classList.toggle("va",a);o.parentElement.querySelectorAll("[data-orient]").forEach(function(x){x.classList.toggle("active",x===o);});}});
document.addEventListener("input",function(e){var i=e.target;if(!i||!i.hasAttribute||!i.hasAttribute("data-fsearch"))return;var s=i.closest(".dscope");s.setAttribute("data-fq",i.value.trim());apply(s);});})();</script>`;

/** The try pills of a boss (one per pull; none for a single pull). */
function tryPills(b, ns) {
    if (b.fights.length < 2) return "";
    const pills = b.fights.map((f, j) =>
        `<button type="button" class="try-pill${j === 0 ? " active" : ""}${f.kill ? " try-kill" : " try-wipe"}" data-show="${ns}fight-${esc(f.id)}">Try ${j + 1}<span class="s">${esc(fightOutcome(f))} · ${fmtTime(f.duration)}</span></button>`).join("");
    return `<nav class="try-pills">${pills}</nav>`;
}

/** The chips in a boss card's head: missing debuffs, players short of buffs, never-removed debuffs, raid DPS of the best try. */
function bossChips(b) {
    const chip = (n, label, tone, tip, sub, icon) => `<span class="chip chip-x${tone ? ` ${tone}` : ""}"${tip ? ` data-tip="${esc(tip)}"` : ""}${sub ? ` data-tip-sub="${esc(sub)}"` : ""}>${icon ? hicon(icon, "") : ""}<b>${esc(n)}</b> ${esc(label)}</span>`;
    const out = [];
    if (b.fights.some((f) => f.debuffs && f.debuffs.length)) {
        const missing = new Set();
        for (const f of b.fights) for (const d of f.debuffs || []) if (d.expected && (d.missing || d.uptimePct === 0)) missing.add(d.key);
        out.push(chip(missing.size, `Debuff${missing.size === 1 ? "" : "s"} fehlte${missing.size === 1 ? "" : "n"}`, missing.size ? "bad" : "ok", "Erwartete Debuffs, die in mindestens einem Try kein einziges Mal auf dem Boss lagen", "Erwartet wird, was die Aufstellung hergibt: kein Krieger, kein Sunder. Die Uptimes je Try stehen unter „Debuffs“.", "spell_shadow_chilltouch"));
    }
    if (b.fights.some((f) => f.buffs && (f.buffs.players || []).length)) {
        const lacking = new Set();
        for (const f of b.fights) for (const p of (f.buffs && f.buffs.players) || []) if (buffIssues(p) > 0) lacking.add(p.name);
        out.push(chip(lacking.size, "Buffs fehlten", lacking.size ? "warn" : "ok", "Spieler, denen in mindestens einem Try ein erwarteter Raid-Buff fehlte, spät kam, ausging oder auf der falschen Rolle saß", "Wer was nicht hatte, steht unter „Buffs“.", "spell_magic_greaterblessingofkings"));
    }
    if (b.fights.some((f) => f.healers && f.healers.dispels)) {
        const n = b.fights.reduce((s, f) => s + (((f.healers && f.healers.dispels && f.healers.dispels.missed) || []).length), 0);
        out.push(chip(n, "nie dispellt", n >= 3 ? "warn" : "", "Dispelbare Debuffs auf Spielern, die in diesem Kampf niemand entfernt hat", "Dispelbar heißt: denselben Debuff hat im Log irgendwann jemand dispellt. Ab 3 gelb.", "spell_holy_dispelmagic"));
    }
    const withDps = b.fights.filter((f) => f.series && Array.isArray(f.series.dps) && f.series.dps.length);
    if (withDps.length) {
        const best = withDps.find((f) => f.kill) || withDps[withDps.length - 1];
        const mean = Math.round(best.series.dps.reduce((a, v) => a + (Number(v) || 0), 0) / best.series.dps.length);
        out.push(chip(fmtK(mean), "Raid-DPS", "ok", `Schaden des ganzen Raids pro Sekunde im ${best.kill ? "Kill-Try" : "letzten Try"}, im Mittel über den Kampf`, "Aus der 5-Sekunden-Kurve von Warcraft Logs (v2-Zugang).", "ability_dualwield"));
    }
    return out.join("");
}

/** The meta line under a boss's name: tries, outcomes, kill time, deaths. */
function bossMeta(b) {
    const n = b.fights.length;
    const kill = b.fights.find((f) => f.kill);
    const wipes = b.fights.filter((f) => !f.kill);
    const deaths = b.fights.reduce((s, f) => s + (f.deaths || []).length, 0);
    const avoidable = b.fights.reduce((s, f) => s + (f.deaths || []).filter((d) => d.avoidable).length, 0);
    return [
        badge(`${n} ${n === 1 ? "Try" : "Tries"}`, "", "", true),
        wipes.length ? badge(wipes.length === 1 ? fightOutcome(wipes[0]) : `${wipes.length} Wipes`, "bad", "achievement_boss_illidan") : "",
        kill ? badge(`Kill ${fmtTime(kill.duration)}`, "ok", "achievement_boss_illidan") : "",
        badge(`${deaths} ${deaths === 1 ? "Tod" : "Tode"}${avoidable ? ` · ${avoidable} vermeidbar` : ""}`, avoidable ? "bad" : deaths ? "mid" : "", "ability_creature_cursed_05"),
    ].filter(Boolean).join("");
}

/** Raid recommendations that name this boss in their title, text or evidence. */
function bossRecommendations(b, raidRecs, reviewer) {
    const name = String(b.name || "").toLowerCase();
    if (!name) return "";
    const hit = (s) => String(s || "").toLowerCase().includes(name);
    const items = (raidRecs || []).filter((i) => reviewer || i.approved === true)
        .filter((i) => hit(i.title) || hit(i.text) || hit(i.custom) || hit(i.ai) || (i.evidence || []).some((e) => hit(e.label) || hit(e.value)));
    if (!items.length) return "";
    return `<div class="boss-recs"><div class="kicker icons">${hicon("inv_misc_note_01", "")}Empfehlungen zu diesem Boss</div><ul class="rec-list">${items.map((i) => recItem(i, "raid", "", reviewer)).join("")}</ul></div>`;
}

/** One boss card (Sicht Bosse): head with icon, meta and chips; body with try pills, stats, sections and the boss's recommendations. */
function bossCard(b, i, linkFor, raidRecs, reviewer) {
    const icon = bossIconUrl(b.encounterId);
    const ctx = { iconUrl: icon, crumb: `Bosse › ${b.name}`, subject: `auf ${b.name}` };
    const sections = b.fights.map((f, j) => renderFightSection(f, linkFor, null, j + 1, b.fights.length, j === 0, "card", "", ctx)).join("");
    return `<details class="vcard boss-card" id="boss-${esc(b.key)}"${i === 0 ? " open" : ""}>
      <summary>${icon ? `<img class="vcard-icon" src="${esc(icon)}" alt="">` : "<span class=\"vcard-icon\"></span>"}<div class="vcard-main"><div class="vcard-title">${esc(b.name)}</div><div class="vcard-meta">${bossMeta(b)}</div></div><div class="vcard-chips">${bossChips(b)}</div>${expBtn()}</summary>
      <div class="vcard-body">${tryPills(b, "")}${sections}${bossRecommendations(b, raidRecs, reviewer)}</div>
    </details>`;
}

/** Sicht Bosse: one card per boss, the first open. */
function renderBossView(timeline, linkFor, raidRecs, reviewer) {
    const fights = (timeline && timeline.fights) || [];
    if (fights.length === 0) return "<div class=\"empty\">Keine Boss-Kämpfe im Log.</div>";
    const bosses = groupByBoss(fights);
    // No fight carries a DPS/HPS strip: the v2 client is not set up (or the
    // report predates it). Said once, here, instead of an empty gap per fight.
    const noSeries = fights.some((f) => f.series && (f.series.dps || f.series.hps))
        ? ""
        : "<p class=\"note\">Raid-DPS/HPS und Boss-Leben brauchen den Warcraft-Logs-v2-Zugang (Einstellungen → Verbindungen → Warcraft Logs); bei einer neuen Auswertung erscheinen sie dann in der Kennzahlenzeile und als Bereich „Kampfverlauf“.</p>";
    return `${noSeries}${bosses.map((b, i) => bossCard(b, i, linkFor, raidRecs, reviewer)).join("")}`;
}

/** The fights a raider shows up in. */
function playerFights(timeline, name) {
    return ((timeline && timeline.fights) || []).filter((f) =>
        (f.deaths || []).some((d) => d.name === name)
        || (f.totems || []).some((t) => t.name === name)
        || ((f.cooldowns && f.cooldowns.players) || []).some((p) => p.name === name)
        || (f.activity || []).some((a) => a.name === name)
        || ((f.mechanics && f.mechanics.players) || []).some((p) => p.name === name)
        || ((f.healers && f.healers.healers) || []).some((h) => h.name === name)
        || ((f.healers && f.healers.shields) || []).some((r) => r.source === name)
        || !!(f.healers && f.healers.tank && f.healers.tank.name === name)
        || ((f.buffs && f.buffs.players) || []).some((p) => p.name === name)
        || ((f.series && f.series.players) || []).some((p) => p && p.name === name));
}

/**
 * The player's slice of the timeline: only the fights this raider shows up
 * in, boss tabs → try pills → sections, charts inline. `ns` keeps the ids
 * apart from the boss cards' and from the other raiders' slices on the
 * report page.
 */
function renderPlayerTimeline(timeline, name, ns = "p-") {
    const fights = playerFights(timeline, name);
    if (fights.length === 0) return "";
    const bosses = groupByBoss(fights);
    const tabs = bosses.map((b, i) => {
        const icon = bossIconUrl(b.encounterId);
        const kills = b.fights.filter((f) => f.kill).length;
        return `<button type="button" class="boss-tab${i === 0 ? " active" : ""}" data-show="${ns}fb-${esc(b.key)}">`
            + (icon ? `<img src="${esc(icon)}" alt="">` : "")
            + `<span class="boss-name">${esc(b.name)}</span>`
            + `<span class="boss-tries boss-${kills ? "kill" : "wipe"}">${b.fights.length} ${b.fights.length === 1 ? "Try" : "Tries"}</span></button>`;
    }).join("");
    const panels = bosses.map((b, i) => {
        const sections = b.fights.map((f, j) => renderFightSection(f, null, name, j + 1, b.fights.length, j === 0, "inline", ns, { crumb: "" })).join("");
        return `<div id="${ns}fb-${esc(b.key)}" class="fight-boss"${i === 0 ? "" : " hidden"}>${tryPills(b, ns)}${sections}</div>`;
    }).join("");
    return `<h2>Kampfverlauf</h2><nav class="boss-tabs">${tabs}</nav>${panels}`;
}

// ---- Empfehlungen: what each raider and the raid should do differently (report.recommendations) ----
//
// The rules (utils/logcheck/recommendations.js) produce the findings; the raid
// lead approves, rejects or rewrites each one here before anything goes out to
// a raider. A visitor without review rights sees only what was approved.

const IMPACT_LABEL = { high: "hoch", medium: "mittel", low: "gering" };

/** Whether this visitor may review: full admins and anyone with write access to the CLA area. */
function canReview(user) {
    if (!user) return false;
    if (user.isAdmin) return true;
    const cla = user.access && user.access.cla;
    return !!(cla && cla.write);
}

function reviewedRecommendations(report) {
    return applyReview(report.recommendations, report.recommendationReview);
}

const IMPACT_TONE = { high: "bad", medium: "mid", low: "" };
const STATE_LABEL = { approved: "freigegeben", rejected: "nicht senden", open: "offen" };
const STATE_TONE = { approved: "ok", rejected: "bad", open: "mid" };

/** Up to `max` evidence badges of a finding: the label muted, the value in text colour. */
function evidenceBadges(item, max = 2) {
    return (item.evidence || []).slice(0, max).map((e) =>
        `<span class="badge ev-b" data-tip="${esc(e.label)}" data-tip-sub="${esc(e.value)}">${esc(e.label)} <b>${esc(e.value)}</b></span>`).join("");
}

/**
 * One finding as one row (Befundzeile): impact badge, title, up to two
 * evidence badges, the status badge and — for a reviewer — the three verdict
 * icon buttons (approve, reject, edit). The text sits in the foldable body,
 * with "Eigenen Text schreiben" and "Regeltext zeigen" for a reviewer.
 * Clicking the active verdict again takes it back.
 */
function recItem(item, scope, player, reviewer, opts = {}) {
    const state = item.approved === true ? "approved" : item.approved === false ? "rejected" : "open";
    // the raid lead's own words first, then Claude's phrasing, then the rule's text
    const text = item.custom || item.ai || item.text;
    const source = item.custom ? "" : item.ai ? "<span class=\"rec-source\" data-tip=\"Von Claude formuliert\" data-tip-sub=\"Der Regeltext dahinter steht im Tooltip des Textes.\">KI</span>" : "";
    const status = reviewer || state !== "open" ? `<span class="badge rec-state ${STATE_TONE[state]}">${STATE_LABEL[state]}</span>` : "";
    const acts = reviewer
        ? `<span class="acts rec-review" data-scope="${esc(scope)}" data-player="${esc(player || "")}" data-key="${esc(item.key)}">${
            ibtn(LINE.check, "Freigeben", "Geht erst nach der Freigabe an den Raider. Ein zweiter Klick nimmt die Entscheidung zurück.", "data-review=\"approve\"", state === "approved" ? "ok" : "")}${
            ibtn(LINE.ban, "Nicht senden", "Der Punkt bleibt im Report, geht aber nicht raus. Ein zweiter Klick nimmt die Entscheidung zurück.", "data-review=\"reject\"", state === "rejected" ? "bad" : "")}${
            ibtn(LINE.pencil, "Text bearbeiten", "Eine eigene Formulierung geht vor dem KI- und dem Regeltext.", "data-review=\"edit\"")}</span>`
        : `<span class="acts">${expBtn()}</span>`;
    const hasRule = !!(item.ai || item.custom) && item.text;
    const tools = reviewer
        ? `<div class="row-btns"><button type="button" class="btn btn-ghost btn-sm" data-review="edit">${LINE.pencil}Eigenen Text schreiben</button>${hasRule ? `<button type="button" class="btn btn-ghost btn-sm" data-review="rule">${LINE.undo}Regeltext zeigen</button>` : ""}<span class="rec-status"></span></div>
        <div class="rec-edit" hidden><textarea class="rec-text" rows="3" placeholder="Eigene Formulierung (leer = Vorschlag so lassen)">${esc(item.custom || "")}</textarea><div class="row-btns"><button type="button" class="btn btn-sm" data-review="save">Text speichern</button></div></div>`
        : "";
    return `<details class="rec rrow-d rec-${esc(item.impact)} rec-state-${state}" data-key="${esc(item.key)}"${opts.open ? " open" : ""}>
      <summary class="rrow"><span>${badge(IMPACT_LABEL[item.impact] || item.impact, IMPACT_TONE[item.impact] || "")}</span><span class="t rec-title" data-tip="${esc(item.title)}">${esc(item.title)}</span><span class="ev">${evidenceBadges(item)}</span><span class="st">${status}</span>${acts}</summary>
      <div class="rbody">
        <p class="rec-body"${item.ai && !item.custom ? ` data-tip="Regeltext" data-tip-sub="${esc(item.text)}"` : ""}>${source}${esc(text)}</p>
        ${reviewer && hasRule ? `<p class="rec-rule" hidden><span class="rec-source">Regel</span>${esc(item.text)}</p>` : ""}
        ${(item.evidence || []).length > 2 ? `<div class="badges">${(item.evidence || []).slice(2, 6).map((e) => `<span class="badge ev-b">${esc(e.label)} <b>${esc(e.value)}</b></span>`).join("")}</div>` : ""}
        ${tools}
      </div>
    </details>`;
}

/** The raid's findings (Sicht Raid): every finding with verdict controls for a reviewer, the approved ones for everyone else. */
function renderRaidRecommendations(rec, reviewer) {
    const raid = reviewer ? (rec.raid || []) : (rec.raid || []).filter((i) => i.approved === true);
    if (!raid.length) return "<div class=\"rlist rec-list\"><div class=\"rec-empty\">Nichts, was den ganzen Raid gekostet hätte.</div></div>";
    return `<div class="rlist rec-list">${raid.map((i) => recItem(i, "raid", "", reviewer)).join("")}</div>`;
}

// "Alle auf- oder zuklappen" for the raider cards: opens all visible cards unless all are open already.
const CARDS_SCRIPT = `<script>(function(){if(window.__ehCards)return;window.__ehCards=1;
document.addEventListener("click",function(e){var b=e.target.closest("[data-cards]");if(!b)return;var cards=[].slice.call(document.querySelectorAll(".raider-card")).filter(function(d){return !d.hidden;});var open=b.getAttribute("data-cards")==="open"||(b.getAttribute("data-cards")==="toggle"&&cards.some(function(d){return !d.open;}));
cards.forEach(function(d){d.open=open;});});})();</script>`;

/**
 * The body of the "Alle senden" dialog for reviewers: how many raiders have
 * approved points, who was already written to, the mapping check, the
 * phrasing job and the button that sends the rest as Discord DMs. The
 * per-raider mapping state is loaded from /api/cla/recommendations/send on
 * demand, so the page itself needs no store access.
 */
function renderSendBox(report) {
    const rec = reviewedRecommendations(report);
    const approved = (rec.players || []).filter((p) => p.items.some((i) => i.approved === true));
    const sent = report.recommendationSent || {};
    const sentNames = approved.filter((p) => sent[p.name]);
    const phrase = report.recommendationPhrase;
    const phraseBadge = phrase
        ? `<span class="badge accent rec-phrase-meta" data-tip="${esc(`KI-Formulierung vom ${new Date(phrase.at).toLocaleString("de-DE")}`)}" data-tip-sub="${esc(`${phrase.model}: ${phrase.phrased} Texte für ${phrase.players} Raider${(phrase.errors || []).length ? `, ${phrase.errors.length} Fehler` : ""}`)}">${hicon("inv_scroll_03", "")}${esc(phrase.phrased)} KI-Texte</span>`
        : "";
    return `<div class="rec-send" data-report="${esc(report.id)}">
      <div class="badges rec-send-meta">${badge(`${approved.length} Raider mit freigegebenen Punkten`, approved.length ? "ok" : "", "inv_misc_note_01")}${badge(`${sentNames.length} bereits angeschrieben`, "", "inv_letter_15")}${phraseBadge}</div>
      <div class="dtools">
        <button type="button" class="btn btn-ghost btn-sm" data-send="status">${LINE.search}Zuordnung prüfen</button>
        <button type="button" class="btn btn-run btn-sm" data-phrase="all" data-tip="Claude formuliert jeden Befund in Klartext" data-tip-sub="Deine Freigabe bleibt nötig; der Regeltext bleibt erhalten.">${hicon("inv_scroll_03", "")}KI-Formulierung</button>
        <span class="grow"></span>
        <button type="button" class="btn btn-sm" data-send="all"${approved.length ? "" : " disabled"}>${hicon("inv_letter_15", "")}Freigegebenes per DM senden</button>
      </div>
      <div class="rec-send-result" hidden></div>
    </div>${SEND_SCRIPT}${PHRASE_SCRIPT}`;
}

// The send button posts once and lists who got a DM and who was skipped and why;
// "Zuordnung prüfen" fetches the per-raider mapping state without sending.
// "KI-Formulierung": starts the phrasing job and polls until it is done,
// then reloads so the rows show Claude's texts.
const PHRASE_SCRIPT = `<script>(function(){if(window.__ehPhrase)return;window.__ehPhrase=1;
var token=null;function csrf(){return token?Promise.resolve(token):fetch("/api/session",{credentials:"same-origin"}).then(function(r){return r.json()}).then(function(j){token=j.csrfToken||(j.data&&j.data.csrfToken)||"";return token;});}
document.addEventListener("click",function(e){var b=e.target.closest("[data-phrase]");if(!b)return;var box=b.closest("[data-report]"),out=box.querySelector(".rec-send-result"),id=box.getAttribute("data-report"),who=box.getAttribute("data-name")||"";out.hidden=false;out.textContent="KI-Formulierung läuft …";b.disabled=true;
function poll(){return fetch("/api/cla/recommendations/phrase?id="+encodeURIComponent(id),{credentials:"same-origin"}).then(function(r){return r.json()}).then(function(j){var job=j.data&&j.data.job;if(!job||job.status==="running"){return new Promise(function(res){setTimeout(res,2500);}).then(poll);}if(job.status==="error")throw new Error(job.error||"fehlgeschlagen");return j.data;});}
csrf().then(function(t){return fetch("/api/cla/recommendations/phrase",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json","X-CSRF-Token":t},body:JSON.stringify(who?{reportId:id,players:[who]}:{reportId:id})});}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error((j&&j.error&&j.error.message)||r.status);return j;});}).then(poll)
.then(function(d){var l=d.last||{};out.textContent="Fertig: "+(l.phrased||0)+" Texte für "+(l.players||0)+" Raider"+((l.errors||[]).length?", "+l.errors.length+" Fehler":"")+". Seite wird neu geladen …";setTimeout(function(){location.reload();},1200);})
.catch(function(err){out.textContent="Fehler: "+err.message;b.disabled=false;});});})();</script>`;

const SEND_SCRIPT = `<script>(function(){if(window.__ehSend)return;window.__ehSend=1;
var token=null;function csrf(){return token?Promise.resolve(token):fetch("/api/session",{credentials:"same-origin"}).then(function(r){return r.json()}).then(function(j){token=j.csrfToken||(j.data&&j.data.csrfToken)||"";return token;});}
function row(cls,t){var d=document.createElement("div");d.className="rec-send-row "+cls;d.textContent=t;return d;}
document.addEventListener("click",function(e){var b=e.target.closest("[data-send]");if(!b)return;var box=b.closest(".rec-send"),out=box.querySelector(".rec-send-result"),id=box.getAttribute("data-report");out.hidden=false;out.textContent="…";
var p;if(b.getAttribute("data-send")==="status"){p=fetch("/api/cla/recommendations/send?id="+encodeURIComponent(id),{credentials:"same-origin"}).then(function(r){return r.json()}).then(function(j){out.textContent="";var list=(j.data&&j.data.players)||[];if(!list.length)out.appendChild(row("muted","Nichts freigegeben."));list.forEach(function(x){out.appendChild(row(x.mapped?"ok":"warn",x.name+": "+x.approved+" Punkte · "+(x.mapped?"Konto zugeordnet":x.ambiguous?"mehrere Konten":"kein Konto zugeordnet")+(x.sentAt?" · gesendet "+new Date(x.sentAt).toLocaleString("de-DE")+(x.changed?" (seitdem geändert)":""):"")));});});}
else{if(!confirm("Jetzt allen Raidern ihre freigegebenen Punkte als Discord-DM senden?")){out.hidden=true;return;}b.disabled=true;p=csrf().then(function(t){return fetch("/api/cla/recommendations/send",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json","X-CSRF-Token":t},body:JSON.stringify({reportId:id})});}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error((j&&j.error&&j.error.message)||r.status);return j.data;});}).then(function(d){out.textContent="";out.appendChild(row("ok",d.message));(d.sent||[]).forEach(function(s){out.appendChild(row("ok","Gesendet: "+s.name+" ("+s.items+" Punkte)"));});(d.skipped||[]).forEach(function(s){out.appendChild(row("warn","Übersprungen: "+s.name+": "+s.message));});}).finally(function(){b.disabled=false;});}
p.catch(function(err){out.textContent="Fehler: "+err.message;});});})();</script>`;

// Verdict buttons and the text box post to /api/cla/recommendations. The CSRF
// token is fetched once from /api/session, the page never carries it. A click
// on the active verdict takes it back; the pencil opens the row's text editor.
const REVIEW_SCRIPT = `<script>(function(){if(window.__ehReview)return;window.__ehReview=1;
var token=null;function csrf(){return token?Promise.resolve(token):fetch("/api/session",{credentials:"same-origin"}).then(function(r){return r.json()}).then(function(j){token=j.csrfToken||(j.data&&j.data.csrfToken)||"";return token;});}
var reportId=(location.pathname.match(/^\\/r\\/([a-zA-Z0-9]+)/)||[])[1];
var LBL={approved:"freigegeben",rejected:"nicht senden",open:"offen"},TONE={approved:"ok",rejected:"bad",open:"mid"};
document.addEventListener("click",function(e){var b=e.target.closest("[data-review]");if(!b)return;if(b.closest("summary"))e.preventDefault();var li=b.closest(".rec");if(!li)return;var box=li.querySelector(".rec-review"),st=li.querySelector(".rec-status"),a=b.getAttribute("data-review");
if(a==="edit"){li.open=true;var ed=li.querySelector(".rec-edit");if(ed){ed.hidden=false;var ta=ed.querySelector("textarea");if(ta)ta.focus();}return;}
if(a==="rule"){var r=li.querySelector(".rec-rule");if(r){r.hidden=!r.hidden;b.lastChild.textContent=r.hidden?"Regeltext zeigen":"Regeltext verbergen";}return;}
if(!box)return;var body={reportId:reportId,scope:box.getAttribute("data-scope"),player:box.getAttribute("data-player"),key:box.getAttribute("data-key")};
if(a==="approve")body.approved=li.classList.contains("rec-state-approved")?null:true;else if(a==="reject")body.approved=li.classList.contains("rec-state-rejected")?null:false;else if(a==="reset")body.approved=null;else if(a==="save")body.text=li.querySelector(".rec-text").value;
if(st)st.textContent="…";csrf().then(function(t){return fetch("/api/cla/recommendations",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json","X-CSRF-Token":t},body:JSON.stringify(body)});}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error((j&&j.error&&j.error.message)||(j&&j.message)||r.status);return j;});})
.then(function(){if(a!=="save"){var s=body.approved===true?"approved":body.approved===false?"rejected":"open";li.className=li.className.replace(/rec-state-\\w+/,"rec-state-"+s);var lbl=li.querySelector(".rec-state");if(lbl){lbl.textContent=LBL[s];lbl.className="badge rec-state "+TONE[s];}
var ap=box.querySelector("[data-review=approve]"),rj=box.querySelector("[data-review=reject]");if(ap)ap.classList.toggle("ok",s==="approved");if(rj)rj.classList.toggle("bad",s==="rejected");}
if(a==="save"){var p=li.querySelector(".rec-body");if(p&&body.text)p.textContent=body.text;}if(st){st.textContent="gespeichert";setTimeout(function(){st.textContent="";},1500);}})
.catch(function(err){li.open=true;if(st)st.textContent="Fehler: "+err.message;});});})();</script>`;

/// ---- report head: the four KPI cards ------------------------------------------

function kpi(icon, label, value, sub, tone, valueTone, tip, tipSub) {
    return `<div class="kpi${tone ? ` tone-${tone}` : ""}"${tip ? ` data-tip="${esc(tip)}"` : ""}${tipSub ? ` data-tip-sub="${esc(tipSub)}"` : ""}>
      <div class="kicker icons">${hicon(icon, "")}${esc(label)}</div>
      <div class="kpi-v${valueTone ? ` ${valueTone}` : ""}">${value}${sub ? ` <small${sub.bad ? " class=\"bad\"" : ""}>· ${esc(sub.text)}</small>` : ""}</div>
    </div>`;
}

/**
 * Headline numbers: bosses (kills/wipes), deaths (avoidable), open
 * recommendations (for a reviewer; approved ones for everyone else) and the
 * flask/elixir coverage. Every card only when its source is there.
 */
function kpiCards(report, ctx) {
    const out = [];
    const fights = (report.timeline && report.timeline.fights) || [];
    const rows = (report.bossUptimes && report.bossUptimes.rows) || [];
    if (fights.length) {
        const bosses = groupByBoss(fights);
        const kills = fights.filter((f) => f.kill).length;
        out.push(kpi("achievement_boss_illidan", "Bosse", String(bosses.length), { text: `${kills} Kill${kills === 1 ? "" : "s"}, ${fights.length - kills} Wipe${fights.length - kills === 1 ? "" : "s"}` }, "", "", "Bosse im Log, dahinter die Tries als Kills und Wipes", "Ein Boss mit mehreren Tries zählt einmal; seine Tries stehen auf seiner Karte in der Sicht Bosse."));
    } else if (rows.length) {
        const kills = rows.filter((r) => r.kill).length;
        out.push(kpi("achievement_boss_illidan", "Bosse", String(rows.length), { text: `${kills} Kill${kills === 1 ? "" : "s"}, ${rows.length - kills} Wipe${rows.length - kills === 1 ? "" : "s"}` }));
    }
    const mech = report.mechanics && report.mechanics.deaths;
    if (mech) {
        out.push(kpi("ability_creature_cursed_05", "Tode", String(mech.total), mech.avoidable ? { text: `${mech.avoidable} vermeidbar`, bad: true } : null, "high", mech.avoidable ? "bad" : "", "Tode in allen Boss-Kämpfen", "Vermeidbar: der Todesstoß kam von einer Mechanik, der man ausweichen kann. Wer woran starb, steht unter „Mechaniken & Tode“."));
    } else if (fights.length) {
        const n = fights.reduce((s, f) => s + (f.deaths || []).length, 0);
        out.push(kpi("ability_creature_cursed_05", "Tode", String(n), null, "high"));
    } else if (report.rpb && report.rpb.damage && (report.rpb.damage.players || []).length) {
        const n = report.rpb.damage.players.reduce((s, p) => s + (p.deaths || 0), 0);
        out.push(kpi("ability_creature_cursed_05", "Tode", String(n), null, "high"));
    }
    if (ctx.rec) {
        const players = ctx.rec.players || [];
        if (ctx.reviewer) {
            const open = ctx.recItems.filter((i) => i.approved === null).length;
            const withOpen = players.filter((p) => p.items.some((i) => i.approved === null)).length;
            out.push(kpi("inv_misc_note_01", "Offene Empfehlungen", String(open), { text: `bei ${withOpen} von ${players.length} Raidern` }, "medium", open ? "" : "good", "Befunde, die noch niemand freigegeben oder verworfen hat", "Erst freigegebene Punkte gehen per Bot an die Raider. Entscheiden kannst du in der Sicht Raider und unter „Empfehlungen an den Raid“."));
        } else {
            const approved = ctx.recItems.filter((i) => i.approved === true).length;
            const withApproved = players.filter((p) => p.items.some((i) => i.approved === true)).length;
            out.push(kpi("inv_misc_note_01", "Empfehlungen", String(approved), { text: `freigegeben · bei ${withApproved} Raidern` }, "medium", "", "Vom Raidlead freigegebene Empfehlungen", "Nur freigegebene Punkte sind auf dieser Seite sichtbar."));
        }
    }
    const cons = (report.consumables && report.consumables.players) || [];
    if (cons.length) {
        const avg = (key) => Math.round(cons.reduce((n, p) => n + (p[key] || 0), 0) / cons.length);
        const buffed = avg("buffed");
        out.push(kpi("inv_alchemy_endlessflask_05", "Flask / Elixiere", `${buffed} %`, { text: `Ø Food ${avg("food")} %` }, "good", buffed >= 90 ? "good" : buffed < 50 ? "bad" : "warn", "Anteil der Boss-Kämpfe, in denen ein Raider ein Flask oder beide Elixiere hatte, im Mittel über den Raid", "Ø Food: dasselbe für den Essensbuff. Ab 90 % grün, unter 50 % rot. Je Raider unter „Consumables“."));
    }
    if (!out.length) {
        const gearIssues = (report.players || []).reduce((n, p) => n + (p.issues || []).length, 0);
        out.push(kpi("inv_shield_06", "Gear-Probleme", String(gearIssues), { text: `bei ${(report.players || []).length} Spieler(n)` }, gearIssues ? "high" : "good", gearIssues ? "bad" : "good", "Fehlende oder schwache Verzauberungen, leere Sockel und inaktive Meta-Gems", "Aus der Ausrüstung, die Warcraft Logs beim Pull gesehen hat."));
    }
    return `<div class="kpis">${out.join("")}</div>`;
}

// --- RPB (Role Performance Breakdown) panels ------------------------------

/** Thousands-separated number for the damage tables. */
function num(n) {
    return Math.round(n || 0).toLocaleString("de-DE");
}

/** Group rows by the role the RPB assigned, in the sheet's own role order. */
const RPB_ROLE_ORDER = ["Tank", "Healer", "Caster", "Physical"];

/** The RPB role of a raider; everyone the sheet did not place is Physical, as the sheet itself does. */
function rpbRole(roles, name) {
    return (roles && roles[name]) || "Physical";
}

/** Rows in the sheet's own role order (tanks, healers, casters, melee), the given order inside a role. */
function sortByRole(rows, roles) {
    const rank = (r) => {
        const i = RPB_ROLE_ORDER.indexOf(rpbRole(roles, r.name));
        return i < 0 ? RPB_ROLE_ORDER.length : i;
    };
    return rows.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((x) => x.r);
}

// German label + icon per RPB role, for the role segment of the detail dialogs.
const ROLE_META = {
    Tank: { label: "Tanks", icon: "inv_shield_06" },
    Healer: { label: "Heiler", icon: "spell_holy_flashheal" },
    Caster: { label: "Caster", icon: "spell_fire_flamebolt" },
    Physical: { label: "Nahkampf", icon: "ability_dualwield" },
};

/** `data-role` / `data-name` of one raider's row or column cell, for the tool row's filter. */
function roleAttrs(roles, name) {
    return ` data-role="${esc(rpbRole(roles, name))}" data-name="${esc(name)}"`;
}

/**
 * The tool row of an RPB table: one role segment (Alle / Tanks / Heiler /
 * Caster / Nahkampf with their counts), the raider search and — for the
 * damage table — two icon buttons for the orientation. Replaces the role tabs,
 * the orientation switch and the colour legend in one line.
 */
function rpbTools(rows, roles, orient) {
    const counts = {};
    for (const r of rows) {
        const k = rpbRole(roles, r.name);
        counts[k] = (counts[k] || 0) + 1;
    }
    const btn = (key, label, icon, n, active) => `<button type="button" class="seg-btn${active ? " active" : ""}" data-frole="${esc(key)}">${icon ? hicon(icon, "") : ""}${esc(label)}<span class="n">${esc(n)}</span></button>`;
    const seg = [btn("all", "Alle", "", rows.length, true), ...RPB_ROLE_ORDER.filter((r) => counts[r]).map((r) => btn(r, ROLE_META[r].label, ROLE_META[r].icon, counts[r], false))].join("");
    const o = orient
        ? `<nav class="seg sm"><button type="button" class="seg-btn active" data-orient="p" data-tip="Spieler als Zeilen" aria-label="Spieler als Zeilen">${LINE.rows}</button><button type="button" class="seg-btn" data-orient="a" data-tip="Fähigkeiten als Zeilen" aria-label="Fähigkeiten als Zeilen">${LINE.cols}</button></nav>`
        : "";
    return `<div class="dtools"><nav class="seg sm">${seg}</nav><span class="grow"></span><label class="field">${LINE.search}<input type="search" data-fsearch placeholder="Raider suchen …" aria-label="Raider suchen"></label>${o}</div>`;
}

const DMG_SCALE_HOW = "Der Balken ist der Anteil am höchsten Wert dieser Spalte im ganzen Raid, also über alle Rollen vergleichbar. Ab 50 % gelb, ab 75 % rot.";

/**
 * A damage number as a WCL bar of fixed width: its share of the highest value
 * in the same column raid-wide (not just within the role, so a tank with two
 * rows does not paint one of them red for a harmless difference).
 */
function dmgCell(v, max) {
    if (!(v > 0)) return "<span class=\"mute mono\">·</span>";
    const share = max > 0 ? v / max : 0;
    return barCell(num(v), share * 100, share >= 0.75 ? "high" : share >= 0.5 ? "medium" : "");
}

/** Column head for one avoidable ability: its icon, the NPCs that cast it and the scale in the tooltip. */
function abilityHead(a) {
    const src = a.sources && a.sources.length ? `Quelle: ${a.sources.join(", ")}. ` : "";
    return `<th class="n" data-tip="${esc(a.label)}" data-tip-sub="${esc(src + DMG_SCALE_HOW)}">${abilityIcon(a)}${esc(a.label)}</th>`;
}

/** Small inline icon for an avoidable ability, config icon as the fallback. */
function abilityIcon(a) {
    const icon = a.icon || ICON_BY_NAME[a.name];
    return icon ? `<img class="hicon" src="${esc(iconUrl(icon))}" alt="" loading="lazy">` : "";
}

/** Highest value per ability column (and per summary column) across the whole raid. */
function damageScale(damage) {
    const abilities = damage.abilities || [];
    const players = damage.players || [];
    const perAbility = abilities.map((a, i) => Math.max(0, ...players.map((p) => p.perAbility[i] || 0)));
    return {
        perAbility,
        total: Math.max(0, ...players.map((p) => p.avoidableTotal || 0)),
        reflected: Math.max(0, ...players.map((p) => p.reflected || 0)),
        hostile: Math.max(0, ...players.map((p) => p.hostile || 0)),
    };
}

const deathBadge = (n) => badge(String(n || 0), n > 0 ? "bad" : "ok", "", true);

/** Players as rows, abilities as columns (the classic orientation). */
function damageByPlayer(abilities, list, linkFor, scale, roles) {
    const head = abilities.map(abilityHead).join("");
    const body = list.map((p) => {
        const cells = abilities.map((a, i) => `<td class="n">${dmgCell(p.perAbility[i], scale.perAbility[i])}</td>`).join("");
        return `<tr${roleAttrs(roles, p.name)}>
          <td class="pcol">${classCell(p, linkFor(p.name))}</td>
          ${cells}
          <td class="n">${dmgCell(p.avoidableTotal, scale.total)}</td>
          <td class="n">${dmgCell(p.reflected, scale.reflected)}</td>
          <td class="n">${dmgCell(p.hostile, scale.hostile)}</td>
          <td class="n">${deathBadge(p.deaths)}</td>
        </tr>`;
    }).join("");
    return `<div class="tbox scrollx"><table class="idx rpb fixed">
      <tr><th class="pcol">Spieler</th>${head}<th class="n" data-tip="Summe" data-tip-sub="${esc(`Vermeidbarer Schaden über alle Fähigkeiten. ${DMG_SCALE_HOW}`)}">Summe</th><th class="n" data-tip="Reflektiert" data-tip-sub="Auf den Raider zurückgeworfener Schaden.">Reflektiert</th><th class="n" data-tip="Auf Spieler" data-tip-sub="Schaden, den der Raider unter Gedankenkontrolle o. Ä. an Mitspielern verursacht hat.">Auf Spieler</th><th class="n">Tode</th></tr>
      ${body}
    </table></div>`;
}

/** Abilities as rows, one column per raider — the transposed view; every cell of a raider's column carries their role for the filter. */
function damageByAbility(abilities, list, linkFor, scale, roles) {
    const head = list.map((p) => {
        const href = linkFor(p.name);
        const inner = `<span class="rcol-in"><img src="${esc(classIconUrl(p.type))}" alt=""><span>${esc(p.name)}</span></span>`;
        return `<th class="rcol"${roleAttrs(roles, p.name)} data-tip="${esc(p.name)}" data-tip-sub="${esc(p.type)}">${href ? `<a href="${esc(href)}" style="text-decoration:none">${inner}</a>` : inner}</th>`;
    }).join("");
    const cell = (p, html) => `<td class="n"${roleAttrs(roles, p.name)}>${html}</td>`;

    const abilityRows = abilities.map((a, i) => {
        const cells = list.map((p) => cell(p, dmgCell(p.perAbility[i], scale.perAbility[i]))).join("");
        const sub = a.sources && a.sources.length ? ` data-tip-sub="${esc(a.sources.join(", "))}"` : "";
        return `<tr><td class="pcol" data-tip="${esc(a.label)}"${sub}>${abilityIcon(a)}${esc(a.label)}</td>${cells}</tr>`;
    }).join("");

    const sumRow = (label, pick, max) => `<tr><td class="pcol"><strong>${esc(label)}</strong></td>${list.map((p) => cell(p, dmgCell(pick(p), max))).join("")}</tr>`;
    const deathRow = `<tr><td class="pcol"><strong>Tode</strong></td>${list.map((p) => cell(p, deathBadge(p.deaths))).join("")}</tr>`;

    return `<div class="tbox scrollx"><table class="idx rpb fixed">
      <tr><th class="pcol">Fähigkeit</th>${head}</tr>
      ${abilityRows}
      ${sumRow("Summe", (p) => p.avoidableTotal, scale.total)}
      ${sumRow("Reflektiert", (p) => p.reflected, scale.reflected)}
      ${sumRow("Auf Spieler", (p) => p.hostile, scale.hostile)}
      ${deathRow}
    </table></div>`;
}

function renderRpbDamagePanel(damage, roles, linkFor) {
    if (!damage || !damage.players || damage.players.length === 0) {
        return "<div class=\"empty\">Keine Schadensdaten gefunden.</div>";
    }
    const abilities = damage.abilities || [];
    const scale = damageScale(damage);
    const list = sortByRole(damage.players, roles);
    return `<div class="dscope">${rpbTools(list, roles, true)}
      <div class="tview tview-p">${damageByPlayer(abilities, list, linkFor, scale, roles)}</div>
      <div class="tview tview-a">${damageByAbility(abilities, list, linkFor, scale, roles)}</div>
    </div>`;
}

const RPB_ACTIVITY_HOW = "Rekonstruierte Aktivität: getrackte Zauber × Zauberzeit, abzüglich Tempo-Effekten, geteilt durch die Kampfzeit des Raids. Für Nahkämpfer ungenau, weil der Combat Log keine Autoattacks erfasst.";

function renderRpbActivityPanel(activity, roles, linkFor) {
    if (!activity || !activity.players || activity.players.length === 0) {
        return "<div class=\"empty\">Keine Aktivitätsdaten gefunden.</div>";
    }
    const list = sortByRole(activity.players, roles);
    const body = list.map((p) => {
        const haste = p.gearSpellHaste
            ? ` data-tip="${esc(p.name)}" data-tip-sub="Zaubertempo aus Ausrüstung: ${esc(p.gearSpellHaste)}"`
            : "";
        return `<tr${roleAttrs(roles, p.name)}>
          <td class="pcol"${haste}>${classCell(p, linkFor(p.name))}</td>
          <td class="n"><strong>${esc(p.secondsActive)}s</strong></td>
          <td class="n">${uptimeCell(p.relativeTotal)}</td>
          <td class="n">${esc(p.secondsActiveST)}s</td>
          <td class="n">${esc(p.secondsActiveAoe)}s</td>
          <td class="n">${esc(p.hasteSecondsSubtracted)}s</td>
        </tr>`;
    }).join("");
    return `<div class="dscope">${rpbTools(list, roles, false)}<div class="tbox scrollx"><table class="idx rpb fixed">
      <tr><th class="pcol">Spieler</th><th class="n" data-tip="Aktiv gesamt" data-tip-sub="${esc(RPB_ACTIVITY_HOW)}">Aktiv gesamt</th><th class="n" data-tip="Anteil Raidzeit" data-tip-sub="${esc(`Aktive Zeit geteilt durch die Kampfzeit des Raids (${activity.raidSeconds}s). Ab 95 % grün, ab 70 % gelb.`)}">Anteil Raidzeit</th><th class="n">Einzelziel</th><th class="n">Fläche</th><th class="n" data-tip="Tempo-Abzug" data-tip-sub="Abzug für Tempo-Effekte">Tempo-Abzug</th></tr>
      ${body}
    </table></div></div>`;
}

/**
 * Which spells each raider actually cast, as icons with their cast count.
 *
 * The data for this already fell out of the activity analysis (it has to count
 * every tracked cast to reconstruct active time) — it was simply never shown.
 * The interesting part is the rank: the config sheet knows every rank of every
 * tracked spell, so a cast on anything but the highest rank can be flagged.
 */
function spellTiles(rows) {
    return rows.filter((r) => r.amount > 0).map((r) => {
        const notes = [];
        if (r.uptimePercent !== undefined) notes.push(`Uptime ${r.uptimePercent}%`);
        if (r.lowerRankPercent) notes.push(`${r.lowerRankPercent}% niedriger Rang (${r.lowerRankCasts}×)`);
        return iconTile({
            icon: r.icon,
            name: r.name,
            spellId: r.spellId,
            label: r.label || r.name,
            count: r.amount,
            note: notes.join(" · "),
            tone: r.mostlyLowerRank ? "warn" : "",
        });
    });
}

const SPELLS_HOW = "Jedes Icon ist ein getrackter Zauber, die Zahl daran die Anzahl der Casts; ein Klick öffnet Wowhead. Rot umrandet: überwiegend in einem niedrigeren Rang gecastet.";

function renderRpbSpellsPanel(activity, roles, linkFor) {
    const players = (activity && activity.players) || [];
    const withSpells = players.filter((p) => (p.singleTargetCasts || []).length || (p.aoeCasts || []).length);
    if (withSpells.length === 0) return "<div class=\"empty\">Keine getrackten Zauber gefunden.</div>";
    const list = sortByRole(withSpells, roles);
    const body = list.map((p) => {
        const st = p.singleTargetCasts || [];
        const aoe = p.aoeCasts || [];
        const downranked = [...st, ...aoe].filter((r) => r.mostlyLowerRank);
        const rankCell = downranked.length
            ? `<span class="badge bad count" data-tip="Nicht im höchsten Rang" data-tip-sub="${esc(downranked.map((r) => r.label || r.name).join(", "))}">${downranked.length}</span>`
            : badge("0", "ok", "", true);
        return `<tr${roleAttrs(roles, p.name)}>
          <td class="pcol">${classCell(p, linkFor(p.name))}</td>
          <td>${iconRow(spellTiles(st))}</td>
          <td>${iconRow(spellTiles(aoe))}</td>
          <td class="n">${rankCell}</td>
        </tr>`;
    }).join("");
    return `<div class="dscope">${rpbTools(list, roles, false)}<div class="tbox scrollx"><table class="idx rpb">
      <tr><th class="pcol">Spieler</th><th data-tip="Einzelziel" data-tip-sub="${esc(SPELLS_HOW)}">Einzelziel</th><th data-tip="Fläche" data-tip-sub="${esc(SPELLS_HOW)}">Fläche</th><th class="n" data-tip="Rang-Warnungen" data-tip-sub="Anzahl der Zauber, die ein Raider überwiegend in einem niedrigeren Rang gecastet hat.">Rang-Warnungen</th></tr>
      ${body}
    </table></div></div>`;
}

function renderRpbInterruptsPanel(interrupts, linkFor) {
    if (!interrupts || !interrupts.players || interrupts.players.length === 0) {
        return "<div class=\"empty\">Keine Unterbrechungen gefunden.</div>";
    }
    const max = Math.max(1, ...interrupts.players.map((p) => Number(p.count) || 0));
    const body = interrupts.players.map((p) => {
        const spells = (p.spells || []).map((s) => iconTile({
            icon: s.icon, spellId: s.spellId, label: s.name, count: s.count,
        }));
        const kicks = (p.kicks || []).map((k) => `${esc(k.name)} ×${k.count}`).join(", ");
        return `<tr>
          <td class="pcol">${classCell(p, linkFor(p.name))}</td>
          <td>${barCell(String(p.count), ((Number(p.count) || 0) / max) * 100, "")}</td>
          <td>${iconRow(spells)}</td>
          <td class="sritems">${kicks || "–"}</td>
        </tr>`;
    }).join("");
    return `<div class="tbox scrollx"><table class="idx rpb">
      <tr><th class="pcol">Spieler</th><th data-tip="Unterbrechungen" data-tip-sub="Welche gegnerischen Zauber wer unterbrochen hat. Der Balken ist der Anteil am höchsten Wert im Raid.">Unterbrechungen</th><th>Unterbrochene Zauber</th><th>Eingesetzt mit</th></tr>
      ${body}
    </table></div>`;
}

function renderRpbValidationPanel(v) {
    if (!v) return "<div class=\"empty\">Keine Validierungsdaten.</div>";
    const zones = (v.zones || []).join(", ") || "unbekannt";
    const unmet = (v.requirements || []).filter((r) => !r.ok).length;
    const verdict = !v.requirements || !v.requirements.length
        ? ""
        : v.valid ? badge("Trash-Anforderungen erfüllt", "ok") : badge(`${unmet} Anforderung${unmet === 1 ? "" : "en"} nicht erfüllt`, "bad");
    const header = `<div class="badges">${badge(`Zone: ${zones}`, "")}${badge(`${v.bossesKilled} / ${v.bossesTotal} Bosse gelegt`, v.bossesKilled >= v.bossesTotal ? "ok" : "mid", "achievement_boss_illidan")}${verdict}</div>`;

    if (!v.requirements || v.requirements.length === 0) {
        return `${header}<div class="empty">${esc(v.note || "Keine Trash-Anforderungen hinterlegt.")}</div>`;
    }
    const body = v.requirements.map((r) => `<tr>
      <td class="pcol">${esc(r.label)}</td>
      <td>${esc(r.zone)}</td>
      <td class="n"><strong>${esc(r.killed)}</strong></td>
      <td class="n">${esc(r.minimum)}</td>
      <td class="n">${badge(r.ok ? "ok" : "zu wenig", r.ok ? "ok" : "bad")}</td>
    </tr>`).join("");

    return `${header}
    <div class="tbox scrollx"><table class="idx rpb">
      <tr><th class="pcol">Trash</th><th>Zone</th><th class="n">Gelegt</th><th class="n">Nötig</th><th class="n"></th></tr>
      ${body}
    </table></div>`;
}

const USAGE_HOW = "Die Zahl am Icon ist die Anzahl der Einsätze. Bei Cooldowns steht im Tooltip, wie viele in der Bosskampfzeit theoretisch möglich gewesen wären (Kampfzeit ÷ Abklingzeit, eine grobe Obergrenze). Rot: weniger als die Hälfte davon.";

function renderRpbUsagePanel(usage, roles, linkFor) {
    if (!usage || usage.length === 0) return "<div class=\"empty\">Keine Nutzungsdaten gefunden.</div>";
    const withData = usage.filter((u) => (u.classCooldowns || []).length || (u.trinketsAndRacials || []).length
        || (u.engineering || []).length || (u.absorbs || []).length);
    if (withData.length === 0) return "<div class=\"empty\">Keine Cooldowns oder Schmuckstücke erfasst.</div>";
    const list = sortByRole(withData, roles);
    const body = list.map((p) => {
        const cds = (p.classCooldowns || []).map((c) => {
            // fewer than half the theoretically possible uses reads as "sat on it"
            const under = c.possibleUses && c.total < c.possibleUses / 2;
            return iconTile({
                icon: c.icon,
                name: c.name,
                spellId: c.spellId,
                label: c.label,
                count: c.total,
                note: c.possibleUses ? `${c.total} von ~${c.possibleUses} möglichen` : "",
                tone: under ? "warn" : "good",
            });
        });
        const trinkets = (p.trinketsAndRacials || []).map((t) => iconTile({
            icon: t.icon, name: t.name, spellId: t.spellId, label: t.label, count: t.total,
        }));
        const consumables = [...(p.engineering || []), ...(p.absorbs || [])].map((t) => iconTile({
            icon: t.icon, name: t.name, spellId: t.spellId, label: t.label, count: t.total,
        }));
        return `<tr${roleAttrs(roles, p.name)}>
          <td class="pcol">${classCell(p, linkFor(p.name))}</td>
          <td>${iconRow(cds)}</td>
          <td>${iconRow(trinkets)}</td>
          <td>${iconRow(consumables)}</td>
        </tr>`;
    }).join("");
    return `<div class="dscope">${rpbTools(list, roles, false)}<div class="tbox scrollx"><table class="idx rpb">
      <tr><th class="pcol">Spieler</th><th data-tip="Klassen-Cooldowns" data-tip-sub="${esc(USAGE_HOW)}">Klassen-Cooldowns</th><th>Schmuckstücke &amp; Rassenfertigkeiten</th><th>Ingenieurskunst &amp; Schilde</th></tr>
      ${body}
    </table></div></div>`;
}

// ---- the report page: head, KPI cards, three views -------------------------------
//
// Sicht Raid: everything raid-wide as foldable sections. Sicht Bosse: one card
// per boss (bossCard). Sicht Raider: one card per raider (raiderCard), with a
// search field and a role filter. The open view sits in the url hash
// (#raid / #bosse / #raider, #raider-<name> opens one card), so a link from
// Discord or the admin menu lands on the right place.

function byName(list) {
    const m = new Map();
    for (const p of list || []) if (p && p.name) m.set(p.name, p);
    return m;
}

const ROLE_LABEL = { tank: "Tank", healer: "Heiler", dps: "DPS" };

/**
 * Everything the three views share, computed once: links, review rights, the
 * reviewed recommendations, each raider's role and the per-raider slices of
 * every raid-wide summary.
 */
function reportContext(report, user) {
    const idxByName = {};
    (report.roster || []).forEach((p, i) => { idxByName[p.name] = i; });
    const linkFor = (name) => (idxByName[name] !== undefined ? `/r/${report.id}/p/${idxByName[name]}` : null);
    const reviewer = canReview(user);
    const rec = report.recommendations ? applyReview(report.recommendations, report.recommendationReview) : null;
    const recItems = rec ? [...rec.raid, ...rec.players.flatMap((p) => p.items)] : [];
    const fights = (report.timeline && report.timeline.fights) || [];
    // Role: a healer of the healers' analysis, WCL's tank of any fight, else DPS; the RPB's roles fill in for a report without the timeline analyzers.
    const healers = new Set(((report.healers && report.healers.players) || []).map((p) => p.name));
    const tanks = new Set(fights.map((f) => f.healers && f.healers.tank && f.healers.tank.name).filter(Boolean));
    for (const [name, role] of Object.entries((report.rpb && report.rpb.roles) || {})) {
        if (role === "Tank") tanks.add(name);
        else if (role === "Healer") healers.add(name);
    }
    const roleOf = (name) => (tanks.has(name) ? "tank" : healers.has(name) ? "healer" : "dps");
    const rpb = report.rpb || {};
    return {
        report, user, linkFor, reviewer, rec, recItems, roleOf, fights,
        recByName: byName(rec ? rec.players : []),
        gearByName: byName(report.players),
        consByName: byName(report.consumables && report.consumables.players),
        potByName: byName(report.potions && report.potions.players),
        buffsByName: byName(report.raidBuffs && report.raidBuffs.players),
        healByName: byName(report.healers && report.healers.players),
        actByName: byName(report.activity && report.activity.players),
        cdByName: byName(report.cooldowns && report.cooldowns.players),
        totByName: byName(report.totems && report.totems.players),
        mechByName: byName(report.mechanics && report.mechanics.players),
        drumsByName: byName(report.drums && report.drums.players),
        srByName: byName(report.shadowResi && report.shadowResi.players),
        sunderByName: byName(report.sunder),
        rpbDmgByName: byName(rpb.damage && rpb.damage.players),
        rpbActByName: byName(rpb.activity && rpb.activity.players),
        rpbUseByName: byName(rpb.usage),
        rpbIntByName: byName(rpb.interrupts && rpb.interrupts.players),
        sent: report.recommendationSent || {},
    };
}

// ---- Sicht Raid: four groups (Empfehlungen · Vorbereitung · Leistung · Fehler) ----
//
// Every raid-wide part is a metric card: one value, one or two badges and the
// raiders who stand out; the explanation sits in the tooltip of its title and
// the full table opens as a detail dialog. The render*Summary / render*Panel
// functions are those dialogs' bodies.

const sumOf = (list, pick) => (list || []).reduce((n, x) => n + (Number(pick(x)) || 0), 0);
const avgOf = (list, pick) => ((list || []).length ? Math.round(sumOf(list, pick) / list.length) : 0);

const AREA_HOW = {
    raidbuffs: "Anteil der erwarteten Buff-Zellen (Spieler × Bosskampf), in denen der Buff die ganze Zeit lag. Erwartet wird, was die Aufstellung hergibt. Klick öffnet die Matrix je Raider.",
    raiddebuffs: `${DEBUFFS_HOW} Klick öffnet die Tabelle und die Matrix je Boss.`,
    consumables: `${CONS_HOW} Ab 90 % grün, unter 50 % rot. Klick öffnet die Tabelle je Raider.`,
    potions: `${POTIONS_HOW} Klick öffnet die Tabelle je Raider.`,
    drums: "Drums-Einsätze über alle Boss-Kämpfe. Klick öffnet die Aufschlüsselung je Raider.",
    shadowresi: "Schattenwiderstand aus der Ausrüstung beim Mother-Shahraz-Kampf, im Mittel über den Raid. Klick öffnet die Quellen je Raider.",
    gear: "Fehlende oder schwache Verzauberungen, leere Sockel und inaktive Meta-Gems, aus der Ausrüstung, die Warcraft Logs beim Pull gesehen hat.",
    activity: "Anteil der Kampfzeit mit laufenden Zaubern oder Angriffen, im Mittel über alle Boss-Kämpfe bis zum eigenen Tod. Lücken über der GCD-Toleranz zählen, „durch Mechanik“ ist der Teil in Bewegungsphasen. Ab 95 % grün, unter 85 % gelb. Klick öffnet die Tabelle je Raider.",
    cooldowns: "Klassen-Cooldowns und Schmuckstücke über alle Boss-Kämpfe: Einsätze gegen die in der Kampfzeit möglichen, wann der erste Einsatz im Mittel kam und wie viele in ein Bloodlust-Fenster fielen.",
    healers: "Heilung und Overheal über alle Boss-Kämpfe, der Mana-Tiefstand je Kampf, Manatränke, Dispels und die Schilde auf dem aktiven Tank.",
    totems: "Je Schamane: wie lange Windfury auf der Gruppe lag, in wie vielen Kämpfen getwistet wurde und wie viel Zeit ein Totemplatz leer blieb.",
    rpbspells: SPELLS_HOW,
    rpbinterrupts: "Welche gegnerischen Zauber wer unterbrochen hat, und womit.",
    sunder: SUNDER_HOW,
    bosses: "Debuff-Uptime pro Boss-Kampf in % der Kampfdauer, im Mittel über alle Werte eines Bosses.",
    mechanics: "Vermeidbare Treffer über alle Boss-Kämpfe und wie die Tode zu werten sind: vermeidbar (Todesstoß von einer Mechanik, der man ausweichen kann), früh, nach Kampfrez, kurz vor dem Kill.",
    rpbdamage: `Vermeidbarer erhaltener Schaden je Fähigkeit. ${DMG_SCALE_HOW}`,
    rpbvalidate: "Ob der Log die hinterlegten Trash-Anforderungen erfüllt und wie viele Bosse gelegt wurden.",
};

/** Raid-wide cooldown summary (report.cooldowns.players): uses against the possible, how fast the first press came, stacked with Bloodlust. */
function renderCooldownSummary(cooldowns, linkFor) {
    const rows = (cooldowns.players || []).slice().sort((a, b) => (a.usedPct === null ? 101 : a.usedPct) - (b.usedPct === null ? 101 : b.usedPct));
    const body = rows.map((p) => `<tr><td>${classCell(p, linkFor(p.name))}</td><td class="mono">${esc(p.fights)}</td><td class="mono">${esc(p.uses)} / ${esc(p.possible)}</td><td>${p.usedPct === null ? naCell("", "–") : barPct(p.usedPct, "Genutzte Cooldowns gegen die in der Kampfzeit möglichen", "Ab 95 % grün, ab 70 % gelb, darunter rot.")}</td><td class="mono">${p.avgFirstAtMs === null || p.avgFirstAtMs === undefined ? "–" : fmtTime(p.avgFirstAtMs)}</td><td class="mono">${esc(p.stacked)} / ${esc(p.stacked + p.unstacked)}</td></tr>`).join("");
    return `<div class="tbox"><table class="idx"><tr><th>Spieler</th><th>Kämpfe</th><th>Einsätze / möglich</th><th data-tip="Genutzt" data-tip-sub="Einsätze gegen die in der Kampfzeit möglichen. Die Zeitpunkte je Kampf stehen in der Sicht Bosse unter „Cooldowns“.">Genutzt</th><th data-tip="Ø erster Einsatz" data-tip-sub="Wann der erste Einsatz im Mittel über die Kämpfe kam.">Ø erster Einsatz</th><th data-tip="Mit Bloodlust" data-tip-sub="Einsätze, die in ein Bloodlust-Fenster fielen, gegen alle Einsätze.">Mit Bloodlust</th></tr>${body}</table></div>`;
}

/** Raid-wide activity summary (report.activity.players): mean active share, holes and what explains them. */
function renderActivitySummary(activity, linkFor) {
    const rows = (activity.players || []).slice().sort((a, b) => a.activeAvg - b.activeAvg);
    const body = rows.map((p) => `<tr><td>${classCell(p, linkFor(p.name))}</td><td class="mono">${esc(p.fights)}</td><td>${barPct(p.activeAvg, "Anteil der Kampfzeit mit laufenden Zaubern oder Angriffen", "Im Mittel über die Kämpfe, bis zum eigenen Tod. Ab 95 % grün, ab 70 % gelb.")}</td><td class="mono">${esc(p.gaps)}</td><td class="mono">${fmtTime(p.longestGap)}</td><td class="mono">${fmtTime(p.unexplainedMs)}</td><td class="mono">${fmtTime(p.mechanicMs)}</td></tr>`).join("");
    return `<div class="tbox"><table class="idx"><tr><th>Spieler</th><th>Kämpfe</th><th data-tip="Ø aktiv" data-tip-sub="${esc(AREA_HOW.activity)}">Ø aktiv</th><th data-tip="Lücken" data-tip-sub="Lücken über der GCD-Toleranz. Die Bänder je Kampf stehen in der Sicht Bosse unter „Aktivität“.">Lücken</th><th>Längste Lücke</th><th data-tip="Unerklärt" data-tip-sub="Lückenzeit, die auf keine Bewegungsphase fällt.">Unerklärt</th><th data-tip="Durch Mechanik" data-tip-sub="Lückenzeit in einer Bewegungsphase des Bosses.">Durch Mechanik</th></tr>${body}</table></div>`;
}

const WF_DERIVED_HOW = "Der Log enthält keinen Windfury-Buff. Die Uptime ist aus den Totem-Drops gerechnet: Puls alle 5 s, jeder Buff hält 10 s, ein anderes Lufttotem beendet die Pulse.";

/** Raid-wide totem summary (report.totems.players): Windfury uptime, twisting, downtime per slot. */
function renderTotemSummary(totems, linkFor) {
    const body = (totems.players || []).map((p) => {
        const slots = Object.entries(p.slotDowntimeMs || {}).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${fmtTime(v)}`).join(", ");
        return `<tr><td>${classCell(p, linkFor(p.name))}<div class="sritems">${esc(p.role || "")}</div></td><td class="mono">${esc(p.fights)}</td><td>${p.wfUptimeAvg === null || p.wfUptimeAvg === undefined ? naCell("", "–") : p.wfDerived ? barPct(p.wfUptimeAvg, "Aus den Drops abgeleitet", WF_DERIVED_HOW) : barPct(p.wfUptimeAvg)}</td><td class="mono">${esc(p.twistingFights)} / ${esc(p.wfFights)}</td><td class="mono">${esc(p.gapCount)}</td><td class="mono">${fmtTime(p.downtimeMs)}</td><td class="sritems">${esc(slots) || "–"}</td></tr>`;
    }).join("");
    return `<div class="tbox"><table class="idx"><tr><th>Schamane</th><th>Kämpfe</th><th data-tip="Windfury Ø" data-tip-sub="${esc(AREA_HOW.totems)}">Windfury Ø</th><th data-tip="Twisting" data-tip-sub="Kämpfe mit Windfury-Twisting gegen Kämpfe mit Windfury.">Twisting</th><th>Lücken</th><th>Downtime</th><th data-tip="Leere Plätze" data-tip-sub="Wie lange ein Totemplatz leer blieb. Die Drops je Kampf stehen in der Sicht Bosse unter „Totems“.">Leere Plätze</th></tr>${body}</table></div>`;
}

/** Raid-wide mechanics summary (report.mechanics): the mechanics that hit most, the raiders they hit, the judged deaths. */
function renderMechanicsSummary(mech, linkFor) {
    const d = mech.deaths || {};
    const deaths = `<div class="badges">${badge(plural(d.total || 0, "Tod", "Tode"), "", "ability_creature_cursed_05")}${badge(`${d.avoidable || 0} vermeidbar`, d.avoidable ? "bad" : "ok")}${badge(`${d.early || 0} früh`, d.early ? "mid" : "ok")}${badge(`${d.repeat || 0} nach Kampfrez`, "")}${badge(`${d.nearEnd || 0} kurz vor dem Kill`, "")}</div>`;
    const maxHits = Math.max(1, ...(mech.mechanics || []).map((m) => Number(m.hits) || 0));
    const mechs = (mech.mechanics || []).map((m) => `<tr><td>${hicon(m.icon, "")}${esc(m.label)}<div class="sritems">${m.kind === "debuff" ? "Debuff" : "Schaden"}</div></td><td>${barCell(String(m.hits), ((Number(m.hits) || 0) / maxHits) * 100, "")}</td><td class="mono">${m.amount ? fmtK(m.amount) : "–"}</td><td class="mono">${esc(m.fights)}</td></tr>`).join("");
    const players = (mech.players || []).map((p) => `<tr><td>${classCell(p, linkFor(p.name))}</td><td class="mono">${esc(p.hits)}</td><td class="mono">${p.amount ? fmtK(p.amount) : "–"}</td><td class="mono">${esc(p.deaths || 0)}${p.avoidableDeaths ? ` ${badge(`${p.avoidableDeaths} vermeidbar`, "bad")}` : ""}${p.earlyDeaths ? ` ${badge(`${p.earlyDeaths} früh`, "mid")}` : ""}</td><td class="sritems">${p.topMechanic ? `${hicon(p.topMechanic.icon, "")}${esc(p.topMechanic.label)} (${esc(p.topMechanic.hits)}×)` : "–"}</td></tr>`).join("");
    return `${deaths}
    ${mechs ? `<div class="tbox"><table class="idx"><tr><th>Mechanik</th><th data-tip="Treffer" data-tip-sub="Vermeidbare Treffer über alle Boss-Kämpfe. Die Treffer je Kampf stehen in der Sicht Bosse unter „Mechaniken“.">Treffer</th><th>Schaden</th><th>Kämpfe</th></tr>${mechs}</table></div>` : ""}
    ${players ? `<div class="dsub">Pro Raider</div><div class="tbox"><table class="idx"><tr><th>Spieler</th><th>Treffer</th><th>Schaden</th><th>Tode</th><th>Am häufigsten</th></tr>${players}</table></div>` : ""}`;
}

/** An RPB table under its CLA counterpart in the same dialog. */
function rpbPart(title, html) {
    return `<div class="dsub">${badge("RPB", "accent")}${esc(title)}</div>${html}`;
}

/** One area: a metric card and its detail dialog. `flag` marks it as auffällig for the group head. */
function area(o) {
    return {
        id: o.id, flag: !!o.flag,
        card: metricCard({ ...o, tip: o.tip || AREA_HOW[o.id] }),
        dialog: detailDialog(`rs-${o.id}`, o.icon, o.dialogTone || (o.flag ? "mid" : ""), esc(o.label), o.crumb, o.body, o.footNote),
    };
}

/** The four groups of Sicht Raid, only those with something in them: { id, icon, tone, label, crumb, head, body, dialogs, flagged }. */
function raidGroups(ctx) {
    const { report, reviewer, rec, linkFor } = ctx;
    const has = (o, key) => !!(o && Array.isArray(o[key]) && o[key].length);
    const rosterP = (name) => (report.roster || []).find((x) => x.name === name) || { name, type: "" };
    const rpb = report.rpb || null;
    const roles = rpb && rpb.roles;
    const groups = [];

    // --- Empfehlungen an den Raid ---
    if (rec) {
        const raid = rec.raid || [];
        const shown = reviewer ? raid : raid.filter((i) => i.approved === true);
        if (shown.length || reviewer) {
            const open = raid.filter((i) => i.approved === null).length;
            const approved = raid.filter((i) => i.approved === true).length;
            const crumb = reviewer ? `Raid › Empfehlungen · ${open} offen · ${approved} freigegeben` : `Raid › Empfehlungen · ${plural(shown.length, "Punkt", "Punkte")} von der Raidleitung`;
            const players = (rec.players || []).filter((p) => p.items.some((i) => i.approved === true)).length;
            const action = reviewer
                ? `<button type="button" class="btn btn-sm" data-dialog="dlg-rs-send">${hicon("inv_letter_15", "")}Alle senden …</button>`
                : badge(String(shown.length), "", "", true);
            groups.push({
                id: "recs", flagged: reviewer ? open : 0,
                html: `<section class="gcard" id="rs-rec-raid">${groupHead("inv_misc_note_01", open && reviewer ? "mid" : "", "Empfehlungen an den Raid", crumb, action)}${renderRaidRecommendations(rec, reviewer)}${reviewer ? detailDialog("rs-send", "inv_letter_15", "", "Alle senden", `Raid › Empfehlungen › Versand · ${plural(players, "Raider", "Raider")} mit freigegebenen Punkten`, renderSendBox(report), "Ein unveränderter Satz wird nie zweimal geschickt.") : ""}</section>`,
            });
        }
    }

    // --- Vorbereitung ---
    const prep = [];
    if (has(report.raidBuffs, "players")) {
        const rows = (report.raidBuffs.rows || []).filter((r) => r.expected);
        const short = rows.filter((r) => r.none > 0 || r.partial > 0 || (r.late || 0) > 0).length;
        const cov = rows.length ? avgOf(rows, (r) => r.coveragePct) : null;
        const lacking = report.raidBuffs.players.filter((p) => (p.missing || 0) > 0).sort((a, b) => b.missing - a.missing);
        prep.push(area({ id: "raidbuffs", icon: "spell_magic_greaterblessingofkings", label: "Raid-Buffs", crumb: "Raid › Vorbereitung › Raid-Buffs · Spieler × Buff",
            value: cov === null ? "–" : `${cov} %`, unit: "durchgehend", tone: cov === null ? "" : cov >= 95 ? "ok" : cov >= 80 ? "" : "mid",
            badges: [short ? badge(`${short} ${short === 1 ? "Buff" : "Buffs"} lückenhaft`, "mid") : badge("alle da", "ok")],
            who: whoList("Fehlte", lacking), flag: short > 0, body: renderRaidBuffsPanel(report.raidBuffs, linkFor) }));
    }
    if (has(report.raidDebuffs, "rows")) {
        const rows = report.raidDebuffs.rows.filter((r) => r.expected);
        const missing = rows.filter((r) => r.missing > 0);
        const avg = rows.length ? avgOf(rows, (r) => r.avgUptime) : 0;
        const bosses = [];
        for (const b of groupByBoss(ctx.fights)) {
            if (b.fights.some((f) => (f.debuffs || []).some((d) => d.expected && (d.missing || d.uptimePct === 0)))) bosses.push(b.name);
        }
        prep.push(area({ id: "raiddebuffs", icon: "spell_shadow_chilltouch", label: "Raid-Debuffs", crumb: "Raid › Vorbereitung › Raid-Debuffs · Boss-Kämpfe",
            value: missing.length ? String(missing.length) : String(rows.length), unit: missing.length ? `von ${rows.length} fehlten` : "erwartet, alle da", tone: missing.length ? "bad" : "ok",
            badges: [badge(`Ø ${avg} % Uptime`, avg >= 95 ? "ok" : avg >= 70 ? "mid" : "bad")],
            who: whatList("Boss", bosses), flag: missing.length > 0 || avg < 95, body: renderRaidDebuffsPanel(report.raidDebuffs, report.timeline) }));
    }
    if (has(report.consumables, "players")) {
        const list = report.consumables.players;
        const buffed = avgOf(list, (p) => p.buffed);
        const food = avgOf(list, (p) => p.food);
        prep.push(area({ id: "consumables", icon: "inv_alchemy_endlessflask_05", label: "Consumables", crumb: "Raid › Vorbereitung › Consumables · Abdeckung je Raider",
            value: `${buffed} %`, unit: "Flask / Elixiere", tone: buffed >= 90 ? "ok" : buffed < 50 ? "bad" : "mid",
            badges: [badge(`Ø Food ${food} %`, food >= 90 ? "ok" : food < 50 ? "bad" : "mid")],
            who: whoList("Unter 50 %", list.filter((p) => p.buffed < 50).sort((a, b) => a.buffed - b.buffed), (p) => `${p.buffed} %`), flag: buffed < 90, body: renderConsumablesPanel(report.consumables, linkFor) }));
    }
    if (has(report.potions, "players")) {
        const list = report.potions.players;
        const total = sumOf(list, (p) => p.total);
        const drank = new Set(list.filter((p) => (p.total || 0) > 0).map((p) => p.name));
        const none = (report.roster || []).filter((p) => !drank.has(p.name));
        prep.push(area({ id: "potions", icon: "inv_potion_137", label: "Tränke", crumb: "Raid › Vorbereitung › Tränke · je Raider und Trank",
            value: String(total), unit: "im Raid", tone: "",
            badges: [(report.roster || []).length ? (none.length ? badge(`${plural(none.length, "Raider", "Raider")} ohne Trank`, "mid") : badge("jeder hat getrunken", "ok")) : badge(plural(list.length, "Raider", "Raider"), "")],
            who: none.length ? whoList("Keiner", none) : whoList("Meiste", list.slice().sort((a, b) => b.total - a.total), (p) => p.total), flag: none.length > 0, body: renderPotionsPanel(report.potions, linkFor) }));
    }
    if (has(report.drums, "players")) {
        const list = report.drums.players.slice().sort((a, b) => b.total - a.total);
        prep.push(area({ id: "drums", icon: "inv_misc_drum_01", label: "Drums", crumb: "Raid › Vorbereitung › Drums",
            value: String(sumOf(list, (p) => p.total)), unit: "Einsätze", badges: [badge(plural(list.length, "Raider", "Raider"), "")],
            who: whoList("Meiste", list, (p) => p.total), body: renderDrumsPanel(report.drums, linkFor) }));
    }
    if (has(report.shadowResi, "players")) {
        const list = report.shadowResi.players.slice().sort((a, b) => a.sr - b.sr);
        prep.push(area({ id: "shadowresi", icon: "spell_shadow_antishadow", label: "Shadow-Resi", crumb: "Raid › Vorbereitung › Shadow-Resi · Mother Shahraz",
            value: String(avgOf(list, (p) => p.sr)), unit: "Ø aus Gear", badges: [badge(plural(list.length, "Raider", "Raider"), "")],
            who: whoList("Niedrigste", list, (p) => p.sr), body: renderShadowResiPanel(report.shadowResi, linkFor) }));
    }
    if (report.players) {
        const withIssues = (report.players || []).filter((p) => (p.issues || []).length);
        const issues = withIssues.flatMap((p) => p.issues);
        const high = issues.filter((x) => x.severity === "high").length;
        prep.push(area({ id: "gear", icon: "inv_shield_06", label: "Gear-Probleme", crumb: "Raid › Vorbereitung › Gear-Probleme · je Raider",
            value: String(issues.length), unit: issues.length ? `bei ${plural(withIssues.length, "Raider", "Raidern")}` : "keine", tone: high ? "bad" : issues.length ? "mid" : "ok",
            badges: issues.length ? [high ? badge(`${high} schwer`, "bad") : "", issues.length - high ? badge(`${issues.length - high} leicht`, "mid") : ""].filter(Boolean) : [badge("alles verzaubert", "ok")],
            who: whoList("Meiste", withIssues.slice().sort((a, b) => b.issues.length - a.issues.length), (p) => p.issues.length), flag: issues.length > 0, body: renderGearPanel(report.players, linkFor) }));
    }

    // --- Leistung ---
    const perf = [];
    if (has(report.activity, "players") || (rpb && has(rpb.activity, "players"))) {
        const cla = has(report.activity, "players") ? report.activity.players : null;
        const r = rpb && has(rpb.activity, "players") ? rpb.activity.players : null;
        const list = cla ? cla.slice().sort((a, b) => a.activeAvg - b.activeAvg) : r.slice().sort((a, b) => a.relativeTotal - b.relativeTotal);
        const val = (p) => (cla ? p.activeAvg : p.relativeTotal);
        const avg = avgOf(list, val);
        const low = list.filter((p) => val(p) < 85);
        const body = (cla ? renderActivitySummary(report.activity, linkFor) : "") + (r ? (cla ? rpbPart("Aktivität", renderRpbActivityPanel(rpb.activity, roles, linkFor)) : renderRpbActivityPanel(rpb.activity, roles, linkFor)) : "");
        perf.push(area({ id: "activity", icon: "inv_misc_pocketwatch_02", label: "Aktivität", crumb: `Raid › Leistung › Aktivität${cla ? "" : " · RPB"}`,
            value: `${avg} %`, unit: cla ? "Ø aktiv" : "Ø Anteil Raidzeit", tone: avg >= 95 ? "ok" : avg >= 85 ? "" : "mid",
            badges: [low.length ? badge(`${low.length} unter 85 %`, "mid") : badge("alle über 85 %", "ok"), r ? badge("RPB", "accent") : ""].filter(Boolean),
            who: whoList("Niedrigste", list, (p) => `${val(p)} %`), flag: low.length > 0, body }));
    }
    if (has(report.cooldowns, "players") || (rpb && has(rpb, "usage"))) {
        const cla = has(report.cooldowns, "players") ? report.cooldowns.players : null;
        const usage = rpb && has(rpb, "usage") ? rpb.usage : null;
        let value;
        let unit;
        let tone = "";
        let badges;
        let who;
        let flag = false;
        if (cla) {
            const uses = sumOf(cla, (p) => p.uses);
            const possible = sumOf(cla, (p) => p.possible);
            const pct = possible ? Math.round((uses / possible) * 100) : null;
            const stacked = sumOf(cla, (p) => p.stacked);
            const all = stacked + sumOf(cla, (p) => p.unstacked);
            value = pct === null ? String(uses) : `${pct} %`;
            unit = pct === null ? "Einsätze" : "genutzt";
            tone = pct === null ? "" : pct >= 80 ? "" : "mid";
            badges = [badge(`${stacked} von ${all} im Lust`, ""), usage ? badge("RPB", "accent") : ""].filter(Boolean);
            const ranked = cla.filter((p) => p.usedPct !== null && p.usedPct !== undefined).sort((a, b) => a.usedPct - b.usedPct);
            who = whoList("Niedrigste", ranked, (p) => `${p.usedPct} %`);
            flag = pct !== null && pct < 80;
        } else {
            const under = usage.map((u) => ({ ...rosterP(u.name), ...u, under: (u.classCooldowns || []).filter((c) => c.possibleUses && c.total < c.possibleUses / 2).length })).filter((u) => u.under > 0).sort((a, b) => b.under - a.under);
            value = String(sumOf(usage, (u) => sumOf(u.classCooldowns, (c) => c.total)));
            unit = "Klassen-Cooldowns";
            badges = [under.length ? badge(`${under.length} unter der Hälfte`, "mid") : badge("keiner unter der Hälfte", "ok"), badge("RPB", "accent")];
            who = whoList("Unter der Hälfte", under, (p) => p.under);
            flag = under.length > 0;
        }
        const body = (cla ? renderCooldownSummary(report.cooldowns, linkFor) : "") + (usage ? (cla ? rpbPart("Cooldowns & Schmuckstücke", renderRpbUsagePanel(rpb.usage, roles, linkFor)) : renderRpbUsagePanel(rpb.usage, roles, linkFor)) : "");
        perf.push(area({ id: "cooldowns", icon: "ability_rogue_preparation", label: "Cooldowns", crumb: `Raid › Leistung › Cooldowns${cla ? "" : " · RPB"}`, value, unit, tone, badges, who, flag, body }));
    }
    if (has(report.healers, "players")) {
        const list = report.healers.players.slice().sort((a, b) => (b.healingTotal || 0) - (a.healingTotal || 0));
        const heal = sumOf(list, (p) => p.healingTotal);
        const over = sumOf(list, (p) => p.overhealTotal);
        const overPct = heal + over > 0 && over ? Math.round((over / (heal + over)) * 100) : avgOf(list, (p) => p.overhealPct);
        const low = sumOf(list, (p) => p.manaLowFights);
        perf.push(area({ id: "healers", icon: "spell_holy_flashheal", label: "Heiler", crumb: "Raid › Leistung › Heiler · alle Boss-Kämpfe",
            value: String(list.length), unit: list.length === 1 ? "Heiler" : "Heiler",
            badges: [badge(`Ø Overheal ${overPct} %`, overPct >= 50 ? "bad" : overPct >= 35 ? "mid" : ""), low ? badge(`${low}× unter 10 % Mana`, "bad") : ""].filter(Boolean),
            who: whoList("Oben", list.slice(0, 2)), flag: low > 0 || overPct >= 35, body: renderHealersPanel(report.healers, linkFor) }));
    }
    if (has(report.totems, "players")) {
        const list = report.totems.players;
        const wf = list.filter((p) => p.wfUptimeAvg !== null && p.wfUptimeAvg !== undefined);
        const avg = wf.length ? avgOf(wf, (p) => p.wfUptimeAvg) : null;
        perf.push(area({ id: "totems", icon: "spell_nature_windfury", label: "Totems", crumb: "Raid › Leistung › Totems · je Schamane",
            value: avg === null ? String(list.length) : `${avg} %`, unit: avg === null ? "Schamanen" : "Windfury Ø", tone: avg === null ? "" : avg >= 95 ? "ok" : avg >= 70 ? "" : "mid",
            badges: [badge(`Twisting ${sumOf(list, (p) => p.twistingFights)} / ${sumOf(list, (p) => p.wfFights)}`, "")],
            who: whoList("Schamanen", list), flag: avg !== null && avg < 90, body: renderTotemSummary(report.totems, linkFor) }));
    }
    if (rpb && has(rpb.activity, "players") && rpb.activity.players.some((p) => (p.singleTargetCasts || []).length || (p.aoeCasts || []).length)) {
        const down = rpb.activity.players.map((p) => ({ ...p, down: [...(p.singleTargetCasts || []), ...(p.aoeCasts || [])].filter((r) => r.mostlyLowerRank).length })).filter((p) => p.down > 0).sort((a, b) => b.down - a.down);
        const n = sumOf(down, (p) => p.down);
        perf.push(area({ id: "rpbspells", icon: "inv_misc_book_11", label: "Zauber", crumb: "Raid › Leistung › Zauber · RPB",
            value: String(n), unit: n === 1 ? "Rang-Warnung" : "Rang-Warnungen", tone: n ? "mid" : "ok", badges: [badge("RPB", "accent")],
            who: whoList("Betrifft", down, (p) => p.down), flag: n > 0, body: renderRpbSpellsPanel(rpb.activity, roles, linkFor) }));
    }
    if (rpb && has(rpb.interrupts, "players")) {
        const list = rpb.interrupts.players.slice().sort((a, b) => b.count - a.count);
        perf.push(area({ id: "rpbinterrupts", icon: "spell_frost_iceshock", label: "Interrupts", crumb: "Raid › Leistung › Interrupts · RPB",
            value: String(sumOf(list, (p) => p.count)), unit: "Unterbrechungen", badges: [badge("RPB", "accent")],
            who: whoList("Meiste", list, (p) => p.count), body: renderRpbInterruptsPanel(rpb.interrupts, linkFor) }));
    }
    if (has(report, "sunder")) {
        const list = report.sunder.slice().sort((a, b) => b.total - a.total);
        const below = sumOf(list, (p) => p.below5);
        perf.push(area({ id: "sunder", icon: "ability_warrior_sunder", label: "Sunder Armor", crumb: "Raid › Leistung › Sunder Armor",
            value: String(sumOf(list, (p) => p.total)), unit: "Sunder", badges: [badge(`${below} bei < 5 Stacks`, "")],
            who: whoList("Meiste", list, (p) => p.total), body: renderSunderPanel(report.sunder, linkFor) }));
    }
    if (has(report.bossUptimes, "rows")) {
        const { rows, metrics } = report.bossUptimes;
        const meanOf = (r) => ((metrics || []).length ? avgOf(metrics, (m) => r[m.key] || 0) : 0);
        const avg = avgOf(rows, meanOf);
        const lowest = rows.slice().sort((a, b) => meanOf(a) - meanOf(b));
        perf.push(area({ id: "bosses", icon: "achievement_boss_illidan", label: "Boss-Uptimes", crumb: "Raid › Leistung › Boss-Uptimes · je Boss-Kampf",
            value: String(rows.length), unit: rows.length === 1 ? "Boss-Kampf" : "Boss-Kämpfe", badges: [badge(`Ø ${avg} % Uptime`, avg >= 95 ? "ok" : avg >= 70 ? "" : "mid")],
            who: whatList("Niedrigste", lowest.length ? [lowest[0].boss] : []), flag: avg < 70, body: renderBossUptimesPanel(report.bossUptimes) }));
    }

    // --- Fehler ---
    const err = [];
    if (report.mechanics && (has(report.mechanics, "mechanics") || has(report.mechanics, "players") || report.mechanics.deaths)) {
        const m = report.mechanics;
        const d = m.deaths || {};
        const top = (m.mechanics || []).slice().sort((a, b) => b.hits - a.hits).slice(0, 3);
        const max = Math.max(1, ...top.map((x) => Number(x.hits) || 0));
        const hitBy = (key) => (m.players || []).filter((p) => p.byMechanic && p.byMechanic[key]).length;
        const table = top.length
            ? `<div class="mc-table"><table class="idx"><tr><th>Mechanik</th><th>Treffer</th><th>Getroffen</th></tr>${top.map((x) => { const share = (Number(x.hits) || 0) / max; return `<tr><td>${hicon(x.icon, "")}${esc(x.label)}</td><td>${barCell(String(x.hits), share * 100, share >= 0.75 ? "high" : share >= 0.5 ? "medium" : "")}</td><td class="mute">${esc(plural(hitBy(x.key), "Raider", "Raider"))}</td></tr>`; }).join("")}</table></div>`
            : "";
        const avoidable = (m.players || []).filter((p) => p.avoidableDeaths > 0).sort((a, b) => b.avoidableDeaths - a.avoidableDeaths);
        err.push(area({ id: "mechanics", icon: "ability_creature_cursed_05", label: "Mechaniken & Tode", crumb: "Raid › Fehler › Mechaniken & Tode · alle Boss-Kämpfe", wide: true,
            value: String(d.total || 0), unit: (d.total || 0) === 1 ? "Tod" : "Tode", tone: d.avoidable ? "bad" : "",
            badges: [badge(`${d.avoidable || 0} vermeidbar`, d.avoidable ? "bad" : "ok"), d.early ? badge(`${d.early} früh`, "mid") : "", d.nearEnd ? badge(`${d.nearEnd} kurz vor dem Kill`, "") : ""].filter(Boolean),
            extra: table, who: whoList("Vermeidbar gestorben", avoidable, (p) => p.avoidableDeaths), flag: (d.avoidable || 0) > 0, dialogTone: d.avoidable ? "bad" : "", body: renderMechanicsSummary(m, linkFor) }));
    }
    if (rpb && has(rpb.damage, "players")) {
        const list = rpb.damage.players.slice().sort((a, b) => (b.avoidableTotal || 0) - (a.avoidableTotal || 0));
        const deaths = sumOf(list, (p) => p.deaths);
        err.push(area({ id: "rpbdamage", icon: "spell_shadow_shadowwordpain", label: "Vermeidbarer Schaden", crumb: `Raid › Fehler › ${rpb.damage.heading || "Vermeidbarer Schaden"} · RPB · alle Boss-Kämpfe`,
            value: fmtK(sumOf(list, (p) => p.avoidableTotal)), unit: "im Raid", badges: [badge("RPB", "accent"), deaths ? badge(plural(deaths, "Tod", "Tode"), "bad") : ""].filter(Boolean),
            who: whoList("Meiste", list, (p) => fmtK(p.avoidableTotal)), flag: deaths > 0, dialogTone: "bad", body: renderRpbDamagePanel(rpb.damage, roles, linkFor), footNote: "Sortiert nach Rolle · Klick auf einen Raider öffnet seine Seite" }));
    }
    if (rpb && rpb.validation) {
        const v = rpb.validation;
        const unmet = (v.requirements || []).filter((r) => !r.ok);
        err.push(area({ id: "rpbvalidate", icon: "inv_misc_note_02", label: "Log-Prüfung", crumb: "Raid › Fehler › Log-Prüfung · RPB",
            value: String(unmet.length), unit: unmet.length === 1 ? "Anforderung offen" : "Anforderungen offen", tone: unmet.length ? "mid" : "ok",
            badges: [badge(`${v.bossesKilled} / ${v.bossesTotal} Bosse gelegt`, "")],
            who: whatList("Zu wenig", unmet.map((r) => r.label)), flag: unmet.length > 0, body: renderRpbValidationPanel(v) }));
    }

    const groupOf = (id, icon, tone, label, crumb, list) => {
        if (!list.length) return;
        const flagged = list.filter((a) => a.flag).length;
        const action = flagged ? badge(`${flagged} ${flagged === 1 ? "Bereich" : "Bereiche"} auffällig`, tone === "bad" ? "bad" : "mid", "", true) : badge("unauffällig", "ok", "", true);
        groups.push({
            id, flagged,
            html: `<section class="gcard" id="rg-${id}">${groupHead(icon, flagged ? tone : "", label, crumb, action)}<div class="mgrid">${list.map((a) => a.card).join("")}</div>${list.map((a) => a.dialog).join("")}</section>`,
        });
    };
    groupOf("prep", "trade_alchemy", "mid", "Vorbereitung", "Raid › Buffs · Debuffs · Consumables · Gear", prep);
    groupOf("perf", "spell_nature_bloodlust", "mid", "Leistung", "Raid › Aktivität · Cooldowns · Heiler · Totems · Zauber", perf);
    groupOf("err", "spell_fire_selfdestruct", "bad", "Fehler", "Raid › Mechaniken · Tode · vermeidbarer Schaden", err);
    return groups;
}

// ---- Sicht Raider: one card per raider ------------------------------------------

/** The armory paperdoll (character-sheet layout) with the mean item level, or a note without one. */
function paperdoll(p) {
    const color = CLASS_COLORS[p.type] || "#ddd";
    if (!(p.armory || []).length) return "<div class=\"empty\">Keine Ausrüstung im Log.</div>";
    const bySlot = {};
    for (const it of p.armory || []) bySlot[it.slot] = it;
    const avgIlvl = meanItemLevel(p);
    const LEFT = [0, 1, 2, 14, 4, 8];
    const RIGHT = [9, 5, 6, 7, 10, 11, 12, 13];
    const BOTTOM = [15, 16, 17];
    return `<div class="doll" style="--cc:${color}">
        <div class="pd-col pd-col-left">${LEFT.map((s) => paperdollSlot(bySlot[s], "left")).join("")}</div>
        <div class="pd-center">
          <div class="portrait" style="--cc:${color}"><img src="${esc(classIconUrl(p.type))}" alt=""></div>
          <div class="ilvl-badge"><b>${avgIlvl}</b><span>Ø iLvl</span></div>
        </div>
        <div class="pd-col pd-col-right">${RIGHT.map((s) => paperdollSlot(bySlot[s], "right")).join("")}</div>
      </div>
      <div class="doll-bottom">${BOTTOM.map((s) => paperdollSlot(bySlot[s], "bottom")).join("")}</div>`;
}

function meanItemLevel(p) {
    const ilvls = (p.armory || []).map((i) => i.itemLevel).filter((n) => n > 0);
    return ilvls.length ? Math.round(ilvls.reduce((a, b) => a + b, 0) / ilvls.length) : 0;
}

/** One key/value line of a box. */
function kv(icon, label, right, attrs = "") {
    return `<div class="kv"${attrs}><span class="k">${icon ? hicon(icon, "") : ""}<span>${label}</span></span>${right}</div>`;
}

/** A box of the raider sections: head with icon, title and one badge, then its lines. */
function infoBox(icon, title, headBadge, rows) {
    return `<div class="box"><div class="box-head">${hicon(icon, "")}<b>${esc(title)}</b>${headBadge || ""}</div>${rows || "<div class=\"kv mute\">Keine Daten.</div>"}</div>`;
}

/** Vorbereitung of one raider: gear problems, consumables, buffs as three boxes. { count, tone, badge, html, dialogs } */
function raiderPrep(ctx, p, i) {
    const { report } = ctx;
    const name = p.name;
    const issues = ((ctx.gearByName.get(name) || {}).issues || p.issues || []);
    const high = issues.some((x) => x.severity === "high");
    const boxes = [];
    let dialogs = "";

    // Gear: only the problem items, the paperdoll behind "Ausrüstung"
    const gearRows = issues.map((it) => {
        const inner = `${it.icon ? hicon(it.icon, "") : ""}<span>${esc(it.itemName)}</span>`;
        const label = it.itemId ? `<a class="item" href="${esc(wowheadItemLink(it.itemId))}" target="_blank" rel="noopener">${inner}</a>` : inner;
        return `<div class="kv"><span class="k">${label}</span>${badge(it.label, it.severity === "high" ? "bad" : "mid")}</div>`;
    }).join("");
    const armory = (p.armory || []).length;
    const gearFoot = armory
        ? `<div class="kv"><span class="k mute"><span>Ø Itemlevel ${meanItemLevel(p)} · ${armory} Slots</span></span><button type="button" class="btn btn-ghost btn-sm" data-dialog="dlg-pd-${i}">${hicon("inv_shield_06", "")}Ausrüstung</button></div>`
        : "<div class=\"kv mute\"><span class=\"k\"><span>Keine Ausrüstung im Log.</span></span></div>";
    boxes.push(infoBox("inv_shield_06", "Gear", issues.length ? badge(plural(issues.length, "Problem", "Probleme"), high ? "bad" : "mid") : badge("ok", "ok"), gearRows + gearFoot));
    if (armory) {
        dialogs += detailDialog(`pd-${i}`, "inv_shield_06", "", `Ausrüstung · <span class="cn" style="--cc:${esc(classColorOf(p.type) || "var(--text)")}">${esc(name)}</span>`, `${name} › Vorbereitung › Ausrüstung · beim Pull gesehen`, paperdoll(p));
    }

    // Consumables
    const cons = ctx.consByName.get(name);
    const pot = ctx.potByName.get(name) || p.potions || {};
    const ic = report.icons || {};
    const consIcons = (report.consumables && report.consumables.icons) || ic;
    let consRows = "";
    if (cons) {
        consRows += kv(consIcons.flask || "inv_alchemy_endlessflask_05", "Flask / Elixiere", barPct(cons.buffed, "Flask oder beide Elixiere", CONS_HOW));
        consRows += kv(consIcons.food, "Food", barPct(cons.food));
        consRows += kv("", "Waffe geölt", cons.weaponOiled ? badge("ja", "ok") : badge("nein", "mid"));
    }
    const hasPotionData = !!(report.potions && report.potions.players && report.potions.players.length);
    if (hasPotionData) {
        const byType = pot.byType || {};
        const types = ((report.potions && report.potions.types) || []).filter((t) => byType[t.key]).sort((a, b) => byType[b.key] - byType[a.key]);
        const total = pot.total || (pot.destruction || 0) + (pot.haste || 0) + (pot.mana || 0);
        consRows += `<div class="kv"><span class="k">${hicon(ic.mana || "inv_potion_137", "")}<span>Tränke</span></span><span class="mono" data-tip="Tränke" data-tip-sub="${esc(`Zerstörung ${pot.destruction || 0} · Hast ${pot.haste || 0} · Mana ${pot.mana || 0}`)}"><span class="potions">${potionCells(ic, pot)}</span></span>${types.length ? badge(`${types[0].label} ${byType[types[0].key]}`, "") : badge(String(total), "", "", true)}</div>`;
    } else {
        consRows += kv("inv_potion_137", "Tränke", "<span class=\"mute\" data-tip=\"Noch keine CLA-Auswertung für diesen Log\">nicht ausgewertet</span>");
    }
    const drums = ctx.drumsByName.get(name);
    if (drums) consRows += kv(report.drums && report.drums.icon, "Drums", `<span class="mono" data-tip="Drums" data-tip-sub="${esc(Object.entries(drums.byType || {}).map(([k, v]) => `${k}: ${v}`).join(", "))}">${esc(drums.total)}</span>`);
    const sr = ctx.srByName.get(name);
    if (sr) consRows += kv("spell_shadow_antishadow", "Shadow-Resi", `<span class="mono" data-tip="Schattenwiderstand aus Gear" data-tip-sub="${esc((sr.items || []).map((it) => `${it.itemName} (+${it.sr})`).join(", ") || "–")}">${esc(sr.sr)}</span>`);
    boxes.push(infoBox("inv_alchemy_endlessflask_05", "Consumables", cons ? (cons.buffed >= 90 ? badge("ok", "ok") : badge(`${cons.buffed} %`, cons.buffed < 50 ? "bad" : "mid")) : "", consRows));

    // Buffs: one line per buff with its bar, "?" for a buff the log cannot prove
    const b = ctx.buffsByName.get(name);
    let buffIssuesN = 0;
    if (b) {
        const cols = ((report.raidBuffs && report.raidBuffs.rows) || []).filter((r) => r.expected || r.seenPlayers > 0 || (r.unknown || 0) > 0);
        const rows = cols.map((r) => {
            const c = b.buffs && b.buffs[r.key];
            if (!c) return "";
            const counts = `${c.full}× da, ${c.late || 0}× spät gesetzt, ${c.partial}× nicht durchgehend, ${c.none}× gefehlt${c.unknown ? `, ${c.unknown}× nicht nachweisbar` : ""}`;
            let right;
            if (c.wrong) right = badge(`${c.wrong}× falsche Rolle`, "mid");
            else if (!c.expected && c.unknown) right = `<span class="badge count" data-tip="${esc(r.label)}: nicht nachweisbar" data-tip-sub="${esc(INFERRED_HOW)}">?</span><span class="mute">nicht nachweisbar</span>`;
            else if (!c.expected) right = badge("nicht erwartet", "");
            else right = `${barPct(c.pct, r.label, counts)}${c.unknown ? `<span class="badge count" data-tip="${esc(`${c.unknown}× nicht nachweisbar`)}" data-tip-sub="${esc(INFERRED_HOW)}">?</span>` : ""}`;
            return kv(r.icon, esc(r.label), right, ` data-tip="${esc(r.label)}" data-tip-sub="${esc(`${r.provider}. ${counts}`)}"`);
        }).join("");
        buffIssuesN = (b.missing || 0) + (b.partial || 0) + (b.late || 0) + (b.wrong || 0);
        boxes.push(infoBox("spell_magic_greaterblessingofkings", "Buffs", buffIssuesN ? badge(`${buffIssuesN} lückenhaft`, (b.missing || 0) >= 2 ? "bad" : "mid") : badge("alle da", "ok"), rows));
    }

    const problems = issues.length + (b ? (b.missing || 0) : 0) + (cons && cons.buffed < 90 ? 1 : 0);
    const tone = high || (b && b.missing >= 2) || (cons && cons.buffed < 50) ? "bad" : problems ? "mid" : "ok";
    const headBadge = issues.length ? badge(plural(issues.length, "Gear-Problem", "Gear-Probleme"), high ? "bad" : "mid") : b && b.missing ? badge(`Buff fehlte ${b.missing}×`, "mid") : badge("vorbereitet", "ok");
    return { count: problems ? String(problems) : "ok", tone, badge: headBadge, html: `<div class="cols3">${boxes.join("")}</div>`, dialogs };
}

/** Leistung of one raider: activity & cooldowns, totems, healing & mana, the RPB's spells and cooldowns. */
function raiderPerf(ctx, p) {
    const name = p.name;
    const act = ctx.actByName.get(name);
    const cd = ctx.cdByName.get(name);
    const tot = ctx.totByName.get(name);
    const h = ctx.healByName.get(name);
    const rAct = ctx.rpbActByName.get(name);
    const use = ctx.rpbUseByName.get(name);
    const boxes = [];
    if (act || cd) {
        let rows = "";
        if (act) {
            rows += kv("inv_misc_pocketwatch_02", "Aktivität", barPct(act.activeAvg, "Anteil der Kampfzeit mit laufenden Zaubern oder Angriffen", "Im Mittel über die Kämpfe, bis zum eigenen Tod."));
            rows += kv("", "Lücken", `<span class="mono" data-tip="Lücken" data-tip-sub="${esc(`unerklärt ${fmtTime(act.unexplainedMs)}${act.mechanicMs ? ` · durch Mechanik ${fmtTime(act.mechanicMs)}` : ""}`)}">${esc(act.gaps)} · längste ${fmtTime(act.longestGap)}</span>`);
        }
        if (cd) {
            rows += kv("ability_rogue_preparation", "Cooldowns", cd.usedPct === null || cd.usedPct === undefined ? naCell("", "–") : barPct(cd.usedPct, "Genutzte Cooldowns gegen die möglichen", `${cd.uses} von ${cd.possible} möglichen Einsätzen`));
            rows += kv("spell_nature_bloodlust", "Ø erster Einsatz", `<span class="mono">${cd.avgFirstAtMs === null || cd.avgFirstAtMs === undefined ? "–" : fmtTime(cd.avgFirstAtMs)}</span>${badge(`${cd.stacked} im Lust`, "")}`);
        }
        const low = act && act.activeAvg < 85;
        boxes.push(infoBox("inv_misc_pocketwatch_02", "Aktivität & Cooldowns", act ? badge(`${act.activeAvg} %`, act.activeAvg >= 95 ? "ok" : low ? "mid" : "") : "", rows));
    }
    if (tot) {
        const rows = kv("spell_nature_windfury", "Windfury Ø", tot.wfUptimeAvg === null || tot.wfUptimeAvg === undefined ? naCell("", "–") : barPct(tot.wfUptimeAvg))
            + kv("", "Twisting", `<span class="mono">${esc(tot.twistingFights)} von ${esc(tot.wfFights)} Kämpfen</span>`)
            + kv("", "Downtime", `<span class="mono">${fmtTime(tot.downtimeMs)} · ${esc(tot.gapCount)} Lücken</span>`);
        boxes.push(infoBox("spell_nature_windfury", "Totems", tot.gapCount ? badge(`${tot.gapCount} Lücken`, tot.gapCount >= 3 ? "mid" : "") : badge("ok", "ok"), rows));
    }
    if (h) {
        const late = (h.potionPcts || []).filter((x) => x <= 15).length;
        let rows = kv("spell_holy_flashheal", "Heilung", `<span class="mono">${fmtK(h.healingTotal)}</span><span class="mute">in ${plural(h.fights, "Kampf", "Kämpfen")}</span>`)
            + kv("", "Overheal", barCell(`${h.overhealPct} %`, h.overhealPct, h.overhealPct >= 50 ? "high" : h.overhealPct >= 35 ? "medium" : "", "Anteil der Heilung über volle Lebenspunkte", `Ab 35 % gelb, ab 50 % rot.${h.topOverheal ? ` Am meisten: ${h.topOverheal.name} (${h.topOverheal.overhealPct} %).` : ""}`));
        if (h.manaMinAvg !== null && h.manaMinAvg !== undefined) rows += kv("inv_potion_137", "Ø Mana-Tiefstand", `<span class="mono">${esc(h.manaMinAvg)} %</span>${h.manaLowFights ? badge(`${h.manaLowFights}× unter 10 %`, "bad") : ""}`);
        rows += kv("", "Manatränke", `<span class="mono">${esc(h.potions)}</span>${late ? badge(`${late}× spät`, "mid") : ""}${h.potionMissingFights ? badge(`${h.potionMissingFights}× keiner`, "mid") : ""}`);
        rows += kv("spell_holy_dispelmagic", "Dispels", `<span class="mono">${esc(h.dispels)}${h.avgReactionMs !== null && h.avgReactionMs !== undefined ? ` · Ø ${fmtSecs(h.avgReactionMs)}` : ""}</span>`);
        rows += (h.shields || []).map((s) => kv(s.icon, `${esc(s.label)} auf dem Tank`, barPct(s.uptimeAvg))).join("");
        boxes.push(infoBox("spell_holy_flashheal", "Heilung & Mana", h.manaLowFights ? badge(`${h.manaLowFights}× unter 10 % Mana`, "bad") : badge(`Overheal ${h.overhealPct} %`, h.overhealPct >= 35 ? "mid" : ""), rows));
    }
    if (rAct || use) {
        let rows = "";
        if (rAct) {
            rows += kv("inv_misc_pocketwatch_02", "Aktiv (RPB)", barPct(rAct.relativeTotal, "Anteil Raidzeit", RPB_ACTIVITY_HOW));
            const spells = spellTiles([...(rAct.singleTargetCasts || []), ...(rAct.aoeCasts || [])]);
            if (spells.length) rows += `<div class="kv stack">${iconRow(spells)}</div>`;
        }
        if (use) {
            const tiles = [
                ...(use.classCooldowns || []).map((c) => iconTile({ icon: c.icon, name: c.name, spellId: c.spellId, label: c.label, count: c.total, note: c.possibleUses ? `${c.total} von ~${c.possibleUses} möglichen` : "", tone: c.possibleUses && c.total < c.possibleUses / 2 ? "warn" : "good" })),
                ...(use.trinketsAndRacials || []).map((t) => iconTile({ icon: t.icon, name: t.name, spellId: t.spellId, label: t.label, count: t.total })),
                ...[...(use.engineering || []), ...(use.absorbs || [])].map((t) => iconTile({ icon: t.icon, name: t.name, spellId: t.spellId, label: t.label, count: t.total })),
            ];
            if (tiles.length) rows += `<div class="kv stack"><span class="kicker">Cooldowns &amp; Schmuckstücke</span>${iconRow(tiles)}</div>`;
        }
        const down = rAct ? [...(rAct.singleTargetCasts || []), ...(rAct.aoeCasts || [])].filter((r) => r.mostlyLowerRank).length : 0;
        boxes.push(infoBox("inv_misc_book_11", "Zauber & Cooldowns", `${down ? badge(`${down} Rang-Warnung${down === 1 ? "" : "en"}`, "mid") : ""}${badge("RPB", "accent")}`, rows));
    }
    if (!boxes.length) return null;
    const dips = ctx.report.fightSeries && (ctx.report.fightSeries.players || []).find((x) => x && x.name === name);
    const count = act ? `${act.activeAvg} %` : h ? `${h.overhealPct} % Overheal` : cd && cd.usedPct !== null && cd.usedPct !== undefined ? `${cd.usedPct} %` : "";
    const tone = (act && act.activeAvg < 85) || (h && h.manaLowFights) ? (h && h.manaLowFights ? "bad" : "mid") : (cd && cd.usedPct !== null && cd.usedPct < 80) || (dips && dips.dipPct >= 25) ? "mid" : "ok";
    const headBadge = cd && cd.usedPct !== null && cd.usedPct !== undefined ? badge(`Cooldowns ${cd.usedPct} %`, cd.usedPct < 80 ? "mid" : "") : act ? badge(`${act.activeAvg} % aktiv`, act.activeAvg < 85 ? "mid" : "") : h ? badge(`Overheal ${h.overhealPct} %`, h.overhealPct >= 35 ? "mid" : "") : badge("RPB", "accent");
    return { count, tone, badge: headBadge, html: `<div class="cols3">${boxes.join("")}</div>` };
}

/** Fehler of one raider: mechanics, deaths with the boss and the killing blow, the RPB's avoidable damage, interrupts and sunders. */
function raiderErr(ctx, p) {
    const { report } = ctx;
    const name = p.name;
    const mech = ctx.mechByName.get(name);
    const dmg = ctx.rpbDmgByName.get(name);
    const kicks = ctx.rpbIntByName.get(name);
    const sunder = ctx.sunderByName.get(name);
    const deaths = [];
    for (const f of ctx.fights) for (const d of f.deaths || []) if (d.name === name) deaths.push({ ...d, boss: f.boss });
    if (!mech && !dmg && !kicks && !sunder && !deaths.length) return null;
    const boxes = [];
    if (mech) {
        const rows = Object.values(mech.byMechanic || {}).sort((a, b) => b.hits - a.hits).map((m) => kv(m.icon, esc(m.label), `${badge(`${m.hits}×`, m.hits >= 3 ? "bad" : m.hits === 2 ? "mid" : "", "", true)}${m.amount ? `<span class="mono mute">${fmtK(m.amount)}</span>` : ""}`)).join("");
        boxes.push(infoBox("spell_fire_selfdestruct", "Mechaniken", badge(`${mech.hits} Treffer`, mech.hits >= 3 ? "bad" : mech.hits ? "mid" : "ok"), rows || kv("", "Keine vermeidbaren Treffer", "")));
    }
    const nDeaths = mech ? mech.deaths || 0 : deaths.length || (dmg ? dmg.deaths || 0 : 0);
    const avoidable = mech ? mech.avoidableDeaths || 0 : deaths.filter((d) => d.avoidable).length;
    if (deaths.length || mech) {
        const rows = deaths.map((d) => kv(d.abilityIcon || "ability_creature_cursed_05", `${esc(d.boss)} <span class="mono mute">${fmtTime(d.at)}</span>`, `${d.ability ? `<span class="mute">${esc(d.ability)}</span>` : ""}${d.avoidable ? badge("vermeidbar", "bad") : d.early ? badge("früh", "mid") : d.nearEnd ? badge("kurz vor dem Kill", "") : ""}`)).join("");
        boxes.push(infoBox("ability_creature_cursed_05", "Tode", badge(`${nDeaths}${avoidable ? ` · ${avoidable} vermeidbar` : ""}`, avoidable ? "bad" : nDeaths ? "mid" : "ok"), rows || kv("", "Nicht gestorben", badge("0", "ok", "", true))));
    }
    if (dmg || kicks || sunder) {
        let rows = "";
        if (dmg) {
            const abilities = (report.rpb.damage.abilities || []).map((a, i) => ({ a, v: dmg.perAbility[i] || 0 })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
            rows += abilities.map((x) => `<div class="kv"><span class="k">${abilityIcon(x.a)}<span data-tip="${esc(x.a.label)}" data-tip-sub="${esc((x.a.sources || []).join(", "))}">${esc(x.a.label)}</span></span><span class="mono">${num(x.v)}</span></div>`).join("");
            rows += kv("", "<b>Summe vermeidbar</b>", `<span class="mono">${num(dmg.avoidableTotal)}</span>`);
        }
        if (kicks) rows += kv("spell_frost_iceshock", "Unterbrechungen", `<span class="mono">${esc(kicks.count)}</span>${iconRow((kicks.spells || []).map((s) => iconTile({ icon: s.icon, spellId: s.spellId, label: s.name, count: s.count })))}`);
        if (sunder) rows += kv("ability_warrior_sunder", "Sunder Armor", `<span class="mono">${esc(sunder.total)}</span>${badge(`${sunder.below5} bei < 5 Stacks`, "")}`);
        boxes.push(infoBox("spell_shadow_shadowwordpain", dmg ? "Vermeidbarer Schaden" : "Weitere", badge("RPB", "accent"), rows));
    }
    return {
        count: plural(nDeaths, "Tod", "Tode"), tone: avoidable ? "bad" : nDeaths ? "mid" : "ok",
        badge: avoidable ? badge(`${avoidable} vermeidbare${avoidable === 1 ? "r Tod" : " Tode"}`, "bad") : nDeaths ? badge(plural(nDeaths, "Tod", "Tode"), "mid") : badge("keine Tode", "ok"),
        html: `<div class="cols3">${boxes.join("")}</div>`,
    };
}

/**
 * The send dialog of one raider (SendeFenster): head badges, the approved
 * points with their text choice (KI / Regel / Eigener), the DM preview in the
 * Discord look with the mapping state, save and send.
 */
function sendDialog(ctx, p, i, items) {
    const { report } = ctx;
    const approved = items.filter((it) => it.approved === true);
    const open = items.filter((it) => it.approved === null).length;
    const sent = ctx.sent[p.name];
    const idx = (report.roster || []).findIndex((x) => x.name === p.name);
    const PRECEDENCE = "Der eigene Text geht vor dem KI-Text, der KI-Text vor dem Regeltext. Die Wahl wird im Report gespeichert.";
    const blocks = approved.map((it, j) => {
        const mode = it.custom ? "custom" : it.ai ? "ai" : "rule";
        const text = it.custom || it.ai || it.text || "";
        const segBtn = (m, label) => `<button type="button" class="seg-btn${mode === m ? " active" : ""}" data-txt="${m}">${label}</button>`;
        return `<div class="send-item${j === 0 ? " on" : ""}" data-key="${esc(it.key)}" data-title="${esc(it.title)}" data-ai="${esc(it.ai || "")}" data-rule="${esc(it.text || "")}" data-custom="${esc(it.custom || "")}" data-mode="${mode}">
          <div class="send-item-head">${badge(IMPACT_LABEL[it.impact] || it.impact, IMPACT_TONE[it.impact] || "")}<b>${esc(it.title)}</b><nav class="seg sm" data-tip="Welcher Text geht raus?" data-tip-sub="${esc(PRECEDENCE)}">${it.ai ? segBtn("ai", `${hicon("inv_scroll_03", "")}KI`) : ""}${segBtn("rule", "Regel")}${segBtn("custom", `${LINE.pencil}Eigener`)}</nav></div>
          <textarea class="send-text" rows="3"${mode === "custom" ? "" : " readonly"}>${esc(text)}</textarea>
        </div>`;
    }).join("");
    const preview = approved.map((it) => {
        const text = it.custom || it.ai || it.text || "";
        return `<div><b>${esc(it.title)}</b><br>${esc(text.length > 160 ? `${text.slice(0, 160)} …` : text)}</div>`;
    }).join("");
    const link = `/r/${esc(report.id)}${idx >= 0 ? `/p/${idx}` : ""}`;
    const color = classColorOf(p.type) || "var(--text)";
    return `<dialog class="dlg send" id="send-${i}" data-report="${esc(report.id)}" data-player="${esc(p.name)}">
      <div class="dlg-head">${tile("inv_letter_15", "")}<div class="dlg-main"><div class="dlg-title">An <span class="cn" style="--cc:${esc(color)}">${esc(p.name)}</span> senden</div><div class="kicker">${esc(p.name)} › Empfehlungen › Versand · Discord-DM</div></div>${badge(`${approved.length} freigegeben`, approved.length ? "ok" : "")}${open ? `<span class="badge mid" data-tip="${esc(open === 1 ? "Der noch offene Punkt wird nicht gesendet." : `Die ${open} noch offenen Punkte werden nicht gesendet.`)}">${open} offen · wird nicht gesendet</span>` : ""}${dlgClose()}</div>
      <div class="send-grid">
        <div class="send-items">${blocks || "<div class=\"rec-empty\">Noch nichts freigegeben.</div>"}</div>
        <div class="send-preview"><div class="kicker">So kommt es an</div><div class="dm"><div class="dm-head"><span class="crest">${ICONS.crest}</span><b>EventHelper</b>${badge("BOT", "accent")}</div><b>${esc(report.title || "Raid")} · Deine Auswertung</b><span class="mute">${approved.length} Punkt${approved.length === 1 ? "" : "e"} von der Raidleitung geprüft</span><div class="dm-items">${preview}</div><a href="${link}" target="_blank" rel="noopener">Report ansehen${LINE.external}</a></div>
        <div class="badges"><span class="badge map-badge">Zuordnung wird geprüft …</span>${sent ? badge(`gesendet ${new Date(sent.at).toLocaleString("de-DE")}`, "") : badge("noch nie gesendet", "")}</div></div>
      </div>
      <div class="dlg-foot"><span class="note send-out">Ein unveränderter Satz wird nie zweimal geschickt.</span><div class="btns"><button type="button" class="btn btn-ghost btn-sm" data-close>Abbrechen</button><button type="button" class="btn btn-ghost btn-sm" data-sendact="save">Nur speichern</button><button type="button" class="btn btn-sm" data-sendact="send"${approved.length ? "" : " disabled"}>${hicon("inv_letter_15", "")}Per Bot senden</button></div></div>
    </dialog>`;
}

/** What stands out about a raider, worst first, at most three badges; one in `ok` when nothing does. */
function raiderBadges(ctx, p) {
    const name = p.name;
    const issues = ((ctx.gearByName.get(name) || {}).issues || p.issues || []);
    const cons = ctx.consByName.get(name);
    const buffs = ctx.buffsByName.get(name);
    const heal = ctx.healByName.get(name);
    const act = ctx.actByName.get(name);
    const cd = ctx.cdByName.get(name);
    const mech = ctx.mechByName.get(name);
    const recP = ctx.recByName.get(name);
    const items = recP ? (ctx.reviewer ? recP.items : recP.items.filter((x) => x.approved === true)) : [];
    const open = items.filter((x) => x.approved === null).length;
    const out = [];
    const add = (tone, text, icon, tip, sub) => out.push({ tone, html: `<span class="badge ${tone}"${tip ? ` data-tip="${esc(tip)}"` : ""}${sub ? ` data-tip-sub="${esc(sub)}"` : ""}>${hicon(icon, "")}${esc(text)}</span>` });
    if (mech && mech.avoidableDeaths) add("bad", `${mech.avoidableDeaths} vermeidbare${mech.avoidableDeaths === 1 ? "r Tod" : " Tode"}`, "ability_creature_cursed_05", "Tode durch eine Mechanik, der man ausweichen kann");
    if (issues.length) add(issues.some((x) => x.severity === "high") ? "bad" : "mid", plural(issues.length, "Gear-Problem", "Gear-Probleme"), "inv_shield_06", "Gear-Probleme: Verzauberungen, Sockel, Meta-Gem", "Aus der Ausrüstung, die das Log beim Pull gesehen hat.");
    if (heal && heal.manaLowFights) add("bad", `${heal.manaLowFights}× unter 10 % Mana`, "inv_potion_137", "Kämpfe, in denen das Mana unter 10 % fiel");
    if (cons && cons.buffed < 90) add(cons.buffed < 50 ? "bad" : "mid", `Consumables ${cons.buffed} %`, "inv_alchemy_endlessflask_05", "Anteil der Boss-Kämpfe mit Flask oder beiden Elixieren", "Ab 90 % grün, unter 50 % rot.");
    if (buffs && buffs.missing) add(buffs.missing >= 2 ? "bad" : "mid", `Buff fehlte ${buffs.missing}×`, "spell_magic_greaterblessingofkings", "Kämpfe, in denen ein erwarteter Raid-Buff gar nicht auf dem Raider lag");
    if (heal && heal.overhealPct >= 35) add(heal.overhealPct >= 50 ? "bad" : "mid", `Overheal ${heal.overhealPct} %`, "spell_holy_flashheal", "Anteil der Heilung über volle Lebenspunkte", "Ab 35 % gelb, ab 50 % rot.");
    if (!heal && act && act.activeAvg < 85) add("mid", `${act.activeAvg} % aktiv`, "inv_misc_pocketwatch_02", "Anteil der Kampfzeit mit laufenden Zaubern oder Angriffen", "Bis zum eigenen Tod. Unter 85 % gelb.");
    if (cd && cd.usedPct !== null && cd.usedPct !== undefined && cd.usedPct < 80) add("mid", `Cooldowns ${cd.usedPct} %`, "ability_rogue_preparation", "Genutzte Cooldowns gegen die möglichen");
    const dips = ctx.report.fightSeries && (ctx.report.fightSeries.players || []).find((x) => x && x.name === name);
    if (dips && Number.isFinite(dips.dipPct) && dips.dipPct >= 25) add(dips.dipPct >= 40 ? "bad" : "mid", `${dips.dipPct} % Einbrüche`, "spell_nature_bloodlust", `Anteil der Kampfzeit, in der ${dips.measure === "hps" ? "HPS" : "DPS"} unter der Hälfte des eigenen Schnitts lag`, `Bis zum eigenen Tod, über ${plural(dips.fights || 0, "Kampf", "Kämpfe")}. Ab 25 % gelb, ab 40 % rot.`);
    if (open) add("mid", `${open} offen`, "inv_misc_note_01", "Befunde, die noch niemand freigegeben oder verworfen hat");
    if (!ctx.reviewer && items.length) add("accent", plural(items.length, "Empfehlung", "Empfehlungen"), "inv_misc_note_01", "Freigegebene Empfehlungen für diesen Raider");
    const rank = { bad: 0, mid: 1, accent: 2 };
    const shown = out.map((b, j) => ({ ...b, j })).sort((a, b) => rank[a.tone] - rank[b.tone] || a.j - b.j).slice(0, 3);
    if (shown.length) return shown.map((b) => b.html).join("");
    if (act) return badge(`${act.activeAvg} % aktiv`, "ok", "inv_misc_pocketwatch_02");
    if (heal) return badge(`Overheal ${heal.overhealPct} %`, "ok", "spell_holy_flashheal");
    if (cons) return badge(`Consumables ${cons.buffed} %`, "ok", "inv_alchemy_endlessflask_05");
    return badge("Gear ok", "ok", "inv_shield_06");
}

/** The four sections of a raider (Empfehlungen · Vorbereitung · Leistung · Fehler), only those with data: [{ key, label, icon, count, tone, badge, html }] plus their dialogs. */
function raiderSections(ctx, p, i, items, opts = {}) {
    const name = p.name;
    const recP = ctx.recByName.get(name);
    const open = items.filter((x) => x.approved === null).length;
    const secs = [];
    if (recP && (items.length || ctx.reviewer)) {
        secs.push({ key: "recs", label: "Empfehlungen", icon: "inv_misc_note_01", count: `${items.length}${open ? ` · ${open} offen` : ""}`, tone: open ? "mid" : "ok",
            html: items.length ? `<div class="rlist rec-list">${items.map((it, j) => recItem(it, "player", name, ctx.reviewer, { open: opts.openFirst && j === 0 })).join("")}</div>` : "<div class=\"rlist\"><div class=\"rec-empty\">Nichts auszusetzen – weiter so.</div></div>" });
    }
    const prep = raiderPrep(ctx, p, i);
    secs.push({ key: "prep", label: "Vorbereitung", icon: "trade_alchemy", crumb: "Gear · Consumables · Buffs", ...prep });
    const perf = raiderPerf(ctx, p);
    if (perf) secs.push({ key: "perf", label: "Leistung", icon: "spell_nature_bloodlust", crumb: ctx.healByName.get(name) ? "Heilung · Mana · Cooldowns" : "Aktivität · Cooldowns · Zauber", ...perf });
    const err = raiderErr(ctx, p);
    if (err) secs.push({ key: "err", label: "Fehler", icon: "spell_fire_selfdestruct", crumb: "Mechaniken · Tode · vermeidbarer Schaden", ...err });
    return { secs, dialogs: prep.dialogs };
}

/**
 * One raider card (Sicht Raider): class icon, name, role and fight count, at
 * most three badges, the Kampfverlauf and the Spielerseite as icon buttons in
 * the head; four sections behind buttons; for a reviewer the footer with the
 * phrasing job and the send dialog. The dialogs sit after the card, so they
 * open from a closed card too.
 */
function raiderCard(ctx, p, i, opts = {}) {
    const { report, reviewer } = ctx;
    const name = p.name;
    const color = classColorOf(p.type) || "var(--text)";
    const role = ctx.roleOf(name);
    const recP = ctx.recByName.get(name);
    const items = recP ? (reviewer ? recP.items : recP.items.filter((x) => x.approved === true)) : [];
    const open = items.filter((x) => x.approved === null).length;
    const approved = items.filter((x) => x.approved === true).length;
    const fights = playerFights(report.timeline, name);
    const { secs, dialogs } = raiderSections(ctx, p, i, items);

    let timelineDialog = "";
    if (fights.length) {
        const ns = `r${i}-`;
        timelineDialog = `<dialog class="dlg chart" id="dlg-rt-${i}">
          <div class="dlg-head"><img class="vcard-icon" src="${esc(classIconUrl(p.type))}" alt=""><div class="dlg-main"><div class="dlg-title">${hicon("inv_misc_pocketwatch_01", "")}Kampfverlauf · ${esc(name)}</div><div class="vcard-meta">${plural(fights.length, "Kampf", "Kämpfe")} · ${PX_PER_SEC} px pro Sekunde, seitlich scrollen</div></div>${dlgClose()}</div>
          <div class="dlg-body">${renderPlayerTimeline(report.timeline, name, ns)}</div>
          <div class="dlg-foot"><span class="note">Tode als senkrechte Striche in Klassenfarbe · Tabellenansicht unter jeder Grafik aufklappbar</span><div class="btns">${ctx.linkFor(name) ? `<a class="btn btn-ghost btn-sm" href="${esc(ctx.linkFor(name))}">Spielerseite${LINE.external}</a>` : ""}<button type="button" class="btn btn-sm" data-close>Schließen</button></div></div>
        </dialog>`;
    }
    const secId = (k) => `rc${i}-${k}`;
    const buttons = secs.map((s, j) => `<button type="button" class="sec${j === 0 ? " active" : ""}" data-show="${secId(s.key)}">${hicon(s.icon, "")}${esc(s.label)}${s.count !== "" ? `<span class="n${s.tone === "bad" ? " bad" : s.tone === "mid" ? " mid" : ""}">${esc(s.count)}</span>` : ""}</button>`).join("");
    const panels = secs.map((s, j) => `<div id="${secId(s.key)}" class="part"${j === 0 ? "" : " hidden"}>${s.html}</div>`).join("");

    let foot = "";
    let sendDlg = "";
    if (reviewer && recP) {
        const sent = ctx.sent[name];
        foot = `<div class="raider-foot"><span class="note">${approved} freigegeben · ${open} offen · zuletzt gesendet: ${sent ? esc(new Date(sent.at).toLocaleString("de-DE")) : "nie"}</span><span class="rec-send-result" hidden></span><div class="btns"><button type="button" class="btn btn-run btn-sm" data-phrase="player" data-tip="Claude formuliert die Befunde dieses Raiders in Klartext" data-tip-sub="Deine Freigabe bleibt nötig; der Regeltext bleibt erhalten.">${hicon("inv_scroll_03", "")}KI-Formulierung</button><button type="button" class="btn btn-sm" data-dialog="send-${i}"${approved ? "" : " disabled"}>${hicon("inv_letter_15", "")}Vorschau &amp; senden</button></div></div>`;
        sendDlg = sendDialog(ctx, p, i, items);
    }
    const roleIcon = { tank: "inv_shield_06", healer: "spell_holy_flashheal", dps: "ability_dualwield" }[role];
    const meta = [
        badge(p.type, ""),
        ROLE_LABEL[role] ? badge(ROLE_LABEL[role], "accent", roleIcon) : "",
        fights.length ? badge(plural(fights.length, "Kampf", "Kämpfe"), "", "", true) : "",
    ].filter(Boolean).join("");
    const tlBtn = fights.length ? ibtn(hicon("inv_misc_pocketwatch_01", ""), "Kampfverlauf öffnen", `${plural(fights.length, "Kampf", "Kämpfe")} mit eigenen Zeilen: DPS gegen den Raid-Schnitt, Aktivität, Cooldowns, Buffs, Tode.`, `data-dialog="dlg-rt-${i}"`) : "";
    const href = ctx.linkFor(name);
    const pageBtn = href ? `<a class="ibtn" href="${esc(href)}" data-tip="Spielerseite öffnen" data-tip-sub="Die freigegebenen Punkte zuerst, dann die Kämpfe je Boss." aria-label="Spielerseite öffnen">${LINE.external}</a>` : "";
    const armoryBtn = armoryButton(name);
    return `<details class="vcard raider-card" id="raider-${esc(name)}" data-name="${esc(name)}" data-role="${role}" data-open="${reviewer ? open : approved}" data-report="${esc(report.id)}" style="--cc:${esc(color)}"${opts.open ? " open" : ""}>
      <summary><img class="vcard-icon" src="${esc(classIconUrl(p.type))}" alt="${esc(p.type)}"><div class="vcard-main"><div class="vcard-title cn">${esc(name)}</div><div class="vcard-meta">${meta}</div></div><div class="vcard-chips">${raiderBadges(ctx, p)}</div>${tlBtn}${armoryBtn}${pageBtn}${expBtn()}</summary>
      <div class="vcard-body"><nav class="secs">${buttons}</nav>${panels}${foot}</div>
    </details>${timelineDialog}${dialogs}${sendDlg}`;
}

/** Sicht Raider: search, role filter with WoW icons, one icon button for all cards, one card per roster entry. `openName` opens that raider's card. */
function renderRaiderView(ctx, openName) {
    const roster = ctx.report.roster || [];
    if (!roster.length) return "<div class=\"empty\">Keine Raider gefunden.</div>";
    const withOpen = roster.filter((p) => {
        const r = ctx.recByName.get(p.name);
        return r && r.items.some((it) => (ctx.reviewer ? it.approved === null : it.approved === true));
    }).length;
    const cards = roster.map((p, i) => raiderCard(ctx, p, i, { open: openName === p.name })).join("");
    const btn = (key, label, icon, extra, active) => `<button type="button" class="seg-btn${active ? " active" : ""}" data-rolefilter="${key}">${icon ? hicon(icon, "") : ""}${label}${extra || ""}</button>`;
    return `<div class="view-bar"><div class="raider-tools"><label class="field">${LINE.search}<input type="search" id="raiderSearch" placeholder="Raider suchen…" aria-label="Raider suchen"></label><nav class="seg sm">${btn("all", "Alle", "", "", true)}${btn("tank", "Tank", "inv_shield_06")}${btn("healer", "Heiler", "spell_holy_flashheal")}${btn("dps", "DPS", "ability_dualwield")}${btn("open", ctx.reviewer ? "Offen" : "Empfehlungen", "inv_misc_note_01", ` <span class="n${withOpen ? " mid" : ""}">${withOpen}</span>`)}</nav></div>${ibtn(LINE.expandAll, "Alle auf- oder zuklappen", "Betrifft die Karten, die Suche und Filter gerade zeigen.", "data-cards=\"toggle\"")}</div>
    ${cards}<div class="raider-empty" id="raiderEmpty" hidden>Kein Raider passt zu Suche und Filter.</div>`;
}

// The open view lives in the url hash: #raid / #bosse / #raider, #raider-<name> (or ?player=<name>) opens that card.
const VIEW_SCRIPT = `<script>(function(){if(window.__ehView)return;window.__ehView=1;
function show(id){var b=document.querySelector(".seg.views [data-show='view-"+id+"']");if(b)b.click();}
function openRaider(name){show("raider");var cards=document.querySelectorAll(".raider-card");for(var i=0;i<cards.length;i++){if(cards[i].getAttribute("data-name")===name){cards[i].open=true;cards[i].scrollIntoView({block:"start"});break;}}}
function fromUrl(){var h="";try{h=decodeURIComponent(location.hash||"").replace(/^#/,"");}catch(x){h=(location.hash||"").replace(/^#/,"");}var m=h.match(/^raider-(.+)$/);var q=new URLSearchParams(location.search).get("player");if(q){openRaider(q);return;}if(m){openRaider(m[1]);return;}if(h==="raid"||h==="bosse"||h==="raider")show(h);}
document.addEventListener("click",function(e){var b=e.target.closest(".seg.views [data-show]");if(!b)return;var id=b.getAttribute("data-show").replace(/^view-/,"");try{history.replaceState(null,"","#"+id);}catch(x){}});
fromUrl();window.addEventListener("hashchange",fromUrl);})();</script>`;

// Search field + role filter of Sicht Raider: hides the cards that do not match.
const FILTER_SCRIPT = `<script>(function(){if(window.__ehFilter)return;window.__ehFilter=1;
var role="all",q="";
function apply(){var any=false;document.querySelectorAll(".raider-card").forEach(function(c){var ok=true;if(role==="open")ok=Number(c.getAttribute("data-open")||0)>0;else if(role!=="all")ok=c.getAttribute("data-role")===role;if(ok&&q)ok=(c.getAttribute("data-name")||"").toLowerCase().indexOf(q)>=0;c.hidden=!ok;if(ok)any=true;});var e=document.getElementById("raiderEmpty");if(e)e.hidden=any;}
document.addEventListener("click",function(e){var b=e.target.closest("[data-rolefilter]");if(!b)return;role=b.getAttribute("data-rolefilter");b.parentElement.querySelectorAll("[data-rolefilter]").forEach(function(x){x.classList.toggle("active",x===b);});apply();});
document.addEventListener("input",function(e){if(!e.target||e.target.id!=="raiderSearch")return;q=e.target.value.trim().toLowerCase();apply();});})();</script>`;

// The send dialog: text choice per point (KI / Regel / Eigener), live DM preview,
// "Nur speichern" writes own texts through the review endpoint, "Per Bot senden"
// saves and then sends this one raider; an unchanged, already sent set offers a
// forced resend instead of silently doing nothing. Opening the dialog fetches the
// mapping state (GET /api/cla/recommendations/send) for the badge under the preview.
const SEND_DLG_SCRIPT = `<script>(function(){if(window.__ehSendDlg)return;window.__ehSendDlg=1;
var token=null;function csrf(){return token?Promise.resolve(token):fetch("/api/session",{credentials:"same-origin"}).then(function(r){return r.json()}).then(function(j){token=j.csrfToken||(j.data&&j.data.csrfToken)||"";return token;});}
function hdr(t){return {"Content-Type":"application/json","X-CSRF-Token":t};}
var status={};function mapping(d){var b=d.querySelector(".map-badge");if(!b||b.getAttribute("data-done"))return;var id=d.getAttribute("data-report"),who=d.getAttribute("data-player");(status[id]||(status[id]=fetch("/api/cla/recommendations/send?id="+encodeURIComponent(id),{credentials:"same-origin"}).then(function(r){return r.json();}))).then(function(j){var x=((j.data&&j.data.players)||[]).find(function(y){return y.name===who;});b.setAttribute("data-done","1");if(!x){b.textContent="nichts freigegeben";return;}b.textContent=x.mapped?"Konto zugeordnet":x.ambiguous?"mehrere Konten":"kein Konto zugeordnet";b.className="badge map-badge "+(x.mapped?"ok":"bad");}).catch(function(){b.textContent="Zuordnung unbekannt";});}
function preview(d){var box=d.querySelector(".dm-items");if(!box)return;box.innerHTML="";d.querySelectorAll(".send-item").forEach(function(it){var t=it.querySelector(".send-text").value.trim();if(!t)return;var el=document.createElement("div"),b=document.createElement("b");b.textContent=it.getAttribute("data-title");el.appendChild(b);el.appendChild(document.createElement("br"));el.appendChild(document.createTextNode(t.length>160?t.slice(0,160)+" …":t));box.appendChild(el);});}
function save(d,t,id,who){var items=[].slice.call(d.querySelectorAll(".send-item"));return items.reduce(function(p,it){return p.then(function(){var m=it.getAttribute("data-mode"),v=it.querySelector(".send-text").value.trim(),text=m==="custom"?v:"";if(text===(it.getAttribute("data-custom")||""))return;return fetch("/api/cla/recommendations",{method:"POST",credentials:"same-origin",headers:hdr(t),body:JSON.stringify({reportId:id,scope:"player",player:who,key:it.getAttribute("data-key"),text:text})}).then(function(r){if(!r.ok)throw new Error("Speichern fehlgeschlagen ("+r.status+")");it.setAttribute("data-custom",text);});});},Promise.resolve());}
document.addEventListener("click",function(e){var o=e.target.closest("[data-dialog^='send-']");if(o){var dd=document.getElementById(o.getAttribute("data-dialog"));if(dd)mapping(dd);}
var t=e.target.closest("[data-txt]");if(t){var it=t.closest(".send-item"),m=t.getAttribute("data-txt"),ta=it.querySelector(".send-text");it.setAttribute("data-mode",m);it.querySelectorAll("[data-txt]").forEach(function(x){x.classList.toggle("active",x===t);});ta.value=it.getAttribute("data-"+m)||"";ta.readOnly=m!=="custom";if(m==="custom")ta.focus();preview(t.closest("dialog"));return;}
var a=e.target.closest("[data-sendact]");if(!a)return;var d=a.closest("dialog"),id=d.getAttribute("data-report"),who=d.getAttribute("data-player"),out=d.querySelector(".send-out"),act=a.getAttribute("data-sendact"),btns=d.querySelectorAll("[data-sendact]");
out.textContent="…";btns.forEach(function(x){x.disabled=true;});
csrf().then(function(t){return save(d,t,id,who).then(function(){if(act==="save"){out.textContent="Gespeichert.";return;}
return fetch("/api/cla/recommendations/send",{method:"POST",credentials:"same-origin",headers:hdr(t),body:JSON.stringify({reportId:id,players:[who],force:act==="force"})}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error((j&&j.error&&j.error.message)||r.status);return j.data;});}).then(function(res){var s=(res.sent||[])[0],k=(res.skipped||[])[0];out.textContent="";if(s){out.textContent="Gesendet: "+s.items+" Punkte an "+s.name+".";}else if(k){out.textContent=k.message||res.message||"";if(k.reason==="already_sent"){var f=document.createElement("button");f.type="button";f.className="btn btn-ghost btn-sm";f.setAttribute("data-sendact","force");f.textContent="Trotzdem erneut senden";out.appendChild(document.createTextNode(" "));out.appendChild(f);}}else{out.textContent=res.message||"Nichts gesendet.";}});});})
.catch(function(err){out.textContent="Fehler: "+err.message;}).then(function(){btns.forEach(function(x){x.disabled=false;});});});
document.addEventListener("input",function(e){if(e.target&&e.target.classList&&e.target.classList.contains("send-text"))preview(e.target.closest("dialog"));});})();</script>`;

function renderReportPage(report, user) {
    const ctx = reportContext(report, user);
    const { reviewer, rec, linkFor } = ctx;
    const dateStr = report.date ? esc(report.date) : "";
    const kicker = ["Log-Auswertung", report.zone ? `Zone: ${esc(report.zone)}` : "", dateStr].filter(Boolean).join(" · ");

    const hasTimeline = ctx.fights.length > 0;
    const bosses = hasTimeline ? groupByBoss(ctx.fights) : [];
    const groups = raidGroups(ctx);
    const flagged = groups.reduce((n, g) => n + (g.flagged ? 1 : 0), 0);
    const roster = report.roster || [];

    const isAdmin = !!(user && user.isAdmin);
    const actions = [
        report.reportUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(report.reportUrl)}" target="_blank" rel="noopener">${hicon("inv_misc_pocketwatch_01", "")}Warcraft Logs${LINE.external}</a>` : "",
        isAdmin ? `<a class="btn btn-ghost btn-sm" href="/cla">${hicon("ability_warrior_rallyingcry", "")}Alle Auswertungen</a>` : "",
    ].filter(Boolean).join("");

    const views = [
        { id: "raid", icon: "ability_warrior_rallyingcry", label: "Raid", count: groups.length, tone: flagged ? "mid" : "", html: groups.length ? groups.map((g) => g.html).join("") : "<div class=\"empty\">Keine raid-weiten Auswertungen in diesem Report.</div>" },
        { id: "bosse", icon: "achievement_boss_illidan", label: "Bosse", count: bosses.length, html: renderBossView(report.timeline, linkFor, rec ? rec.raid : [], reviewer) },
        { id: "raider", icon: "inv_misc_grouplooking", label: "Raider", count: roster.length, html: renderRaiderView(ctx, null) },
    ];
    const start = hasTimeline ? "bosse" : "raid";
    const seg = views.map((v) => `<button type="button" class="seg-btn${v.id === start ? " active" : ""}" data-show="view-${v.id}">${hicon(v.icon, "")}${esc(v.label)}<span class="n${v.tone ? ` ${v.tone}` : ""}">${esc(v.count)}</span></button>`).join("");
    const panels = views.map((v) => `<div id="view-${v.id}" class="view"${v.id === start ? "" : " hidden"}>${v.html}</div>`).join("");

    const body = `
      <div class="page-head">
        <div class="page-head-main">
          <div class="kicker">${kicker}</div>
          <h1 class="page-title">${esc(report.title || "Log-Check")}</h1>
        </div>
        ${actions ? `<div class="page-actions">${actions}</div>` : ""}
      </div>
      ${kpiCards(report, ctx)}
      <div class="view-bar"><nav class="seg views">${seg}</nav></div>
      ${panels}
      ${TIMELINE_SCRIPT}${DIALOG_SCRIPT}${DTOOLS_SCRIPT}${VIEW_SCRIPT}${FILTER_SCRIPT}${CARDS_SCRIPT}${reviewer ? REVIEW_SCRIPT + PHRASE_SCRIPT + SEND_DLG_SCRIPT : ""}`;

    return shellPage(report.title ? `Log-Check: ${report.title}` : "Log-Check", {
        user,
        body,
        crumbs: [{ label: report.title || "Log-Check" }],
    });
}

const QUALITY_COLOR = { 0: "#9d9d9d", 1: "#ffffff", 2: "#1eff00", 3: "#0070dd", 4: "#a335ee", 5: "#ff8000" };

// Wowhead item link with enchant + gems so the tooltip shows the authoritative TBC data.
function wowheadItemUrl(it) {
    const params = [];
    if (it.enchant && it.enchant.enchantId) params.push(`ench=${encodeURIComponent(it.enchant.enchantId)}`);
    const gemIds = (it.gems || []).map((g) => g.id).filter(Boolean);
    if (gemIds.length) params.push(`gems=${gemIds.join(":")}`);
    const qs = params.length ? `?${params.join("&")}` : "";
    return `${esc(wowheadItemLink(it.itemId))}${qs}`;
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
        badge = `<span class="slot-badge b-miss" data-tip="keine Verzauberung">${LINE.close}</span>`;
        ench = "<div class=\"slot-ench miss\">keine Verzauberung</div>";
    } else if (it.enchant.status === "bad") {
        badge = `<span class="slot-badge b-bad" data-tip="${esc(it.enchant.reason || "suboptimale Verzauberung")}">!</span>`;
        ench = `<div class="slot-ench bad">suboptimale Verzauberung${it.enchant.reason ? ` · ${esc(it.enchant.reason)}` : ""}</div>`;
    } else if (it.enchant.status === "ok") {
        badge = `<span class="slot-badge b-ok" data-tip="verzaubert" data-tip-sub="Details im Tooltip des Gegenstands">${LINE.check}</span>`;
        ench = "<div class=\"slot-ench ok\">verzaubert</div>";
    }
    // real gem icons + empty sockets
    let gems = (it.gems || []).map((g) =>
        `<a class="gemicon ${g.bad ? "gem-bad" : ""}" href="${esc(wowheadItemLink(g.id))}" target="_blank" rel="noopener" data-tip="${g.bad ? "suboptimaler Edelstein" : "Edelstein"}"><img src="${esc(iconUrl(g.icon))}" alt=""></a>`).join("");
    for (let i = 0; i < (it.emptySockets || 0); i++) gems += "<span class=\"gemicon gem-empty\" data-tip=\"leerer Sockel\"></span>";
    const gemsRow = gems ? `<div class="slot-gems">${gems}</div>` : "";
    return `<div class="slot slot-${side}">
      <a class="slot-icon" style="border-color:${q}" href="${href}" target="_blank" rel="noopener" data-tip="${esc(it.itemName)}">${img}${badge}</a>
      <div class="slot-info">
        <a class="slot-name" style="color:${q}" href="${href}" target="_blank" rel="noopener">${esc(it.itemName)}</a>
        ${ench}
        ${gemsRow}
      </div>
    </div>`;
}

/**
 * The player page: the same raider card as in Sicht Raider, opened, with the
 * Kampfverlauf inline under it (charts stacked under their tables) — no
 * second layout to keep in step.
 */
/**
 * A raider's own output in one fight against the raid's mean per player, on
 * the measure that is theirs (HPS for a healer, DPS otherwise, as
 * playerSeries decides): { key, own, raid } or null without a curve.
 */
function fightMeasure(f, name) {
    const s = f.series;
    const mine = s && Array.isArray(s.players) ? s.players.find((p) => p && p.name === name) : null;
    if (!mine) return null;
    const sum = (arr) => (Array.isArray(arr) ? arr.reduce((a, v) => a + (Number(v) || 0), 0) : 0);
    const healer = ((f.healers && f.healers.healers) || []).some((h) => h.name === name) || sum(mine.hps) > sum(mine.dps);
    const key = healer && mine.hps ? "hps" : mine.dps ? "dps" : "hps";
    const own = mine[key];
    if (!Array.isArray(own) || !own.length) return null;
    const withKey = s.players.filter((p) => p && Array.isArray(p[key]) && p[key].length).length;
    const raidArr = Array.isArray(s[key]) && s[key].length && withKey ? s[key] : null;
    return {
        key,
        own: Math.round(sum(own) / own.length),
        raid: raidArr ? Math.round(sum(raidArr) / raidArr.length / withKey) : null,
    };
}

/** The player page's four KPIs: activity against the raid, DPS/HPS against the raid, deaths, preparation. */
function playerKpis(ctx, p) {
    const { report } = ctx;
    const name = p.name;
    const out = [];
    const act = ctx.actByName.get(name);
    const heal = ctx.healByName.get(name);
    if (act) {
        const raidAvg = avgOf((report.activity && report.activity.players) || [], (x) => x.activeAvg);
        out.push(kpi("inv_misc_pocketwatch_02", "Aktivität", `${act.activeAvg} %`, { text: `Raid Ø ${raidAvg} %` }, act.activeAvg >= raidAvg ? "good" : act.activeAvg >= 85 ? "" : "medium", "", "Anteil der Kampfzeit mit laufenden Zaubern oder Angriffen", "Im Mittel über die Boss-Kämpfe bis zum eigenen Tod, gegen den Schnitt des Raids."));
    } else if (heal) {
        out.push(kpi("spell_holy_flashheal", "Overheal", `${heal.overhealPct} %`, { text: `${fmtK(heal.healingTotal)} Heilung` }, heal.overhealPct >= 50 ? "high" : heal.overhealPct >= 35 ? "medium" : "good", "", "Anteil der Heilung über volle Lebenspunkte", "Ab 35 % gelb, ab 50 % rot."));
    }
    const measures = playerFights(report.timeline, name).map((f) => fightMeasure(f, name)).filter((m) => m && m.raid);
    if (measures.length) {
        const key = measures.filter((m) => m.key === "hps").length > measures.length / 2 ? "hps" : "dps";
        const same = measures.filter((m) => m.key === key);
        const diff = Math.round((same.reduce((n, m) => n + (m.own / m.raid - 1), 0) / same.length) * 100);
        const label = key.toUpperCase();
        out.push(kpi("spell_nature_bloodlust", label, `${diff >= 0 ? "+" : ""}${diff} %`, { text: diff >= 0 ? "über Raid-Schnitt" : "unter Raid-Schnitt" }, diff >= 0 ? "good" : diff >= -15 ? "medium" : "high", diff >= 0 ? "good" : "", `Eigener ${label} gegen den Raid-Schnitt pro Spieler`, `Im Mittel über ${plural(same.length, "Kampf", "Kämpfe")} mit eigener Kurve von Warcraft Logs.`));
    }
    const deaths = ctx.fights.reduce((n, f) => n + (f.deaths || []).filter((d) => d.name === name).length, 0);
    const mech = ctx.mechByName.get(name);
    const avoidable = mech ? mech.avoidableDeaths || 0 : ctx.fights.reduce((n, f) => n + (f.deaths || []).filter((d) => d.name === name && d.avoidable).length, 0);
    if (ctx.fights.length || mech) {
        out.push(kpi("ability_creature_cursed_05", "Tode", String(mech ? mech.deaths || 0 : deaths), avoidable ? { text: `${avoidable} vermeidbar`, bad: true } : null, avoidable ? "high" : deaths ? "medium" : "good", "", "Tode in allen Boss-Kämpfen", "Vermeidbar: der Todesstoß kam von einer Mechanik, der man ausweichen kann."));
    }
    const cons = ctx.consByName.get(name);
    const issues = ((ctx.gearByName.get(name) || {}).issues || p.issues || []);
    if (cons) {
        out.push(kpi("inv_alchemy_endlessflask_05", "Vorbereitung", `${cons.buffed} %`, { text: issues.length ? plural(issues.length, "Gear-Problem", "Gear-Probleme") : "Gear ok" }, cons.buffed >= 90 && !issues.length ? "good" : cons.buffed < 50 ? "high" : "medium", cons.buffed >= 90 ? "good" : "", "Flask oder beide Elixiere, Anteil der Boss-Kämpfe", "Dahinter die Gear-Probleme aus der Ausrüstung beim Pull."));
    }
    return out.length ? `<div class="kpis">${out.join("")}</div>` : "";
}

/**
 * "Deine Kämpfe": one row per boss the raider was in — WCL boss icon, tries,
 * the own DPS/HPS as a bar against the raid mean per player, the activity bar
 * and a hint badge; "Verlauf" opens that boss's charts in a dialog. The
 * segment shows only the rows with a hint, or all.
 */
function playerFightTable(ctx, p) {
    const name = p.name;
    const bosses = groupByBoss(playerFights(ctx.report.timeline, name));
    if (!bosses.length) return { html: "", dialogs: "" };
    const rows = bosses.map((b, bi) => {
        const ms = b.fights.map((f) => fightMeasure(f, name)).filter(Boolean);
        const key = ms.length ? ms[0].key : "dps";
        const own = ms.length ? Math.round(ms.reduce((n, m) => n + m.own, 0) / ms.length) : null;
        const raidMs = ms.filter((m) => m.raid);
        const raid = raidMs.length ? Math.round(raidMs.reduce((n, m) => n + m.raid, 0) / raidMs.length) : null;
        const acts = b.fights.map((f) => (f.activity || []).find((a) => a.name === name)).filter((a) => a && Number.isFinite(a.activePct));
        const act = acts.length ? Math.round(acts.reduce((n, a) => n + a.activePct, 0) / acts.length) : null;
        const deaths = b.fights.flatMap((f) => (f.deaths || []).filter((d) => d.name === name));
        const avoidable = deaths.filter((d) => d.avoidable).length;
        const hints = [];
        if (deaths.length) hints.push(badge(avoidable ? `${avoidable} vermeidbar` : plural(deaths.length, "Tod", "Tode"), avoidable ? "bad" : "mid", "ability_creature_cursed_05"));
        if (own !== null && raid && own < raid * 0.9) hints.push(badge("unter Schnitt", "mid"));
        if (act !== null && act < 85) hints.push(badge(`${act} % aktiv`, "mid"));
        return { b, bi, key, own, raid, act, hints };
    });
    const maxOwn = Math.max(1, ...rows.map((r) => r.own || 0));
    const flagged = rows.filter((r) => r.hints.length).length;
    const onlyFlagged = flagged > 0 && flagged < rows.length;
    const body = rows.map((r) => {
        const icon = bossIconUrl(r.b.encounterId);
        const label = r.key.toUpperCase();
        const ownCell = r.own === null ? "<span class=\"mute\">–</span>" : barCell(fmtK(r.own), (r.own / maxOwn) * 100, r.raid ? (r.own >= r.raid ? "good" : r.own < r.raid * 0.9 ? "medium" : "") : "", `${label} ${name}`, r.raid ? `Raid-Schnitt pro Spieler: ${fmtK(r.raid)}. Grün ab dem Schnitt, gelb unter 90 % davon.` : "");
        return `<tr data-flag="${r.hints.length ? 1 : 0}"${onlyFlagged && !r.hints.length ? " hidden" : ""}>
          <td><span class="who">${icon ? `<img class="hicon" src="${esc(icon)}" alt="">` : ""}<span>${esc(r.b.name)}</span></span></td>
          <td>${badge(String(r.b.fights.length), "", "", true)}</td>
          <td>${ownCell}</td>
          <td class="mono mute">${r.raid ? fmtK(r.raid) : "–"}</td>
          <td class="act">${r.act === null ? "<span class=\"mute\">–</span>" : barPct(r.act)}</td>
          <td><div class="badges">${r.hints.join("")}</div></td>
          <td style="text-align:right"><button type="button" class="btn btn-ghost btn-sm" data-dialog="dlg-pf-${r.bi}">${LINE.expand}Verlauf</button></td>
        </tr>`;
    }).join("");
    const dialogs = rows.map((r) => {
        const ns = "p-"; // fight ids are unique across bosses, so every boss dialog can share the page prefix
        const icon = bossIconUrl(r.b.encounterId);
        const sections = r.b.fights.map((f, j) => renderFightSection(f, null, name, j + 1, r.b.fights.length, j === 0, "inline", ns, { crumb: "" })).join("");
        return `<dialog class="dlg chart" id="dlg-pf-${r.bi}">
          <div class="dlg-head">${icon ? `<img class="vcard-icon" src="${esc(icon)}" alt="">` : ""}<div class="dlg-main"><div class="dlg-title">${hicon("inv_misc_pocketwatch_01", "")}${esc(r.b.name)} · ${esc(name)}</div><div class="vcard-meta">${plural(r.b.fights.length, "Try", "Tries")} · ${PX_PER_SEC} px pro Sekunde, seitlich scrollen</div></div>${dlgClose()}</div>
          <div class="dlg-body">${tryPills(r.b, ns)}${sections}</div>
          <div class="dlg-foot"><span class="note">Tode als senkrechte Striche in Klassenfarbe · Tabellenansicht unter jeder Grafik aufklappbar</span><div class="btns"><button type="button" class="btn btn-sm" data-close>Schließen</button></div></div>
        </dialog>`;
    }).join("");
    const seg = flagged && flagged < rows.length
        ? `<nav class="seg sm pf-seg"><button type="button" class="seg-btn active" data-pfilter="flag">Auffällige<span class="n mid">${flagged}</span></button><button type="button" class="seg-btn" data-pfilter="all">Alle ${rows.length}</button></nav>`
        : "";
    const shown = onlyFlagged ? flagged : rows.length;
    const html = `<section class="gcard" id="p-fights">${groupHead("inv_misc_pocketwatch_01", "", "Deine Kämpfe", `${name} › Kampfverlauf · ${shown} von ${plural(rows.length, "Boss", "Bossen")} gezeigt`, seg)}
      <div class="tbox"><table class="idx pfights"><tr><th>Boss</th><th data-tip="Tries" data-tip-sub="Pulls dieses Bosses, in denen der Raider dabei war.">Tries</th><th data-tip="Dein DPS / HPS" data-tip-sub="Im Mittel über die Tries, aus der eigenen 5-Sekunden-Kurve von Warcraft Logs. Der Balken ist der Anteil am besten eigenen Boss.">Dein ${rows.some((r) => r.key === "hps") && rows.every((r) => r.key === "hps") ? "HPS" : "DPS"}</th><th data-tip="Raid Ø" data-tip-sub="Raid-Kurve geteilt durch die Zahl der Spieler mit einer Kurve.">Raid Ø</th><th data-tip="Aktiv" data-tip-sub="Anteil der Kampfzeit mit laufenden Zaubern oder Angriffen, bis zum eigenen Tod.">Aktiv</th><th>Hinweis</th><th></th></tr>${body}</table></div>
    </section>`;
    return { html, dialogs };
}

// "Auffällige / Alle" on the player page's fight table.
const PFIGHTS_SCRIPT = `<script>(function(){if(window.__ehPf)return;window.__ehPf=1;
document.addEventListener("click",function(e){var b=e.target.closest("[data-pfilter]");if(!b)return;var all=b.getAttribute("data-pfilter")==="all",s=b.closest("section");b.parentElement.querySelectorAll("[data-pfilter]").forEach(function(x){x.classList.toggle("active",x===b);});
s.querySelectorAll("tr[data-flag]").forEach(function(tr){tr.hidden=!all&&tr.getAttribute("data-flag")!=="1";});});})();</script>`;

/**
 * The player page, focused: head with the class icon, name and badges; four
 * personal KPIs; "Deine Punkte für den nächsten Raid" first (a reader sees
 * only the approved ones, the first opened with its text); "Deine Kämpfe" per
 * boss with the chart in a dialog; Vorbereitung / Leistung / Fehler as
 * collapsed area heads with one badge each.
 */
function renderPlayerPage(report, idx, user) {
    const p = (report.roster || [])[idx];
    if (!p) return renderNotFound();
    const ctx = reportContext(report, user);
    const { reviewer } = ctx;
    const name = p.name;
    const color = classColorOf(p.type) || "var(--text)";
    const role = ctx.roleOf(name);
    const recP = ctx.recByName.get(name);
    const items = recP ? (reviewer ? recP.items : recP.items.filter((x) => x.approved === true)) : [];
    const open = items.filter((x) => x.approved === null).length;
    const approved = items.filter((x) => x.approved === true).length;
    const fights = playerFights(report.timeline, name);
    const { secs, dialogs } = raiderSections(ctx, p, idx, items, { openFirst: true });

    const roleIcon = { tank: "inv_shield_06", healer: "spell_holy_flashheal", dps: "ability_dualwield" }[role];
    const meta = [
        badge(p.type, ""),
        ROLE_LABEL[role] ? badge(ROLE_LABEL[role], "accent", roleIcon) : "",
        fights.length ? badge(plural(fights.length, "Kampf", "Kämpfe"), "", "", true) : "",
    ].filter(Boolean).join("");
    const sendBtn = reviewer && recP ? `<button type="button" class="btn btn-sm" data-dialog="send-${idx}"${approved ? "" : " disabled"}>${hicon("inv_letter_15", "")}Vorschau &amp; senden</button>` : "";
    const kicker = [report.title, report.date].filter(Boolean).map(esc).join(" · ");

    const recs = secs.find((s) => s.key === "recs");
    const points = `<section class="gcard" id="p-points">${groupHead("inv_misc_note_01", open ? "mid" : "", reviewer ? "Punkte für den nächsten Raid" : "Deine Punkte für den nächsten Raid", `${name} › Empfehlungen · ${reviewer ? `${approved} freigegeben · ${open} offen` : "von der Raidleitung geprüft"}`, badge(String(items.length), "", "", true))}${recs ? recs.html : "<div class=\"rlist\"><div class=\"rec-empty\">Noch keine freigegebenen Punkte.</div></div>"}${reviewer && recP ? `<div class="raider-foot" data-report="${esc(report.id)}" data-name="${esc(name)}"><span class="note">${approved} freigegeben · ${open} offen · zuletzt gesendet: ${ctx.sent[name] ? esc(new Date(ctx.sent[name].at).toLocaleString("de-DE")) : "nie"}</span><span class="rec-send-result" hidden></span><div class="btns"><button type="button" class="btn btn-run btn-sm" data-phrase="player" data-tip="Claude formuliert die Befunde dieses Raiders in Klartext" data-tip-sub="Deine Freigabe bleibt nötig; der Regeltext bleibt erhalten.">${hicon("inv_scroll_03", "")}KI-Formulierung</button></div></div>` : ""}</section>`;
    const fightTable = playerFightTable(ctx, p);
    const detail = secs.filter((s) => s.key !== "recs").map((s) => {
        const tone = s.tone === "bad" ? "bad" : s.tone === "mid" ? "mid" : "";
        return `<details class="pgrp" id="p-${s.key}"><summary>${groupHead(s.icon, tone, s.label, `${name} › ${s.crumb}`, `${s.badge || ""}${expBtn()}`)}</summary><div class="pgrp-body">${s.html}</div></details>`;
    }).join("");

    const body = `
      <div class="page-head phead" style="--cc:${esc(color)}">
        <img class="phead-icon" src="${esc(classIconUrl(p.type))}" alt="${esc(p.type)}">
        <div class="page-head-main">
          <div class="kicker">${kicker}</div>
          <h1 class="page-title ptitle-cn">${esc(name)}</h1>
          <div class="vcard-meta">${meta}</div>
        </div>
        <div class="page-actions">${armoryLink(name, "btn btn-ghost btn-sm")}<a class="btn btn-ghost btn-sm" href="/r/${esc(report.id)}#raider">${LINE.back}Zum Report</a>${sendBtn}</div>
      </div>
      ${playerKpis(ctx, p)}
      <div class="pstack">${points}${fightTable.html}${detail}</div>
      ${fightTable.dialogs}${dialogs}${reviewer && recP ? sendDialog(ctx, p, idx, items) : ""}
      ${TIMELINE_SCRIPT}${DIALOG_SCRIPT}${PFIGHTS_SCRIPT}${reviewer ? REVIEW_SCRIPT + PHRASE_SCRIPT + SEND_DLG_SCRIPT : ""}`;

    return shellPage(`${name} — ${report.title || ""}`, {
        user,
        body,
        crumbs: [
            { label: report.title || "Log-Check", href: `/r/${report.id}` },
            { label: name },
        ],
    });
}

// Login state for the public header. Admins never see this — they get the admin
// chrome (sidebar + user footer) around the page instead.
function authBar(user) {
    if (user && user.name) {
        const admin = user.isAdmin ? " · <a class=\"mlink\" href=\"/\">Gildenmenü</a>" : "";
        return `<span class="sub" style="margin:0">Eingeloggt als <strong>${esc(user.name)}</strong>${admin} · <a class="mlink" href="/auth/logout">Logout</a></span>`;
    }
    return `<a class="discord-btn" href="/auth/login">${DISCORD_LOGO}<span>Mit Discord einloggen</span></a>`;
}

function renderNotFound() {
    return layout("Nicht gefunden", `${publicBar(null)}<h1 class="page-title" style="margin-top:24px">404</h1><p class="sub">Diese Seite existiert nicht (mehr). <a class="mlink" href="/">Zur Übersicht</a></p>`);
}

function renderError(title, message) {
    return layout(title, `${publicBar(null)}<h1 class="page-title" style="margin-top:24px">${esc(title)}</h1><p class="sub">${esc(message)}</p><p class="sub"><a class="mlink" href="/">Zur Übersicht</a> · <a class="mlink" href="/auth/login">Erneut einloggen</a></p>`);
}

module.exports = { renderReportPage, renderPlayerPage, renderNotFound, renderError, layout, esc, authBar, themeToggleBtn };
