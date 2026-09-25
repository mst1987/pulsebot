// The tactic of a section ("Taktik", docs/raidplan.md), pure: the 13 actions with their icon and colour group, editing the ordered
// steps (add, change, duplicate, remove, move), resolving a step's participants (each step on its own, the central class resolution),
// the timing as a word ("Pull", "Phase 2", "50 → 30 %", "alle 30 s"), the sentence a step reads as, the "du" form for the viewer's own
// steps, the @ mentions of the sentence field and the three starter tactics. Server twin: src/web/raidplanSteps.js. Tested in
// test/web-client/steps.test.js; function declarations and one-line signatures only.
import { expandClassRefs } from "./classRefs";
import { t } from "../i18n";
import type { RaidplanAssignType, RaidplanBoard, RaidplanPlayer, RaidplanProfile, RaidplanStep, RaidplanTiming } from "../api";

/** The 13 fixed actions in the order of the icon grid. */
export const ACTIONS = ["tank", "swap", "kite", "adds", "interrupt", "dispel", "cc", "soak", "focus", "buff", "heal", "wait", "note"];
/** The colour group of an action (never a state): tanks, control, position, support, flow. */
export const ACTION_GROUP = {
    tank: "tank", swap: "tank", kite: "tank", adds: "tank", interrupt: "ctl", dispel: "ctl", cc: "ctl", soak: "pos", focus: "pos", buff: "sup", heal: "sup", wait: "flow", note: "flow",
} as Record<string, string>;
/** The line icon of an action: SVG path data on a 24 x 24 grid (stroke), drawn by components/raidplan/ActionIcon.tsx. */
export const ACTION_PATH = {
    tank: ["M12 3 19 6v5c0 4.6-3 8.6-7 10-4-1.4-7-5.4-7-10V6z"],
    swap: ["M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4"],
    kite: ["M5 19c0-5 5-5 7-8s2-6 7-6M16 3l3 2-3 2", "M6.5 19a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0"],
    adds: ["M12 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0", "M3 20c0-3 3-5 6-5s6 2 6 5M16 5a3 3 0 0 1 0 6M17 15c2.5 0 4 2 4 5"],
    interrupt: ["M4 12h9M10 8l4 4-4 4M17 5v14"],
    dispel: ["M14.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0", "M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2"],
    cc: ["M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"],
    soak: ["M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0", "M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z"],
    focus: ["M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0", "M12 3v4M12 17v4M3 12h4M17 12h4"],
    buff: ["M13 2 4 14h7l-1 8 9-12h-7z"],
    heal: ["M12 5v14M5 12h14"],
    wait: ["M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0", "M12 8v4l3 2"],
    note: ["M6 3h9l5 5v13H6zM14 3v6h6M9 13h6M9 17h6"],
} as Record<string, string[]>;
/** The small icon of a timing kind: clock (pull, phase), curve (health), arrows (interval), bolt (at once). */
export const TIMING_PATH = {
    pull: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0M12 8v4l3 2", phase: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0M12 8v4l3 2", hp: "M4 18 10 8l4 6 6-9",
    interval: "M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3", now: "M13 2 4 14h7l-1 8 9-12h-7z", text: "M4 20h4L19 9l-4-4L4 16z",
} as Record<string, string>;
/** How a step's action is resolved like an assignment (the role it implies): tanking steps -> tanks, healing -> healers, else none. */
export const TASK_OF = {
    tank: "tank", swap: "tank", kite: "special", adds: "tank", heal: "heal",
} as Record<string, RaidplanAssignType>;
/** The categories a library tactic is filed under (free text; these are offered). */
export const CATEGORY_KEYS = ["kite", "swap", "adds", "dispel", "phase2"];
export const MAX_STEPS = 30;
export const MAX_SENTENCE = 160;

function newStepId(): string {
    return `s${Math.random().toString(36).slice(2, 9)}`;
}

/** An empty timing. */
export function noTiming(): RaidplanTiming {
    return { kind: "", from: null, to: null, text: "" };
}

/** A new step of an action, nothing chosen yet. */
export function blankStep(action: string): RaidplanStep {
    return { id: newStepId(), action, participants: [], sentence: "", targets: [], timing: noTiming() };
}

/** The steps of a board (an old board has none). */
export function stepsOf(board: RaidplanBoard): RaidplanStep[] {
    return board.steps || [];
}

/** Adds steps under the others (a new one, a library tactic, a starter), each with a fresh id; never more than MAX_STEPS. */
export function appendSteps(board: RaidplanBoard, steps: RaidplanStep[]): RaidplanBoard {
    const have = stepsOf(board);
    const add = steps.slice(0, Math.max(0, MAX_STEPS - have.length)).map((s) => ({ ...s, id: newStepId(), participants: s.participants.slice(), targets: s.targets.map((x) => ({ ...x })), timing: { ...s.timing } }));
    return { ...board, steps: [...have, ...add] };
}

/** Replaces one step (the dialog's "Fertig"); a step that is not there is added at the end. */
export function putStep(board: RaidplanBoard, step: RaidplanStep): RaidplanBoard {
    const have = stepsOf(board);
    const at = have.findIndex((s) => s.id === step.id);
    if (at < 0) return have.length >= MAX_STEPS ? board : { ...board, steps: [...have, step] };
    return { ...board, steps: have.map((s) => (s.id === step.id ? step : s)) };
}

export function removeStep(board: RaidplanBoard, id: string): RaidplanBoard {
    return { ...board, steps: stepsOf(board).filter((s) => s.id !== id) };
}

/** A copy of a step right under it. */
export function duplicateStep(board: RaidplanBoard, id: string): RaidplanBoard {
    const have = stepsOf(board);
    const at = have.findIndex((s) => s.id === id);
    if (at < 0 || have.length >= MAX_STEPS) return board;
    const copy = { ...have[at], id: newStepId(), participants: have[at].participants.slice(), targets: have[at].targets.map((x) => ({ ...x })), timing: { ...have[at].timing } };
    return { ...board, steps: [...have.slice(0, at + 1), copy, ...have.slice(at + 1)] };
}

/** Moves a step one place up (-1) or down (+1): Alt + arrow keys. */
export function moveStep(board: RaidplanBoard, id: string, dir: number): RaidplanBoard {
    const have = stepsOf(board);
    const at = have.findIndex((s) => s.id === id);
    return at < 0 ? board : moveStepTo(board, id, at + dir);
}

/** Moves a step to a place in the list (dragging by the grip); out of range is clamped. */
export function moveStepTo(board: RaidplanBoard, id: string, index: number): RaidplanBoard {
    const have = stepsOf(board);
    const at = have.findIndex((s) => s.id === id);
    if (at < 0) return board;
    const to = Math.max(0, Math.min(have.length - 1, index));
    if (to === at) return board;
    const rest = have.filter((s) => s.id !== id);
    return { ...board, steps: [...rest.slice(0, to), have[at], ...rest.slice(to)] };
}

/**
 * A step's participants as they resolve now: class references by the central resolution, on their own (the same "Magier 1" in two steps
 * is the same raider), the role the action implies (tanking steps -> tank specs, healing -> healers). Group references ("group:3") stay.
 * Same length and order as the step's participants.
 */
export function resolveParticipants(step: RaidplanStep, slots: { kind: string; n: number; userId: string }[], roster: RaidplanPlayer[], roles: Record<string, string>): string[] {
    const people = step.participants.filter((r) => r.indexOf("group:") !== 0);
    const filled = expandClassRefs([{ id: step.id, type: TASK_OF[step.action] || "other", title: "", spell: null, assignees: people, targets: [], note: "", suggested: false }], slots, roster, roles || {})[0];
    let i = 0;
    return step.participants.map((r) => (r.indexOf("group:") === 0 ? r : filled.assignees[i++]));
}

/** The timing as a word: "Pull", "Phase 2", "bei 50 %", "50 → 30 %", "Pull → 30 %", "alle 30 s", "sofort", or its free text; "" for none. */
export function timingLabel(tm: RaidplanTiming | null | undefined): string {
    if (!tm || !tm.kind) return "";
    if (tm.kind === "pull") return t("raidBoard.steps.timing.pull");
    if (tm.kind === "now") return t("raidBoard.steps.timing.now");
    if (tm.kind === "phase") return t("raidBoard.steps.timing.phaseN", { n: tm.from || 1 });
    if (tm.kind === "interval") return t("raidBoard.steps.timing.everyN", { n: tm.from || 30 });
    if (tm.kind === "hp") {
        if (tm.to !== null && tm.to !== undefined) return tm.from === 100 ? t("raidBoard.steps.timing.pullTo", { to: tm.to }) : t("raidBoard.steps.timing.range", { from: tm.from, to: tm.to });
        return t("raidBoard.steps.timing.atN", { n: tm.from });
    }
    return tm.text || "";
}

/** The sentence suggestions of an action ("kitet … um die Arena"): "…" is where the target goes. */
export function suggestionsFor(action: string): string[] {
    return String(t(`raidBoard.steps.suggest.${action}`)).split("|").map((s) => s.trim()).filter((s) => s && s.indexOf("raidBoard.") !== 0);
}

/** A suggestion put into the sentence: its "…" is the target's name when there is one, else it is dropped. */
export function fillSuggestion(text: string, targetName: string): string {
    return text.replace("…", targetName || "").replace(/\s+/g, " ").trim();
}

/**
 * The "du" form of a sentence for the viewer's own step: the first word is the verb in the third person ("tankt" -> "tankst", "kitet" ->
 * "kitest", "hält" -> "hältst"; English "tanks" -> "tank"). A sentence whose first word is no such verb (plural, a name) stays as it is.
 */
export function duForm(sentence: string, lang: string): string {
    const m = sentence.match(/^(\S+)(.*)$/);
    if (!m) return sentence;
    const w = m[1];
    if (lang === "en") {
        if (/(ss|sh|ch|x)es$/.test(w)) return w.slice(0, -2) + m[2];
        if (/[^s]s$/.test(w) && w.length > 2) return w.slice(0, -1) + m[2];
        return sentence;
    }
    const irregular = DU_IRREGULAR[w.toLowerCase()];
    if (irregular) return irregular + m[2];
    if (/[^s]t$/.test(w) && !/(en|st)$/.test(w) && w.length > 2) return w.slice(0, -1) + "st" + m[2];
    return sentence;
}

/** An entry an @ can name: a raider (goes to the participants) or a mob (goes to the targets). */
export type MentionEntry = { key: string; kind: string; label: string; ref: string; icon: string };

/** German verbs whose "du" form is not "-t" -> "-st" (the stem ends in t or d). */
export const DU_IRREGULAR = {
    "hält": "hältst", "gilt": "giltst", "tritt": "trittst", "rät": "rätst", "lädt": "lädst", "brät": "brätst",
} as Record<string, string>;

/** The @ being typed at the caret: its start and the text after it ("@He|" -> { start, query: "He" }), or null. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
    const before = text.slice(0, caret);
    const m = before.match(/(^|\s)@([^\s@]{0,30})$/);
    if (!m) return null;
    return { start: before.length - m[2].length - 1, query: m[2] };
}

/** The entries an @ offers: players and mobs whose name starts with (else contains) the query, at most `max`, starts first. */
export function mentionMatches(query: string, entries: MentionEntry[], max: number): MentionEntry[] {
    const q = query.toLowerCase();
    const starts = entries.filter((e) => e.label.toLowerCase().indexOf(q) === 0);
    const inner = entries.filter((e) => e.label.toLowerCase().indexOf(q) > 0);
    return [...starts, ...inner].slice(0, max);
}

/** The sentence with the @query replaced by the name picked: "zieht @He" -> "zieht Heilbert ". */
export function applyMention(text: string, start: number, caret: number, name: string): string {
    return `${text.slice(0, start)}${name} ${text.slice(caret).replace(/^\s+/, "")}`.replace(/\s+$/, (s) => (s ? " " : ""));
}

/** Whether a resolved step concerns the viewer: one of his players among its participants, or his group. */
export function isMyStep(resolved: string[], me: string[], myGroups: number[]): boolean {
    return resolved.some((r) => (r.indexOf("user:") === 0 && me.indexOf(r.slice(5)) >= 0) || (r.indexOf("group:") === 0 && myGroups.indexOf(Number(r.slice(6))) >= 0));
}

/** A library tactic's steps for a board: copies (fresh ids come with appendSteps). */
export function tacticSteps(p: RaidplanProfile): RaidplanStep[] {
    return (p.steps || []).map((s) => ({ ...s }));
}

/** The library filtered by a category tab ("" = all) and a search (name, category, a step's sentence), newest first; the first `max`. */
export function libraryView(list: RaidplanProfile[], category: string, query: string, max: number): { shown: RaidplanProfile[]; more: number } {
    const q = query.trim().toLowerCase();
    const hit = list.filter((p) => (!category || p.category === category) && (!q || [p.name, p.category, ...(p.steps || []).map((s) => s.sentence)].join(" ").toLowerCase().indexOf(q) >= 0));
    const sorted = [...hit].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return { shown: sorted.slice(0, max), more: Math.max(0, sorted.length - max) };
}

/** The category tabs of the library: the offered ones first, then the others in use, each once. */
export function libraryCategories(list: RaidplanProfile[]): string[] {
    const offered = CATEGORY_KEYS.map((k) => t(`raidBoard.steps.category.${k}`));
    const out = [...offered];
    for (const p of list) if (p.category && out.indexOf(p.category) < 0) out.push(p.category);
    return out;
}

export type Starter = { key: string; action: string; steps: RaidplanStep[] };

function starterStep(action: string, participants: string[], key: string): RaidplanStep {
    return { id: newStepId(), action, participants, sentence: t(`raidBoard.steps.starter.${key}`), targets: [], timing: noTiming() };
}

/**
 * The three starter tactics of the empty state (kiting, tank swap, adds) with slots, so a template fills them from the setup: texts
 * from the current language, nothing of later game versions.
 */
export function starterTactics(): Starter[] {
    const s = starterStep;
    return [
        { key: "kite", action: "kite", steps: [s("kite", ["slot:tank:2"], "kite1"), s("heal", ["slot:healer:1", "slot:healer:2"], "kite2"), s("soak", [], "kite3")] },
        { key: "swap", action: "swap", steps: [s("tank", ["slot:tank:1"], "swap1"), s("swap", ["slot:tank:2"], "swap2")] },
        { key: "adds", action: "adds", steps: [s("adds", ["slot:tank:2"], "adds1"), s("focus", [], "adds2"), s("wait", [], "adds3")] },
    ];
}

export type SentencePart = { text: string; target: number };

/**
 * The sentence cut at the names of its targets, so a target stands as its chip where the sentence names it ("kitet [Naj'entus] um die
 * Arena"); `target` = the index of the target (-1 = plain words). Targets the sentence does not name are listed in `rest` (shown after it).
 */
export function sentenceParts(sentence: string, names: string[]): { parts: SentencePart[]; rest: number[] } {
    const parts = [];
    const used = [];
    let text = sentence;
    for (;;) {
        let best = -1;
        let at = -1;
        names.forEach((n, i) => {
            if (!n || used.indexOf(i) >= 0) return;
            const p = text.toLowerCase().indexOf(n.toLowerCase());
            if (p >= 0 && (at < 0 || p < at)) { at = p; best = i; }
        });
        if (best < 0) break;
        if (at > 0) parts.push({ text: text.slice(0, at), target: -1 });
        parts.push({ text: text.slice(at, at + names[best].length), target: best });
        used.push(best);
        text = text.slice(at + names[best].length);
    }
    if (text) parts.push({ text, target: -1 });
    const rest = [];
    names.forEach((_n, i) => { if (used.indexOf(i) < 0) rest.push(i); });
    return { parts, rest };
}

/** The name a target is written with in a sentence: a mob's name, a zone's name, a mark's or a group's word. */
export function targetWord(target: { kind: string; ref: string; name?: string }): string {
    if (target.kind === "mob") return target.name || "";
    if (target.kind === "zone") return target.ref;
    if (target.kind === "group") return t("raidBoard.slot.group", { n: Number(target.ref) });
    return t(`raidBoard.mark.${target.ref}`);
}

/**
 * A library tactic applied to a board: its steps are ADDED under the board's (nothing is replaced), the board remembers the tactic, and
 * the tactic's old note becomes the board's note only when the board has none.
 */
export function applyTactic(board: RaidplanBoard, p: RaidplanProfile): RaidplanBoard {
    const next = appendSteps(board, tacticSteps(p));
    return { ...next, profileId: p.id, notes: board.notes && board.notes.trim() ? board.notes : p.notes || "" };
}
