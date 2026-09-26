// The tactic of a raid plan section ("Taktik", docs/raidplan.md): ordered steps that say who does what, when and how —
// "Arkanix tankt Zerevor · Pull". One board (boss, trash, Allgemein) holds `steps`:
//
//   { id, action, participants: [ref], sentence, targets: [{ kind, ref, name?, icon? }], timing: { kind, from, to, text } }
//
//   action        one of ACTIONS (13 fixed ones: icon and sentence suggestions follow from it)
//   participants  who does it, the references of the assignments: "slot:<kind>:<n>", "user:<id>" (event plans only),
//                 "class:<Class>:<n>[:<role>|:any]" / "class:Any:<n>:<role>", "group:<n>" (setup group n) or "role:<role>" (all melees ...)
//   sentence      free text, at most 160 characters ("kitet den Boss um die Arena")
//   targets       what it is aimed at: a mob ({ kind: "mob", ref: "d:…" | "b:<boss>", name, icon } — a snapshot like the
//                 assignments), a zone of the map ({ kind: "zone", ref: "Arena" }, its name), a raid mark, a group ("3")
//   timing        when: kind "" (none) | pull | phase | hp | interval | now | text; `from`/`to` numbers (phase 2, 50 → 30 %,
//                 every 30 s), `text` a free word; see cleanTiming
//
// Only references are stored; names come from the setup when the plan is shown. A step resolves its class references
// ON ITS OWN (the same "Magier 1" in two steps is the same raider — a tactic is one sequence, not a round robin).
// Pure and tested (test/services/raidplan/raidplanSteps.test.js).
const assign = require("./raidplanAssign");
const { str } = require("../../utils/text");
const { newId } = require("../../utils/ids");

const ACTIONS = ["tank", "swap", "kite", "adds", "interrupt", "dispel", "cc", "soak", "focus", "buff", "heal", "wait", "note"];
const TIMING_KINDS = ["", "pull", "phase", "hp", "interval", "now", "text"];
const LIMITS = { steps: 30, participants: 12, targets: 8, sentence: 160, timingText: 40, zone: 40 };
const MARKS = ["skull", "cross", "square", "moon", "triangle", "diamond", "circle", "star"];
const SLOT_REF = /^slot:(tank|healer|melee|ranged|dps):(\d{1,3})$/;
const GROUP_REF = /^group:([1-9]|1\d|20)$/;
const ID_REF = /^[\w-]{1,40}$/;
const MOB_REF = /^[dcb]:[\w\-/']{1,70}$/;
const ICON = /^([a-z0-9_'-]{2,64}|(?:boss|mob):\d{1,6})$/;

/** How a kind of step is resolved like an assignment: tanking steps imply the tank role, healing the healers, the rest none. */
const TASK_OF = { tank: "tank", swap: "tank", kite: "special", adds: "tank", heal: "heal" };

const num = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) && v !== "" && v !== null ? Math.max(lo, Math.min(hi, n)) : null; };

/** A timing as stored: a known kind with the numbers it needs (clamped), or none. */
function cleanTiming(raw) {
    const o = raw && typeof raw === "object" ? raw : {};
    const kind = TIMING_KINDS.includes(str(o.kind)) ? str(o.kind) : "";
    const text = str(o.text).slice(0, LIMITS.timingText);
    if (kind === "phase") return { kind, from: num(o.from, 1, 9) || 1, to: null, text: "" };
    if (kind === "hp") {
        const from = num(o.from, 1, 100);
        const to = num(o.to, 0, 99);
        return { kind, from: from === null ? 50 : from, to: to !== null && from !== null && to < from ? to : null, text: "" };
    }
    if (kind === "interval") return { kind, from: num(o.from, 1, 600) || 30, to: null, text: "" };
    if (kind === "text") return text ? { kind, from: null, to: null, text } : { kind: "", from: null, to: null, text: "" };
    return { kind, from: null, to: null, text: "" };
}

/**
 * Cleans the steps of one board. `allowed` = the userIds of the event's lineup (empty in a template or a library tactic: a
 * `user:` reference is dropped there, slots and classes stay). Unknown actions become "note", unknown references are
 * dropped and counted, texts are cut. Returns `{ steps, dropped }` or `{ code, error }` when there are too many steps.
 */
function cleanSteps(raw, allowed = new Set()) {
    const list = Array.isArray(raw) ? raw : [];
    if (list.length > LIMITS.steps) return { code: "invalid", error: `Höchstens ${LIMITS.steps} Taktik-Schritte je Abschnitt.` };
    let dropped = 0;
    const ids = new Set();
    const steps = [];
    for (const s of list) {
        const o = s && typeof s === "object" ? s : {};
        let id = str(o.id).replace(/[^\w-]/g, "").slice(0, 24);
        if (!id || ids.has(id)) id = newId(5);
        ids.add(id);
        const participants = [];
        for (const ref of Array.isArray(o.participants) ? o.participants : []) {
            const r = str(ref);
            const isUser = r.startsWith("user:") && ID_REF.test(r.slice(5)) && allowed.has(r.slice(5));
            const ok = SLOT_REF.test(r) || isUser || GROUP_REF.test(r) || assign.CLASS_ASSIGNEE.test(r) || assign.ROLE_ASSIGNEE.test(r);
            if (!ok || participants.includes(r)) { dropped += 1; continue; }
            if (participants.length >= LIMITS.participants) break;
            participants.push(r);
        }
        const targets = [];
        for (const t of Array.isArray(o.targets) ? o.targets : []) {
            const kind = str(t && t.kind);
            let ref = str(t && t.ref);
            let good = false;
            if (kind === "mob") good = MOB_REF.test(ref);
            else if (kind === "mark") good = MARKS.includes(ref);
            else if (kind === "group") good = /^([1-9]|1\d|20)$/.test(ref);
            else if (kind === "role") good = assign.ROLE_REFS.includes(ref);
            else if (kind === "zone") { ref = ref.slice(0, LIMITS.zone); good = ref !== ""; }
            if (!good || targets.some((x) => x.kind === kind && x.ref === ref)) { dropped += 1; continue; }
            if (targets.length >= LIMITS.targets) break;
            targets.push(kind === "mob" ? { kind, ref, name: str(t.name).slice(0, 60), icon: ICON.test(str(t.icon)) ? str(t.icon) : "" } : { kind, ref });
        }
        const sentence = str(o.sentence).replace(/\s+/g, " ").slice(0, LIMITS.sentence);
        const action = ACTIONS.includes(str(o.action)) ? str(o.action) : "note";
        // a step without anything in it is not kept
        if (!sentence && participants.length === 0 && targets.length === 0) { dropped += 1; continue; }
        steps.push({ id, action, participants, sentence, targets, timing: cleanTiming(o.timing) });
    }
    return { steps, dropped };
}

/** The same steps under new ids (a template or a library tactic copied into a plan); the references stay. */
function reidSteps(list) {
    return (Array.isArray(list) ? list : []).map((s) => ({ ...s, id: newId(5) }));
}

/**
 * The old tactic rows of a profile ({ title }) as steps: each title a "note" step without participants — nothing is invented, nothing
 * lost. The profile's note stays the profile's note (it becomes the board's note when the tactic is applied to an empty note).
 */
function stepsFromTitles(titles) {
    return (Array.isArray(titles) ? titles : [])
        .map((t) => str(t && typeof t === "object" ? t.title : t).slice(0, LIMITS.sentence))
        .filter(Boolean)
        // a stable id per title (the same profile read twice gives the same steps)
        .map((sentence, i) => ({ id: `t${i + 1}`, action: "note", participants: [], sentence, targets: [], timing: { kind: "", from: null, to: null, text: "" } }));
}

/**
 * The steps with their participants resolved for showing (the public sheet): each step on its own, class references by the
 * central resolution (`expandClassRefs`, the task a step's action implies), a class nobody fills stays its reference (an open chip),
 * a `user:` reference of somebody outside `known` is left out. Group references stay ("Gruppe 3").
 */
function resolveSteps(steps, { slots = [], roster = [], roles = {}, known = null } = {}) {
    return (Array.isArray(steps) ? steps : []).map((s) => {
        // groups and role groups stay as they are (never split into players)
        const fixed = (r) => r.startsWith("group:") || r.startsWith("role:");
        const people = s.participants.filter((r) => !fixed(r) && (!known || !r.startsWith("user:") || known.has(r.slice(5))));
        const filled = assign.expandClassRefs([{ id: s.id, type: TASK_OF[s.action] || "other", assignees: people, targets: [] }], slots, roster, roles)[0];
        let i = 0;
        const participants = s.participants
            .filter((r) => fixed(r) || people.includes(r))
            .map((r) => (fixed(r) ? r : filled.assignees[i++]));
        return { ...s, participants };
    });
}

/** The userIds a step list names (resolved), for the public roster. */
function stepUsers(steps) {
    const out = new Set();
    for (const s of steps || []) for (const r of s.participants || []) if (r.startsWith("user:")) out.add(r.slice(5));
    return out;
}

module.exports = { ACTIONS, TIMING_KINDS, LIMITS, TASK_OF, cleanSteps, cleanTiming, reidSteps, stepsFromTitles, resolveSteps, stepUsers };
