// Raid plan assignments ("Einteilungen", docs/raidplan.md): who heals whom, who kicks in
// which order, misdirects, soulstones, curses, trash tanks and so on. One model for all:
//
//   { id, type, assignees: [ref], targets: [{ kind, ref }], note, suggested }
//
//   assignee ref   "slot:<kind>:<n>"  a placeholder slot of the board (tank/healer/melee/ranged/dps n)
//                  "user:<userId>"    one raider (event plans only)
//   target         { kind: "slot",   ref: "tank:1" }     a slot of the board
//                  { kind: "group",  ref: "3" }          setup group 3
//                  { kind: "player", ref: "<userId>" }   one raider (event plans only)
//                  { kind: "mark",   ref: "skull" }      a raid mark (also "who takes which target" on trash)
//                  { kind: "text",   ref: "Fear" }       free text: an ability, an enemy, a curse
//
// Only references are stored, never names or icons: those are looked up live from the setup.
// A slot reference is a placeholder in a template and points at whoever stands in that
// slot in an event plan, so applying a template needs no rewriting. The order of the
// assignees is the order of a rotation (kicks: 1, 2, 3).
//
// Also here, pure and tested: the suggestions ("Heiler verteilen", "Aus Setup
// vorschlagen"). They never guess: nobody fits, nothing is suggested.

const ASSIGN_TYPES = ["heal", "kick", "md", "ss", "fearward", "special", "curse", "thunderclap", "demoshout", "trashtank", "other"];
const TARGET_KINDS = ["slot", "group", "player", "mark", "text"];
const SLOT_REF = /^slot:(tank|healer|melee|ranged|dps):(\d{1,3})$/;
const SLOT_TARGET = /^(tank|healer|melee|ranged|dps):(\d{1,3})$/;
const ID_REF = /^[\w-]{1,40}$/;
const MARKS = ["skull", "cross", "square", "moon", "triangle", "diamond", "circle", "star"];
const LIMITS = { perBoard: 60, assignees: 12, targets: 12, note: 200, text: 60 };

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
            if (!good || targets.some((x) => x.kind === kind && x.ref === ref)) { dropped += 1; continue; }
            if (targets.length >= LIMITS.targets) break;
            targets.push({ kind, ref });
        }

        out.push({
            id, type: ASSIGN_TYPES.includes(o.type) ? o.type : "other", assignees, targets,
            note: str(o.note).slice(0, LIMITS.note), suggested: o.suggested === true,
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
const make = (type, assignees, targets) => ({ id: newId(), type, assignees, targets, note: "", suggested: true });

/**
 * Heal assignments: every tank gets a healer (healer 1 to tank 1, healer 2 to tank 2 ...),
 * the remaining healers take the raid groups, every group at least one healer and evenly
 * (a group always goes to the healer with the fewest targets so far, the tank healers last
 * on a tie). Healers are the board's healer slots; without slots the roster's healers
 * (`user:` refs). Returns one assignment per healer that has a target.
 */
function suggestHeal({ slots = [], roster = [], groups = [] }) {
    const healerSlots = slotsOf(slots, "healer");
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
    return healers.map((h, i) => (targets[i].length ? make("heal", [h], targets[i]) : null)).filter(Boolean);
}

const players = (roster, classIds) => roster.filter((p) => classIds.includes(p.classId));

/** Suggestions for one type from the placeholder slots and the setup's roster. `groups` = the group numbers of the raid. */
function suggest(type, { slots = [], roster = [], groups = [] } = {}) {
    const tanks = slotsOf(slots, "tank");
    if (type === "heal") return suggestHeal({ slots, roster, groups });
    if (type === "trashtank") {
        return tanks.slice(0, MARKS.length).map((s, i) => make("trashtank", [refOf(s)], [{ kind: "mark", ref: MARKS[i] }]));
    }
    if (type === "kick") {
        // rogues first, then shaman, warriors, mages; a rotation of at most three
        const order = ["Rogue", "Shaman", "Warrior", "Mage"];
        const c = roster.filter((p) => order.includes(p.classId)).sort((a, b) => order.indexOf(a.classId) - order.indexOf(b.classId)).slice(0, 3);
        return c.length ? [make("kick", c.map((p) => `user:${p.userId}`), [])] : [];
    }
    if (type === "md" || type === "fearward") {
        // hunters first (a rogue's Tricks of the Trade is the second choice)
        const pool = players(roster, CLASS_RULES[type]).sort((a, b) => CLASS_RULES[type].indexOf(a.classId) - CLASS_RULES[type].indexOf(b.classId));
        return pool.slice(0, tanks.length).map((p, i) => make(type, [`user:${p.userId}`], [{ kind: "slot", ref: `tank:${tanks[i].n}` }]));
    }
    if (type === "ss") {
        const healers = roster.filter((p) => p.role === "healer");
        return players(roster, CLASS_RULES.ss).slice(0, healers.length).map((p, i) => make("ss", [`user:${p.userId}`], [{ kind: "player", ref: healers[i].userId }]));
    }
    if (type === "curse") {
        return players(roster, CLASS_RULES.curse).slice(0, CURSES.length).map((p, i) => make("curse", [`user:${p.userId}`], [{ kind: "text", ref: CURSES[i] }]));
    }
    if (type === "thunderclap" || type === "demoshout") {
        const w = players(roster, CLASS_RULES[type]);
        const tanksFirst = type === "thunderclap" ? [...w.filter((p) => p.role === "tank"), ...w.filter((p) => p.role !== "tank")] : w;
        const pick = tanksFirst.slice(0, type === "thunderclap" ? 2 : 3);
        return pick.length ? [make(type, pick.map((p) => `user:${p.userId}`), [])] : [];
    }
    return [];
}

/** Whether a suggestion of this type exists (the button is offered). */
const SUGGESTABLE = ["heal", "kick", "md", "ss", "fearward", "curse", "thunderclap", "demoshout", "trashtank"];

module.exports = {
    ASSIGN_TYPES, TARGET_KINDS, CLASS_RULES, CURSES, LIMITS, SUGGESTABLE,
    cleanAssignments, reidAssignments, suggest, suggestHeal,
};
