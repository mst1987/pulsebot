// An event of a hidden game version (#563): while "Andere Versionen ausblenden"
// is on (config.hideOtherVersions, see mainVersion.js), no list shows it, but a
// direct link — the raid page, the public raid plan /p/<token>, a signup button
// under an old Discord message — still reaches it. There it is an archive: it
// can be read, nothing about it can be changed.
//
//   archiveOf(event)          null, or { versionId, label, short } of the hidden version
//   archivedEventId(id)       the same for an event id of either source
//   archivedRefusal(ids)      the write guard of the web routes (409 "archived", apiHandler)
//   archivedNotice(event)     the line a raider gets in Discord (in their language)
//
// Nothing is deleted: switching the setting off makes every one of them a
// normal event again.
const { rulesFor } = require("../../config/gameVersions");
const { versionOfEvent, isVersionVisible, hidesOtherVersions } = require("./mainVersion");
const { tr } = require("../../utils/i18n/botText");

/** The config handed in, else the stored one (required late: this module sits under apiHandler). */
function currentConfig(config) {
    if (config && typeof config === "object") return config;
    try {
        return require("../../stores/settingsStore").getConfig() || {};
    } catch {
        return {};
    }
}

/**
 * The hidden version an event belongs to, or null when it is shown (the
 * setting is off, or the event plays the main version).
 * @param {{ versionId?: string, categoryId?: string } | null} event
 * @returns {{ versionId: string, label: string, short: string } | null}
 */
function archiveOf(event, { config } = {}) {
    if (!event) return null;
    const cfg = currentConfig(config);
    if (!hidesOtherVersions(cfg)) return null;
    const versionId = versionOfEvent(event, { config: cfg });
    if (isVersionVisible(versionId, cfg)) return null;
    const rules = rulesFor(versionId);
    return { versionId, label: rules ? rules.label : versionId, short: (rules && (rules.short || rules.label)) || versionId };
}

/**
 * archiveOf() for an event id of either source: an own event, else the
 * Raid-Helper snapshot (its category tells the version). An id neither knows
 * is not archived — the route answers for it as before.
 */
function archivedEventId(id, { config } = {}) {
    const key = String(id || "").trim();
    if (!key) return null;
    const cfg = currentConfig(config);
    if (!hidesOtherVersions(cfg)) return null;
    // Late: eventSources reads the settings facade, which asks mainVersion back.
    const { getStoredEvent } = require("./eventSources");
    return archiveOf(getStoredEvent(key), { config: cfg });
}

const ARCHIVED_CODE = "archived";

/** The German refusal of a write on an archived event (the web is the orga's). */
function archivedMessage(archive) {
    return `Archiv – ${archive.short}: Diese Spielversion ist ausgeblendet (Einstellungen → Spielversion). Das Event ist nur lesbar.`;
}

/**
 * The first archived event among `ids`, as `{ status, code, message, archive }`
 * for a refusal, or null when every one may be changed.
 * @param {string|string[]} ids
 */
function archivedRefusal(ids, { config } = {}) {
    for (const id of [].concat(ids || [])) {
        const archive = archivedEventId(id, { config });
        if (archive) return { status: 409, code: ARCHIVED_CODE, message: archivedMessage(archive), archive };
    }
    return null;
}

/**
 * The line a raider reads when a button under an old Discord message is
 * clicked (in the reader's language, `lang`), or "" when the event is not
 * archived. Two lines: the first is the answer's title.
 */
function archivedNotice(event, { config, lang = "de" } = {}) {
    const archive = archiveOf(event, { config });
    if (!archive) return "";
    return [
        tr(lang, "This raid is archived"),
        tr(lang, "{version} is no longer shown in EventHelper, so signups and changes are closed. Nothing was deleted.", { version: archive.label }),
    ].join("\n");
}

module.exports = { archiveOf, archivedEventId, archivedRefusal, archivedNotice, ARCHIVED_CODE };
