// The write side of the orga's hint at signup (docs/vermerke.md, #983): who
// signs up for a raid for the first time is queued here, per server, for about
// two minutes; then one message with all of them goes to the orga. Which of them
// carry a warning or a shadowban - and the post itself - is decided by
// orgaSignupNotice.js, which the bot process registers as the flush handler
// (web/http/jobs.js).
//
// This module sits on the signup path every raider uses (signupService), so it
// reads no Vermerk and loads nothing that does (the require closure of the
// raider pages is checked by test/services/vermerke/vermerkeNeverToPerson.test.js).
// It only knows the server's switch and who signed up.
//
// Best-effort: nothing here may fail or slow down a signup, and nothing changes
// the answer the raider gets.
//
// The switch per server: config.serverSettings[guildId].vermerkeOrgaNotice =
// { enabled: boolean, level: "warning" | "shadowban" } - off by default; "warning"
// = a warning or a shadowban, "shadowban" = only a shadowban.
const { guildOfEvent } = require("../discord/servers/serverOf");
const { serverSetting } = require("../discord/servers/serverSettings");
const marks = require("../../stores/discord/orgaSignupNoticeStore");

const BUFFER_MS = 2 * 60 * 1000;
const NOTICE_LEVELS = ["warning", "shadowban"];
const NOTICE_DEFAULT = Object.freeze({ enabled: false, level: "warning" });

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/** The switch as stored (anything unknown is the default). */
function normalizeOrgaNotice(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return {
        enabled: src.enabled === true,
        level: NOTICE_LEVELS.includes(src.level) ? src.level : NOTICE_DEFAULT.level,
    };
}

/**
 * A switch sent by the settings: `fields` names what is not valid (nothing is
 * saved then). Left out = the default.
 * @returns {{ value: { enabled: boolean, level: string }, fields: string[] }}
 */
function validateOrgaNotice(raw) {
    if (raw === undefined || raw === null) return { value: { ...NOTICE_DEFAULT }, fields: [] };
    if (typeof raw !== "object" || Array.isArray(raw)) return { value: { ...NOTICE_DEFAULT }, fields: ["orgaNotice"] };
    const fields = [];
    if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") fields.push("enabled");
    if (raw.level !== undefined && !NOTICE_LEVELS.includes(raw.level)) fields.push("level");
    return { value: normalizeOrgaNotice(raw), fields };
}

/** The switch of one server. */
function orgaNoticeOf(guildId, { config } = {}) {
    return normalizeOrgaNotice(serverSetting(guildId, "vermerkeOrgaNotice", { config, fallback: NOTICE_DEFAULT }));
}

/**
 * A first signup: a status that is not "Abmelden", with no signup before or
 * only a sign-off (somebody who said "I am away" and now comes after all).
 */
function isFirstSignup(previous, signup) {
    if (!signup || signup.status === "absence") return false;
    return !previous || previous.status === "absence";
}

let handler = null;
// guildId -> { timer, items: [{ eventId, categoryId, title, startTime, userId, name, at }] }
const pending = new Map();

/** The bot process hands in what turns a batch into a post: `(guildId, items) => Promise`. null = none. */
function setFlushHandler(fn) {
    handler = typeof fn === "function" ? fn : null;
}

/** Post the batch of one server now (the timer calls it). Never throws. */
async function flush(guildId) {
    const batch = pending.get(guildId);
    if (!batch) return;
    pending.delete(guildId);
    clearTimeout(batch.timer);
    if (!handler) {
        console.log(`[orgaSignupNotice] ${batch.items.length} Anmeldung(en) auf ${guildId} nicht geprüft: kein Bot-Prozess.`);
        return;
    }
    try {
        await handler(guildId, batch.items);
    } catch (e) {
        console.warn(`[orgaSignupNotice] Hinweis für ${guildId} fehlgeschlagen: ${(e && e.message) || e}`);
    }
}

function enqueue(guildId, item) {
    let batch = pending.get(guildId);
    if (!batch) {
        // A fixed window from the first signup on: a busy evening still gets its message after two minutes.
        const timer = setTimeout(() => flush(guildId), BUFFER_MS);
        if (timer && typeof timer.unref === "function") timer.unref();
        batch = { timer, items: [] };
        pending.set(guildId, batch);
    }
    batch.items.push(item);
}

/**
 * Called by signupService.submitSignup after every saved signup. Every first
 * signup for this raid (a group's first raid, #811: one line per night) sets the
 * mark - also with the switch off and when the orga entered the person, so a
 * later sign-off and signup again never counts as a first one. Only queued when
 * the person signed up themselves on a server with the hint switched on.
 * Returns whether it queued. Never throws.
 * @param {object} event the raid the signup was saved at
 * @param {string} userId
 * @param {object|null} previous the signup before the change
 * @param {object} saved the signup as stored
 * @param {{ now?: number, config?: object, name?: string, byOrga?: boolean }} [opts]
 */
function noteSignup(event, userId, previous, saved, { now = Date.now(), config, name = "", byOrga = false } = {}) {
    try {
        const uid = str(userId);
        if (!event || !uid || !isFirstSignup(previous, saved)) return false;
        if (!marks.markOnce(event.id, uid, { now })) return false;
        if (byOrga === true) return false;
        const guildId = guildOfEvent(event);
        if (!guildId || !orgaNoticeOf(guildId, { config }).enabled) return false;
        enqueue(guildId, {
            eventId: str(event.id), categoryId: str(event.categoryId), title: str(event.title), startTime: Number(event.startTime) || 0,
            // The line reads "@mention (Char)"; without a character the display name instead (web and bot alike)
            userId: uid, name: str(saved.character) || str(name), at: now,
        });
        return true;
    } catch (e) {
        console.warn(`[orgaSignupNotice] Anmeldung nicht vorgemerkt: ${(e && e.message) || e}`);
        return false;
    }
}

/** Drop every batch and its timer (stopping the bot, tests). */
function clearPending() {
    for (const batch of pending.values()) clearTimeout(batch.timer);
    pending.clear();
}

/** The queued servers and their counts (tests). */
function pendingCounts() {
    return Object.fromEntries([...pending.entries()].map(([g, b]) => [g, b.items.length]));
}

module.exports = {
    BUFFER_MS, NOTICE_LEVELS, NOTICE_DEFAULT, normalizeOrgaNotice, validateOrgaNotice, orgaNoticeOf, isFirstSignup,
    noteSignup, setFlushHandler, flush, clearPending, pendingCounts,
};
