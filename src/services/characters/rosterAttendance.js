// Attendance and role for the roster — the question a raid lead has before an
// invite: "war er zuletzt da, und was spielt er".
//
// Nothing is stored for it. Both answers are derived on read from what the bot
// already keeps:
//   * the stored events per raid category (eventSources.listStoredEvents: the
//     Raid-Helper snapshot with the signups captured while Raid-Helper still
//     returned them, and the EventHelper's own events with their signups);
//   * the logs assigned to those events (logStore.js) and the evaluation each
//     one produced (reportStore.js), whose roster says who actually stood there.
//
// How one raid night counts (#677): one status code per night, the first rule
// that applies wins:
//   - the orga set the night by hand (attendanceOverridesStore) -> that status
//   - in the log of that night                              -> "present"
//   - on the bench: in the setup's explicit bench, or signed
//     up as bench                                           -> "bench" (counts as present)
//   - no log, signed up (or late)                           -> "present"
//   - an absence entry (availabilityStore) covers the raid  -> "vacation" (excused, still missed)
//   - signed off for this raid                              -> "absence"
//   - the night has a log, signed/late, not in it            -> "bench" (detail
//     benchNotInLog; for now the orga counts these as bench, Oct 2026)
//   - tentative, placed in the approved setup, not in the
//     log                                                   -> "noShow" (no log: "present")
//   - tentative and not placed (or no setup known)          -> "tentative": neutral,
//     the night is shown but counts neither for nor against the quota (Oct 2026)
//   - no signup and not in the log                          -> "noSignup"
//   - no log and no raider assigned to the character        -> not counted at all:
//     without a Discord account behind the name there is nothing to compare.
// "present" and "bench" count for the quota (`attended`), "tentative" not at all
// (not in `total`), the other four are missed. Each night also carries a `detail` code (why: inLog, signed, late,
// benchSetup, notInLog, ...) and `reason`, the same in German words - kept for
// the bot's /anwesenheit lines, which read it as they always did.
// The window is the category's last RAID_WINDOW nights that carry any evidence
// (a signup or a log), not a calendar span: a raid that runs every week and one
// that runs every other week both get "the last 11 raids".
//
// Role (the second open question): what the character last played in a log —
// a hybrid's spec in the loot export says little about whether they healed
// last Thursday — and the spec only when no log knows them.
//
// Which characters count for an account (attendanceForAccounts): the ones the
// caller names, every character the orga assigned the account in ANY category
// (raiderCharactersStore - a rogue assigned under "TBC Montag" also stands for
// the account in "PUG Raids"), and per night the characters of its own signup.
const { listStoredEvents } = require("../events/eventSources");
const { listLogs } = require("../../stores/logStore");
const { listReports, getReport } = require("../../stores/reportStore");
const { characterKeyOf } = require("../../utils/loot/lootImport");
const { contentsForText, content: contentMeta } = require("../../config/tbcContent");
const { LEGACY_VERSION } = require("../../config/gameVersions");
const { knownVersion } = require("../events/mainVersion");
const { DateTime } = require("luxon");
const { TIMEZONE } = require("../../config/timezone");
const eventStore = require("../../stores/eventStore");
const availabilityStore = require("../../stores/availabilityStore");
const overridesStore = require("../../stores/attendanceOverridesStore");
const { benchAndPool } = require("../setup/setupCore");
const { listAllAssignments } = require("../../stores/raiderCharactersStore");

/** How many raid nights of a category attendance looks back over. */
const RAID_WINDOW = 11;

// Same bound as charGearIssues.js: far enough back for everyone who raided
// recently, without walking years of report files on every page view.
const MAX_REPORTS = 40;

/** The status codes of a night, in the order the tooltip lists them. */
const STATUSES = ["present", "bench", "noSignup", "absence", "vacation", "noShow", "tentative"];
/** The statuses that count for the quota. */
const ATTENDED = new Set(["present", "bench"]);
/** Whether a night counts at all: "tentative" (not placed) is shown, but neither attended nor missed. */
const counts = (night) => night.status !== "tentative";

/** The German words of the detail codes (`reason`, read by the bot's /anwesenheit). */
const DETAIL_WORDS = {
    inLog: "im Log",
    inLogClass: "im Log (Klasse passt)",
    signed: "angemeldet",
    late: "angemeldet (später)",
    benchSetup: "Ersatzbank (Setup)",
    benchSignup: "Ersatzbank",
    benchNotInLog: "angemeldet, nicht im Log (Ersatzbank)",
    vacation: "Urlaub",
    absence: "abgemeldet",
    notInLog: "nicht im Log",
    noSignup: "keine Anmeldung",
    tentative: "vorläufig",
    tentativePlaced: "vorläufig, aufgestellt",
    tentativeNotPlaced: "vorläufig, nicht aufgestellt (zählt nicht)",
};
const STATUS_WORDS = {
    present: "dabei", bench: "Ersatzbank", vacation: "Urlaub", absence: "abgemeldet", noSignup: "nicht angemeldet", noShow: "nicht erschienen",
    tentative: "vorläufig (zählt nicht)",
};

/** One night's verdict from a status and the detail that explains it. */
function verdict(status, detail) {
    return { attended: ATTENDED.has(status), status, detail, reason: DETAIL_WORDS[detail] || STATUS_WORDS[status] || "" };
}

/** A night the orga set by hand: the status, `detail` "override" and the override itself. */
function overrideVerdict(entry) {
    return {
        attended: ATTENDED.has(entry.status),
        status: entry.status,
        detail: "override",
        reason: `${STATUS_WORDS[entry.status] || entry.status} (von Hand)`,
        override: { status: entry.status, reason: entry.reason || "", by: entry.by || "", byName: entry.byName || "", at: entry.at || 0 },
    };
}

/** "yyyy-MM-dd" of a raid's start in server time (an absence entry's days are server days). */
function serverDay(seconds) {
    return DateTime.fromSeconds(Number(seconds) || 0, { zone: TIMEZONE }).toFormat("yyyy-MM-dd");
}

/** The accounts an absence entry (availabilityStore) covers this raid for: its day in the period, its category, not deselected. */
function vacationIds(entries, ev) {
    const day = serverDay(ev.startTime);
    const out = new Set();
    for (const e of entries) {
        if (day < e.from || day > e.to) continue;
        if (e.categoryId && String(ev.categoryId) !== e.categoryId) continue;
        if ((e.skip || []).includes(String(ev.id))) continue;
        out.add(String(e.userId));
    }
    return out;
}

/**
 * Who an own event's setup placed in a group (`placed`: a tentative among them
 * was expected) and who stood on its bench: the approved lineup's bench (the
 * frozen snapshot holds only the explicit bench), else the draft's explicit bench
 * (#517: the pool "Angemeldet" is no bench) - minus anybody placed in a group.
 */
function setupPlaces(setup) {
    if (!setup || typeof setup !== "object") return { placed: new Set(), bench: new Set() };
    const snapshot = setup.approved && Array.isArray(setup.approved.groups) ? setup.approved : null;
    const lineup = snapshot || setup;
    const placed = new Set();
    for (const part of [lineup, ...(Array.isArray(lineup.events) ? lineup.events : [])]) {
        for (const g of Array.isArray(part && part.groups) ? part.groups : []) {
            for (const slot of Array.isArray(g && g.slots) ? g.slots : []) if (slot && slot.userId) placed.add(String(slot.userId));
        }
    }
    const bench = snapshot ? (Array.isArray(snapshot.bench) ? snapshot.bench : []) : benchAndPool(setup).bench;
    return { placed, bench: new Set(bench.filter((b) => b && b.userId && !placed.has(String(b.userId))).map((b) => String(b.userId))) };
}

/** fn(), or `fallback` when it throws: the extra sources (setups, absences, overrides) are best-effort. */
function attempt(fn, fallback) {
    try {
        return fn();
    } catch {
        return fallback;
    }
}

// The raid a category mostly runs, as the icon of its final boss. Names checked
// against the zamimg CDN (the Archimonde icon only exists with its trailing "-").
const CONTENT_ICONS = {
    kara: "achievement_boss_princemalchezaar_02",
    gruul: "achievement_boss_gruul",
    mag: "achievement_boss_magtheridon",
    ssc: "achievement_boss_ladyvashj",
    tk: "achievement_boss_kael'thassunstrider_01",
    za: "achievement_boss_zuljin",
    hyjal: "achievement_boss_archimonde-",
    bt: "achievement_boss_illidan",
    swp: "achievement_boss_kiljaedan",
};

const TANK_SPECS = new Set(["protection", "prot", "tank", "feral tank", "guardian"]);
const HEALER_SPECS = new Set(["holy", "discipline", "disc", "restoration", "resto", "healer"]);

/** Role from a spec name alone: "tank" | "healer" | "dps", or "" when unknown. */
function roleFromSpec(className, spec) {
    const s = String(spec || "").trim().toLowerCase();
    if (!s) return "";
    if (TANK_SPECS.has(s)) return "tank";
    if (HEALER_SPECS.has(s)) return "healer";
    return className ? "dps" : "";
}

// Report files never change under the same generatedAt, so the condensed form
// is cached per id + timestamp (an RPB re-run rewrites the file and bumps it).
const condensedCache = new Map();

/** One evaluation reduced to who was in it and in which role. */
function condenseReport(meta) {
    const cacheKey = `${meta.id}:${meta.generatedAt || 0}`;
    const cached = condensedCache.get(cacheKey);
    if (cached) return cached;
    const report = getReport(meta.id) || {};
    const keys = new Set();
    // key -> class ("druid"), for the account-based attendance's class match
    const classes = {};
    for (const entry of report.roster || report.players || []) {
        const key = characterKeyOf(entry && entry.name);
        if (!key) continue;
        keys.add(key);
        const cls = String((entry && (entry.className || entry.class || entry.type)) || "").trim().toLowerCase();
        if (cls) classes[key] = cls;
    }
    // Same order as render.js's reportContext(): the healer analysis, WCL's tank
    // of any fight, then the RPB's roles for reports without the timeline.
    const roles = {};
    for (const p of (report.healers && report.healers.players) || []) {
        const key = characterKeyOf(p && p.name);
        if (key) roles[key] = "healer";
    }
    for (const f of (report.timeline && report.timeline.fights) || []) {
        const key = characterKeyOf(f && f.healers && f.healers.tank && f.healers.tank.name);
        if (key) roles[key] = "tank";
    }
    for (const [name, role] of Object.entries((report.rpb && report.rpb.roles) || {})) {
        const key = characterKeyOf(name);
        if (!key || roles[key]) continue;
        if (role === "Tank") roles[key] = "tank";
        else if (role === "Healer") roles[key] = "healer";
    }
    for (const key of keys) if (!roles[key]) roles[key] = "dps";
    const condensed = { id: meta.id, zone: meta.zone || report.zone || "", keys, classes, roles };
    condensedCache.set(cacheKey, condensed);
    return condensed;
}

/**
 * Everything attendance and role need, read once per request.
 *
 * @param {string} guildId  only events of this guild count ("" = all)
 * @param {{now?: number, maxReports?: number, versionId?: string}} opts  `versionId` (#543): only
 *   raid nights of that game version count — an own event's version, TBC for every other one
 */
function buildAttendanceContext(guildId, opts = {}) {
    const now = opts.now || Date.now();
    const maxReports = opts.maxReports > 0 ? opts.maxReports : MAX_REPORTS;
    const reports = listReports().slice(0, maxReports).map(condenseReport);
    const reportById = new Map(reports.map((r) => [String(r.id), r]));

    // event id -> the evaluations of its logs
    const reportsByEvent = new Map();
    for (const log of listLogs()) {
        if (!log || !log.eventId || !log.reportRefId) continue;
        const rep = reportById.get(String(log.reportRefId));
        if (!rep) continue;
        const list = reportsByEvent.get(String(log.eventId)) || [];
        list.push(rep);
        reportsByEvent.set(String(log.eventId), list);
    }

    // #677: the setups of own events (who stood on the bench), the absence entries (vacation) and the orga's overrides
    const setupById = new Map(attempt(() => eventStore.listEvents(guildId), [])
        .filter((e) => e && e.id && e.setup)
        .map((e) => [String(e.id), e.setup]));
    const absences = attempt(() => availabilityStore.listEntries(), []).filter((e) => e && e.kind === "absence" && e.userId);
    const overrides = attempt(() => overridesStore.listOverrides(), {});

    // category id -> its past raid nights with evidence, newest first
    const raidsByCategory = new Map();
    for (const ev of listStoredEvents(guildId)) {
        if (!ev || !ev.categoryId || !ev.startTime || ev.startTime > now) continue;
        if (opts.versionId && (knownVersion(ev.versionId) || LEGACY_VERSION) !== opts.versionId) continue;
        const logs = reportsByEvent.get(String(ev.id)) || [];
        const signUps = Array.isArray(ev.signUps) ? ev.signUps : [];
        if (!logs.length && !signUps.length) continue;
        const list = raidsByCategory.get(ev.categoryId) || [];
        const places = setupPlaces(setupById.get(String(ev.id)));
        list.push({
            id: String(ev.id), title: ev.title || "", startTime: ev.startTime, signUps, logs,
            bench: places.bench,
            // who stood in a group: a tentative who did was expected, one who did not was not
            placed: places.placed,
            vacation: vacationIds(absences, ev),
            overrides: overrides[String(ev.id)] || {},
        });
        raidsByCategory.set(ev.categoryId, list);
    }
    // every night, newest first, for callers that pick their own kind of raid (attendanceForAccounts' `comparable`)
    const allRaidsByCategory = new Map();
    for (const [id, list] of raidsByCategory) {
        list.sort((a, b) => b.startTime - a.startTime);
        allRaidsByCategory.set(id, list);
        raidsByCategory.set(id, list.slice(0, RAID_WINDOW));
    }

    // newest role per character (reports are newest first, first hit wins)
    const roleByKey = {};
    for (const rep of reports) {
        for (const [key, role] of Object.entries(rep.roles)) {
            if (!roleByKey[key]) roleByKey[key] = role;
        }
    }

    return { raidsByCategory, allRaidsByCategory, roleByKey };
}

/**
 * How one night went for one character of these accounts — see the header for
 * the rules. `{ attended, status, detail, reason, override? }`, or null when the
 * night does not count for it.
 */
function nightStatus(raid, key, userIds) {
    const ids = (userIds || []).map(String);
    const overrides = raid.overrides || {};
    const manual = ids.map((id) => overrides[id]).find(Boolean);
    if (manual) return overrideVerdict(manual);
    const signUp = [...(raid.signUps || [])].reverse().find((s) => s && ids.includes(String(s.userId)));
    const status = signUp ? String(signUp.status || "signed") : "";
    const logged = (raid.logs || []).length > 0;
    if (logged && raid.logs.some((r) => r.keys.has(key))) return verdict("present", "inLog");
    if (!logged && !ids.length) return null;
    if (ids.some((id) => raid.bench && raid.bench.has(id))) return verdict("bench", "benchSetup");
    if (status === "bench") return verdict("bench", "benchSignup");
    if (!logged && (status === "signed" || status === "late")) return verdict("present", status);
    if (ids.some((id) => raid.vacation && raid.vacation.has(id))) return verdict("vacation", "vacation");
    if (status === "absence") return verdict("absence", "absence");
    if (status === "tentative") {
        // only somebody the orga set up was expected; a "maybe" left out of the setup missed nothing
        if (ids.some((id) => raid.placed && raid.placed.has(id))) return verdict(logged ? "noShow" : "present", "tentativePlaced");
        return verdict("tentative", "tentativeNotPlaced");
    }
    // signed up but missing from the log: counted as bench for now (the orga's call, Oct 2026)
    if (logged && (status === "signed" || status === "late")) return verdict("bench", "benchNotInLog");
    if (logged) return verdict(signUp ? "noShow" : "noSignup", "notInLog");
    // a status nobody knows (an old Raid-Helper word) says at least "not coming"
    if (signUp) return verdict("absence", "absence");
    return verdict("noSignup", "noSignup");
}

/** A night as the views carry it: the raid's id, title and start with the verdict. */
function nightEntry(raid, st) {
    return {
        eventId: raid.id, title: raid.title, startTime: raid.startTime,
        attended: st.attended, status: st.status, detail: st.detail, reason: st.reason,
        ...(st.override ? { override: st.override } : {}),
    };
}

/** The missed nights of a night list, without `attended`. */
function missedOf(raids) {
    return raids.filter((r) => !r.attended && counts(r)).map(({ attended: _a, ...rest }) => rest);
}

/** attended / total / pct of a night list; neutral nights are in neither. */
function quota(raids) {
    const counted = raids.filter(counts);
    const attended = counted.filter((r) => r.attended).length;
    return { attended, total: counted.length, pct: counted.length ? Math.round((attended / counted.length) * 100) : null };
}

/**
 * Attendance of one character in one category.
 *
 * `userIds`: the raiders the character belongs to (their signups, bench places,
 * absences and overrides count for it).
 *
 * @returns {{attended: number, total: number, pct: number|null,
 *            raids: {eventId, title, startTime, attended, status, detail, reason, override?}[],
 *            missed: {eventId, title, startTime, status, detail, reason, override?}[]}}
 */
function attendanceFor(ctx, categoryId, character, userIds = []) {
    const key = characterKeyOf(character);
    const ids = (userIds || []).map(String);
    const raids = [];
    for (const raid of ctx.raidsByCategory.get(categoryId) || []) {
        const st = nightStatus(raid, key, ids);
        if (!st) continue;
        raids.push(nightEntry(raid, st));
    }
    return {
        ...quota(raids),
        raids,
        missed: missedOf(raids),
    };
}

/** The nights attendanceForAccounts counts: the last `window` (default RAID_WINDOW) of the category, of the comparable ones if asked. */
function countedNights(ctx, categoryId, opts) {
    const window = Number(opts.window) > 0 ? Number(opts.window) : RAID_WINDOW;
    const every = (ctx.allRaidsByCategory || ctx.raidsByCategory).get(categoryId) || [];
    if (typeof opts.comparable === "function") return every.filter(opts.comparable).slice(0, window);
    if (window === RAID_WINDOW && !ctx.allRaidsByCategory) return ctx.raidsByCategory.get(categoryId) || [];
    return every.slice(0, window);
}

/**
 * Attendance per Discord account rather than per character (the setup editor):
 * a night counts when *any* character of the account stands in the log, so a
 * raider who switches between main and twink is not marked absent. Where none
 * of the account's characters is in the log, a class match may still explain it
 * — a log player nobody has claimed, of the class the account plays, and at
 * least as many of them as accounts of that class that are missing (`inferred`).
 * `link` says how sure the character link is: "manual" (the orga's assignment
 * or the raider's own profile) or "auto" (from signups, or a class guess).
 *
 * A category can mix kinds of raid (a 10-man Karazhan night and a 25-man SSC night
 * in one "PUG Raids" category): with `comparable(raid)` only the nights it accepts
 * count, and the window is the last RAID_WINDOW *of those* — so somebody who
 * never joins the other kind is not marked absent for it.
 *
 * @param {{ userId: string, chars: { name: string, className?: string, manual?: boolean }[] }[]} accounts
 * With `nights: true` each result also carries `raids` - every counted night with its verdict, newest
 * first (the Kaderplaner, docs/kaderplaner.md); the setup editor leaves it out to keep its payload small.
 *
 * `window` (Einstellungen › Kategorien, categoryAttendance): how many of the category's last nights count
 * instead of RAID_WINDOW.
 *
 * @param {{ comparable?: (raid: {id, title, startTime, signUps, logs}) => boolean, nights?: boolean, window?: number }} [opts]
 * @returns {Map<string, {attended: number, total: number, pct: number|null, link: "manual"|"auto",
 *            inferred: number, missed: {eventId, title, startTime, status, detail, reason, override?}[],
 *            raids?: {eventId, title, startTime, attended, status, detail, reason, override?}[]}>}
 */
/**
 * The characters the orga assigned each account, over every category — read once per call.
 * @returns {Map<string, string[]>} userId -> character names
 */
function assignedByUser() {
    const out = new Map();
    for (const map of Object.values(attempt(() => listAllAssignments(), {}) || {})) {
        for (const [userId, name] of Object.entries(map || {})) {
            const clean = String(name || "").trim();
            if (!clean) continue;
            const list = out.get(String(userId)) || [];
            if (!list.some((n) => n.toLowerCase() === clean.toLowerCase())) list.push(clean);
            out.set(String(userId), list);
        }
    }
    return out;
}

/** An account's characters plus the ones assigned to it anywhere, one entry per name. */
function withAssigned(account, assigned) {
    const chars = [...(account.chars || [])];
    const known = new Set(chars.map((c) => characterKeyOf(c.name)));
    for (const name of assigned.get(String(account.userId)) || []) {
        const key = characterKeyOf(name);
        if (known.has(key)) continue;
        known.add(key);
        chars.push({ name, className: "", manual: true });
    }
    return { ...account, chars };
}

/** The character keys an account's own signup names for one night (several in priority order, or one). */
function signupKeys(raid, userId) {
    const signUp = [...(raid.signUps || [])].reverse().find((s) => s && String(s.userId) === userId);
    if (!signUp) return [];
    const named = Array.isArray(signUp.characters) && signUp.characters.length ? signUp.characters.map((ch) => ch && ch.character) : [signUp.character];
    return named.map((n) => String(n || "").trim()).filter(Boolean).map(characterKeyOf);
}

function attendanceForAccounts(ctx, categoryId, accounts, opts = {}) {
    const assigned = assignedByUser();
    const list = (accounts || []).filter((a) => a && a.userId).map((a) => withAssigned(a, assigned)).filter((a) => a.chars.length);
    const claimed = new Set(list.flatMap((a) => a.chars.map((c) => characterKeyOf(c.name))));
    const acc = new Map(list.map((a) => [String(a.userId), { raids: [], inferred: 0 }]));
    const classOf = (a) => String((a.chars.find((c) => c.className) || {}).className || "").toLowerCase();
    // only an automatic "not in the log" may be explained by a class match - never a sign-off, a bench place or the orga's word
    const notInLog = (r) => r && !r.attended && r.detail === "notInLog";
    for (const raid of countedNights(ctx, categoryId, opts)) {
        const results = new Map();
        for (const a of list) {
            // the account's characters, and whatever its signup of this night named (the character it actually brought)
            const keys = [...new Set([...a.chars.map((c) => characterKeyOf(c.name)), ...signupKeys(raid, String(a.userId))])];
            const nights = keys.map((key) => nightStatus(raid, key, [String(a.userId)])).filter(Boolean);
            // a character in the log wins over another one's bench (signed up, not in the log), which wins over the rest
            const hit = nights.find((n) => n.status === "present") || nights.find((n) => n.attended) || nights[0];
            if (hit) results.set(String(a.userId), hit);
        }
        // class guess: unclaimed log players by class against the accounts still missing
        const pool = {};
        for (const rep of raid.logs) {
            for (const key of rep.keys) {
                const cls = (rep.classes || {})[key];
                if (cls && !claimed.has(key)) (pool[cls] = pool[cls] || new Set()).add(key);
            }
        }
        const missing = {};
        for (const a of list) if (notInLog(results.get(String(a.userId))) && classOf(a)) missing[classOf(a)] = (missing[classOf(a)] || 0) + 1;
        for (const a of list) {
            const cls = classOf(a);
            if (notInLog(results.get(String(a.userId))) && cls && pool[cls] && pool[cls].size >= missing[cls]) {
                results.set(String(a.userId), { ...verdict("present", "inLogClass"), inferred: true });
            }
        }
        for (const [id, r] of results) {
            const entry = acc.get(id);
            entry.raids.push(nightEntry(raid, r));
            if (r.inferred) entry.inferred += 1;
        }
    }
    const out = new Map();
    for (const a of list) {
        const { raids, inferred } = acc.get(String(a.userId));
        out.set(String(a.userId), {
            ...quota(raids),
            link: a.chars.some((c) => c.manual) && !inferred ? "manual" : "auto",
            inferred,
            missed: missedOf(raids),
            ...(opts.nights ? { raids } : {}),
        });
    }
    return out;
}

/**
 * What a category's group head says about it: how many nights are counted and
 * which raids it runs (from the evaluated logs' zones, else the event titles),
 * with the icon of the newest raid's final boss.
 */
function categoryInfo(ctx, categoryId) {
    const raids = ctx.raidsByCategory.get(categoryId) || [];
    const found = new Set();
    for (const raid of raids) {
        for (const rep of raid.logs) for (const id of contentsForText(rep.zone)) found.add(id);
        if (!raid.logs.length) for (const id of contentsForText(raid.title)) found.add(id);
    }
    const order = Object.keys(CONTENT_ICONS);
    const contents = order.filter((id) => found.has(id));
    const newest = contents[contents.length - 1] || "";
    return {
        raids: raids.length,
        contents: contents.map((id) => (contentMeta(id) || {}).short || id),
        icon: CONTENT_ICONS[newest] || "",
    };
}

/** The character's role: the newest log's, else the spec's, else "". */
function roleFor(ctx, character, className, spec) {
    return ctx.roleByKey[characterKeyOf(character)] || roleFromSpec(className, spec);
}

/**
 * The nights attendanceForAccounts counts for a category with these options
 * (`window`, `comparable`), newest first, as `{ eventId, title, startTime }` -
 * the columns of the roster's attendance grid.
 */
function categoryNights(ctx, categoryId, opts = {}) {
    return countedNights(ctx, categoryId, opts).map((r) => ({ eventId: r.id, title: r.title, startTime: r.startTime }));
}

module.exports = {
    buildAttendanceContext, attendanceFor, attendanceForAccounts, categoryInfo, categoryNights, nightStatus, roleFor, roleFromSpec,
    RAID_WINDOW, CONTENT_ICONS, STATUSES,
};
