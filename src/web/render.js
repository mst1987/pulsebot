// HTML rendering for the logcheck report website.
// Uses the Wowhead tooltip widget (power.js) + zamimg icon CDN — no local assets.
//
// Report pages are public (their links are posted to Discord), so they stay
// server-rendered. Visitors with admin rights get the same sidebar/topbar chrome
// as the React admin around them (see adminChrome.js) so a log-check is a normal
// stop inside the admin menu instead of a dead end.

const { renderAdminChrome, CHROME_STYLE, ICONS } = require("./adminChrome");
const rpbData = require("../config/rpbData");
const { ribbonChart, markerChart, lineChart, fmtTime, CHART_STYLE, PX_PER_SEC } = require("./charts");
const { bossIconUrl } = require("../config/bosses");
const { TANK_AURAS } = require("../config/healerSpells");
const { ROLE_LABELS: BUFF_ROLE_LABELS } = require("../config/raidBuffs");
const { applyReview } = require("../utils/logcheck/recommendations");

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
    if (o.itemId) return `https://www.wowhead.com/tbc/item=${o.itemId}`;
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

/**
 * Build a tab bar + its panels. Panels are emitted as siblings of the nav, which
 * is what the click handler scopes on, so these nest safely inside a panel.
 * @param {Array<{id,label,icon?,count?,html}>} items
 */
function tabbed(items, extraClass) {
    if (items.length === 0) return "";
    if (items.length === 1) return items[0].html;
    const buttons = items.map((t, i) => {
        const count = (t.count === undefined || t.count === null) ? "" : `<span class="tab-count">${esc(t.count)}</span>`;
        return `<button class="tab-btn${i === 0 ? " active" : ""}" data-tab="${esc(t.id)}">${hicon(t.icon, "")}<span>${esc(t.label)}</span>${count}</button>`;
    }).join("");
    const panels = items.map((t, i) =>
        `<div id="tab-${esc(t.id)}" class="tabpanel${i === 0 ? " active" : ""}">${t.html}</div>`).join("");
    return `<nav class="tabs${extraClass ? ` ${extraClass}` : ""}">${buttons}</nav>${panels}`;
}

// A theme-toggle button. The shared script (below) paints its icon and wires the click.
function themeToggleBtn() {
    return "<button class=\"theme-toggle\" id=\"themeBtn\" type=\"button\" aria-label=\"Design umschalten\" title=\"Hell/Dunkel\"></button>";
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
  .summary { background:var(--panel); border:1px solid var(--line); border-left:3px solid var(--area-cla); padding:12px 16px; margin-bottom:16px; }
  .summary strong { font-family:var(--font-mono); font-variant-numeric:tabular-nums; }
  /* ---- stat tiles + clipped panel geometry: the 2026-07 admin design signature ---- */
  .tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:14px; margin:0 0 20px; }
  .tile { background:var(--panel); border:1px solid var(--line); border-top:2px solid var(--area-cla); padding:16px 18px; position:relative;
    clip-path:polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 0 100%);
    transition:transform .18s cubic-bezier(.34,1.56,.64,1), box-shadow .18s ease, border-color .18s ease; }
  .tile::after { content:""; position:absolute; top:0; right:0; width:14px; height:14px;
    background:linear-gradient(135deg, var(--area-cla) 0%, var(--area-cla) 42%, transparent 44%); opacity:.85; pointer-events:none; }
  .tile:hover { transform:translateY(-3px); border-color:var(--area-cla); box-shadow:0 14px 32px -14px var(--area-cla); }
  .tile .t-label { font-size:11.5px; color:var(--muted); font-weight:600; font-family:var(--font-mono); text-transform:uppercase; letter-spacing:.04em; }
  .tile .t-value { font-size:30px; font-weight:700; letter-spacing:-.02em; margin-top:6px; line-height:1; font-variant-numeric:tabular-nums; font-family:var(--font-mono); }
  .tile .t-value.warn { color:var(--high); }
  .tile .t-value.good { color:var(--good); }
  .tile .t-sub { font-size:12.5px; color:var(--muted); margin-top:6px; }
  .panel-box { background:var(--panel); border:1px solid var(--line); overflow:hidden; position:relative;
    clip-path:polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 0 100%); }
  .panel-box::after { content:""; position:absolute; top:0; right:0; width:14px; height:14px;
    background:linear-gradient(135deg, var(--area-cla) 0%, var(--area-cla) 42%, transparent 44%); opacity:.85; pointer-events:none; }
  .panel-box table.idx th, .panel-box table.idx td { padding:10px 16px; }
  .panel-box table.idx th { background:var(--panel2); text-transform:uppercase; letter-spacing:.04em; font-family:var(--font-mono); font-size:11.5px; }
  .panel-box table.idx tr:last-child td { border-bottom:0; }
  @media (prefers-reduced-motion: reduce) { .tile { transition:none; } .tile:hover { transform:none; } }
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
  .buff-list .tag { display:inline-flex; align-items:center; gap:4px; margin:2px 4px 2px 0; }
  .buff-list .tag .hicon { width:16px; height:16px; margin:0; }
  .pname-cell { display:inline-flex; align-items:center; gap:8px; text-decoration:none; }
  .pname-cell img { width:20px; height:20px; border-radius:4px; }
  .srval { font-weight:700; font-family:var(--font-mono); font-variant-numeric:tabular-nums; }
  .sritems { color:var(--muted); font-size:12.5px; }
  .sritems a, a.pname-cell:hover span { text-decoration:underline; }
  .note { color:var(--muted); font-size:12.5px; margin:-6px 0 12px; }
  /* tabs: same shape as the React admin's .tabs/.tab-btn/.tab-count */
  nav.tabs { display:flex; gap:6px; flex-wrap:wrap; margin:8px 0 20px; border-bottom:1px solid var(--line); }
  nav.tabs .tab-btn { appearance:none; background:transparent; border:1px solid transparent; border-bottom:none; color:var(--muted);
    font:inherit; font-weight:600; padding:9px 16px; border-radius:9px 9px 0 0; cursor:pointer; margin-bottom:-1px;
    display:inline-flex; align-items:center; gap:7px; }
  nav.tabs .tab-btn:hover { color:var(--text); background:var(--panel2); }
  nav.tabs .tab-btn.active { color:var(--text); background:var(--panel); border-color:var(--line); border-bottom-color:var(--panel); }
  .tab-count { display:inline-block; padding:0 7px; border-radius:999px; font-size:11.5px; font-weight:700; font-family:var(--font-mono);
    background:var(--panel2); color:var(--muted); border:1px solid var(--line); font-variant-numeric:tabular-nums; }
  nav.tabs .tab-btn.active .tab-count { background:var(--area-cla-soft); color:var(--area-cla); border-color:var(--area-cla-soft); }
  .tabpanel { display:none; }
  .tabpanel.active { display:block; }
  .rolehead { font-size:14px; margin:20px 0 8px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; }
  .rolehead:first-child { margin-top:0; }
  .scrollx { overflow-x:auto; }
  /* ---- RPB panels: one shared geometry so every table lines up ---- */
  nav.tabs.sub { border-bottom:0; margin:2px 0 14px; gap:4px; }
  nav.tabs.sub .tab-btn { padding:6px 12px; font-size:13.5px; border-radius:8px; border:1px solid transparent; }
  nav.tabs.sub .tab-btn.active { background:var(--panel2); border-color:var(--line); }
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
  /* damage severity scale — share of the highest value in that column raid-wide */
  td.n .dv { display:inline-block; min-width:74px; padding:2px 8px; border-radius:6px; text-align:right; }
  .dv-1 { background:var(--good-bg); color:var(--good); }
  .dv-2 { background:rgba(214,196,60,.18); color:#c9ac26; }
  .dv-3 { background:var(--medium-bg); color:var(--medium); }
  .dv-4 { background:var(--high-bg); color:var(--high); font-weight:700; }
  :root[data-theme="dark"] .dv-2, :root:not([data-theme="light"]) .dv-2 { color:#dfc84a; }
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
  /* table-orientation switch */
  .tblswitch { display:inline-flex; margin:0 0 12px; border:1px solid var(--line); border-radius:9px; overflow:hidden; }
  .tblswitch button { appearance:none; background:var(--panel); border:0; color:var(--muted); font:inherit; font-size:13px; font-weight:600;
    padding:7px 14px; cursor:pointer; }
  .tblswitch button + button { border-left:1px solid var(--line); }
  .tblswitch button.active { background:var(--accent-soft); color:var(--accent); }
  .viewroot .tview-a { display:none; }
  .viewroot.va .tview-p { display:none; }
  .viewroot.va .tview-a { display:block; }
  .legend { display:flex; flex-wrap:wrap; gap:6px 16px; margin:0 0 12px; color:var(--muted); font-size:12.5px; align-items:center; }
  .legend .lg { display:inline-flex; align-items:center; gap:6px; }
  .legend .sw { width:15px; height:15px; border-radius:4px; border:1px solid var(--line); flex:0 0 auto; }
  .legend .sw.warn { border-color:var(--high); background:var(--high-bg); }
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
  nav.tabs .tab-btn .hicon { margin-right:0; }
  /* hero header */
  .hero { position:relative; overflow:hidden; border:1px solid var(--line); border-top:2px solid var(--cc); background:var(--panel);
    padding:18px 20px; margin:6px 0 22px; display:flex; align-items:center; gap:16px;
    clip-path:polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 0 100%); }
  .hero::after { content:""; position:absolute; top:0; right:0; width:16px; height:16px;
    background:linear-gradient(135deg, var(--cc) 0%, var(--cc) 42%, transparent 44%); opacity:.85; pointer-events:none; }
  .hero-bg { position:absolute; inset:0; background:radial-gradient(120% 160% at 0% 0%, color-mix(in srgb, var(--cc) 28%, transparent), transparent 60%); pointer-events:none; }
  .hero-class { width:64px; height:64px; border-radius:12px; border:2px solid var(--cc); position:relative; z-index:1; }
  .hero-main { position:relative; z-index:1; }
  .hero-name { font-size:26px; font-weight:800; line-height:1.1; }
  .hero-sub { color:var(--muted); margin-bottom:8px; }
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
  /* fight timeline (Kampfverlauf): boss tabs → try pills → topic switch */
  [hidden] { display:none !important; }
  .boss-tabs { display:flex; flex-wrap:wrap; gap:8px; margin:0 0 14px; }
  .boss-tab { display:inline-flex; align-items:center; gap:10px; padding:8px 16px 8px 8px; border:1px solid var(--line); background:var(--panel); color:var(--muted); font:inherit; font-size:16px; font-weight:600; cursor:pointer; }
  .boss-tab img { width:36px; height:36px; border-radius:6px; border:1px solid var(--line); display:block; }
  .boss-tab:hover { color:var(--text); border-color:var(--muted); }
  .boss-tab.active { color:var(--text); border-color:var(--accent); box-shadow:inset 0 -3px 0 var(--accent); }
  .boss-tries { font-size:12px; font-weight:600; padding:2px 8px; border-radius:10px; background:var(--panel2); color:var(--muted); font-family:var(--font-mono); }
  .boss-tab.active .boss-kill { background:var(--good-bg); color:var(--good); }
  .boss-tab.active .boss-wipe { background:var(--high-bg); color:var(--high); }
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
  /* Empfehlungen: verdict cards */
  .rec-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(340px, 1fr)); gap:14px; align-items:start; }
  .rec-card { background:var(--panel); border:1px solid var(--line); border-top:2px solid var(--cc); padding:0 14px 0; }
  .rec-card[open] { padding-bottom:6px; }
  .rec-card-head { display:flex; align-items:center; gap:10px; padding:12px 0; cursor:pointer; list-style:none; }
  .rec-card-head::-webkit-details-marker { display:none; }
  .rec-card-head:hover { color:var(--text); }
  .rec-chev { width:8px; height:8px; border-right:2px solid var(--muted); border-bottom:2px solid var(--muted); transform:rotate(45deg); transition:transform .15s; flex:none; margin:0 4px 4px 0; }
  .rec-card[open] .rec-chev { transform:rotate(-135deg); margin:4px 4px 0 0; }
  .rec-card-open { border-top-color:var(--accent); }
  .rec-players-head { display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
  .rec-players-head h2 { margin-right:auto; }
  .rec-toggle-all { display:flex; gap:6px; }
  .rec-card-head img { width:28px; height:28px; border-radius:6px; border:1px solid var(--line); }
  .rec-card-head h3 { margin:0; font-size:16px; }
  .rec-card-head .cn, .rec-card-head .cn a { color:var(--cc); text-decoration:none; }
  .rec-count { margin-left:auto; font-size:12px; font-family:var(--font-mono); padding:2px 8px; border-radius:10px; background:var(--panel2); color:var(--muted); }
  .rec-clean { color:var(--good); font-size:14px; padding:6px 0 10px; }
  .rec-list { list-style:none; margin:0; padding:0; }
  .rec { border-left:3px solid var(--line); padding:8px 12px; margin:0 0 10px; background:var(--panel2); }
  .rec-high { border-left-color:var(--high); } .rec-medium { border-left-color:var(--medium); } .rec-low { border-left-color:var(--muted); }
  .rec-state-rejected { opacity:.55; }
  .rec-head { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }
  .rec-impact { font-size:11px; font-family:var(--font-mono); text-transform:uppercase; letter-spacing:.06em; padding:1px 6px; border-radius:3px; background:var(--panel3); color:var(--muted); }
  .rec-high .rec-impact { background:var(--high-bg); color:var(--high); } .rec-medium .rec-impact { background:var(--medium-bg); color:var(--medium); }
  .rec-title { font-size:15px; }
  .rec-state { margin-left:auto; font-size:12px; font-family:var(--font-mono); color:var(--muted); }
  .rec-state-approved .rec-state { color:var(--good); } .rec-state-rejected .rec-state { color:var(--high); }
  .rec-body { margin:6px 0; font-size:14px; }
  .rec-evidence { display:flex; flex-wrap:wrap; gap:6px 14px; font-size:12px; color:var(--muted); }
  .rec-ev b { margin-left:5px; font-family:var(--font-mono); color:var(--text); }
  .rec-review { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-top:8px; padding-top:8px; border-top:1px solid var(--line-soft); }
  .rec-text { flex:1 1 100%; font:inherit; font-size:13px; padding:6px 8px; background:var(--panel); color:var(--text); border:1px solid var(--line); resize:vertical; }
  .rec-status { font-size:12px; color:var(--muted); }
  @media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) .rec-card-head .cn, :root:not([data-theme="dark"]) .rec-card-head .cn a { color:color-mix(in srgb, var(--cc) 70%, #000); } }
  :root[data-theme="light"] .rec-card-head .cn, :root[data-theme="light"] .rec-card-head .cn a { color:color-mix(in srgb, var(--cc) 70%, #000); }
${CHART_STYLE}
${opts.extraStyle || ""}
</style>
</head>
<body${opts.bodyClass ? ` class="${opts.bodyClass}"` : ""}>
${inner}
<script>
/* Tabs are nested (report section > role), so a click may only touch the panels
   that belong to the clicked nav — i.e. its own siblings, not every .tabpanel. */
document.addEventListener("click",function(e){
  var b=e.target.closest("[data-tab]"); if(!b) return;
  var nav=b.closest("nav.tabs"); if(!nav) return;
  nav.querySelectorAll("[data-tab]").forEach(function(x){x.classList.toggle("active",x===b);});
  var t=b.getAttribute("data-tab"), scope=nav.parentElement; if(!scope) return;
  Array.prototype.forEach.call(scope.children,function(p){
    if(p.classList&&p.classList.contains("tabpanel")) p.classList.toggle("active",p.id==="tab-"+t);
  });
});
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
  window.addEventListener("scroll",function(){ if(cur) place(cur); },true);
})();
/* Orientation switch for the damage table (players as rows <-> abilities as rows). */
document.addEventListener("click",function(e){
  var b=e.target.closest("[data-view]"); if(!b) return;
  var root=b.closest(".viewroot"); if(!root) return;
  root.querySelectorAll("[data-view]").forEach(function(x){x.classList.toggle("active",x===b);});
  root.classList.toggle("va",b.getAttribute("data-view")==="a");
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
            crumbs: [{ label: "Menü", href: "/" }, { label: "CLA / Logcheck", href: "/cla" }, ...crumbs],
            body,
            actions: themeToggleBtn(),
            esc,
        });
        return layout(title, chrome, { bare: true, extraStyle: CHROME_STYLE });
    }
    return layout(title, `${publicBar(user)}${body}`);
}

// A stat tile for the report header (same shape as the admin dashboard's tiles).
function tile(label, value, sub, tone) {
    return `<div class="tile">
      <div class="t-label">${esc(label)}</div>
      <div class="t-value${tone ? ` ${tone}` : ""}">${esc(value)}</div>
      ${sub ? `<div class="t-sub">${sub}</div>` : ""}
    </div>`;
}

// Table panels sit on a panel card; the gear grid brings its own cards.
function panelBox(html) {
    return `<div class="panel-box">${html}</div>`;
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
    ${panelBox(`<table class="idx">
      <tr><th>Spieler</th><th>${colHead(ic.flask, "Flask")}</th><th>${colHead(ic.battle, "Elixiere")}</th><th>Flask/Elixiere</th><th>${colHead(ic.food, "Food")}</th><th>Waffe geölt</th></tr>
      ${body}
    </table>`)}`;
}

function renderPotionsPanel(potions, linkFor) {
    const rows = (potions && potions.players) || [];
    if (rows.length === 0) return "<div class=\"empty\">Keine Tränke gefunden.</div>";
    const ic = (potions && potions.icons) || {};
    // Every mana source that actually turned up in this raid gets its own column,
    // so "Mana" is not one opaque number any more.
    const manaTypes = ((potions && potions.types) || []).filter((t) => t.group === "mana");
    const manaHead = manaTypes.map((t) => `<th class="n" data-tip="${esc(t.label)}">${hicon(t.icon, "")}</th>`).join("");

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
          <td class="n">${esc(p.total)}</td>
        </tr>`;
    }).join("");

    const legend = manaTypes.length
        ? `<div class="legend">${manaTypes.map((t) => `<span class="lg">${iconTile({ ...t, label: t.label })}${esc(t.label)}</span>`).join("")}</div>`
        : "";

    return `<p class="note">Anzahl getrunkener Tränke. „Mana" ist die Summe aller Manaquellen; die Spalten dahinter schlüsseln auf, <em>welche</em> — inklusive der zoneneigenen Gratis-Items und der Runen.</p>
    ${legend}
    ${panelBox(`<div class="scrollx"><table class="idx rpb">
      <tr>
        <th class="pcol">Spieler</th>
        <th class="n">${colHead(ic.destruction, "Zerstörung")}</th>
        <th class="n">${colHead(ic.haste, "Hast")}</th>
        <th class="n">${colHead(ic.mana, "Mana")}</th>
        ${manaHead}
        <th class="n">Gesamt</th>
      </tr>
      ${body}
    </table></div>`)}`;
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
    ${panelBox(`<table class="idx">
      <tr><th>Spieler</th><th>SR (Gear)</th><th>Quellen</th></tr>
      ${body}
    </table>`)}`;
}

function renderDrumsPanel(drums, linkFor) {
    const rows = (drums && drums.players) || [];
    if (rows.length === 0) return "<div class=\"empty\">Keine Drums gefunden.</div>";
    const body = rows.map((p) => {
        const parts = Object.entries(p.byType).map(([k, v]) => `${k}: ${v}`).join(", ");
        return `<tr><td>${classCell(p, linkFor(p.name))}</td><td class="srval">${esc(p.total)}</td><td class="sritems">${esc(parts)}</td></tr>`;
    }).join("");
    return panelBox(`<table class="idx">
      <tr><th>Spieler</th><th>${colHead(drums && drums.icon, "Drums gesamt")}</th><th>Aufschlüsselung</th></tr>
      ${body}
    </table>`);
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
    // Without the CLA half there are no potion numbers at all — printing three
    // zeros would read as "drank nothing" rather than "not evaluated yet".
    const hasPotionData = !!(report.potions && report.potions.players && report.potions.players.length);
    const body = roster.map((p) => {
        const pot = p.potions || {};
        const potions = hasPotionData
            ? `<span class="potions">${potionCells(ic, pot)}</span>`
            : "<span class=\"sritems\" data-tip=\"Noch keine CLA-Auswertung für diesen Log\">nicht ausgewertet</span>";
        return `<tr>
          <td>${classCell(p, linkFor(p.name))}</td>
          <td>${issueCountCell((p.issues || []).length)}</td>
          <td>${potions}</td>
          <td><a class="mlink" href="${esc(linkFor(p.name))}">Details →</a></td>
        </tr>`;
    }).join("");
    return panelBox(`<table class="idx">
      <tr><th>Spieler</th><th>Gear-Probleme</th><th>${hicon(ic.destruction)}${hicon(ic.haste)}${hicon(ic.mana)} Potions</th><th></th></tr>
      ${body}
    </table>`);
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
    ${panelBox(`<table class="idx">
      <tr><th>Spieler</th><th>Sunder gesamt</th><th>davon bei &lt; 5 Stacks</th></tr>
      ${body}
    </table>`)}`;
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
    ${panelBox(`<table class="idx">
      <tr><th>Boss</th>${head}</tr>
      ${body}
    </table>`)}`;
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

function fightAnchor(f) {
    return `fight-${esc(f.id)}`;
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

/**
 * The topic parts of one fight: { id, label, count, html }, only those with
 * data. `only` restricts the rows to one raider (the player page).
 */
function fightParts(f, linkFor, only) {
    const common = { duration: f.duration, deaths: f.deaths, classColor: classColorOf };
    const mine = (name) => !only || name === only;
    const parts = [];
    const key = (k) => `fp-${esc(f.id)}-${k}`;

    if (!only && f.debuffs && f.debuffs.length) {
        const rows = f.debuffs.map((d) => ({
            label: d.label, icon: d.icon,
            bands: d.stacks && d.stacks.length ? d.stacks : d.bands,
            maxStacks: d.maxStacks || 0,
            value: Number.isFinite(d.uptimePct) ? `${d.uptimePct}%` : undefined,
            sub: debuffSub(d),
            tone: Number.isFinite(d.uptimePct) ? pctTone(d.uptimePct) : undefined,
        }));
        parts.push({ id: key("debuffs"), label: "Debuffs", count: rows.length, html: ribbonChart({ ...common, rows }) });
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
        parts.push({ id: key("totems"), label: "Totems", count: rows.length, html: markerChart({ ...common, rows }) });
    }

    const cdPlayers = ((f.cooldowns && f.cooldowns.players) || []).filter((p) => mine(p.name));
    if (cdPlayers.length) {
        const rows = cdPlayers.flatMap((p) => (p.rows || []).map((r) => {
            const n = (r.markers || []).length;
            return { ...r, label: only ? r.label : `${p.name} · ${r.label}`, value: r.value !== undefined ? r.value : `${n}×`, sub: r.sub };
        }));
        parts.push({ id: key("cooldowns"), label: "Cooldowns", count: rows.length, html: markerChart({ ...common, rows, windows: f.cooldowns.windows || [] }) });
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
        parts.push({ id: key("activity"), label: "Aktivität", count: rows.length, html: ribbonChart({ ...common, rows }) });
    }

    const mechRows = mechanicRows(f.mechanics, only);
    if (mechRows.length) {
        parts.push({ id: key("mechanics"), label: "Mechaniken", count: mechRows.reduce((n, r) => n + r.markers.length, 0), html: markerChart({ ...common, rows: mechRows }) });
    }

    const healing = healingParts(f, only, common);
    if (healing) parts.push({ id: key("healing"), label: "Heilung", count: healing.count, html: healing.html });

    const buffs = buffParts(f, only, common);
    if (buffs) parts.push({ id: key("buffs"), label: "Buffs", count: buffs.count, html: buffs.html });

    const deaths = only ? (f.deaths || []).filter((d) => d.name === only) : (f.deaths || []);
    if (parts.length === 0) {
        // nothing but the skeleton yet: the fight itself is the one band, so the
        // axis and the deaths are still there to look at
        parts.push({ id: key("fight"), label: "Kampf", count: 1, html: ribbonChart({ ...common, deaths, rows: [{ label: f.kill ? "Kampf (Kill)" : "Kampf (Wipe)", bands: [[0, f.duration]], tone: f.kill ? "good" : "high", value: fmtTime(f.duration) }] }) });
    }
    parts.push({ id: key("deaths"), label: "Tode", count: deaths.length, html: deathsList(deaths, linkFor) });
    return parts;
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

/** One healer's block: headline chips, the mana curve with its regeneration, the spell table. */
function healerBlock(x, f, common) {
    const heal = x.healing || { total: 0, overheal: 0, absorbs: 0, overhealPct: 0, spells: [] };
    const mana = x.mana || { available: false };
    const tone = (v, hi, mid) => (v >= hi ? "high" : v >= mid ? "medium" : "good");
    const chips = [
        `<span class="chip"><b>${fmtK(heal.total)}</b> Heilung</span>`,
        `<span class="chip chip-${tone(heal.overhealPct, 50, 35)}"><b>${esc(heal.overhealPct)} %</b> Overheal</span>`,
        heal.absorbs ? `<span class="chip"><b>${fmtK(heal.absorbs)}</b> Absorb</span>` : "",
        mana.available ? `<span class="chip chip-${mana.min < 10 ? "high" : mana.min < 20 ? "medium" : "good"}"><b>${esc(mana.min)} %</b> Mana-Tiefstand bei ${fmtTime(mana.minAt)}</span>` : "",
        x.dispels && x.dispels.count ? `<span class="chip"><b>${esc(x.dispels.count)}</b> Dispels${x.dispels.avgReactionMs !== null && x.dispels.avgReactionMs !== undefined ? ` · Ø ${fmtSecs(x.dispels.avgReactionMs)}` : ""}</span>` : "",
        x.potionMissing ? "<span class=\"chip chip-medium\"><b>kein</b> Manatrank</span>" : "",
    ].filter(Boolean).join("");
    const manaChart = mana.available
        ? lineChart({
            duration: f.duration, deaths: f.deaths, classColor: common.classColor, step: mana.step, max: 100, unit: "%", markersLabel: "Regeneration",
            series: [{ key: "a", label: `Mana ${x.name}`, values: mana.values }],
            markers: (mana.regen || []).map((r) => ({ at: r.at, icon: r.icon, label: r.label, value: r.pct !== null && r.pct !== undefined ? `bei ${r.pct} %` : undefined })),
        })
        : "<div class=\"fc-empty\">Kein Manaverlauf im Log (keine Ressourcen-Events).</div>";
    const spells = (heal.spells || []).slice(0, 6);
    const table = spells.length
        ? `<table class="idx fc-table heal-spells"><tr><th>Zauber</th><th>Heilung</th><th>Overheal</th><th>Anteil</th></tr>${spells.map((s) =>
            `<tr><td>${s.icon ? hicon(s.icon, "") : ""}${esc(s.name)}</td><td>${fmtK(s.total)}</td><td${s.overhealPct >= 50 ? " class=\"hi\"" : ""}>${esc(s.overhealPct)} %</td><td>${esc(s.share)} %</td></tr>`).join("")}</table>`
        : "";
    const died = x.diedAt !== null && x.diedAt !== undefined ? ` · gestorben ${fmtTime(x.diedAt)}` : "";
    return `<div class="heal-block" style="--cc:${esc(classColorOf(x.type) || "var(--text)")}"><h4 class="heal-h"><span class="cn">${esc(x.name)}</span><span class="meta">${esc(x.type)}${died}</span></h4><div class="heal-chips">${chips}</div>${manaChart}${table}</div>`;
}

/** The Heilung topic of one fight: { count, html }, or null without healers. `only` restricts it to one raider. */
function healingParts(f, only, common) {
    const h = f.healers;
    if (!h || !(h.healers || []).length) return null;
    const healers = h.healers.filter((x) => !only || x.name === only);
    // the tank sees every aura on them, a healer only their own
    const isTank = !!(only && h.tank && h.tank.name === only);
    const shields = (h.shields || []).filter((r) => !only || isTank || r.source === only);
    if (!healers.length && !shields.length) return null;
    const blocks = healers.map((x) => healerBlock(x, f, common)).join("");
    let tank = "";
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
        tank = `<div class="heal-block"><h4 class="heal-h">Schilde &amp; HoTs auf ${esc(h.tank.name)}<span class="meta">Tank · ${esc(h.tank.type)}</span></h4>${ribbonChart({ ...common, rows })}</div>`;
    }
    let missed = "";
    const list = (h.dispels && h.dispels.missed) || [];
    if (!only && list.length) {
        missed = `<div class="heal-block"><h4 class="heal-h">Nie entfernte Debuffs<span class="meta">${list.length}</span></h4><ul class="fight-deaths">${list.map((m) =>
            `<li style="--cc:${esc(classColorOf(m.targetType) || "var(--text)")}"><b>${fmtTime(m.at)}</b><span class="cn">${esc(m.target)}</span><span class="sritems">· ${m.icon ? hicon(m.icon, "") : ""}${esc(m.ability)} · ${fmtTime(m.durationMs)} lang</span></li>`).join("")}</ul></div>`;
    }
    return { count: healers.length, html: blocks + tank + missed };
}

/** The Heiler tab: one row per healer over the raid, the raid's missed dispels above. */
function renderHealersPanel(healers, linkFor) {
    const players = healers.players || [];
    const rows = players.map((p) => {
        const href = linkFor && linkFor(p.name);
        const name = href ? `<a class="cn" href="${esc(href)}">${esc(p.name)}</a>` : `<span class="cn">${esc(p.name)}</span>`;
        const top = p.topOverheal ? `${p.topOverheal.icon ? hicon(p.topOverheal.icon, "") : ""}${esc(p.topOverheal.name)} <span class="sritems">${esc(p.topOverheal.overhealPct)} %</span>` : "–";
        const late = (p.potionPcts || []).filter((x) => x <= 15).length;
        const potions = `${esc(p.potions)}${late ? ` <span class="tag tag-medium">${late}× spät</span>` : ""}${p.potionMissingFights ? ` <span class="tag tag-medium">${esc(p.potionMissingFights)}× keiner</span>` : ""}`;
        const shields = (p.shields || []).map((s) => `<span class="sh" title="${esc(s.label)}: Ø ${esc(s.uptimeAvg)} % in ${esc(s.fights)} Kämpfen">${hicon(s.icon, s.label)}${esc(s.uptimeAvg)} %</span>`).join("") || "–";
        const overClass = p.overhealPct >= 50 ? " class=\"hi\"" : p.overhealPct >= 35 ? " class=\"mid\"" : "";
        const mana = p.manaMinAvg === null || p.manaMinAvg === undefined ? "–" : `${esc(p.manaMinAvg)} %`;
        return `<tr style="--cc:${esc(classColorOf(p.type) || "var(--text)")}"><td>${name}<div class="sritems">${esc(p.type)} · ${esc(p.fights)} ${p.fights === 1 ? "Kampf" : "Kämpfe"}</div></td><td>${fmtK(p.healingTotal)}</td><td${overClass}>${esc(p.overhealPct)} %</td><td>${top}</td><td>${mana}${p.manaLowFights ? ` <span class="tag tag-high">${esc(p.manaLowFights)}× &lt; 10 %</span>` : ""}</td><td>${potions}</td><td>${esc(p.dispels)}${p.avgReactionMs !== null && p.avgReactionMs !== undefined ? ` <span class="sritems">Ø ${fmtSecs(p.avgReactionMs)}</span>` : ""}</td><td>${shields}</td></tr>`;
    }).join("");
    const raid = healers.raid || {};
    const missed = raid.dispelsMissed
        ? `<p class="note">${esc(raid.dispelsMissed)} dispelbare Debuffs hat niemand entfernt${(raid.missedByAbility || []).length ? `: ${raid.missedByAbility.slice(0, 4).map((m) => `${m.icon ? hicon(m.icon, "") : ""}${esc(m.ability)} (${esc(m.count)}×)`).join(", ")}` : ""}.</p>`
        : "";
    const tanks = (raid.tanks || []).length ? `<p class="note">Schild- und HoT-Uptimes gemessen auf dem aktiven Tank (${raid.tanks.map(esc).join(", ")}). Manaverlauf und Zauber pro Kampf stehen im Kampfverlauf unter „Heilung“.</p>` : "";
    return `${tanks}${missed}<table class="idx heal-table"><tr><th>Heiler</th><th>Heilung</th><th>Overheal</th><th>Größter Overheal</th><th>Ø Mana-Tiefstand</th><th>Manatränke</th><th>Dispels</th><th>Auf dem Tank</th></tr>${rows}</table>`;
}

// ---- Buffs: the raid buffs on the players of a fight (f.buffs, utils/logcheck/raidBuffs.js) ----
//   paladins, expected[]  · players[] { name, type, role, diedAt, buffs: [{ key, label, icon, status: full|partial|none, uptimePct, expected, wrong, bands }], missing[], partial[], wrong[] }

const BUFF_STATUS = { full: "da", partial: "ausgelaufen", none: "fehlt" };

function buffTone(c) {
    if (c.wrong) return "high";
    if (!c.expected) return undefined;
    return c.status === "full" ? "good" : c.status === "partial" ? "medium" : "high";
}

/** One player's chips: what was missing, what ran out, what sat on the wrong role. */
function buffChips(p) {
    const byKey = new Map((p.buffs || []).map((c) => [c.key, c]));
    const chip = (key, cls, word) => {
        const c = byKey.get(key) || { label: key, icon: "" };
        return `<span class="tag ${cls}">${hicon(c.icon, "")}${esc(c.label)} ${word}</span>`;
    };
    return [
        ...(p.missing || []).map((k) => chip(k, "tag-high", "fehlt")),
        ...(p.partial || []).map((k) => chip(k, "tag-medium", "ausgelaufen")),
        ...(p.wrong || []).map((k) => chip(k, "tag-medium", "· falsche Rolle")),
    ].join("");
}

/**
 * The Buffs topic of one fight: { count, html }, or null without data. On the
 * raid page a list of who lacked what (a ribbon per player and buff would be
 * two hundred rows); on the player page (`only`) that raider's buffs as
 * ribbons, so a buff that ran out mid-fight is visible as such.
 */
function buffParts(f, only, common) {
    const b = f.buffs;
    if (!b || !(b.players || []).length) return null;
    const expectedLabels = (b.expected || []).map((k) => {
        const c = b.players.flatMap((p) => p.buffs || []).find((x) => x.key === k);
        return c ? c.label : k;
    });
    const head = `<p class="note">${esc(b.paladins || 0)} Paladin${b.paladins === 1 ? "" : "e"} · erwartet: ${expectedLabels.length ? esc(expectedLabels.join(", ")) : "nichts"}</p>`;
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
        const issues = (p.missing || []).length + (p.partial || []).length + (p.wrong || []).length;
        return { count: issues, html: head + ribbonChart({ ...common, rows }) };
    }
    const lacking = b.players.filter((p) => (p.missing || []).length || (p.partial || []).length || (p.wrong || []).length);
    if (!lacking.length) return { count: 0, html: `${head}<p class="note">Alle erwarteten Buffs auf allen Spielern.</p>` };
    const list = lacking.map((p) =>
        `<li style="--cc:${esc(classColorOf(p.type) || "var(--text)")}"><span class="cn">${esc(p.name)}</span><span class="sritems">${esc(BUFF_ROLE_LABELS[p.role] || p.role)}${p.diedAt !== null && p.diedAt !== undefined ? ` · bis ${fmtTime(p.diedAt)}` : ""}</span><span class="buff-list">${buffChips(p)}</span></li>`).join("");
    return { count: lacking.length, html: `${head}<ul class="fight-deaths buff-lacking">${list}</ul>` };
}

/** The Raid-Buffs tab: a player × buff matrix of "share of fights with the buff", the raid's coverage above. */
function renderRaidBuffsPanel(raidBuffs, linkFor) {
    const players = (raidBuffs.players || []).slice().sort((a, b) => (a.type + a.name).localeCompare(b.type + b.name));
    const cols = (raidBuffs.rows || []).filter((r) => r.expected || r.seenPlayers > 0);
    if (!players.length || !cols.length) return "<div class=\"empty\">Keine Raid-Buffs im Log.</div>";
    const head = cols.map((r) => `<th class="bh">${hicon(r.icon, `${r.label} (${r.provider})`)}</th>`).join("");
    const cover = cols.map((r) => `<td class="bc">${r.expected ? pctCell(r.coveragePct) : "<span class=\"pct pct-na\">–</span>"}</td>`).join("");
    const body = players.map((p) => {
        const href = linkFor && linkFor(p.name);
        const name = href ? `<a class="cn" href="${esc(href)}">${esc(p.name)}</a>` : `<span class="cn">${esc(p.name)}</span>`;
        const cells = cols.map((r) => {
            const c = p.buffs && p.buffs[r.key];
            if (!c) return "<td class=\"bc\"><span class=\"pct pct-na\">–</span></td>";
            const tip = `${r.label}: ${c.full}× da, ${c.partial}× ausgelaufen, ${c.none}× gefehlt`;
            if (c.wrong) return `<td class="bc"><span class="pct pct-wrong" title="${esc(`${r.label}: ${c.wrong}× auf der falschen Rolle`)}">${esc(c.pct)}%</span></td>`;
            if (!c.expected) return `<td class="bc"><span class="pct pct-na" title="${esc(`${r.label}: nicht erwartet, ${c.present}× da`)}">${esc(c.pct)}%</span></td>`;
            return `<td class="bc" title="${esc(tip)}">${pctCell(c.pct)}</td>`;
        }).join("");
        return `<tr style="--cc:${esc(classColorOf(p.type) || "var(--text)")}"><td>${name}<div class="sritems">${esc(p.type)} · ${esc(BUFF_ROLE_LABELS[p.role] || p.role)} · ${esc(p.fights)} ${p.fights === 1 ? "Kampf" : "Kämpfe"}</div></td>${cells}</tr>`;
    }).join("");
    const pal = raidBuffs.paladins || 0;
    const note = `<p class="note">Anteil der Bosskämpfe, in denen der Buff die ganze Zeit auf dem Spieler lag (bis zu seinem Tod). Erwartet wird, was die Aufstellung hergibt: ${pal} Paladin${pal === 1 ? "" : "e"} heißt ${pal === 1 ? "ein Segen" : `${pal} Segen`} pro Spieler, Macht auf Tanks und Nahkämpfer, Weisheit auf Heiler und Caster. Grau: nicht erwartet; gestrichelt: Segen auf der falschen Rolle. Wer wann was nicht hatte, steht im Kampfverlauf unter „Buffs“.</p>`;
    return `${note}<div style="overflow-x:auto"><table class="idx heal-table buff-matrix"><tr><th>Spieler</th>${head}</tr><tr class="cov"><td><b>Abdeckung</b><div class="sritems">Raid</div></td>${cover}</tr>${body}</table></div>`;
}

/** The DPS/HPS strip above the topic switch. */
function fightSeries(f) {
    if (!f.series || !(f.series.dps || f.series.hps)) return "";
    const series = [];
    if (f.series.dps) series.push({ key: "a", label: "Raid-DPS", values: f.series.dps });
    if (f.series.hps) series.push({ key: "b", label: "Raid-HPS", values: f.series.hps });
    return `<div class="fight-series">${lineChart({ duration: f.duration, deaths: f.deaths, classColor: classColorOf, step: f.series.step, series, bossHp: f.series.bossHp })}</div>`;
}

/** One try: its head line, the DPS strip, the topic switch and the topic panels. */
function renderFightSection(f, linkFor, only, tryNo, tries, active) {
    const parts = fightParts(f, linkFor, only);
    const deaths = (f.deaths || []).length;
    const seg = parts.map((p, i) =>
        `<button type="button" class="seg-btn${i === 0 ? " active" : ""}" data-show="${p.id}">${esc(p.label)}<span class="n">${esc(p.count)}</span></button>`).join("");
    const panels = parts.map((p, i) => `<div id="${p.id}" class="fight-part"${i === 0 ? "" : " hidden"}>${p.html}</div>`).join("");
    return `<section class="fight${f.kill ? "" : " fight-wipe"}" id="${fightAnchor(f)}"${active ? "" : " hidden"}>
      <div class="fight-head">
        <h3>${esc(f.boss)}</h3>
        <span class="meta">${tries > 1 ? `Try ${tryNo}/${tries} · ` : ""}${esc(fightOutcome(f))} · ${fmtTime(f.duration)} · ${deaths} ${deaths === 1 ? "Tod" : "Tode"}</span>
      </div>
      ${only ? "" : fightSeries(f)}
      <nav class="seg">${seg}</nav>
      ${panels}
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

// The one script the tab shares: a click on [data-show] activates that button
// among its siblings and shows the matching panel among the siblings' panels.
const TIMELINE_SCRIPT = `<script>(function(){if(window.__ehShow)return;window.__ehShow=1;
document.addEventListener("click",function(e){var b=e.target.closest("[data-show]");if(!b)return;
var nav=b.parentElement,btns=nav.querySelectorAll("[data-show]");
for(var i=0;i<btns.length;i++){var x=btns[i],p=document.getElementById(x.getAttribute("data-show"));x.classList.toggle("active",x===b);if(p)p.hidden=x!==b;}});})();</script>`;

function renderBossTabs(bosses, only) {
    const tabs = bosses.map((b, i) => {
        const icon = bossIconUrl(b.encounterId);
        const kills = b.fights.filter((f) => f.kill).length;
        const state = kills ? "kill" : "wipe";
        return `<button type="button" class="boss-tab${i === 0 ? " active" : ""}" data-show="fb-${only ? "p-" : ""}${esc(b.key)}">`
            + (icon ? `<img src="${esc(icon)}" alt="">` : "")
            + `<span class="boss-name">${esc(b.name)}</span>`
            + `<span class="boss-tries boss-${state}">${b.fights.length} ${b.fights.length === 1 ? "Try" : "Tries"}</span></button>`;
    }).join("");
    return `<nav class="boss-tabs">${tabs}</nav>`;
}

function renderBossPanels(bosses, linkFor, only) {
    return bosses.map((b, i) => {
        const pills = b.fights.map((f, j) =>
            `<button type="button" class="try-pill${j === 0 ? " active" : ""}${f.kill ? " try-kill" : " try-wipe"}" data-show="${fightAnchor(f)}">Try ${j + 1}<span class="s">${esc(fightOutcome(f))} · ${fmtTime(f.duration)}</span></button>`).join("");
        const sections = b.fights.map((f, j) => renderFightSection(f, linkFor, only, j + 1, b.fights.length, j === 0)).join("");
        return `<div id="fb-${only ? "p-" : ""}${esc(b.key)}" class="fight-boss"${i === 0 ? "" : " hidden"}>
          ${b.fights.length > 1 ? `<nav class="try-pills">${pills}</nav>` : ""}
          ${sections}
        </div>`;
    }).join("");
}

function renderTimelinePanel(timeline, linkFor) {
    const fights = (timeline && timeline.fights) || [];
    if (fights.length === 0) return "<div class=\"empty\">Keine Boss-Kämpfe im Log.</div>";
    const bosses = groupByBoss(fights);
    return `<p class="note">Ein Boss, ein Try, ein Bereich: Debuffs, Totems, Cooldowns, Aktivität, Heilung, Buffs und Tode auf einer festen Zeitachse (${PX_PER_SEC} px pro Sekunde, seitlich scrollen). Jede Grafik hat darunter eine Tabellenansicht.</p>
    ${renderBossTabs(bosses)}${renderBossPanels(bosses, linkFor)}${TIMELINE_SCRIPT}`;
}

/** The player page's slice of the timeline: only the fights this raider shows up in. */
function renderPlayerTimeline(timeline, name) {
    const fights = ((timeline && timeline.fights) || []).filter((f) =>
        (f.deaths || []).some((d) => d.name === name)
        || (f.totems || []).some((t) => t.name === name)
        || ((f.cooldowns && f.cooldowns.players) || []).some((p) => p.name === name)
        || (f.activity || []).some((a) => a.name === name)
        || ((f.mechanics && f.mechanics.players) || []).some((p) => p.name === name)
        || ((f.healers && f.healers.healers) || []).some((h) => h.name === name)
        || ((f.healers && f.healers.shields) || []).some((r) => r.source === name)
        || !!(f.healers && f.healers.tank && f.healers.tank.name === name)
        || ((f.buffs && f.buffs.players) || []).some((p) => p.name === name));
    if (fights.length === 0) return "";
    const bosses = groupByBoss(fights);
    return `<h2>Kampfverlauf</h2>${renderBossTabs(bosses, name)}${renderBossPanels(bosses, null, name)}${TIMELINE_SCRIPT}`;
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

function recItem(item, scope, player, reviewer) {
    const state = item.approved === true ? "approved" : item.approved === false ? "rejected" : "open";
    const stateLabel = { approved: "freigegeben", rejected: "nicht senden", open: "offen" }[state];
    const evidence = (item.evidence || []).slice(0, 4).map((e) => `<span class="rec-ev"><span>${esc(e.label)}</span><b>${esc(e.value)}</b></span>`).join("");
    // the raid lead's own words first, then Claude's phrasing, then the rule's text
    const text = item.custom || item.ai || item.text;
    const source = item.custom ? "" : item.ai ? "<span class=\"rec-source\" title=\"Von Claude formuliert; der Regeltext steht im Tooltip der Karte\">KI</span>" : "";
    const controls = reviewer
        ? `<div class="rec-review" data-scope="${esc(scope)}" data-player="${esc(player || "")}" data-key="${esc(item.key)}">
          <button type="button" class="btn btn-sm${state === "approved" ? "" : " btn-ghost"}" data-review="approve">✓ Freigeben</button>
          <button type="button" class="btn btn-sm${state === "rejected" ? "" : " btn-ghost"}" data-review="reject">✗ Nicht senden</button>
          <button type="button" class="btn btn-sm btn-ghost" data-review="reset" title="Entscheidung zurücknehmen">○</button>
          <textarea class="rec-text" rows="2" placeholder="Eigene Formulierung (leer = Vorschlag so lassen)">${esc(item.custom || "")}</textarea>
          <button type="button" class="btn btn-sm btn-ghost" data-review="save">Text speichern</button>
          <span class="rec-status"></span>
        </div>`
        : "";
    return `<li class="rec rec-${esc(item.impact)} rec-state-${state}" data-key="${esc(item.key)}">
      <div class="rec-head">
        <span class="rec-impact">${esc(IMPACT_LABEL[item.impact] || item.impact)}</span>
        <b class="rec-title">${esc(item.title)}</b>
        ${reviewer || state !== "open" ? `<span class="rec-state">${stateLabel}</span>` : ""}
      </div>
      <p class="rec-body"${item.ai && !item.custom ? ` title="${esc(item.text)}"` : ""}>${source}${esc(text)}</p>
      ${evidence ? `<div class="rec-evidence">${evidence}</div>` : ""}
      ${controls}
    </li>`;
}

/**
 * The Empfehlungen tab: the raid's biggest costs on top, then one card per
 * raider. Reviewers get the verdict controls; everyone else the approved items.
 */
function renderRecommendationsPanel(report, user, linkFor) {
    const rec = reviewedRecommendations(report);
    if (!rec) return "<div class=\"empty\">Noch keine Empfehlungen – die Auswertung ist älter als das Regelwerk. Neu auswerten.</div>";
    const reviewer = canReview(user);
    const visible = (items) => (reviewer ? items : items.filter((i) => i.approved === true));
    const raid = visible(rec.raid || []);
    const players = (rec.players || []).map((p) => ({ ...p, items: visible(p.items || []) })).filter((p) => p.items.length || reviewer);
    const open = (rec.raid || []).filter((i) => i.approved === null).length + (rec.players || []).reduce((n, p) => n + p.items.filter((i) => i.approved === null).length, 0);

    const raidHtml = raid.length
        ? `<ul class="rec-list">${raid.map((i) => recItem(i, "raid", "", reviewer)).join("")}</ul>`
        : "<div class=\"fc-empty\">Nichts, was den ganzen Raid gekostet hätte.</div>";
    const cards = players.map((p) => {
        const href = linkFor && linkFor(p.name);
        const name = href ? `<a href="${esc(href)}">${esc(p.name)}</a>` : esc(p.name);
        const body = p.items.length
            ? `<ul class="rec-list">${p.items.map((i) => recItem(i, "player", p.name, reviewer)).join("")}</ul>`
            : "<div class=\"rec-clean\">Nichts auszusetzen – weiter so.</div>";
        // One collapsed card per raider: the head names them and counts, the
        // points unfold on click — twenty-five open cards are unreadable.
        const openCount = p.items.filter((i) => i.approved === null).length;
        const approvedCount = p.items.filter((i) => i.approved === true).length;
        const meta = reviewer
            ? `${p.items.length} ${p.items.length === 1 ? "Punkt" : "Punkte"}${openCount ? ` · ${openCount} offen` : ""}${approvedCount ? ` · ${approvedCount} frei` : ""}`
            : `${p.items.length} ${p.items.length === 1 ? "Punkt" : "Punkte"}`;
        return `<details class="rec-card${openCount ? " rec-card-open" : ""}" style="--cc:${esc(classColorOf(p.type) || "var(--text)")}">
          <summary class="rec-card-head"><img src="${esc(classIconUrl(p.type))}" alt=""><h3 class="cn">${name}</h3><span class="rec-count">${esc(meta)}</span><span class="rec-chev" aria-hidden="true"></span></summary>
          ${body}
        </details>`;
    }).join("");

    return `<p class="note">${reviewer
        ? `Jede Empfehlung wird vor dem Versand freigegeben oder verworfen; der Text lässt sich umformulieren. ${open ? `<b>${open} offen.</b>` : "Alles entschieden."}`
        : "Was die Raidleitung aus der Auswertung für den nächsten Raid mitgibt."}</p>
    ${reviewer ? renderSendBox(report) : ""}
    <h2>Für den Raid</h2>
    ${raidHtml}
    <div class="rec-players-head"><h2>Pro Raider</h2><span class="rec-toggle-all"><button type="button" class="btn btn-sm btn-ghost" data-cards="open">Alle aufklappen</button><button type="button" class="btn btn-sm btn-ghost" data-cards="close">Alle zuklappen</button></span></div>
    <div class="rec-grid">${cards || "<div class=\"fc-empty\">Noch keine freigegebenen Empfehlungen.</div>"}</div>
    ${CARDS_SCRIPT}
    ${reviewer ? REVIEW_SCRIPT : ""}`;
}

// "Alle aufklappen / zuklappen" for the raider cards; a single card is native <details>.
const CARDS_SCRIPT = `<script>(function(){if(window.__ehCards)return;window.__ehCards=1;
document.addEventListener("click",function(e){var b=e.target.closest("[data-cards]");if(!b)return;var open=b.getAttribute("data-cards")==="open";
document.querySelectorAll(".rec-card").forEach(function(d){d.open=open;});});})();</script>`;

/**
 * The send box for reviewers: how many raiders have approved points, who was
 * already written to, and the button that sends the rest as Discord DMs. The
 * per-raider mapping state is loaded from /api/cla/recommendations/send on
 * demand, so the page itself needs no store access.
 */
function renderSendBox(report) {
    const rec = reviewedRecommendations(report);
    const approved = (rec.players || []).filter((p) => p.items.some((i) => i.approved === true));
    const sent = report.recommendationSent || {};
    const sentNames = approved.filter((p) => sent[p.name]);
    return `<div class="rec-send" data-report="${esc(report.id)}">
      <div class="rec-send-head">
        <b>Versand an die Raider</b>
        <span class="rec-send-meta">${approved.length} Raider mit freigegebenen Punkten · ${sentNames.length} bereits angeschrieben</span>
        <button type="button" class="btn btn-sm" data-send="all"${approved.length ? "" : " disabled"}>Freigegebenes per DM senden</button>
        <button type="button" class="btn btn-sm btn-ghost" data-send="status">Zuordnung prüfen</button>
        <button type="button" class="btn btn-sm btn-ghost" data-phrase="all" title="Claude formuliert jeden Befund in Klartext; deine Freigabe bleibt nötig">KI-Formulierung erzeugen</button>
      </div>
      ${report.recommendationPhrase ? `<div class="rec-send-meta rec-phrase-meta">KI-Formulierung vom ${esc(new Date(report.recommendationPhrase.at).toLocaleString("de-DE"))} (${esc(report.recommendationPhrase.model)}): ${esc(report.recommendationPhrase.phrased)} Texte für ${esc(report.recommendationPhrase.players)} Raider${(report.recommendationPhrase.errors || []).length ? `, ${report.recommendationPhrase.errors.length} Fehler` : ""}</div>` : ""}
      <div class="rec-send-result" hidden></div>
    </div>${SEND_SCRIPT}${PHRASE_SCRIPT}`;
}

// The send button posts once and lists who got a DM and who was skipped and why;
// "Zuordnung prüfen" fetches the per-raider mapping state without sending.
// "KI-Formulierung erzeugen": starts the phrasing job and polls until it is done,
// then reloads so the cards show Claude's texts.
const PHRASE_SCRIPT = `<script>(function(){if(window.__ehPhrase)return;window.__ehPhrase=1;
var token=null;function csrf(){return token?Promise.resolve(token):fetch("/api/session",{credentials:"same-origin"}).then(function(r){return r.json()}).then(function(j){token=j.csrfToken||(j.data&&j.data.csrfToken)||"";return token;});}
document.addEventListener("click",function(e){var b=e.target.closest("[data-phrase]");if(!b)return;var box=b.closest(".rec-send"),out=box.querySelector(".rec-send-result"),id=box.getAttribute("data-report");out.hidden=false;out.textContent="KI-Formulierung läuft …";b.disabled=true;
function poll(){return fetch("/api/cla/recommendations/phrase?id="+encodeURIComponent(id),{credentials:"same-origin"}).then(function(r){return r.json()}).then(function(j){var job=j.data&&j.data.job;if(!job||job.status==="running"){return new Promise(function(res){setTimeout(res,2500);}).then(poll);}if(job.status==="error")throw new Error(job.error||"fehlgeschlagen");return j.data;});}
csrf().then(function(t){return fetch("/api/cla/recommendations/phrase",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json","X-CSRF-Token":t},body:JSON.stringify({reportId:id})});}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error((j&&j.error&&j.error.message)||r.status);return j;});}).then(poll)
.then(function(d){var l=d.last||{};out.textContent="Fertig: "+(l.phrased||0)+" Texte für "+(l.players||0)+" Raider"+((l.errors||[]).length?", "+l.errors.length+" Fehler":"")+". Seite wird neu geladen …";setTimeout(function(){location.reload();},1200);})
.catch(function(err){out.textContent="Fehler: "+err.message;b.disabled=false;});});})();</script>`;

const SEND_SCRIPT = `<script>(function(){if(window.__ehSend)return;window.__ehSend=1;
var token=null;function csrf(){return token?Promise.resolve(token):fetch("/api/session",{credentials:"same-origin"}).then(function(r){return r.json()}).then(function(j){token=j.csrfToken||(j.data&&j.data.csrfToken)||"";return token;});}
function row(cls,t){var d=document.createElement("div");d.className="rec-send-row "+cls;d.textContent=t;return d;}
document.addEventListener("click",function(e){var b=e.target.closest("[data-send]");if(!b)return;var box=b.closest(".rec-send"),out=box.querySelector(".rec-send-result"),id=box.getAttribute("data-report");out.hidden=false;out.textContent="…";
var p;if(b.getAttribute("data-send")==="status"){p=fetch("/api/cla/recommendations/send?id="+encodeURIComponent(id),{credentials:"same-origin"}).then(function(r){return r.json()}).then(function(j){out.textContent="";var list=(j.data&&j.data.players)||[];if(!list.length)out.appendChild(row("muted","Nichts freigegeben."));list.forEach(function(x){out.appendChild(row(x.mapped?"ok":"warn",x.name+": "+x.approved+" Punkte · "+(x.mapped?"Konto zugeordnet":x.ambiguous?"mehrere Konten":"kein Konto zugeordnet")+(x.sentAt?" · gesendet "+new Date(x.sentAt).toLocaleString("de-DE")+(x.changed?" (seitdem geändert)":""):"")));});});}
else{if(!confirm("Jetzt allen Raidern ihre freigegebenen Punkte als Discord-DM senden?")){out.hidden=true;return;}b.disabled=true;p=csrf().then(function(t){return fetch("/api/cla/recommendations/send",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json","X-CSRF-Token":t},body:JSON.stringify({reportId:id})});}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error((j&&j.error&&j.error.message)||r.status);return j.data;});}).then(function(d){out.textContent="";out.appendChild(row("ok",d.message));(d.sent||[]).forEach(function(s){out.appendChild(row("ok","✓ "+s.name+" ("+s.items+" Punkte)"));});(d.skipped||[]).forEach(function(s){out.appendChild(row("warn","– "+s.name+": "+s.message));});}).finally(function(){b.disabled=false;});}
p.catch(function(err){out.textContent="Fehler: "+err.message;});});})();</script>`;

/** The player page's own items: all with verdicts for a reviewer, only the approved ones for the raider. */
function renderPlayerRecommendations(report, name, user) {
    const rec = reviewedRecommendations(report);
    if (!rec) return "";
    const p = (rec.players || []).find((x) => x.name === name);
    if (!p) return "";
    const reviewer = canReview(user);
    const items = reviewer ? p.items : p.items.filter((i) => i.approved === true);
    if (!items.length) return "";
    return `<h2>Empfehlungen</h2>
    <ul class="rec-list">${items.map((i) => recItem(i, "player", p.name, reviewer)).join("")}</ul>
    ${reviewer ? REVIEW_SCRIPT : ""}`;
}

// Verdict buttons and the text box post to /api/cla/recommendations. The CSRF
// token is fetched once from /api/session, the page never carries it.
const REVIEW_SCRIPT = `<script>(function(){if(window.__ehReview)return;window.__ehReview=1;
var token=null;function csrf(){return token?Promise.resolve(token):fetch("/api/session",{credentials:"same-origin"}).then(function(r){return r.json()}).then(function(j){token=j.csrfToken||(j.data&&j.data.csrfToken)||"";return token;});}
var reportId=(location.pathname.match(/^\\/r\\/([a-zA-Z0-9]+)/)||[])[1];
document.addEventListener("click",function(e){var b=e.target.closest("[data-review]");if(!b)return;var box=b.closest(".rec-review"),li=b.closest(".rec"),st=box.querySelector(".rec-status");
var body={reportId:reportId,scope:box.getAttribute("data-scope"),player:box.getAttribute("data-player"),key:box.getAttribute("data-key")};
var a=b.getAttribute("data-review");if(a==="approve")body.approved=true;else if(a==="reject")body.approved=false;else if(a==="reset")body.approved=null;else if(a==="save")body.text=box.querySelector(".rec-text").value;
st.textContent="…";csrf().then(function(t){return fetch("/api/cla/recommendations",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json","X-CSRF-Token":t},body:JSON.stringify(body)});}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error((j&&j.error&&j.error.message)||(j&&j.message)||r.status);return j;});})
.then(function(){var s=body.approved===true?"approved":body.approved===false?"rejected":(a==="reset"?"open":null);if(s){li.className=li.className.replace(/rec-state-\\w+/,"rec-state-"+s);var lbl=li.querySelector(".rec-state");if(lbl)lbl.textContent={approved:"freigegeben",rejected:"nicht senden",open:"offen"}[s];box.querySelectorAll("[data-review=approve],[data-review=reject]").forEach(function(x){x.classList.toggle("btn-ghost",!(s==="approved"&&x.getAttribute("data-review")==="approve"||s==="rejected"&&x.getAttribute("data-review")==="reject"));});}
if(a==="save"){var p=li.querySelector(".rec-body");if(p&&body.text)p.textContent=body.text;}st.textContent="gespeichert";setTimeout(function(){st.textContent="";},1500);})
.catch(function(err){st.textContent="Fehler: "+err.message;});});})();</script>`;

// Headline numbers for a report: raiders, gear issues, boss fights, consumable coverage.
function reportTiles(report) {
    const players = report.players || [];
    const roster = report.roster || [];
    const gearIssues = players.reduce((n, p) => n + (p.issues || []).length, 0);
    const tiles = [];
    if (roster.length) tiles.push(tile("Raider", String(roster.length), esc(report.zone || "")));
    tiles.push(tile("Gear-Probleme", String(gearIssues), `bei ${players.length} Spieler(n)`, gearIssues ? "warn" : "good"));
    const rows = (report.bossUptimes && report.bossUptimes.rows) || [];
    if (rows.length) {
        const kills = rows.filter((r) => r.kill).length;
        tiles.push(tile("Boss-Kämpfe", String(rows.length), `${kills} Kill(s) · ${rows.length - kills} Wipe(s)`));
    }
    const cons = (report.consumables && report.consumables.players) || [];
    if (cons.length) {
        const avg = (key) => Math.round(cons.reduce((n, p) => n + (p[key] || 0), 0) / cons.length);
        const buffed = avg("buffed");
        tiles.push(tile("Ø Flask/Elixiere", `${buffed}%`, `Ø Food ${avg("food")}%`, buffed >= 90 ? "good" : buffed < 50 ? "warn" : ""));
    }
    return `<div class="tiles">${tiles.join("")}</div>`;
}

// --- RPB (Role Performance Breakdown) panels ------------------------------

/** Thousands-separated number for the damage tables. */
function num(n) {
    return Math.round(n || 0).toLocaleString("de-DE");
}

/** Group rows by the role the RPB assigned, in the sheet's own role order. */
function groupByRole(rows, roles) {
    const order = ["Tank", "Healer", "Caster", "Physical"];
    const groups = new Map(order.map((r) => [r, []]));
    for (const row of rows) {
        const role = (roles && roles[row.name]) || "Physical";
        if (!groups.has(role)) groups.set(role, []);
        groups.get(role).push(row);
    }
    return [...groups.entries()].filter(([, list]) => list.length);
}

// German label + icon per RPB role, for the role tab bars.
const ROLE_META = {
    Tank: { label: "Tanks", icon: "inv_shield_06" },
    Healer: { label: "Heiler", icon: "spell_holy_flashheal" },
    Caster: { label: "Caster", icon: "spell_fire_flamebolt" },
    Physical: { label: "Nahkampf", icon: "inv_sword_27" },
};

/**
 * Turn the role groups of a panel into tab items. Roles differ enough (a tank's
 * numbers say nothing about a healer's) that stacking them in one table only made
 * them harder to compare — one tab per role keeps each table homogeneous.
 * @param {function(Array, string): string} renderGroup
 */
function roleTabs(prefix, rows, roles, renderGroup) {
    return groupByRole(rows, roles).map(([role, list]) => {
        const meta = ROLE_META[role] || { label: role, icon: "" };
        return {
            id: `${prefix}-${role.toLowerCase()}`,
            label: meta.label,
            icon: meta.icon,
            count: list.length,
            html: renderGroup(list, role),
        };
    });
}

/**
 * Colour a damage number by how it compares to the worst value in the same column
 * raid-wide (not just within the role tab, so a tank tab with two rows does not
 * paint one of them red for a harmless difference).
 */
function dmgCell(v, max) {
    if (!(v > 0)) return "<span class=\"sritems\">·</span>";
    const share = max > 0 ? v / max : 0;
    const step = share > 0.75 ? 4 : share > 0.5 ? 3 : share > 0.25 ? 2 : 1;
    return `<span class="dv dv-${step}">${num(v)}</span>`;
}

/** Column head for one avoidable ability: its icon plus the NPCs that cast it. */
function abilityHead(a) {
    const sub = a.sources && a.sources.length ? ` data-tip-sub="${esc(a.sources.join(", "))}"` : "";
    return `<th class="n" data-tip="${esc(a.label)}"${sub}>${abilityIcon(a)}${esc(a.label)}</th>`;
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

/** Players as rows, abilities as columns (the classic orientation). */
function damageByPlayer(abilities, list, linkFor, scale) {
    const head = abilities.map(abilityHead).join("");
    const body = list.map((p) => {
        const cells = abilities.map((a, i) => `<td class="n">${dmgCell(p.perAbility[i], scale.perAbility[i])}</td>`).join("");
        return `<tr>
          <td class="pcol">${classCell(p, linkFor(p.name))}</td>
          ${cells}
          <td class="n">${dmgCell(p.avoidableTotal, scale.total)}</td>
          <td class="n">${dmgCell(p.reflected, scale.reflected)}</td>
          <td class="n">${dmgCell(p.hostile, scale.hostile)}</td>
          <td class="n"><span class="pct ${p.deaths > 0 ? "pct-none" : "pct-full"}">${esc(p.deaths)}</span></td>
        </tr>`;
    }).join("");
    return `<div class="scrollx"><table class="idx rpb fixed">
      <tr><th class="pcol">Spieler</th>${head}<th class="n">Summe</th><th class="n">Reflektiert</th><th class="n">Auf Spieler</th><th class="n">Tode</th></tr>
      ${body}
    </table></div>`;
}

/** Abilities as rows, one column per raider — the transposed view. */
function damageByAbility(abilities, list, linkFor, scale) {
    const head = list.map((p) => {
        const href = linkFor(p.name);
        const inner = `<span class="rcol-in"><img src="${esc(classIconUrl(p.type))}" alt=""><span>${esc(p.name)}</span></span>`;
        return `<th class="rcol" data-tip="${esc(p.name)}" data-tip-sub="${esc(p.type)}">${href ? `<a href="${esc(href)}" style="text-decoration:none">${inner}</a>` : inner}</th>`;
    }).join("");

    const abilityRows = abilities.map((a, i) => {
        const cells = list.map((p) => `<td class="n">${dmgCell(p.perAbility[i], scale.perAbility[i])}</td>`).join("");
        const sub = a.sources && a.sources.length ? ` data-tip-sub="${esc(a.sources.join(", "))}"` : "";
        return `<tr><td class="pcol" data-tip="${esc(a.label)}"${sub}>${abilityIcon(a)}${esc(a.label)}</td>${cells}</tr>`;
    }).join("");

    const sumRow = (label, pick, max) => {
        const cells = list.map((p) => `<td class="n">${dmgCell(pick(p), max)}</td>`).join("");
        return `<tr><td class="pcol"><strong>${esc(label)}</strong></td>${cells}</tr>`;
    };
    const deathRow = `<tr><td class="pcol"><strong>Tode</strong></td>${
        list.map((p) => `<td class="n"><span class="pct ${p.deaths > 0 ? "pct-none" : "pct-full"}">${esc(p.deaths)}</span></td>`).join("")
    }</tr>`;

    return `<div class="scrollx"><table class="idx rpb fixed">
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
    const items = roleTabs("rpbdmg", damage.players, roles, (list) =>
        `<div class="tview tview-p">${damageByPlayer(abilities, list, linkFor, scale)}</div>
         <div class="tview tview-a">${damageByAbility(abilities, list, linkFor, scale)}</div>`);

    return `<p class="note">${esc(damage.heading || "Vermeidbarer erhaltener Schaden")}. Die Farbe zeigt den Anteil am höchsten Wert derselben Spalte im gesamten Raid — sie ist also über alle Rollen-Tabs hinweg vergleichbar.</p>
    <div class="legend">
      <span class="lg"><span class="dv dv-1" style="min-width:0">bis 25%</span></span>
      <span class="lg"><span class="dv dv-2" style="min-width:0">bis 50%</span></span>
      <span class="lg"><span class="dv dv-3" style="min-width:0">bis 75%</span></span>
      <span class="lg"><span class="dv dv-4" style="min-width:0">darüber</span></span>
    </div>
    <div class="viewroot">
      <div class="tblswitch">
        <button type="button" data-view="p" class="active">Spieler als Zeilen</button>
        <button type="button" data-view="a">Fähigkeiten als Zeilen</button>
      </div>
      ${tabbed(items, "sub")}
    </div>`;
}

function renderRpbActivityPanel(activity, roles, linkFor) {
    if (!activity || !activity.players || activity.players.length === 0) {
        return "<div class=\"empty\">Keine Aktivitätsdaten gefunden.</div>";
    }
    const items = roleTabs("rpbact", activity.players, roles, (list) => {
        const body = list.map((p) => {
            const haste = p.gearSpellHaste
                ? ` data-tip="${esc(p.name)}" data-tip-sub="Zaubertempo aus Ausrüstung: ${esc(p.gearSpellHaste)}"`
                : "";
            return `<tr>
              <td class="pcol"${haste}>${classCell(p, linkFor(p.name))}</td>
              <td class="n"><strong>${esc(p.secondsActive)}s</strong></td>
              <td class="n">${uptimeCell(p.relativeTotal)}</td>
              <td class="n">${esc(p.secondsActiveST)}s</td>
              <td class="n">${esc(p.secondsActiveAoe)}s</td>
              <td class="n" data-tip="Tempo-Abzug" data-tip-sub="Abzug für Tempo-Effekte">${esc(p.hasteSecondsSubtracted)}s</td>
            </tr>`;
        }).join("");
        return `<div class="scrollx"><table class="idx rpb fixed">
          <tr><th class="pcol">Spieler</th><th class="n">Aktiv gesamt</th><th class="n">Anteil Raidzeit</th><th class="n">Einzelziel</th><th class="n">Fläche</th><th class="n">Tempo-Abzug</th></tr>
          ${body}
        </table></div>`;
    });

    return `<p class="note">Rekonstruierte Aktivität: getrackte Zauber × Zauberzeit, abzüglich Tempo-Effekten, geteilt durch die Kampfzeit des Raids (${esc(activity.raidSeconds)}s).
    <strong>Für Nahkämpfer ungenau</strong> — Autoattacks werden vom Combat Log nicht erfasst.</p>${tabbed(items, "sub")}`;
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

function renderRpbSpellsPanel(activity, roles, linkFor) {
    const players = (activity && activity.players) || [];
    const withSpells = players.filter((p) => (p.singleTargetCasts || []).length || (p.aoeCasts || []).length);
    if (withSpells.length === 0) return "<div class=\"empty\">Keine getrackten Zauber gefunden.</div>";

    const items = roleTabs("rpbspells", withSpells, roles, (list) => {
        const body = list.map((p) => {
            const st = p.singleTargetCasts || [];
            const aoe = p.aoeCasts || [];
            const downranked = [...st, ...aoe].filter((r) => r.mostlyLowerRank);
            const rankCell = downranked.length
                ? `<span class="pct pct-none" data-tip="Nicht im höchsten Rang" data-tip-sub="${esc(downranked.map((r) => r.label || r.name).join(", "))}">${downranked.length}</span>`
                : "<span class=\"pct pct-full\">0</span>";
            return `<tr>
              <td class="pcol">${classCell(p, linkFor(p.name))}</td>
              <td>${iconRow(spellTiles(st))}</td>
              <td>${iconRow(spellTiles(aoe))}</td>
              <td class="n">${rankCell}</td>
            </tr>`;
        }).join("");
        return `<div class="scrollx"><table class="idx rpb">
          <tr><th class="pcol">Spieler</th><th>Einzelziel</th><th>Fläche</th><th class="n">Rang-Warnungen</th></tr>
          ${body}
        </table></div>`;
    });

    return `<p class="note">Jedes Icon ist ein getrackter Zauber, die Zahl daran die Anzahl der Casts. Überfahren zeigt Name, Anzahl und ggf. die Uptime; ein Klick öffnet Wowhead.</p>
    <div class="legend">
      <span class="lg"><span class="sw warn"></span>rot umrandet = überwiegend in einem <strong>niedrigeren Rang</strong> gecastet</span>
      <span class="lg">„Rang-Warnungen" = Anzahl solcher Zauber pro Spieler</span>
    </div>
    ${tabbed(items, "sub")}`;
}

function renderRpbInterruptsPanel(interrupts, linkFor) {
    if (!interrupts || !interrupts.players || interrupts.players.length === 0) {
        return "<div class=\"empty\">Keine Unterbrechungen gefunden.</div>";
    }
    const body = interrupts.players.map((p) => {
        const spells = (p.spells || []).map((s) => iconTile({
            icon: s.icon, spellId: s.spellId, label: s.name, count: s.count,
        }));
        const kicks = (p.kicks || []).map((k) => `${esc(k.name)} ×${k.count}`).join(", ");
        return `<tr>
          <td class="pcol">${classCell(p, linkFor(p.name))}</td>
          <td class="n"><strong>${esc(p.count)}</strong></td>
          <td>${iconRow(spells)}</td>
          <td class="sritems">${kicks || "–"}</td>
        </tr>`;
    }).join("");
    return `<p class="note">Welche gegnerischen Zauber wer unterbrochen hat — und womit.</p>
    ${panelBox(`<div class="scrollx"><table class="idx rpb">
      <tr><th class="pcol">Spieler</th><th class="n">Unterbrechungen</th><th>Unterbrochene Zauber</th><th>Eingesetzt mit</th></tr>
      ${body}
    </table></div>`)}`;
}

function renderRpbValidationPanel(v) {
    if (!v) return "<div class=\"empty\">Keine Validierungsdaten.</div>";
    const zones = (v.zones || []).join(", ") || "unbekannt";
    const header = `<p class="note">Zone(n): <strong>${esc(zones)}</strong> · Bosse gelegt: <strong>${esc(v.bossesKilled)}</strong> von ${esc(v.bossesTotal)}</p>`;

    if (!v.requirements || v.requirements.length === 0) {
        return `${header}<div class="empty">${esc(v.note || "Keine Trash-Anforderungen hinterlegt.")}</div>`;
    }
    const body = v.requirements.map((r) => `<tr>
      <td class="pcol">${esc(r.label)}</td>
      <td>${esc(r.zone)}</td>
      <td class="n"><strong>${esc(r.killed)}</strong></td>
      <td class="n">${esc(r.minimum)}</td>
      <td class="n"><span class="pct ${r.ok ? "pct-full" : "pct-none"}">${r.ok ? "ok" : "zu wenig"}</span></td>
    </tr>`).join("");

    const verdict = v.valid
        ? "<p class=\"note\">✅ Der Log erfüllt alle hinterlegten Trash-Anforderungen.</p>"
        : "<p class=\"note\">⚠️ Der Log erfüllt die Trash-Anforderungen <strong>nicht</strong>.</p>";

    return `${header}${verdict}
    ${panelBox(`<div class="scrollx"><table class="idx rpb">
      <tr><th class="pcol">Trash</th><th>Zone</th><th class="n">Gelegt</th><th class="n">Nötig</th><th class="n"></th></tr>
      ${body}
    </table></div>`)}`;
}

function renderRpbUsagePanel(usage, roles, linkFor) {
    if (!usage || usage.length === 0) return "<div class=\"empty\">Keine Nutzungsdaten gefunden.</div>";
    const withData = usage.filter((u) => (u.classCooldowns || []).length || (u.trinketsAndRacials || []).length
        || (u.engineering || []).length || (u.absorbs || []).length);
    if (withData.length === 0) return "<div class=\"empty\">Keine Cooldowns oder Schmuckstücke erfasst.</div>";

    const items = roleTabs("rpbuse", withData, roles, (list) => {
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
            return `<tr>
              <td class="pcol">${classCell(p, linkFor(p.name))}</td>
              <td>${iconRow(cds)}</td>
              <td>${iconRow(trinkets)}</td>
              <td>${iconRow(consumables)}</td>
            </tr>`;
        }).join("");
        return `<div class="scrollx"><table class="idx rpb">
          <tr><th class="pcol">Spieler</th><th>Klassen-Cooldowns</th><th>Schmuckstücke &amp; Rassenfertigkeiten</th><th>Ingenieurskunst &amp; Schilde</th></tr>
          ${body}
        </table></div>`;
    });

    return `<p class="note">Die Zahl am Icon ist die Anzahl der Einsätze; beim Überfahren steht bei Cooldowns dahinter, wie viele in der Bosskampfzeit theoretisch möglich gewesen wären.</p>
    <div class="legend">
      <span class="lg"><span class="sw warn"></span>rot = weniger als die Hälfte der möglichen Einsätze</span>
      <span class="lg">„möglich" = Bosskampfzeit ÷ Abklingzeit — eine grobe Obergrenze, kein Sollwert</span>
    </div>
    ${tabbed(items, "sub")}`;
}

function renderReportPage(report, user) {
    const players = report.players || [];
    const dateStr = report.date ? esc(report.date) : "";
    const sub = [
        report.zone ? `Zone: ${esc(report.zone)}` : "",
        dateStr,
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
    const hasTimeline = report.timeline && report.timeline.fights && report.timeline.fights.length;
    const hasHealers = report.healers && report.healers.players && report.healers.players.length;
    const hasRaidBuffs = report.raidBuffs && report.raidBuffs.players && report.raidBuffs.players.length;
    // the badge counts the expected buffs that fell short somewhere
    const raidBuffsShort = hasRaidBuffs ? (report.raidBuffs.rows || []).filter((r) => r.expected && (r.none > 0 || r.partial > 0)).length : 0;
    // The tab shows for reviewers as soon as there are findings, for everyone else once something was approved.
    const recReviewed = report.recommendations ? applyReview(report.recommendations, report.recommendationReview) : null;
    const recItems = recReviewed ? [...recReviewed.raid, ...recReviewed.players.flatMap((p) => p.items)] : [];
    const recCount = canReview(user) ? recItems.filter((i) => i.approved === null).length : recItems.filter((i) => i.approved === true).length;
    const hasRec = !!recReviewed && (canReview(user) ? recItems.length > 0 : recCount > 0);

    const rpb = report.rpb || null;
    const rpbRoles = rpb && rpb.roles;
    const hasRpbDamage = rpb && rpb.damage && rpb.damage.players && rpb.damage.players.length;
    const hasRpbActivity = rpb && rpb.activity && rpb.activity.players && rpb.activity.players.length;
    const hasRpbInterrupts = rpb && rpb.interrupts && rpb.interrupts.players && rpb.interrupts.players.length;
    const hasRpbUsage = rpb && rpb.usage && rpb.usage.length;
    const hasRpbValidation = rpb && rpb.validation;
    const rpbDeaths = hasRpbDamage ? rpb.damage.players.reduce((n, p) => n + (p.deaths || 0), 0) : 0;
    const rpbUnmet = hasRpbValidation
        ? (rpb.validation.requirements || []).filter((r) => !r.ok).length
        : 0;

    // Spell usage rides on the activity data — it counts every tracked cast anyway.
    const hasRpbSpells = hasRpbActivity
        && rpb.activity.players.some((p) => (p.singleTargetCasts || []).length || (p.aoeCasts || []).length);
    const rpbDownranks = hasRpbSpells
        ? rpb.activity.players.reduce((n, p) =>
            n + [...(p.singleTargetCasts || []), ...(p.aoeCasts || [])].filter((r) => r.mostlyLowerRank).length, 0)
        : 0;

    const tabDefs = [
        { id: "roster", icon: "inv_misc_grouplooking", label: "Raider", show: hasRoster, count: (report.roster || []).length, html: renderRosterPanel(report, linkFor) },
        { id: "gear", icon: "inv_shield_06", label: "Gear Issues", show: true, count: players.reduce((n, p) => n + (p.issues || []).length, 0), html: renderGearPanel(players, linkFor) },
        { id: "consumables", icon: "inv_alchemy_endlessflask_05", label: "Consumables", show: hasConsum, count: hasConsum, html: renderConsumablesPanel(report.consumables, linkFor) },
        { id: "potions", icon: "inv_potion_137", label: "Tränke", show: hasPotions, count: hasPotions, html: renderPotionsPanel(report.potions, linkFor) },
        { id: "drums", icon: "inv_misc_drum_01", label: "Drums", show: hasDrums, count: hasDrums, html: renderDrumsPanel(report.drums, linkFor) },
        { id: "sunder", icon: "ability_warrior_sunder", label: "Sunder Armor", show: hasSunder, count: hasSunder, html: renderSunderPanel(report.sunder, linkFor) },
        { id: "bosses", icon: "achievement_boss_illidan", label: "Bosse", show: hasBoss, count: hasBoss, html: renderBossUptimesPanel(report.bossUptimes) },
        { id: "timeline", icon: "inv_misc_pocketwatch_01", label: "Kampfverlauf", show: hasTimeline, count: hasTimeline, html: hasTimeline ? renderTimelinePanel(report.timeline, linkFor) : "" },
        { id: "healers", icon: "spell_holy_flashheal", label: "Heiler", show: hasHealers, count: hasHealers, html: hasHealers ? renderHealersPanel(report.healers, linkFor) : "" },
        { id: "raidbuffs", icon: "spell_magic_greaterblessingofkings", label: "Raid-Buffs", show: hasRaidBuffs, count: raidBuffsShort, html: hasRaidBuffs ? renderRaidBuffsPanel(report.raidBuffs, linkFor) : "" },
        { id: "recommendations", icon: "inv_misc_note_01", label: "Empfehlungen", show: hasRec, count: recCount, html: hasRec ? renderRecommendationsPanel(report, user, linkFor) : "" },
        { id: "shadowresi", icon: "spell_shadow_antishadow", label: "Shadow-Resi", show: hasShadow, count: hasShadow, html: renderShadowResiPanel(report.shadowResi, linkFor) },
        // RPB sections. The damage tab counts deaths, the spell tab counts downrank
        // warnings and the log check counts unmet requirements, so every badge shows
        // the number that actually needs attention.
        { id: "rpbdamage", icon: "ability_creature_cursed_05", label: "Schaden & Tode", show: hasRpbDamage, count: rpbDeaths, html: hasRpbDamage ? renderRpbDamagePanel(rpb.damage, rpbRoles, linkFor) : "" },
        { id: "rpbactivity", icon: "inv_misc_pocketwatch_02", label: "Aktivität", show: hasRpbActivity, count: hasRpbActivity, html: hasRpbActivity ? renderRpbActivityPanel(rpb.activity, rpbRoles, linkFor) : "" },
        { id: "rpbspells", icon: "inv_misc_book_11", label: "Zauber", show: hasRpbSpells, count: rpbDownranks, html: hasRpbSpells ? renderRpbSpellsPanel(rpb.activity, rpbRoles, linkFor) : "" },
        { id: "rpbusage", icon: "ability_rogue_preparation", label: "Cooldowns", show: hasRpbUsage, count: hasRpbUsage, html: hasRpbUsage ? renderRpbUsagePanel(rpb.usage, rpbRoles, linkFor) : "" },
        { id: "rpbinterrupts", icon: "spell_frost_iceshock", label: "Interrupts", show: hasRpbInterrupts, count: hasRpbInterrupts, html: hasRpbInterrupts ? renderRpbInterruptsPanel(rpb.interrupts, linkFor) : "" },
        { id: "rpbvalidate", icon: "inv_misc_note_02", label: "Log-Prüfung", show: hasRpbValidation, count: rpbUnmet, html: hasRpbValidation ? renderRpbValidationPanel(rpb.validation) : "" },
    ].filter((t) => t.show);

    const buttons = tabDefs.map((t, i) =>
        `<button class="tab-btn${i === 0 ? " active" : ""}" data-tab="${t.id}">${hicon(t.icon, "")}<span>${esc(t.label)}</span><span class="tab-count">${esc(t.count || 0)}</span></button>`).join("");
    const panels = tabDefs.map((t, i) =>
        `<div id="tab-${t.id}" class="tabpanel${i === 0 ? " active" : ""}">${t.html}</div>`).join("");

    const isAdmin = !!(user && user.isAdmin);
    const actions = [
        report.reportUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(report.reportUrl)}" target="_blank" rel="noopener">→ Warcraft Logs</a>` : "",
        isAdmin ? "<a class=\"btn btn-ghost btn-sm\" href=\"/cla\">Alle Auswertungen</a>" : "",
    ].filter(Boolean).join("");

    const body = `
      <div class="page-head">
        <div class="page-head-main">
          <h1 class="page-title">${esc(report.title || "Log-Check")}</h1>
          ${sub ? `<p class="sub" style="margin:0">${sub}</p>` : ""}
        </div>
        ${actions ? `<div class="page-actions">${actions}</div>` : ""}
      </div>
      ${reportTiles(report)}
      <nav class="tabs">${buttons}</nav>
      ${panels}`;

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

    const potChip = (icon, label, n) => `<span class="chip">${hicon(icon, "")}<b>${esc(n || 0)}</b> ${esc(label)}</span>`;
    // which mana sources this raider actually used — the aggregate alone hides that
    const byType = pot.byType || {};
    const manaTiles = ((report.potions && report.potions.types) || [])
        .filter((t) => t.group === "mana" && byType[t.key])
        .map((t) => iconTile({ ...t, count: byType[t.key] }));

    const issues = issueCount
        ? panelBox(`<ul class="issues" style="padding:8px 16px">${p.issues.map(issueRow).join("")}</ul>`)
        : "<div class=\"empty\">Keine Gear-Probleme 🎉</div>";

    const body = `
      <div class="page-head">
        <div class="page-head-main">
          <p class="sub" style="margin:0">${esc(report.title || "")}</p>
        </div>
        <div class="page-actions"><a class="btn btn-ghost btn-sm" href="/r/${esc(report.id)}">← zurück zum Report</a></div>
      </div>
      <div class="hero" style="--cc:${color}">
        <div class="hero-bg"></div>
        <img class="hero-class" src="${esc(classIconUrl(p.type))}" alt="${esc(p.type)}">
        <div class="hero-main">
          <div class="hero-name" style="color:${color}">${esc(p.name)}</div>
          <div class="hero-sub">Stufe 70 · ${esc(p.type)}</div>
          <div class="chips">
            <span class="chip ${issueCount ? "chip-warn" : "chip-ok"}"><b>${issueCount}</b> Gear-Probleme</span>
            ${potChip(ic.destruction, "Zerstörung", pot.destruction)}
            ${potChip(ic.haste, "Hast", pot.haste)}
            ${potChip(ic.mana, "Mana", pot.mana)}
          </div>
          ${manaTiles.length ? `<div class="iconrow" style="margin-top:10px">${manaTiles.join("")}</div>` : ""}
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
      ${renderPlayerRecommendations(report, p.name, user)}
      <h2>Gear-Probleme</h2>
      ${issues}
      ${renderPlayerTimeline(report.timeline, p.name)}`;

    return shellPage(`${p.name} — ${report.title || ""}`, {
        user,
        body,
        crumbs: [
            { label: report.title || "Log-Check", href: `/r/${report.id}` },
            { label: p.name },
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
