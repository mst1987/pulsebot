// "Dabei seit" for the loot council (#668): how long a raider has belonged to a
// raid, so that belonging can count in the need score ("Zugehörigkeit") — the
// longer somebody is part of the raid, the higher their claim.
//
// "Dabei seit" is the EARLIEST of what the bot knows:
//   - the roster (stores/rosterStore.js): the member's `since` and the oldest
//     history line about them. `since` is the date of the last *status* change,
//     and every migrated roster carries the migration date for everyone, so on
//     its own it would make a two-year veteran look new — the earliest date wins
//     for exactly that reason. A person's date counts for all their characters
//     in that roster.
//   - their first raid in the category: a stored event of the category whose log
//     evaluation has the character in its roster, or — for a roster member — a
//     signup ("signed"/"late") of their Discord account;
//   - their first loot in the category (any award, also an off-spec roll: they
//     were there).
// Without a category ("Alle Raid-Kategorien") every roster and every category's
// raids and loot count. Nothing known → no date, and the tenure part is 0.
//
// Bounded like the council's other walks: only the newest MAX_LOGS logs of the
// category are opened (the roster slice of their report, reportStore.getReportRoster).
// That reaches back far further than the default 90-day saturation needs.
const { listStoredEvents } = require("../events/eventSources");
const { listLogs } = require("../../stores/logStore");
const { getReportRoster } = require("../../stores/reportStore");
const { listRosters, rosterForCategory } = require("../../stores/rosterStore");
const { characterKeyOf, nameKeyOf } = require("../../utils/loot/lootImport");

const DAY = 24 * 60 * 60 * 1000;
const MAX_LOGS = 80;
const ATTENDED = new Set(["signed", "late"]);

/** An event's start in ms (stored events carry seconds). */
const startMs = (ev) => {
    const n = Number(ev && ev.startTime) || 0;
    return n > 0 && n < 1e12 ? n * 1000 : n;
};
const isoMs = (iso) => {
    const t = Date.parse(String(iso || ""));
    return Number.isFinite(t) ? t : 0;
};
const earlier = (a, b) => (!a ? b : !b ? a : Math.min(a, b));

/** The rosters that count: the category's, or every one without a category. */
function rostersFor(categoryId) {
    if (categoryId) {
        const r = rosterForCategory(categoryId);
        return r ? [r] : [];
    }
    return listRosters("");
}

/**
 * Who the rosters know: character name key -> person { userId, since }, where
 * `since` is the earliest roster date of that person.
 */
function rosterPeople(rosters) {
    const byChar = new Map();
    const people = new Map();
    for (const roster of rosters) {
        const firstHistory = new Map();
        for (const h of roster.history || []) {
            const at = isoMs(h.at);
            if (h.userId && at) firstHistory.set(h.userId, earlier(firstHistory.get(h.userId), at));
        }
        for (const [userId, m] of Object.entries(roster.members || {})) {
            const since = earlier(isoMs(m.since), firstHistory.get(userId) || 0);
            const person = people.get(userId) || { userId, since: 0, keys: new Set() };
            person.since = earlier(person.since, since);
            for (const key of m.chars || []) person.keys.add(nameKeyOf(key));
            for (const name of Object.values(m.charNames || {})) person.keys.add(nameKeyOf(name));
            people.set(userId, person);
        }
    }
    for (const person of people.values()) {
        for (const key of person.keys) if (key && !byChar.has(key)) byChar.set(key, person);
    }
    return { byChar, people };
}

/**
 * First raid per character key and per Discord account in the category
 * ("" = every category), from the stored events, their logs and signups.
 */
function firstRaids(categoryId, now) {
    const byChar = new Map();
    const byUser = new Map();
    const events = new Map();
    for (const ev of listStoredEvents("")) {
        if (!ev || !ev.categoryId) continue;
        if (categoryId && ev.categoryId !== categoryId) continue;
        const at = startMs(ev);
        if (!at || at > now) continue;
        events.set(String(ev.id || ev.eventId || ""), at);
        for (const s of Array.isArray(ev.signUps) ? ev.signUps : []) {
            const uid = String((s && s.userId) || "");
            if (uid && ATTENDED.has(String(s.status || "signed"))) byUser.set(uid, earlier(byUser.get(uid), at));
        }
    }
    if (!events.size) return { byChar, byUser };
    const logs = listLogs()
        .filter((l) => l && l.eventId && l.reportRefId && events.has(String(l.eventId)))
        .sort((a, b) => events.get(String(b.eventId)) - events.get(String(a.eventId)))
        .slice(0, MAX_LOGS);
    for (const log of logs) {
        const at = events.get(String(log.eventId));
        const report = getReportRoster(String(log.reportRefId));
        const entries = (report && (report.roster && report.roster.length ? report.roster : report.players)) || [];
        for (const entry of entries) {
            const key = characterKeyOf(entry && entry.name);
            if (key) byChar.set(key, earlier(byChar.get(key), at));
        }
    }
    return { byChar, byUser };
}

/**
 * Everything "dabei seit" needs, read once per council request.
 *
 * @param {{ categoryId?: string, allLoot?: object[], now?: number }} opts
 * @returns {(key: string) => { joinedAt: number, source: "roster"|"raid"|"loot"|"" }}
 *   per council row key (a character key): the date and which source gave it
 */
function tenureContext({ categoryId = "", allLoot = [], now = Date.now() } = {}) {
    const cat = String(categoryId || "").trim();
    const { byChar: personOf } = rosterPeople(rostersFor(cat));
    const raids = firstRaids(cat, now);
    const firstLoot = new Map();
    for (const it of allLoot || []) {
        if (!it || !it.characterKey || !it.awardedAt) continue;
        if (cat && it.categoryId !== cat) continue;
        const key = nameKeyOf(it.characterKey);
        firstLoot.set(key, earlier(firstLoot.get(key), it.awardedAt));
    }

    return function joinedAtFor(rowKey) {
        const key = nameKeyOf(rowKey);
        const person = personOf.get(key);
        // A person's characters share one date: the alt they brought last
        // week does not make a veteran new.
        const keys = person ? [...person.keys] : [key];
        const candidates = [];
        if (person && person.since) candidates.push({ at: person.since, source: "roster" });
        for (const k of keys) {
            if (raids.byChar.get(k)) candidates.push({ at: raids.byChar.get(k), source: "raid" });
            if (firstLoot.get(k)) candidates.push({ at: firstLoot.get(k), source: "loot" });
        }
        if (person && raids.byUser.get(person.userId)) candidates.push({ at: raids.byUser.get(person.userId), source: "raid" });
        if (!candidates.length) return { joinedAt: 0, source: "" };
        candidates.sort((a, b) => a.at - b.at);
        return { joinedAt: candidates[0].at, source: candidates[0].source };
    };
}

/** Whole days since `joinedAt` (0 without a date). */
function tenureDays(joinedAt, now = Date.now()) {
    return joinedAt > 0 ? Math.max(0, Math.floor((now - joinedAt) / DAY)) : 0;
}

module.exports = { tenureContext, tenureDays, MAX_LOGS };
