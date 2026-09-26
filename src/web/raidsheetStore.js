// Raidsheets (#420): the Google-Sheets targets of a setup, keyed by content
// (Tier 4/5, ...). They have no file of their own - they are the `raidsheets`
// list inside config.json, so this store reads and writes through configStore.
const { googleSpreadsheetId, googleSheetName, googleSheetGid } = require("../config/variables");
const configStore = require("./configStore");
const { newId } = require("../utils/ids");

// The "Tier 4/5" raidsheet that ships by default (seeded from the GOOGLE_* env
// vars). It always exists so a fresh install can fill setups without any config.
const DEFAULT_RAIDSHEET = {
    id: "tier45",
    name: "Tier 4 / Tier 5",
    spreadsheetId: googleSpreadsheetId || "",
    sheetName: googleSheetName || "Setup",
    gid: googleSheetGid || 34139428,
    keywords: ["kara", "karazhan", "gruul", "maggi", "magtheridon"],
};

// Prefer a provided value, falling back when it is null/undefined.
function pick(value, fallback) {
    return value === undefined || value === null ? fallback : value;
}

function normalizeRaidsheet(data, fallback = {}) {
    const keywords = Array.isArray(data.keywords)
        ? data.keywords.map((k) => String(k).trim()).filter(Boolean)
        : String(data.keywords || "").split(",").map((k) => k.trim()).filter(Boolean);
    return {
        name: String(pick(data.name, fallback.name || "")).trim(),
        spreadsheetId: String(pick(data.spreadsheetId, fallback.spreadsheetId || "")).trim(),
        sheetName: String(pick(data.sheetName, fallback.sheetName || "Setup")).trim() || "Setup",
        gid: String(pick(data.gid, pick(fallback.gid, ""))).trim(),
        keywords,
    };
}

/**
 * All configured raidsheets. When nothing has been saved yet the default
 * "Tier 4/5" sheet (seeded from the GOOGLE_* env vars) is returned so the
 * feature works out of the box.
 */
function listRaidsheets() {
    const config = configStore.getConfig();
    if (Array.isArray(config.raidsheets) && config.raidsheets.length) {
        return config.raidsheets;
    }
    return [{ ...DEFAULT_RAIDSHEET }];
}

/** A single raidsheet by id, or null. */
function getRaidsheet(id) {
    return listRaidsheets().find((s) => s.id === id) || null;
}

/**
 * Create or update a raidsheet. If `data.id` matches an existing sheet it is
 * updated, otherwise a new one is created. Persisting always materialises the
 * current list (including the seeded default) so it survives further edits.
 */
function saveRaidsheet(data) {
    const sheets = listRaidsheets().map((s) => ({ ...s }));
    const existing = data.id && sheets.find((s) => s.id === data.id);
    let saved;
    if (existing) {
        Object.assign(existing, normalizeRaidsheet(data, existing));
        saved = existing;
    } else {
        saved = { id: newId(), ...normalizeRaidsheet(data) };
        sheets.push(saved);
    }
    const stored = configStore.readStored();
    configStore.writeStored({ ...stored, raidsheets: sheets });
    return saved;
}

/** Delete a raidsheet by id. Returns true if one was removed. */
function deleteRaidsheet(id) {
    const sheets = listRaidsheets().map((s) => ({ ...s }));
    const next = sheets.filter((s) => s.id !== id);
    if (next.length === sheets.length) return false;
    const stored = configStore.readStored();
    configStore.writeStored({ ...stored, raidsheets: next });
    return true;
}
/** Tests: another config file (the raidsheets live in it); null = config.json again. */
function useFile(file) {
    configStore.useFile(file);
}

module.exports = { listRaidsheets, getRaidsheet, saveRaidsheet, deleteRaidsheet, DEFAULT_RAIDSHEET, useFile };
