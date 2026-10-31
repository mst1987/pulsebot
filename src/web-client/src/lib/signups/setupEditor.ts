// The setup editor's moves (#263), pure: turn the stored setup into what
// PUT /api/raids/setup takes, move a raider (to a group, onto the bench, back
// into the pool "Angemeldet" (#517), swap with somebody), toggle a lock — and redraw the lineup locally while the save
// is on its way. The server validates and values every change again; these
// rules only keep the page from sending what it already knows is refused.
//
// Written to be strippable like raidTemplates.ts (test/web-client/conventions/events/setupEditor.test.js
// runs it for real, with `t` injected): imports, `export type` and one-line
// signatures only.
import type { SetupCharacter, SetupEditorGroup, SetupPerson, SetupPlacementInput, SetupPublish, SetupSearch, StoredSetup } from "../../api";
import { t } from "../../i18n";

export const GROUP_SIZE = 5;

/**
 * Where a raider can be dropped: a group (with `pos`: onto that free place 1…5), the bench, the pool
 * ("Angemeldet", #517: signed up, neither placed nor benched), or onto another raider (swap).
 * The pool is not part of the save request — who is in neither groups nor bench is in it.
 */
export type SetupTarget = { group: number; pos?: number } | { bench: true } | { pool: true } | { userId: string };

/**
 * Every slot of a group with a place of its own, 1…5: a slot that has a free one
 * keeps it, the others take the lowest free places in their order; sorted by place.
 * The places are where the orga put somebody — a group of two may stand on 1 and 5.
 */
export function withPlaces<T extends { pos?: number }>(slots: T[]): T[] {
    const used = new Set();
    const out = slots.map((s) => {
        const p = Math.floor(Number(s.pos));
        if (p >= 1 && p <= GROUP_SIZE && !used.has(p)) {
            used.add(p);
            return { ...s, pos: p };
        }
        return { ...s, pos: 0 };
    });
    for (const s of out) {
        if (s.pos) continue;
        let p = 1;
        while (used.has(p)) p++;
        used.add(p);
        s.pos = p;
    }
    return out.sort((a, b) => a.pos - b.pos);
}

/** A group's five places as drawn: the raider on each, or null for a free one. */
export function placeGrid<T extends { pos?: number }>(slots: T[]): (T | null)[] {
    const placed = withPlaces(slots);
    const grid: (T | null)[] = [];
    for (let p = 1; p <= GROUP_SIZE; p++) grid.push(placed.find((s) => s.pos === p) || null);
    return grid;
}

/** A stored setup with everything the editor reads: what a hand-written or older setup lacks gets a neutral default (the server does the same). */
export function withSetupDefaults(setup: StoredSetup): StoredSetup {
    if (!setup) return setup;
    const c: Partial<StoredSetup["checks"]> = setup.checks || {};
    const b: Partial<StoredSetup["checks"]["buffs"]> = c.buffs || {};
    const groups = (setup.groups || []).map((g) => ({ ...g, slots: g.slots || [] }));
    const placed = groups.reduce((n, g) => n + g.slots.length, 0);
    return {
        ...setup,
        groups,
        bench: setup.bench || [],
        pool: setup.pool || [],
        warnings: setup.warnings || [],
        options: setup.options || { weights: {}, fairness: null, wishes: null },
        checks: {
            ...c,
            ok: !!c.ok,
            size: c.size || { count: placed, size: 0, ok: false },
            roles: c.roles || {},
            buffs: { ...b, ok: !!b.ok, required: b.required || [], raid: b.raid || [], party: b.party || [] },
            wishes: c.wishes || { met: 0, total: 0 },
        },
    };
}

/** The stored setup as the save request carries it. */
export function toInput(setup: StoredSetup): SetupPlacementInput {
    return {
        version: setup.version,
        groups: setup.groups.map((g) => ({
            index: g.index,
            slots: withPlaces(g.slots.map((s) => ({ userId: s.userId, character: s.character, spec: s.spec, role: s.role, locked: !!s.locked, pos: s.pos }))),
        })),
        bench: setup.bench.map((b) => ({ userId: b.userId, ...(b.character ? { character: b.character } : {}), locked: !!b.locked })),
    };
}

// ---- several characters per raider (#293) -------------------------------------

/**
 * Which character a move takes, by user id — the one the orga dragged or picked
 * in "Angemeldet" (a "kann auch mit" line). Who is not in it plays as they stand.
 */
export type CharacterChoice = Record<string, string>;

const sameName = (a: string | undefined, b: string | undefined) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

/** The raider's signed character of that name, or undefined (one character only, or a name they did not sign up with). */
export function characterNamed(p: SetupPerson | undefined, name: string | undefined): SetupCharacter | undefined {
    return (p?.characters || []).find((c) => sameName(c.character, name));
}

/** The raider drawn as one of their characters: its name, spec, role, class colour and own status. */
export function asCharacter(p: SetupPerson, c: SetupCharacter): SetupPerson {
    return { ...p, character: c.character, spec: c.spec, role: c.role, classId: c.classId, classColor: c.classColor, classLabel: c.classLabel, specLabel: c.specLabel, specIcon: c.specIcon, status: c.status, main: true };
}

/** "Angemeldet"'s role blocks: tank, healer, melee — anything else goes with the ranged. */
export const poolRole = (role: string | undefined) => (role === "tank" || role === "healer" || role === "melee" ? role : "ranged");

/**
 * The character that leads a raider's card in one role block: the one they stand as now when it fits
 * the block, else their first signed character that does; null when none fits (they are not listed there).
 */
export function leadIn(p: SetupPerson, role: string): SetupCharacter | null | undefined {
    if (poolRole(p.role) === role) return characterNamed(p, p.character);
    const hit = (p.characters || []).find((c) => poolRole(c.role) === role);
    return hit || null;
}

/** Whether a raider has a character for a role block — the one they stand as, or any signed one. */
export function fitsRole(p: SetupPerson, role: string): boolean {
    return leadIn(p, role) !== null;
}

/** A slot for the raider as one of their characters — what they stand as now when no other is chosen. */
function asSlot(person: SetupPerson | undefined, userId: string, locked: boolean, choice?: CharacterChoice) {
    const chosen = choice && choice[userId] ? characterNamed(person, choice[userId]) : undefined;
    if (chosen && !sameName(chosen.character, person?.character)) {
        // a "kann auch mit" character the orga picked: locked, so the next proposal keeps it (like "Im Setup als")
        return { userId, character: chosen.character, spec: chosen.spec, role: chosen.role, locked: locked || chosen.priority > 0, pos: 0 };
    }
    return { userId, character: person ? person.character : "", spec: person ? person.spec : "", role: person ? person.role : "", locked, pos: 0 };
}

/**
 * "Charakter wechseln": a placed raider plays another of the characters they signed up with — the place
 * stays, the slot takes that character's name, spec and role and is locked (like respecRaider); on the
 * bench the entry just names the other character. `{ input: null }` when nothing changes, `{ error }`
 * for a character they did not sign up with or somebody not in a group or on the bench.
 */
export function switchCharacter(current: SetupPlacementInput, userId: string, c: SetupCharacter) {
    const input = cloneInput(current);
    for (const g of input.groups) {
        const s = g.slots.find((x) => x.userId === userId);
        if (!s) continue;
        if (sameName(s.character, c.character) && s.spec === c.spec && s.locked) return { input: null };
        s.character = c.character;
        s.spec = c.spec;
        s.role = c.role;
        s.locked = true;
        return { input };
    }
    const b = input.bench.find((x) => x.userId === userId);
    if (!b) return { error: t("setup.moves.switchPool") };
    if (sameName(b.character, c.character)) return { input: null };
    b.character = c.character;
    return { input };
}

/** All groups 1…count, the empty ones included, so a drop target exists for each. */
export function withAllGroups(groups: SetupEditorGroup[], count: number): SetupEditorGroup[] {
    const out: SetupEditorGroup[] = [];
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
        groups: input.groups.map((g) => ({ index: g.index, slots: withPlaces(g.slots) })),
        bench: input.bench.map((b) => ({ ...b })),
    };
}

/** Take a raider out of wherever they are; returns the removed slot (bench and pool entries get their person's spec, or the chosen character's). */
function takeOut(input: SetupPlacementInput, userId: string, people: Map<string, SetupPerson>, choice?: CharacterChoice) {
    for (const g of input.groups) {
        const i = g.slots.findIndex((s) => s.userId === userId);
        if (i >= 0) return g.slots.splice(i, 1)[0];
    }
    const b = input.bench.findIndex((x) => x.userId === userId);
    if (b >= 0) {
        return slotFromBench(input.bench.splice(b, 1)[0], people, choice);
    }
    // somebody from the pool is in neither list — nothing to take out, just their slot
    return people.has(userId) ? slotFromBench({ userId, locked: false }, people, choice) : null;
}

/** Where a raider stands, the pool included: `{ group }`, `{ bench: true }`, `{ pool: true }` or null. */
function whereIs(input: SetupPlacementInput, userId: string, people: Map<string, SetupPerson>) {
    return positionOf(input, userId) || (people.has(userId) ? { pool: true as const } : null);
}

/**
 * A swap with the pool (#517): the raider from the pool takes the other's exact
 * place (group and number, or the bench), the other goes back into the pool.
 */
function swapWithPool(input: SetupPlacementInput, fromPool: string, placed: string, people: Map<string, SetupPerson>, choice?: CharacterChoice) {
    const at = placeOf(input, placed);
    if (!at) return false;
    const incoming = slotFromBench({ userId: fromPool, locked: false }, people, choice);
    if (at.slots) at.slots[at.i] = { ...incoming, pos: at.slots[at.i].pos };
    else input.bench[at.i] = { ...benchEntry(incoming), locked: false };
    return true;
}

/** A bench entry as a group slot: the person's own spec and role — or the character chosen for the move. */
function slotFromBench(entry: { userId: string; character?: string; locked: boolean }, people: Map<string, SetupPerson>, choice?: CharacterChoice) {
    const person = people.get(entry.userId);
    // pos 0 = no place yet: withPlaces gives it the lowest free one (or the swapped raider's)
    return asSlot(person, entry.userId, entry.locked, choice);
}

/** A slot as a bench entry: who, which character, the lock. */
function benchEntry(slot: { userId: string; character?: string; locked: boolean }) {
    return { userId: slot.userId, ...(slot.character ? { character: slot.character } : {}), locked: slot.locked };
}

/** Where a raider stands: their group's slots (null on the bench) and the position there. */
function placeOf(input: SetupPlacementInput, userId: string) {
    for (const g of input.groups) {
        const i = g.slots.findIndex((s) => s.userId === userId);
        if (i >= 0) return { slots: g.slots, i };
    }
    const i = input.bench.findIndex((x) => x.userId === userId);
    return i >= 0 ? { slots: null, i } : null;
}

/**
 * Swap two raiders in place: each takes the other's exact position — so inside
 * one group this reorders it, across groups both keep the row they land on.
 */
function swapInPlace(input: SetupPlacementInput, a: string, b: string, people: Map<string, SetupPerson>) {
    const pa = placeOf(input, a);
    const pb = placeOf(input, b);
    if (!pa || !pb) return false;
    const ea = pa.slots ? pa.slots[pa.i] : slotFromBench(input.bench[pa.i], people);
    const eb = pb.slots ? pb.slots[pb.i] : slotFromBench(input.bench[pb.i], people);
    // each takes the other's exact place (number) too
    if (pa.slots) pa.slots[pa.i] = { ...eb, pos: ea.pos };
    else input.bench[pa.i] = benchEntry(eb);
    if (pb.slots) pb.slots[pb.i] = { ...ea, pos: eb.pos };
    else input.bench[pb.i] = benchEntry(ea);
    return true;
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
 * Move a raider. A drop onto somebody swaps the two places (inside one group
 * that reorders it); a drop onto a group takes its first free place — in the
 * raider's own group that is the last one. A full group refuses a plain drop
 * (swap onto a raider instead). Returns `{ input }` or `{ error }`, and
 * `{ input: null }` when nothing would change. `choice` (#293): the character
 * somebody coming out of "Angemeldet" or off the bench plays — a "kann auch
 * mit" one is locked, so the next proposal keeps it.
 */
export function moveRaider(current: SetupPlacementInput, userId: string, target: SetupTarget, people: Map<string, SetupPerson>, size: number, choice?: CharacterChoice) {
    const from = whereIs(current, userId, people);
    if (!from) return { error: t("setup.moves.notInSetup") };
    const input = cloneInput(current);

    if ("userId" in target) {
        if (target.userId === userId) return { input: null };
        const to = whereIs(input, target.userId, people);
        if (!to) return { error: t("setup.moves.targetNotInSetup") };
        if (("bench" in from && "bench" in to) || ("pool" in from && "pool" in to)) return { input: null };
        if ("pool" in from) return swapWithPool(input, userId, target.userId, people, choice) ? { input } : { error: t("setup.moves.notInSetup") };
        if ("pool" in to) return swapWithPool(input, target.userId, userId, people, choice) ? { input } : { error: t("setup.moves.notInSetup") };
        if (!swapInPlace(input, userId, target.userId, people)) return { error: t("setup.moves.notInSetup") };
        return { input };
    }

    // back into the pool: out of the groups and off the bench, nothing else (#517)
    if ("pool" in target) {
        if ("pool" in from) return { input: null };
        takeOut(input, userId, people);
        return { input };
    }

    if ("bench" in target) {
        if ("bench" in from) return { input: null };
        const slot = takeOut(input, userId, people, choice);
        if (!slot) return { error: t("setup.moves.notInSetup") };
        // out of the pool onto the bench: no lock, whichever character waits there
        input.bench.push({ ...benchEntry(slot), locked: "pool" in from ? false : slot.locked });
        return { input };
    }

    if ("group" in from && from.group === target.group) {
        const own = groupFor(input, target.group);
        const me = own.slots.find((s) => s.userId === userId);
        if (!me) return { error: t("setup.moves.notInSetup") };
        // onto a free place of the own group: just change the place
        if (target.pos) {
            if (me.pos === target.pos || own.slots.some((s) => s.pos === target.pos)) return { input: null };
            me.pos = target.pos;
            own.slots = withPlaces(own.slots);
            return { input };
        }
        // onto the group itself: to the end (the places close up)
        if (own.slots[own.slots.length - 1].userId === userId) return { input: null };
        const moved = takeOut(input, userId, people);
        if (moved) own.slots.push(moved);
        own.slots.forEach((s, i) => { s.pos = i + 1; });
        return { input };
    }
    const dest = groupFor(input, target.group);
    if (dest.slots.length >= GROUP_SIZE) return { error: t("setup.moves.groupFull", { group: target.group }) };
    const placed = input.groups.reduce((n, g) => n + g.slots.length, 0);
    if (!("group" in from) && size > 0 && placed >= size) return { error: t("setup.moves.raidFull", { size }) };
    const slot = takeOut(input, userId, people, choice);
    if (!slot) return { error: t("setup.moves.notInSetup") };
    // the wanted place if it is free, else the lowest free one (withPlaces)
    slot.pos = target.pos && !dest.slots.some((s) => s.pos === target.pos) ? target.pos : 0;
    dest.slots.push(slot);
    dest.slots = withPlaces(dest.slots);
    return { input };
}

/**
 * Resize the raid, entirely client-side (#354): recompute how many groups fit
 * `newSize`, drop every group beyond that (its raiders back into the pool,
 * "Angemeldet" — #517: nobody lands on the bench by themselves), then
 * trim what is left — from the highest-index group down, its last slot first —
 * until the total placed count is no bigger than `newSize`. Locks are not special-cased
 * here: this is a raw capacity trim, not a proposal re-run — a locked raider
 * can still be bumped, and the next proposal is what should honour locks again.
 */
export function resizeLineup(input: SetupPlacementInput, newSize: number, groupSize = GROUP_SIZE): SetupPlacementInput {
    const out = cloneInput(input);
    const size = Math.max(0, Math.floor(newSize) || 0);
    const groupCount = size > 0 ? Math.ceil(size / groupSize) : 0;
    out.groups = out.groups.filter((g) => g.index <= groupCount);

    let placed = out.groups.reduce((n, g) => n + g.slots.length, 0);
    for (const g of [...out.groups].sort((a, b) => b.index - a.index)) {
        if (placed <= size) break;
        while (placed > size && g.slots.length) {
            if (!g.slots.pop()) break;
            placed--;
        }
    }
    return out;
}

/** Lock or unlock a raider's place. */
export function toggleLock(current: SetupPlacementInput, userId: string): SetupPlacementInput {
    const input = cloneInput(current);
    for (const g of input.groups) for (const s of g.slots) if (s.userId === userId) s.locked = !s.locked;
    for (const b of input.bench) if (b.userId === userId) b.locked = !b.locked;
    return input;
}

/**
 * Put a raider into the setup as another spec of their class — the third tank, an extra healer.
 * The slot keeps its place, takes the spec and its role, and is locked, so the next proposal leaves it as chosen.
 * `{ input: null }` when nothing changes, `{ error }` for somebody on the bench or in the pool (they have no slot to change yet).
 */
export function respecRaider(current: SetupPlacementInput, userId: string, spec: { key: string; role: string }) {
    for (const g of current.groups) {
        if (!g.slots.some((s) => s.userId === userId)) continue;
        const now = g.slots.find((s) => s.userId === userId);
        if (now && now.spec === spec.key && now.locked) return { input: null };
        const input = cloneInput(current);
        for (const gr of input.groups) {
            for (const s of gr.slots) {
                if (s.userId === userId) {
                    s.spec = spec.key;
                    s.role = spec.role;
                    s.locked = true;
                }
            }
        }
        return { input };
    }
    return { error: t("setup.moves.respecBench") };
}

/** Every raider of a stored setup by user id. */
export function peopleOf(setup: StoredSetup): Map<string, SetupPerson> {
    const map = new Map();
    for (const g of setup.groups) for (const s of g.slots) map.set(s.userId, s);
    for (const b of setup.bench) map.set(b.userId, b);
    for (const b of setup.pool || []) map.set(b.userId, b);
    return map;
}

/** The group with a free place where what the raider brings helps most (`fit`, from the server), or null when nowhere does — the drag glow. */
export function suggestGroup(person: SetupPerson, groups: SetupEditorGroup[]): number | null {
    let best: number | null = null;
    let bestFit = 0;
    for (const g of groups) {
        if (g.slots.length >= GROUP_SIZE || g.slots.some((s) => s.userId === person.userId)) continue;
        const fit = (person.fit || {})[String(g.index)] || 0;
        if (fit > bestFit) {
            best = g.index;
            bestFit = fit;
        }
    }
    return best;
}

/**
 * The proposal's reasons that only name the signup state (src/utils/setup/reasons.js' STATUS_REASON, German
 * whatever the page language): the panel shows the state as its field in the app's one word ("Vielleicht",
 * "Spät", "Bank"), so these would only repeat it in other words. Matched, never shown — a pattern, not a
 * string, since this is the server's data and not a text of the page (test/web-client/conventions/i18n/i18n.test.js).
 */
const STATUS_REASON = /^(Kommt sp.ter|Nur „Vielleicht“ angemeldet|Als Ersatz angemeldet)$/;

/**
 * The reasons the tooltip lists: the attendance line is drawn on its own row for everyone, so the reason of
 * the same name is dropped — and so is a reason that only names the signup state (its field says it).
 */
export function tipReasons(reasons: string[] | undefined): string[] {
    return (reasons || []).filter((r) => !r.startsWith("Anwesenheit ") && !STATUS_REASON.test(r));
}

function personFrom(people: Map<string, SetupPerson>, userId: string, locked: boolean): SetupPerson {
    const known = people.get(userId);
    const base = known || { userId, character: userId, classId: "", spec: "", role: "", name: "", classColor: "", classLabel: "", specLabel: "", specIcon: "" };
    return { ...base, userId, locked };
}

/** The raider as the save request puts them: another of their characters (#293), or another spec of the class ("Im Setup als"). */
function drawnAs(people: Map<string, SetupPerson>, entry: { userId: string; character?: string; spec?: string; role?: string; locked: boolean }): SetupPerson {
    const base = personFrom(people, entry.userId, entry.locked);
    const other = entry.character && !sameName(entry.character, base.character) ? characterNamed(base, entry.character) : undefined;
    const p = other ? { ...asCharacter(base, other), locked: entry.locked } : base;
    if (!entry.spec || entry.spec === p.spec) return p;
    const spec = (p.classSpecs || []).find((x) => x.key === entry.spec);
    return spec ? { ...p, spec: spec.key, specLabel: spec.label, specIcon: spec.icon || p.specIcon, role: (entry.role || spec.role) as SetupPerson["role"] } : p;
}

/**
 * The setup redrawn from a save request — shown until the server's answer arrives.
 * The pool (#517) is everybody the setup knows who stands in neither list: its
 * own order first, then who just left a group or the bench.
 */
export function applyLocal(setup: StoredSetup, input: SetupPlacementInput): StoredSetup {
    const people = peopleOf(setup);
    const taken = new Set([...input.groups.flatMap((g) => g.slots.map((s) => s.userId)), ...input.bench.map((b) => b.userId)]);
    const pool: SetupPerson[] = [];
    for (const p of [...(setup.pool || []), ...setup.groups.flatMap((g) => g.slots), ...setup.bench]) {
        if (taken.has(p.userId) || pool.some((x) => x.userId === p.userId)) continue;
        pool.push(personFrom(people, p.userId, false));
    }
    return {
        ...setup,
        groups: input.groups.map((g) => ({ index: g.index, slots: g.slots.map((s) => ({ ...drawnAs(people, s), pos: s.pos })) })),
        bench: input.bench.map((b) => drawnAs(people, b)),
        pool,
    };
}

/** What the ping-text field sends on commit: the trimmed draft, or null when it did not change. */
export function pingTextToSave(draft: string, current: string): string | null {
    const next = draft.trim();
    return next === (current || "").trim() ? null : next;
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

/** One line about the setup's own message and its DMs (#290): what will happen, or what did. */
export type PublishHint = { tone: "ok" | "mid" | "bad" | ""; text: string; tip: string; sub: string; running: boolean; canPost: boolean };

/**
 * Before the approval: "Beim Freigeben: postet Setup in #kanal · DMs an 25 Raider (aus)".
 * After it: "gepostet 17:40 · 22 DMs · 3 fehlgeschlagen", the failures in the tooltip.
 * `time` formats a millisecond timestamp. null without publish data (a reader).
 */
export function publishHint(publish: SetupPublish | undefined, approved: boolean, time: (ms: number) => string): PublishHint | null {
    if (!publish) return null;
    const channel = publish.channelName ? `#${publish.channelName}` : t("setup.publish.eventChannel");
    const dmsOff = t("setup.publish.dmsOff", { count: publish.recipients });
    const offSub = t("setup.publish.offSub");
    if (publish.cancelled) {
        return { tone: "mid", text: t("setup.publish.cancelledText"), tip: t("setup.publish.cancelledTip"), sub: t("setup.publish.cancelledSub"), running: false, canPost: false };
    }
    if (!approved) {
        const post = publish.posted ? t("setup.publish.willUpdate", { channel }) : t("setup.publish.willPost", { channel });
        const dms = publish.dmsEnabled ? t("setup.publish.dmsTo", { count: publish.pendingDms }) : dmsOff;
        const sub = [
            t("setup.publish.draftNeverPosted"),
            publish.posted ? t("setup.publish.editsExisting") : "",
            publish.dmsEnabled ? t("setup.publish.dmOnlyChanged") : offSub,
        ].filter(Boolean).join("\n");
        return { tone: "", text: t("setup.publish.onApprove", { post, dms }), tip: t("setup.publish.onApproveTip"), sub, running: false, canPost: false };
    }
    const lastPost = publish.posted ? Math.max(publish.posted.postedAt || 0, publish.posted.editedAt || 0) : 0;
    if (publish.error && publish.errorAt >= lastPost) {
        return { tone: "bad", text: t("setup.publish.errorText", { error: publish.error }), tip: t("setup.publish.errorTip", { channel }), sub: t("setup.publish.errorSub", { time: time(publish.errorAt) }), running: false, canPost: true };
    }
    if (!publish.posted) {
        return { tone: "mid", text: t("setup.publish.notPosted", { channel }), tip: t("setup.publish.post"), sub: t("setup.publish.notPostedSub"), running: false, canPost: true };
    }
    const edited = (publish.posted.editedAt || 0) > (publish.posted.postedAt || 0);
    const parts = [t(edited ? "setup.publish.updatedAt" : "setup.publish.postedAt", { time: time(lastPost), channel })];
    const lines: string[] = [];
    const dms = publish.dms;
    const running = !!dms && dms.status === "running";
    const failed = !running && !!dms && publish.dmsEnabled && dms.failed.length > 0;
    const tone = failed || publish.outdated ? "mid" : "ok";
    if (dms && running) {
        parts.push(t("setup.publish.dmsRunning", { done: dms.sent + dms.failed.length, total: dms.total }));
    } else if (dms && publish.dmsEnabled) {
        parts.push(t("setup.publish.dmsSent", { count: dms.sent }));
        if (failed) {
            parts.push(t("setup.publish.failed", { count: dms.failed.length }));
            lines.push(t("setup.publish.failedHead"), ...dms.failed.map((f) => `${f.character || f.userId} – ${f.error}`));
        }
        if (dms.unchanged) lines.push(t("setup.publish.unchanged", { count: dms.unchanged }));
    } else if (!publish.dmsEnabled) {
        parts.push(t("setup.publish.dmsOffShort"));
        lines.push(offSub);
    }
    // a change after the post goes live without DMs — who still waits for one ("Setup posten" sends it);
    // the failed ones are already named above
    const open = (publish.pendingDms || 0) - (failed && dms ? dms.failed.length : 0);
    if (!running && publish.dmsEnabled && open > 0) parts.push(t("setup.publish.dmsPending", { count: open }));
    if (publish.outdated) {
        lines.unshift(t("setup.publish.outdated", { version: publish.posted.version }));
    }
    lines.push(t("setup.publish.liveSub"));
    return { tone, text: parts.join(" · "), tip: t("setup.publish.tip"), sub: lines.join("\n"), running, canPost: true };
}

/**
 * The ONE state of the setup in the editor's bar — a badge that can never say
 * "Gepostet" next to "noch nicht gepostet": a draft (or a draft again, changed
 * since the post), approved but not out yet, posting failed, posted but the
 * message shows an older version, posted. `needsPost` says the bar's one primary
 * button is "Setup posten" (else, once posted, the ping); `version` is the
 * "Stand" a posted message shows.
 */
export type SetupState = { key: "draft" | "changed" | "notPosted" | "error" | "outdated" | "posted" | "cancelled"; tone: "ok" | "mid" | "bad"; label: string; version: number; needsPost: boolean };

export function setupState(setup: Pick<StoredSetup, "status" | "changedSinceApproval" | "version">, publish: SetupPublish | undefined): SetupState {
    const version = (publish && publish.posted && publish.posted.version) || setup.version || 1;
    const make = (key: SetupState["key"], tone: SetupState["tone"], needsPost: boolean): SetupState => ({ key, tone, label: t(`setup.state.${key}`, { version }), version, needsPost });
    if (publish && publish.cancelled) return make("cancelled", "mid", false);
    if (setup.status !== "approved") return make(setup.changedSinceApproval ? "changed" : "draft", "mid", true);
    if (!publish) return make("posted", "ok", false);
    const lastPost = publish.posted ? Math.max(publish.posted.postedAt || 0, publish.posted.editedAt || 0) : 0;
    if (publish.error && publish.errorAt >= lastPost) return make("error", "bad", true);
    if (!publish.posted) return make("notPosted", "mid", true);
    if (publish.outdated) return make("outdated", "mid", true);
    return make("posted", "ok", false);
}

/** The missing buffs, one row per set of specs that brings them — six blessings of the same paladin specs are one row, not six. */
export function groupSearchBuffs(buffs: SetupSearch["buffs"]): { id: string; required: boolean; specs: string[]; buffs: SetupSearch["buffs"] }[] {
    const groups: { id: string; required: boolean; specs: string[]; buffs: SetupSearch["buffs"] }[] = [];
    for (const b of buffs) {
        const id = `${b.required}:${b.specs.join(",")}`;
        const hit = groups.find((g) => g.id === id);
        if (hit) hit.buffs.push(b);
        else groups.push({ id, required: b.required, specs: b.specs, buffs: [b] });
    }
    return groups;
}

/** What the orga edits in the "Suche" dialog: how many of a role and which specs, and the buffs still listed. */
export type SearchNeeds = { roles: { role: string; missing: number; specs: string[] }[]; buffs: SetupSearch["buffs"] };

/** The needs as the suggestion has them — a copy, the suggestion itself stays as it came. */
export function searchNeedsFrom(search: SetupSearch): SearchNeeds {
    return { roles: search.roles.map((r) => ({ role: r.role, missing: r.missing, specs: [...r.specs] })), buffs: search.buffs.map((b) => ({ ...b })) };
}

/** One more or one fewer of a role (1–40); a role that reaches 0 drops out of the list. */
export function stepRole(needs: SearchNeeds, role: string, delta: number): SearchNeeds {
    return {
        ...needs,
        roles: needs.roles.map((r) => (r.role === role ? { ...r, missing: Math.min(40, r.missing + delta) } : r)).filter((r) => r.missing > 0),
    };
}

/** Take a spec of a role in or out of the search. */
export function toggleSpec(needs: SearchNeeds, role: string, key: string): SearchNeeds {
    return {
        ...needs,
        roles: needs.roles.map((r) => (r.role === role ? { ...r, specs: r.specs.includes(key) ? r.specs.filter((k) => k !== key) : [...r.specs, key] } : r)),
    };
}

/** Add a role nobody was missing yet: one of it, every spec of the role. */
export function addRole(needs: SearchNeeds, role: string, specs: string[]): SearchNeeds {
    if (needs.roles.some((r) => r.role === role)) return needs;
    return { ...needs, roles: [...needs.roles, { role, missing: 1, specs: [...specs] }] };
}

/** Drop buffs from the search. */
export function removeBuffs(needs: SearchNeeds, keys: string[]): SearchNeeds {
    return { ...needs, buffs: needs.buffs.filter((b) => !keys.includes(b.key)) };
}
