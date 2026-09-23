// Creates the bot's missing application emojis (#287): spec, class and role
// icons from `appEmojis.emojiCatalog()`, downloaded from wow.zamimg.com, and the
// flat UI icons read from their checked-in PNGs (assets/emojis/).
//
// Used in two places: the bot calls `ensureAppEmojis(client)` once when it is
// ready, so a fresh application (production included) gets its icons without a
// manual step; `scripts/sync-app-emojis.js` runs the same sync by hand
// (`--dry-run` lists only). Idempotent: it reads the application's emojis first
// and creates only names that do not exist yet — an existing emoji is never
// replaced or deleted, except the short-lived RECREATE list below.
const fs = require("fs");
const path = require("path");
const { Routes } = require("discord.js");
const { emojiCatalog, validEmojiName, loadAppEmojis } = require("./appEmojis");

const MAX_BYTES = 256 * 1024;

// classes.js corrected these two spec icons (2bbb7a58: Priest-Holy and
// Hunter-Survival) after the app emoji had already been uploaded with the old
// picture — the sync above only ever fills in a *missing* name, so the stale
// image stuck around on every application that had synced before that fix.
// Deleting them once here makes the next bot start (the next deploy) recreate
// them with the corrected icon, without a manual step. Remove this list once
// production has restarted with it.
const RECREATE = ["eh_hunter_survival", "eh_priest_holy"];

/** The application's emojis as `{ id, name }` (`GET /applications/{id}/emojis` answers `{ items }`). */
async function existingItems({ rest, routes = Routes, clientId }) {
    const res = await rest.get(routes.applicationEmojis(clientId));
    const items = Array.isArray(res) ? res : (res && res.items) || [];
    return items.filter((e) => e && e.name && e.id);
}

/** The names of the application's emojis. */
async function existingNames(opts) {
    return new Set((await existingItems(opts)).map((e) => e.name));
}

/** An icon as a data URI, refused above Discord's size limit. */
async function downloadIcon(url, fetchImpl = fetch) {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error(`zu groß (${buf.length} Bytes)`);
    const type = (res.headers && res.headers.get && res.headers.get("content-type")) || "image/jpeg";
    return `data:${type.split(";")[0]};base64,${buf.toString("base64")}`;
}

const FILE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

/** A checked-in icon file (the flat UI icons, assets/emojis/) as a data URI. */
async function readIconFile(file, readFile = fs.promises.readFile) {
    const type = FILE_TYPES[path.extname(String(file || "")).toLowerCase()];
    if (!type) throw new Error(`unbekanntes Bildformat: ${path.basename(String(file || ""))}`);
    const buf = await readFile(file);
    if (buf.length > MAX_BYTES) throw new Error(`zu groß (${buf.length} Bytes)`);
    return `data:${type};base64,${Buffer.from(buf).toString("base64")}`;
}

/** The image of a catalogue entry: its local `file`, else its `url`. */
function iconImage(entry, { fetchImpl = fetch, readFile } = {}) {
    return entry.file ? readIconFile(entry.file, readFile) : downloadIcon(entry.url, fetchImpl);
}

/**
 * Create every catalogue emoji the application does not have yet.
 * @returns {Promise<{ existing: number, missing: string[], created: string[], failed: { name: string, error: string }[] }>}
 */
async function syncAppEmojis({
    rest, routes = Routes, clientId, catalog = emojiCatalog(), dryRun = false, fetchImpl = fetch, readFile, log = console.log,
}) {
    const items = await existingItems({ rest, routes, clientId });
    const have = new Set(items.map((e) => e.name));
    const stale = items.filter((e) => RECREATE.includes(e.name));
    const wanted = catalog.filter((e) => validEmojiName(e.name));
    const missing = wanted.filter((e) => !have.has(e.name));
    const out = { existing: wanted.length - missing.length, missing: missing.map((e) => e.name), created: [], failed: [] };
    log(`${wanted.length} Emojis im Katalog, ${out.existing} vorhanden, ${missing.length} fehlen.`);
    if (dryRun) {
        for (const e of missing) log(`  fehlt: ${e.name} (${e.icon || e.tile})`);
        for (const e of stale) log(`  veraltet, wird beim naechsten echten Lauf neu angelegt: ${e.name}`);
        return out;
    }
    for (const e of stale) {
        const target = wanted.find((w) => w.name === e.name);
        if (!target) continue;
        try {
            await rest.delete(routes.applicationEmoji(clientId, e.id));
            have.delete(e.name);
            missing.push(target);
            log(`  veraltet geloescht: ${e.name}`);
        } catch (err) {
            log(`  FEHLER beim Loeschen von ${e.name}: ${err.message}`);
        }
    }
    for (const e of missing) {
        try {
            const image = await iconImage(e, { fetchImpl, readFile });
            await rest.post(routes.applicationEmojis(clientId), { body: { name: e.name, image } });
            out.created.push(e.name);
            log(`  angelegt: ${e.name}`);
        } catch (err) {
            out.failed.push({ name: e.name, error: err.message });
            log(`  FEHLER ${e.name}: ${err.message}`);
        }
    }
    return out;
}

/**
 * On bot start: create the missing emojis, then read them into the cache.
 * Never throws — without icons the messages fall back to text. Returns the
 * sync result, or `{ error }` when the sync itself could not run.
 * @param {object} client a ready discord.js Client
 */
async function ensureAppEmojis(client, { fetchImpl = fetch, readFile, log = (m) => console.log(`[appEmojis] ${m.trim()}`) } = {}) {
    const clientId = client && client.application && client.application.id;
    let result;
    if (!clientId || !client.rest) {
        result = { error: "Bot-Anwendung unbekannt" };
    } else {
        try {
            result = await syncAppEmojis({ rest: client.rest, clientId, fetchImpl, readFile, log });
        } catch (e) {
            result = { error: e.message };
            console.warn(`[appEmojis] Abgleich fehlgeschlagen: ${e.message}`);
        }
    }
    // Read afresh when something was created, so the new icons show without a restart.
    const force = !!(result.created && result.created.length);
    await loadAppEmojis(client, { force }).catch(() => {});
    return result;
}

module.exports = { MAX_BYTES, existingNames, downloadIcon, readIconFile, iconImage, syncAppEmojis, ensureAppEmojis };
