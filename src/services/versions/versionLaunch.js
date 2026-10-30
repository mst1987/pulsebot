// "Neue Version starten" (#745, Einstellungen → Spielversion): the checklist
// for the day a guild starts a new game version (WoW Forever beside or after
// TBC). Modelled on the Raid-Helper switch-over (web/events/raidhelperRetirement.js),
// but per target version and without a switch at its end — every step it checks
// is done where it belongs (Kategorien, Spielversion, Raid-Vorlagen, Serien,
// Roster, Gildenbanken, Discord-Server); this only says what is still open.
//
// Computed on every read from the real data. Only the items nothing can check
// (VERSION_LAUNCH_MANUAL in stores/configSchema.js: the archive export, the loot
// addon on the new client, the raid lists and reminders, and the backup on an
// instance that takes none) are marked by hand, stored per target version in
// `config.versionLaunch` = { [versionId]: { [itemId]: { at, byName } } }.
//
// Every item: { id, kind: "auto" | "manual", status: "done" | "open",
// optional, mark, ...its data }. The client words it (lib/settings/versionLaunch.ts,
// texts settings.versionLaunch.*) and links to where it is fixed.
//
// `buildChecklist(inputs)` is pure (the tests drive it item by item);
// `loadChecklist(versionId)` gathers the inputs, each best-effort.
const { getConfig, saveConfig, listRaidTemplates } = require("../../stores/settingsStore");
const { VERSION_LAUNCH_MANUAL } = require("../../stores/configSchema");
const { VERSIONS, rulesFor, instance } = require("../../config/gameVersions");
const { knownVersion } = require("./mainVersion");
const { featureState } = require("./versionCapabilities");
const { normalizeBlock, versionSettingsOf } = require("../../stores/versionSettingsSchema");
const rosterStore = require("../../stores/rosterStore");
const seriesStore = require("../../stores/eventSeriesStore");
const bankStore = require("../../stores/guildBankStockStore");
const guildRoles = require("../discord/roles/guildRoles");
const { listKnownCategories } = require("../categories/categoryNames");
const backupStatus = require("../backup/backupStatus");
const { backupEnabled } = require("../backup/backupConfig");

/** The items in the order the card shows them (the runbook's order, docs/game-versions.md). */
const ITEM_IDS = Object.freeze([
    "backup", "export", "categories", "versionSettings", "templates", "series", "rosters", "guildBank", "lootAddon", "talk", "mainVersion",
]);
/** Not counted in "x / y": only when the old version ends for good. */
const OPTIONAL = new Set(["mainVersion"]);

/**
 * The fields of the version settings the checklist looks at, the feature each
 * one serves (config/versionFeatures.js) and when it counts as filled.
 */
const FIELDS = Object.freeze([
    { field: "realm", feature: "armory", filled: (b) => !!(b.blizzardRegion && b.blizzardRealmSlug && b.blizzardNamespace) },
    { field: "armory", feature: "armory", filled: (b) => !!b.armoryUrlTemplate },
    { field: "wcl", feature: "logcheck", filled: (b) => !!b.wclUrlTemplate },
    { field: "wowhead", feature: "wowheadLinks", filled: (b) => !!b.wowheadPath },
    { field: "softres", feature: "softres", filled: (b) => !!b.softresEdition },
    { field: "raidsheet", feature: "raidSheet", filled: (b) => !!b.raidsheetId },
]);
// A feature is "not possible" for one of these only because a field is empty —
// that field is then still needed. Every other reason (the rule set has no data
// for it) makes an empty field fine.
const SETTINGS_REASONS = new Set(["no_site", "no_softres_edition", "armory_not_configured", "no_wowhead_path"]);

const str = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const isMap = (v) => v && typeof v === "object" && !Array.isArray(v);

/** A store read that may fail (a broken file): its answer, else the fallback — the checklist never throws. */
function safely(read, fallback) {
    try {
        const value = read();
        return value === undefined || value === null ? fallback : value;
    } catch {
        return fallback;
    }
}

/**
 * Each field of a version's settings block: "set", "missing" (needed and
 * empty) or "notNeeded" (empty, but its feature is switched off — `reason`
 * "disabled" — or not possible for the version anyway, `reason` the
 * capability's code). Pure apart from the capability read with the config handed in.
 */
function fieldStates(versionId, config) {
    const map = isMap(config.versionSettings) ? config.versionSettings : versionSettingsOf(config);
    const block = normalizeBlock(map[versionId]);
    return FIELDS.map(({ field, feature, filled }) => {
        if (filled(block)) return { field, feature, state: "set", reason: "" };
        const cap = featureState(versionId, feature, { config });
        // switched off: the capability names "disabled" only for a possible feature, `enabled` always says it
        if (cap.reason === "disabled" || (!cap.enabled && !/^unknown_/.test(cap.reason))) return { field, feature, state: "notNeeded", reason: "disabled" };
        if (!cap.possible && !SETTINGS_REASONS.has(cap.reason)) return { field, feature, state: "notNeeded", reason: cap.reason };
        return { field, feature, state: "missing", reason: "" };
    });
}

const done = (ok) => (ok ? "done" : "open");

function backupItem({ backup, marks }) {
    if (!backup) return { id: "backup", kind: "manual", status: done(!!marks.backup), mark: marks.backup || null };
    const { snapshot, offsite } = backup;
    return {
        id: "backup",
        kind: "auto",
        status: done(snapshot.light === "ok" && offsite.light === "ok"),
        mark: null,
        snapshotAt: snapshot.at || 0,
        offsiteAt: offsite.at || 0,
        snapshotLight: snapshot.light,
        offsiteLight: offsite.light,
    };
}

function manualItem(id, { marks }) {
    return { id, kind: "manual", status: done(!!marks[id]), mark: marks[id] || null };
}

function categoriesItem({ categories, versionId }) {
    const missing = categories.filter((c) => !c.versionId).map(({ id, name }) => ({ id, name }));
    return {
        id: "categories",
        kind: "auto",
        status: done(categories.length > 0 && !missing.length),
        mark: null,
        total: categories.length,
        missing,
        target: categories.filter((c) => c.versionId === versionId).map(({ id, name }) => ({ id, name })),
    };
}

function versionSettingsItem({ fields }) {
    return {
        id: "versionSettings",
        kind: "auto",
        status: done(!fields.some((f) => f.state === "missing")),
        mark: null,
        fields: fields.map(({ field, state, reason }) => ({ field, state, reason })),
    };
}

function templatesItem({ templates }) {
    const incomplete = [...new Set(templates.flatMap((t) => t.incomplete))];
    return {
        id: "templates",
        kind: "auto",
        status: done(templates.length > 0),
        mark: null,
        count: templates.length,
        names: templates.map((t) => t.name),
        incomplete,
    };
}

function seriesItem({ seriesProblems, targetCategories }) {
    return {
        id: "series",
        kind: "auto",
        status: done(!seriesProblems.length),
        mark: null,
        categories: targetCategories.length,
        problems: seriesProblems,
    };
}

function rostersItem({ rosterProblems, targetCategories }) {
    return {
        id: "rosters",
        kind: "auto",
        status: done(targetCategories.length > 0 && !rosterProblems.length),
        mark: null,
        categories: targetCategories.length,
        problems: rosterProblems,
    };
}

function guildBankItem({ banks }) {
    return {
        id: "guildBank",
        kind: "auto",
        status: done(banks.some((b) => b.assigned)),
        mark: null,
        banks,
    };
}

function mainVersionItem({ versionId, mainVersion, hideOtherVersions }) {
    return {
        id: "mainVersion",
        kind: "auto",
        status: done(mainVersion === versionId && hideOtherVersions),
        mark: null,
        mainVersion,
        isMain: mainVersion === versionId,
        hidden: !!hideOtherVersions,
    };
}

/**
 * The checklist from its inputs (pure).
 * @param {{ versionId: string, marks: Record<string, { at: number, byName: string }>,
 *   backup: null | { snapshot: { light, at }, offsite: { light, at } },
 *   categories: { id, name, versionId }[], fields: { field, state, reason }[],
 *   templates: { id, name, incomplete: string[] }[], targetCategories: { id, name }[],
 *   seriesProblems: { categoryId, name, kind: "series"|"default", template }[],
 *   rosterProblems: { categoryId, name, rosterId, problems: string[] }[],
 *   banks: { key, guild, realm, assigned }[], mainVersion: string, hideOtherVersions: boolean }} inputs
 */
function buildChecklist(inputs) {
    const i = { marks: {}, categories: [], fields: [], templates: [], targetCategories: [], seriesProblems: [], rosterProblems: [], banks: [], ...inputs };
    const byId = {
        backup: () => backupItem(i),
        export: () => manualItem("export", i),
        categories: () => categoriesItem(i),
        versionSettings: () => versionSettingsItem(i),
        templates: () => templatesItem(i),
        series: () => seriesItem(i),
        rosters: () => rostersItem(i),
        guildBank: () => guildBankItem(i),
        lootAddon: () => manualItem("lootAddon", i),
        talk: () => manualItem("talk", i),
        mainVersion: () => mainVersionItem(i),
    };
    const items = ITEM_IDS.map((id) => ({ ...byId[id](), optional: OPTIONAL.has(id) }));
    const counted = items.filter((it) => !it.optional);
    const rules = rulesFor(i.versionId) || {};
    return {
        versionId: i.versionId,
        label: rules.label || i.versionId,
        short: rules.short || rules.label || i.versionId,
        items,
        done: counted.filter((it) => it.status === "done").length,
        total: counted.length,
    };
}

/** The Discord names of the servers' categories ("" when unknown — the id still says which). */
function categoryNames(config) {
    const names = new Map();
    try {
        for (const guildId of guildRoles.eventGuildIds(config)) {
            for (const c of listKnownCategories(guildId) || []) if (c && !names.has(c.id)) names.set(c.id, c.name || "");
        }
    } catch {
        // a name is a courtesy
    }
    return names;
}

/**
 * The version the card opens on when none is asked for: one a category plays
 * that is not the main version, else the newest other version (the rule sets'
 * last), else the main one.
 */
function defaultTarget(config) {
    const main = knownVersion(config.mainVersion) || VERSIONS[0].id;
    const played = Object.values(isMap(config.categoryVersion) ? config.categoryVersion : {}).map(knownVersion).filter((v) => v && v !== main);
    const others = VERSIONS.filter((v) => v.id !== main);
    return played[0] || (others.length ? others[others.length - 1].id : main);
}

/** What is wrong with a category's roster in the target version: [] when nothing. */
function rosterProblemsOf(roster) {
    if (!roster) return ["missing"];
    const out = [];
    if (rosterStore.isClosed(roster)) out.push("closed");
    if (!roster.roleIds.length) out.push("noRoles");
    if (!roster.managers.roleIds.length && !roster.managers.userIds.length) out.push("noManagers");
    return out;
}

/** The backup's two parts that matter here, or null where this instance takes none (or the reader may not see it). */
function backupParts(withBackup) {
    if (!withBackup || !backupEnabled()) return null;
    try {
        const parts = backupStatus.readParts().parts || [];
        const part = (key) => parts.find((p) => p.key === key) || { light: "none", at: 0 };
        return { snapshot: part("snapshot"), offsite: part("offsite") };
    } catch {
        return null;
    }
}

/**
 * Gather the inputs and build the checklist of one target version. Never throws.
 * @param {string} [versionId]  the target; unknown or missing = defaultTarget()
 * @param {{ config?: object, withBackup?: boolean }} [opts]  `withBackup`: the reader is a full admin
 */
function loadChecklist(versionId, { config = getConfig(), withBackup = false } = {}) {
    const target = knownVersion(versionId) || defaultTarget(config);
    const names = categoryNames(config);
    const catVersions = isMap(config.categoryVersion) ? config.categoryVersion : {};
    const categories = (Array.isArray(config.categoryIds) ? config.categoryIds : []).map(str).filter(Boolean)
        .map((id) => ({ id, name: names.get(id) || "", versionId: knownVersion(catVersions[id]) }));
    const targetCategories = categories.filter((c) => c.versionId === target).map(({ id, name }) => ({ id, name }));

    const allTemplates = safely(() => listRaidTemplates(), []);
    const templateById = new Map(allTemplates.map((t) => [t.id, t]));
    const templates = allTemplates.filter((t) => knownVersion(t.versionId) === target).map((t) => ({
        id: t.id,
        name: t.name || t.id,
        incomplete: (t.instanceIds || []).map((id) => instance(target, id)).filter((inst) => inst && inst.status === "incomplete").map((inst) => inst.name),
    }));

    // Series and default templates of the target's categories (#738): a template of another version creates no event.
    const defaults = isMap(config.categoryRaidTemplate) ? config.categoryRaidTemplate : {};
    const series = safely(() => seriesStore.listSeries(), {});
    const misfit = (templateId) => {
        const tpl = templateById.get(str(templateId));
        return tpl && knownVersion(tpl.versionId) && knownVersion(tpl.versionId) !== target ? tpl : null;
    };
    const seriesProblems = [];
    for (const cat of targetCategories) {
        const def = misfit(defaults[cat.id]);
        if (def) seriesProblems.push({ categoryId: cat.id, name: cat.name, kind: "default", template: def.name || def.id });
        const s = series[cat.id];
        if (s && s.enabled !== false) {
            const tpl = misfit(s.raidTemplateId || defaults[cat.id]);
            if (tpl) seriesProblems.push({ categoryId: cat.id, name: cat.name, kind: "series", template: tpl.name || tpl.id });
        }
    }

    const rosterProblems = [];
    for (const cat of targetCategories) {
        const roster = safely(() => rosterStore.rosterForCategory(cat.id, target), null);
        const problems = rosterProblemsOf(roster);
        if (problems.length) rosterProblems.push({ categoryId: cat.id, name: cat.name, rosterId: roster ? roster.id : "", problems });
    }

    const banks = safely(() => bankStore.listBanks(), []).filter((b) => b.gameVersion === target)
        .map((b) => ({ key: b.key, guild: b.guild, realm: b.realm, assigned: !!str(b.guildId) }));

    const marks = (isMap(config.versionLaunch) && config.versionLaunch[target]) || {};
    return buildChecklist({
        versionId: target,
        marks,
        backup: backupParts(withBackup),
        categories,
        fields: fieldStates(target, config),
        templates,
        targetCategories,
        seriesProblems,
        rosterProblems,
        banks,
        mainVersion: knownVersion(config.mainVersion) || VERSIONS[0].id,
        hideOtherVersions: config.hideOtherVersions === true,
    });
}

/**
 * Mark a manual item done (or open again) for a target version.
 * @returns {{ error?: string, code?: string, config?: object }}
 */
function setManualMark(versionId, itemId, isDone, { byName = "", now = Date.now(), config = getConfig() } = {}) {
    const target = knownVersion(versionId);
    if (!target) return { code: "invalid", error: "Unbekannte Spielversion." };
    if (!VERSION_LAUNCH_MANUAL.includes(str(itemId))) return { code: "invalid", error: "Dieser Punkt wird aus den Daten berechnet und lässt sich nicht von Hand abhaken." };
    const all = isMap(config.versionLaunch) ? { ...config.versionLaunch } : {};
    const marks = { ...(all[target] || {}) };
    if (isDone) marks[itemId] = { at: now, byName: str(byName).slice(0, 100) };
    else delete marks[itemId];
    all[target] = marks;
    return { config: saveConfig({ versionLaunch: all }) };
}

module.exports = { buildChecklist, loadChecklist, setManualMark, fieldStates, defaultTarget, rosterProblemsOf, ITEM_IDS, FIELDS };
