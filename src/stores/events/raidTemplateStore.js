// Raid templates (#266, #420), per Discord server since #1076: size, tanks,
// healers per evening, stored as `{ templates: [...] }` in
// data/settings/raid-templates.json. The shape and its rules are the pure
// functions of raidTemplates.js; this file only keeps them on disk. A pre-#266
// entry (a bare Raid-Helper `{ id, name }`) is upgraded once at start
// (migrateLegacyTemplates(), via settingsMigration.js), not on every read.
//
// Every template belongs to one server (`guildId`): every read and write names
// that server first, another server's template does not exist for it, and an
// invalid server holds nothing and takes nothing (fail closed). The old global
// entries are copied onto every server once at start (migrateToServers); a copy
// keeps the id it came from in `originId`, so a reference still naming that id
// (a stored event, a category default the migration could not place) finds the
// server's own copy. allRaidTemplates() is for the checks over every server,
// never for an answer that goes to one server's orga.
const fs = require("fs");
const path = require("path");
const { settingsPath } = require("../../config/paths");
const { createJsonStore } = require("../jsonStore");
const { isLegacy, migrateLegacy, normalizeTemplate, validateTemplate } = require("../../services/events/raidTemplates");
const { isSnowflake, newId } = require("../../utils/ids");
const { isLegacyOverflow } = require("../../utils/signup/capacity");

const store = createJsonStore({ file: settingsPath("raid-templates.json"), defaults: { templates: [] } });

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
/** A template's server, or "" for an invalid one (which holds nothing). */
const serverOf = (guildId) => (isSnowflake(str(guildId)) ? str(guildId) : "");
const NO_SERVER = "Kein gültiger Discord-Server.";

/** The stored entries that are objects at all. */
function storedTemplates() {
    const data = store.read();
    const stored = Array.isArray(data.templates) ? data.templates : [];
    return stored.filter((t) => t && typeof t === "object");
}

/**
 * One stored entry in its full shape, keeping its timestamps and its server.
 * The server fields are set here and not in normalizeTemplate(): that one also
 * reads request bodies, and a body never chooses a template's server.
 */
function withShape(t) {
    return { ...normalizeTemplate(t), guildId: str(t.guildId), originId: str(t.originId), createdAt: t.createdAt || 0, updatedAt: t.updatedAt || 0 };
}

const newestFirst = (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0);

/** Every stored template of every server (and a not yet migrated global one): for checks across servers only. */
function allRaidTemplates() {
    return storedTemplates().map(withShape).sort(newestFirst);
}

/** The raid templates of one server, newest-updated first. */
function listRaidTemplates(guildId) {
    const server = serverOf(guildId);
    if (!server) return [];
    return allRaidTemplates().filter((t) => t.guildId === server);
}

/**
 * Upgrade the pre-#266 entries in place: each becomes a template without size
 * (migrateLegacy), every other entry is written in its full shape. Writes only
 * when there was one to upgrade, so a second run changes nothing.
 * @returns {number} how many entries were upgraded
 */
function migrateLegacyTemplates() {
    const stored = storedTemplates();
    const count = stored.filter(isLegacy).length;
    if (count) store.write({ templates: stored.map((t) => (isLegacy(t) ? migrateLegacy(t) : withShape(t))) });
    return count;
}

/**
 * The one-off switch of #516 (settingsMigration.js): every template still
 * carrying a legacy overflow value ("bench"/"off") gets `overflow: "none"` and
 * `lockAtLimit: false`, the rest of the entry stays as stored. A switched entry
 * carries a new value, so a second run writes nothing.
 * @returns {number} how many templates were switched
 */
function migrateOverflowModes() {
    const data = store.read();
    const stored = Array.isArray(data.templates) ? data.templates : [];
    let count = 0;
    const next = stored.map((t) => {
        if (!t || typeof t !== "object" || !isLegacyOverflow(t.overflow)) return t;
        count += 1;
        return { ...t, overflow: "none", lockAtLimit: false };
    });
    if (count) store.write({ ...data, templates: next });
    return count;
}

/**
 * One template of a server by id, or null. An id it does not hold itself may
 * still name the template its copy came from (#1076): an old reference then
 * finds this server's copy, never the other server's original.
 */
function getRaidTemplate(guildId, id) {
    const wanted = str(id);
    if (!wanted) return null;
    const own = listRaidTemplates(guildId);
    return own.find((t) => t.id === wanted) || own.find((t) => t.originId === wanted) || null;
}

/**
 * Create (no id) or update (id) a template of a server. Another server's id is
 * "not found" - also the id its copy came from: an update names the real id.
 * @returns {{ template?: object, error?: string, notFound?: boolean }}
 */
function saveRaidTemplate(guildId, data) {
    const server = serverOf(guildId);
    if (!server) return { error: NO_SERVER };
    const clean = normalizeTemplate(data);
    // The raw body too: a colour or picture normalizeTemplate() could not use
    // is refused with a sentence instead of silently becoming "none" (#307).
    const problem = validateTemplate(clean, data && typeof data === "object" ? data : {});
    if (problem) return { error: problem };
    const templates = allRaidTemplates();
    if (clean.id) {
        const match = templates.find((t) => t.id === clean.id && t.guildId === server);
        if (!match) return { notFound: true, error: "Vorlage nicht gefunden." };
        Object.assign(match, clean, { updatedAt: Date.now() });
        store.write({ templates });
        return { template: match };
    }
    const saved = { ...clean, id: newId(), guildId: server, originId: "", createdAt: Date.now(), updatedAt: Date.now() };
    templates.push(saved);
    store.write({ templates });
    return { template: saved };
}

/**
 * Take over the Raid-Helper templates found in a server's events (the
 * "Aus Raid-Helper laden" action). One already linked by a template of this
 * server only gets a missing name; an unknown one becomes a template without
 * size, like a migrated entry. Template ids stay unique over all servers, so the
 * `rh-<id>` of a second server's import gets a new id. Returns { added, updated } counts.
 */
function saveRaidTemplates(guildId, list) {
    const server = serverOf(guildId);
    if (!server) return { added: 0, updated: 0 };
    const incoming = (Array.isArray(list) ? list : [])
        .map((t) => ({ id: str(t.id), name: str(t.name) }))
        .filter((t) => t.id);
    const templates = allRaidTemplates();
    let added = 0;
    let updated = 0;
    for (const t of incoming) {
        const match = templates.find((x) => x.guildId === server && x.raidhelperTemplateId === t.id);
        if (match) {
            if (t.name && !match.name) match.name = t.name;
            updated += 1;
        } else {
            const fresh = migrateLegacy({ id: t.id, name: t.name });
            const taken = templates.some((x) => x.id === fresh.id);
            templates.push({ ...fresh, id: taken ? newId() : fresh.id, guildId: server, originId: "" });
            added += 1;
        }
    }
    if (incoming.length) store.write({ templates });
    return { added, updated };
}

/** Delete a template of a server by its id. Returns true if one was removed. */
function deleteRaidTemplate(guildId, id) {
    const server = serverOf(guildId);
    if (!server) return false;
    const wanted = str(id);
    const templates = allRaidTemplates();
    const next = templates.filter((t) => !(t.id === wanted && t.guildId === server));
    if (next.length === templates.length) return false;
    store.write({ templates: next });
    return true;
}

/**
 * The start migration of #1076 (settingsMigration.migrateRaidTemplateServers):
 * every old global template lands on every listed server. The first server keeps
 * the original with its id; every further one gets a copy with a new id and
 * `originId`. The entry is copied as stored, so nothing it holds is lost, and the
 * global entry only goes after every copy was read back from disk. A second run
 * finds no global entry and writes nothing; a run that broke off finds what it
 * already copied and goes on.
 * @param {string[]} serverIds  the listed servers, the first one first
 * @returns {string[]} log lines (a line with ": WARNUNG " also reaches the error log)
 */
function migrateToServers(serverIds) {
    const servers = [...new Set((Array.isArray(serverIds) ? serverIds : []).map(str).filter(isSnowflake))];
    const legacyOf = (list) => list.filter((t) => !isSnowflake(str(t.guildId)) && str(t.id));
    const all = storedTemplates();
    const legacy = legacyOf(all);
    if (!legacy.length) return [];
    if (!servers.length) {
        return ["raid-templates.json: WARNUNG - Vorlagen (#1076) nicht je Server übernommen: kein Discord-Server eingetragen; sie bleiben gespeichert, bis ein Server eingetragen ist"];
    }
    const file = store.file;
    const backup = `${file}.pre-1076`;
    // Temp plus rename: a crash in the middle must not leave a half backup the next run takes for the real one.
    if (fs.existsSync(file) && !fs.existsSync(backup)) {
        const temp = `${backup}.tmp`;
        fs.writeFileSync(temp, fs.readFileSync(file));
        fs.renameSync(temp, backup);
    }
    const has = (list, server, id) => list.some((x) => str(x.guildId) === server && (x.id === id || x.originId === id));
    const next = all.slice();
    let stamped = 0;
    let copies = 0;
    for (const t of legacy) {
        const id = str(t.id);
        for (const server of servers) {
            if (has(next, server, id)) continue;
            // Only the first copy may keep the id: template ids stay unique.
            const keep = !next.some((x) => x !== t && x.id === id);
            next.push({ ...t, guildId: server, originId: keep ? "" : id, id: keep ? id : newId() });
            if (keep) stamped += 1;
            else copies += 1;
        }
    }
    if (stamped || copies) store.write({ templates: next });
    const written = storedTemplates();
    const safe = legacyOf(written).every((t) => servers.every((server) => has(written, server, str(t.id))));
    if (!safe) {
        return ["raid-templates.json: WARNUNG - Vorlagen (#1076) nicht vollständig gespeichert; die bisherigen bleiben, der nächste Start versucht es erneut"];
    }
    const gone = new Set(legacyOf(written));
    store.write({ templates: written.filter((t) => !gone.has(t)) });
    return [`raid-templates.json: ${legacy.length} Vorlage(n) je Server übernommen (#1076) - ${stamped} Original(e) gestempelt, ${copies} Kopie(n), ${servers.length} Server, globale Einträge entfernt (Sicherung ${path.basename(backup)})`];
}

/** Tests: another file; null = raid-templates.json again. */
function useFile(file) {
    store.useFile(file);
}

module.exports = {
    listRaidTemplates, allRaidTemplates, getRaidTemplate, saveRaidTemplate, saveRaidTemplates, deleteRaidTemplate,
    migrateLegacyTemplates, migrateOverflowModes, migrateToServers, useFile,
};
