// The write side of the hints from the data (docs/vermerke.md, #982): the bot
// notes what it saw - it never makes a Vermerk of it. Two places call in:
//
// - signupService.submitSignup after every saved signup (web, Discord, bulk,
//   orga): a change to "Abmelden" before the start is a sign-off. Who stood in
//   the approved setup of the raid (any raid of its raid group, #811; the bench
//   does not count) signed off after the setup (`signoff_after_setup`, the
//   strongest hint); anybody else signed up before and leaving fewer than
//   `lateHours` hours before the start signed off late (`late_signoff`).
// - memberActivity.onMemberRemove: a person tied to the raids of the server he
//   left (an open roster of that server, a signup at one of its raids) left it
//   (`left_server`).
//
// Best-effort: nothing here may fail or slow down a signup, and nothing here
// goes into the answer a raider gets - the raider sees his signup as before.
// The thresholds of the hints live per server in
// config.serverSettings[guildId].vermerkeSignals (only the values a server set
// itself; DEFAULT_THRESHOLDS for the rest).
const signals = require("../../stores/userSignalsStore");
const { groupEvents } = require("../events/raidGroup");
const { approvedSetupOf } = require("../setup/setupCore");
const { guildOfEvent } = require("../discord/serverOf");
const { serverSetting } = require("../discord/serverSettings");

const HOUR_MS = 60 * 60 * 1000;

/** The defaults of the hints: how many events in how many days make a hint, and what "late" is. */
const DEFAULT_THRESHOLDS = Object.freeze({
    windowDays: 60,
    signoffAfterSetup: 2,
    lateSignoff: 2,
    lateHours: 12,
    noShow: 2,
    leftServer: 1,
});
/** The range each threshold may be set to (whole numbers). */
const THRESHOLD_LIMITS = Object.freeze({
    windowDays: [7, 180],
    signoffAfterSetup: [1, 20],
    lateSignoff: [1, 20],
    lateHours: [1, 72],
    noShow: [1, 20],
    leftServer: [1, 5],
});

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/** The thresholds a server set itself, cleaned: known keys with a whole number in range only. */
function normalizeThresholds(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const out = {};
    for (const [key, [min, max]] of Object.entries(THRESHOLD_LIMITS)) {
        const n = Number(src[key]);
        if (src[key] === null || src[key] === undefined || src[key] === "" || !Number.isFinite(n)) continue;
        out[key] = Math.min(max, Math.max(min, Math.round(n)));
    }
    return out;
}

/**
 * The thresholds the settings send, checked strictly (the API answers a wrong value with a 400 instead
 * of quietly moving it into range): `{ value, fields }` - `value` the own values of the server (a known
 * key left out, null or "" = the default again), `fields` the keys whose value is no whole number in
 * THRESHOLD_LIMITS, or ["thresholds"] when it is no object. Unknown keys are left out.
 */
function validateThresholds(raw) {
    if (raw === undefined || raw === null) return { value: {}, fields: [] };
    if (typeof raw !== "object" || Array.isArray(raw)) return { value: {}, fields: ["thresholds"] };
    const value = {};
    const fields = [];
    for (const [key, [min, max]] of Object.entries(THRESHOLD_LIMITS)) {
        const v = raw[key];
        if (v === undefined || v === null || v === "") continue;
        const n = typeof v === "number" || (typeof v === "string" && v.trim() !== "") ? Number(v) : NaN;
        if (!Number.isInteger(n) || n < min || n > max) fields.push(key);
        else value[key] = n;
    }
    return { value, fields };
}

/** The thresholds of `guildId`: its own values over DEFAULT_THRESHOLDS. */
function thresholdsOf(guildId, { config } = {}) {
    return { ...DEFAULT_THRESHOLDS, ...normalizeThresholds(serverSetting(guildId, "vermerkeSignals", { config, fallback: {} })) };
}

/** Whether `userId` stands in a group of the approved setup of any raid of `events` (the bench does not count). */
function placedIn(events, userId) {
    return events.some((e) => {
        const approved = approvedSetupOf(e);
        return !!approved && (approved.groups || []).some((g) => ((g && g.slots) || []).some((s) => s && str(s.userId) === userId));
    });
}

/**
 * Notes a sign-off of `userId` from `event` (the raid the signups are at - a group's first raid) if
 * the saved signup turned it into one: `saved.status === "absence"` while `previous` was none, before
 * the start. Returns the stored event, or null when there was nothing to note. Never throws.
 * @param {object} event the raid the signup was saved at
 * @param {string} userId
 * @param {object|null} previous the signup before the change
 * @param {object} saved the signup as stored
 * @param {{ now?: number, byOrga?: boolean, config?: object, name?: string }} [opts]
 */
function recordSignoff(event, userId, previous, saved, { now = Date.now(), byOrga = false, config, name = "" } = {}) {
    try {
        const uid = str(userId);
        if (!event || !uid || !saved || saved.status !== "absence") return null;
        if (previous && previous.status === "absence") return null;
        const startMs = (Number(event.startTime) || 0) * 1000;
        if (!startMs || now >= startMs) return null;
        const guildId = guildOfEvent(event);
        if (!guildId) return null;
        const hoursBefore = (startMs - now) / HOUR_MS;
        let kind = "";
        if (placedIn(groupEvents(event), uid)) kind = "signoff_after_setup";
        else if (previous && hoursBefore < thresholdsOf(guildId, { config }).lateHours) kind = "late_signoff";
        if (!kind) return null;
        const who = str(name) || str(previous && previous.character);
        return signals.recordEvent(guildId, uid, {
            kind, eventId: event.id, title: event.title, startTime: event.startTime, hoursBefore, byOrga: byOrga === true,
        }, { name: who, now });
    } catch {
        // a hint is never worth a failed signup
        return null;
    }
}

/**
 * Notes that `userId` left `guildId` - the caller checked the person is tied to the raids of that
 * server (an open roster of it, a signup at one of its raids). Never throws.
 */
function recordLeave(guildId, userId, { name = "", now = Date.now() } = {}) {
    try {
        return signals.recordEvent(guildId, userId, { kind: "left_server", eventId: "", title: "", startTime: 0 }, { name, now });
    } catch {
        return null;
    }
}

module.exports = { DEFAULT_THRESHOLDS, THRESHOLD_LIMITS, normalizeThresholds, validateThresholds, thresholdsOf, recordSignoff, recordLeave };
