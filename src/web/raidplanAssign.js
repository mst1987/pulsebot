// Raid plan assignments ("Einteilungen", docs/raidplan.md): who heals whom, who kicks in
// which order, misdirects, soulstones, curses, trash tanks and so on. One model for all:
//
//   { id, type, title, assignees: [ref], targets: [{ kind, ref }], note, suggested }
//   (`title` is the free text of the task: "Kick Fear", "Interrupt Shadow Bolt Volley" ...)
//
//   assignee ref   "slot:<kind>:<n>"  a placeholder slot of the board (tank/healer/melee/ranged/dps n)
//                  "user:<userId>"    one raider (event plans only)
//   target         { kind: "slot",   ref: "tank:1" }     a slot of the board
//                  { kind: "group",  ref: "3" }          setup group 3
//                  { kind: "player", ref: "<userId>" }   one raider (event plans only)
//                  { kind: "mark",   ref: "skull" }      a raid mark (also "who takes which target" on trash)
//                  { kind: "text",   ref: "Fear" }       free text: an ability, an enemy, a curse
//                  { kind: "mob",    ref: "d:gathios", name, icon }  a mob of the catalog or the section's boss ("b:<boss key>"); name and icon are
//                                    a snapshot, shown when the catalog entry is gone
//   spell        { id, name, icon } | null   the catalog spell the row is about (a curse, a kick ...), with the same kind of snapshot
//
// Only references are stored, never names or icons: those are looked up live from the setup.
// A slot reference is a placeholder in a template and points at whoever stands in that
// slot in an event plan, so applying a template needs no rewriting. The order of the
// assignees is the order of a rotation (kicks: 1, 2, 3).
//
// Also here, pure and tested: the suggestions ("Heiler verteilen", "Aus Setup
// vorschlagen"). They never guess: nobody fits, nothing is suggested.

const ASSIGN_TYPES = ["tank", "heal", "kick", "md", "ss", "fearward", "special", "dispel", "cc", "buff", "curse", "thunderclap", "demoshout", "trashtank", "other"];
const TARGET_KINDS = ["slot", "group", "player", "mark", "text", "mob"];
// a mob of the catalog (d:.. / c:..) or the boss of the section (b:<boss key>)
const MOB_REF = /^[dcb]:[\w\-/']{1,70}$/;
const SPELL_ID = /^[dc]:[\w-]{1,40}$/;
const ICON = /^([a-z0-9_'\-]{2,64}|(?:boss|mob):\d{1,6})$/;
const SLOT_REF = /^slot:(tank|healer|melee|ranged|dps):(\d{1,3})$/;
const SLOT_TARGET = /^(tank|healer|melee|ranged|dps):(\d{1,3})$/;
const ID_REF = /^[\w-]{1,40}$/;
const MARKS = ["skull", "cross", "square", "moon", "triangle", "diamond", "circle", "star"];
const LIMITS = { perBoard: 60, assignees: 12, targets: 12, note: 200, text: 60, title: 80 };

// Which classes can do it (Vorschlag / Filter). Kick: rogue, warrior, mage (Counterspell), shaman (Earth Shock).
const CLASS_RULES = {
    kick: ["Rogue", "Shaman", "Warrior", "Mage"],
    md: ["Hunter", "Rogue"],
    ss: ["Warlock"],
    fearward: ["Priest"],
    curse: ["Warlock"],
    thunderclap: ["Warrior"],
    demoshout: ["Warrior"],
};
// The curses handed out, in the order of the warlocks.
const CURSES = ["Curse of the Elements", "Curse of Recklessness", "Curse of Doom"];

const SLOT_ROLES = ["tank", "healer", "melee", "ranged", "dps"];
const CLASS_IDS = ["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid"];
/** A list of class ids as stored: only known classes, each once, in the order given. */
function cleanClasses(raw) {
    return [...new Set((Array.isArray(raw) ? raw : []).map((c) => String(c === null || c === undefined ? "" : c).trim()).filter((c) => CLASS_IDS.includes(c)))];
}

const str = (v) => String(v === null || v === undefined ? "" : v).trim();
const newId = () => require("crypto").randomBytes(5).toString("hex");

/**
 * Cleans a list of assignments. `allowed` = the userIds an event plan may name (empty in
 * a template: `user:` and `player` references are dropped there). Returns
 * `{ assignments, dropped }` or `{ code, error }`.
 */
function cleanAssignments(raw, allowed = new Set()) {
    const list = Array.isArray(raw) ? raw : [];
    if (list.length > LIMITS.perBoard) return { code: "invalid", error: `Höchstens ${LIMITS.perBoard} Einteilungen je Boss.` };
    let dropped = 0;
    const ids = new Set();
    const out = [];
    for (const a of list) {
        const o = a && typeof a === "object" ? a : {};
        let id = str(o.id).replace(/[^\w-]/g, "").slice(0, 24);
        if (!id || ids.has(id)) id = newId();
        ids.add(id);

        const assignees = [];
        for (const ref of Array.isArray(o.assignees) ? o.assignees : []) {
            const r = str(ref);
            const isUser = r.startsWith("user:") && ID_REF.test(r.slice(5)) && allowed.has(r.slice(5));
            if ((!SLOT_REF.test(r) && !isUser) || assignees.includes(r)) { dropped += 1; continue; }
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
            if (!good || targets.some((x) => x.kind === kind && x.ref === ref)) { dropped += 1; continue; }
            if (targets.length >= LIMITS.targets) break;
            targets.push(kind === "mob" ? { kind, ref, name: str(t.name).slice(0, LIMITS.text), icon: ICON.test(str(t.icon)) ? str(t.icon) : "" } : { kind, ref });
        }

        const sp = o.spell && typeof o.spell === "object" ? o.spell : null;
        const spell = sp && SPELL_ID.test(str(sp.id)) && str(sp.name) ? { id: str(sp.id), name: str(sp.name).slice(0, LIMITS.text), icon: ICON.test(str(sp.icon)) ? str(sp.icon) : "" } : null;

        out.push({
            id, type: ASSIGN_TYPES.includes(o.type) ? o.type : "other", title: str(o.title).slice(0, LIMITS.title), spell, assignees, targets,
            note: str(o.note).slice(0, LIMITS.note), suggested: o.suggested === true,
            // the class(es) that should do it (only known classes, once each) and whether a suggestion may take others when none fits
            preferredClasses: cleanClasses(o.preferredClasses), allowOthers: o.allowOthers === true,
            // where the row comes from: "default" (written in from the template's Standard) or the id of the default row a boss deviated from
            origin: /^[\w-]{1,24}$/.test(str(o.origin)) ? str(o.origin) : "",
        });
    }
    return { assignments: out, dropped };
}

/** The same assignments under new ids (a template copied into a plan); the references stay. */
function reidAssignments(list) {
    return (list || []).map((a) => ({ ...a, id: newId() }));
}

// ---- suggestions ---------------------------------------------------------------------------

const slotsOf = (slots, kind) => (slots || []).filter((s) => s.kind === kind).sort((a, b) => a.n - b.n);
const refOf = (s) => `slot:${s.kind}:${s.n}`;
const make = (type, assignees, targets, spell = null, pref = [], allowOthers = false) => ({ id: newId(), type, title: "", spell, assignees, targets, note: "", suggested: true, preferredClasses: cleanClasses(pref), allowOthers: allowOthers === true });

// The catalog is read lazily (the catalog store needs this module's type list).
const catalog = () => require("./raidplanCatalogStore");

/** The classes that fit a type: the catalog's spells of that type say it; without any, the built in rules. */
function classesFor(type, prefer = [], allowOthers = false) {
    const fromCatalog = catalog().classesOf(type);
    const rules = CLASS_RULES[type] || [];
    // the built in order (rogue before mage ...) first, then what the admin added
    const base = fromCatalog.length ? [...rules.filter((c) => fromCatalog.includes(c)), ...fromCatalog.filter((c) => !rules.includes(c))] : rules;
    const pref = cleanClasses(prefer);
    if (!pref.length) return base;
    // a row's own preferred classes win over the catalog's; the usual classes only follow when others are allowed
    return allowOthers ? [...pref, ...base.filter((c) => !pref.includes(c))] : pref;
}

/** A row's spell as it is stored: the catalog entry with a snapshot of name and icon; one of the class first, else the first of the type. */
function spellFor(type, classId, index = 0) {
    const list = catalog().spellsOfType(type);
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

const players = (roster, classIds) => roster.filter((p) => classIds.includes(p.classId));

/** Suggestions for one type from the placeholder slots and the setup's roster. `groups` = the group numbers of the raid. */
function suggest(type, { slots = [], roster = [], groups = [], preferredClasses = [], allowOthers = false } = {}) {
    const tanks = slotsOf(slots, "tank");
    const pc = cleanClasses(preferredClasses);
    const classes = (t) => classesFor(t, pc, allowOthers);
    if (type === "heal") return suggestHeal({ slots, roster, groups, preferredClasses: pc, allowOthers });
    if (type === "trashtank") {
        return tanks.slice(0, MARKS.length).map((s, i) => make("trashtank", [refOf(s)], [{ kind: "mark", ref: MARKS[i] }]));
    }
    if (type === "kick") {
        // rogues first, then shaman, warriors, mages; a rotation of at most three
        const order = classes("kick");
        const c = roster.filter((p) => order.includes(p.classId)).sort((a, b) => order.indexOf(a.classId) - order.indexOf(b.classId)).slice(0, 3);
        return c.length ? [make("kick", c.map((p) => `user:${p.userId}`), [], null, pc, allowOthers)] : [];
    }
    if (type === "md" || type === "fearward") {
        // hunters first (a rogue's Tricks of the Trade is the second choice)
        const cls = classes(type);
        const pool = players(roster, cls).sort((a, b) => cls.indexOf(a.classId) - cls.indexOf(b.classId));
        return pool.slice(0, tanks.length).map((p, i) => make(type, [`user:${p.userId}`], [{ kind: "slot", ref: `tank:${tanks[i].n}` }], spellFor(type, p.classId), pc, allowOthers));
    }
    if (type === "ss") {
        const healers = roster.filter((p) => p.role === "healer");
        return players(roster, classes("ss")).slice(0, healers.length).map((p, i) => make("ss", [`user:${p.userId}`], [{ kind: "player", ref: healers[i].userId }], spellFor("ss", p.classId), pc, allowOthers));
    }
    if (type === "curse") {
        // one curse per warlock, in the order of the catalog's curses (Elements, Recklessness, Doom ...)
        const curses = catalog().spellsOfType("curse");
        return players(roster, classes("curse")).slice(0, Math.min(3, curses.length || CURSES.length)).map((p, i) => make("curse", [`user:${p.userId}`], [], curses[i] ? { id: curses[i].id, name: curses[i].name, icon: curses[i].icon } : null));
    }
    if (type === "thunderclap" || type === "demoshout") {
        const w = players(roster, classes(type));
        const tanksFirst = type === "thunderclap" ? [...w.filter((p) => p.role === "tank"), ...w.filter((p) => p.role !== "tank")] : w;
        const pick = tanksFirst.slice(0, type === "thunderclap" ? 2 : 3);
        return pick.length ? [make(type, pick.map((p) => `user:${p.userId}`), [], spellFor(type, "Warrior"))] : [];
    }
    return [];
}

/** Whether a suggestion of this type exists (the button is offered). */
const SUGGESTABLE = ["heal", "kick", "md", "ss", "fearward", "curse", "thunderclap", "demoshout", "trashtank"];

/**
 * The old task rows of a board ({ id, title, userIds }) as assignments: the title is the task
 * text (type "other"), the players are the assignees, nobody is invented. Used for boards stored
 * before the two lists became one.
 */
function targetsToAssignments(targets, known) {
    const out = [];
    for (const r of Array.isArray(targets) ? targets : []) {
        const users = (Array.isArray(r && r.userIds) ? r.userIds : []).map(str).filter((u) => u && (!known || known.has(u)));
        out.push({ id: str(r && r.id) || newId(), type: "other", title: str(r && r.title).slice(0, LIMITS.title), assignees: users.map((u) => `user:${u}`), targets: [], note: "", suggested: false });
    }
    return out;
}

module.exports = {
    ASSIGN_TYPES, TARGET_KINDS, CLASS_IDS, SLOT_ROLES, cleanClasses, CLASS_RULES, CURSES, LIMITS, SUGGESTABLE,
    cleanAssignments, reidAssignments, targetsToAssignments, suggest, suggestHeal, classesFor,
};
