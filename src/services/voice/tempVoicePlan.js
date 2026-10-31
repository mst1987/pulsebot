// What a raid's temporary voice channel looks like (docs/channels.md "Sprachkanal je Raid"):
// whether the raid gets one, its name, when it opens and when it must be gone, who
// may join. Pure - no Discord, no stores; tempVoiceJob.js hands in the group and config.
//
// The plan comes from the category (categoryTempVoiceFor) and the primary's own
// `voicePlan` (KanalStep "Für dieses Event ändern"), which overrides the mode, the
// name template and the lead time; the Discord category, the latest close and
// "only assigned" always stay with the category.
const { DateTime } = require("luxon");
const { TIMEZONE } = require("../../config/timezone");
const { instanceById } = require("../../config/gameVersions");
const { WEEKDAYS, normalizeForType } = require("../../utils/channelNames");
const { plannedEndOrDefault } = require("../../utils/time");
const { raidIndexOf } = require("../../utils/raidGroup");
const { categoryTempVoiceFor, normalizeVoicePlan, EMPTY_CLOSE_MINUTES } = require("../../stores/settings/tempVoiceSettings");
const { approvedSetupOf } = require("../setup/setupCore");

const VOICE_TYPE = 2;
// Characters that only separate placeholders; dropped with an empty placeholder next to them.
const SEPARATORS = "·\\-|/,:";
const EDGE_RE = new RegExp(`^[\\s${SEPARATORS}]+|[\\s${SEPARATORS}]+$`, "g");
const DOUBLE_RE = new RegExp(`([${SEPARATORS}])(\\s*[${SEPARATORS}])+`, "g");

/** The settings for one raid group: the category's, with the primary's own voice plan on top. */
function settingsFor(primary, config) {
    const category = categoryTempVoiceFor(config, primary && primary.categoryId);
    const own = normalizeVoicePlan(primary && primary.voicePlan);
    return own ? { ...category, mode: own.mode, nameTemplate: own.nameTemplate, leadMinutes: own.leadMinutes, own: true } : { ...category, own: false };
}

/** Whether the raid at `index` (1 = the primary) gets a temporary channel under these settings. */
function isTemporary(settings, index) {
    if (!settings) return false;
    if (settings.mode === "temp") return true;
    return settings.mode === "existing" && settings.fromRaid2 === true && index >= 2;
}

/** "Sa 31.10." in the server's zone; "" without a start. */
function dayLabel(startTime) {
    if (!startTime) return "";
    const dt = DateTime.fromSeconds(Number(startTime), { zone: TIMEZONE });
    const wd = WEEKDAYS[dt.weekday % 7];
    return `${wd.charAt(0).toUpperCase()}${wd.slice(1)} ${dt.toFormat("dd.MM.")}`;
}

/** "20:00" in the server's zone; "" without a start. */
function timeLabel(startTime) {
    return startTime ? DateTime.fromSeconds(Number(startTime), { zone: TIMEZONE }).toFormat("HH:mm") : "";
}

/** The raid's tag: the short names of its instances ("SSC", "SSC/TK"), else its title. */
function raidLabel(event) {
    const ids = Array.isArray(event && event.instanceIds) ? event.instanceIds : [];
    const tags = ids.map((id) => (instanceById(id) || {}).short || "").filter(Boolean);
    return tags.length ? tags.join("/") : String((event && event.title) || "").trim();
}

/**
 * A name template filled in. An empty placeholder goes with the separator next
 * to it ("{raid} {nr} · {datum}" with one raid = "SSC · Sa 31.10."), spaces
 * collapse, and the result follows Discord's voice channel rules.
 */
function renderVoiceName(template, values = {}) {
    let text = String(template || "").replace(/\{(\w+)\}/g, (all, key) => {
        if (!Object.prototype.hasOwnProperty.call(values, key)) return all;
        const v = values[key];
        return v === undefined || v === null ? "" : String(v);
    });
    text = text.replace(/\s+/g, " ").replace(DOUBLE_RE, "$1").replace(EDGE_RE, "").replace(/\s+/g, " ");
    return normalizeForType(text, VOICE_TYPE);
}

/** Who stands in the raid's groups - the approved setup, else the draft; never the bench. */
function assignedUserIds(event) {
    const setup = approvedSetupOf(event) || (event && event.setup) || null;
    const out = new Set();
    for (const g of Array.isArray(setup && setup.groups) ? setup.groups : []) {
        for (const s of Array.isArray(g && g.slots) ? g.slots : []) if (s && s.userId) out.add(String(s.userId));
    }
    return [...out];
}

/**
 * The plan for one raid of a group: `group` = every raid of it, sorted
 * (raidGroup.groupEvents), the primary first. `leaderName(userId)` names the
 * raid's leader for {leader}. Null when the raid gets no temporary channel.
 *
 *   { eventId, guildId, index, total, mode, name, parentId, onlyAssigned, members,
 *     openAt, startAt, endAt, limitAt, emptyMinutes, fixedChannelId, own }
 */
function planFor(event, { group = [], config = {}, leaderName = () => "" } = {}) {
    if (!event || event.status === "cancelled") return null;
    const list = group.length ? group : [event];
    const primary = list[0] || event;
    const settings = settingsFor(primary, config);
    const total = list.length;
    const position = list.findIndex((e) => e.id === event.id);
    const index = position >= 0 ? position + 1 : Math.max(1, raidIndexOf(event));
    if (!isTemporary(settings, index)) return null;
    const startAt = Number(event.startTime) || Number(primary.startTime) || 0;
    if (!startAt) return null;
    const endAt = plannedEndOrDefault({ ...event, startTime: startAt });
    const name = renderVoiceName(settings.nameTemplate, {
        raid: raidLabel(event) || raidLabel(primary),
        nr: total > 1 ? String(index) : "",
        datum: dayLabel(startAt),
        zeit: timeLabel(startAt),
        leader: event.leaderId ? String(leaderName(event.leaderId) || "") : "",
    });
    return {
        eventId: event.id,
        guildId: String(event.guildId || ""),
        index,
        total,
        mode: settings.mode,
        name: name || raidLabel(event) || "Raid",
        parentId: settings.parentId,
        onlyAssigned: settings.onlyAssigned,
        members: settings.onlyAssigned ? assignedUserIds(event) : [],
        openAt: startAt - settings.leadMinutes * 60,
        startAt,
        endAt,
        limitAt: endAt + settings.closeAfterMinutes * 60,
        emptyMinutes: EMPTY_CLOSE_MINUTES,
        fixedChannelId: settings.voiceChannelId || "",
        own: settings.own,
    };
}

module.exports = { settingsFor, isTemporary, dayLabel, timeLabel, raidLabel, renderVoiceName, assignedUserIds, planFor };
