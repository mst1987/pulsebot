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
const inherit = require("./raidplanInherit");
const profileStore = require("./raidplanProfileStore");
const templateStore = require("./raidplanTemplateStore");
const { approvedSetupOf } = require("./setupEditor");
const { rulesFor, DEFAULT_VERSION } = require("../config/gameVersions");
const { wowIconUrl } = require("../config/menu");
const assign = require("./raidplanAssign");
const besetzungOf = require("./raidplanBesetzung");
const catalogStore = require("./raidplanCatalogStore");
const raiderProfiles = require("./raiderProfileStore");
const characterKey = raiderProfiles.characterKey;

const ROLES = ["tank", "healer", "melee", "ranged"];

/**
 * What a raider counts as: the role the setup placed him in when that is one of the four
 * (a feral druid placed as a tank is a tank), else the role of his spec in the rule set
 * (Rogue, Warrior, Retribution, Enhancement, Feral = melee; Mage, Warlock, Hunter, Shadow,
 * Elemental, Balance = ranged), else "dps" — which fits the generic "DPS (egal)" slots
 * only, never a melee or ranged one. A hunter's pet is no raider and is not in the setup.
 */
function resolveRole(placedRole, spec) {
    if (ROLES.includes(placedRole)) return placedRole;
    if (spec && ROLES.includes(spec.role)) return spec.role;
    return "dps";
}

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
            role: resolveRole(p.role, spec),
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

/**
 * The bosses of an event's instances, each with the map it shows (event plan's own,
 * else the template's, else the boss's default, else the instance's default; "" =
 * the grid) and which of those maps exist, so the map dialog can offer each one.
 */
function bossList(event, { templateId = "" } = {}) {
    return store.bossesForInstances(event.instanceIds).map((b) => {
        const map = store.mapForBoss(b, { eventId: event.id, templateId });
        return {
            ...b,
            mapUrl: map ? `/rp-map/${map.key}?v=${map.version}` : "",
            mapSource: map ? map.source : "",
            eventMap: !!store.mapVersion(store.eventMapKey(event.id, b.key)),
            templateMap: !!templateId && !!store.mapVersion(store.templateMapKey(templateId, b.key)),
            ownMap: !!store.mapVersion(b.key),
            instanceMap: !!store.mapVersion(b.instanceId),
        };
    });
}

/** A template with its boards and the bosses of its instances (each with the map it would show). */
function templateView(t) {
    const bosses = store.bossesForInstances(t.instanceIds).map((b) => {
        const map = store.mapForBoss(b, { templateId: t.id });
        return {
            ...b,
            mapUrl: map ? `/rp-map/${map.key}?v=${map.version}` : "",
            mapSource: map ? map.source : "",
            templateMap: !!store.mapVersion(store.templateMapKey(t.id, b.key)),
            ownMap: !!store.mapVersion(b.key),
            instanceMap: !!store.mapVersion(b.instanceId),
        };
    });
    // the Standard: one more "boss" at the end of the list (its own board: the tank / healer basics of every boss)
    if (bosses.length > 0) bosses.push({ key: inherit.DEFAULTS_KEY, instanceId: "", instanceName: "", name: "Standard", defaults: true, iconUrl: wowIconUrl("inv_misc_gear_01", 56), mapUrl: "", mapSource: "", templateMap: false, ownMap: false, instanceMap: false });
    return { ...t, catalog: catalogStore.catalogView(), bossList: bosses, besetzung: besetzungOf.effectiveBesetzung(t.instanceIds, t.size, t.counts) };
}

/** What a template picker needs of a template (no boards). */
function templateSummary(t) {
    return {
        id: t.id, name: t.name, category: t.category, description: t.description,
        guildId: t.guildId, instanceIds: t.instanceIds, bossCount: Object.keys(t.bosses).filter((k) => k !== inherit.DEFAULTS_KEY).length,
    };
}

/** The templates that may be applied to an event: not made for another server. */
function templatesFor(event) {
    return templateStore.listTemplates().filter((t) => !t.guildId || t.guildId === String(event.guildId || ""));
}

/** GET /api/raidplan — everything the editor needs. */
function editorView(event, { canWrite, me = "" }) {
    const plan = store.getPlan(event.id) || store.emptyPlan(event.id);
    const template = plan.templateId ? templateStore.getTemplate(plan.templateId) : null;
    return {
        eventId: event.id,
        event: { id: event.id, title: event.title, startTime: event.startTime },
        canWrite,
        plan: {
            version: plan.version,
            status: plan.status,
            publicPath: plan.publicToken ? `/p/${plan.publicToken}` : "",
            templateId: template ? template.id : "",
            templateName: template ? template.name : "",
            bosses: plan.bosses,
            updatedAt: plan.updatedAt,
        },
        bosses: bossList(event, { templateId: template ? template.id : "" }),
        // the role slots of this raid: the template's when the plan came from one, else the event's own size and composition
        besetzung: template
            ? besetzungOf.effectiveBesetzung(template.instanceIds, template.size, template.counts)
            : eventBesetzung(event),
        roster: editorRoster(event),
        // which players of the lineup the logged-in user is (account + the characters of the raider profile): highlighted on the board
        meIds: identify(me, (me ? (raiderProfiles.getProfile(me) || { characters: [] }).characters : []).map((c) => c.key), editorRoster(event)),
        hasApprovedSetup: !!approvedSetupOf(event),
        profiles: profileStore.listProfiles(),
        templates: templatesFor(event).map(templateSummary),
        catalog: catalogStore.catalogView(),
        limits: { ...store.LIMITS, profileName: profileStore.LIMITS.name, profileCategory: profileStore.LIMITS.category },
    };
}

/**
 * GET /api/raidplan/public — the read view behind /p/<token>. Only bosses that
 * hold something are listed; `me` is the viewer's own userId when there is a
 * session and they stand in the plan (the page highlights their token). A slot
 * whose player is not in the approved setup is shown open.
 */
/**
 * Which players of a lineup the visitor is: the one under their own Discord account, and every one whose
 * character name is one of the characters on the visitor's raider profile (mains and alts, case and
 * realm ignored) — also when the setup lists that character under another account. `keys` = the
 * visitor's character keys (raiderProfileStore.characterKey). Returns userIds, the account's own first.
 */
function identify(viewerId, keys, roster) {
    const own = String(viewerId || "");
    const set = new Set(keys || []);
    const ids = [];
    if (own && roster.some((p) => p.userId === own)) ids.push(own);
    for (const p of roster) {
        if (p.userId !== own && set.has(characterKey(p.character)) && !ids.includes(p.userId)) ids.push(p.userId);
    }
    return ids;
}

function publicView(plan, event, { me = "" } = {}) {
    const roster = publicRoster(event);
    const known = new Set(roster.map((r) => r.userId));
    const profile = me ? raiderProfiles.getProfile(me) : null;
    const meIds = identify(me, profile ? profile.characters.map((c) => c.key) : [], roster);
    const bosses = bossList(event, { templateId: plan.templateId })
        .filter((b) => plan.bosses[b.key])
        .map((b) => {
            const board = plan.bosses[b.key];
            return {
                key: b.key, name: b.name, instanceName: b.instanceName, iconUrl: b.iconUrl, mapUrl: b.mapUrl, trash: !!b.trash, general: !!b.general,
                // objects switched off in the editor's layer list are not drawn here either
                tokens: board.tokens.filter((t) => known.has(t.userId) && !t.hidden),
                slots: (board.slots || []).filter((sl) => !sl.hidden).map((sl) => ({ ...sl, userId: known.has(sl.userId) ? sl.userId : "" })),
                marks: (board.marks || []).filter((m) => !m.hidden),
                icons: (board.icons || []).filter((i) => !i.hidden),
                objectScale: board.objectScale === undefined ? 1 : board.objectScale,
                zones: (board.zones || []).filter((z) => !z.hidden),
                lines: (board.lines || []).filter((l) => !l.hidden),
                texts: (board.texts || []).filter((x) => !x.hidden),
                mapOpacity: board.mapOpacity === undefined ? 1 : board.mapOpacity,
                // the old task rows are shown as assignments (above)
                targets: [],
                mobs: board.mobs || [],
                // assignments: a raider who is not in the approved setup is left out, a slot reference stays (it resolves to nobody = open)
                assignments: [...assign.targetsToAssignments(board.targets, known), ...(board.assignments || [])].map((a) => ({
                    ...a,
                    assignees: a.assignees.filter((r) => !r.startsWith("user:") || known.has(r.slice(5))),
                    targets: a.targets.filter((t) => t.kind !== "player" || known.has(t.ref)),
                })),
                notes: board.notes,
                profileName: (profileStore.getProfile(board.profileId) || {}).name || "",
            };
        });
    const used = new Set();
    for (const b of bosses) {
        for (const t of b.tokens) used.add(t.userId);
        for (const sl of b.slots) if (sl.userId) used.add(sl.userId);
        for (const tg of b.targets) for (const u of tg.userIds) used.add(u);
        // a group marker names the players of that setup group
        for (const a of b.assignments) {
            for (const r of a.assignees) if (r.startsWith("user:")) used.add(r.slice(5));
            for (const t of a.targets) if (t.kind === "player") used.add(t.ref);
        }
        for (const sl of b.slots) if (sl.kind === "group") for (const r of roster) if (r.group === sl.n) used.add(r.userId);
    }
    return {
        event: { title: event.title, startTime: event.startTime },
        bosses,
        roster: roster.filter((r) => used.has(r.userId)),
        me: meIds[0] || "",
        meIds,
        catalog: catalogStore.catalogView(),
        loggedIn: !!me,
    };
}

/**
 * Suggested assignments of one type for a board (POST /api/raidplan/suggest): the board's
 * placeholder slots as the editor holds them, the event's roster (empty without an event, i.e.
 * in a template) and the raid's group numbers.
 */
function suggestFor(type, { event = null, slots = [], roles = {}, preferredClasses = [], allowOthers = false } = {}) {
    // flex: on this boss somebody plays another role than in the setup
    const flex = roles && typeof roles === "object" ? roles : {};
    const roster = (event ? editorRoster(event) : []).map((p) => (flex[p.userId] ? { ...p, role: flex[p.userId] } : p));
    const size = event ? Number(event.size) || 25 : 25;
    const groups = Array.from({ length: Math.max(1, Math.ceil(size / 5)) }, (_, i) => i + 1);
    let clean = (Array.isArray(slots) ? slots : []).map((s) => ({ kind: String(s && s.kind), n: Number(s && s.n) || 0, userId: String((s && s.userId) || "") })).filter((s) => s.n > 0);
    // in an event only the tank and healer slots somebody actually stands in count (a healer who plays DPS here leaves his slot open)
    if (event) clean = clean.filter((s) => (s.kind !== "tank" && s.kind !== "healer") || s.userId);
    return assign.suggest(type, { slots: clean, roster, groups, preferredClasses, allowOthers: allowOthers === true });
}

/** The Besetzung of an event without a template: its size, the planned tanks and healers, the damage dealers split evenly. */
function eventBesetzung(event) {
    const base = besetzungOf.defaultBesetzung(event.instanceIds, event.size);
    const c = event.composition || {};
    if (!(Number(c.tank) > 0 || Number(c.healer) > 0)) return base;
    const tank = Math.max(0, Math.floor(Number(c.tank) || 0));
    const healer = Math.max(0, Math.floor(Number(c.healer) || 0));
    return { ...base, counts: { tank, healer, dps: Math.max(0, base.size - tank - healer), melee: 0, ranged: 0 }, split: false };
}

module.exports = { identify, suggestFor, editorView, publicView, editorRoster, publicRoster, bossList, rosterFrom, resolveRole, templateSummary, templatesFor, templateView };