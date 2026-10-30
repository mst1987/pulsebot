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
// A raid group (#811 — "Zul'Aman" and "Zul'Aman 2" from one signup) is ONE night:
// the further raids are no nights of their own, their logs, setups and overrides
// count for the first raid's night — present in the log of any raid of the group,
// placed or benched in any of their setups.
//   - no log and no raider assigned to the character        -> not counted at all:
//     without a Discord account behind the name there is nothing to compare.
// "present", "bench" and "leftEarly" count for the quota (`attended`), "tentative" not at all
// (not in `total`), the other four are missed.
// "leftEarly" (#990) is never decided automatically: the log only suggests it (a
// raider in the log who is missing from the night's last N boss kills, with no
// other character of theirs in them - `suggestLeftEarly`), the orga confirms it
// as an override or sets it by hand. It counts as attended; only the orga's
// Vermerk hints (userSignals.js) look at it. Each night also carries a `detail` code (why: inLog, signed, late,
// benchSetup, notInLog, ...) and `reason`, the same in German words - kept for
// the bot's /anwesenheit lines, which read it as they always did.
// The window is the category's last RAID_WINDOW nights that carry any evidence
// (a signup or a log), not a calendar span: a raid that runs every week and one
// that runs every other week both get "the last 11 raids".
// Attendance is always counted within one game version (#740): every caller
// names it (buildAttendanceContext's `versionId`), a night belongs to the version
// stored with it (versionOfEvent), and the window is the last nights *of that
// version* - a category switched from TBC to Forever starts its Forever quota
// empty ("noch keine gezählten Raids") and keeps its TBC quota under TBC.
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
const { contentsForText, content: contentMeta } = require("../../config/data/raidContent");
const { VERSIONS } = require("../../config/gameVersions");
const { versionOfEvent, mainVersionFor, knownVersion } = require("../versions/mainVersion");
const logger = require("../../logger").child("attendance");
const { DateTime } = require("luxon");
const { TIMEZONE } = require("../../config/timezone");
const eventStore = require("../../stores/eventStore");
const availabilityStore = require("../../stores/availabilityStore");
const overridesStore = require("../../stores/attendanceOverridesStore");
const { benchAndPool } = require("../setup/setupCore");
const { listAllAssignments } = require("../../stores/raiderCharactersStore");
const { isRaidSibling, signupEventIdOf } = require("../../utils/raidGroup");

/** How many raid nights of a category attendance looks back over. */
const RAID_WINDOW = 11;

// Same bound as charGearIssues.js: far enough back for everyone who raided
// recently, without walking years of report files on every page view.
const MAX_REPORTS = 40;

/** The status codes of a night, in the order the tooltip lists them. */
const STATUSES = ["present", "leftEarly", "bench", "noSignup", "absence", "vacation", "noShow", "tentative"];
/** The statuses that count for the quota ("leftEarly": there, but gone before the last bosses, #990). */
const ATTENDED = new Set(["present", "leftEarly", "bench"]);
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
    tentative: "vorläufig (zählt nicht)", leftEarly: "früh gegangen",
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

/**
 * The places of a raid group's night (#811): who stood in a group of ANY of its
 * raids, and who sat on the bench of any of them without standing in a group anywhere.
 */
function groupPlaces(setups) {
    const parts = (setups || []).map(setupPlaces);
    const placed = new Set(parts.flatMap((p) => [...p.placed]));
    const bench = new Set(parts.flatMap((p) => [...p.bench]).filter((id) => !placed.has(id)));
    return { placed, bench };
}

/** fn(), or `fallback` when it throws: the extra sources (setups, absences, overrides) are best-effort. */
function attempt(fn, fallback) {
    try {
        return fn();
    } catch {
        return fallback;
    }
}

// The raid a category mostly runs, as the icon of its final boss: one entry per
// instance of every version, read from the rule set (config/gameVersions).
const CONTENT_ICONS = Object.fromEntries(
    VERSIONS.flatMap((v) => v.instances.filter((i) => i.icon).map((i) => [i.id, i.icon])),
);

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
    // who stood in which boss kill (#990, report.kills); a report evaluated before has none -> no suggestion
    const kills = Array.isArray(report.kills)
        ? report.kills.map((k) => ({
            at: Number(k && k.at) || 0,
            boss: String((k && k.boss) || ""),
            keys: new Set(((k && k.players) || []).map((name) => characterKeyOf(name)).filter(Boolean)),
        }))
        : null;
    const condensed = { id: meta.id, zone: meta.zone || report.zone || "", keys, classes, roles, kills };
    condensedCache.set(cacheKey, condensed);
    return condensed;
}

/** Adds who signed up for a night to `byCategory` (category id -> user ids), whatever its version. */
function noteSigners(byCategory, ev) {
    for (const s of Array.isArray(ev.signUps) ? ev.signUps : []) {
        if (!s || !s.userId) continue;
        if (!byCategory.has(ev.categoryId)) byCategory.set(ev.categoryId, new Set());
        byCategory.get(ev.categoryId).add(String(s.userId));
    }
}

/**
 * The game version a context counts (#740): attendance is always counted within
 * one version, never across. A call without a known version is a bug in the
 * caller - it throws outside production (tests, dev), and on the live bot counts
 * the main version and says so in the log rather than taking a page down.
 */
function requiredVersion(versionId) {
    const id = knownVersion(versionId);
    if (id) return id;
    const message = `buildAttendanceContext: versionId fehlt oder ist unbekannt (${JSON.stringify(versionId)})`;
    if (process.env.NODE_ENV !== "production") throw new Error(message);
    logger.warn(`${message} - es zählt die Hauptversion`);
    return mainVersionFor();
}

// Two logs of one raid can record the same kill (two raiders logging): a kill of
// the same boss starting within this span is one kill, its players merged.
const SAME_KILL_MS = 2 * 60 * 1000;

/**
 * The boss kills of one raid from all its logs, oldest first, with duplicate
 * recordings merged - or null when one of its logs was evaluated before the
 * kills were kept (#990): then nothing can be said about who left early.
 */
function mergedKills(reps) {
    if (!reps.length || reps.some((r) => !Array.isArray(r.kills))) return null;
    const all = reps.flatMap((r) => r.kills).sort((a, b) => a.at - b.at);
    const out = [];
    for (const k of all) {
        const same = out.find((o) => o.boss === k.boss && Math.abs(o.at - k.at) <= SAME_KILL_MS);
        if (same) for (const key of k.keys) same.keys.add(key);
        else out.push({ at: k.at, boss: k.boss, keys: new Set(k.keys) });
    }
    return out;
}

/** A night's kill tracks (#990): one per raid of the night (a raid group has several), each with its merged kills or null. */
function killTracksOf(tracks) {
    return [...(tracks || new Map()).values()].map(mergedKills);
}

/**
 * The log's "left early" suggestion for one account and night (#990), or null:
 * of the raid(s) the account stood in a boss kill of, it is missing from the last
 * `n` kills - with any of its characters (a twink in the kill counts as there).
 * Nobody in no kill at all left early; a night with an old evaluation suggests nothing.
 */
function leftEarlySuggestion(raid, keys, n) {
    const tracks = raid.killTracks || [];
    if (!tracks.length || tracks.some((t) => t === null)) return null;
    const inKill = (k) => keys.some((key) => k.keys.has(key));
    // the raid(s) of a group the account actually raided in, their kills in order
    const kills = tracks.filter((t) => t.some(inKill)).flat().sort((a, b) => a.at - b.at);
    if (!kills.length) return null;
    const last = kills.slice(-n);
    if (last.some(inKill)) return null;
    return { kind: "leftEarly", missedKills: n, bosses: last.map((k) => k.boss).filter(Boolean) };
}

/**
 * Everything attendance and role need, read once per request.
 *
 * @param {string} guildId  only events of this guild count ("" = all)
 * @param {{versionId: string, now?: number, maxReports?: number}} opts  `versionId` (required, #740):
 *   only raid nights of that game version count - each raid's stored version (#737, versionOfEvent).
 *   The window (the last RAID_WINDOW nights) is taken within that version, so a category switched to
 *   another version starts its quota empty there.
 */
function buildAttendanceContext(guildId, opts = {}) {
    const versionId = requiredVersion(opts && opts.versionId);
    const now = opts.now || Date.now();
    // stored start times are seconds, callers hand in `now` as milliseconds (Date.now()) or seconds
    // (Kaderplaner): compare both in seconds, so a coming raid never counts as a night
    const toSec = (t) => (t > 1e12 ? Math.floor(t / 1000) : t);
    const nowSec = toSec(now);
    const maxReports = opts.maxReports > 0 ? opts.maxReports : MAX_REPORTS;
    const reports = listReports().slice(0, maxReports).map(condenseReport);
    const reportById = new Map(reports.map((r) => [String(r.id), r]));

    // #677: the setups of own events (who stood on the bench), the absence entries (vacation) and the orga's overrides
    // #811: the further raids of a raid group too — their night is the first raid's
    const ownEvents = attempt(() => eventStore.listEvents(guildId, { siblings: true }), []) || [];
    const setupById = new Map(ownEvents
        .filter((e) => e && e.id && e.setup)
        .map((e) => [String(e.id), e.setup]));
    // further raid id -> its group's first raid; first raid id -> its further raids
    const nightOf = new Map();
    const siblingsOf = new Map();
    for (const e of ownEvents) {
        if (!e || !isRaidSibling(e)) continue;
        const head = signupEventIdOf(e);
        nightOf.set(String(e.id), head);
        siblingsOf.set(head, [...(siblingsOf.get(head) || []), String(e.id)]);
    }

    // event id -> the evaluations of its logs (a further raid's count for its group's night, #811)
    const reportsByEvent = new Map();
    // night -> raid id of the group -> its evaluations (#990: each raid of a group is a kill track of its own)
    const tracksByNight = new Map();
    for (const log of listLogs()) {
        if (!log || !log.eventId || !log.reportRefId) continue;
        const rep = reportById.get(String(log.reportRefId));
        if (!rep) continue;
        const night = nightOf.get(String(log.eventId)) || String(log.eventId);
        const list = reportsByEvent.get(night) || [];
        list.push(rep);
        reportsByEvent.set(night, list);
        const tracks = tracksByNight.get(night) || new Map();
        tracks.set(String(log.eventId), [...(tracks.get(String(log.eventId)) || []), rep]);
        tracksByNight.set(night, tracks);
    }
    const absences = attempt(() => availabilityStore.listEntries(), []).filter((e) => e && e.kind === "absence" && e.userId);
    const overrides = attempt(() => overridesStore.listOverrides(), {});

    // category id -> its past raid nights with evidence, newest first
    const raidsByCategory = new Map();
    // category id -> who ever signed up there, in any version: "Meine Anwesenheit" still shows a category
    // switched to this version before its first raid ("noch keine gezählten Raids" instead of nothing)
    const signedAnyVersion = new Map();
    for (const ev of listStoredEvents(guildId, { now: nowSec * 1000 })) {
        if (!ev || !ev.categoryId || !ev.startTime || toSec(ev.startTime) > nowSec) continue;
        noteSigners(signedAnyVersion, ev);
        const evVersion = versionOfEvent(ev);
        if (evVersion !== versionId) continue;
        const logs = reportsByEvent.get(String(ev.id)) || [];
        const signUps = Array.isArray(ev.signUps) ? ev.signUps : [];
        if (!logs.length && !signUps.length) continue;
        const list = raidsByCategory.get(ev.categoryId) || [];
        const siblings = siblingsOf.get(String(ev.id)) || [];
        const places = siblings.length
            ? groupPlaces([setupById.get(String(ev.id)), ...siblings.map((id) => setupById.get(id))])
            : setupPlaces(setupById.get(String(ev.id)));
        list.push({
            id: String(ev.id), title: ev.title || "", startTime: ev.startTime, signUps, logs,
            // the boss kills per raid of the night (#990), for the "left early" suggestion
            killTracks: killTracksOf(tracksByNight.get(String(ev.id))),
            // the night's stored version (#737): its zones and title are named with that version's content
            versionId: evVersion,
            bench: places.bench,
            // who stood in a group: a tentative who did was expected, one who did not was not
            placed: places.placed,
            vacation: vacationIds(absences, ev),
            // an override set on a further raid of the group still counts for the night (#811)
            overrides: Object.assign({}, ...siblings.map((id) => overrides[id] || {}), overrides[String(ev.id)] || {}),
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

    return { versionId, raidsByCategory, allRaidsByCategory, roleByKey, signedAnyVersion };
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
        ...(st.suggestion ? { suggestion: st.suggestion } : {}),
    };
}

/**
 * A night as the raider's own views show it (#990): a night the orga set to "left early", or whose
 * log suggestion it dismissed, reads as plainly present - the raider never sees either, nor a suggestion.
 */
function neutralNight(night) {
    if (!night) return night;
    const o = night.override;
    const hidden = o && (o.status === "leftEarly" || (o.status === "present" && o.reason === overridesStore.LEFT_EARLY_DISMISSED));
    if (!hidden && !night.suggestion) return night;
    const rest = { ...night };
    delete rest.suggestion;
    if (hidden) {
        delete rest.override;
        return { ...rest, ...verdict("present", "inLog") };
    }
    return rest;
}

/**
 * An attendanceFor summary as the raider's own views show it (#990): every night, in `raids` and
 * `missed`, through neutralNight. The quota stays - a night left early counts as attended either way.
 */
function neutralAttendance(summary) {
    if (!summary) return summary;
    return {
        ...summary,
        raids: (summary.raids || []).map(neutralNight),
        missed: (summary.missed || []).map(neutralNight),
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
 * `suggestLeftEarly` (#990, the orga's roster view only): a night the log counts as present carries
 * `suggestion: { kind: "leftEarly", missedKills, bosses }` when the account is missing from that many of
 * the night's last boss kills (leftEarlySuggestion). The raider's own views never ask for it.
 *
 * @param {{ comparable?: (raid: {id, title, startTime, signUps, logs}) => boolean, nights?: boolean, window?: number,
 *           suggestLeftEarly?: number }} [opts]
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

/** #990: only the orga's view asks (n > 0), only for a night the log decided - never over an override. */
function withSuggestion(hit, raid, keys, n) {
    if (!hit || !(n > 0) || hit.status !== "present" || hit.detail !== "inLog") return hit;
    const suggestion = leftEarlySuggestion(raid, keys, n);
    return suggestion ? { ...hit, suggestion } : hit;
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
    const leftEarlyN = Math.max(0, Math.floor(Number(opts.suggestLeftEarly) || 0));
    for (const raid of countedNights(ctx, categoryId, opts)) {
        const results = new Map();
        for (const a of list) {
            // the account's characters, and whatever its signup of this night named (the character it actually brought)
            const keys = [...new Set([...a.chars.map((c) => characterKeyOf(c.name)), ...signupKeys(raid, String(a.userId))])];
            const nights = keys.map((key) => nightStatus(raid, key, [String(a.userId)])).filter(Boolean);
            // a character in the log wins over another one's bench (signed up, not in the log), which wins over the rest
            const hit = withSuggestion(nights.find((n) => n.status === "present") || nights.find((n) => n.attended) || nights[0], raid, keys, leftEarlyN);
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
    // Zones and titles are read within each night's own stored version (#740), not the one the
    // category plays today: an old TBC night of a category switched to Forever is named with TBC content.
    for (const raid of raids) {
        const opts = { versionId: raid.versionId || ctx.versionId || mainVersionFor({ categoryId }) };
        for (const rep of raid.logs) for (const id of contentsForText(rep.zone, opts)) found.add(id);
        if (!raid.logs.length) for (const id of contentsForText(raid.title, opts)) found.add(id);
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
    leftEarlySuggestion, neutralNight, neutralAttendance,
    RAID_WINDOW, CONTENT_ICONS, STATUSES,
};
