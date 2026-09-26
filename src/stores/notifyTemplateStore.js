// "Anmelde-Aufruf" templates: message texts posted with a role ping (#420),
// data/settings/notify.json ({ templates }).
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");
const { newId } = require("../utils/ids");

const store = createJsonStore({ file: settingsPath("notify.json"), defaults: { templates: [] } });

/** All Anmelde-Aufruf templates, newest-edited first. */
function listNotify() {
    const data = store.read();
    const templates = Array.isArray(data.templates) ? data.templates : [];
    return templates.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** A single Anmelde-Aufruf template by id, or null. */
function getNotify(id) {
    return listNotify().find((t) => t.id === id) || null;
}

/** Create or update an Anmelde-Aufruf template. Returns the saved template. */
function saveNotify(data) {
    const templates = listNotify();
    const clean = {
        name: String(data.name || "").trim(),
        title: String(data.title || "").trim(),
        body: String(data.body || ""),
    };
    const existing = data.id && templates.find((t) => t.id === data.id);
    let saved;
    if (existing) {
        saved = Object.assign(existing, clean, { updatedAt: Date.now() });
    } else {
        saved = Object.assign({ id: newId(), createdAt: Date.now(), updatedAt: Date.now() }, clean);
        templates.push(saved);
    }
    store.write({ templates });
    return saved;
}

/** Delete an Anmelde-Aufruf template by id. Returns true if one was removed. */
function deleteNotify(id) {
    const templates = listNotify();
    const next = templates.filter((t) => t.id !== id);
    if (next.length === templates.length) return false;
    store.write({ templates: next });
    return true;
}
/** Tests: another file; null = notify.json again. */
function useFile(file) {
    store.useFile(file);
}

module.exports = { listNotify, getNotify, saveNotify, deleteNotify, useFile };
