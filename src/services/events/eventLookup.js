// Raid events for the bot's lookups (/raids, /raid — issue #265), read through
// loadEventGroups() like every page of the web menu, so whatever feeds that
// (Raid-Helper today, EventHelper's own events later) reaches the bot too.
const { loadEventGroups, eventLookbackSince } = require("./raidEventGroups");
const { eventGuildId } = require("../discord/guildRoles");
const { signupStatus } = require("../../utils/attendance");

/** What a signup status reads as in a reply. */
const STATUS_LABELS = {
    signed: "angemeldet",
    late: "kommt später",
    tentative: "vorläufig",
    bench: "Bank",
    absence: "abgemeldet",
};
const STATUS_ICONS = { signed: "✅", late: "🕒", tentative: "❔", bench: "🪑", absence: "❌" };

/**
 * The events as one flat list, oldest first: `{ events, error }`.
 * `past: true` includes the raids of the lookback window, else only upcoming ones.
 */
async function listEvents({ past = false, guildId = eventGuildId() } = {}) {
    const { groups, error } = await loadEventGroups(guildId, past ? { sinceSeconds: eventLookbackSince() } : {});
    const events = [];
    const seen = new Set();
    for (const group of groups || []) {
        for (const ev of group.events || []) {
            if (!ev || seen.has(ev.id)) continue;
            seen.add(ev.id);
            events.push({ ...ev, categoryName: group.categoryName || "" });
        }
    }
    events.sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
    return { events, error };
}

/** One user's status in an event ("signed", "absence", …), "" when they have not reacted. */
function statusOf(event, userId) {
    const uid = String(userId || "");
    const signUp = [...((event && event.signUps) || [])].reverse().find((s) => s && String(s.userId) === uid);
    return signUp ? signupStatus(signUp) : "";
}

/** How many reactions of each status an event has: `{ signed, late, tentative, bench, absence }`. */
function statusCounts(event) {
    const counts = { signed: 0, late: 0, tentative: 0, bench: 0, absence: 0 };
    const latest = new Map();
    for (const s of (event && event.signUps) || []) {
        if (!s) continue;
        latest.set(s.userId ? String(s.userId) : Symbol("anon"), s);
    }
    for (const s of latest.values()) counts[signupStatus(s)] += 1;
    return counts;
}

module.exports = { STATUS_LABELS, STATUS_ICONS, listEvents, statusOf, statusCounts };
