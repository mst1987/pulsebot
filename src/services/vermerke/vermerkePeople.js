// Who the Vermerke page can pick and what it shows beside a person (#980):
// the person search of the "Vermerk anlegen" dialog - the members of the active
// server plus the people who left it, found through their earlier signups -,
// the raids of the last four weeks a note can point at, and which listed
// people are no longer on the server. Best effort: without the bot or the
// member list nobody is marked as gone (`gone: null`), the signups still count.
const discord = require("../discord/discord");
const { listStoredEvents } = require("../events/eventSources");

const MAX_RESULTS = 25;
const RECENT_DAYS = 28;
const MAX_RECENT = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
// a raid signup that is no participation (Raid-Helper's pseudo specs and our own statuses)
const NOT_THERE = new Set(["absence", "absent", "declined", "decline", "tentative", "bench"]);

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/** The members of `guildId` as a Map id -> display name, or null when the list cannot be had. */
async function membersOf(guildId) {
    const gid = str(guildId);
    const guild = gid && discord.isOnline() ? discord.getGuild(gid) : null;
    if (!guild) return null;
    let list;
    try {
        list = await discord.fetchGuildMembersCached(gid, guild);
    } catch {
        return null;
    }
    if (!Array.isArray(list) || !list.length) return null;
    const out = new Map();
    for (const m of list) {
        if (!m || !m.id || (m.user && m.user.bot)) continue;
        out.set(String(m.id), str(m.displayName || (m.user && (m.user.globalName || m.user.username)) || m.id));
    }
    return out;
}

/** The people of the stored raids of `guildId`, newest raid first: Map id -> the name they signed up with. */
function signupPeopleOf(guildId) {
    const out = new Map();
    for (const ev of listStoredEvents(guildId)) {
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
 * matching the query on the name. `gone` is true for a person only known from
 * signups, null when the member list is not there to tell.
 * @returns {Promise<{ results: { userId: string, name: string, gone: boolean|null }[] }>}
 */
async function searchPeople(guildId, query = "", { limit = MAX_RESULTS } = {}) {
    const q = str(query).toLowerCase();
    const members = await membersOf(guildId);
    const fromSignups = signupPeopleOf(guildId);
    const results = [];
    const seen = new Set();
    const add = (userId, name, gone) => {
        if (seen.has(userId)) return;
        seen.add(userId);
        const shown = name || userId;
        if (q && !shown.toLowerCase().includes(q) && userId !== q) return;
        results.push({ userId, name: shown, gone });
    };
    if (members) for (const [id, name] of members) add(id, name, false);
    for (const [id, name] of fromSignups) add(id, (members && members.get(id)) || name, members ? !members.has(id) : null);
    results.sort((a, b) => Number(a.gone === true) - Number(b.gone === true) || a.name.localeCompare(b.name));
    return { results: results.slice(0, Math.max(1, Math.min(MAX_RESULTS, Number(limit) || MAX_RESULTS))) };
}

/**
 * The raids of `guildId` that started in the last four weeks, newest first, and
 * whether `userId` was signed up for each (`signed`) - the chips of the dialog.
 * @returns {{ eventId: string, title: string, startTime: number, signed: boolean }[]}
 */
function recentRaids(guildId, userId = "", { now = Date.now(), days = RECENT_DAYS } = {}) {
    const from = Math.floor((now - days * DAY_MS) / 1000);
    const nowSec = Math.floor(now / 1000);
    const uid = str(userId);
    return listStoredEvents(guildId, { now })
        .filter((ev) => Number(ev.startTime) >= from && Number(ev.startTime) <= nowSec)
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

module.exports = { searchPeople, recentRaids, membersOf, signupPeopleOf, MAX_RESULTS, RECENT_DAYS };
