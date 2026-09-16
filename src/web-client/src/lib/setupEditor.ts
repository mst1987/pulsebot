// The setup editor's moves (#263), pure: turn the stored setup into what
// PUT /api/raids/setup takes, move a raider (to a group, onto the bench, swap
// with somebody), toggle a lock — and redraw the lineup locally while the save
// is on its way. The server validates and values every change again; these
// rules only keep the page from sending what it already knows is refused.
//
// Written to be strippable like raidTemplates.ts (test/web-client/setupEditor.test.js
// runs it for real): `import type`, `export type` and one-line signatures only.
import type { SetupEditorGroup, SetupPerson, SetupPlacementInput, StoredSetup } from "../api";

export const GROUP_SIZE = 5;

/** Where a raider can be dropped: a group, the bench, or onto another raider (swap). */
export type SetupTarget = { group: number } | { bench: true } | { userId: string };

/** The stored setup as the save request carries it. */
export function toInput(setup: StoredSetup): SetupPlacementInput {
    return {
        version: setup.version,
        groups: setup.groups.map((g) => ({
            index: g.index,
            slots: g.slots.map((s) => ({ userId: s.userId, spec: s.spec, role: s.role, locked: !!s.locked })),
        })),
        bench: setup.bench.map((b) => ({ userId: b.userId, locked: !!b.locked })),
    };
}

/** All groups 1…count, the empty ones included, so a drop target exists for each. */
export function withAllGroups(groups: SetupEditorGroup[], count: number): SetupEditorGroup[] {
    const out = [];
    for (let i = 1; i <= Math.max(count, 1); i++) {
        const hit = groups.find((g) => g.index === i);
        out.push(hit || { index: i, slots: [] });
    }
    return out;
}

/** Where a raider stands in a save request: `{ group }`, `{ bench: true }` or null. */
export function positionOf(input: SetupPlacementInput, userId: string) {
    for (const g of input.groups) {
        if (g.slots.some((s) => s.userId === userId)) return { group: g.index };
    }
    if (input.bench.some((b) => b.userId === userId)) return { bench: true };
    return null;
}

function cloneInput(input: SetupPlacementInput): SetupPlacementInput {
    return {
        ...input,
        groups: input.groups.map((g) => ({ index: g.index, slots: g.slots.map((s) => ({ ...s })) })),
        bench: input.bench.map((b) => ({ ...b })),
    };
}

/** Take a raider out of wherever they are; returns the removed slot (bench entries get their person's spec). */
function takeOut(input: SetupPlacementInput, userId: string, people: Map<string, SetupPerson>) {
    for (const g of input.groups) {
        const i = g.slots.findIndex((s) => s.userId === userId);
        if (i >= 0) return g.slots.splice(i, 1)[0];
    }
    const b = input.bench.findIndex((x) => x.userId === userId);
    if (b >= 0) {
        const entry = input.bench.splice(b, 1)[0];
        const person = people.get(userId);
        return { userId, spec: person ? person.spec : "", role: person ? person.role : "", locked: entry.locked };
    }
    return null;
}

function groupFor(input: SetupPlacementInput, index: number) {
    let g = input.groups.find((x) => x.index === index);
    if (!g) {
        g = { index, slots: [] };
        input.groups.push(g);
        input.groups.sort((a, b) => a.index - b.index);
    }
    return g;
}

/**
 * Move a raider. A full group refuses a plain drop (swap onto a raider instead);
 * a drop onto somebody swaps the two places. Returns `{ input }` or `{ error }`,
 * and `{ input: null }` when nothing would change.
 */
export function moveRaider(current: SetupPlacementInput, userId: string, target: SetupTarget, people: Map<string, SetupPerson>, size: number) {
    const from = positionOf(current, userId);
    if (!from) return { error: "Raider nicht im Setup." };
    const input = cloneInput(current);

    if ("userId" in target) {
        if (target.userId === userId) return { input: null };
        const to = positionOf(input, target.userId);
        if (!to) return { error: "Ziel nicht im Setup." };
        if ("bench" in from && "bench" in to) return { input: null };
        if ("group" in from && "group" in to && from.group === to.group) return { input: null };
        const a = takeOut(input, userId, people);
        const b = takeOut(input, target.userId, people);
        if (!a || !b) return { error: "Raider nicht im Setup." };
        if ("group" in to) groupFor(input, to.group).slots.push(a);
        else input.bench.push({ userId: a.userId, locked: a.locked });
        if ("group" in from) groupFor(input, from.group).slots.push(b);
        else input.bench.push({ userId: b.userId, locked: b.locked });
        return { input };
    }

    if ("bench" in target) {
        if ("bench" in from) return { input: null };
        const slot = takeOut(input, userId, people);
        if (!slot) return { error: "Raider nicht im Setup." };
        input.bench.push({ userId: slot.userId, locked: slot.locked });
        return { input };
    }

    if ("group" in from && from.group === target.group) return { input: null };
    const dest = groupFor(input, target.group);
    if (dest.slots.length >= GROUP_SIZE) return { error: `Gruppe ${target.group} ist voll – auf einen Raider ziehen, um zu tauschen.` };
    const placed = input.groups.reduce((n, g) => n + g.slots.length, 0);
    if ("bench" in from && size > 0 && placed >= size) return { error: `Der Raid ist voll (${size}) – auf einen Raider ziehen, um zu tauschen.` };
    const slot = takeOut(input, userId, people);
    if (!slot) return { error: "Raider nicht im Setup." };
    groupFor(input, target.group).slots.push(slot);
    return { input };
}

/** Lock or unlock a raider's place. */
export function toggleLock(current: SetupPlacementInput, userId: string): SetupPlacementInput {
    const input = cloneInput(current);
    for (const g of input.groups) for (const s of g.slots) if (s.userId === userId) s.locked = !s.locked;
    for (const b of input.bench) if (b.userId === userId) b.locked = !b.locked;
    return input;
}

/** Every raider of a stored setup by user id. */
export function peopleOf(setup: StoredSetup): Map<string, SetupPerson> {
    const map = new Map();
    for (const g of setup.groups) for (const s of g.slots) map.set(s.userId, s);
    for (const b of setup.bench) map.set(b.userId, b);
    return map;
}

function personFrom(people: Map<string, SetupPerson>, userId: string, locked: boolean): SetupPerson {
    const known = people.get(userId);
    const base = known || { userId, character: userId, classId: "", spec: "", role: "", name: "", classColor: "", classLabel: "", specLabel: "", specIcon: "" };
    return { ...base, userId, locked };
}

/** The setup redrawn from a save request — shown until the server's answer arrives. */
export function applyLocal(setup: StoredSetup, input: SetupPlacementInput): StoredSetup {
    const people = peopleOf(setup);
    return {
        ...setup,
        groups: input.groups.map((g) => ({ index: g.index, slots: g.slots.map((s) => personFrom(people, s.userId, s.locked)) })),
        bench: input.bench.map((b) => personFrom(people, b.userId, b.locked)),
    };
}

/** "3" for an exact target, "≥ 2" for a minimum, "2–4" for a range, "" without one. */
export function roleTarget(check: { min: number; max: number | null }): string {
    if (!check) return "";
    if (check.max === null || check.max === undefined) return check.min > 0 ? `≥ ${check.min}` : "";
    if (check.min === check.max) return String(check.min);
    return `${check.min}–${check.max}`;
}

/** The damage dealers as one check: melee and ranged counted together. */
export function dpsCheck(roles: { melee?: { count: number; min: number; ok: boolean }; ranged?: { count: number; min: number; ok: boolean } }) {
    const melee = roles.melee || { count: 0, min: 0, ok: true };
    const ranged = roles.ranged || { count: 0, min: 0, ok: true };
    return { count: melee.count + ranged.count, min: melee.min + ranged.min, max: null, ok: melee.ok && ranged.ok };
}
