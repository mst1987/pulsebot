// Switching a raid category to another game version (#738) — a new section,
// not a re-reading of the past.
//
//   switchPreview()            what the confirmation dialog in Einstellungen →
//                              Spielversion lists: the coming raids that keep the
//                              old version, the series and the default template
//                              whose template no longer fits, the templates that do
//   versionSwitches()          which categories a settings save switches, and the
//                              section history (config.categoryEras) after it
//   applySeriesFix()           the dialog's choice for a series: pause it, or give
//                              it a template of the new version
//   onCategoryVersionSwitch()  the hook for what else follows a switch (the roster
//                              of #739): called once per switched category after
//                              the settings were saved
//
// Nothing here moves a stored raid: every raid keeps its stored version (#737),
// a coming raid of the old version stays one (the orga may cancel it).
const { rulesFor } = require("../../config/gameVersions");
const { mainVersionFor, knownVersion, versionOfEvent } = require("./mainVersion");
const { erasOf, switchEras } = require("./categoryEras");
const eventStore = require("../../stores/eventStore");
const { listRaidEvents } = require("../../stores/raidEventStore");
const seriesStore = require("../../stores/eventSeriesStore");

/** `{ id, label, short }` of a version, for the dialog. */
function versionInfo(id) {
    const rules = rulesFor(id) || {};
    return { id, label: rules.label || id, short: rules.short || rules.label || id };
}

/**
 * The category's raids from now on that are not of `toVersion` — they keep
 * their version after the switch. Own events not cancelled, Raid-Helper
 * snapshots the scan has seen; soonest first.
 */
function upcomingOtherVersion(categoryId, toVersion, { config, now = Date.now() } = {}) {
    const nowSec = Math.floor(now / 1000);
    const seen = new Set();
    const out = [];
    const push = (e, source) => {
        if (!e || !e.id || seen.has(e.id) || String(e.categoryId || "") !== categoryId) return;
        if (!(Number(e.startTime) >= nowSec)) return;
        seen.add(e.id);
        const versionId = versionOfEvent(e, { config });
        if (versionId === toVersion) return;
        out.push({ id: e.id, title: e.title || "", startTime: Number(e.startTime), versionId, source });
    };
    for (const e of eventStore.listEvents("")) if (e.status !== "cancelled") push(e, "eventhelper");
    for (const e of listRaidEvents("")) push(e, "raidhelper");
    return out.sort((a, b) => a.startTime - b.startTime);
}

/** `{ id, name, versionId }` of a template, or null. */
function templateInfo(template) {
    return template ? { id: template.id, name: template.name || "", versionId: knownVersion(template.versionId) } : null;
}

/**
 * What switching `categoryId` to `versionId` means — the confirmation dialog's
 * content. `listTemplates`/`getTemplate` are the settings store's (handed in,
 * so this module needs no settingsStore — it would close a require cycle).
 */
function switchPreview({ categoryId, versionId, config, listTemplates, now = Date.now() }) {
    const cat = String(categoryId || "").trim();
    const toVersion = knownVersion(versionId);
    const fromVersion = mainVersionFor({ categoryId: cat, config });
    const templates = typeof listTemplates === "function" ? listTemplates() || [] : [];
    const byId = new Map(templates.map((t) => [t.id, t]));
    const fits = (t) => !!t && knownVersion(t.versionId) === toVersion;

    const defaultId = String(((config && config.categoryRaidTemplate) || {})[cat] || "");
    const defaultTemplate = defaultId ? templateInfo(byId.get(defaultId)) : null;
    const stored = seriesStore.getSeries(cat);
    let series = null;
    if (stored) {
        const own = String(stored.raidTemplateId || "");
        const template = templateInfo(byId.get(own || defaultId));
        series = {
            enabled: stored.enabled !== false,
            usesDefault: !own,
            template,
            fits: !template || template.versionId === toVersion,
        };
    }
    return {
        categoryId: cat,
        from: versionInfo(fromVersion),
        to: versionInfo(toVersion || fromVersion),
        switching: !!toVersion && toVersion !== fromVersion,
        eras: erasOf(cat, { config }),
        upcoming: toVersion ? upcomingOtherVersion(cat, toVersion, { config, now }) : [],
        series,
        defaultTemplate: defaultTemplate ? { ...defaultTemplate, fits: fits(byId.get(defaultId)) } : null,
        templates: templates.filter(fits).map((t) => ({ id: t.id, name: t.name || "" })),
    };
}

/**
 * The categories a save switches and the history after it (pure apart from
 * the version lookups). A category switches when its version in the new map
 * differs from the one it played before and it was active before or already
 * has sections — a category switched on just now only gets its first version.
 * @param {{ before: object, categoryVersion: Record<string, string>, nameOf?: (id: string) => string, now?: number }} p
 * @returns {{ switches: { categoryId: string, fromVersion: string, toVersion: string, at: number, name: string }[], categoryEras: object | null }}
 */
function versionSwitches({ before, categoryVersion, nameOf = () => "", now = Date.now() }) {
    const prev = before || {};
    const active = new Set((prev.categoryIds || []).map(String));
    const storedEras = prev.categoryEras && typeof prev.categoryEras === "object" ? prev.categoryEras : {};
    const switches = [];
    const eras = { ...storedEras };
    for (const [categoryId, raw] of Object.entries(categoryVersion || {})) {
        const toVersion = knownVersion(raw);
        if (!toVersion) continue;
        if (!active.has(categoryId) && !(storedEras[categoryId] || []).length) continue;
        const fromVersion = mainVersionFor({ categoryId, config: prev });
        if (fromVersion === toVersion) continue;
        const name = String(nameOf(categoryId) || "");
        eras[categoryId] = switchEras(storedEras[categoryId] || [], { fromVersion, toVersion, at: now, name });
        switches.push({ categoryId, fromVersion, toVersion, at: now, name });
    }
    return { switches, categoryEras: switches.length ? eras : null };
}

/**
 * The dialog's fix for a category's series after a switch: "pause" switches
 * it off, a template id of the new version becomes its template. Anything else
 * (no series, unknown or unfitting template) changes nothing.
 * @returns {"" | "paused" | "template"}
 */
function applySeriesFix({ categoryId, fix, toVersion, getTemplate, user = null, now = Date.now() }) {
    const series = seriesStore.getSeries(categoryId);
    const choice = String(fix || "").trim();
    if (!series || !choice) return "";
    const stamp = { updatedAt: now, updatedBy: (user && user.id) || "", updatedByName: (user && (user.name || user.username)) || "" };
    if (choice === "pause") {
        seriesStore.saveSeries({ ...series, enabled: false, ...stamp });
        return "paused";
    }
    const template = typeof getTemplate === "function" ? getTemplate(choice) : null;
    if (!template || knownVersion(template.versionId) !== toVersion) return "";
    seriesStore.saveSeries({ ...series, raidTemplateId: template.id, ...stamp });
    return "template";
}

// ---- the hook for what follows a switch (#739 the roster, #744 the names) ----

const listeners = new Set();

/**
 * Register `fn(sw, ctx)`, called once per switched category after the settings
 * were saved: `sw` = `{ categoryId, fromVersion, toVersion, at, name }`, `ctx` =
 * `{ config, user, fixes }` (the saved config; `fixes` = the dialog's choices
 * per category, `{ [categoryId]: { series, roster } }`). A listener may answer
 * a plain object - it is merged into that switch's entry of the save's answer
 * (#739: `{ roster: … }`). Returns the unregister function.
 */
function onCategoryVersionSwitch(fn) {
    if (typeof fn !== "function") return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/**
 * Call every listener for every switch; a failing one is logged and never
 * fails the save. Returns the switches with what the listeners answered.
 */
async function notifyCategoryVersionSwitch(switches, ctx = {}, { warn = console.error } = {}) {
    const out = [];
    for (const sw of switches || []) {
        let entry = { ...sw };
        for (const fn of [...listeners]) {
            try {
                const answer = await fn(sw, ctx);
                if (answer && typeof answer === "object" && !Array.isArray(answer)) entry = { ...entry, ...answer };
            } catch (e) {
                warn(`[categorySwitch] ${sw.categoryId} ${sw.fromVersion} → ${sw.toVersion}: ${e.message}`);
            }
        }
        out.push(entry);
    }
    return out;
}

module.exports = {
    switchPreview, versionSwitches, applySeriesFix, upcomingOtherVersion, onCategoryVersionSwitch, notifyCategoryVersionSwitch,
};
