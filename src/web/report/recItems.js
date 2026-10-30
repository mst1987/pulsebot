// The items behind a raider's gear finding: icon, quality, slot and what is
// wrong with it. Read from the roster entry (its gear issues joined with its
// armory), so the finding, the send dialog and the card head show the item
// itself instead of a cut-off text badge. Hovering an item's link gives the
// Wowhead tooltip with the item's own enchant and gems.
const { esc } = require("./layout");
const { wowheadItemLink, iconUrl } = require("./widgets");
const { SLOT_NAMES } = require("../../utils/logcheck/gear/gearIssues");

const QUALITY_COLOR = { 0: "#9d9d9d", 1: "#ffffff", 2: "#1eff00", 3: "#0070dd", 4: "#a335ee", 5: "#ff8000" };

/** Wowhead item link with enchant + gems so the tooltip shows the authoritative data (escaped, "" without a path). */
function wowheadItemUrl(it) {
    const params = [];
    if (it.enchant && it.enchant.enchantId) params.push(`ench=${encodeURIComponent(it.enchant.enchantId)}`);
    const gemIds = (it.gems || []).map((g) => g.id).filter(Boolean);
    if (gemIds.length) params.push(`gems=${gemIds.join(":")}`);
    return esc(wowheadItemLink(it.itemId, params));
}

/** What a kind of gear issue means, for the tooltip under the problem. */
const KIND_HINT = {
    noItem: "Der Slot war beim Pull leer.",
    noEnchant: "Der Slot lässt sich verzaubern, trägt aber nichts.",
    badEnchant: "Es gibt für diesen Slot eine deutlich bessere Verzauberung.",
    emptySocket: "Ein Sockel ohne Edelstein.",
    uncutGem: "Ein Rohstein im Sockel statt eines geschliffenen Edelsteins.",
    badGem: "Ein Edelstein unter der Qualität, die der Raid verlangt.",
    metaInactive: "Die Farben der übrigen Edelsteine reichen nicht, um den Meta-Edelstein zu aktivieren.",
};

const ENCHANT_ICON = "trade_engraving";
const GEM_ICON = "inv_misc_gem_01";

/** The problem as a short label with a capital first letter, counted when it repeats ("2× Leerer Sockel"). */
function problemText(it) {
    const label = String(it.label || "");
    const text = label ? label.charAt(0).toUpperCase() + label.slice(1) : "Problem";
    return it.count > 1 ? `${it.count}× ${text}` : text;
}

/** The icon beside the problem: the enchant scroll, the gem in question, nothing for an empty socket or slot. */
function problemIcon(it) {
    if (it.kind === "noEnchant" || it.kind === "badEnchant") return ENCHANT_ICON;
    if (it.kind === "badGem" || it.kind === "uncutGem" || it.kind === "metaInactive") return it.gemIcon || GEM_ICON;
    return "";
}

/** The gem a gem issue is about: the first flagged one, else the first gem of the item. */
function gemIconOf(arm, kind) {
    const gems = (arm && arm.gems) || [];
    const gem = (kind === "badGem" && gems.find((g) => g.bad)) || gems[0];
    return gem && gem.icon ? gem.icon : null;
}

/**
 * A raider's gear issues as items: one entry per item and kind of problem, a
 * repeated problem (two empty sockets) counted once. Fields: itemId, itemName,
 * icon, quality, slotName, kind, label, severity ("high" | "medium"), count,
 * href (escaped Wowhead link or "") and gemIcon.
 * @param {object} p  roster entry ({ issues, armory })
 * @param {Array} [issues]  the issues to use instead of p.issues
 */
function gearItemsOf(p, issues) {
    const armory = new Map(((p && p.armory) || []).map((a) => [String(a.itemId), a]));
    const groups = new Map();
    for (const is of issues || (p && p.issues) || []) {
        const id = is.itemId ? String(is.itemId) : "";
        const key = `${id || `slot-${is.slot}`}|${is.kind || is.label}`;
        const seen = groups.get(key);
        if (seen) {
            seen.count++;
            continue;
        }
        const arm = id ? armory.get(id) : null;
        groups.set(key, {
            itemId: id || null,
            itemName: is.itemName || (arm && arm.itemName) || SLOT_NAMES[is.slot] || "?",
            icon: is.icon || (arm && arm.icon) || null,
            quality: arm ? arm.quality : undefined,
            slotName: is.kind === "noItem" ? "" : (arm && arm.slotName) || SLOT_NAMES[is.slot] || "",
            kind: is.kind || "",
            label: is.label || "",
            severity: is.severity === "high" ? "high" : "medium",
            count: 1,
            href: arm ? wowheadItemUrl(arm) : id ? esc(wowheadItemLink(id)) : "",
            gemIcon: gemIconOf(arm, is.kind),
        });
    }
    return [...groups.values()];
}

/** The number of different items behind the issues (a slot without an item counts as one). */
function itemCount(items) {
    return new Set(items.map((it) => it.itemId || `slot-${it.itemName}`)).size;
}

function qualityOf(it) {
    return QUALITY_COLOR[it.quality] || "var(--line)";
}

/** The item's icon with the quality frame and the ✕ (missing) or ! (weak) mark. */
function itemIcon(it) {
    const tone = it.severity === "high" ? "bad" : "mid";
    const img = it.icon ? `<img src="${esc(iconUrl(it.icon))}" loading="lazy" alt="">` : "<span class=\"ri-none\"></span>";
    const mark = `<span class="ri-mark ${tone}" aria-hidden="true">${tone === "bad" ? "✕" : "!"}</span>`;
    return it.href
        ? `<a class="ri-icon" style="--q:${qualityOf(it)}" href="${it.href}" target="_blank" rel="noopener">${img}${mark}</a>`
        : `<span class="ri-icon" style="--q:${qualityOf(it)}">${img}${mark}</span>`;
}

/** One item line: icon, name (Wowhead tooltip on both), slot, and the problem with its icon. */
function itemRow(it) {
    const tone = it.severity === "high" ? "bad" : "mid";
    const name = it.href
        ? `<a class="ri-name" style="--q:${qualityOf(it)}" href="${it.href}" target="_blank" rel="noopener">${esc(it.itemName)}</a>`
        : `<span class="ri-name" style="--q:${qualityOf(it)}">${esc(it.itemName)}</span>`;
    const pic = problemIcon(it);
    const lead = pic ? `<img src="${esc(iconUrl(pic))}" loading="lazy" alt="">` : it.kind === "emptySocket" ? "<span class=\"ri-sock\" aria-hidden=\"true\"></span>" : "";
    const hint = KIND_HINT[it.kind] || "";
    return `<div class="rec-item">${itemIcon(it)}<span class="ri-main">${name}${it.slotName ? `<span class="ri-slot">${esc(it.slotName)}</span>` : ""}</span><span class="ri-prob ${tone}"${hint ? ` data-tip="${esc(problemText(it))}" data-tip-sub="${esc(hint)}"` : ""}>${lead}${esc(problemText(it))}</span></div>`;
}

/** The item lines of a gear finding. */
function itemRows(items) {
    return items.map(itemRow).join("");
}

/**
 * Up to `max` small item icons for a badge in the card head, one per item,
 * each with its own tooltip (item name, then what is wrong with it).
 */
function miniIcons(items, max = 3) {
    const byItem = new Map();
    for (const it of items) {
        const key = it.itemId || `slot-${it.itemName}`;
        if (!byItem.has(key)) byItem.set(key, []);
        byItem.get(key).push(it);
    }
    const icons = [...byItem.values()].slice(0, max).map((list) => {
        const it = list[0];
        const img = it.icon ? esc(iconUrl(it.icon)) : esc(iconUrl(""));
        return `<img class="mini" style="--q:${qualityOf(it)}" src="${img}" loading="lazy" alt="" data-tip="${esc(it.itemName)}" data-tip-sub="${esc(list.map(problemText).join(" · "))}">`;
    }).join("");
    return icons ? `<span class="minis">${icons}</span>` : "";
}

module.exports = { QUALITY_COLOR, wowheadItemUrl, gearItemsOf, itemCount, itemRows, miniIcons, problemText };
