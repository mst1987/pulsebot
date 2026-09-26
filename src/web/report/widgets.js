// Small HTML building blocks every part of the report pages uses: icons, badges,
// tiles, bars, metric cards, dialogs, number formats and the class colours.
const { itemLink: wowheadItemLink } = require("../../utils/loot/wowhead");
const { CLASS_COLORS } = require("../../utils/setupView");
const { armoryUrlFor } = require("../charLinks");
const rpbData = require("../../config/rpbData");
const { esc } = require("./layout");

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
 * [data-dialog="dlg-<id>"] through static/report.js.
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

const classColorOf = (type) => CLASS_COLORS[type] || "";

function pctTone(v) {
    return v >= 95 ? "good" : v >= 70 ? "medium" : "high";
}

function classIconName(type) {
    return type ? `classicon_${String(type).toLowerCase()}` : "";
}

function fmtK(n) {
    const v = Number(n) || 0;
    if (v >= 100000) return `${Math.round(v / 1000)}k`;
    if (v >= 1000) return `${(v / 1000).toFixed(1).replace(".", ",")}k`;
    return String(Math.round(v));
}

function fmtSecs(ms) {
    return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

/** A percentage toned like the fight charts (pctTone), with an optional tooltip. */
function toneCell(v, tip) {
    const cls = { good: "pct-full", medium: "pct-part", high: "pct-none" }[pctTone(v)];
    return `<span class="pct ${cls}"${tip ? ` data-tip="${esc(tip)}"` : ""}>${esc(v)}%</span>`;
}

function naCell(tip, text) {
    return `<span class="pct pct-na"${tip ? ` data-tip="${esc(tip)}"` : ""}>${esc(text || "–")}</span>`;
}

function kpi(icon, label, value, sub, tone, valueTone, tip, tipSub) {
    return `<div class="kpi${tone ? ` tone-${tone}` : ""}"${tip ? ` data-tip="${esc(tip)}"` : ""}${tipSub ? ` data-tip-sub="${esc(tipSub)}"` : ""}>
      <div class="kicker icons">${hicon(icon, "")}${esc(label)}</div>
      <div class="kpi-v${valueTone ? ` ${valueTone}` : ""}">${value}${sub ? ` <small${sub.bad ? " class=\"bad\"" : ""}>· ${esc(sub.text)}</small>` : ""}</div>
    </div>`;
}

/** Thousands-separated number for the damage tables. */
function num(n) {
    return Math.round(n || 0).toLocaleString("de-DE");
}

const sumOf = (list, pick) => (list || []).reduce((n, x) => n + (Number(pick(x)) || 0), 0);

const avgOf = (list, pick) => ((list || []).length ? Math.round(sumOf(list, pick) / list.length) : 0);

module.exports = {
    iconUrl, classIconUrl, classCell, playerCard, pctCell, expBtn, tile, badge, LINE, ibtn, armoryButton, armoryLink, dlgClose, groupHead, detailDialog, whoList, whatList, metricCard, barCell, healBar, HEAL_BAR_HOW, barPct, yesNo, hicon, colHead, ICON_BY_NAME, iconTile, iconRow, classColorOf, pctTone, classIconName, fmtK, fmtSecs, toneCell, naCell, kpi, num, sumOf, avgOf,
};
