// The raid plan's service layer: what the editor and the public page are shown,
// built from the plan (raidplanStore.js), the event and its setup.
//
// Players are never stored in the plan, only their userId. Who they are comes
// from the event's setup at read time:
//   - the editor (raids) sees the current lineup: the draft when there is one,
//     else the approved one — the orga plans while the setup is still moving;
//   - the public page sees only the *approved* setup (setupEditor.js: a raider
//     never sees a draft). A token whose player is not in the approved setup is
//     left out of the public page instead of being named from a draft.
const store = require("./raidplanStore");
const profileStore = require("./raidplanProfileStore");
const { approvedSetupOf } = require("./setupEditor");
const { rulesFor, DEFAULT_VERSION } = require("../config/gameVersions");
const { wowIconUrl } = require("../config/menu");

/** A lineup as a flat list: { userId, character, classId, className, classColor, spec, specLabel, role, iconUrl, group }. */
function rosterFrom(lineup, versionId) {
    const rules = rulesFor(versionId || DEFAULT_VERSION) || rulesFor(DEFAULT_VERSION);
    const specs = new Map();
    const classes = new Map();
    for (const c of rules.classes) {
        classes.set(c.id, c);
        for (const s of c.specs) specs.set(s.key, s);
    }
    const out = [];
    const seen = new Set();
    const add = (p, group) => {
        const userId = String(p.userId || "");
        if (!userId || seen.has(userId)) return;
        seen.add(userId);
        const spec = specs.get(p.spec) || null;
        const cls = classes.get(p.classId || (spec && spec.classId)) || null;
        out.push({
            userId,
            character: String(p.character || ""),
            classId: cls ? cls.id : "",
            className: cls ? cls.label : "",
            classColor: (cls && cls.color) || "",
            spec: p.spec || "",
            specLabel: (spec && spec.label) || "",
            role: p.role || (spec && spec.role) || "dps",
            iconUrl: wowIconUrl((spec && spec.icon) || (cls && cls.icon) || "", 56),
            group,
        });
    };
    for (const g of (lineup && lineup.groups) || []) for (const s of g.slots || []) add(s, Number(g.index) || 0);
    for (const b of (lineup && lineup.bench) || []) add(b, 0);
    return out;
}

/** The players the editor offers: the current lineup, else the approved one. */
function editorRoster(event) {
    const setup = event.setup;
    const hasDraft = setup && Array.isArray(setup.groups) && (setup.groups.length || (setup.bench || []).length);
    return rosterFrom(hasDraft ? setup : approvedSetupOf(event), event.versionId);
}

/** The players a public page names: the approved setup only. */
function publicRoster(event) {
    return rosterFrom(approvedSetupOf(event), event.versionId);
}

/** The event's bosses, each with the url of the map it uses (its own or its instance's), or "". */
function bossList(event) {
    return store.bossesForInstances(event.instanceIds).map((b) => {
        const map = store.mapForBoss(b);
        return {
            ...b,
            mapUrl: map ? `/rp-map/${map.key}?v=${map.version}` : "",
            ownMap: !!(map && map.own),
            instanceMap: !!(map && !map.own),
        };
    });
}

/** GET /api/raidplan — everything the editor needs. */
function editorView(event, { canWrite }) {
    const plan = store.getPlan(event.id) || store.emptyPlan(event.id);
    return {
        eventId: event.id,
        event: { id: event.id, title: event.title, startTime: event.startTime },
        canWrite,
        plan: {
            version: plan.version,
            status: plan.status,
            publicPath: plan.publicToken ? `/p/${plan.publicToken}` : "",
            bosses: plan.bosses,
            updatedAt: plan.updatedAt,
        },
        bosses: bossList(event),
        roster: editorRoster(event),
        hasApprovedSetup: !!approvedSetupOf(event),
        profiles: profileStore.listProfiles(),
        limits: { ...store.LIMITS, profileName: profileStore.LIMITS.name, profileCategory: profileStore.LIMITS.category },
    };
}

/**
 * GET /api/raidplan/public — the read view behind /p/<token>. Only bosses that
 * hold something are listed; `me` is the viewer's own userId when there is a
 * session and they stand in the plan (the page highlights their token).
 */
function publicView(plan, event, { me = "" } = {}) {
    const roster = publicRoster(event);
    const known = new Set(roster.map((r) => r.userId));
    const bosses = bossList(event)
        .filter((b) => plan.bosses[b.key])
        .map((b) => {
            const board = plan.bosses[b.key];
            return {
                key: b.key, name: b.name, instanceName: b.instanceName, iconUrl: b.iconUrl, mapUrl: b.mapUrl,
                tokens: board.tokens.filter((t) => known.has(t.userId)),
                targets: board.targets.map((t) => ({ ...t, userIds: t.userIds.filter((u) => known.has(u)) })),
                notes: board.notes,
                profileName: (profileStore.getProfile(board.profileId) || {}).name || "",
            };
        });
    const used = new Set();
    for (const b of bosses) {
        for (const t of b.tokens) used.add(t.userId);
        for (const tg of b.targets) for (const u of tg.userIds) used.add(u);
    }
    return {
        event: { title: event.title, startTime: event.startTime },
        bosses,
        roster: roster.filter((r) => used.has(r.userId)),
        me: known.has(String(me)) ? String(me) : "",
        loggedIn: !!me,
    };
}

module.exports = { editorView, publicView, editorRoster, publicRoster, bossList, rosterFrom };
