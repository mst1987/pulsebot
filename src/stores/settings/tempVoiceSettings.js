// A raid category's voice channel per raid (docs/channels.md "Sprachkanal je Raid"):
// categoryTempVoice = { [categoryId]: { mode, fromRaid2, parentId, nameTemplate,
// leadMinutes, closeAfterMinutes, onlyAssigned } }, stored with only what differs
// from the defaults below.
//
//   mode "none"     - the bot creates nothing and names no channel
//        "existing" - the raid uses the category's fixed channel (categoryVoiceChannel);
//                     `fromRaid2` adds a temporary channel for raid 2 and further of a split event
//        "temp"     - every raid gets its own temporary channel, raid 1 too
//
// A category without an entry keeps what it did before: "existing" when it has a
// fixed channel, else "none" - so nothing changes on a server until the orga picks a mode.
const MODES = ["none", "existing", "temp"];
const DEFAULT_NAME_TEMPLATE = "{raid} {nr} · {datum}";
const NAME_TEMPLATE_MAX = 100;
const LEAD_MIN = 0;
const LEAD_MAX = 240;
const CLOSE_AFTER_MIN = 0;
const CLOSE_AFTER_MAX = 360;
// A temporary channel nobody was in for this long closes (never before the raid's end).
const EMPTY_CLOSE_MINUTES = 5;

const TEMP_VOICE_DEFAULTS = Object.freeze({
    fromRaid2: false,
    parentId: "",
    nameTemplate: DEFAULT_NAME_TEMPLATE,
    leadMinutes: 30,
    closeAfterMinutes: 60,
    onlyAssigned: false,
});

const { isSnowflake } = require("../../utils/ids");

function minutes(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n) || value === "" || value === null || value === undefined) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}

/** A name template as stored: one line, at most NAME_TEMPLATE_MAX characters; empty = the default. */
function normalizeNameTemplate(value) {
    const text = String(value === null || value === undefined ? "" : value).replace(/[\r\n\t]+/g, " ").trim().slice(0, NAME_TEMPLATE_MAX);
    return text || DEFAULT_NAME_TEMPLATE;
}

/** One category's settings with every default filled in; `mode` stays "" when none was given. */
function tempVoiceSettings(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const d = TEMP_VOICE_DEFAULTS;
    return {
        mode: MODES.includes(src.mode) ? src.mode : "",
        fromRaid2: src.fromRaid2 === true,
        parentId: isSnowflake(src.parentId) ? String(src.parentId) : "",
        nameTemplate: normalizeNameTemplate(src.nameTemplate),
        leadMinutes: minutes(src.leadMinutes, LEAD_MIN, LEAD_MAX, d.leadMinutes),
        closeAfterMinutes: minutes(src.closeAfterMinutes, CLOSE_AFTER_MIN, CLOSE_AFTER_MAX, d.closeAfterMinutes),
        onlyAssigned: src.onlyAssigned === true,
    };
}

/** categoryTempVoice as stored: per category only what differs from the defaults; a category at the defaults drops out. */
function normalizeCategoryTempVoice(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [catId, value] of Object.entries(raw)) {
        const key = String(catId).trim();
        if (!key) continue;
        const s = tempVoiceSettings(value);
        const diff = {};
        if (s.mode) diff.mode = s.mode;
        for (const field of Object.keys(TEMP_VOICE_DEFAULTS)) {
            if (s[field] !== TEMP_VOICE_DEFAULTS[field]) diff[field] = s[field];
        }
        if (Object.keys(diff).length) out[key] = diff;
    }
    return out;
}

/**
 * A category's voice settings out of a config, defaults filled in. Without a
 * stored mode it follows the fixed channel: "existing" with one, else "none".
 */
function categoryTempVoiceFor(config, categoryId) {
    const key = String(categoryId || "");
    const s = tempVoiceSettings(((config && config.categoryTempVoice) || {})[key]);
    const fixed = String(((config && config.categoryVoiceChannel) || {})[key] || "");
    if (!s.mode) s.mode = fixed ? "existing" : "none";
    return { ...s, voiceChannelId: fixed };
}

/** An event's own voice plan (`event.voicePlan`): mode, name and lead time; null = the category's. */
function normalizeVoicePlan(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    if (!MODES.includes(raw.mode)) return null;
    return {
        mode: raw.mode,
        nameTemplate: normalizeNameTemplate(raw.nameTemplate),
        leadMinutes: minutes(raw.leadMinutes, LEAD_MIN, LEAD_MAX, TEMP_VOICE_DEFAULTS.leadMinutes),
    };
}

module.exports = {
    MODES, DEFAULT_NAME_TEMPLATE, NAME_TEMPLATE_MAX, LEAD_MIN, LEAD_MAX, CLOSE_AFTER_MIN, CLOSE_AFTER_MAX, EMPTY_CLOSE_MINUTES,
    TEMP_VOICE_DEFAULTS, tempVoiceSettings, normalizeCategoryTempVoice, categoryTempVoiceFor, normalizeVoicePlan, normalizeNameTemplate,
};
