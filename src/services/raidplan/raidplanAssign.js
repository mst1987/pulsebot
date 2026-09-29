// Raid plan assignments ("Einteilungen", docs/raidplan.md): who heals whom, who kicks in
// which order, misdirects, soulstones, curses, trash tanks and so on. One model for all:
//
//   { id, type, title, assignees: [ref], targets: [{ kind, ref }], note, suggested, count?, classPriority? }
//   (`title` is the free text of the task: "Kick Fear", "Interrupt Shadow Bolt Volley" ...)
//
//   count + classPriority (#525): "1 x Paladin > Shaman" - the row wants `count` raiders (its fixed assignees count), taken class by class
//                  in that order (expandClassRefs); a row without them is exactly what it was before
//   assignee ref   "class:<Class>:<n>[:<role>]"  the n-th free raider of that class (resolved from the setup, never stored; `picks` = a hand-made choice)
//                  "slot:<kind>:<n>"  a placeholder slot of the board (tank/healer/melee/ranged/dps n)
//                  "user:<userId>"    one raider (event plans only)
//                  "role:<role>"      a whole role group (melee, ranged, healer, tank, dps): never split into players, no count, no fallback
//   target         { kind: "slot",   ref: "tank:1" }     a slot of the board
//                  { kind: "group",  ref: "3" }          setup group 3
//                  { kind: "role",   ref: "melee" }      all melees (a role group, like the map's placeholder)
//                  { kind: "player", ref: "<userId>" }   one raider (event plans only)
//                  { kind: "mark",   ref: "skull" }      a raid mark (also "who takes which target" on trash)
//                  { kind: "text",   ref: "Fear" }       free text: an ability, an enemy, a curse
//                  { kind: "mob",    ref: "d:gathios", name, icon, n? }  a mob of the catalog or the section's boss ("b:<boss key>"); name and icon are
//                                    a snapshot, shown when the catalog entry is gone; `n` (1..20) = which of several mobs of that kind
//                                    ("Flame of Azzinoth 2"), none = the row's own one (docs/raidplan.md, auto placement)
//   spell        { id, name, icon } | null   the catalog spell the row is about (a curse, a kick ...), with the same kind of snapshot
//
// Only references are stored, never names or icons: those are looked up live from the setup.
// A slot reference is a placeholder in a template and points at whoever stands in that
// slot in an event plan, so applying a template needs no rewriting. The order of the
// assignees is the order of a rotation (kicks: 1, 2, 3).
//
// Also here, pure and tested: the suggestions ("Heiler verteilen", "Aus Setup
// vorschlagen"). They never guess: nobody fits, nothing is suggested.

const { ASSIGN_TYPES, CLASS_IDS } = require("./raidplanConstants");
const catalog = require("../../stores/raidplanCatalogStore");
const { str } = require("../../utils/text");
const { newId } = require("../../utils/ids");

// a whole role group as who does it / at whom ("Melees -> Boss", "Ranged soaken hier")
const ROLE_REFS = ["melee", "ranged", "healer", "tank", "dps"];
const ROLE_ASSIGNEE = /^role:(melee|ranged|healer|tank|dps)$/;
/**
 * Whether a raider belongs to a role group ("Melees" ...): his spec role from the setup, a flex role on this boss wins; "dps" = everybody
 * who is neither tank nor healer. The client twin is lib/raidplan/assign.ts inRoleGroup (kept in step by the tests).
 */
function inRoleGroup(role, playerRole) {
    if (!role || !playerRole) return false;
    return role === "dps" ? playerRole !== "tank" && playerRole !== "healer" : playerRole === role;
}
// a mob of the catalog (d:.. / c:..) or the boss of the section (b:<boss key>)
const MOB_REF = /^[dcb]:[\w\-/']{1,70}$/;
const SPELL_ID = /^[dc]:[\w-]{1,40}$/;
const ICON = /^([a-z0-9_'-]{2,64}|(?:boss|mob):\d{1,6})$/;
const SLOT_REF = /^slot:(tank|healer|melee|ranged|dps):(\d{1,3})$/;
// a class as who does it / at whom: "class:Hunter:1" = the 1st free Hunter (n counts per class and kind of task); an optional last part limits the role.
// "class:Any:<n>:<role>" = any raider of that SPEC role ("Beliebiger Tank"); it always names the role (no class, no role = no guess).
// "any" as the role = ANY spec of the class, chosen on purpose ("a mage tanks the council"): the role the task implies is not applied
const CLASS_ASSIGNEE = /^class:(Warrior|Paladin|Hunter|Rogue|Priest|Shaman|Mage|Warlock|Druid):([1-9]\d?)(?::(tank|healer|dps|melee|ranged|any))?$|^class:Any:([1-9]\d?):(tank|healer|dps|melee|ranged)$/;
const CLASS_TARGET = /^(Warrior|Paladin|Hunter|Rogue|Priest|Shaman|Mage|Warlock|Druid):([1-9]\d?)(?::(tank|healer|dps|melee|ranged|any))?$|^Any:([1-9]\d?):(tank|healer|dps|melee|ranged)$/;
/** The "class" of a reference that means any raider of a role. */
const ANY = "Any";
const SLOT_TARGET = /^(tank|healer|melee|ranged|dps):(\d{1,3})$/;
const ID_REF = /^[\w-]{1,40}$/;
const MARKS = ["skull", "cross", "square", "moon", "triangle", "diamond", "circle", "star"];
// the rows that put their tanks on the map by themselves (twin of lib/raidplan/autoPlace.ts AUTO_TANK_TYPES)
const AUTO_TANK_TYPES = ["tank", "trashtank", "special"];
const LIMITS = { perBoard: 60, assignees: 12, targets: 12, note: 200, text: 60, title: 80 };
/** The roles a row can prefer (the row dialog's "Rolle"); none stored = any. */
const PREFERRED_ROLES = ["melee", "ranged", "healer", "tank"];

// Which classes can do it (Vorschlag / Filter). Kick: rogue, warrior, mage (Counterspell), shaman (Earth Shock).
const CLASS_RULES = {
    kick: ["Rogue", "Shaman", "Warrior", "Mage"],
    // Misdirection is a hunter's (Tricks of the Trade, the rogue's, is Wrath of the Lich King and comes with the catalog's `versions`)
    md: ["Hunter"],
    ss: ["Warlock"],
    fearward: ["Priest"],
    curse: ["Warlock"],
    thunderclap: ["Warrior"],
    demoshout: ["Warrior"],
    // #536: the classes of the catalog's spells of these types say it; the lists only serve when the catalog has none
    debuff: ["Warrior", "Druid", "Hunter", "Mage", "Priest", "Paladin", "Rogue"],
    blessing: ["Paladin"],
    aura: ["Paladin"],
    totem: ["Shaman"],
    brez: ["Druid"],
};
// The curses handed out, in the order of the warlocks.
const CURSES = ["Curse of the Elements", "Curse of Recklessness", "Curse of Doom"];

const SLOT_ROLES = ["tank", "healer", "melee", "ranged", "dps"];
/** A list of class ids as stored: only known classes, each once, in the order given. */
function cleanClasses(raw) {
    return [...new Set((Array.isArray(raw) ? raw : []).map((c) => String(c === null || c === undefined ? "" : c).trim()).filter((c) => CLASS_IDS.includes(c)))];
}

/** The most raiders a row with a class priority asks for. */
const MAX_COUNT = 40;
/** The places a row with a class priority asks for: a whole number 1..40, anything else = 1. */
function rowCount(v) {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= MAX_COUNT ? n : 1;
}
/** The class priority of a row as it is resolved: known classes, each once, in the order given. */
function classPriorityOf(a) {
    return cleanClasses(a && a.classPriority);
}
/** `{ classPriority, count }` of a row as it is stored (#525), or nothing when the row has no class list (it stays exactly as before). */
function priorityOf(o) {
    const prio = classPriorityOf(o);
    return prio.length ? { classPriority: prio, count: rowCount(o.count) } : {};
}

/** Which of several mobs of one kind a target means: 1..20, 0 = none given (the row's own). */
const mobInstance = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 1 && n <= 20 ? n : 0; };

/**
 * Cleans a list of assignments. `allowed` = the userIds an event plan may name (empty in
 * a template: `user:` and `player` references are dropped there). Returns
 * `{ assignments, dropped }` or `{ code, error }`.
 */
function cleanAssignments(raw, allowed = new Set()) {
    // older plans may hold the same class reference twice (one per row, or twice in a row): numbered on, nothing is dropped
    const list = renumberClassRefs(Array.isArray(raw) ? raw : []);
    if (list.length > LIMITS.perBoard) return { code: "invalid", error: `Höchstens ${LIMITS.perBoard} Einteilungen je Boss.` };
    let dropped = 0;
    const ids = new Set();
    const out = [];
    for (const a of list) {
        const o = a && typeof a === "object" ? a : {};
        let id = str(o.id).replace(/[^\w-]/g, "").slice(0, 24);
        if (!id || ids.has(id)) id = newId(5);
        ids.add(id);

        const assignees = [];
        for (const ref of Array.isArray(o.assignees) ? o.assignees : []) {
            const r = str(ref);
            const isUser = r.startsWith("user:") && ID_REF.test(r.slice(5)) && allowed.has(r.slice(5));
            if ((!SLOT_REF.test(r) && !isUser && !CLASS_ASSIGNEE.test(r) && !ROLE_ASSIGNEE.test(r)) || assignees.includes(r)) { dropped += 1; continue; }
            if (assignees.length >= LIMITS.assignees) break;
            assignees.push(r);
        }

        const targets = [];
        for (const t of Array.isArray(o.targets) ? o.targets : []) {
            const kind = str(t && t.kind);
            let ref = str(t && t.ref);
            let good = false;
            if (kind === "slot") good = SLOT_TARGET.test(ref);
            else if (kind === "group") good = /^\d{1,2}$/.test(ref) && Number(ref) >= 1 && Number(ref) <= 20;
            else if (kind === "player") good = ID_REF.test(ref) && allowed.has(ref);
            else if (kind === "mark") good = MARKS.includes(ref);
            else if (kind === "text") { ref = ref.slice(0, LIMITS.text); good = ref !== ""; }
            else if (kind === "mob") good = MOB_REF.test(ref);
            else if (kind === "class") good = CLASS_TARGET.test(ref);
            else if (kind === "role") good = ROLE_REFS.includes(ref);
            // several mobs of one kind: the instance number (1..20); none = the row's own mob
            const inst = kind === "mob" ? mobInstance(t.n) : 0;
            // one placed icon of that mob (its board id): this very one, not the kind (docs/raidplan.md, "One mob of several")
            const oid = kind === "mob" && ID_REF.test(str(t.oid)) ? str(t.oid).slice(0, 24) : "";
            if (!good || targets.some((x) => x.kind === kind && x.ref === ref && (x.n || 0) === inst && (x.oid || "") === oid)) { dropped += 1; continue; }
            if (targets.length >= LIMITS.targets) break;
            targets.push(kind === "mob" ? { kind, ref, name: str(t.name).slice(0, LIMITS.text), icon: ICON.test(str(t.icon)) ? str(t.icon) : "", ...(inst ? { n: inst } : {}), ...(oid ? { oid } : {}) } : { kind, ref });
        }

        const sp = o.spell && typeof o.spell === "object" ? o.spell : null;
        const spell = sp && SPELL_ID.test(str(sp.id)) && str(sp.name) ? { id: str(sp.id), name: str(sp.name).slice(0, LIMITS.text), icon: ICON.test(str(sp.icon)) ? str(sp.icon) : "" } : null;

        // a class picked by hand for one of the row's class references (key: the assignee ref, or "t:" + the target ref): a raider of this event
        const picks = {};
        const rawPicks = o.picks && typeof o.picks === "object" ? o.picks : {};
        for (const key of Object.keys(rawPicks).slice(0, 24)) {
            const who = str(rawPicks[key]);
            const known = assignees.includes(key) || (key.startsWith("t:") && targets.some((x) => x.kind === "class" && x.ref === key.slice(2)));
            if (known && ID_REF.test(who) && allowed.has(who)) picks[key] = who;
        }

        out.push({
            id, type: ASSIGN_TYPES.includes(o.type) ? o.type : "other", title: str(o.title).slice(0, LIMITS.title), spell, assignees, targets,
            note: str(o.note).slice(0, LIMITS.note), suggested: o.suggested === true,
            // the class(es) that should do it (only known classes, once each) and whether a suggestion may take others when none fits
            preferredClasses: cleanClasses(o.preferredClasses), allowOthers: o.allowOthers === true, picks, allowMulti: o.allowMulti === true,
            // where the row comes from: "default" (written in from the template's Standard) or the id of the default row a boss deviated from
            origin: /^[\w-]{1,24}$/.test(str(o.origin)) ? str(o.origin) : "",
            // "Auf Map setzen" of a task row (kick, special task ...): its named raiders stand on the map as auto tokens (docs/raidplan/board.md,
            // "Auto tokens of every task row"); a tank row is on the map anyway. Only stored when on, so older boards stay exactly as they are
            ...(o.onMap === true && !AUTO_TANK_TYPES.includes(o.type) ? { onMap: true } : {}),
            // the role the row prefers for its suggestions and class references ("Fernkampf": an elemental shaman before an enhancement one);
            // only stored when chosen, so older boards stay exactly as they are
            ...(PREFERRED_ROLES.includes(o.preferredRole) ? { preferredRole: o.preferredRole } : {}),
            // "1 x Paladin > Shaman" (#525): how many the row wants and its classes in the order they are asked; only stored with a class list
            ...priorityOf(o),
        });
    }
    return { assignments: out, dropped };
}

/** The same assignments under new ids (a template copied into a plan); the references stay. */
function reidAssignments(list) {
    return (list || []).map((a) => ({ ...a, id: newId(5) }));
}

// ---- suggestions ---------------------------------------------------------------------------

const slotsOf = (slots, kind) => (slots || []).filter((s) => s.kind === kind).sort((a, b) => a.n - b.n);
const refOf = (s) => `slot:${s.kind}:${s.n}`;
const make = (type, assignees, targets, spell = null, pref = [], allowOthers = false) => ({ id: newId(5), type, title: "", spell, assignees, targets, note: "", suggested: true, preferredClasses: cleanClasses(pref), allowOthers: allowOthers === true });

/** The classes that fit a type: the catalog's spells of that type say it; without any, the built in rules. */
function classesFor(type, prefer = [], allowOthers = false, versionId = "") {
    const fromCatalog = catalog.classesOf(type, versionId);
    const rules = CLASS_RULES[type] || [];
    // the built in order (rogue before mage ...) first, then what the admin added
    const base = fromCatalog.length ? [...rules.filter((c) => fromCatalog.includes(c)), ...fromCatalog.filter((c) => !rules.includes(c))] : rules;
    const pref = cleanClasses(prefer);
    if (!pref.length) return base;
    // a row's own preferred classes win over the catalog's; the usual classes only follow when others are allowed
    // no silent fallback: the usual classes only follow when the row explicitly allows others
    return allowOthers ? [...pref, ...base.filter((c) => !pref.includes(c))] : pref;
}

/** A row's spell as it is stored: the catalog entry with a snapshot of name and icon; one of the class first, else the first of the type. */
function spellFor(type, classId, index = 0, versionId = "") {
    const list = catalog.spellsOfType(type, versionId);
    const of = classId ? list.filter((x) => x.classes.includes(classId)) : list;
    const hit = (of.length ? of : list)[index] || (of.length ? of : list)[0];
    return hit ? { id: hit.id, name: hit.name, icon: hit.icon } : null;
}

/**
 * Heal assignments: every tank gets a healer (healer 1 to tank 1, healer 2 to tank 2 ...),
 * the remaining healers take the raid groups, every group at least one healer and evenly
 * (a group always goes to the healer with the fewest targets so far, the tank healers last
 * on a tie). Healers are the board's healer slots; without slots the roster's healers
 * (`user:` refs). Returns one assignment per healer that has a target.
 */
function suggestHeal({ slots = [], roster = [], groups = [], preferredClasses = [], allowOthers = false }) {
    let healerSlots = slotsOf(slots, "healer");
    const pref = cleanClasses(preferredClasses);
    if (pref.length && healerSlots.length) {
        // healers of the preferred class first; the others only when they are allowed (an empty slot has no class and stays)
        const cls = (s) => (roster.find((p) => p.userId === s.userId) || {}).classId;
        const fits = healerSlots.filter((s) => !s.userId || pref.includes(cls(s)));
        healerSlots = allowOthers ? [...fits, ...healerSlots.filter((s) => !fits.includes(s))] : fits;
    }
    const healers = healerSlots.length ? healerSlots.map(refOf) : roster.filter((p) => p.role === "healer").map((p) => `user:${p.userId}`);
    const tanks = slotsOf(slots, "tank").map((s) => ({ kind: "slot", ref: `tank:${s.n}` }));
    if (!healers.length) return [];
    const targets = healers.map(() => []);
    tanks.forEach((tk, i) => targets[i % healers.length].push(tk));
    const load = targets.map((t) => t.length);
    const tankHealers = Math.min(tanks.length, healers.length);
    for (const g of groups) {
        let best = 0;
        for (let i = 1; i < healers.length; i += 1) {
            if (load[i] < load[best] || (load[i] === load[best] && best < tankHealers && i >= tankHealers)) best = i;
        }
        targets[best].push({ kind: "group", ref: String(g) });
        load[best] += 1;
    }
    return healers.map((h, i) => (targets[i].length ? make("heal", [h], targets[i], spellFor("heal", ""), preferredClasses, allowOthers) : null)).filter(Boolean);
}

// dispel / cc / buff: the row dialog's wand names the one raider of the row's classes who ranks best (decurse: not the druid tank, #501)
const CLASS_SUGGESTED = ["md", "fearward", "kick", "ss", "curse", "thunderclap", "demoshout", "dispel", "cc", "buff", "debuff", "blessing", "brez"];

// #536: which catalog spells a suggestion hands out, in this order (slugs of the defaults; an entry the admin hid is skipped). `roles` = the
// spec roles tried one after the other ("" = any): Sunder Armor and Faerie Fire from a tank first (he keeps them up anyway), the shadow
// priest's and the fire mage's debuffs never from a healer. Expose Armor (does not stack with Sunder), Misery (the same shadow priest as
// Shadow Weaving) and Judgement of the Crusader stay in the catalog for a row made by hand.
const DEBUFF_PLAN = [
    { spell: "sunder-armor", roles: ["tank", ""] },
    { spell: "faerie-fire", roles: ["tank", ""] },
    { spell: "hunters-mark" },
    { spell: "improved-scorch", roles: ["dps"] },
    { spell: "shadow-weaving", roles: ["dps"] },
    { spell: "judgement-of-wisdom" },
    { spell: "judgement-of-light" },
];
// one blessing per paladin, in this order (a template names the first four)
const BLESSING_PLAN = ["blessing-of-kings", "blessing-of-might", "blessing-of-wisdom", "blessing-of-salvation", "blessing-of-light", "blessing-of-sanctuary"];
// auras and totems are party-wide: one row per paladin / shaman for HIS group, the spell by his role (the first of the list his group has not
// got yet, then the fallback list); the passive auras of a spec (Trueshot, Leader of the Pack ...) are never suggested
const GROUP_BUFF_PLAN = {
    aura: {
        classId: "Paladin",
        byRole: { tank: ["devotion-aura"], melee: ["retribution-aura"], healer: ["concentration-aura"] },
        fallback: ["devotion-aura", "retribution-aura", "concentration-aura", "shadow-resistance-aura", "fire-resistance-aura", "frost-resistance-aura"],
    },
    totem: {
        classId: "Shaman",
        byRole: { melee: ["windfury-totem"], ranged: ["wrath-of-air-totem"], healer: ["mana-spring-totem"] },
        fallback: ["windfury-totem", "grace-of-air-totem", "wrath-of-air-totem", "strength-of-earth-totem", "mana-spring-totem"],
    },
};
/** A default spell of the catalog by its slug, with its classes, or null (hidden by the admin, another game version). */
function spellBySlug(type, slug, versionId = "") {
    const hit = catalog.spellsOfType(type, versionId).find((x) => x.id === `d:${slug}`);
    return hit ? { id: hit.id, name: hit.name, icon: hit.icon, classes: hit.classes } : null;
}
/** A spell as a row stores it: the id with a snapshot of name and icon. */
const snapOf = (sp) => (sp ? { id: sp.id, name: sp.name, icon: sp.icon } : null);

/**
 * Suggestions for one type from the placeholder slots and the setup's roster. `groups` = the group numbers of the raid.
 * The class-based ones (misdirect, soulstone, kicks, curses ...) are written as CLASS REFERENCES first ("Hunter 1 -> Tank 1",
 * "Hunter 2 -> Tank 2" ...) — in a template they stay that way; in an event they go through the same round-robin resolution as
 * every plan (`expandClassRefs`), next to the rows of that type the orga already made by hand (`keep`), so a suggestion never
 * takes a raider the orga has already given that task. What nobody fills is left out (no suggestion is better than a stranger).
 */
function suggest(type, { slots = [], roster = [], groups = [], preferredClasses = [], allowOthers = false, versionId = "", keep = [], preferredRole = "", context = [], roles = {}, spellId = "" } = {}) {
    const tanks = slotsOf(slots, "tank");
    const pc = cleanClasses(preferredClasses);
    const pr = PREFERRED_ROLES.includes(preferredRole) ? preferredRole : "";
    const classes = (t) => classesFor(t, pc, allowOthers, versionId);
    if (type === "heal") return suggestHeal({ slots, roster, groups, preferredClasses: pc, allowOthers });
    if (type === "trashtank") {
        return tanks.slice(0, MARKS.length).map((s, i) => make("trashtank", [refOf(s)], [{ kind: "mark", ref: MARKS[i] }]));
    }
    if (GROUP_BUFF_PLAN[type]) return suggestGroupBuffs(type, { roster, versionId, keep, context, roles, slots, spellId: str(spellId) });
    if (!CLASS_SUGGESTED.includes(type)) return [];
    // the other rows of the board (other kinds of task): who tanks here and who already has how many tasks (the ranking, #501)
    const others = (context || []).filter((a) => a && a.type !== type);
    const own = (keep || []).filter((a) => a && a.type === type);
    // their class references resolved first: a "Magier-Tank" row counts its mage as a tank
    const named = roster.length ? expandClassRefs([...others, ...own], slots, roster, roles) : [...others, ...own];
    const ctx = { ...boardContext(named, slots, roles), spellClasses: catalog.classesOf(type, versionId) };
    const rows = suggestClassRows(type, { tanks, cls: classes(type), pc, allowOthers, roster, versionId, pr, ctx, spellId: str(spellId) })
        .map((a) => (pr ? { ...a, preferredRole: pr } : a));
    // a template has no players: the suggestion names classes ("the first free Hunter"), resolved from the setup once the template is
    // applied; its running numbers go on after the rows the orga keeps (a kept "Hunter 1" makes the suggestion start at Hunter 2)
    if (roster.length === 0) return renumberClassRefs([...own, ...rows]).slice(own.length);
    return resolveSuggested(type, rows, { roster, slots, keep: own, context: others, roles });
}

/**
 * The class-reference rows of a suggestion, numbered on per class ("Hunter 1", "Hunter 2" ...): one row per tank for misdirect /
 * fear ward, one per healer for soulstones, a kick rotation, one row per curse, thunder clap from the warrior TANKS first. With a
 * roster the raiders of the row's classes are RANKED (rankCandidates: the row's role, a spell of the catalog, no tank for utility,
 * few tasks; a tie keeps the class order and then the setup order) and a tank / healer who should not do it is left out while
 * somebody else can (`withoutMisfits`); each class is numbered only as often as it is taken. Without a roster (a template) the counts
 * are what the task asks for.
 */
function suggestClassRows(type, { tanks, cls, pc, allowOthers, roster = [], versionId = "", pr = "", ctx = {}, spellId = "" }) {
    if (!cls.length) return [];
    const ref = (c, n, role = "") => `class:${c}:${n}${role ? `:${role}` : ""}`;
    const withRoster = roster.length > 0;
    const row = { type, preferredRole: pr };
    /** The first `count` class references (with a roster: the ranked raiders of the classes, each class numbered on). */
    const sequence = (count, role = "") => {
        const out = [];
        if (!withRoster) {
            for (const c of cls) for (let n = 1; n <= count && out.length < count; n += 1) out.push({ c, ref: ref(c, n, role) });
            return out;
        }
        // today's order (the classes in order, then the setup) is the tie break of the ranking
        const cands = cls.flatMap((c) => roster.filter((p) => p.classId === c && roleFits(role, p.role)));
        const taken = {};
        for (const p of rankCandidates(row, withoutMisfits(row, cands, ctx), ctx)) {
            if (out.length >= count) break;
            taken[p.classId] = (taken[p.classId] || 0) + 1;
            out.push({ c: p.classId, ref: ref(p.classId, taken[p.classId], role) });
        }
        return out;
    };
    if (type === "md" || type === "fearward") {
        const targets = withRoster ? tanks : tanks.slice(0, 3);
        return sequence(targets.length).map((x, i) => make(type, [x.ref], [{ kind: "slot", ref: `tank:${targets[i].n}` }], withRoster ? spellFor(type, x.c, 0, versionId) : null, pc, allowOthers));
    }
    if (type === "ss") {
        const healers = withRoster ? roster.filter((p) => p.role === "healer") : [];
        if (!withRoster) return [make("ss", [ref(cls[0], 1)], [], null, pc, allowOthers)];
        return sequence(healers.length).map((x, i) => make("ss", [x.ref], [{ kind: "player", ref: healers[i].userId }], spellFor("ss", x.c, 0, versionId), pc, allowOthers));
    }
    if (type === "kick") {
        // rogues first, then shaman, warriors, mages; a rotation of at most three (without a roster: one of each class)
        const refs = withRoster ? sequence(3).map((x) => x.ref) : cls.slice(0, 3).map((c) => ref(c, 1));
        return refs.length ? [make("kick", refs, [], null, pc, allowOthers)] : [];
    }
    if (type === "curse") {
        // one curse per warlock, in the order of the catalog's curses (Elements, Recklessness, Doom ...)
        const curses = catalog.spellsOfType("curse");
        const count = Math.min(3, curses.length || CURSES.length);
        return Array.from({ length: count }, (_, i) => make("curse", [ref(cls[0], i + 1)], [], withRoster && curses[i] ? { id: curses[i].id, name: curses[i].name, icon: curses[i].icon } : null, pc, allowOthers));
    }
    if (type === "thunderclap") {
        // the warrior tanks first, then the other warriors (by their spec role, never a guess)
        if (!withRoster) return [make(type, [ref(cls[0], 1), ref(cls[0], 2)], [], null, pc, allowOthers)];
        const refs = [...sequence(2, "tank"), ...sequence(2, "dps")].slice(0, 2).map((x) => x.ref);
        return refs.length ? [make(type, refs, [], spellFor(type, "Warrior", 0, versionId), pc, allowOthers)] : [];
    }
    if (type === "demoshout") {
        if (!withRoster) return [make(type, [ref(cls[0], 1)], [], null, pc, allowOthers)];
        const refs = sequence(3).map((x) => x.ref);
        return refs.length ? [make(type, refs, [], spellFor(type, "Warrior", 0, versionId), pc, allowOthers)] : [];
    }
    if (type === "debuff") return suggestDebuffs({ cls, pc, allowOthers, roster, versionId, pr, ctx, spellId });
    if (type === "blessing") {
        // one blessing per paladin (a template names the first four)
        const plan = blessingPlan(spellId, versionId);
        return sequence(withRoster ? plan.length : Math.min(4, plan.length)).map((x, i) => make(type, [x.ref], [], plan[i], pc, allowOthers));
    }
    // dispel, cc, buff, brez: one raider (with a roster the best ranked one of the classes); a battle res row gets Rebirth
    const one = withRoster ? sequence(1) : [{ c: cls[0], ref: ref(cls[0], 1) }];
    return one.map((x) => make(type, [x.ref], [], SPELL_OF_ONE.includes(type) ? spellFor(type, x.c, 0, versionId) : null, pc, allowOthers));
}

/** The one-raider suggestions that also fill the spell (a battle res row: Rebirth); dispel, cc and buff leave it to the orga. */
const SPELL_OF_ONE = ["brez"];

/** The blessings a suggestion hands out, in BLESSING_PLAN's order; the row dialog's wand (`spellId`) = only the row's own blessing. */
function blessingPlan(spellId, versionId) {
    const own = spellId ? catalog.spellsOfType("blessing", versionId).find((x) => x.id === spellId) : null;
    return own ? [snapOf(own)] : BLESSING_PLAN.map((slug) => snapOf(spellBySlug("blessing", slug, versionId))).filter(Boolean);
}

/**
 * The debuffs on the boss (#536): one row per entry of DEBUFF_PLAN whose spell the catalog has, each from another raider of the spell's
 * classes (ranked like every suggestion: a tank only for Sunder Armor / Faerie Fire, a healer only when nobody else can). Written as class
 * references ("Paladin 1" Judgement of Wisdom, "Paladin 2" Judgement of Light), in a template one per entry. `spellId` (the row dialog's
 * wand) = only that spell.
 */
function suggestDebuffs({ cls, pc, allowOthers, roster = [], versionId = "", pr = "", ctx = {}, spellId = "" }) {
    let plan = DEBUFF_PLAN.map((e) => ({ ...e, sp: spellBySlug("debuff", e.spell, versionId) })).filter((e) => e.sp);
    const own = spellId ? catalog.spellsOfType("debuff", versionId).find((x) => x.id === spellId) : null;
    if (own) plan = [plan.find((e) => e.sp.id === own.id) || { sp: { id: own.id, name: own.name, icon: own.icon, classes: own.classes } }];
    const out = [];
    const taken = new Set();
    const numbers = {};
    const next = (c, role) => {
        const k = `${c}:${role}`;
        numbers[k] = (numbers[k] || 0) + 1;
        return `class:${c}:${numbers[k]}${role ? `:${role}` : ""}`;
    };
    for (const e of plan) {
        const classes = e.sp.classes.filter((c) => cls.includes(c));
        if (!classes.length) continue;
        const roles = e.roles || [""];
        if (!roster.length) {
            out.push(make("debuff", [next(classes[0], roles[0])], [], snapOf(e.sp), pc, allowOthers));
            continue;
        }
        const row = { type: "debuff", preferredRole: pr, spell: { id: e.sp.id } };
        for (const role of roles) {
            const cands = roster.filter((p) => classes.includes(p.classId) && !taken.has(p.userId) && roleFits(role, p.role));
            const best = rankCandidates(row, withoutMisfits(row, cands, ctx), ctx)[0];
            if (!best) continue;
            taken.add(best.userId);
            out.push(make("debuff", [next(best.classId, role)], [], snapOf(e.sp), pc, allowOthers));
            break;
        }
    }
    return out;
}

/**
 * Auras and totems (#536): party-wide, so one row per paladin / shaman of the plan for HIS group (target: his setup group), the spell by his
 * role (GROUP_BUFF_PLAN: a protection paladin Devotion Aura, a retribution one Retribution Aura, a holy one Concentration Aura; an
 * enhancement shaman Windfury Totem, an elemental one Wrath of Air Totem, a restoration one Mana Spring Totem), the next one of the list
 * when his group already has that one. Raiders are named directly (the group belongs to the player); the ones the orga already gave the
 * task (`keep`) are left out. A template gets one class row. `spellId` (the row dialog's wand) = that spell for the best ranked one.
 */
function suggestGroupBuffs(type, { roster = [], versionId = "", keep = [], context = [], roles = {}, slots = [], spellId = "" }) {
    const plan = GROUP_BUFF_PLAN[type];
    const sp = (slug) => spellBySlug(type, slug, versionId);
    const forced = spellId ? catalog.spellsOfType(type, versionId).find((x) => x.id === spellId) : null;
    if (!roster.length) {
        const first = forced || plan.fallback.map(sp).find(Boolean);
        return [make(type, [`class:${plan.classId}:1`], [], snapOf(first))];
    }
    const own = (keep || []).filter((a) => a && a.type === type);
    const others = (context || []).filter((a) => a && a.type !== type);
    const ctx = boardContext(expandClassRefs([...others, ...own], slots, roster, roles), slots, roles);
    const named = new Set(ctx.rowIds.slice(others.length).flatMap((ids) => [...ids]));
    const has = {};
    for (const a of own) for (const t of a.targets || []) if (t.kind === "group" && a.spell) (has[t.ref] = has[t.ref] || new Set()).add(a.spell.id);
    const list = rankCandidates({ type }, roster.filter((p) => p.classId === plan.classId && !named.has(p.userId)), ctx);
    const out = [];
    for (const p of forced ? list.slice(0, 1) : list) {
        const g = Number(p.group);
        const key = String(g);
        const seen = has[key] || new Set();
        const want = [...(plan.byRole[playerRole(p, roles)] || []), ...plan.fallback].map(sp).filter(Boolean);
        const chosen = forced || want.find((x) => !seen.has(x.id)) || want[0];
        if (!chosen) continue;
        has[key] = seen.add(chosen.id);
        out.push(make(type, [`user:${p.userId}`], g >= 1 && g <= 20 ? [{ kind: "group", ref: key }] : [], snapOf(chosen)));
    }
    // the card reads group by group (the ranking decided who is asked first, the list is shown in group order)
    const groupOf = (a) => (a.targets[0] ? Number(a.targets[0].ref) : 99);
    return out.map((a, i) => ({ a, i })).sort((x, y) => groupOf(x.a) - groupOf(y.a) || x.i - y.i).map((x) => x.a);
}

/**
 * Suggested class rows of an event, resolved like every plan: the rows the orga keeps (`keep`, of the same type) count as taken,
 * each class reference becomes the raider it means; a reference nobody fills is dropped, a row without anybody left is dropped.
 */
function resolveSuggested(type, rows, { roster, slots = [], keep = [], context = [], roles = {} }) {
    const own = (keep || []).filter((a) => a && a.type === type);
    const others = (context || []).filter((a) => a && a.type !== type);
    const all = expandClassRefs([...others, ...own, ...rows], slots, roster, roles);
    return all.slice(others.length + own.length)
        .map((a) => ({ ...a, assignees: a.assignees.filter((r) => !r.startsWith("class:")), targets: a.targets.filter((t) => t.kind !== "class") }))
        .filter((a) => a.assignees.length > 0);
}

/** Whether a suggestion of this type exists (the button is offered). */
const SUGGESTABLE = ["heal", "kick", "md", "ss", "fearward", "curse", "thunderclap", "demoshout", "trashtank", "dispel", "cc", "buff", "debuff", "blessing", "aura", "totem", "brez"];

/**
 * The old task rows of a board ({ id, title, userIds }) as assignments: the title is the task
 * text (type "other"), the players are the assignees, nobody is invented. Used for boards stored
 * before the two lists became one.
 */
function targetsToAssignments(targets, known) {
    const out = [];
    for (const r of Array.isArray(targets) ? targets : []) {
        const users = (Array.isArray(r && r.userIds) ? r.userIds : []).map(str).filter((u) => u && (!known || known.has(u)));
        out.push({ id: str(r && r.id) || newId(5), type: "other", title: str(r && r.title).slice(0, LIMITS.title), assignees: users.map((u) => `user:${u}`), targets: [], note: "", suggested: false });
    }
    return out;
}

// ---- class references -------------------------------------------------------------------------
// The same rules as src/web-client/src/lib/classRefs.ts (expandClassRefs): the public page only gets the raiders a plan names, so the
// server resolves a class reference before it leaves. Kept in step with the client by the two test files.

const parseClassRef = (ref) => {
    const p = String(ref).split(":");
    if (p[0] === "class") p.shift();
    const n = Number(p[1]);
    return p.length < 2 || !p[0] || !(n >= 1) ? null : { classId: p[0], n, role: p[2] || "" };
};
/** The role a kind of task needs by itself: healing is done by healers (the SPEC's role from the setup, never the class), tanking by tanks. */
const impliedRole = (type) => (type === "heal" ? "healer" : type === "tank" || type === "trashtank" ? "tank" : "");
const roleFits = (filter, role) => (!filter ? true : filter === "dps" ? role !== "tank" && role !== "healer" : role === filter);

/**
 * The raiders a class reference can mean, in setup order: the players of the class whose spec role (a flex role on this boss wins)
 * passes the role filter — the reference's own role, else the one the task implies. "Any" = every raider of that role; without
 * any role it means nobody (the class alone would be a guess).
 */
function poolOf(q, type, roster, roles) {
    // "any" = every spec of the class, on purpose; no role = the one the task implies
    const want = q.role === "any" ? "" : q.role || impliedRole(type);
    if (q.classId === ANY && !want) return [];
    return roster.filter((p) => (q.classId === ANY || p.classId === q.classId) && roleFits(want, roles[p.userId] || p.role));
}

// ---- ranking of candidates (#501) ----------------------------------------------------------------
// Who of several raiders who COULD do a task should do it. The client twin is lib/raidplan/classRefs.ts (rankCandidates ...), the
// same cases run on both (test/services/raidplan/raidplanRank.test.js, src/web-client/src/lib/raidplan/rank.test.ts). Pure.

/** The points of the ranking: the row's role wins over a spell of the catalog, that over the tank and healer penalties, those over the load. */
const RANK_POINTS = { role: 100, spell: 50, tank: -40, healer: -20, load: -3, loadCap: 6 };
/** Kinds of task a tank does himself: no tank penalty (thunder clap and demoralizing shout are a warrior tank's; a protection paladin blesses and has an aura). */
const TANK_OK_TYPES = [...AUTO_TANK_TYPES, "heal", "thunderclap", "demoshout", "blessing", "aura"];
/** Spells a tank keeps up himself (#536): no tank penalty on a debuff row with one of them (Sunder Armor, the Faerie Fire of a bear). */
const TANK_OK_SPELLS = ["d:sunder-armor", "d:faerie-fire"];
/** Damage dealers' utility: a healer is only suggested for it when no damage dealer can. */
const DPS_UTILITY_TYPES = ["kick", "cc", "curse", "md", "debuff"];
/** Whether a tank may do this row without a penalty: a kind of task of his, or a spell he keeps up anyway. */
const tankOk = (row) => TANK_OK_TYPES.includes(row && row.type) || TANK_OK_SPELLS.includes(row && row.spell && row.spell.id);

/**
 * The role a raider plays on this boss for the ranking: a flex role wins (a "dps" flex role takes melee / ranged from the spec), a tank
 * or healer placed as such in the setup stays one, else the SPEC's role (roleOfSpec: elemental = ranged, enhancement = melee).
 */
function playerRole(p, roles) {
    const flex = (roles || {})[p.userId] || "";
    const spec = p.specRole || "";
    const dmg = (r) => r === "melee" || r === "ranged";
    if (flex === "tank" || flex === "healer" || dmg(flex)) return flex;
    if (flex === "dps") return dmg(spec) ? spec : dmg(p.role) ? p.role : "dps";
    if (p.role === "tank" || p.role === "healer") return p.role;
    return spec || p.role || "";
}

/** A tank for the ranking: he stands in a tank row of this board, or tanks by his (flex / setup / spec) role. */
function isTankOf(p, ctx) {
    return !!((ctx.tanks || {})[p.userId]) || playerRole(p, ctx.roles) === "tank";
}

/**
 * The points of one raider for a row, with their parts (so a reason can be shown): role of the row fits +100, his class has a spell of
 * the catalog for the task +50, a tank on a task that is not his -40, a healer on damage dealers' utility -20, -3 per row he already
 * stands in (at most 6). A tanking row only knows the role part (its tanks keep the setup order).
 * `ctx` = { roles, tanks: { userId: true }, load: { userId: rows }, spellClasses: [classId] }.
 */
function scoreCandidate(row, p, ctx = {}) {
    const parts = { role: 0, spell: 0, tank: 0, healer: 0, load: 0 };
    const role = playerRole(p, ctx.roles);
    const type = row && row.type;
    if (row && PREFERRED_ROLES.includes(row.preferredRole) && role === row.preferredRole) parts.role = RANK_POINTS.role;
    if (!AUTO_TANK_TYPES.includes(type)) {
        if ((ctx.spellClasses || []).includes(p.classId)) parts.spell = RANK_POINTS.spell;
        if (!tankOk(row) && isTankOf(p, ctx)) parts.tank = RANK_POINTS.tank;
        if (DPS_UTILITY_TYPES.includes(type) && role === "healer") parts.healer = RANK_POINTS.healer;
        const n = Math.min(RANK_POINTS.loadCap, Number((ctx.load || {})[p.userId]) || 0);
        if (n > 0) parts.load = n * RANK_POINTS.load;
    }
    return { score: parts.role + parts.spell + parts.tank + parts.healer + parts.load, parts };
}

/** The raiders in the order a row wants them: the highest points first; a tie keeps the order given (the setup's, today's). */
function rankCandidates(row, list, ctx = {}) {
    return (list || []).map((p, i) => ({ p, i, s: scoreCandidate(row, p, ctx).score })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.p);
}

/**
 * The hard rules of a suggestion, only while somebody is left: no tank on a task that is not his, no healer on damage dealers'
 * utility. Nobody else = the list as it is (the mage tank kicks when he is the only mage).
 */
function withoutMisfits(row, list, ctx = {}) {
    let out = list || [];
    const type = row && row.type;
    if (!tankOk(row)) { const rest = out.filter((p) => !isTankOf(p, ctx)); if (rest.length) out = rest; }
    if (DPS_UTILITY_TYPES.includes(type)) { const rest = out.filter((p) => playerRole(p, ctx.roles) !== "healer"); if (rest.length) out = rest; }
    return out;
}

/**
 * What the ranking knows of a board from the raiders its rows NAME (user refs, filled slots, hand picks): who stands in a tanking row
 * (`tanks`) and in how many rows each raider stands (`load`). Class references are counted while they are resolved (expandClassRefs).
 */
function boardContext(list, slots, roles = {}) {
    const tanks = {};
    const load = {};
    const rowIds = [];
    for (const a of list || []) {
        const ids = new Set();
        rowIds.push(ids);
        for (const r of a.assignees || []) {
            const q = String(r).split(":");
            if (q[0] === "user" && q[1]) ids.add(q[1]);
            else if (q[0] === "slot") { const sl = (slots || []).find((x) => x.kind === q[1] && x.n === Number(q[2]) && x.userId); if (sl) ids.add(sl.userId); }
        }
        for (const key of Object.keys(a.picks || {})) if (!key.startsWith("t:") && a.picks[key]) ids.add(a.picks[key]);
        for (const id of ids) {
            load[id] = (load[id] || 0) + 1;
            if (AUTO_TANK_TYPES.includes(a.type)) tanks[id] = true;
        }
    }
    return { roles: roles || {}, tanks, load, rowIds };
}

/**
 * THE resolution of class references (the client twin is src/web-client/src/lib/classRefs.ts, kept in step by the tests): every
 * class reference replaced by the raider it means, round robin per kind of task. Raiders named by hand (user refs, slots, `picks`)
 * are taken first; then the references of a named class ("Hunter", "Tank (Warrior)") in row order, then the "Any" ones ("any tank"),
 * so an open "any tank" never takes the one warrior tank a "Tank (Warrior)" row needs. A reference starts at its own number and
 * takes the first raider of its pool nobody of that kind of task has yet; nobody free = it stays a reference (an open place,
 * "Hunter missing"), never a player of another class or role. `allowMulti` on the row lets it repeat a raider instead.
 * Same length and order as the input, so a chip can be matched to its reference by index.
 */
function expandClassRefs(assignments, slots, roster, roles = {}) {
    const list = assignments || [];
    if (!list.some((a) => a.assignees.some((r) => r.startsWith("class:")) || a.targets.some((t) => t.kind === "class") || classPriorityOf(a).length > 0)) return list;
    const byId = new Map(roster.map((p) => [p.userId, p]));
    const used = {};
    const usedAt = {};
    const take = (bag, type, id) => { (bag[type] = bag[type] || {})[id] = true; };
    for (const a of list) {
        for (const r of a.assignees) {
            const q = r.split(":");
            if (q[0] === "user") take(used, a.type, q[1]);
            else if (q[0] === "slot") {
                const sl = (slots || []).find((x) => x.kind === q[1] && x.n === Number(q[2]) && x.userId);
                if (sl) take(used, a.type, sl.userId);
            }
        }
        for (const key of Object.keys(a.picks || {})) if (byId.has(a.picks[key])) take(key.startsWith("t:") ? usedAt : used, a.type, a.picks[key]);
    }
    // the ranking (#501): who tanks on this board and how many rows each raider has, counted on while references are resolved
    const ctx = boardContext(list, slots, roles);
    const counted = (i, a, id) => {
        if (!id || ctx.rowIds[i].has(id)) return;
        ctx.rowIds[i].add(id);
        ctx.load[id] = (ctx.load[id] || 0) + 1;
        if (AUTO_TANK_TYPES.includes(a.type)) ctx.tanks[id] = true;
    };
    const pick = (bag, a, ref, key, ranked) => {
        const hand = (a.picks || {})[key];
        if (hand && byId.has(hand)) return hand;
        const q = parseClassRef(ref);
        if (!q) return "";
        const plain = poolOf(q, a.type, roster, roles || {});
        // an assignee: the pool in the row's order of preference (rankCandidates); a target (soulstone at a priest): the setup's order
        const pool = ranked ? rankCandidates(a, plain, ctx) : plain;
        const order = pool.slice(q.n - 1).concat(pool.slice(0, q.n - 1));
        const free = order.find((p) => !(bag[a.type] && bag[a.type][p.userId]));
        if (free) { take(bag, a.type, free.userId); return free.userId; }
        return a.allowMulti && pool.length ? pool[(q.n - 1) % pool.length].userId : "";
    };
    /**
     * One open place of a row with a class priority (#525): the best ranked raider of the first class nobody of that kind of task has yet,
     * else of the next class ...; nobody free in any of them = one who already does that task elsewhere (twice rather than open), never one
     * of this very row; nobody at all = "" (the place stays open).
     */
    const pickByPriority = (a, i, prio) => {
        const pools = prio.map((c) => rankCandidates(a, poolOf({ classId: c, role: "" }, a.type, roster, roles || {}), ctx).filter((p) => !ctx.rowIds[i].has(p.userId)));
        for (const pool of pools) {
            const free = pool.find((p) => !(used[a.type] && used[a.type][p.userId]));
            if (free) { take(used, a.type, free.userId); return free.userId; }
        }
        const again = pools.find((pool) => pool.length > 0);
        return again ? again[0].userId : "";
    };
    const got = new Map();
    const extra = new Map();
    // the tanking rows first (who tanks is known before a utility row picks), then the others; each time pass 1: a named class, pass 2: "Any"
    for (const tankPass of [true, false]) {
        for (const anyPass of [false, true]) {
            list.forEach((a, i) => {
                if (AUTO_TANK_TYPES.includes(a.type) !== tankPass) return;
                a.assignees.forEach((r, j) => {
                    if (!r.startsWith("class:")) return;
                    const q = parseClassRef(r);
                    if (!q || (q.classId === ANY) !== anyPass) return;
                    const id = pick(used, a, r, r, true);
                    got.set(`${i}|a|${j}`, id);
                    counted(i, a, id);
                });
                a.targets.forEach((t, j) => {
                    if (t.kind !== "class") return;
                    const q = parseClassRef(t.ref);
                    if (q && (q.classId === ANY) === anyPass) got.set(`${i}|t|${j}`, pick(usedAt, a, t.ref, "t:" + t.ref, false));
                });
            });
        }
        // then the rows with a class priority (#525), in row order: their open places after the class references of this pass
        list.forEach((a, i) => {
            if (AUTO_TANK_TYPES.includes(a.type) !== tankPass) return;
            const prio = classPriorityOf(a);
            if (prio.length === 0) return;
            const places = [];
            for (let k = a.assignees.length; k < rowCount(a.count); k += 1) {
                const id = pickByPriority(a, i, prio);
                places.push(id ? "user:" + id : `class:${prio[0]}:${k + 1}`);
                counted(i, a, id);
            }
            extra.set(i, places);
        });
    }
    return list.map((a, i) => ({
        ...a,
        assignees: [...a.assignees.map((r, j) => { const id = got.get(`${i}|a|${j}`); return id ? "user:" + id : r; }), ...(extra.get(i) || [])],
        targets: a.targets.map((t, j) => { const id = got.get(`${i}|t|${j}`); return id ? { kind: "player", ref: id } : t; }),
    }));
}

/**
 * The running numbers of the class references, made unique per kind of task, class and role over all rows of a board: a reference
 * whose number an earlier one (this row or an earlier row) already has gets the next free number ("Hunter 1" in three misdirect rows
 * -> Hunter 1, 2, 3). What was stored before the numbers counted on is kept this way instead of dropped as a duplicate; a hand-made
 * pick moves with its reference. Unique numbers are left exactly as they are. Pure; works on raw input (the save path).
 */
function renumberClassRefs(list) {
    const seen = {};
    const fix = (a, ref, target) => {
        const q = parseClassRef(ref);
        if (!q) return ref;
        const key = `${target ? "t" : "a"}|${a && a.type}|${q.classId}|${q.role}`;
        const taken = (seen[key] = seen[key] || new Set());
        let n = q.n;
        if (taken.has(n)) { n = Math.max(...taken) + 1; while (taken.has(n)) n += 1; }
        if (n > 99) return ref;
        taken.add(n);
        return `${target ? "" : "class:"}${q.classId}:${n}${q.role ? `:${q.role}` : ""}`;
    };
    return (Array.isArray(list) ? list : []).map((a) => {
        if (!a || typeof a !== "object") return a;
        const own = a.picks && typeof a.picks === "object" ? a.picks : null;
        const picks = own ? { ...own } : a.picks;
        // a pick belongs to the reference that keeps its name in this row; only a renumbered one whose name no reference of the row keeps takes it along
        const kept = new Set();
        const moves = [];
        const assignees = Array.isArray(a.assignees) ? a.assignees.map((r) => { const s = str(r); if (!s.startsWith("class:")) return r; const to = fix(a, s, false); if (to === s) kept.add(s); else moves.push([s, to]); return to; }) : a.assignees;
        const targets = Array.isArray(a.targets) ? a.targets.map((t) => { if (!t || t.kind !== "class") return t; const s = str(t.ref); const to = fix(a, s, true); if (to === s) kept.add("t:" + s); else moves.push(["t:" + s, "t:" + to]); return { ...t, ref: to }; }) : a.targets;
        for (const [from, to] of moves) {
            if (!own || kept.has(from) || !Object.prototype.hasOwnProperty.call(own, from)) continue;
            picks[to] = own[from];
            delete picks[from];
            kept.add(from);
        }
        return { ...a, assignees, targets, ...(picks ? { picks } : {}) };
    });
}

module.exports = {
    CLASS_ASSIGNEE, ROLE_ASSIGNEE, ROLE_REFS, inRoleGroup, ASSIGN_TYPES, CLASS_IDS, SLOT_ROLES, cleanClasses, LIMITS, SUGGESTABLE,
    cleanAssignments, reidAssignments, expandClassRefs, targetsToAssignments, suggest,
    // only for the tests (#424): not part of the module's API
    // the ranking of candidates (#501): twin of lib/raidplan/classRefs.ts
    PREFERRED_ROLES, RANK_POINTS, playerRole, scoreCandidate, rankCandidates, withoutMisfits, boardContext,
    _internal: {
        impliedRole, mobInstance, renumberClassRefs, classesFor, rowCount, classPriorityOf, MAX_COUNT,
    },
};
