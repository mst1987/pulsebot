// The read side of the hints from the data (docs/vermerke.md, #982): the
// proposals the orga sees under "Hinweise" - never a Vermerk of their own. One
// hint = one person and one kind with at least the server's threshold of events
// inside its window (signalRecorder.js thresholdsOf):
//
//   signoff_after_setup  sign-offs while the person stood in the approved setup
//   late_signoff         sign-offs fewer than `lateHours` hours before the start
//   no_show              raid nights the orga set to "Nicht erschienen" (the
//                        attendance overrides, #677 - computed here, not stored twice)
//   left_server          left the server with a roster or characters
//
// What no longer counts: events before the orga's "Ausblenden" of that kind, and
// events before an active Vermerk with the matching reason (late_signoff for both
// sign-off kinds, no_show) - a hint comes back only with something new.
//
// Only the Vermerke routes load this module (it reads the notes);
// test/stores/userNotesStore.test.js keeps that list.
const signals = require("../../stores/userSignalsStore");
const notes = require("../../stores/userNotesStore");
const overrides = require("../../stores/attendanceOverridesStore");
const eventStore = require("../../stores/eventStore");
const signupStore = require("../../stores/signupStore");
const { thresholdsOf } = require("./signalRecorder");

const DAY_MS = 24 * 60 * 60 * 1000;

/** The kinds of hints, the threshold key of each and the Vermerk reason that covers it. */
const KIND_RULES = Object.freeze({
    signoff_after_setup: { threshold: "signoffAfterSetup", reason: "late_signoff" },
    late_signoff: { threshold: "lateSignoff", reason: "late_signoff" },
    no_show: { threshold: "noShow", reason: "no_show" },
    left_server: { threshold: "leftServer", reason: "" },
});

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/**
 * The no-shows of `guildId` in raids since `sinceMs`: `{ [userId]: [event] }` from the attendance
 * overrides of the server's own raids (one pass over the overrides, the raids looked up in one list).
 */
function noShowsOf(guildId, sinceMs) {
    const byId = new Map(eventStore.listEvents(guildId, { siblings: true, sinceSeconds: Math.floor(sinceMs / 1000) }).map((e) => [e.id, e]));
    const out = {};
    for (const [eventId, people] of Object.entries(overrides.listOverrides())) {
        const event = byId.get(eventId);
        if (!event) continue;
        for (const [userId, o] of Object.entries(people || {})) {
            if (!o || o.status !== "noShow") continue;
            // when the orga set it: a no-show entered after an "Ausblenden" is something new
            const at = Number(o.at) || (Number(event.startTime) || 0) * 1000;
            (out[userId] = out[userId] || []).push({ kind: "no_show", eventId, title: str(event.title), startTime: Number(event.startTime) || 0, at });
        }
    }
    return out;
}

/**
 * The hints of `guildId`, newest first:
 * `[{ userId, name, kind, count, windowDays, events: [{ eventId, title, startTime }], lastAt }]`.
 * @param {string} guildId
 * @param {{ now?: number, config?: object }} [opts]
 */
function signalsFor(guildId, { now = Date.now(), config } = {}) {
    const gid = str(guildId);
    if (!gid) return [];
    const limits = thresholdsOf(gid, { config });
    const since = now - limits.windowDays * DAY_MS;
    // per person and kind: the events inside the window
    const people = new Map();
    const add = (userId, name, e) => {
        if (!KIND_RULES[e.kind] || e.at < since || e.at > now) return;
        const p = people.get(userId) || { name: "", kinds: {} };
        if (!p.name && name) p.name = name;
        (p.kinds[e.kind] = p.kinds[e.kind] || []).push(e);
        people.set(userId, p);
    };
    for (const [userId, p] of Object.entries(signals.eventsFor(gid, { now }))) {
        for (const e of p.events) add(userId, p.name, e);
    }
    for (const [userId, list] of Object.entries(noShowsOf(gid, since))) {
        for (const e of list) add(userId, "", e);
    }
    if (!people.size) return [];
    const ignored = signals.ignoredFor(gid);
    const active = notes.activeEntriesMany(gid, [...people.keys()], { now });
    const out = [];
    for (const [userId, p] of people) {
        const covers = active[userId] || [];
        for (const [kind, events] of Object.entries(p.kinds)) {
            const rule = KIND_RULES[kind];
            // only what came after the orga's "Ausblenden" and after a Vermerk with the matching reason
            let after = Number((ignored[userId] || {})[kind]) || 0;
            for (const n of covers) if (rule.reason && n.reason === rule.reason) after = Math.max(after, Number(n.at) || 0);
            const counting = events.filter((e) => e.at > after).sort((a, b) => b.at - a.at);
            if (counting.length < limits[rule.threshold]) continue;
            out.push({
                userId,
                name: p.name || nameFromSignups(userId, counting),
                kind,
                count: counting.length,
                windowDays: limits.windowDays,
                events: counting.filter((e) => e.eventId).map((e) => ({ eventId: e.eventId, title: e.title, startTime: e.startTime })),
                lastAt: counting[0].at,
            });
        }
    }
    return out.sort((a, b) => b.lastAt - a.lastAt || a.userId.localeCompare(b.userId) || a.kind.localeCompare(b.kind));
}

/** A name for a person known only from no-shows: the character of a signup of one of the raids. */
function nameFromSignups(userId, events) {
    for (const e of events) {
        const s = e.eventId ? signupStore.getSignup(e.eventId, userId) : null;
        if (s && str(s.character)) return str(s.character);
    }
    return "";
}

/** "Ausblenden": the hint `kind` of `userId` stays away until a new event of that kind. Null on a bad kind. */
function ignoreSignal(guildId, userId, kind, { now = Date.now() } = {}) {
    return signals.ignore(guildId, userId, kind, { now });
}

module.exports = { KIND_RULES, signalsFor, ignoreSignal };
