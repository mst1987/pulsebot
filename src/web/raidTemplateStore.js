// Raid templates (#266, #420): size, tanks, healers per evening, stored as
// `{ templates: [...] }` in data/settings/raid-templates.json. The shape and
// its rules are the pure functions of raidTemplates.js; this file only keeps
// them on disk. A pre-#266 entry (a bare Raid-Helper `{ id, name }`) is
// upgraded once at start (migrateLegacyTemplates(), via settingsMigration.js),
// not on every read.
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");
const { isLegacy, migrateLegacy, normalizeTemplate, validateTemplate } = require("./raidTemplates");
const { newId } = require("../utils/ids");

const store = createJsonStore({ file: settingsPath("raid-templates.json"), defaults: { templates: [] } });

/** The stored entries that are objects at all. */
function storedTemplates() {
    const data = store.read();
    const stored = Array.isArray(data.templates) ? data.templates : [];
    return stored.filter((t) => t && typeof t === "object");
}

/** One stored entry in its full shape, keeping its timestamps. */
function withShape(t) {
    return { ...normalizeTemplate(t), createdAt: t.createdAt || 0, updatedAt: t.updatedAt || 0 };
}

/** All raid templates, newest-updated first. */
function listRaidTemplates() {
    return storedTemplates().map(withShape).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
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

/** One template by id, or null. */
function getRaidTemplate(id) {
    return listRaidTemplates().find((t) => t.id === String(id || "")) || null;
}

/**
 * Create (no id) or update (id) a template.
 * @returns {{ template?: object, error?: string, notFound?: boolean }}
 */
function saveRaidTemplate(data) {
    const clean = normalizeTemplate(data);
    // The raw body too: a colour or picture normalizeTemplate() could not use
    // is refused with a sentence instead of silently becoming "none" (#307).
    const problem = validateTemplate(clean, data && typeof data === "object" ? data : {});
    if (problem) return { error: problem };
    const templates = listRaidTemplates();
    if (clean.id) {
        const match = templates.find((t) => t.id === clean.id);
        if (!match) return { notFound: true, error: "Vorlage nicht gefunden." };
        Object.assign(match, clean, { updatedAt: Date.now() });
        store.write({ templates });
        return { template: match };
    }
    const saved = { ...clean, id: newId(), createdAt: Date.now(), updatedAt: Date.now() };
    templates.push(saved);
    store.write({ templates });
    return { template: saved };
}

/**
 * Take over the Raid-Helper templates found in the server's events (the
 * "Aus Raid-Helper laden" action). One already linked by a template only gets
 * a missing name; an unknown one becomes a template without size, like a
 * migrated entry. Returns { added, updated } counts.
 */
function saveRaidTemplates(list) {
    const incoming = (Array.isArray(list) ? list : [])
        .map((t) => ({ id: String(t.id || "").trim(), name: String(t.name || "").trim() }))
        .filter((t) => t.id);
    const templates = listRaidTemplates();
    let added = 0;
    let updated = 0;
    for (const t of incoming) {
        const match = templates.find((x) => x.raidhelperTemplateId === t.id);
        if (match) {
            if (t.name && !match.name) match.name = t.name;
            updated += 1;
        } else {
            templates.push(migrateLegacy({ id: t.id, name: t.name }));
            added += 1;
        }
    }
    if (incoming.length) store.write({ templates });
    return { added, updated };
}

/** Delete a template by id. Returns true if one was removed. */
function deleteRaidTemplate(id) {
    const templates = listRaidTemplates();
    const next = templates.filter((t) => t.id !== id);
    if (next.length === templates.length) return false;
    store.write({ templates: next });
    return true;
}
/** Tests: another file; null = raid-templates.json again. */
function useFile(file) {
    store.useFile(file);
}

module.exports = {
    listRaidTemplates, getRaidTemplate, saveRaidTemplate, saveRaidTemplates, deleteRaidTemplate,
    migrateLegacyTemplates, useFile,
};
