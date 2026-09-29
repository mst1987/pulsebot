// The game version of an application (#553). Applications are Discord threads,
// not records: the version travels with the apply button a recruitment message
// carries and ends up as a field of the application embed.
//
//   button customId   "apply:<versionId>"  a message posted since #553
//                     "apply"               one from before — a TBC application
//   embed field       "Version"             the version's label ("Classic Era")
//                     (none)                an application from before — TBC
//
// Only the bot's own button ids and labels are read here; an unknown version
// id or label falls back to TBC (LEGACY_VERSION) like a missing one, never to
// the main version of today — an old application stays what it was.
const { VERSIONS, LEGACY_VERSION, rulesFor } = require("../../config/gameVersions");

const APPLY_BUTTON_ID = "apply";
const VERSION_FIELD = "Version";

const known = (id) => {
    const key = String(id || "").trim();
    return key && rulesFor(key) ? key : "";
};

/** The customId of the apply button for a version; the bare id without a known one. */
function applyButtonId(versionId) {
    const v = known(versionId);
    return v ? `${APPLY_BUTTON_ID}:${v}` : APPLY_BUTTON_ID;
}

/** True for the bot's apply button, with or without a version. */
function isApplyButtonId(customId) {
    const id = String(customId || "");
    return id === APPLY_BUTTON_ID || id.startsWith(`${APPLY_BUTTON_ID}:`);
}

/** The version an apply button stands for — TBC for the bare id of before #553. */
function versionOfApplyButton(customId) {
    const id = String(customId || "");
    if (!isApplyButtonId(id)) return LEGACY_VERSION;
    return known(id.slice(APPLY_BUTTON_ID.length + 1)) || LEGACY_VERSION;
}

/** The label the application embed shows for a version. */
function versionFieldValue(versionId) {
    const rules = rulesFor(known(versionId) || LEGACY_VERSION);
    return rules.label;
}

/** The version an embed's "Version" value names (label or id); TBC without one. */
function versionOfFieldValue(value) {
    const text = String(value || "").trim().toLowerCase();
    if (!text) return LEGACY_VERSION;
    const hit = VERSIONS.find((v) => v.label.toLowerCase() === text || v.id === text || v.short.toLowerCase() === text);
    return hit ? hit.id : LEGACY_VERSION;
}

module.exports = {
    APPLY_BUTTON_ID, VERSION_FIELD,
    applyButtonId, isApplyButtonId, versionOfApplyButton, versionFieldValue, versionOfFieldValue,
};
