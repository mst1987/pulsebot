// The orga's overview of absences (Roster › Abwesenheiten, October 2026): who
// is away when and for how long, what that does to the coming raids, and who
// keeps signing off from single raids without saying for how long.
//
//   buildOverview()   the weeks from this Monday on: every raider with an
//                     absence in them — the periods entered ("Abwesend
//                     eintragen", availabilityStore) as bars, single raids
//                     signed off from (an "absence" signup no period covers)
//                     as dots — the raids of those weeks with who is away and
//                     the gap that leaves in tanks and healers, four figures
//                     for the head, and the hints.
//   raiderDetail()    one raider: every entry (planned, running, over), what
//                     each did, and the last ten raids of their categories.
//
// A hint: at least HINT_MIN of the last HINT_OF raids of a category signed off
// one by one, none of them covered by a period. Only words, no verdict.
// The reasons are the raid lead's (the Discord panel says so): `withReasons`
// leaves them out for anyone else. Pure over the stores, no Discord call but
// the names the caller hands in.
const { DateTime } = require("luxon");
const store = require("../../stores/availabilityStore");
const eventStore = require("../../stores/eventStore");
const signupStore = require("../../stores/signupStore");
const profiles = require("../../stores/raiderProfileStore");
const settingsStore = require("../../stores/settingsStore");
const { categoryAttendanceFor } = require("../../stores/configSchema");
const { TIMEZONE } = require("../../config/timezone");
const { CLASSES } = require("../../config/gameVersions/classes");

const HINT_MIN = 3;
const HINT_OF = 4;
const HISTORY = 10;
/** A period this long or longer counts as "long". */
const LONG_DAYS = 14;
const MAX_WEEKS = 13;

const str = (v) => String(v === undefined || v === null ? "" : v).trim();
const IN = ["signed", "late"];

function dayOf(seconds) {
    return DateTime.fromSeconds(Number(seconds) || 0, { zone: TIMEZONE }).toFormat("yyyy-MM-dd");
}

function todayOf(now) {
    return DateTime.fromMillis(Number(now), { zone: TIMEZONE }).toFormat("yyyy-MM-dd");
}

/** Days from `from` to `to`, both counted. */
function lengthOf(from, to) {
    return Math.round(DateTime.fromISO(to, { zone: TIMEZONE }).diff(DateTime.fromISO(from, { zone: TIMEZONE }), "days").days) + 1;
}

function activeCategories(config) {
    return Array.isArray(config.categoryIds) ? config.categoryIds.map(String) : [];
}

/** Whether a category takes part in the overview (Einstellungen › Kategorien: "In Abwesenheiten zeigen"). */
const inOverview = (config, categoryId) => categoryAttendanceFor(config, categoryId).absences;

/** Own raids of the active categories (or one of them), not cancelled, between two days. */
function raidsBetween(from, to, { categoryId = "", config }) {
    const cats = activeCategories(config);
    const since = Math.floor(DateTime.fromISO(from, { zone: TIMEZONE }).startOf("day").toSeconds());
    return eventStore.listEvents("", { sinceSeconds: since })
        .filter((e) => e && e.startTime && e.status !== "cancelled")
        .filter((e) => !cats.length || cats.includes(str(e.categoryId)))
        .filter((e) => inOverview(config, e.categoryId))
        .filter((e) => !categoryId || str(e.categoryId) === categoryId)
        .filter((e) => {
            const day = dayOf(e.startTime);
            return day >= from && day <= to;
        })
        .sort((a, b) => Number(a.startTime) - Number(b.startTime));
}

/** A category's name: the Discord category's, else the one an event of it was created with. */
function categoryNameOf(categoryId, categoryNames, events = []) {
    if (categoryNames[categoryId]) return categoryNames[categoryId];
    const hit = events.find((e) => str(e.categoryId) === categoryId && str(e.categoryName));
    return hit ? str(hit.categoryName) : "";
}

/** Whether an entry covers a raid: its day and, for an entry of one category, that category. */
function entryCovers(entry, event) {
    const day = dayOf(event.startTime);
    if (day < entry.from || day > entry.to) return false;
    return !entry.categoryId || entry.categoryId === str(event.categoryId);
}

/** What a raider plays, as the overview shows them: the signup's first character, else the profile's first. */
function identityOf(userId, { signup = null, names = {} } = {}) {
    const profile = profiles.getProfile(userId) || { characters: [] };
    const fromSignup = signup && ((signup.characters || [])[0] || (signup.character ? { character: signup.character, spec: signup.spec } : null));
    const own = (profile.characters || [])[0];
    const character = (fromSignup && fromSignup.character) || (own && own.name) || "";
    const spec = (fromSignup && fromSignup.spec) || (own && own.specs && own.specs[0] && own.specs[0].key) || "";
    const { specRole, ...looks } = specLooks(spec);
    return {
        userId,
        name: str(names[userId]) || str(profile.name) || character || userId,
        character,
        spec,
        ...looks,
        role: (signup && signup.role) || specRole,
    };
}

/** A spec's label, class, class colour and icon from the rule set — the client never recomputes them. */
function specLooks(spec) {
    const info = profiles.specInfo(spec);
    if (!info) return { specLabel: "", classId: "", classColor: "", specIcon: "", specRole: "" };
    const cls = CLASSES.find((c) => c.id === info.classId);
    return { specLabel: info.label, classId: info.classId, classColor: cls ? cls.color : "", specIcon: info.icon || "", specRole: info.role || "" };
}

/**
 * The signups of one overview, each asked of the store once: `list(eventId)`
 * and `get(eventId, userId)`. The overview looks the same raids up per raider,
 * per role and per raid; asking the store each time made it quadratic in raids.
 * `get` answers from a list already read, else asks for that one signup.
 */
function signupLookup() {
    const lists = new Map();
    const byUser = new Map();
    const singles = new Map();
    const list = (eventId) => {
        const key = str(eventId);
        if (!lists.has(key)) {
            const rows = signupStore.listSignups(key);
            lists.set(key, rows);
            byUser.set(key, new Map(rows.map((s) => [str(s.userId), s])));
        }
        return lists.get(key);
    };
    const get = (eventId, userId) => {
        const key = str(eventId);
        const uid = str(userId);
        if (byUser.has(key)) return byUser.get(key).get(uid) || null;
        const single = `${key}\n${uid}`;
        if (!singles.has(single)) singles.set(single, signupStore.getSignup(key, uid));
        return singles.get(single);
    };
    return { list, get };
}

/** The latest signup of a raider among some raids (for the character the overview names). */
function latestSignup(userId, raids, signups) {
    for (let i = raids.length - 1; i >= 0; i -= 1) {
        const s = signups.get(raids[i].id, userId);
        if (s) return s;
    }
    return null;
}

function periodView(entry, { withReasons, categoryNames, now }) {
    const today = todayOf(now);
    return {
        id: entry.id,
        kind: entry.kind,
        from: entry.from,
        to: entry.to,
        days: lengthOf(entry.from, entry.to),
        comment: withReasons ? entry.comment : "",
        categoryId: entry.categoryId,
        categoryName: entry.categoryId ? (categoryNames[entry.categoryId] || "") : "",
        byOrga: !!entry.createdBy && entry.createdBy !== entry.userId,
        state: entry.to < today ? "past" : entry.from > today ? "planned" : "running",
    };
}

/** Who is away from one raid: absence signups, and the raiders a period covers who have no signup there. */
function awayFrom(event, entries, lookup) {
    const signups = lookup.list(event.id);
    const byUser = new Map(signups.map((s) => [str(s.userId), s]));
    const out = new Map();
    for (const s of signups) {
        if (s.status !== "absence") continue;
        const covered = entries.some((e) => e.userId === str(s.userId) && e.kind === "absence" && entryCovers(e, event));
        out.set(str(s.userId), { userId: str(s.userId), how: covered ? "period" : "single", signup: s });
    }
    for (const e of entries) {
        if (e.kind !== "absence" || out.has(e.userId) || byUser.has(e.userId) || !entryCovers(e, event)) continue;
        out.set(e.userId, { userId: e.userId, how: "period", signup: null });
    }
    return { signups, away: [...out.values()] };
}

/**
 * The hints: raiders who signed off from at least HINT_MIN of the last HINT_OF
 * raids of a category one by one, without a period covering any of them.
 */
function hintsFor({ now, config, entries, categoryNames, signups: lookup }) {
    const cats = activeCategories(config);
    const past = eventStore.listEvents("", { sinceSeconds: Math.floor(now / 1000) - 120 * 86400 })
        .filter((e) => e && e.startTime && e.status !== "cancelled" && Number(e.startTime) * 1000 < now)
        .filter((e) => !cats.length || cats.includes(str(e.categoryId)))
        .filter((e) => inOverview(config, e.categoryId));
    const byCategory = new Map();
    for (const e of past) {
        const key = str(e.categoryId);
        if (!byCategory.has(key)) byCategory.set(key, []);
        byCategory.get(key).push(e);
    }
    const out = [];
    for (const [categoryId, events] of byCategory) {
        const last = events.sort((a, b) => Number(b.startTime) - Number(a.startTime)).slice(0, HINT_OF);
        if (last.length < HINT_OF) continue;
        const counts = new Map();
        const signups = new Map();
        for (const event of last) {
            for (const s of lookup.list(event.id)) {
                const uid = str(s.userId);
                if (s.status !== "absence") continue;
                if (entries.some((en) => en.userId === uid && en.kind === "absence" && entryCovers(en, event))) continue;
                if (!counts.has(uid)) counts.set(uid, []);
                counts.get(uid).push(dayOf(event.startTime));
                // the newest of their sign-offs names the character they play
                if (!signups.has(uid)) signups.set(uid, s);
            }
        }
        for (const [userId, days] of counts) {
            if (days.length < HINT_MIN) continue;
            out.push({ userId, categoryId, categoryName: categoryNameOf(categoryId, categoryNames, last), count: days.length, of: last.length, days: days.sort(), signup: signups.get(userId) });
        }
    }
    return out;
}

/**
 * The overview of `weeks` weeks from this Monday on.
 * @param {object} opts { weeks, categoryId, now, config, withReasons, names: { userId: name }, categoryNames: { id: name } }
 */
function buildOverview({ weeks = 8, categoryId = "", now = Date.now(), config, withReasons = false, names = {}, categoryNames = {}, eventUrl = () => "" } = {}) {
    const cfg = config || settingsStore.getConfig();
    const span = Math.max(1, Math.min(MAX_WEEKS, Number(weeks) || 8));
    const todayDt = DateTime.fromMillis(Number(now), { zone: TIMEZONE }).startOf("day");
    const from = todayDt.minus({ days: todayDt.weekday - 1 }).toFormat("yyyy-MM-dd");
    const to = DateTime.fromISO(from, { zone: TIMEZONE }).plus({ days: span * 7 - 1 }).toFormat("yyyy-MM-dd");
    const today = todayDt.toFormat("yyyy-MM-dd");
    // one category, several ("a,b" or a list) or all of them ("")
    const picked = (Array.isArray(categoryId) ? categoryId : str(categoryId).split(",")).map(str).filter(Boolean);
    const inPick = (id) => !picked.length || picked.includes(str(id));

    const entries = store.listEntries()
        .filter((e) => e.to >= from && e.from <= to)
        .filter((e) => !e.categoryId || inPick(e.categoryId))
        .filter((e) => !e.categoryId || inOverview(cfg, e.categoryId));
    // every category of the weeks stays offered (and keeps its colour) while the view shows only the picked ones
    const allRaids = raidsBetween(from, to, { config: cfg });
    const raids = allRaids.filter((e) => inPick(e.categoryId));

    const signups = signupLookup();
    const raiders = new Map();
    const rowOf = (userId) => {
        if (!raiders.has(userId)) raiders.set(userId, { userId, periods: [], singles: [] });
        return raiders.get(userId);
    };
    for (const e of entries) rowOf(e.userId).periods.push(periodView(e, { withReasons, categoryNames, now }));

    const raidViews = raids.map((event) => {
        const { signups: rows, away } = awayFrom(event, entries, signups);
        const comp = event.composition || {};
        const dabei = rows.filter((s) => IN.includes(s.status));
        const roleOfAway = (a) => identityOf(a.userId, { signup: a.signup || latestSignup(a.userId, raids, signups) }).role;
        const roles = {};
        for (const role of ["tank", "healer"]) {
            const awayRole = away.filter((a) => roleOfAway(a) === role).length;
            const have = dabei.filter((s) => s.role === role).length;
            roles[role] = { need: Number(comp[role]) || 0, have, away: awayRole };
        }
        for (const a of away) {
            if (a.how === "single") rowOf(a.userId).singles.push({ eventId: event.id, day: dayOf(event.startTime), title: event.title || "" });
        }
        return {
            id: event.id,
            title: event.title || "",
            startTime: Number(event.startTime) || 0,
            day: dayOf(event.startTime),
            categoryId: str(event.categoryId),
            categoryName: categoryNameOf(str(event.categoryId), categoryNames, [event]),
            size: Number(event.size) || 0,
            signed: dabei.length,
            away: away.length,
            roles,
            absent: away.map((a) => {
                const period = entries.find((e) => e.userId === a.userId && e.kind === "absence" && entryCovers(e, event));
                return {
                    userId: a.userId,
                    how: a.how,
                    until: period ? period.to : "",
                    comment: withReasons && period ? period.comment : "",
                };
            }),
            url: eventUrl(event) || "",
        };
    });

    const hints = hintsFor({ now, config: cfg, entries: store.listEntries(), categoryNames, signups })
        .filter((h) => inPick(h.categoryId));

    const rows = [...raiders.values()].map((r) => {
        const id = identityOf(r.userId, { signup: latestSignup(r.userId, raids, signups), names });
        const absences = r.periods.filter((p) => p.kind === "absence");
        const longest = absences.reduce((n, p) => Math.max(n, p.days), 0);
        const awayToday = absences.some((p) => p.from <= today && p.to >= today) || r.singles.some((s) => s.day === today);
        const found = hints.find((h) => h.userId === r.userId);
        const hint = found ? { categoryId: found.categoryId, categoryName: found.categoryName, count: found.count, of: found.of, days: found.days } : null;
        const firstDay = [...absences.map((p) => p.from), ...r.singles.map((s) => s.day)].sort()[0] || "9999";
        return { ...id, periods: r.periods, singles: r.singles, longest, long: longest >= LONG_DAYS, awayToday, hint, onlyPresence: !absences.length && !r.singles.length, firstDay };
    }).sort((a, b) => Number(b.awayToday) - Number(a.awayToday) || b.longest - a.longest || a.firstDay.localeCompare(b.firstDay) || a.name.localeCompare(b.name));

    // the head's four figures
    const nextMonday = DateTime.fromISO(from, { zone: TIMEZONE }).plus({ days: 7 });
    const nextFrom = nextMonday.toFormat("yyyy-MM-dd");
    const nextTo = nextMonday.plus({ days: 6 }).toFormat("yyyy-MM-dd");
    const awayIn = (r, a, b) => r.periods.some((p) => p.kind === "absence" && p.from <= b && p.to >= a) || r.singles.some((s) => s.day >= a && s.day <= b);
    const upcoming = raidViews.filter((r) => r.day >= today);
    const biggest = upcoming.reduce((best, r) => (!best || r.away > best.away ? r : best), null);
    const tiles = {
        today: rows.filter((r) => r.awayToday).map((r) => r.userId),
        nextWeek: rows.filter((r) => awayIn(r, nextFrom, nextTo)).map((r) => r.userId),
        long: rows.filter((r) => r.long && r.periods.some((p) => p.kind === "absence" && p.to >= today)).map((r) => r.userId),
        biggest: biggest && biggest.away ? { raidId: biggest.id, day: biggest.day, title: biggest.title, away: biggest.away, healers: biggest.roles.healer.away, tanks: biggest.roles.tank.away } : null,
    };

    return {
        from, to, today, weeks: span,
        categories: [...new Set(allRaids.map((r) => str(r.categoryId)))].map((id) => ({ id, name: categoryNameOf(id, categoryNames, allRaids) })),
        picked,
        raids: raidViews,
        raiders: rows,
        hints: hints.map(({ signup, ...h }) => ({ ...h, ...identityOf(h.userId, { signup: latestSignup(h.userId, raids, signups) || signup, names }) })),
        tiles,
    };
}

/**
 * One raider: every entry with what it did, and the last HISTORY raids of the
 * categories they raid in (a signup there in the last 120 days) — in, off, or
 * no answer.
 */
function raiderDetail(userId, { now = Date.now(), config, withReasons = false, names = {}, categoryNames = {} } = {}) {
    const uid = str(userId);
    const cfg = config || settingsStore.getConfig();
    const cats = activeCategories(cfg);
    const entries = store.listEntries({ userId: uid }).map((e) => {
        const applied = Object.values(e.applied || {});
        return { ...periodView(e, { withReasons, categoryNames, now }), done: applied.filter((a) => a && a.ok).length, character: e.character, spec: e.spec };
    }).sort((a, b) => b.from.localeCompare(a.from));
    const past = eventStore.listEvents("", { sinceSeconds: Math.floor(now / 1000) - 120 * 86400 })
        .filter((e) => e && e.startTime && e.status !== "cancelled" && Number(e.startTime) * 1000 < now)
        .filter((e) => !cats.length || cats.includes(str(e.categoryId)))
        .filter((e) => inOverview(cfg, e.categoryId))
        .sort((a, b) => Number(b.startTime) - Number(a.startTime));
    const signups = signupLookup();
    const theirs = new Set(past.filter((e) => signups.get(e.id, uid)).map((e) => str(e.categoryId)));
    const history = past.filter((e) => theirs.has(str(e.categoryId))).slice(0, HISTORY).reverse().map((e) => {
        const s = signups.get(e.id, uid);
        return { eventId: e.id, day: dayOf(e.startTime), title: e.title || "", status: !s ? "none" : s.status === "absence" ? "off" : IN.includes(s.status) ? "in" : "other" };
    });
    const count = (status) => history.filter((h) => h.status === status).length;
    return {
        ...identityOf(uid, { signup: latestSignup(uid, past.slice().reverse(), signups), names }),
        entries,
        history,
        counts: { in: count("in"), off: count("off"), none: count("none"), other: count("other") },
    };
}

module.exports = { buildOverview, raiderDetail, HINT_MIN, HINT_OF, LONG_DAYS, MAX_WEEKS };
