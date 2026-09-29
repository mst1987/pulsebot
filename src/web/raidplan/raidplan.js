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
const store = require("../../stores/raidplanStore");
const inherit = require("../../services/raidplan/raidplanInherit");
const profileStore = require("../../stores/raidplanProfileStore");
const templateStore = require("../../stores/raidplanTemplateStore");
const { approvedSetupOf, benchAndPool } = require("../../services/setup/setupCore");
const groupsOf = require("../../services/raidplan/raidplanGroups");
const { rulesFor, DEFAULT_VERSION } = require("../../config/gameVersions");
const { wowIconUrl } = require("../../config/menu");
const assign = require("../../services/raidplan/raidplanAssign");
const stepsOf = require("../../services/raidplan/raidplanSteps");
const besetzungOf = require("../../services/raidplan/raidplanBesetzung");
const catalogStore = require("../../stores/raidplanCatalogStore");
const raiderProfiles = require("../../stores/raiderProfileStore");
const characterKey = raiderProfiles.characterKey;

const ROLES = ["tank", "healer", "melee", "ranged"];
// a section that has no board of its own (it only inherits the Standard): read as an empty one
const EMPTY_BOARD = require("../../services/raidplan/raidplanBoard").cleanBoard({}, { allowedUserIds: [] }).board;

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
    const add = (p, group, bench = false) => {
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
            // the SPEC's own role (roleOfSpec): the ranking tells an elemental from an enhancement shaman by it (#501)
            specRole: (spec && spec.role) || "",
            iconUrl: wowIconUrl((spec && spec.icon) || (cls && cls.icon) || "", 56),
            group,
            // on the bench of the setup: part of the plan only with "Bank" in "Gruppen im Plan" (#529)
            ...(bench && !p.gone ? { bench: true } : {}),
            // a Raid-Helper raider (raidhelperRoster.js): the name Raid-Helper shows, and whether no profile character was found for it
            ...(p.rhName ? { rhName: String(p.rhName) } : {}),
            ...(p.nameFromRh ? { nameFromRh: true } : {}),
            // a raider Raid-Helper no longer lists: he keeps his places until the next save with a loaded line-up
            ...(p.gone ? { gone: true } : {}),
        });
    };
    for (const g of (lineup && lineup.groups) || []) for (const s of g.slots || []) add(s, Number(g.index) || 0);
    for (const b of (lineup && lineup.bench) || []) add(b, 0, true);
    return out;
}

/**
 * The players the editor offers: the current lineup, else the approved one. A Raid-Helper event (raidplanRosterSource.js) brings its
 * line-up along as `event.roster` - loaded from Raid-Helper, with the raiders it no longer lists marked `gone`.
 */
function editorRoster(event) {
    if (Array.isArray(event.roster)) return event.roster;
    const setup = event.setup;
    const hasDraft = setup && Array.isArray(setup.groups) && (setup.groups.length || (setup.bench || []).length);
    // the draft's explicit bench only (#517: a setup stored before it listed everybody left over there - the pool never comes in)
    return rosterFrom(hasDraft ? { groups: setup.groups, bench: benchAndPool(setup).bench } : approvedSetupOf(event), event.versionId);
}

/** The Besetzung of an event's plan: the template's when the plan came from one, else the event's own size and composition. */
function planBesetzung(event, plan) {
    const template = plan && plan.templateId ? templateStore.getTemplate(plan.templateId) : null;
    return template ? besetzungOf.effectiveBesetzung(template.instanceIds, template.size, template.counts) : eventBesetzung(event);
}

/** "Gruppen im Plan" (#529): the groups (and "bench") the plan picks its raiders from - what it stores, else the groups up to its size. */
function planIncluded(event, plan) {
    return groupsOf.includedGroups(plan ? plan.includedGroups : null, planBesetzung(event, plan).groups);
}

/** The players a public page names: the approved setup only. */
function publicRoster(event) {
    // a raider Raid-Helper no longer lists is not named on the public page (like one who is not in an own event's approved setup)
    if (Array.isArray(event.roster)) return event.roster.filter((p) => !p.gone);
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

/**
 * The section list of an editor (template or event plan, #524) with the Standard: one more section FIRST, before "Allgemein" and the
 * bosses (its own board: the tank / healer basics every boss and trash inherits, raidplanInherit.js). The public page never lists it.
 */
function withStandard(bosses) {
    const out = bosses.slice();
    if (out.length > 0) out.unshift({ key: inherit.DEFAULTS_KEY, instanceId: "", instanceName: "", name: "Standard", defaults: true, iconUrl: wowIconUrl("inv_misc_gear_01", 56), mapUrl: "", mapSource: "", eventMap: false, templateMap: false, ownMap: false, instanceMap: false });
    return out;
}

/**
 * The EFFECTIVE rows of one section of a plan (#524): its own and the ones it inherits from the plan's Standard, resolved for the section
 * (raidplanInherit.effectiveRows). `meta` = the section's entry of the boss list, `catalogMobs` = the catalog's mobs.
 */
function sectionRows(bosses, meta, catalogMobs) {
    const b = (bosses || {})[meta.key] || {};
    return inherit.effectiveRows(bosses, meta.key, inherit.sectionOf(meta, catalogMobs, b.mobs));
}

/** The keys a save of an event plan may hold: the event's sections and its Standard. */
function planKeys(event) {
    return withStandard(bossList(event)).map((b) => b.key);
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
    return { ...t, bossList: withStandard(bosses), catalog: catalogStore.catalogView(t.versionId), besetzung: besetzungOf.effectiveBesetzung(t.instanceIds, t.size, t.counts) };
}

/** What a template picker needs of a template (no boards). */
function templateSummary(t) {
    return {
        id: t.id, name: t.name, category: t.category, description: t.description,
        guildId: t.guildId, versionId: t.versionId, instanceIds: t.instanceIds, bossCount: Object.keys(t.bosses).filter((k) => k !== inherit.DEFAULTS_KEY).length,
    };
}

/** The game version of an event's plan (#544): the event's own; an event without one is a TBC one. */
function planVersion(event) {
    return (event && event.versionId) || "tbc";
}

/**
 * The templates that may be applied to an event: not made for another server, and of the event's game version (#544).
 * `allVersions`: also those of other versions (the editor lists them apart, applying one asks first).
 */
function templatesFor(event, { allVersions = false } = {}) {
    return templateStore.listTemplates().filter((t) => (!t.guildId || t.guildId === String(event.guildId || "")) && (allVersions || t.versionId === planVersion(event)));
}

/** GET /api/raidplan — everything the editor needs. */
function editorView(event, { canWrite, me = "" }) {
    const plan = store.getPlan(event.id) || store.emptyPlan(event.id);
    const template = plan.templateId ? templateStore.getTemplate(plan.templateId) : null;
    return {
        eventId: event.id,
        event: { id: event.id, title: event.title, startTime: event.startTime },
        // the game version of the plan (#544): the catalog below is that version's; templates and tactics are filtered by it
        versionId: planVersion(event),
        canWrite,
        plan: {
            version: plan.version,
            status: plan.status,
            publicPath: plan.publicToken ? `/p/${plan.publicToken}` : "",
            templateId: template ? template.id : "",
            templateName: template ? template.name : "",
            bosses: plan.bosses,
            updatedAt: plan.updatedAt,
            // "Gruppen im Plan" (#529): null = the groups up to the raid's size, no bench (lib/raidplan/planGroups.ts reads it)
            includedGroups: plan.includedGroups || null,
        },
        bosses: withStandard(bossList(event, { templateId: template ? template.id : "" })),
        // the role slots of this raid: the template's when the plan came from one, else the event's own size and composition
        besetzung: planBesetzung(event, plan),
        roster: editorRoster(event),
        // which players of the lineup the logged-in user is (account + the characters of the raider profile): highlighted on the board
        meIds: identify(me, (me ? (raiderProfiles.getProfile(me) || { characters: [] }).characters : []).map((c) => c.key), editorRoster(event)),
        // a Raid-Helper event has no approval: what Raid-Helper lists counts
        hasApprovedSetup: event.rosterSource ? !!event.rosterSource.available : !!approvedSetupOf(event),
        // where the players of a Raid-Helper event come from (the header shows it); null for an own event
        rosterSource: event.rosterSource || null,
        profiles: profileStore.listProfiles(),
        templates: templatesFor(event, { allVersions: true }).map(templateSummary),
        catalog: catalogStore.catalogView(planVersion(event)),
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
    const lineup = publicRoster(event);
    // who a row may still name (the whole approved lineup), and who the plan picks from: the groups in the plan (#529)
    const known = new Set(lineup.map((r) => r.userId));
    const included = planIncluded(event, plan);
    const roster = groupsOf.planRoster(lineup, included);
    // (group 0: a raider outside the plan is never listed in a group table or ring of the page)
    const outside = groupsOf.outOfPlanRoster(lineup, included).map((p) => ({ ...p, group: 0 }));
    const profile = me ? raiderProfiles.getProfile(me) : null;
    const meIds = identify(me, profile ? profile.characters.map((c) => c.key) : [], lineup);
    const catalogMobs = catalogStore.listMobs();
    // a boss without a board of its own still shows what it inherits from the Standard (#524)
    const inheritsRows = (b) => inherit.inherits(b.key) && sectionRows(plan.bosses, b, catalogMobs).length > 0;
    const bosses = bossList(event, { templateId: plan.templateId })
        // a section switched off for the sheet is not delivered at all (no chip, no data): filtered before anything else is built from it
        .filter((b) => (plan.bosses[b.key] || inheritsRows(b)) && (plan.bosses[b.key] || {}).inSheet !== false)
        .map((b) => {
            const board = plan.bosses[b.key] || EMPTY_BOARD;
            // the role slots as the editor shows them (#529): a raider outside the plan (bench, a group switched off) leaves his slot and
            // only that place is filled again from the plan; a raider who is not in the approved setup leaves it open
            const slots = groupsOf.refillSlots((board.slots || []).map((sl) => ({ ...sl, userId: known.has(sl.userId) ? sl.userId : "" })), roster, board.roles || {}, (board.tokens || []).map((t) => t.userId));
            const inPlanIds = new Set(roster.map((r) => r.userId));
            // a section switched to "no map" sends no map and no objects of the map (like a section left out of the sheet): only its Besetzung,
            // the slots, which the assignments resolve against, and they are not drawn
            const mapOn = board.showMap !== false && !b.general;
            const onMap = (list) => (mapOn ? list : []);
            return {
                key: b.key, name: b.name, instanceName: b.instanceName, iconUrl: b.iconUrl, mapUrl: mapOn ? b.mapUrl : "", trash: !!b.trash, general: !!b.general, showMap: mapOn,
                // objects switched off in the editor's layer list are not drawn here either
                tokens: onMap(board.tokens.filter((t) => inPlanIds.has(t.userId) && !t.hidden)),
                slots: slots.filter((sl) => !sl.hidden).map((sl) => ({ ...sl, ...(mapOn ? {} : { placed: false }) })),
                marks: onMap((board.marks || []).filter((m) => !m.hidden)),
                icons: onMap((board.icons || []).filter((i) => !i.hidden)),
                objectScale: board.objectScale === undefined ? 1 : board.objectScale,
                zones: onMap((board.zones || []).filter((z) => !z.hidden)),
                lines: onMap((board.lines || []).filter((l) => !l.hidden)),
                texts: onMap((board.texts || []).filter((x) => !x.hidden)),
                mapOpacity: board.mapOpacity === undefined ? 1 : board.mapOpacity,
                showRings: board.showRings !== false,
                groupColors: board.groupColors || {},
                groupMarks: board.groupMarks || {},
                showNames: board.showNames !== false,
                view: board.view || null,
                showBadges: board.showBadges !== false,
                showRoleRings: board.showRoleRings !== false,
                // the tank rows put their mobs and tanks on the map (the page derives them); without the map: nothing of it
                // who plays another role on this boss (flex): the role groups ("Melees -> Boss") follow it
                roles: Object.fromEntries(Object.entries(board.roles || {}).filter(([u]) => known.has(u))),
                autoPlace: board.autoPlace !== false,
                autoPos: mapOn ? board.autoPos || {} : {},
                autoStyle: mapOn ? board.autoStyle || {} : {},
                autoScale: board.autoScale === undefined ? 1 : board.autoScale,
                // the old task rows are shown as assignments (above)
                targets: [],
                mobs: board.mobs || [],
                // assignments: a raider who is not in the approved setup is left out, a slot reference stays (it resolves to nobody = open)
                // a class reference ("the first free Hunter") is resolved here, from the whole approved setup: the page only gets the raiders a plan names
                // the section's EFFECTIVE rows: its own and the ones it inherits from the Standard (#524)
                assignments: assign.expandClassRefs([...assign.targetsToAssignments(board.targets, known), ...sectionRows(plan.bosses, b, catalogMobs)].map((a) => ({
                    ...a,
                    assignees: a.assignees.filter((r) => !r.startsWith("user:") || known.has(r.slice(5))),
                    targets: a.targets.filter((t) => t.kind !== "player" || known.has(t.ref)),
                })), slots, roster, board.roles || {}),
                // the tactic: each step resolved on its own from the approved setup (a missing class stays its reference: an open chip)
                steps: stepsOf.resolveSteps(board.steps || [], { slots, roster, roles: board.roles || {}, known }),
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
        for (const u of stepsOf.stepUsers(b.steps)) used.add(u);
        for (const s of b.steps) for (const r of s.participants) if (r.startsWith("group:")) for (const p of roster) if (p.group === Number(r.slice(6))) used.add(p.userId);
        for (const a of b.assignments) {
            for (const r of a.assignees) if (r.startsWith("user:")) used.add(r.slice(5));
            for (const t of a.targets) if (t.kind === "player") used.add(t.ref);
        }
        for (const sl of b.slots) if (sl.kind === "group") for (const r of roster) if (r.group === sl.n) used.add(r.userId);
        // a role group ("Melees -> Boss") concerns every raider of that role: the page needs them to show it under "Meine Aufgaben"
        const roleRefs = new Set();
        for (const a of b.assignments) {
            for (const r of a.assignees) if (r.startsWith("role:")) roleRefs.add(r.slice(5));
            for (const t of a.targets) if (t.kind === "role") roleRefs.add(t.ref);
        }
        for (const s of b.steps) for (const r of s.participants) if (r.startsWith("role:")) roleRefs.add(r.slice(5));
        for (const role of roleRefs) for (const r of roster) if (assign.inRoleGroup(role, b.roles[r.userId] || r.role)) used.add(r.userId);
        // the group healing table shows every group with its members: a board that heals groups knows the whole lineup
        if (b.assignments.some((a) => a.type === "heal" && a.targets.some((t) => t.kind === "group"))) for (const r of roster) used.add(r.userId);
    }
    return {
        event: { title: event.title, startTime: event.startTime },
        // how many sections hold something but are left out of the sheet (a number only, nothing of them)
        hiddenCount: bossList(event, { templateId: plan.templateId }).filter((b) => plan.bosses[b.key] && plan.bosses[b.key].inSheet === false).length,
        bosses,
        // a raider outside the plan only when a row names him, marked `outOfPlan` (the page leaves him out of groups and auto tokens)
        roster: [...roster, ...outside].filter((r) => used.has(r.userId)),
        me: meIds[0] || "",
        meIds,
        catalog: catalogStore.catalogView(planVersion(event)),
        loggedIn: !!me,
    };
}

/**
 * Suggested assignments of one type for a board (POST /api/raidplan/suggest): the board's
 * placeholder slots as the editor holds them, the event's roster (empty without an event, i.e.
 * in a template) and the raid's group numbers.
 */
function suggestFor(type, { event = null, versionId: templateVersion = "", slots = [], roles = {}, preferredClasses = [], allowOthers = false, keep = [], preferredRole = "", context = [], spellId = "" } = {}) {
    // only the catalog of the plan's game version (#544): a TBC plan never offers Tricks of the Trade, a Forever plan no TBC-only spell;
    // a template's suggestion has no event and names its template's version
    const versionId = event ? planVersion(event) : templateVersion || "tbc";
    // flex: on this boss somebody plays another role than in the setup
    const flex = roles && typeof roles === "object" ? roles : {};
    // the raiders of the groups in the plan (#529): a bench raider is never suggested
    const plan = event ? store.getPlan(event.id) : null;
    const included = event ? planIncluded(event, plan) : groupsOf.defaultIncludedGroups(5);
    const roster = (event ? groupsOf.planRoster(editorRoster(event), included) : []).map((p) => (flex[p.userId] ? { ...p, role: flex[p.userId] } : p));
    const groups = groupsOf.groupNumbers(included);
    let clean = (Array.isArray(slots) ? slots : []).map((s) => ({ kind: String(s && s.kind), n: Number(s && s.n) || 0, userId: String((s && s.userId) || "") })).filter((s) => s.n > 0);
    // in an event only the tank and healer slots somebody actually stands in count (a healer who plays DPS here leaves his slot open)
    if (event) clean = clean.filter((s) => (s.kind !== "tank" && s.kind !== "healer") || s.userId);
    // the rows of this type the orga keeps (made by hand): the raiders they name are taken, the suggestion goes round the others
    const known = new Set(roster.map((p) => p.userId));
    const rowsOf = (list) => (Array.isArray(list) && list.length > 0 ? (assign.cleanAssignments(list.slice(0, assign.LIMITS.perBoard), known).assignments || []) : []);
    const kept = rowsOf(keep);
    // the board's rows of the other kinds of task: who tanks here and who already has how many tasks (the ranking, #501)
    const others = rowsOf(Array.isArray(context) ? context.filter((a) => a && a.type !== type) : []);
    return assign.suggest(type, {
        slots: clean, roster, groups, preferredClasses, allowOthers: allowOthers === true, versionId, keep: kept,
        preferredRole: String(preferredRole || ""), context: others, roles: flex,
        // the row dialog's wand on a row with a spell (a debuff, a blessing, an aura, a totem; #536): a raider for that very spell
        spellId: String(spellId || ""),
    });
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

module.exports = { planVersion, planBesetzung, planIncluded, withStandard, planKeys, sectionRows, identify, suggestFor, editorView, publicView, editorRoster, publicRoster, bossList, rosterFrom, resolveRole, templateSummary, templatesFor, templateView };