// Raid plan templates ("Raidplan-Vorlagen", docs/raidplan.md): a named layout the
// orga makes once ("Montags-Raid") and picks when an event's plan is made.
//
// { id, name, category, description, guildId, instanceIds, bosses, version, updatedAt }
//   guildId    "" = for every server, else the Discord server (event server) it is for
//   instanceIds the instances it covers; only their bosses can have a board
//   bosses     { [bossKey]: board } — the coarse layout WITHOUT players: placeholder
//              slots (tank 1..n, healer 1..n, dps, group n, free labels), raid marks,
//              zones, target rows, a note (raidplanBoard.js)
//
// A template is copied into an event's plan as a snapshot (raidplanStore.applyTemplate);
// changing or deleting it later never reaches a plan that already exists. Its own
// room maps live beside the default ones (raidplanStore, key t/<id>/<boss>) and
// go away with it.
const fs = require("fs");
const path = require("path");
const { instanceById } = require("../config/gameVersions");
const board = require("./raidplanBoard");
const planStore = require("./raidplanStore");
const besetzung = require("./raidplanBesetzung");
const inherit = require("./raidplanInherit");
const { str } = require("../utils/text");
const { isSnowflake, newId } = require("../utils/ids");

const DEFAULT_FILE = path.join(__dirname, "..", "..", "data", "settings", "raidplan-templates.json");
const LIMITS = { templates: 100, name: 40, category: 30, description: 200 };

let templateFile = DEFAULT_FILE;

/** Tests point the store at a file of their own. */
function useFile(file) {
    templateFile = file || DEFAULT_FILE;
}


function readAll() {
    try {
        const data = JSON.parse(fs.readFileSync(templateFile, "utf8"));
        return Array.isArray(data.templates) ? data.templates : [];
    } catch {
        return [];
    }
}

function writeAll(templates) {
    fs.mkdirSync(path.dirname(templateFile), { recursive: true });
    fs.writeFileSync(templateFile, JSON.stringify({ templates }, null, 2));
}

function normalize(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    return {
        id: str(r.id),
        name: str(r.name).slice(0, LIMITS.name),
        category: str(r.category).slice(0, LIMITS.category),
        description: str(r.description).slice(0, LIMITS.description),
        guildId: isSnowflake(str(r.guildId)) ? str(r.guildId) : "",
        instanceIds: [...new Set((Array.isArray(r.instanceIds) ? r.instanceIds : []).map(str).filter((i) => instanceById(i)))],
        // the raid type: its size (0 = the instances' default) and the Besetzung's role counts (null = derived from the type)
        size: Math.max(0, Math.min(besetzung.MAX_SIZE, Math.floor(Number(r.size) || 0))),
        counts: besetzung.cleanCounts(r.counts),
        bosses: r.bosses && typeof r.bosses === "object" ? r.bosses : {},
        version: Math.max(0, Math.floor(Number(r.version) || 0)),
        updatedAt: Number(r.updatedAt) || 0,
    };
}

/** All templates, by category then name. */
function listTemplates() {
    return readAll().map(normalize).filter((t) => t.id && t.name)
        .sort((a, b) => a.category.localeCompare(b.category, "de") || a.name.localeCompare(b.name, "de"));
}

function getTemplate(id) {
    const key = str(id);
    return key ? listTemplates().find((t) => t.id === key) || null : null;
}

/** The boss keys a template with these instances can have a board for. */
function bossKeysOf(instanceIds) {
    const keys = planStore.bossesForInstances(instanceIds).map((b) => b.key);
    // the template's own "Standard" board (the tank / healer basics every boss inherits, raidplanInherit.js)
    return keys.length > 0 ? [...keys, inherit.DEFAULTS_KEY] : keys;
}

/** Checks the descriptive fields; returns `{ value }` or `{ code: "invalid", error }`. */
function validate(input, { partial = false } = {}) {
    const body = input && typeof input === "object" ? input : {};
    const value = {};
    if (!partial || body.name !== undefined) {
        const name = str(body.name);
        if (!name) return { code: "invalid", error: "Der Name fehlt." };
        if (name.length > LIMITS.name) return { code: "invalid", error: `Der Name darf höchstens ${LIMITS.name} Zeichen haben.` };
        value.name = name;
    }
    for (const [field, max] of [["category", LIMITS.category], ["description", LIMITS.description]]) {
        if (body[field] === undefined) continue;
        const v = str(body[field]);
        if (v.length > max) return { code: "invalid", error: `${field === "category" ? "Die Kategorie" : "Die Beschreibung"} darf höchstens ${max} Zeichen haben.` };
        value[field] = v;
    }
    if (body.guildId !== undefined) {
        const g = str(body.guildId);
        if (g && !isSnowflake(g)) return { code: "invalid", error: "Ungültiger Server." };
        value.guildId = g;
    }
    if (body.size !== undefined) {
        const n = Math.floor(Number(body.size));
        if (!Number.isFinite(n) || n < 0 || n > besetzung.MAX_SIZE) return { code: "invalid", error: `Die Raidgröße muss zwischen 1 und ${besetzung.MAX_SIZE} liegen.` };
        value.size = n;
    }
    if (body.counts !== undefined) {
        if (body.counts !== null && (typeof body.counts !== "object" || Array.isArray(body.counts))) return { code: "invalid", error: "Die Besetzung hat ein ungültiges Format." };
        value.counts = body.counts;
    }
    if (body.instanceIds !== undefined) {
        if (!Array.isArray(body.instanceIds)) return { code: "invalid", error: "Die Instanzen haben ein ungültiges Format." };
        const ids = [...new Set(body.instanceIds.map(str))];
        if (ids.some((i) => !instanceById(i))) return { code: "invalid", error: "Unbekannte Instanz." };
        if (!ids.length) return { code: "invalid", error: "Wähle mindestens eine Instanz." };
        value.instanceIds = ids;
    }
    return { value };
}

/** Creates a template. Needs a name and at least one instance. Returns `{ template }` or `{ code, error }`. */
function createTemplate(input, { now = Date.now() } = {}) {
    const checked = validate(input);
    if (checked.error) return checked;
    if (!checked.value.instanceIds) return { code: "invalid", error: "Wähle mindestens eine Instanz." };
    const all = readAll();
    if (all.length >= LIMITS.templates) return { code: "invalid", error: `Höchstens ${LIMITS.templates} Vorlagen.` };
    const template = normalize({ ...checked.value, id: newId(), bosses: {}, version: 1, updatedAt: now });
    all.push(template);
    writeAll(all);
    return { template };
}

/**
 * Changes a template's fields and/or its boards. Saving `bosses` needs the
 * `version` that was read (a stale one is a `conflict`); boards of bosses the
 * template's instances do not have are dropped, everything on a board is cleaned
 * (no players in a template). Changing the instances drops the boards of bosses
 * that are no longer covered.
 */
function updateTemplate(id, input, { now = Date.now() } = {}) {
    const key = str(id);
    const all = readAll();
    const idx = all.findIndex((t) => t && t.id === key);
    if (idx === -1) return { code: "not_found", error: "Vorlage nicht gefunden." };
    const current = normalize(all[idx]);
    const body = input && typeof input === "object" ? input : {};
    const checked = validate(body, { partial: true });
    if (checked.error) return checked;
    const next = { ...current, ...checked.value };
    const keys = new Set(bossKeysOf(next.instanceIds));
    let bosses = Object.fromEntries(Object.entries(current.bosses).filter(([k]) => keys.has(k)));
    let dropped = 0;
    if (body.bosses !== undefined) {
        if (Number(body.version) !== current.version) return { code: "conflict", error: "Die Vorlage wurde inzwischen geändert. Bitte neu laden." };
        if (!body.bosses || typeof body.bosses !== "object" || Array.isArray(body.bosses)) return { code: "invalid", error: "Die Vorlage hat ein ungültiges Format." };
        bosses = {};
        for (const [k, raw] of Object.entries(body.bosses)) {
            if (!keys.has(k)) { dropped += 1; continue; }
            const r = board.cleanBoard(raw, { allowedUserIds: [], allowTokens: false });
            if (r.error) return r;
            dropped += r.dropped;
            if (board.boardHasContent(r.board)) bosses[k] = r.board;
        }
    }
    const saved = normalize({ ...next, bosses, version: current.version + (body.bosses !== undefined ? 1 : 0), updatedAt: now });
    all[idx] = saved;
    writeAll(all);
    return { template: saved, dropped };
}

/**
 * A copy of a template under a new id ("<name> (Kopie)"), with its boards (new ids on
 * every object) and its own room maps. Returns `{ template }` or `{ code, error }`.
 */
function duplicateTemplate(id, { now = Date.now() } = {}) {
    const source = getTemplate(id);
    if (!source) return { code: "not_found", error: "Vorlage nicht gefunden." };
    const all = readAll();
    if (all.length >= LIMITS.templates) return { code: "invalid", error: `Höchstens ${LIMITS.templates} Vorlagen.` };
    const suffix = " (Kopie)";
    const bosses = {};
    for (const [key, b] of Object.entries(source.bosses)) bosses[key] = board.reidBoard(b);
    const copy = normalize({
        ...source, id: newId(), name: source.name.slice(0, LIMITS.name - suffix.length) + suffix,
        bosses, version: 1, updatedAt: now,
    });
    all.push(copy);
    writeAll(all);
    for (const b of planStore.bossesForInstances(copy.instanceIds)) {
        const map = planStore.readMap(planStore.templateMapKey(source.id, b.key));
        if (map) planStore.saveMap(planStore.templateMapKey(copy.id, b.key), map.buffer);
    }
    return { template: copy };
}

/** Deletes a template and its own room maps. True when there was one. */
function deleteTemplate(id) {
    const key = str(id);
    const all = readAll();
    const template = all.find((t) => t && t.id === key);
    if (!template) return false;
    writeAll(all.filter((t) => t !== template));
    for (const b of planStore.bossesForInstances(normalize(template).instanceIds)) planStore.deleteMap(planStore.templateMapKey(key, b.key));
    return true;
}

module.exports = { useFile, LIMITS, listTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate, duplicateTemplate, bossKeysOf };
