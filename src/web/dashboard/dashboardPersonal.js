// The personal part of the start page — "Für dich" (design canvas Oct 2026,
// direction A): what the logged-in raider needs before the next raid, and what
// the last ones said about them. Every member sees it; the orga sees it too,
// above its own block.
//
//   upcoming    the next raids of the raider's categories with their own signup,
//               setup group, softres list and published raid plan — the rows of
//               the "Anmeldungen" page (memberEventRows)
//   attendance  attended / counted over the last raids, every category with
//               "Anwesenheit anzeigen" together — "Meine Anwesenheit" of the
//               Abwesenheiten page (raiderAttendance)
//   recent      the last raids with the raider's status and the recommendations
//               the raid lead approved for their characters in that night's
//               evaluation
//   profile     how many characters the profile has and what is missing in it
//
// Local stores only, except the event groups (loadEventGroups: Raid-Helper's
// cached list) and, for a member without orga rights, their Discord roles
// (which categories they may see) — both best-effort.
const { loadEventGroups } = require("../../services/events/raidEventGroups");
const discord = require("../../services/discord/discord");
const { memberEventRows } = require("../signups/signupView");
const { raiderAttendance } = require("../availability/raiderAttendance");
const profiles = require("../../stores/raiderProfileStore");
const { charactersForUser } = require("../../stores/raiderCharactersStore");
const { getEventSoftres } = require("../../stores/eventSoftresStore");
const { getPlan } = require("../../stores/raidplanStore");
const { listLogsForEvent } = require("../../stores/logStore");
const { getReportHints } = require("../../stores/reportStore");
const { versionOfEvent } = require("../../services/events/mainVersion");
const { zoneFor } = require("./dashboardOverview");

const UPCOMING = 4;
// as many as Latest Loot beside it, so both cards are one height
const RECENT = 5;
const DOTS = 8;

const str = (v) => String(v === null || v === undefined ? "" : v).trim();

/** One upcoming raid as the "Für dich" cards show it. */
function upcomingRow(row) {
    const mine = row.mine || null;
    const plan = getPlan(row.id);
    const softres = getEventSoftres(row.id);
    return {
        id: row.id,
        source: row.source || "raidhelper",
        title: row.title || "",
        startTime: Number(row.startTime) || 0,
        categoryName: row.categoryName || "",
        icon: row.instanceIcon || zoneFor(row.title).icon,
        // "" = not signed up yet; else signed | late | tentative | bench | absence
        status: mine ? str(mine.status) || "signed" : "",
        character: mine ? str(mine.character) : "",
        // the spec's key ("Rogue-Combat", a Raid-Helper specName): the client words it in the reader's language;
        // `spec` is the server's German label, the fallback for a key it does not know
        specKey: mine ? str(mine.spec || mine.specName) : "",
        spec: mine ? str(mine.specLabel || mine.specName) : "",
        specIcon: mine ? str(mine.specIcon) : "",
        // the approved setup's group ({ group }) or bench ({ bench: true }); null = no approved setup / not placed
        placement: row.placement || null,
        deadline: Number(row.deadline) || 0,
        deadlinePassed: !!row.deadlinePassed,
        signupsClosed: !!row.signupsClosed,
        cancelled: !!row.cancelled,
        rosterOnly: !!row.rosterOnly,
        softresUrl: (softres && softres.url) || "",
        // a published plan's token: the client reads /p/<token> for the raider's own assignments
        planToken: plan && plan.status === "published" && plan.publicToken ? plan.publicToken : "",
    };
}

/** The raider's next raids (cancelled ones included, they say so), soonest first. */
async function loadUpcoming(guildId, user, { orga, config, versionId, now }) {
    if (!guildId) return { raids: [], error: null };
    const { groups, error } = await loadEventGroups(guildId);
    let roleIds = null;
    if (!orga) {
        try {
            roleIds = await discord.memberRoleIds(guildId, user.id);
        } catch {
            roleIds = [];
        }
    }
    const rows = memberEventRows(groups || [], {
        userId: user.id, guildId, config, roleIds, orga, profile: profiles.getProfile(user.id), now,
    }).filter((r) => !versionId || versionOfEvent(r, { config }) === versionId);
    return { raids: rows.slice(0, UPCOMING).map(upcomingRow), error: rows.length ? null : error || null };
}

/** Every name the raider plays under: the profile's characters and the ones the categories assign them. */
function characterNames(userId, profile) {
    const names = [
        ...((profile && profile.characters) || []).map((c) => c && c.name),
        ...charactersForUser(userId).map((c) => c && c.character),
    ];
    return [...new Set(names.map((n) => str(n).toLowerCase()).filter(Boolean))];
}

/**
 * The night's newest evaluation as the raider sees it: the link to their own
 * player page and how many recommendations were approved for them. `hints` is
 * null when none of their characters is in the report; null altogether without
 * an evaluation.
 */
function reportFor(eventId, names) {
    const reports = listLogsForEvent(eventId)
        .map((l) => l && l.reportRefId && getReportHints(l.reportRefId))
        .filter(Boolean)
        .sort((a, b) => (b.generatedAt || 0) - (a.generatedAt || 0));
    const report = reports[0];
    if (!report) return null;
    const mine = names.map((n) => report.players[n]).filter(Boolean);
    const page = mine.find((p) => p.idx >= 0);
    return {
        url: page ? `/r/${report.id}/p/${page.idx}` : `/r/${report.id}`,
        hints: mine.length ? mine.reduce((n, p) => n + p.approved, 0) : null,
    };
}

/**
 * Attendance over every counted category together, the last nights as dots,
 * and the last raids with their evaluation. Null figures when nothing counts.
 */
function loadAttendance(userId, { config, now, names }) {
    const view = raiderAttendance(userId, { now, config });
    const counted = ((view && view.categories) || []).filter((c) => c.total > 0);
    const nights = counted
        .flatMap((c) => (c.raids || []).map((r) => ({ ...r, categoryName: c.name || "" })))
        .sort((a, b) => (Number(b.startTime) || 0) - (Number(a.startTime) || 0));
    const attendance = counted.length
        ? {
            attended: counted.reduce((n, c) => n + c.attended, 0),
            total: counted.reduce((n, c) => n + c.total, 0),
            bench: nights.filter((r) => r.status === "bench").length,
            last: nights.slice(0, DOTS).map((r) => ({ eventId: r.eventId, title: r.title || "", startTime: Number(r.startTime) || 0, status: r.status || "", attended: !!r.attended })),
        }
        : null;
    const recent = nights.slice(0, RECENT).map((r) => ({
        eventId: r.eventId,
        title: r.title || "",
        startTime: Number(r.startTime) || 0,
        categoryName: r.categoryName,
        icon: zoneFor(r.title).icon,
        status: r.status || "",
        attended: !!r.attended,
        report: reportFor(r.eventId, names),
    }));
    return { attendance, recent };
}

/**
 * What the raider profile has and lacks: no character at all, or a character
 * without any spec (it cannot be signed up with). Gear and availability are the
 * raider's own call, never "missing".
 */
function profileFigures(profile) {
    const chars = (profile && profile.characters) || [];
    const hints = chars.length
        ? chars.filter((c) => !(c.specs || []).length).map((c) => ({ kind: "noSpec", character: str(c.name) }))
        : [{ kind: "noCharacters", character: "" }];
    return { characters: chars.length, hints };
}

/**
 * Everything "Für dich" shows. Each part is best-effort: a failure leaves it
 * empty and is logged, the start page still loads.
 * @param {{ orga?: boolean, config?: object, versionId?: string, now?: number }} [opts]
 */
async function loadPersonal(guildId, user, { orga = false, config, versionId = "", now = Date.now() } = {}) {
    const profile = profiles.getProfile(user.id);
    let upcoming;
    try {
        upcoming = await loadUpcoming(guildId, user, { orga, config, versionId, now });
    } catch (e) {
        console.error("dashboard personal raids failed:", e.message);
        upcoming = { raids: [], error: e.message };
    }
    let attendance = null;
    let recent = [];
    try {
        ({ attendance, recent } = loadAttendance(user.id, { config, now, names: characterNames(user.id, profile) }));
    } catch (e) {
        console.error("dashboard personal attendance failed:", e.message);
    }
    return { upcoming: upcoming.raids, upcomingError: upcoming.error, attendance, recent, profile: profileFigures(profile) };
}

module.exports = { loadPersonal, upcomingRow, reportFor, profileFigures, characterNames };
