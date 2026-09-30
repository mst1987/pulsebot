// The Kaderplaner's view model (docs/kaderplaner.md): what the bot knows
// (kaderSource.js) with the planner's own data (kaderStore.js) on top. Pure.
//
// The rule is "the planner wins": when an account has a planner assignment, its
// characters replace the profile's characters inside the planner. Each planner
// character is compared with the profile character it stems from (by
// `onlineKey`, else by name) and carries `differs` — codes of everything that
// deviates — so the page can say "weicht vom Profil ab". Nothing is ever
// written back to the profile.
//
// `differs` codes: "class", "mainSpec", "gear", "tank", "heal", "notInProfile".

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

function buildPlayer({ userId, member, profile, attendance, assignment, manual, classes }) {
    const profileChars = profile ? profile.characters : [];
    const chars = assignment
        ? assignment.characters.map((c) => ({
            ...c,
            origin: "planner",
            differs: profile ? diffAgainst(c, matchProfile(c, profileChars), classes) : [],
        }))
        : profileChars.map((c) => ({ ...fromProfile(c), differs: [] }));
    const described = chars.map((c) => ({ ...c, ...describe(c, classes) }));
    let active = assignment && described.find((c) => c.id === assignment.activeCharacterId);
    if (!active) active = described.find((c) => c.isProfileMain) || described[0] || null;

    const profileMain = profileChars.find((c) => c.main) || profileChars[0] || null;
    const profileDesc = profileMain ? describe(fromProfile(profileMain), classes) : null;

    return {
        userId,
        displayName: member ? member.displayName : userId,
        avatarUrl: member ? member.avatarUrl || null : null,
        hasProfile: !!profile,
        manual,
        hasOverride: !!assignment,
        characters: described,
        activeCharacterId: active ? active.id : null,
        differs: active ? active.differs : [],
        profile: profileMain && profileDesc
            ? { character: profileMain.name, className: profileMain.className, mainSpec: profileDesc.mainSpec, logSpecs: [...profileMain.logSpecs] }
            : null,
        availability: profile ? [...profile.availability] : [],
        attendance: attendanceView(attendance),
    };
}

/**
 * @param {{ source: object, planner: object }} input  kaderSource.loadKaderSource() and kaderStore.readPlanner()
 * @returns the payload of GET /api/kader, plus `poolIds` (not sent) for the mutators
 */
function buildKaderView({ source, planner }) {
    const classes = indexClasses(source.classes);
    const members = new Map(source.members.map((m) => [m.userId, m]));
    const profiles = new Map(source.profiles.map((p) => [p.userId, p]));
    const attendance = new Map(source.attendance.map((a) => [a.userId, a]));
    const manual = new Map(planner.accounts.map((a) => [a.userId, a]));

    const order = [...profiles.keys()];
    for (const id of manual.keys()) if (!profiles.has(id)) order.push(id);

    const players = order.map((userId) => {
        const account = manual.get(userId);
        const profile = profiles.get(userId);
        const member = members.get(userId)
            || (account ? { userId, displayName: account.displayName, avatarUrl: null } : null)
            || (profile && profile.displayName ? { userId, displayName: profile.displayName, avatarUrl: null } : null);
        return buildPlayer({
            userId,
            member,
            profile: profiles.get(userId) || null,
            attendance: attendance.get(userId) || null,
            assignment: planner.assignments[userId] || null,
            manual: !!account,
            classes,
        });
    });
    const byId = new Map(players.map((p) => [p.userId, p]));

    const memberList = source.members.map((m) => {
        const player = byId.get(m.userId);
        const pmain = player && player.profile;
        return {
            userId: m.userId,
            displayName: m.displayName,
            inPool: !!player,
            hasProfile: profiles.has(m.userId),
            profile: pmain ? { className: pmain.className, mainSpec: pmain.mainSpec } : null,
            pct: player && player.attendance ? player.attendance.pct : null,
        };
    });

    return {
        versionId: source.versionId,
        guildId: source.guildId,
        roles: ["tank", "healer", "melee", "ranged"],
        classes: source.classes,
        instances: source.instances,
        buffs: source.buffs,
        players,
        members: memberList,
        rosters: planner.rosters,
        setups: planner.setups,
        warnings: source.warnings,
        poolIds: new Set(profiles.keys()),
    };
}

/** The helpers the mutators of kaderModel.js need, taken from a built view. */
function mutationContext(view) {
    const byId = new Map(view.players.map((p) => [p.userId, p]));
    const activeOf = (userId) => {
        const p = byId.get(userId);
        return p ? p.characters.find((c) => c.id === p.activeCharacterId) || null : null;
    };
    return {
        classes: indexClasses(view.classes),
        instances: view.instances,
        memberIds: new Set(view.members.map((m) => m.userId)),
        poolIds: view.poolIds,
        naturalRole: (userId) => {
            const a = activeOf(userId);
            return a ? a.role : null;
        },
        playerInfo: (userId) => {
            const a = activeOf(userId);
            const p = byId.get(userId);
            return { classKey: a ? a.className : "", rate: p && p.attendance ? p.attendance.pct / 100 : 0 };
        },
    };
}

/** The view as it goes over the wire (the pool ids are an internal helper). */
function publicView(view) {
    const out = { ...view };
    delete out.poolIds;
    return out;
}

module.exports = { buildKaderView, mutationContext, publicView, diffAgainst, describe };
