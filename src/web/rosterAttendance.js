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
// How one raid night counts for one character (the issue's open question,
// answered as "both, the log first"):
//   - in the log of that night                      -> attended
//   - the night has a log, the character is not in it -> missed, "nicht im Log"
//     (an absence signup still says "abgemeldet": the reason is worth more than
//     the fact that the log confirms it)
//   - no log, signed up (or late)                   -> attended ("angemeldet")
//   - no log, signed off / bench / tentative        -> missed with that reason
//   - no log, no signup from the raider             -> missed, "keine Anmeldung"
//   - no log and no raider assigned to the character -> not counted at all:
//     without a Discord account behind the name there is nothing to compare.
// The window is the category's last RAID_WINDOW nights that carry any evidence
// (a signup or a log), not a calendar span: a raid that runs every week and one
// that runs every other week both get "the last 11 raids".
//
// Role (the second open question): what the character last played in a log —
// a hybrid's spec in the loot export says little about whether they healed
// last Thursday — and the spec only when no log knows them.
const { listStoredEvents } = require("./eventSources");
const { listLogs } = require("./logStore");
const { listReports, getReport } = require("./reportStore");
const { characterKey: lootCharacterKey, splitPlayer } = require("../utils/lootImport");
const { contentsForText, content: contentMeta } = require("../config/tbcContent");

/** How many raid nights of a category attendance looks back over. */
const RAID_WINDOW = 11;

// Same bound as charGearIssues.js: far enough back for everyone who raided
// recently, without walking years of report files on every page view.
const MAX_REPORTS = 40;

const SIGNUP_REASONS = {
    absence: "abgemeldet",
    bench: "Ersatzbank",
    tentative: "vorläufig",
};

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

function charKey(name) {
    return lootCharacterKey(splitPlayer(name).character);
}

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
        const key = charKey(entry && entry.name);
        if (!key) continue;
        keys.add(key);
        const cls = String((entry && (entry.className || entry.class || entry.type)) || "").trim().toLowerCase();
        if (cls) classes[key] = cls;
    }
    // Same order as render.js's reportContext(): the healer analysis, WCL's tank
    // of any fight, then the RPB's roles for reports without the timeline.
    const roles = {};
    for (const p of (report.healers && report.healers.players) || []) {
        const key = charKey(p && p.name);
        if (key) roles[key] = "healer";
    }
    for (const f of (report.timeline && report.timeline.fights) || []) {
        const key = charKey(f && f.healers && f.healers.tank && f.healers.tank.name);
        if (key) roles[key] = "tank";
    }
    for (const [name, role] of Object.entries((report.rpb && report.rpb.roles) || {})) {
        const key = charKey(name);
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
 * @param {{now?: number, maxReports?: number}} opts
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

    // category id -> its past raid nights with evidence, newest first
    const raidsByCategory = new Map();
    for (const ev of listStoredEvents(guildId)) {
        if (!ev || !ev.categoryId || !ev.startTime || ev.startTime > now) continue;
        const logs = reportsByEvent.get(String(ev.id)) || [];
        const signUps = Array.isArray(ev.signUps) ? ev.signUps : [];
        if (!logs.length && !signUps.length) continue;
        const list = raidsByCategory.get(ev.categoryId) || [];
        list.push({ id: String(ev.id), title: ev.title || "", startTime: ev.startTime, signUps, logs });
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

/** How one night went for one character — see the header for the rules. */
function nightStatus(raid, key, userIds) {
    const signUp = [...raid.signUps].reverse().find((s) => s && userIds.includes(String(s.userId)));
    const status = signUp ? String(signUp.status || "signed") : "";
    if (raid.logs.length) {
        if (raid.logs.some((r) => r.keys.has(key))) return { attended: true, reason: "im Log" };
        return { attended: false, reason: SIGNUP_REASONS[status] || "nicht im Log" };
    }
    if (!userIds.length) return null;
    if (!signUp) return { attended: false, reason: "keine Anmeldung" };
    if (status === "signed" || status === "late") return { attended: true, reason: status === "late" ? "angemeldet (später)" : "angemeldet" };
    return { attended: false, reason: SIGNUP_REASONS[status] || "abgemeldet" };
}

/**
 * Attendance of one character in one category.
 *
 * @returns {{attended: number, total: number, pct: number|null,
 *            raids: {eventId, title, startTime, attended, reason}[],
 *            missed: {eventId, title, startTime, reason}[]}}
 */
function attendanceFor(ctx, categoryId, character, userIds = []) {
    const key = charKey(character);
    const ids = (userIds || []).map(String);
    const raids = [];
    for (const raid of ctx.raidsByCategory.get(categoryId) || []) {
        const st = nightStatus(raid, key, ids);
        if (!st) continue;
        raids.push({ eventId: raid.id, title: raid.title, startTime: raid.startTime, attended: st.attended, reason: st.reason });
    }
    const attended = raids.filter((r) => r.attended).length;
    return {
        attended,
        total: raids.length,
        pct: raids.length ? Math.round((attended / raids.length) * 100) : null,
        raids,
        missed: raids.filter((r) => !r.attended).map(({ eventId, title, startTime, reason }) => ({ eventId, title, startTime, reason })),
    };
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
 * @param {{ comparable?: (raid: {id, title, startTime, signUps, logs}) => boolean }} [opts]
 * @returns {Map<string, {attended: number, total: number, pct: number|null, link: "manual"|"auto",
 *            inferred: number, missed: {eventId, title, startTime, reason}[]}>}
 */
function attendanceForAccounts(ctx, categoryId, accounts, opts = {}) {
    const list = (accounts || []).filter((a) => a && a.userId && (a.chars || []).length);
    const claimed = new Set(list.flatMap((a) => a.chars.map((c) => charKey(c.name))));
    const acc = new Map(list.map((a) => [String(a.userId), { raids: [], inferred: 0 }]));
    const classOf = (a) => String((a.chars.find((c) => c.className) || {}).className || "").toLowerCase();
    const notInLog = (r) => r && !r.attended && r.reason === "nicht im Log";
    const raidNights = typeof opts.comparable === "function"
        ? ((ctx.allRaidsByCategory || ctx.raidsByCategory).get(categoryId) || []).filter(opts.comparable).slice(0, RAID_WINDOW)
        : (ctx.raidsByCategory.get(categoryId) || []);
    for (const raid of raidNights) {
        const results = new Map();
        for (const a of list) {
            const nights = a.chars.map((c) => nightStatus(raid, charKey(c.name), [String(a.userId)])).filter(Boolean);
            const hit = nights.find((n) => n.attended) || nights[0];
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
                results.set(String(a.userId), { attended: true, reason: "im Log (Klasse passt)", inferred: true });
            }
        }
        for (const [id, r] of results) {
            const entry = acc.get(id);
            entry.raids.push({ eventId: raid.id, title: raid.title, startTime: raid.startTime, attended: r.attended, reason: r.reason });
            if (r.inferred) entry.inferred += 1;
        }
    }
    const out = new Map();
    for (const a of list) {
        const { raids, inferred } = acc.get(String(a.userId));
        const attended = raids.filter((r) => r.attended).length;
        out.set(String(a.userId), {
            attended,
            total: raids.length,
            pct: raids.length ? Math.round((attended / raids.length) * 100) : null,
            link: a.chars.some((c) => c.manual) && !inferred ? "manual" : "auto",
            inferred,
            missed: raids.filter((r) => !r.attended).map(({ eventId, title, startTime, reason }) => ({ eventId, title, startTime, reason })),
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
    return ctx.roleByKey[charKey(character)] || roleFromSpec(className, spec);
}

module.exports = {
    buildAttendanceContext, attendanceFor, attendanceForAccounts, categoryInfo, roleFor, roleFromSpec,
    RAID_WINDOW, CONTENT_ICONS,
};
