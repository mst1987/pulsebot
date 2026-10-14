// The addon download centre in Discord (services/addons/addonCenter.js): its
// settings and what the bot posted, apart from config.json like the Orga-Zentrale's
// hubs — it changes on every check, and a save of the settings page must never
// race it (nor touch the addon list, docs/addons.md "Die Addon-Liste wird nie aus
// Versehen leer").
//
// `data/settings/addon-center.json` =
//   {
//     channelId,                            the setting (Einstellungen → Module → Addons)
//     versionId,                            the game version the centre shows ("" = that of the channel's category)
//     center: { guildId, channelId, messageId, url, postedAt, postedBy, hash } | null,
//     checkedAt,                            the last version check (ms)
//     seen: { [addonId]: { version, previous, newSince, notifiedAt } }
//   }
//
// Older files may still carry `roleId`, `announce` and `updates` (the update
// messages, removed): they are ignored and dropped on the next write.
//
// `seen` is the version the bot knows per addon: the first check only fills it
// (nothing is shown as new), a later different version sets `newSince` (the "NEU"
// mark of the centre, seven days). Nothing is announced in the channel.
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");
const { rulesFor } = require("../config/gameVersions");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
const SNOWFLAKE = /^\d{5,25}$/;
/** A game version id some rule set knows, else "" (= automatic). */
const knownVersionId = (v) => (str(v) && rulesFor(str(v)) ? str(v) : "");
const snowflake = (v) => (SNOWFLAKE.test(str(v)) ? str(v) : "");

function normalizeCenter(raw) {
    if (!raw || typeof raw !== "object") return null;
    const center = {
        guildId: str(raw.guildId),
        channelId: str(raw.channelId),
        messageId: str(raw.messageId),
        url: str(raw.url),
        postedAt: num(raw.postedAt),
        postedBy: str(raw.postedBy),
        hash: str(raw.hash),
    };
    return center.channelId && center.messageId ? center : null;
}

function normalizeSeen(raw) {
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    for (const [id, entry] of Object.entries(raw)) {
        if (!str(id) || !entry || typeof entry !== "object" || !str(entry.version)) continue;
        out[str(id)] = { version: str(entry.version), previous: str(entry.previous), newSince: num(entry.newSince), notifiedAt: num(entry.notifiedAt) };
    }
    return out;
}

const DEFAULTS = () => ({ channelId: "", versionId: "", center: null, checkedAt: 0, seen: {} });

const store = createJsonStore({
    file: settingsPath("addon-center.json"),
    defaults: DEFAULTS,
    normalize: (data) => {
        const d = data && typeof data === "object" && !Array.isArray(data) ? data : {};
        return {
            channelId: snowflake(d.channelId),
            versionId: knownVersionId(d.versionId),
            center: normalizeCenter(d.center),
            checkedAt: num(d.checkedAt),
            seen: normalizeSeen(d.seen),
        };
    },
});

/** Tests point the store at a file of their own; null = the default again. */
const useFile = store.useFile;

/** `{ channelId, versionId }`. */
function getSettings() {
    const d = store.read();
    return { channelId: d.channelId, versionId: d.versionId };
}

/**
 * Change the settings; only the fields given. A channel id that is no Discord id is
 * refused (`{ error }`), "" clears it. The old keys `roleId` and `announce` are ignored. Returns `{ settings }` or `{ error }`.
 */
function setSettings(patch = {}) {
    const p = patch && typeof patch === "object" ? patch : {};
    const d = store.read();
    if (p.channelId !== undefined) {
        const value = str(p.channelId);
        if (value && !SNOWFLAKE.test(value)) return { error: "Ungültiger Kanal." };
        d.channelId = value;
    }
    if (p.versionId !== undefined) {
        const value = str(p.versionId);
        if (value && !knownVersionId(value)) return { error: "Ungültige Spielversion." };
        d.versionId = value;
    }
    store.write(d);
    return { settings: { channelId: d.channelId, versionId: d.versionId } };
}

/** The posted centre, or null. */
function getCenter() {
    const c = store.read().center;
    return c ? { ...c } : null;
}

/** Remember the posted centre (replaces the earlier one) and return it. */
function setCenter(center = {}, { now = Date.now() } = {}) {
    const d = store.read();
    d.center = normalizeCenter({ ...center, postedAt: center.postedAt || now });
    store.write(d);
    return d.center ? { ...d.center } : null;
}

/** Note what the posted centre shows now (`hash`); false without one. */
function markCenterDrawn(hash) {
    const d = store.read();
    if (!d.center) return false;
    d.center.hash = str(hash);
    store.write(d);
    return true;
}

/** Forget the centre; returns the removed one or null. */
function clearCenter() {
    const d = store.read();
    const old = d.center;
    if (!old) return null;
    d.center = null;
    store.write(d);
    return { ...old };
}

/** When the versions were checked last (ms, 0 = never). */
function getCheckedAt() {
    return store.read().checkedAt;
}

function setCheckedAt(at = Date.now()) {
    const d = store.read();
    d.checkedAt = num(at);
    store.write(d);
}

/** What the bot knows per addon: `{ [addonId]: { version, previous, newSince, notifiedAt } }`. */
function getSeen() {
    return store.read().seen;
}

/** Store one addon's known version (the whole entry). */
function setSeen(addonId, entry) {
    const d = store.read();
    const clean = normalizeSeen({ [str(addonId)]: entry })[str(addonId)];
    if (!clean) return null;
    d.seen[str(addonId)] = clean;
    store.write(d);
    return { ...clean };
}

module.exports = {
    useFile, getSettings, setSettings, getCenter, setCenter, markCenterDrawn, clearCenter,
    getCheckedAt, setCheckedAt, getSeen, setSeen,
};
