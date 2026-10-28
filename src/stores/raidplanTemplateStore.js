// Raid plan templates ("Raidplan-Vorlagen", docs/raidplan.md): a named layout the
// orga makes once ("Montags-Raid") and picks when an event's plan is made.
//
// { id, serverId, originId, name, category, description, guildId, versionId, instanceIds, bosses, version, updatedAt }
//   serverId   the Discord server the template belongs to (#945): the library is per server, a template is read and
//              written only through its own server; an entry without one is an old global entry (never listed, the
//              start copies it onto every server, migrateToServers)
//   originId   the id of the global template this one was copied from (#945, "" = made on this server): a plan that
//              still names the old id finds its own server's copy through it
//   versionId  the game version (#544): its instances only; an event is offered the templates of its own version
//   guildId    "" = for every server, else the Discord server (raid server) it is for
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
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");
const { instanceById, rulesFor, LEGACY_VERSION } = require("../config/gameVersions");
const board = require("../services/raidplan/raidplanBoard");
const planStore = require("./raidplanStore");
const besetzung = require("../services/raidplan/raidplanBesetzung");
const inherit = require("../services/raidplan/raidplanInherit");
const { str } = require("../utils/text");
const { isSnowflake, newId } = require("../utils/ids");

const DEFAULT_FILE = settingsPath("raidplan-templates.json");
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const LIMITS = { templates: 100, name: 40, category: 30, description: 200 };


const store = createJsonStore({
    file: DEFAULT_FILE,
    defaults: () => [],
    normalize: (data) => (Array.isArray(data.templates) ? data.templates : []),
});

/** Tests point the store at a file of their own; null = the default again. */
const useFile = store.useFile;

function readAll() {
    return store.read();
}

function writeAll(templates) {
    store.write({ templates });
}

/**
 * The game version of a stored template: its own when known, else the version of its first instance, else TBC (every
 * template before #544 was a TBC one; settingsMigration writes it down once).
 */
function versionOf(r) {
    if (rulesFor(str(r.versionId))) return str(r.versionId);
    const first = (Array.isArray(r.instanceIds) ? r.instanceIds : []).map((i) => instanceById(str(i))).find(Boolean);
    return first ? first.versionId : LEGACY_VERSION;
}

function normalize(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    return {
        id: str(r.id),
        serverId: isSnowflake(str(r.serverId)) ? str(r.serverId) : "",
        originId: ID_RE.test(str(r.originId)) ? str(r.originId) : "",
        name: str(r.name).slice(0, LIMITS.name),
        category: str(r.category).slice(0, LIMITS.category),
        description: str(r.description).slice(0, LIMITS.description),
        guildId: isSnowflake(str(r.guildId)) ? str(r.guildId) : "",
        versionId: versionOf(r),
        instanceIds: [...new Set((Array.isArray(r.instanceIds) ? r.instanceIds : []).map(str).filter((i) => instanceById(i)))],
        // the raid type: its size (0 = the instances' default) and the Besetzung's role counts (null = derived from the type)
        size: Math.max(0, Math.min(besetzung.MAX_SIZE, Math.floor(Number(r.size) || 0))),
        counts: besetzung.cleanCounts(r.counts),
        bosses: r.bosses && typeof r.bosses === "object" ? r.bosses : {},
        version: Math.max(0, Math.floor(Number(r.version) || 0)),
        updatedAt: Number(r.updatedAt) || 0,
    };
}

/** The server id a call names, "" when it is none (fail closed: no server, no templates). */
function serverKey(serverId) {
    const key = str(serverId);
    return isSnowflake(key) ? key : "";
}

/** The templates of one server, by category then name; [] without a server. */
function listTemplates(serverId) {
    const server = serverKey(serverId);
    if (!server) return [];
    return readAll().map(normalize).filter((t) => t.id && t.name && t.serverId === server)
        .sort((a, b) => a.category.localeCompare(b.category, "de") || a.name.localeCompare(b.name, "de"));
}

/**
 * A template of the server: by its id, else the copy made from the global template of that id (`originId`, #945 - a
 * plan made before the library was per server names the old id). null on another server.
 */
function getTemplate(serverId, id) {
    const key = str(id);
    if (!key) return null;
    const list = listTemplates(serverId);
    return list.find((t) => t.id === key) || list.find((t) => t.originId === key) || null;
}

/** The index of a template of the server in the raw list, -1 when it has none of that id. */
function indexOn(all, serverId, id) {
    const server = serverKey(serverId);
    const key = str(id);
    if (!server || !key) return -1;
    return all.findIndex((t) => t && t.id === key && str(t.serverId) === server);
}

/** How many templates the server has (the limit counts per server). */
function countOn(all, server) {
    return all.filter((t) => t && str(t.serverId) === server).length;
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
    if (body.versionId !== undefined) {
        if (!rulesFor(str(body.versionId))) return { code: "invalid", error: "Unbekannte Spielversion." };
        value.versionId = str(body.versionId);
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

/** An error when an instance of the template belongs to another game version than the template, else null. */
function versionMismatch(versionId, instanceIds) {
    if (!instanceIds.every((i) => (instanceById(i) || {}).versionId === versionId)) return { code: "invalid", error: "Die Instanzen gehören nicht zur Spielversion der Vorlage." };
    return null;
}

/** Creates a template. Needs a name and at least one instance. Returns `{ template }` or `{ code, error }`. */
function createTemplate(serverId, input, { now = Date.now() } = {}) {
    const server = serverKey(serverId);
    if (!server) return { code: "invalid", error: "Kein Discord-Server." };
    const checked = validate(input);
    if (checked.error) return checked;
    if (!checked.value.instanceIds) return { code: "invalid", error: "Wähle mindestens eine Instanz." };
    const versionId = checked.value.versionId || versionOf({ instanceIds: checked.value.instanceIds });
    const mismatch = versionMismatch(versionId, checked.value.instanceIds);
    if (mismatch) return mismatch;
    const all = readAll();
    if (countOn(all, server) >= LIMITS.templates) return { code: "invalid", error: `Höchstens ${LIMITS.templates} Vorlagen.` };
    const template = normalize({ ...checked.value, versionId, id: newId(), serverId: server, bosses: {}, version: 1, updatedAt: now });
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
function updateTemplate(serverId, id, input, { now = Date.now() } = {}) {
    const all = readAll();
    const idx = indexOn(all, serverId, id);
    if (idx === -1) return { code: "not_found", error: "Vorlage nicht gefunden." };
    const current = normalize(all[idx]);
    const body = input && typeof input === "object" ? input : {};
    const checked = validate(body, { partial: true });
    if (checked.error) return checked;
    const next = { ...current, ...checked.value };
    if (checked.value.versionId !== undefined || checked.value.instanceIds !== undefined) {
        const mismatch = versionMismatch(next.versionId, next.instanceIds);
        if (mismatch) return mismatch;
    }
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
function duplicateTemplate(serverId, id, { now = Date.now() } = {}) {
    const all = readAll();
    const idx = indexOn(all, serverId, id);
    if (idx === -1) return { code: "not_found", error: "Vorlage nicht gefunden." };
    const source = normalize(all[idx]);
    if (countOn(all, source.serverId) >= LIMITS.templates) return { code: "invalid", error: `Höchstens ${LIMITS.templates} Vorlagen.` };
    const suffix = " (Kopie)";
    const bosses = {};
    for (const [key, b] of Object.entries(source.bosses)) bosses[key] = board.reidBoard(b);
    const copy = normalize({
        ...source, id: newId(), originId: "", name: source.name.slice(0, LIMITS.name - suffix.length) + suffix,
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

/** Deletes a template of the server and its own room maps. True when there was one. */
function deleteTemplate(serverId, id) {
    const all = readAll();
    const idx = indexOn(all, serverId, id);
    if (idx === -1) return false;
    const template = all[idx];
    const rest = all.filter((t) => t !== template);
    writeAll(rest);
    // a map key is shared only while an old global entry of the same id is still on disk (a failed migration): keep it then
    const key = str(template.id);
    if (!rest.some((t) => t && t.id === key)) {
        for (const b of planStore.bossesForInstances(normalize(template).instanceIds)) planStore.deleteMap(planStore.templateMapKey(key, b.key));
    }
    return true;
}

/**
 * One-off upgrade at start (#544, settingsMigration.js): a template stored without `versionId` gets the one it is read
 * with (its instances' version, TBC for all of them so far). Idempotent. Returns how many templates changed.
 */
function migrateVersions() {
    const all = readAll();
    let changed = 0;
    const next = all.map((t) => {
        if (!t || typeof t !== "object" || rulesFor(str(t.versionId))) return t;
        changed += 1;
        return { ...t, versionId: versionOf(t) };
    });
    if (changed) writeAll(next);
    return changed;
}

/**
 * One-off upgrade at start (#945, settingsMigration.js): the library is per server. Every old global template (no
 * `serverId`) is copied onto each server in `serverIds` (an old one made for one listed server - its `guildId` -
 * onto that one only). The first copy keeps the id (its room maps stay where they are), the others get a new id, the
 * old one as `originId` and a copy of the room maps; from then on the copies are independent.
 * Idempotent: a server that already has a template of that id or origin gets no second copy. The room maps are derived
 * from the stored copies on every run (a copy with an `originId` whose map is missing while the origin has one), so a
 * run that stopped after writing the copies is completed by the next. The file is backed up once (`<file>.pre-945`)
 * before the first write; the global entries go only after the copies and their maps were read back from disk, else
 * they stay (never listed) and the next start tries again.
 * @param {string[]} serverIds the servers, the main one first
 * @returns {string[]} log lines
 */
function migrateToServers(serverIds) {
    const servers = [...new Set((Array.isArray(serverIds) ? serverIds : []).map(str).filter(isSnowflake))];
    const legacyOf = (list) => list.filter((t) => t && typeof t === "object" && !isSnowflake(str(t.serverId)) && ID_RE.test(str(t.id)));
    const all = readAll();
    const legacy = legacyOf(all);
    if (!legacy.length) return [];
    if (!servers.length) return ["raidplan-templates.json: WARNUNG - Vorlagen (#945) nicht je Server übernommen: kein Discord-Server eingetragen; sie bleiben gespeichert, bis ein Server eingetragen ist"];
    const file = store.file;
    const backup = `${file}.pre-945`;
    if (fs.existsSync(file) && !fs.existsSync(backup)) fs.writeFileSync(backup, fs.readFileSync(file));
    const next = all.slice();
    const targetsOf = (t) => (servers.includes(str(t.guildId)) ? [str(t.guildId)] : servers);
    const has = (list, server, id) => list.some((x) => x && str(x.serverId) === server && (x.id === id || x.originId === id));
    let copies = 0;
    for (const t of legacy) {
        const id = str(t.id);
        for (const server of targetsOf(t)) {
            if (has(next, server, id)) continue;
            // the id stays with one server only: a map key (t/<id>/<boss>) belongs to one template
            const keep = !next.some((x) => x && x !== t && x.id === id);
            next.push({ ...t, serverId: server, originId: keep ? "" : id, id: keep ? id : newId() });
            copies += 1;
        }
    }
    if (copies) writeAll(next);
    // the room maps follow from what is stored, not from this run: every copy with an origin among the global ids
    // gets the maps it still lacks - so a run that stopped after writing the copies is finished by the next one
    const legacyIds = new Set(legacy.map((t) => str(t.id)));
    const maps = readAll()
        .filter((x) => x && isSnowflake(str(x.serverId)) && legacyIds.has(str(x.originId)) && ID_RE.test(str(x.id)))
        .map((x) => ({ from: str(x.originId), to: str(x.id), instanceIds: normalize(x).instanceIds }));
    const bossMaps = (m) => planStore.bossesForInstances(m.instanceIds).map((b) => [planStore.templateMapKey(m.from, b.key), planStore.templateMapKey(m.to, b.key)]);
    for (const m of maps) {
        for (const [from, to] of bossMaps(m)) {
            if (planStore.mapVersion(to) || !planStore.mapVersion(from)) continue;
            try {
                const map = planStore.readMap(from);
                if (map) planStore.saveMap(to, map.buffer);
            } catch {
                // checked below: a missing map keeps the global entries for the next start
            }
        }
    }
    // read back: every global template on every target server, every room map copied
    const written = readAll();
    const complete = legacy.every((t) => targetsOf(t).every((server) => has(written, server, str(t.id))))
        && maps.every((m) => bossMaps(m).every(([from, to]) => !planStore.mapVersion(from) || planStore.mapVersion(to)));
    if (!complete) return ["raidplan-templates.json: WARNUNG - Vorlagen je Server (#945) nicht vollständig gespeichert; die bisherigen bleiben, der nächste Start versucht es erneut"];
    const gone = new Set(legacyOf(written));
    writeAll(written.filter((t) => !gone.has(t)));
    return [`raidplan-templates.json: ${legacy.length} Vorlage(n) je Server übernommen (#945) - ${copies} Kopie(n) auf ${servers.length} Server, globale Einträge entfernt (Sicherung ${path.basename(backup)})`];
}

module.exports = { migrateToServers, migrateVersions, useFile, LIMITS, listTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate, duplicateTemplate, bossKeysOf };
