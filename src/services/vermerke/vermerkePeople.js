// Who the Vermerke page can pick and what it shows beside a person (#980):
// the person search of the "Vermerk anlegen" dialog - the members of the active
// server plus the people who left it, found through their signups of the last
// year -, the raids of the last four weeks a note can point at, and which listed
// people are no longer on the server. Best effort: without the bot or the
// member list nobody is marked as gone (`gone: null`), the signups still count.
// The member list runs on page requests, so it is raced against NAME_FETCH_MS
// (a cold cache can take 25 s): on a timeout it counts as not there (null).
const discord = require("../discord/discord");
const { listStoredEvents } = require("../events/eventSources");

const MAX_RESULTS = 25;
const RECENT_DAYS = 28;
const MAX_RECENT = 30;
// how far back the signups of people who left are searched
const SIGNUP_LOOKBACK_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;
// a raid signup that is no participation (Raid-Helper's pseudo specs and our own statuses)
const NOT_THERE = new Set(["absence", "absent", "declined", "decline", "tentative", "bench"]);
const TIMED_OUT = Symbol("timed out");

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/** Race a promise against a timer: the value, or `fallback` once `ms` have passed. */
function within(promise, ms, fallback) {
    return Promise.race([
        promise,
        new Promise((resolve) => {
            const timer = setTimeout(() => resolve(fallback), ms);
            if (timer.unref) timer.unref();
        }),
    ]);
}

/**
 * The members of `guildId` as a Map id -> { name, keys } (keys: display name, global name and
 * username, lower case, for the search), or null when the list cannot be had in time.
 */
async function memberListOf(guildId, { waitMs = discord.NAME_FETCH_MS || 5000 } = {}) {
    const gid = str(guildId);
    const guild = gid && discord.isOnline() ? discord.getGuild(gid) : null;
    if (!guild) return null;
    let list;
    try {
        list = await within(discord.fetchGuildMembersCached(gid, guild), waitMs, TIMED_OUT);
    } catch {
        return null;
    }
    if (list === TIMED_OUT || !Array.isArray(list) || !list.length) return null;
    const out = new Map();
    for (const m of list) {
        if (!m || !m.id || (m.user && m.user.bot)) continue;
        const user = m.user || {};
        const name = str(m.displayName || user.globalName || user.username || m.id);
        const keys = [...new Set([name, str(user.globalName), str(user.username)].filter(Boolean).map((k) => k.toLowerCase()))];
        out.set(String(m.id), { name, keys });
    }
    return out;
}

/** The members of `guildId` as a Map id -> display name, or null when the list cannot be had in time. */
async function membersOf(guildId, options) {
    const list = await memberListOf(guildId, options);
    return list ? new Map([...list].map(([id, m]) => [id, m.name])) : null;
}

/** The people of the stored raids of `guildId` of the last year, newest raid first: Map id -> the name they signed up with. */
function signupPeopleOf(guildId, { now = Date.now(), days = SIGNUP_LOOKBACK_DAYS } = {}) {
    const from = Math.floor((now - days * DAY_MS) / 1000);
    const out = new Map();
    for (const ev of listStoredEvents(guildId, { now })) {
        if (Number(ev.startTime) < from) continue;
        for (const s of Array.isArray(ev.signUps) ? ev.signUps : []) {
            const uid = str(s && s.userId);
            if (!uid || out.has(uid)) continue;
            out.set(uid, str(s.name || s.character || ""));
        }
    }
    return out;
}

/**
 * The person search: members first (by name), then those who left, each
 * matching the query on the display name, the global name or the username (members) or
 * the signup name, or the exact id. `gone` is true for a person only known from
 * signups, null when the member list is not there to tell.
 * @returns {Promise<{ results: { userId: string, name: string, gone: boolean|null }[] }>}
 */
async function searchPeople(guildId, query = "", { limit = MAX_RESULTS, now = Date.now(), waitMs } = {}) {
    const q = str(query).toLowerCase();
    const members = await memberListOf(guildId, waitMs === undefined ? {} : { waitMs });
    const fromSignups = signupPeopleOf(guildId, { now });
    const results = [];
    const seen = new Set();
    const add = (userId, name, keys, gone) => {
        if (seen.has(userId)) return;
        seen.add(userId);
        const shown = name || userId;
        if (q && userId !== q && !keys.concat(shown.toLowerCase()).some((k) => k.includes(q))) return;
        results.push({ userId, name: shown, gone });
    };
    if (members) for (const [id, m] of members) add(id, m.name, m.keys, false);
    for (const [id, name] of fromSignups) {
        const m = members && members.get(id);
        add(id, (m && m.name) || name, m ? m.keys : [name.toLowerCase()], members ? !m : null);
    }
    results.sort((a, b) => Number(a.gone === true) - Number(b.gone === true) || a.name.localeCompare(b.name));
    return { results: results.slice(0, Math.max(1, Math.min(MAX_RESULTS, Number(limit) || MAX_RESULTS))) };
}

/**
 * The raids of `guildId` that started in the last four weeks, newest first, and
 * whether `userId` was signed up for each (`signed`) - the chips of the dialog.
 * A cancelled raid is left out: nobody missed it.
 * @returns {{ eventId: string, title: string, startTime: number, signed: boolean }[]}
 */
function recentRaids(guildId, userId = "", { now = Date.now(), days = RECENT_DAYS } = {}) {
    const from = Math.floor((now - days * DAY_MS) / 1000);
    const nowSec = Math.floor(now / 1000);
    const uid = str(userId);
    return listStoredEvents(guildId, { now })
        .filter((ev) => Number(ev.startTime) >= from && Number(ev.startTime) <= nowSec && ev.status !== "cancelled")
        .slice(0, MAX_RECENT)
        .map((ev) => {
            const own = uid ? (ev.signUps || []).find((s) => str(s && s.userId) === uid) : null;
            const marks = own ? [own.status, own.className, own.specName].map((v) => str(v).toLowerCase()) : [];
            return {
                eventId: str(ev.id),
                title: str(ev.title) || str(ev.channelName),
                startTime: Number(ev.startTime) || 0,
                signed: !!own && !marks.some((m) => NOT_THERE.has(m)),
            };
        });
}

module.exports = { searchPeople, recentRaids, membersOf, signupPeopleOf, MAX_RESULTS, RECENT_DAYS, SIGNUP_LOOKBACK_DAYS };
