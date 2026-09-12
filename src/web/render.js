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
const { TANK_AURAS } = require("../config/healerSpells");
const { ROLE_LABELS: BUFF_ROLE_LABELS } = require("../config/raidBuffs");
const { applyReview } = require("../utils/logcheck/recommendations");
const { dipShare } = require("../utils/logcheck/fightSeries");

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
  .view-bar .note { margin:0; }
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
  .tile { width:34px; height:34px; border-radius:9px; display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto; background:var(--accent-soft); }
  .tile .hicon { width:22px; height:22px; margin:0; }
  .tile.bad { background:var(--high-bg); } .tile.mid { background:var(--medium-bg); } .tile.ok { background:var(--good-bg); } .tile.none { background:var(--panel2); }
  .tile.cls { background:color-mix(in srgb, var(--cc) 18%, transparent); }
  .tile.cls .hicon { border-radius:6px; }
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
  .rsec { background:var(--panel); border:1px solid var(--line); border-radius:12px; }
  .rsec > summary { display:flex; align-items:center; gap:10px; padding:12px 16px; cursor:pointer; list-style:none; font-size:16px; font-weight:700; }
  .rsec > summary::-webkit-details-marker { display:none; }
  .rsec > summary .hicon { width:22px; height:22px; margin:0; }
  .rsec > summary .rec-count { margin-left:8px; }
  .rsec > summary .rec-count.hot { background:var(--high-bg); color:var(--high); }
  .rsec[open] > summary { border-bottom:1px solid var(--line-soft); }
  .rsec-body { padding:14px 16px 16px; }
  .rsec-body > .note:first-child { margin-top:0; }
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
  /* touch: a tap toggles the box (there is no hover), a tap elsewhere closes it */
  document.addEventListener("pointerdown",function(e){
    if(e.pointerType!=="touch") return;
    var t=e.target.closest("[data-tip]"); if(!t){ hide(); return; }
    if(cur===t) hide(); else show(t);
  });
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
            crumbs: [{ label: "Menü", href: "/" }, { label: "Log-Auswertung", href: "/cla" }, ...crumbs],
            body,
            actions: themeToggleBtn(),
            esc,
        });
        return layout(title, chrome, { bare: true, extraStyle: CHROME_STYLE });
    }
    return layout(title, `${publicBar(user)}${body}`);
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

function potionCells(ic, pot) {
    const cell = (icon, n) => `<span class="potcell">${hicon(icon, "")}${esc(n || 0)}</span>`;
    return cell(ic.destruction, pot.destruction) + cell(ic.haste, pot.haste) + cell(ic.mana, pot.mana);
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
        part("totems", { count: rows.length, tone: worst(rows), sub: twisting ? "Twisting" : "", table: only ? topicTable(rows, f.duration, "markers") : groupedTable(groups, f.duration, "markers"), chart: markerChart({ ...common, rows }) });
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
        const openChart = dialogId ? `<div style="display:flex;justify-content:flex-end"><button type="button" class="btn btn-ghost btn-sm" data-dialog="dlg-${esc(dialogId)}">${hicon("inv_misc_pocketwatch_01", "")}Manaverlauf öffnen ⤢</button></div>` : "";
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
        ? `<p class="note">${esc(raid.dispelsMissed)} dispelbare Debuffs hat niemand entfernt${(raid.missedByAbility || []).length ? `: ${raid.missedByAbility.slice(0, 4).map((m) => `${m.icon ? hicon(m.icon, "") : ""}${esc(m.ability)} (${esc(m.count)}×)`).join(", ")}` : ""}.</p>`
        : "";
    const tanks = (raid.tanks || []).length ? `<p class="note">Schild- und HoT-Uptimes gemessen auf dem aktiven Tank (${raid.tanks.map(esc).join(", ")}). Manaverlauf und Zauber pro Kampf stehen im Kampfverlauf unter „Heilung“.</p>` : "";
    return `${tanks}${missed}<table class="idx heal-table"><tr><th></th><th>Heiler</th><th data-tip="Heilung und Overheal über alle Boss-Kämpfe in einem Balken, der stärkste Heiler zuerst" data-tip-sub="${esc(HEAL_BAR_HOW)} Die Zahl rechts ist der Overheal-Anteil: ab 35 % gelb, ab 50 % rot.">Heilung · Overheal</th><th data-tip="Der Zauber mit dem höchsten Overheal-Anteil">Größter Overheal</th><th data-tip="Niedrigster Manastand je Kampf, im Mittel" data-tip-sub="Dahinter: in wie vielen Kämpfen es unter 10 % fiel.">Ø Mana-Tiefstand</th><th data-tip="Manatränke über alle Kämpfe" data-tip-sub="Spät: erst unter 15 % Mana getrunken. Keiner: kein Trank in einem Kampf, der ihn hergegeben hätte.">Manatränke</th><th data-tip="Entfernte Debuffs und die mittlere Reaktionszeit">Dispels</th><th data-tip="Uptime der Schilde und HoTs auf dem aktiven Tank">Auf dem Tank</th></tr>${rows}</table>`;
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

/** "Aus dem Verlauf abgeleitet: Seelenstärke / Gebet…, Wildnis / Gabe…" — the note above a buff panel whose keys came from the events. */
function inferredNote(list, unknownCells) {
    if (!list || !list.length) return "";
    const names = list.map((u) => `${hicon(u.icon, "")}${esc(u.label)}${u.groupLabel ? ` / ${esc(u.groupLabel)}` : ""}`).join(", ");
    const open = unknownCells ? ` ${esc(unknownCells)} ${unknownCells === 1 ? "Zelle bleibt" : "Zellen bleiben"} ohne Nachweis.` : "";
    return `<p class="note"><b>Aus dem Verlauf abgeleitet:</b> ${names}. ${esc(INFERRED_HOW)}${open}</p>`;
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
        ? `<p class="note"><b>Im Log nicht nachweisbar:</b> ${(raidBuffs.untracked || []).map((u) => `${hicon(u.icon, "")}${esc(u.label)}${u.groupLabel ? ` / ${esc(u.groupLabel)}` : ""}`).join(", ")}. Der Client loggt diese Buffs beim Pull nicht (nur beim Nachbuffen), deshalb werden sie nicht bewertet.</p>`
        : "";
    const inferred = inferredNote(raidBuffs.inferred, raidBuffs.unknownCells);
    if (!players.length || !cols.length) return `${blind}${inferred}<div class="empty">Keine Raid-Buffs im Log.</div>`;
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
    const note = `<p class="note">Anteil der Bosskämpfe, in denen der Buff die ganze Zeit auf dem Spieler lag (bis zu seinem Tod). Erwartet wird, was die Aufstellung hergibt: ${pal} Paladin${pal === 1 ? "" : "e"} heißt ${pal === 1 ? "ein Segen" : `${pal} Segen`} pro Spieler, Macht auf Tanks und Nahkämpfer, Weisheit auf Heiler und Caster. Gruppenversionen (Große Segen, Gebete, Gabe der Wildnis, Arkane Brillanz) zählen wie die Einzelbuffs. Grau: nicht erwartet; gestrichelt: Segen auf der falschen Rolle. Wer wann was nicht hatte, steht im Kampfverlauf unter „Buffs“.</p>`;
    return `${blind}${inferred}${note}<div style="overflow-x:auto"><table class="idx heal-table buff-matrix"><tr><th>Spieler</th>${head}</tr><tr class="cov"><td><b>Abdeckung</b><div class="sritems">Raid</div></td>${cover}</tr>${body}</table></div>`;
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
    return `<h4 class="heal-h">Debuff × Boss</h4>
    <p class="note">Mittlere Uptime über alle Tries eines Bosses (Kills und Wipes zusammen); die einzelnen Tries stehen im Tooltip. „–“: dort nicht erwartet, weil kein Anbieter dabei war oder ein anderer Debuff derselben Gruppe lag. Bei stackenden Debuffs darunter, ab wann im Mittel die vollen Stacks lagen. Die Kurven je Kampf stehen im Kampfverlauf unter „Debuffs“.</p>
    <div style="overflow-x:auto"><table class="idx heal-table buff-matrix debuff-matrix"><tr><th>Debuff</th>${head}</tr>${body}</table></div>`;
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
    return `<p class="note">Debuffs auf dem Boss, gemittelt über alle Boss-Kämpfe. Erwartet wird, was die Aufstellung hergibt: ein Hexenmeister heißt Fluch der Elemente, ein Krieger Rüstung zerreißen; was nur eine Skillung liefert (Elend, Winterkälte), zählt erst, sobald es einmal im Log lag.</p>
    ${panelBox(`<table class="idx">
      <tr><th>Debuff</th><th>Erwartet</th><th>Ø Uptime</th><th>Gefehlt</th><th>Stacks</th></tr>
      ${body}
    </table>`)}
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

/** The hero chip of the player page: their dip share over the raid (report.fightSeries), or nothing. */
function dipChip(report, name) {
    const s = report.fightSeries && (report.fightSeries.players || []).find((x) => x && x.name === name);
    if (!s || !Number.isFinite(s.dipPct) || s.dipPct === null) return "";
    const label = s.measure === "hps" ? "HPS" : "DPS";
    const cls = s.dipPct >= 40 ? "chip-warn" : s.dipPct >= 25 ? "" : "chip-ok";
    return `<span class="chip ${cls}" data-tip="Anteil der Kampfzeit, in der ${label} unter der Hälfte des eigenen Schnitts lag" data-tip-sub="Bis zum eigenen Tod, über ${s.fights} ${s.fights === 1 ? "Kampf" : "Kämpfe"}. Ab 25 % gelb, ab 40 % rot."><b>${esc(s.dipPct)} %</b> ${label}-Einbrüche</span>`;
}

/** Section buttons + panels for the parts of one fight, in `mode` "card" (table, chart behind a dialog button) or "inline" (table and chart stacked). */
function partPanels(f, parts, mode, ctx) {
    const seg = parts.map((p, i) =>
        `<button type="button" class="sec${i === 0 ? " active" : ""}" data-show="${p.id}">${hicon(p.icon, "")}${esc(p.label)}${p.count === "" ? "" : `<span class="n${p.tone === "bad" ? " bad" : p.tone === "mid" ? " mid" : ""}">${esc(p.count)}${p.sub ? ` · ${esc(p.sub)}` : ""}</span>`}</button>`).join("");
    const panels = parts.map((p, i) => {
        let chart = "";
        if (p.chart && mode === "inline") chart = `<div class="part-chart">${p.chart}</div>`;
        else if (p.chart) chart = chartDialog(p, f, ctx);
        const open = p.chart && mode !== "inline" ? `<button type="button" class="btn btn-ghost btn-sm" data-dialog="dlg-${p.id}">${hicon("inv_misc_pocketwatch_01", "")}Verlauf öffnen ⤢</button>` : "";
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
      <div class="dlg-head">${icon}<div class="dlg-main"><div class="dlg-title">${hicon(p.icon, "")}${esc(f.boss)} · ${esc(p.label)}</div><div class="vcard-meta">${esc(fightOutcome(f))} · ${fmtTime(f.duration)} · ${PX_PER_SEC} px pro Sekunde, seitlich scrollen</div></div><button type="button" class="dlg-x" data-close aria-label="Schließen">×</button></div>
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
document.addEventListener("click",function(e){var o=e.target.closest("[data-dialog]");if(o){var d=document.getElementById(o.getAttribute("data-dialog"));if(d&&d.showModal){d.showModal();}return;}
var c=e.target.closest("[data-close]");if(c){var dl=c.closest("dialog");if(dl)dl.close();return;}
var dg=e.target.closest("dialog.dlg");if(dg&&e.target===dg){dg.close();}});})();</script>`;

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

function recItem(item, scope, player, reviewer) {
    const state = item.approved === true ? "approved" : item.approved === false ? "rejected" : "open";
    const stateLabel = { approved: "freigegeben", rejected: "nicht senden", open: "offen" }[state];
    const evidence = (item.evidence || []).slice(0, 4).map((e) => `<span class="rec-ev"><span>${esc(e.label)}</span><b>${esc(e.value)}</b></span>`).join("");
    // the raid lead's own words first, then Claude's phrasing, then the rule's text
    const text = item.custom || item.ai || item.text;
    const source = item.custom ? "" : item.ai ? "<span class=\"rec-source\" data-tip=\"Von Claude formuliert\" data-tip-sub=\"Der Regeltext dahinter steht im Tooltip des Textes.\">KI</span>" : "";
    const controls = reviewer
        ? `<div class="rec-review" data-scope="${esc(scope)}" data-player="${esc(player || "")}" data-key="${esc(item.key)}">
          <button type="button" class="btn btn-sm${state === "approved" ? "" : " btn-ghost"}" data-review="approve">✓ Freigeben</button>
          <button type="button" class="btn btn-sm${state === "rejected" ? "" : " btn-ghost"}" data-review="reject">✗ Nicht senden</button>
          <button type="button" class="btn btn-sm btn-ghost" data-review="reset" data-tip="Entscheidung zurücknehmen">○</button>
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
      <p class="rec-body"${item.ai && !item.custom ? ` data-tip="Regeltext" data-tip-sub="${esc(item.text)}"` : ""}>${source}${esc(text)}</p>
      ${evidence ? `<div class="rec-evidence">${evidence}</div>` : ""}
      ${controls}
    </li>`;
}

/** The raid's biggest costs (Sicht Raid): every finding with verdict controls for a reviewer, the approved ones for everyone else. */
function renderRaidRecommendations(rec, reviewer) {
    const raid = reviewer ? (rec.raid || []) : (rec.raid || []).filter((i) => i.approved === true);
    if (!raid.length) return "<div class=\"fc-empty\">Nichts, was den ganzen Raid gekostet hätte.</div>";
    return `<ul class="rec-list">${raid.map((i) => recItem(i, "raid", "", reviewer)).join("")}</ul>`;
}

// "Alle aufklappen / zuklappen" for the raider cards; a single card is native <details>.
const CARDS_SCRIPT = `<script>(function(){if(window.__ehCards)return;window.__ehCards=1;
document.addEventListener("click",function(e){var b=e.target.closest("[data-cards]");if(!b)return;var open=b.getAttribute("data-cards")==="open";
document.querySelectorAll(".raider-card").forEach(function(d){if(!d.hidden)d.open=open;});});})();</script>`;

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
        <button type="button" class="btn btn-sm btn-ghost" data-phrase="all" data-tip="Claude formuliert jeden Befund in Klartext" data-tip-sub="Deine Freigabe bleibt nötig; der Regeltext bleibt erhalten.">KI-Formulierung erzeugen</button>
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
else{if(!confirm("Jetzt allen Raidern ihre freigegebenen Punkte als Discord-DM senden?")){out.hidden=true;return;}b.disabled=true;p=csrf().then(function(t){return fetch("/api/cla/recommendations/send",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json","X-CSRF-Token":t},body:JSON.stringify({reportId:id})});}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error((j&&j.error&&j.error.message)||r.status);return j.data;});}).then(function(d){out.textContent="";out.appendChild(row("ok",d.message));(d.sent||[]).forEach(function(s){out.appendChild(row("ok","✓ "+s.name+" ("+s.items+" Punkte)"));});(d.skipped||[]).forEach(function(s){out.appendChild(row("warn","– "+s.name+": "+s.message));});}).finally(function(){b.disabled=false;});}
p.catch(function(err){out.textContent="Fehler: "+err.message;});});})();</script>`;

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

/** One foldable section of Sicht Raid. */
function raidSection(id, icon, label, count, html, opts = {}) {
    const counter = count === undefined || count === null ? "" : `<span class="rec-count${opts.hot ? " hot" : ""}">${esc(count)}</span>`;
    return `<details class="rsec" id="rs-${esc(id)}"${opts.open ? " open" : ""}>
      <summary>${tile(icon, opts.hot ? "bad" : count ? "" : "none")}<span>${esc(label)}</span>${counter}${expBtn()}</summary>
      <div class="rsec-body">${html}</div>
    </details>`;
}

/** Raid-wide cooldown summary (report.cooldowns.players): uses against the possible, how fast the first press came, stacked with Bloodlust. */
function renderCooldownSummary(cooldowns, linkFor) {
    const rows = (cooldowns.players || []).slice().sort((a, b) => (a.usedPct === null ? 101 : a.usedPct) - (b.usedPct === null ? 101 : b.usedPct));
    const body = rows.map((p) => `<tr><td>${classCell(p, linkFor(p.name))}</td><td class="mono">${esc(p.fights)}</td><td class="mono">${esc(p.uses)} / ${esc(p.possible)}</td><td>${p.usedPct === null ? naCell("", "–") : barPct(p.usedPct, "Genutzte Cooldowns gegen die in der Kampfzeit möglichen", "Ab 95 % grün, ab 70 % gelb, darunter rot.")}</td><td class="mono">${p.avgFirstAtMs === null || p.avgFirstAtMs === undefined ? "–" : fmtTime(p.avgFirstAtMs)}</td><td class="mono">${esc(p.stacked)} / ${esc(p.stacked + p.unstacked)}</td></tr>`).join("");
    return `<p class="note">Klassen-Cooldowns und Schmuckstücke über alle Boss-Kämpfe: Einsätze gegen die in der Kampfzeit möglichen, wann der erste Einsatz im Mittel kam, und wie viele in ein Bloodlust-Fenster fielen. Die Zeitpunkte je Kampf stehen in der Sicht Bosse unter „Cooldowns“.</p>
    ${panelBox(`<table class="idx"><tr><th>Spieler</th><th>Kämpfe</th><th>Einsätze / möglich</th><th>Genutzt</th><th>Ø erster Einsatz</th><th>Mit Bloodlust</th></tr>${body}</table>`)}`;
}

/** Raid-wide activity summary (report.activity.players): mean active share, holes and what explains them. */
function renderActivitySummary(activity, linkFor) {
    const rows = (activity.players || []).slice().sort((a, b) => a.activeAvg - b.activeAvg);
    const body = rows.map((p) => `<tr><td>${classCell(p, linkFor(p.name))}</td><td class="mono">${esc(p.fights)}</td><td>${barPct(p.activeAvg, "Anteil der Kampfzeit mit laufenden Zaubern oder Angriffen", "Im Mittel über die Kämpfe, bis zum eigenen Tod. Ab 95 % grün, ab 70 % gelb.")}</td><td class="mono">${esc(p.gaps)}</td><td class="mono">${fmtTime(p.longestGap)}</td><td class="mono">${fmtTime(p.unexplainedMs)}</td><td class="mono">${fmtTime(p.mechanicMs)}</td></tr>`).join("");
    return `<p class="note">Anteil der Kampfzeit (bis zum eigenen Tod), in der der Spieler mit Zaubern oder Angriffen beschäftigt war; Lücken über der GCD-Toleranz zählen, „durch Mechanik“ ist der Teil davon, der auf eine Bewegungsphase fällt. Die Bänder je Kampf stehen in der Sicht Bosse unter „Aktivität“.</p>
    ${panelBox(`<table class="idx"><tr><th>Spieler</th><th>Kämpfe</th><th>Ø aktiv</th><th>Lücken</th><th>Längste Lücke</th><th>Unerklärt</th><th>Durch Mechanik</th></tr>${body}</table>`)}`;
}

/** Raid-wide totem summary (report.totems.players): Windfury uptime, twisting, downtime per slot. */
function renderTotemSummary(totems, linkFor) {
    const body = (totems.players || []).map((p) => {
        const slots = Object.entries(p.slotDowntimeMs || {}).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${fmtTime(v)}`).join(", ");
        return `<tr><td>${classCell(p, linkFor(p.name))}<div class="sritems">${esc(p.role || "")}</div></td><td class="mono">${esc(p.fights)}</td><td>${p.wfUptimeAvg === null || p.wfUptimeAvg === undefined ? naCell("", "–") : toneCell(p.wfUptimeAvg)}</td><td class="mono">${esc(p.twistingFights)} / ${esc(p.wfFights)}</td><td class="mono">${esc(p.gapCount)}</td><td class="mono">${fmtTime(p.downtimeMs)}</td><td class="sritems">${esc(slots) || "–"}</td></tr>`;
    }).join("");
    return `<p class="note">Je Schamane: wie lange Windfury auf der Gruppe lag, in wie vielen Kämpfen getwistet wurde, und wie viel Zeit ein Totemplatz leer blieb. Die Drops je Kampf stehen in der Sicht Bosse unter „Totems“.</p>
    ${panelBox(`<table class="idx"><tr><th>Schamane</th><th>Kämpfe</th><th>Windfury Ø</th><th>Twisting</th><th>Lücken</th><th>Downtime</th><th>Leere Plätze</th></tr>${body}</table>`)}`;
}

/** Raid-wide mechanics summary (report.mechanics): the mechanics that hit most, the raiders they hit, the judged deaths. */
function renderMechanicsSummary(mech, linkFor) {
    const d = mech.deaths || {};
    const deaths = `<div class="heal-chips"><span class="chip"><b>${esc(d.total || 0)}</b> Tode</span><span class="chip chip-${d.avoidable ? "high" : "good"}"><b>${esc(d.avoidable || 0)}</b> vermeidbar</span><span class="chip chip-${d.early ? "medium" : "good"}"><b>${esc(d.early || 0)}</b> früh</span><span class="chip"><b>${esc(d.repeat || 0)}</b> nach Kampfrez</span><span class="chip"><b>${esc(d.nearEnd || 0)}</b> kurz vor dem Kill</span></div>`;
    const mechs = (mech.mechanics || []).map((m) => `<tr><td>${hicon(m.icon, "")}${esc(m.label)}<div class="sritems">${m.kind === "debuff" ? "Debuff" : "Schaden"}</div></td><td class="mono">${esc(m.hits)}</td><td class="mono">${m.amount ? fmtK(m.amount) : "–"}</td><td class="mono">${esc(m.fights)}</td></tr>`).join("");
    const players = (mech.players || []).map((p) => `<tr><td>${classCell(p, linkFor(p.name))}</td><td class="mono">${esc(p.hits)}</td><td class="mono">${p.amount ? fmtK(p.amount) : "–"}</td><td class="mono">${esc(p.deaths || 0)}${p.avoidableDeaths ? ` <span class="tag tag-high">${esc(p.avoidableDeaths)} vermeidbar</span>` : ""}${p.earlyDeaths ? ` <span class="tag tag-medium">${esc(p.earlyDeaths)} früh</span>` : ""}</td><td class="sritems">${p.topMechanic ? `${hicon(p.topMechanic.icon, "")}${esc(p.topMechanic.label)} (${esc(p.topMechanic.hits)}×)` : "–"}</td></tr>`).join("");
    return `<p class="note">Vermeidbare Treffer über alle Boss-Kämpfe und wie die Tode zu werten sind. Die Treffer je Kampf stehen in der Sicht Bosse unter „Mechaniken“.</p>${deaths}
    ${mechs ? panelBox(`<table class="idx"><tr><th>Mechanik</th><th>Treffer</th><th>Schaden</th><th>Kämpfe</th></tr>${mechs}</table>`) : ""}
    ${players ? `<h4 class="heal-h" style="margin-top:14px">Pro Raider</h4>${panelBox(`<table class="idx"><tr><th>Spieler</th><th>Treffer</th><th>Schaden</th><th>Tode</th><th>Am häufigsten</th></tr>${players}</table>`)}` : ""}`;
}

/** The sections of Sicht Raid, in reading order; only those with data. */
function raidSections(ctx) {
    const { report, reviewer, rec, linkFor } = ctx;
    const out = [];
    const has = (o, key) => !!(o && Array.isArray(o[key]) && o[key].length);
    if (rec) {
        const raid = rec.raid || [];
        const shown = reviewer ? raid : raid.filter((i) => i.approved === true);
        if (shown.length || reviewer) {
            const n = reviewer ? raid.filter((i) => i.approved === null).length : shown.length;
            const note = reviewer
                ? `<p class="note">Jede Empfehlung wird vor dem Versand freigegeben oder verworfen; der Text lässt sich umformulieren. ${n ? `<b>${n} offen.</b>` : "Alles entschieden."}</p>`
                : "<p class=\"note\">Was die Raidleitung aus der Auswertung für den nächsten Raid mitgibt.</p>";
            out.push(raidSection("rec-raid", "inv_misc_note_01", "Empfehlungen an den Raid", n, note + renderRaidRecommendations(rec, reviewer), { open: true, hot: reviewer && n > 0 }));
        }
        if (reviewer) {
            const approved = (rec.players || []).filter((p) => p.items.some((i) => i.approved === true)).length;
            out.push(raidSection("send", "inv_misc_note_02", "Alle senden", approved, renderSendBox(report)));
        }
    }
    if (has(report.raidDebuffs, "rows")) {
        const short = report.raidDebuffs.rows.filter((r) => r.expected && (r.missing > 0 || r.avgUptime < 95)).length;
        out.push(raidSection("raiddebuffs", "spell_shadow_chilltouch", "Raid-Debuffs", short, renderRaidDebuffsPanel(report.raidDebuffs, report.timeline), { hot: short > 0 }));
    }
    if (has(report.raidBuffs, "players")) {
        const short = (report.raidBuffs.rows || []).filter((r) => r.expected && (r.none > 0 || r.partial > 0 || (r.late || 0) > 0)).length;
        out.push(raidSection("raidbuffs", "spell_magic_greaterblessingofkings", "Raid-Buffs", short, renderRaidBuffsPanel(report.raidBuffs, linkFor), { hot: short > 0 }));
    }
    if (has(report.healers, "players")) out.push(raidSection("healers", "spell_holy_flashheal", "Heiler", report.healers.players.length, renderHealersPanel(report.healers, linkFor)));
    if (has(report.cooldowns, "players")) out.push(raidSection("cooldowns", "ability_rogue_preparation", "Cooldowns", report.cooldowns.players.length, renderCooldownSummary(report.cooldowns, linkFor)));
    if (has(report.activity, "players")) out.push(raidSection("activity", "inv_misc_pocketwatch_02", "Aktivität", report.activity.players.length, renderActivitySummary(report.activity, linkFor)));
    if (has(report.totems, "players")) out.push(raidSection("totems", "spell_nature_windfury", "Totems", report.totems.players.length, renderTotemSummary(report.totems, linkFor)));
    if (report.mechanics && (has(report.mechanics, "mechanics") || has(report.mechanics, "players") || report.mechanics.deaths)) {
        const d = report.mechanics.deaths || {};
        out.push(raidSection("mechanics", "spell_fire_selfdestruct", "Mechaniken & Tode", d.total || 0, renderMechanicsSummary(report.mechanics, linkFor), { hot: (d.avoidable || 0) > 0 }));
    }
    if (has(report, "sunder")) out.push(raidSection("sunder", "ability_warrior_sunder", "Sunder Armor", report.sunder.length, renderSunderPanel(report.sunder, linkFor)));
    if (has(report.bossUptimes, "rows")) out.push(raidSection("bosses", "achievement_boss_illidan", "Boss-Uptimes", report.bossUptimes.rows.length, renderBossUptimesPanel(report.bossUptimes)));
    if (has(report.consumables, "players")) out.push(raidSection("consumables", "inv_alchemy_endlessflask_05", "Consumables", report.consumables.players.length, renderConsumablesPanel(report.consumables, linkFor)));
    if (has(report.potions, "players")) out.push(raidSection("potions", "inv_potion_137", "Tränke", report.potions.players.length, renderPotionsPanel(report.potions, linkFor)));
    if (has(report.drums, "players")) out.push(raidSection("drums", "inv_misc_drum_01", "Drums", report.drums.players.length, renderDrumsPanel(report.drums, linkFor)));
    if (has(report.shadowResi, "players")) out.push(raidSection("shadowresi", "spell_shadow_antishadow", "Shadow-Resi", report.shadowResi.players.length, renderShadowResiPanel(report.shadowResi, linkFor)));
    const gearIssues = (report.players || []).reduce((n, p) => n + (p.issues || []).length, 0);
    if (report.players) out.push(raidSection("gear", "inv_shield_06", "Gear-Probleme", gearIssues, renderGearPanel(report.players, linkFor), { hot: gearIssues > 0 }));

    // RPB sections. The damage section counts deaths, the spell section counts
    // downrank warnings and the log check counts unmet requirements, so every
    // badge shows the number that actually needs attention.
    const rpb = report.rpb || null;
    const roles = rpb && rpb.roles;
    if (rpb && has(rpb.damage, "players")) {
        const deaths = rpb.damage.players.reduce((n, p) => n + (p.deaths || 0), 0);
        out.push(raidSection("rpbdamage", "ability_creature_cursed_05", "Schaden & Tode (RPB)", deaths, renderRpbDamagePanel(rpb.damage, roles, linkFor), { hot: deaths > 0 }));
    }
    if (rpb && has(rpb.activity, "players")) {
        out.push(raidSection("rpbactivity", "inv_misc_pocketwatch_02", "Aktivität (RPB)", rpb.activity.players.length, renderRpbActivityPanel(rpb.activity, roles, linkFor)));
        const withSpells = rpb.activity.players.some((p) => (p.singleTargetCasts || []).length || (p.aoeCasts || []).length);
        if (withSpells) {
            const downranks = rpb.activity.players.reduce((n, p) => n + [...(p.singleTargetCasts || []), ...(p.aoeCasts || [])].filter((r) => r.mostlyLowerRank).length, 0);
            out.push(raidSection("rpbspells", "inv_misc_book_11", "Zauber", downranks, renderRpbSpellsPanel(rpb.activity, roles, linkFor), { hot: downranks > 0 }));
        }
    }
    if (rpb && has(rpb, "usage")) out.push(raidSection("rpbusage", "ability_rogue_preparation", "Cooldowns (RPB)", rpb.usage.length, renderRpbUsagePanel(rpb.usage, roles, linkFor)));
    if (rpb && has(rpb.interrupts, "players")) out.push(raidSection("rpbinterrupts", "spell_frost_iceshock", "Interrupts", rpb.interrupts.players.length, renderRpbInterruptsPanel(rpb.interrupts, linkFor)));
    if (rpb && rpb.validation) {
        const unmet = (rpb.validation.requirements || []).filter((r) => !r.ok).length;
        out.push(raidSection("rpbvalidate", "inv_misc_note_02", "Log-Prüfung", unmet, renderRpbValidationPanel(rpb.validation), { hot: unmet > 0 }));
    }
    return out;
}

// ---- Sicht Raider: one card per raider ------------------------------------------

/** The armory paperdoll (character-sheet layout) with the mean item level, or a note without one. */
function paperdoll(p) {
    const color = CLASS_COLORS[p.type] || "#ddd";
    if (!(p.armory || []).length) return "<p class=\"note\">Keine Ausrüstung im Log.</p>";
    const bySlot = {};
    for (const it of p.armory || []) bySlot[it.slot] = it;
    const ilvls = (p.armory || []).map((i) => i.itemLevel).filter((n) => n > 0);
    const avgIlvl = ilvls.length ? Math.round(ilvls.reduce((a, b) => a + b, 0) / ilvls.length) : 0;
    const LEFT = [0, 1, 2, 14, 4, 8];
    const RIGHT = [9, 5, 6, 7, 10, 11, 12, 13];
    const BOTTOM = [15, 16, 17];
    return `<div class="doll" style="--cc:${color}">
        <div class="pd-col pd-col-left">${LEFT.map((s) => paperdollSlot(bySlot[s], "left")).join("")}</div>
        <div class="pd-center">
          <div class="portrait" style="--cc:${color}"><img src="${esc(classIconUrl(p.type))}" alt=""></div>
          <div class="ilvl-badge"><b>${avgIlvl}</b><span>⌀ iLvl</span></div>
        </div>
        <div class="pd-col pd-col-right">${RIGHT.map((s) => paperdollSlot(bySlot[s], "right")).join("")}</div>
      </div>
      <div class="doll-bottom">${BOTTOM.map((s) => paperdollSlot(bySlot[s], "bottom")).join("")}</div>`;
}

/** Consumables & Tränke of one raider: coverage, the potions by type, drums and shadow resistance where present. */
function raiderConsumables(ctx, p) {
    const { report } = ctx;
    const cons = ctx.consByName.get(p.name);
    const pot = ctx.potByName.get(p.name) || p.potions || {};
    const ic = report.icons || {};
    const parts = [];
    if (cons) {
        parts.push(`<table class="mini"><tr><th>${colHead((report.consumables.icons || ic).flask, "Flask")}</th><th>${colHead((report.consumables.icons || ic).battle, "Elixiere")}</th><th>Flask/Elixiere</th><th>${colHead((report.consumables.icons || ic).food, "Food")}</th><th>Waffe geölt</th></tr>
          <tr><td>${pctCell(cons.flask)}</td><td>${pctCell(cons.elixir)}</td><td>${pctCell(cons.buffed)}</td><td>${pctCell(cons.food)}</td><td>${yesNo(cons.weaponOiled)}</td></tr></table>
          <p class="note" style="margin-top:8px">Abdeckung in % der Boss-Kämpfe. Flask &amp; Elixiere schließen sich aus — „Flask/Elixiere" = Flask <em>oder</em> beide Elixiere aktiv.</p>`);
    }
    const hasPotionData = !!(report.potions && report.potions.players && report.potions.players.length);
    if (hasPotionData) {
        const byType = pot.byType || {};
        const tiles = ((report.potions && report.potions.types) || []).filter((t) => byType[t.key]).map((t) => iconTile({ ...t, count: byType[t.key] }));
        parts.push(`<div class="heal-chips" style="margin-top:8px"><span class="chip"><span class="potions">${potionCells(ic, pot)}</span></span><span class="chip"><b>${esc(pot.total || (pot.destruction || 0) + (pot.haste || 0) + (pot.mana || 0))}</b> Tränke gesamt</span></div>${tiles.length ? `<div class="iconrow">${tiles.join("")}</div>` : ""}`);
    } else {
        parts.push("<p class=\"note\">Tränke: <span class=\"sritems\" data-tip=\"Noch keine CLA-Auswertung für diesen Log\">nicht ausgewertet</span></p>");
    }
    const drums = ctx.drumsByName.get(p.name);
    if (drums) parts.push(`<p class="note">${hicon(report.drums && report.drums.icon, "")}Drums: <b>${esc(drums.total)}</b> <span class="sritems">(${esc(Object.entries(drums.byType || {}).map(([k, v]) => `${k}: ${v}`).join(", "))})</span></p>`);
    const sr = ctx.srByName.get(p.name);
    if (sr) parts.push(`<p class="note">Schattenwiderstand aus Gear: <b class="srval">${esc(sr.sr)}</b> <span class="sritems">${(sr.items || []).map((it) => `<a href="https://www.wowhead.com/tbc/item=${esc(it.itemId)}" target="_blank" rel="noopener">${esc(it.itemName)} (+${esc(it.sr)})</a>`).join(", ") || "—"}</span></p>`);
    return parts.join("");
}

/** The raider's own row of the raid-buff matrix, spelled out: per buff the share of fights it was fully there and the counts behind it. */
function raiderBuffs(ctx, p) {
    const b = ctx.buffsByName.get(p.name);
    const cols = ((ctx.report.raidBuffs && ctx.report.raidBuffs.rows) || []).filter((r) => r.expected || r.seenPlayers > 0 || (r.unknown || 0) > 0);
    const rows = cols.map((r) => {
        const c = b.buffs && b.buffs[r.key];
        if (!c) return "";
        let cell;
        let hint = "";
        if (c.wrong) { cell = `<span class="pct pct-wrong">${esc(c.pct)}%</span>`; hint = `${c.wrong}× auf der falschen Rolle`; } else if (!c.expected && c.unknown) { cell = "<span class=\"pct pct-na\">?</span>"; } else if (!c.expected) { cell = `<span class="pct pct-na">${esc(c.pct)}%</span>`; hint = "nicht erwartet"; } else cell = pctCell(c.pct);
        if (c.unknown) hint = `${hint ? `${hint}, ` : ""}${c.unknown}× nicht nachweisbar`;
        return `<tr><td>${hicon(r.icon, "")}${esc(r.label)}<div class="sritems">${esc(r.provider)}</div></td><td>${cell}</td><td class="mono">${esc(c.full)}</td><td class="mono">${esc(c.late || 0)}</td><td class="mono">${esc(c.partial)}</td><td class="mono">${esc(c.none)}</td><td class="sritems">${esc(hint)}</td></tr>`;
    }).join("");
    const inferred = (ctx.report.raidBuffs && ctx.report.raidBuffs.inferred) || [];
    const open = inferred.length ? ` <span data-tip="${esc(INFERRED_HOW)}">${esc(inferred.map((u) => u.label).join(" und "))} aus dem Verlauf abgeleitet${b.unknown ? `, ${esc(b.unknown)}× ohne Nachweis` : ""}.</span>` : "";
    return `<p class="note">${esc(BUFF_ROLE_LABELS[b.role] || b.role)} · ${esc(b.fights)} ${b.fights === 1 ? "Kampf" : "Kämpfe"} · fehlte ${esc(b.missing)}×, spät ${esc(b.late || 0)}×, nicht durchgehend ${esc(b.partial)}×${b.wrong ? `, falsche Rolle ${esc(b.wrong)}×` : ""}. Wann welcher Buff fehlte, zeigt der Kampfverlauf.${open}</p>
    <table class="mini"><tr><th>Buff</th><th>Anteil</th><th>Da</th><th>Spät</th><th>Nicht durchgehend</th><th>Gefehlt</th><th></th></tr>${rows}</table>`;
}

/** The healer's raid-wide numbers (report.healers.players): healing, overheal, mana, potions, dispels, the auras on the tank. */
function raiderHealing(ctx, p) {
    const h = ctx.healByName.get(p.name);
    const late = (h.potionPcts || []).filter((x) => x <= 15).length;
    const chips = [
        `<span class="chip"><b>${fmtK(h.healingTotal)}</b> Heilung in ${esc(h.fights)} ${h.fights === 1 ? "Kampf" : "Kämpfen"}</span>`,
        `<span class="chip chip-${h.overhealPct >= 50 ? "high" : h.overhealPct >= 35 ? "medium" : "good"}"><b>${esc(h.overhealPct)} %</b> Overheal</span>`,
        h.topOverheal ? `<span class="chip">${h.topOverheal.icon ? hicon(h.topOverheal.icon, "") : ""}<b>${esc(h.topOverheal.overhealPct)} %</b> ${esc(h.topOverheal.name)}</span>` : "",
        h.manaMinAvg !== null && h.manaMinAvg !== undefined ? `<span class="chip chip-${h.manaLowFights ? "high" : "good"}"><b>${esc(h.manaMinAvg)} %</b> Ø Mana-Tiefstand${h.manaLowFights ? ` · ${esc(h.manaLowFights)}× unter 10 %` : ""}</span>` : "",
        `<span class="chip chip-${h.potionMissingFights ? "medium" : "good"}"><b>${esc(h.potions)}</b> Manatränke${late ? ` · ${late}× spät` : ""}${h.potionMissingFights ? ` · ${esc(h.potionMissingFights)}× keiner` : ""}</span>`,
        `<span class="chip"><b>${esc(h.dispels)}</b> Dispels${h.avgReactionMs !== null && h.avgReactionMs !== undefined ? ` · Ø ${fmtSecs(h.avgReactionMs)}` : ""}</span>`,
        ...(h.shields || []).map((s) => `<span class="chip">${hicon(s.icon, s.label)}<b>${esc(s.uptimeAvg)} %</b> ${esc(s.label)} auf dem Tank</span>`),
    ].filter(Boolean).join("");
    return `<div class="heal-chips">${chips}</div><p class="note">Manaverlauf und Zauber je Kampf stehen im Kampfverlauf unter „Heilung“.</p>`;
}

/** Activity, cooldowns and totems of one raider over the raid. */
function raiderActivity(ctx, p) {
    const act = ctx.actByName.get(p.name);
    const cd = ctx.cdByName.get(p.name);
    const tot = ctx.totByName.get(p.name);
    const rows = [];
    if (act) rows.push(`<tr><td>${hicon("inv_misc_pocketwatch_02", "")}Aktivität</td><td>${toneCell(act.activeAvg)}</td><td class="sritems">${esc(act.fights)} ${act.fights === 1 ? "Kampf" : "Kämpfe"} · ${esc(act.gaps)} Lücken · längste ${fmtTime(act.longestGap)} · unerklärt ${fmtTime(act.unexplainedMs)}${act.mechanicMs ? ` · durch Mechanik ${fmtTime(act.mechanicMs)}` : ""}</td></tr>`);
    if (cd) rows.push(`<tr><td>${hicon("ability_rogue_preparation", "")}Cooldowns</td><td>${cd.usedPct === null || cd.usedPct === undefined ? naCell("", "–") : toneCell(cd.usedPct)}</td><td class="sritems">${esc(cd.uses)} von ${esc(cd.possible)} möglichen Einsätzen · Ø erster Einsatz ${cd.avgFirstAtMs === null || cd.avgFirstAtMs === undefined ? "–" : fmtTime(cd.avgFirstAtMs)} · ${esc(cd.stacked)} mit Bloodlust</td></tr>`);
    if (tot) rows.push(`<tr><td>${hicon("spell_nature_windfury", "")}Totems</td><td>${tot.wfUptimeAvg === null || tot.wfUptimeAvg === undefined ? naCell("", "–") : toneCell(tot.wfUptimeAvg)}</td><td class="sritems">Windfury Ø · Twisting in ${esc(tot.twistingFights)} von ${esc(tot.wfFights)} Kämpfen · ${esc(tot.gapCount)} Lücken · Downtime ${fmtTime(tot.downtimeMs)}</td></tr>`);
    return `<table class="mini"><tr><th>Bereich</th><th>Wert</th><th>Details</th></tr>${rows.join("")}</table><p class="note">Die Bänder und Zeitpunkte je Kampf stehen im Kampfverlauf.</p>`;
}

/** Damage taken and deaths of one raider: the CLA's mechanics summary and the RPB's per-player rows. */
function raiderDamage(ctx, p) {
    const { report } = ctx;
    const parts = [];
    const mech = ctx.mechByName.get(p.name);
    if (mech) {
        const by = Object.values(mech.byMechanic || {}).sort((a, b) => b.hits - a.hits).map((m) => `<span class="chip">${hicon(m.icon, "")}<b>${esc(m.hits)}×</b> ${esc(m.label)}${m.amount ? ` · ${fmtK(m.amount)}` : ""}</span>`).join("");
        parts.push(`<div class="heal-chips"><span class="chip"><b>${esc(mech.hits)}</b> vermeidbare Treffer</span>${mech.amount ? `<span class="chip"><b>${fmtK(mech.amount)}</b> Schaden</span>` : ""}<span class="chip chip-${mech.avoidableDeaths ? "high" : "good"}"><b>${esc(mech.deaths || 0)}</b> Tode${mech.avoidableDeaths ? ` · ${esc(mech.avoidableDeaths)} vermeidbar` : ""}${mech.earlyDeaths ? ` · ${esc(mech.earlyDeaths)} früh` : ""}</span>${by}</div>`);
    }
    const dmg = ctx.rpbDmgByName.get(p.name);
    if (dmg) {
        const abilities = (report.rpb.damage.abilities || []).map((a, i) => ({ a, v: dmg.perAbility[i] || 0 })).filter((x) => x.v > 0);
        parts.push(`<h4 class="heal-h">Vermeidbarer Schaden (RPB)</h4><table class="mini"><tr><th>Fähigkeit</th><th>Schaden</th></tr>${abilities.map((x) => `<tr><td>${abilityIcon(x.a)}${esc(x.a.label)}<div class="sritems">${esc((x.a.sources || []).join(", "))}</div></td><td class="mono">${num(x.v)}</td></tr>`).join("")}<tr><td><strong>Summe</strong></td><td class="mono">${num(dmg.avoidableTotal)}</td></tr><tr><td>Reflektiert</td><td class="mono">${num(dmg.reflected)}</td></tr><tr><td>Auf Spieler</td><td class="mono">${num(dmg.hostile)}</td></tr><tr><td>Tode</td><td><span class="pct ${dmg.deaths > 0 ? "pct-none" : "pct-full"}">${esc(dmg.deaths)}</span></td></tr></table>`);
    }
    const act = ctx.rpbActByName.get(p.name);
    if (act) {
        const st = act.singleTargetCasts || [];
        const aoe = act.aoeCasts || [];
        parts.push(`<h4 class="heal-h">Aktivität &amp; Zauber (RPB)</h4><div class="heal-chips"><span class="chip"><b>${esc(act.secondsActive)}s</b> aktiv</span><span class="chip"><b>${esc(act.relativeTotal)} %</b> der Raidzeit</span><span class="chip"><b>${esc(act.secondsActiveST)}s</b> Einzelziel</span><span class="chip"><b>${esc(act.secondsActiveAoe)}s</b> Fläche</span></div>${st.length || aoe.length ? `<div class="iconrow">${spellTiles([...st, ...aoe]).join("")}</div>` : ""}`);
    }
    const use = ctx.rpbUseByName.get(p.name);
    if (use) {
        const tiles = [
            ...(use.classCooldowns || []).map((c) => iconTile({ icon: c.icon, name: c.name, spellId: c.spellId, label: c.label, count: c.total, note: c.possibleUses ? `${c.total} von ~${c.possibleUses} möglichen` : "", tone: c.possibleUses && c.total < c.possibleUses / 2 ? "warn" : "good" })),
            ...(use.trinketsAndRacials || []).map((t) => iconTile({ icon: t.icon, name: t.name, spellId: t.spellId, label: t.label, count: t.total })),
            ...[...(use.engineering || []), ...(use.absorbs || [])].map((t) => iconTile({ icon: t.icon, name: t.name, spellId: t.spellId, label: t.label, count: t.total })),
        ];
        if (tiles.length) parts.push(`<h4 class="heal-h">Cooldowns &amp; Schmuckstücke (RPB)</h4>${iconRow(tiles)}`);
    }
    const kicks = ctx.rpbIntByName.get(p.name);
    if (kicks) parts.push(`<h4 class="heal-h">Unterbrechungen (RPB)</h4><div class="heal-chips"><span class="chip"><b>${esc(kicks.count)}</b> Unterbrechungen</span></div>${iconRow((kicks.spells || []).map((s) => iconTile({ icon: s.icon, spellId: s.spellId, label: s.name, count: s.count })))}`);
    const sunder = ctx.sunderByName.get(p.name);
    if (sunder) parts.push(`<p class="note">Sunder Armor: <b>${esc(sunder.total)}</b>, davon ${esc(sunder.below5)} bei &lt; 5 Stacks.</p>`);
    return parts.join("");
}

/** The send dialog of one raider (SendeFenster): the approved points with their text choice, the DM preview, save/send. */
function sendDialog(ctx, p, i, items) {
    const { report } = ctx;
    const approved = items.filter((it) => it.approved === true);
    const open = items.filter((it) => it.approved === null).length;
    const sent = ctx.sent[p.name];
    const idx = (report.roster || []).findIndex((x) => x.name === p.name);
    const blocks = approved.map((it, j) => {
        const mode = it.custom ? "custom" : it.ai ? "ai" : "rule";
        const text = it.custom || it.ai || it.text || "";
        const segBtn = (m, label) => `<button type="button" class="seg-btn${mode === m ? " active" : ""}" data-txt="${m}">${label}</button>`;
        return `<div class="send-item${j === 0 ? " on" : ""}" data-key="${esc(it.key)}" data-title="${esc(it.title)}" data-ai="${esc(it.ai || "")}" data-rule="${esc(it.text || "")}" data-custom="${esc(it.custom || "")}" data-mode="${mode}">
          <div class="send-item-head"><span class="tag tag-${esc(it.impact)}">${esc(IMPACT_LABEL[it.impact] || it.impact)}</span><b>${esc(it.title)}</b>${it.ai && !it.custom ? "<span class=\"rec-source\">KI</span>" : ""}<div class="seg">${it.ai ? segBtn("ai", "KI-Text") : ""}${segBtn("rule", "Regeltext")}${segBtn("custom", "Eigener")}</div></div>
          <textarea class="send-text" rows="3"${mode === "custom" ? "" : " readonly"}>${esc(text)}</textarea>
        </div>`;
    }).join("");
    const preview = approved.map((it) => {
        const text = it.custom || it.ai || it.text || "";
        return `<div><b>${esc(it.title)}</b><br>${esc(text.length > 160 ? `${text.slice(0, 160)} …` : text)}</div>`;
    }).join("");
    return `<dialog class="dlg send" id="send-${i}" data-report="${esc(report.id)}" data-player="${esc(p.name)}">
      <div class="dlg-head"><img class="vcard-icon" src="${esc(classIconUrl(p.type))}" alt=""><div class="dlg-main"><div class="dlg-title">An ${esc(p.name)} senden</div><div class="vcard-meta">${approved.length} freigegebene${approved.length === 1 ? "r" : ""} Punkt${approved.length === 1 ? "" : "e"} · Vorschau der Nachricht${sent ? ` · zuletzt gesendet ${esc(new Date(sent.at).toLocaleString("de-DE"))}` : ""}</div></div><button type="button" class="dlg-x" data-close aria-label="Schließen">×</button></div>
      <div class="send-grid">
        <div class="send-items">${blocks || "<p class=\"note\">Noch nichts freigegeben.</p>"}<p class="note">Der eigene Text geht vor dem KI-Text, der KI-Text vor dem Regeltext. Die Bearbeitung wird im Report gespeichert.${open ? ` ${open === 1 ? "Der noch offene Punkt wird" : `Die ${open} noch offenen Punkte werden`} nicht gesendet.` : ""}</p></div>
        <div class="send-preview"><div class="kicker">So kommt es an</div><div class="dm"><b>${esc(report.title || "Raid")} · Deine Auswertung</b><div class="note">${approved.length} Punkt${approved.length === 1 ? "" : "e"} von der Raidleitung geprüft</div><div class="dm-items">${preview}</div><div class="note">Report ansehen ↗ /r/${esc(report.id)}${idx >= 0 ? `/p/${idx}` : ""}</div></div><p class="note">Ein unveränderter Satz wird nie zweimal geschickt.</p></div>
      </div>
      <div class="dlg-foot"><span class="note send-out"></span><div class="btns"><button type="button" class="btn btn-ghost btn-sm" data-close>Abbrechen</button><button type="button" class="btn btn-ghost btn-sm" data-sendact="save">Nur speichern</button><button type="button" class="btn btn-sm" data-sendact="send"${approved.length ? "" : " disabled"}>Per Bot senden</button></div></div>
    </dialog>`;
}

/**
 * One raider card (Sicht Raider, and the player page opened): class icon,
 * name, role, chips; sections behind buttons; for a reviewer the footer with
 * the phrasing job and the send dialog. `inline` (the player page) leaves the
 * timeline to the page instead of a dialog.
 */
function raiderCard(ctx, p, i, opts = {}) {
    const { report, reviewer } = ctx;
    const name = p.name;
    const color = classColorOf(p.type) || "var(--text)";
    const role = ctx.roleOf(name);
    const issues = ((ctx.gearByName.get(name) || {}).issues || p.issues || []);
    const cons = ctx.consByName.get(name);
    const buffs = ctx.buffsByName.get(name);
    const heal = ctx.healByName.get(name);
    const act = ctx.actByName.get(name);
    const recP = ctx.recByName.get(name);
    const items = recP ? (reviewer ? recP.items : recP.items.filter((x) => x.approved === true)) : [];
    const open = items.filter((x) => x.approved === null).length;
    const approved = items.filter((x) => x.approved === true).length;
    const fights = playerFights(report.timeline, name);

    const chip = (icon, n, label, tone, tip, sub) => `<span class="chip chip-x${tone ? ` ${tone}` : ""}"${tip ? ` data-tip="${esc(tip)}"` : ""}${sub ? ` data-tip-sub="${esc(sub)}"` : ""}>${hicon(icon, "")}<b>${esc(n)}</b> ${esc(label)}</span>`;
    const chips = [
        chip("inv_shield_06", issues.length, "Gear", issues.some((x) => x.severity === "high") ? "bad" : issues.length ? "warn" : "ok", "Gear-Probleme: Verzauberungen, Sockel, Meta-Gem", "Aus der Ausrüstung, die das Log beim Pull gesehen hat. Rot bei einem schweren Problem."),
        cons ? chip("inv_alchemy_endlessflask_05", `${cons.buffed} %`, "Consumables", cons.buffed >= 90 ? "ok" : cons.buffed < 50 ? "bad" : "warn", "Anteil der Boss-Kämpfe mit Flask oder beiden Elixieren", "Ab 90 % grün, unter 50 % rot. Food, Tränke und Drums stehen unter „Consumables & Tränke“.") : "",
        buffs ? chip("spell_magic_greaterblessingofkings", buffs.missing, buffs.missing === 1 ? "Buff fehlte" : "Buffs fehlten", buffs.missing >= 2 ? "bad" : buffs.missing ? "warn" : "ok", "Kämpfe, in denen ein erwarteter Raid-Buff gar nicht auf dem Raider lag", "Spät gesetzte oder ausgelaufene Buffs zählen hier nicht mit; sie stehen unter „Buffs“.") : "",
        heal ? chip("spell_holy_flashheal", `${heal.overhealPct} %`, "Overheal", heal.overhealPct >= 50 ? "bad" : heal.overhealPct >= 35 ? "warn" : "ok", "Anteil der Heilung, die über volle Lebenspunkte ging, über alle Kämpfe", "Ab 35 % gelb, ab 50 % rot.") : "",
        heal && heal.manaLowFights ? chip("spell_holy_flashheal", `${heal.manaLowFights}×`, "unter 10 % Mana", "bad", "Kämpfe, in denen das Mana unter 10 % fiel", "Die Kurven mit Tränken und Regeneration stehen unter „Heilung & Mana“.") : "",
        !heal && act ? chip("inv_misc_pocketwatch_02", `${act.activeAvg} %`, "aktiv", act.activeAvg >= 95 ? "ok" : act.activeAvg >= 85 ? "" : "warn", "Anteil der Kampfzeit mit laufenden Zaubern oder Angriffen, im Mittel über die Kämpfe", "Bis zum eigenen Tod. Ab 95 % grün, unter 85 % gelb. Die Lücken stehen unter „Aktivität & Cooldowns“.") : "",
        dipChip(report, name),
        recP || items.length ? chip("inv_misc_note_01", items.length, reviewer ? `Empfehlungen${open ? ` · ${open} offen` : ""}` : (items.length === 1 ? "Empfehlung" : "Empfehlungen"), open >= 3 ? "bad" : open ? "warn" : items.length ? "" : "ok", reviewer ? "Befunde für diesen Raider; offen heißt noch nicht freigegeben oder verworfen" : "Freigegebene Empfehlungen für diesen Raider") : "",
    ].filter(Boolean).join("");

    // the sections: { key, label, icon, count, tone, html }
    const secs = [];
    if (recP && (items.length || reviewer)) {
        secs.push({ key: "recs", label: "Empfehlungen", icon: "inv_misc_note_01", count: `${items.length}${open ? ` · ${open} offen` : ""}`, tone: open ? "mid" : "ok",
            html: items.length ? `<ul class="rec-list">${items.map((it) => recItem(it, "player", name, reviewer)).join("")}</ul>` : "<div class=\"rec-clean\">Nichts auszusetzen – weiter so.</div>" });
    }
    secs.push({ key: "gear", label: "Gear", icon: "inv_shield_06", count: issues.length ? `${issues.length} Problem${issues.length === 1 ? "" : "e"}` : "ok", tone: issues.some((x) => x.severity === "high") ? "bad" : issues.length ? "mid" : "ok",
        html: (issues.length ? panelBox(`<ul class="issues" style="padding:8px 16px">${issues.map(issueRow).join("")}</ul>`) : "<div class=\"rec-clean\">Keine Gear-Probleme 🎉</div>") + `<div style="margin-top:12px">${paperdoll(p)}</div>` });
    if (cons || ctx.potByName.get(name) || (report.potions && report.potions.players) || ctx.drumsByName.get(name) || ctx.srByName.get(name) || report.consumables) {
        secs.push({ key: "cons", label: "Consumables & Tränke", icon: "inv_alchemy_endlessflask_05", count: cons ? (cons.buffed >= 90 ? "ok" : `${cons.buffed} %`) : "", tone: cons ? (cons.buffed >= 90 ? "ok" : cons.buffed < 50 ? "bad" : "mid") : "none", html: raiderConsumables(ctx, p) });
    }
    if (buffs) secs.push({ key: "buffs", label: "Buffs", icon: "spell_magic_greaterblessingofkings", count: buffs.missing + (buffs.partial || 0) + (buffs.late || 0) + (buffs.wrong || 0) ? `${buffs.missing} fehlten` : "alle da", tone: buffs.missing >= 2 ? "bad" : buffs.missing || buffs.partial || buffs.late ? "mid" : "ok", html: raiderBuffs(ctx, p) });
    if (heal) secs.push({ key: "heal", label: "Heilung & Mana", icon: "spell_holy_flashheal", count: `${heal.fights} ${heal.fights === 1 ? "Kampf" : "Kämpfe"}`, tone: heal.manaLowFights ? "bad" : heal.overhealPct >= 35 ? "mid" : "ok", html: raiderHealing(ctx, p) });
    if (act || ctx.cdByName.get(name) || ctx.totByName.get(name)) {
        const cd = ctx.cdByName.get(name);
        const tone = act ? (act.activeAvg >= 95 ? "ok" : act.activeAvg >= 85 ? "mid" : "bad") : (cd && cd.usedPct !== null ? (cd.usedPct >= 80 ? "ok" : "mid") : "ok");
        secs.push({ key: "act", label: "Aktivität & Cooldowns", icon: "inv_misc_pocketwatch_02", count: act ? `${act.activeAvg} %` : (cd && cd.usedPct !== null ? `${cd.usedPct} % genutzt` : ""), tone, html: raiderActivity(ctx, p) });
    }
    if (ctx.mechByName.get(name) || ctx.rpbDmgByName.get(name) || ctx.rpbActByName.get(name) || ctx.rpbUseByName.get(name) || ctx.rpbIntByName.get(name) || ctx.sunderByName.get(name)) {
        const mech = ctx.mechByName.get(name);
        const dmg = ctx.rpbDmgByName.get(name);
        const deaths = mech ? mech.deaths || 0 : dmg ? dmg.deaths || 0 : 0;
        secs.push({ key: "dmg", label: "Schaden & Tode", icon: "ability_creature_cursed_05", count: `${deaths} ${deaths === 1 ? "Tod" : "Tode"}`, tone: mech && mech.avoidableDeaths ? "bad" : deaths ? "mid" : "ok", html: raiderDamage(ctx, p) });
    }
    let timelineDialog = "";
    if (fights.length && !opts.inline) {
        const ns = `r${i}-`;
        timelineDialog = `<dialog class="dlg chart" id="dlg-rt-${i}">
          <div class="dlg-head"><img class="vcard-icon" src="${esc(classIconUrl(p.type))}" alt=""><div class="dlg-main"><div class="dlg-title">${hicon("inv_misc_pocketwatch_01", "")}Kampfverlauf · ${esc(name)}</div><div class="vcard-meta">${fights.length} ${fights.length === 1 ? "Kampf" : "Kämpfe"} · ${PX_PER_SEC} px pro Sekunde, seitlich scrollen</div></div><button type="button" class="dlg-x" data-close aria-label="Schließen">×</button></div>
          <div class="dlg-body">${renderPlayerTimeline(report.timeline, name, ns)}</div>
          <div class="dlg-foot"><span class="note">Tode als senkrechte Striche in Klassenfarbe · Tabellenansicht unter jeder Grafik aufklappbar</span><div class="btns"><a class="btn btn-ghost btn-sm" href="${esc(ctx.linkFor(name) || "#")}">Spielerseite ↗</a><button type="button" class="btn btn-ghost btn-sm" data-close>Schließen</button></div></div>
        </dialog>`;
        secs.push({ key: "tl", label: "Kampfverlauf", icon: "inv_misc_pocketwatch_01", count: "⤢", tone: "none",
            html: `<p class="note">${fights.length} ${fights.length === 1 ? "Kampf" : "Kämpfe"} mit eigenen Zeilen: Aktivität, Cooldowns, Buffs, Heilung, Mechaniken, Tode.</p><button type="button" class="btn btn-ghost btn-sm" data-dialog="dlg-rt-${i}">${hicon("inv_misc_pocketwatch_01", "")}Verlauf öffnen ⤢</button>${timelineDialog}` });
    }
    const secId = (k) => `rc${i}-${k}`;
    const buttons = secs.map((s, j) => `<button type="button" class="sec${j === 0 ? " active" : ""}" data-show="${secId(s.key)}">${hicon(s.icon, "")}${esc(s.label)}${s.count !== "" ? `<span class="n${s.tone === "bad" ? " bad" : s.tone === "mid" ? " mid" : ""}">${esc(s.count)}</span>` : ""}</button>`).join("");
    const panels = secs.map((s, j) => `<div id="${secId(s.key)}" class="part"${j === 0 ? "" : " hidden"}>${s.html}</div>`).join("");

    let foot = "";
    if (reviewer && recP) {
        const sent = ctx.sent[name];
        foot = `<div class="raider-foot"><span class="note">${approved} freigegeben · ${open} offen · zuletzt gesendet: ${sent ? esc(new Date(sent.at).toLocaleString("de-DE")) : "nie"}</span><span class="rec-send-result" hidden></span><div class="btns"><button type="button" class="btn btn-ghost btn-sm" data-phrase="player" data-tip="Claude formuliert die Befunde dieses Raiders in Klartext" data-tip-sub="Deine Freigabe bleibt nötig; der Regeltext bleibt erhalten.">KI-Formulierung erzeugen</button><button type="button" class="btn btn-sm" data-dialog="send-${i}"${approved ? "" : " disabled"}>Vorschau &amp; senden</button></div></div>${sendDialog(ctx, p, i, items)}`;
    }
    const deathsN = fights.reduce((n, f) => n + (f.deaths || []).filter((d) => d.name === name).length, 0);
    const roleIcon = { tank: "inv_shield_06", healer: "spell_holy_flashheal", dps: "ability_dualwield" }[role];
    const meta = [
        badge(p.type, ""),
        ROLE_LABEL[role] ? badge(ROLE_LABEL[role], "accent", roleIcon) : "",
        fights.length ? badge(`${fights.length} ${fights.length === 1 ? "Kampf" : "Kämpfe"}`, "", "", true) : "",
        deathsN ? badge(`${deathsN} ${deathsN === 1 ? "Tod" : "Tode"}`, "bad", "ability_creature_cursed_05") : "",
    ].filter(Boolean).join("");
    return `<details class="vcard raider-card" id="raider-${esc(name)}" data-name="${esc(name)}" data-role="${role}" data-open="${reviewer ? open : approved}" data-report="${esc(report.id)}" style="--cc:${esc(color)}"${opts.open ? " open" : ""}>
      <summary><img class="vcard-icon" src="${esc(classIconUrl(p.type))}" alt="${esc(p.type)}"><div class="vcard-main"><div class="vcard-title cn">${esc(name)}</div><div class="vcard-meta">${meta}</div></div><div class="vcard-chips">${chips}</div>${expBtn()}</summary>
      <div class="vcard-body"><nav class="secs">${buttons}</nav>${panels}${foot}</div>
    </details>`;
}

/** Sicht Raider: search, role filter, one card per roster entry. `openName` opens that raider's card. */
function renderRaiderView(ctx, openName) {
    const roster = ctx.report.roster || [];
    if (!roster.length) return "<div class=\"empty\">Keine Raider gefunden.</div>";
    const withOpen = roster.filter((p) => {
        const r = ctx.recByName.get(p.name);
        return r && r.items.some((it) => (ctx.reviewer ? it.approved === null : it.approved === true));
    }).length;
    const cards = roster.map((p, i) => raiderCard(ctx, p, i, { open: openName === p.name })).join("");
    return `<div class="view-bar"><div class="raider-tools"><input type="search" id="raiderSearch" placeholder="Raider suchen…" aria-label="Raider suchen"><nav class="seg"><button type="button" class="seg-btn active" data-rolefilter="all">Alle</button><button type="button" class="seg-btn" data-rolefilter="tank">Tank</button><button type="button" class="seg-btn" data-rolefilter="healer">Heiler</button><button type="button" class="seg-btn" data-rolefilter="dps">DPS</button><button type="button" class="seg-btn" data-rolefilter="open">${ctx.reviewer ? "Offen" : "Empfehlungen"} <span class="n">${withOpen}</span></button></nav></div><span class="rec-toggle-all"><button type="button" class="btn btn-sm btn-ghost" data-cards="open">Alle aufklappen</button><button type="button" class="btn btn-sm btn-ghost" data-cards="close">Alle zuklappen</button></span></div>
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

// The send dialog: text choice per point (KI / rule / own), live DM preview,
// "Nur speichern" writes own texts through the review endpoint, "Per Bot senden"
// saves and then sends this one raider; an unchanged, already sent set offers a
// forced resend instead of silently doing nothing.
const SEND_DLG_SCRIPT = `<script>(function(){if(window.__ehSendDlg)return;window.__ehSendDlg=1;
var token=null;function csrf(){return token?Promise.resolve(token):fetch("/api/session",{credentials:"same-origin"}).then(function(r){return r.json()}).then(function(j){token=j.csrfToken||(j.data&&j.data.csrfToken)||"";return token;});}
function hdr(t){return {"Content-Type":"application/json","X-CSRF-Token":t};}
function preview(d){var box=d.querySelector(".dm-items");if(!box)return;box.innerHTML="";d.querySelectorAll(".send-item").forEach(function(it){var t=it.querySelector(".send-text").value.trim();if(!t)return;var el=document.createElement("div"),b=document.createElement("b");b.textContent=it.getAttribute("data-title");el.appendChild(b);el.appendChild(document.createElement("br"));el.appendChild(document.createTextNode(t.length>160?t.slice(0,160)+" …":t));box.appendChild(el);});}
function save(d,t,id,who){var items=[].slice.call(d.querySelectorAll(".send-item"));return items.reduce(function(p,it){return p.then(function(){var m=it.getAttribute("data-mode"),v=it.querySelector(".send-text").value.trim(),text=m==="custom"?v:"";if(text===(it.getAttribute("data-custom")||""))return;return fetch("/api/cla/recommendations",{method:"POST",credentials:"same-origin",headers:hdr(t),body:JSON.stringify({reportId:id,scope:"player",player:who,key:it.getAttribute("data-key"),text:text})}).then(function(r){if(!r.ok)throw new Error("Speichern fehlgeschlagen ("+r.status+")");it.setAttribute("data-custom",text);});});},Promise.resolve());}
document.addEventListener("click",function(e){var t=e.target.closest("[data-txt]");if(t){var it=t.closest(".send-item"),m=t.getAttribute("data-txt"),ta=it.querySelector(".send-text");it.setAttribute("data-mode",m);it.querySelectorAll("[data-txt]").forEach(function(x){x.classList.toggle("active",x===t);});ta.value=it.getAttribute("data-"+m)||"";ta.readOnly=m!=="custom";if(m==="custom")ta.focus();preview(t.closest("dialog"));return;}
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
    const sections = raidSections(ctx);
    const roster = report.roster || [];

    const isAdmin = !!(user && user.isAdmin);
    const actions = [
        report.reportUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(report.reportUrl)}" target="_blank" rel="noopener">${hicon("inv_misc_pocketwatch_01", "")}→ Warcraft Logs</a>` : "",
        isAdmin ? `<a class="btn btn-ghost btn-sm" href="/cla">${hicon("ability_warrior_rallyingcry", "")}Alle Auswertungen</a>` : "",
    ].filter(Boolean).join("");

    const views = [
        { id: "raid", icon: "ability_warrior_rallyingcry", label: "Raid", count: sections.length, html: sections.length ? sections.join("") : "<div class=\"empty\">Keine raid-weiten Auswertungen in diesem Report.</div>" },
        { id: "bosse", icon: "achievement_boss_illidan", label: "Bosse", count: bosses.length, html: renderBossView(report.timeline, linkFor, rec ? rec.raid : [], reviewer) },
        { id: "raider", icon: "inv_misc_grouplooking", label: "Raider", count: roster.length, html: renderRaiderView(ctx, null) },
    ];
    const start = hasTimeline ? "bosse" : "raid";
    const seg = views.map((v) => `<button type="button" class="seg-btn${v.id === start ? " active" : ""}" data-show="view-${v.id}">${hicon(v.icon, "")}${esc(v.label)}<span class="n">${esc(v.count)}</span></button>`).join("");
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
      <div class="view-bar"><nav class="seg views">${seg}</nav><span class="note">Ein Boss, ein Raider – alles Weitere klappt auf oder öffnet sich als Fenster.</span></div>
      ${panels}
      ${TIMELINE_SCRIPT}${DIALOG_SCRIPT}${VIEW_SCRIPT}${FILTER_SCRIPT}${CARDS_SCRIPT}${reviewer ? REVIEW_SCRIPT + PHRASE_SCRIPT + SEND_DLG_SCRIPT : ""}`;

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
        badge = "<span class=\"slot-badge b-miss\" data-tip=\"keine Verzauberung\">✗</span>";
        ench = "<div class=\"slot-ench miss\">keine Verzauberung</div>";
    } else if (it.enchant.status === "bad") {
        badge = `<span class="slot-badge b-bad" data-tip="${esc(it.enchant.reason || "suboptimale Verzauberung")}">!</span>`;
        ench = `<div class="slot-ench bad">suboptimale Verzauberung${it.enchant.reason ? ` · ${esc(it.enchant.reason)}` : ""}</div>`;
    } else if (it.enchant.status === "ok") {
        badge = "<span class=\"slot-badge b-ok\" data-tip=\"verzaubert\" data-tip-sub=\"Details im Tooltip des Gegenstands\">✓</span>";
        ench = "<div class=\"slot-ench ok\">verzaubert</div>";
    }
    // real gem icons + empty sockets
    let gems = (it.gems || []).map((g) =>
        `<a class="gemicon ${g.bad ? "gem-bad" : ""}" href="https://www.wowhead.com/tbc/item=${esc(g.id)}" target="_blank" rel="noopener" data-tip="${g.bad ? "suboptimaler Edelstein" : "Edelstein"}"><img src="${esc(iconUrl(g.icon))}" alt=""></a>`).join("");
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
function renderPlayerPage(report, idx, user) {
    const p = (report.roster || [])[idx];
    if (!p) return renderNotFound();
    const ctx = reportContext(report, user);
    const body = `
      <div class="page-head">
        <div class="page-head-main">
          <div class="kicker">${esc(report.title || "")}</div>
          <h1 class="page-title">${esc(p.name)} <span class="sub" style="font-size:15px;font-weight:500">Stufe 70 · ${esc(p.type)}</span></h1>
        </div>
        <div class="page-actions"><a class="btn btn-ghost btn-sm" href="/r/${esc(report.id)}#raider">← zurück zum Report</a></div>
      </div>
      <div class="view">${raiderCard(ctx, p, idx, { open: true, inline: true })}</div>
      ${renderPlayerTimeline(report.timeline, p.name, "p-")}
      ${TIMELINE_SCRIPT}${DIALOG_SCRIPT}${ctx.reviewer ? REVIEW_SCRIPT + PHRASE_SCRIPT + SEND_DLG_SCRIPT : ""}`;

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
