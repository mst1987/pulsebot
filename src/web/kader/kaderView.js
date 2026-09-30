// The Kaderplaner's view model (docs/kaderplaner.md): what the bot knows
// (kaderSource.js) with the planner's own data (kaderStore.js) on top. Pure.
//
// Two layers:
//   - per server: the players the planner knows (a profile with a character of
//     the version, an account known by hand, anybody in a Kader) with their
//     characters, the prefilled character, Discord roles and attendance;
//     the server's members and roles for the import; names for every user id
//     the page shows (leads, votes, comments, history).
//   - per Kader: the chosen Kader as stored (players with state, interview,
//     votes, comments, decision; questions; example setups) and a summary of
//     every Kader for the selector.
//
// The rule "the planner wins": when an account has the planner's own character
// data, its characters replace the profile's inside the planner. Each planner
// character is compared with the profile character it stems from (by
// `onlineKey`, else by name) and carries `differs` — codes of everything that
// deviates — so the page can say "weicht vom Profil ab". Nothing is ever
// written back to the profile.
//
// `differs` codes: "class", "mainSpec", "gear", "tank", "heal", "notInProfile".
const { STATES } = require("../../services/kader/kaderModel");

const mainSpecOf = (char) => (char.specs.find((s) => s.main) || char.specs[0] || null);

function indexClasses(classes) {
    return new Map((classes || []).map((c) => [c.key, c]));
}

/** Main spec, its role and gear of one effective character. */
function describe(char, classes) {
    const cls = classes.get(char.className) || null;
    const main = mainSpecOf(char);
    const spec = main && cls ? cls.specs.find((s) => s.key === main.spec) || null : null;
    return {
        mainSpec: main ? main.spec : null,
        role: spec ? spec.role : null,
        gear: main ? main.gear : "none",
    };
}

/** A profile character in the planner's character shape (its first spec is the main one). */
function fromProfile(c) {
    return {
        id: `p:${c.key}`,
        name: c.name,
        nameStyle: String(c.name).trim().split(/\s+/).length === 2 ? "forever" : "nick",
        className: c.className,
        specs: c.specs.map((s, i) => ({ spec: s.spec, main: i === 0, gear: s.gear })),
        canTank: c.canTank,
        canHeal: c.canHeal,
        origin: "profile",
        onlineKey: c.key,
        isProfileMain: c.main,
    };
}

function matchProfile(char, profileChars) {
    return profileChars.find((o) => o.key === char.onlineKey)
        || profileChars.find((o) => o.name.toLowerCase() === char.name.toLowerCase())
        || null;
}

/** Codes of everything in which a planner character deviates from its profile twin. */
function diffAgainst(char, profileChar, classes) {
    if (!profileChar) return ["notInProfile"];
    const a = fromProfile(profileChar);
    const da = describe(a, classes);
    const db = describe(char, classes);
    const out = [];
    if (a.className !== char.className) out.push("class");
    if (da.mainSpec !== db.mainSpec) out.push("mainSpec");
    if (da.gear !== db.gear) out.push("gear");
    if (a.canTank !== char.canTank) out.push("tank");
    if (a.canHeal !== char.canHeal) out.push("heal");
    return out;
}

/** Nothing counted yet (Forever before its raids open) is no attendance at all: the page shows "—". */
function attendanceView(a) {
    if (!a || a.rate === null || a.rate === undefined) return null;
    return {
        attended: a.attended,
        counted: a.counted,
        pct: Math.round(a.rate * 100),
        nights: a.nights.map(({ date, title, attended, reason }) => ({ date, title, attended, reason })),
    };
}

/**
 * The character a player is prefilled with, and where it comes from: the
 * planner's own data, the profile (a character of the version, else the main
 * of another version) or the logs. Null when nothing is known ("fehlt").
 */
function prefillOf({ assignment, profile, logChar }) {
    if (assignment && assignment.characters.length) {
        const c = assignment.characters.find((x) => x.id === assignment.activeCharacterId) || assignment.characters[0];
        const main = mainSpecOf(c);
        return { name: c.name, className: c.className, spec: main ? main.spec : "", source: "planner", versionId: "" };
    }
    if (profile && profile.characters.length) {
        const c = profile.characters.find((x) => x.main) || profile.characters[0];
        return { name: c.name, className: c.className, spec: c.specs[0] ? c.specs[0].spec : (c.logSpecs[0] || ""), source: "profile", versionId: "" };
    }
    if (profile && profile.other) {
        return { name: profile.other.name, className: profile.other.className, spec: profile.other.spec, source: "profile", versionId: profile.other.versionId };
    }
    if (logChar) return { name: logChar.name, className: logChar.className, spec: logChar.spec, source: "logs", versionId: "" };
    return null;
}

function buildPlayer({ userId, displayName, member, profile, logChar, attendance, attendanceMain, assignment, manual, classes }) {
    const profileChars = profile ? profile.characters : [];
    const chars = assignment
        ? assignment.characters.map((c) => ({
            ...c,
            origin: "planner",
            differs: profileChars.length ? diffAgainst(c, matchProfile(c, profileChars), classes) : [],
        }))
        : profileChars.map((c) => ({ ...fromProfile(c), differs: [] }));
    const described = chars.map((c) => ({ ...c, ...describe(c, classes) }));
    let active = assignment && described.find((c) => c.id === assignment.activeCharacterId);
    if (!active) active = described.find((c) => c.isProfileMain) || described[0] || null;

    const profileMain = profileChars.find((c) => c.main) || profileChars[0] || null;
    const profileDesc = profileMain ? describe(fromProfile(profileMain), classes) : null;

    return {
        userId,
        displayName,
        avatarUrl: member ? member.avatarUrl || null : null,
        onServer: !!member,
        roleIds: member ? [...member.roleIds] : [],
        hasProfile: !!profile,
        manual,
        hasOverride: !!assignment,
        characters: described,
        activeCharacterId: active ? active.id : null,
        differs: active ? active.differs : [],
        profile: profileMain && profileDesc
            ? { character: profileMain.name, className: profileMain.className, mainSpec: profileDesc.mainSpec, logSpecs: [...profileMain.logSpecs] }
            : null,
        prefill: prefillOf({ assignment, profile, logChar }),
        availability: profile ? [...profile.availability] : [],
        attendance: attendanceView(attendance),
        attendanceMain: attendanceView(attendanceMain),
    };
}

/** How many players of a Kader stand in each state. */
function stateCounts(kader) {
    const counts = Object.fromEntries(STATES.map((s) => [s, 0]));
    for (const e of Object.values(kader.players)) counts[e.state] += 1;
    return counts;
}

/** A Kader in the picker: name, leads, counts per state and how many questions it asks (for "Fragen übernehmen"). */
function kaderSummary(k) {
    return { id: k.id, name: k.name, leads: [...k.leads], createdAt: k.createdAt, createdBy: k.createdBy, counts: stateCounts(k), questions: k.questions.length };
}

/** A name for every user id the page may show: members, accounts, profiles, the names the Kader kept. */
function namesOf(source, planner) {
    const names = {};
    for (const k of planner.kaders) for (const [id, e] of Object.entries(k.players)) if (e.name) names[id] = e.name;
    for (const p of source.profiles) if (p.displayName) names[p.userId] = p.displayName;
    for (const a of planner.accounts) names[a.userId] = a.displayName;
    for (const m of source.members) names[m.userId] = m.displayName;
    return names;
}

/**
 * @param {{ source: object, planner: object, kaderId?: string }} input  kaderSource.loadKaderSource(), kaderStore.readPlanner()
 * @returns the payload of GET /api/kader
 */
function buildKaderView({ source, planner, kaderId = "" }) {
    const classes = indexClasses(source.classes);
    const members = new Map(source.members.map((m) => [m.userId, m]));
    const profiles = new Map(source.profiles.map((p) => [p.userId, p]));
    const attendance = new Map(source.attendance.map((a) => [a.userId, a]));
    const attendanceMain = new Map((source.attendanceMain || []).map((a) => [a.userId, a]));
    const logChars = source.logChars || {};
    const manual = new Map(planner.accounts.map((a) => [a.userId, a]));
    const names = namesOf(source, planner);

    const order = [];
    const add = (id) => { if (id && !order.includes(id)) order.push(id); };
    for (const p of source.profiles) if (p.characters.length) add(p.userId);
    for (const id of manual.keys()) add(id);
    for (const k of planner.kaders) for (const id of Object.keys(k.players)) add(id);

    const players = order.map((userId) => buildPlayer({
        userId,
        displayName: names[userId] || userId,
        member: members.get(userId) || null,
        profile: profiles.get(userId) || null,
        logChar: logChars[userId] || null,
        attendance: attendance.get(userId) || null,
        attendanceMain: attendanceMain.get(userId) || null,
        assignment: planner.assignments[userId] || null,
        manual: manual.has(userId),
        classes,
    }));

    // the import dialog's candidates: every member, with what they would be prefilled with
    const memberList = source.members.map((m) => ({
        userId: m.userId,
        displayName: m.displayName,
        roleIds: [...m.roleIds],
        prefill: prefillOf({ assignment: planner.assignments[m.userId] || null, profile: profiles.get(m.userId) || null, logChar: logChars[m.userId] || null }),
    }));

    const kader = planner.kaders.find((k) => k.id === kaderId) || null;
    return {
        versionId: source.versionId,
        mainVersion: source.mainVersion,
        guildId: source.guildId,
        roles: ["tank", "healer", "melee", "ranged"],
        classes: source.classes,
        buffs: source.buffs,
        players,
        members: memberList,
        discordRoles: source.discordRoles || [],
        names,
        kaders: planner.kaders.map(kaderSummary),
        kader,
        warnings: source.warnings,
    };
}

/** What a change inside one Kader answers: the Kader as stored now and the summaries of all. */
function kaderPayload(planner, kaderId) {
    return {
        kader: planner.kaders.find((k) => k.id === kaderId) || null,
        kaders: planner.kaders.map(kaderSummary),
    };
}

/** The helpers the mutators of services/kader/ need, from the bot's side of the view. */
function mutationContext({ source, planner, actor = "", now = new Date().toISOString() }) {
    const profiles = new Map(source.profiles.map((p) => [p.userId, p]));
    const logChars = source.logChars || {};
    const rate = new Map();
    for (const a of source.attendanceMain || []) if (a.rate !== null) rate.set(a.userId, a.rate);
    for (const a of source.attendance) if (a.rate !== null) rate.set(a.userId, a.rate);
    const knownIds = new Set([...profiles.keys(), ...source.members.map((m) => m.userId), ...Object.keys(logChars)]);
    return {
        now,
        actor,
        classes: indexClasses(source.classes),
        memberIds: new Set(source.members.map((m) => m.userId)),
        knownIds,
        prefillOf: (userId, current = planner) => prefillOf({ assignment: (current || planner).assignments[userId] || null, profile: profiles.get(userId) || null, logChar: logChars[userId] || null }),
        rateOf: (userId) => rate.get(userId) || 0,
    };
}

/** The context of a change inside one Kader: the rule set's classes, who acts and when. */
function lightContext({ rules, actor = "", now = new Date().toISOString() }) {
    return { now, actor, classes: indexClasses(rules.classes), memberIds: new Set(), knownIds: new Set() };
}

module.exports = { buildKaderView, kaderPayload, mutationContext, lightContext, prefillOf, diffAgainst, describe, stateCounts };
