// The setup editor's moves (#263), pure: turn the stored setup into what
// PUT /api/raids/setup takes, move a raider (to a group, onto the bench, swap
// with somebody), toggle a lock — and redraw the lineup locally while the save
// is on its way. The server validates and values every change again; these
// rules only keep the page from sending what it already knows is refused.
//
// Written to be strippable like raidTemplates.ts (test/web-client/setupEditor.test.js
// runs it for real, with `t` injected): imports, `export type` and one-line
// signatures only.
import type { SetupEditorGroup, SetupPerson, SetupPlacementInput, SetupPublish, StoredSetup } from "../api";
import { t } from "../i18n";

export const GROUP_SIZE = 5;

/** Where a raider can be dropped: a group (with `pos`: onto that free place 1…5), the bench, or onto another raider (swap). */
export type SetupTarget = { group: number; pos?: number } | { bench: true } | { userId: string };

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
    const grid = [];
    for (let p = 1; p <= GROUP_SIZE; p++) grid.push(placed.find((s) => s.pos === p) || null);
    return grid;
}

/** The stored setup as the save request carries it. */
export function toInput(setup: StoredSetup): SetupPlacementInput {
    return {
        version: setup.version,
        groups: setup.groups.map((g) => ({
            index: g.index,
            slots: withPlaces(g.slots.map((s) => ({ userId: s.userId, character: s.character, spec: s.spec, role: s.role, locked: !!s.locked, pos: s.pos }))),
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
        groups: input.groups.map((g) => ({ index: g.index, slots: withPlaces(g.slots) })),
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
        return slotFromBench(input.bench.splice(b, 1)[0], people);
    }
    return null;
}

/** A bench entry as a group slot: the person's own spec and role. */
function slotFromBench(entry: { userId: string; locked: boolean }, people: Map<string, SetupPerson>) {
    const person = people.get(entry.userId);
    // pos 0 = no place yet: withPlaces gives it the lowest free one (or the swapped raider's)
    return { userId: entry.userId, character: person ? person.character : "", spec: person ? person.spec : "", role: person ? person.role : "", locked: entry.locked, pos: 0 };
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
    else input.bench[pa.i] = { userId: eb.userId, locked: eb.locked };
    if (pb.slots) pb.slots[pb.i] = { ...ea, pos: eb.pos };
    else input.bench[pb.i] = { userId: ea.userId, locked: ea.locked };
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
 * `{ input: null }` when nothing would change.
 */
export function moveRaider(current: SetupPlacementInput, userId: string, target: SetupTarget, people: Map<string, SetupPerson>, size: number) {
    const from = positionOf(current, userId);
    if (!from) return { error: t("setup.moves.notInSetup") };
    const input = cloneInput(current);

    if ("userId" in target) {
        if (target.userId === userId) return { input: null };
        const to = positionOf(input, target.userId);
        if (!to) return { error: t("setup.moves.targetNotInSetup") };
        if ("bench" in from && "bench" in to) return { input: null };
        if (!swapInPlace(input, userId, target.userId, people)) return { error: t("setup.moves.notInSetup") };
        return { input };
    }

    if ("bench" in target) {
        if ("bench" in from) return { input: null };
        const slot = takeOut(input, userId, people);
        if (!slot) return { error: t("setup.moves.notInSetup") };
        input.bench.push({ userId: slot.userId, locked: slot.locked });
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
    if ("bench" in from && size > 0 && placed >= size) return { error: t("setup.moves.raidFull", { size }) };
    const slot = takeOut(input, userId, people);
    if (!slot) return { error: t("setup.moves.notInSetup") };
    // the wanted place if it is free, else the lowest free one (withPlaces)
    slot.pos = target.pos && !dest.slots.some((s) => s.pos === target.pos) ? target.pos : 0;
    dest.slots.push(slot);
    dest.slots = withPlaces(dest.slots);
    return { input };
}

/**
 * Resize the raid, entirely client-side (#354): recompute how many groups fit
 * `newSize`, drop every group beyond that (its raiders onto the bench), then
 * trim what is left — from the highest-index group down, its last slot first —
 * until the total placed count is no bigger than `newSize`. Everyone bumped is
 * appended to the bench, its own order left alone. Locks are not special-cased
 * here: this is a raw capacity trim, not a proposal re-run — a locked raider
 * can still be bumped, and the next proposal is what should honour locks again.
 */
export function resizeLineup(input: SetupPlacementInput, newSize: number, groupSize = GROUP_SIZE): SetupPlacementInput {
    const out = cloneInput(input);
    const size = Math.max(0, Math.floor(newSize) || 0);
    const groupCount = size > 0 ? Math.ceil(size / groupSize) : 0;
    const overflow = out.groups.filter((g) => g.index > groupCount);
    out.groups = out.groups.filter((g) => g.index <= groupCount);
    for (const g of overflow) for (const s of g.slots) out.bench.push({ userId: s.userId, locked: s.locked });

    let placed = out.groups.reduce((n, g) => n + g.slots.length, 0);
    for (const g of [...out.groups].sort((a, b) => b.index - a.index)) {
        if (placed <= size) break;
        while (placed > size && g.slots.length) {
            const s = g.slots.pop();
            if (!s) break;
            out.bench.push({ userId: s.userId, locked: s.locked });
            placed--;
        }
    }
    return out;
}

/**
 * The bench split into cards the size of a group (#354) — always at least
 * one, and a fresh empty one once the last is full, so there is always room
 * to drop somebody without the last card looking closed off.
 */
export function benchChunks(bench: SetupPerson[], groupSize = GROUP_SIZE): SetupPerson[][] {
    const chunks = [];
    for (let i = 0; i < bench.length; i += groupSize) chunks.push(bench.slice(i, i + groupSize));
    if (!chunks.length || chunks[chunks.length - 1].length >= groupSize) chunks.push([]);
    return chunks;
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

/** The group with a free place where what the raider brings helps most (`fit`, from the server), or null when nowhere does — the drag glow. */
export function suggestGroup(person: SetupPerson, groups: SetupEditorGroup[]): number | null {
    let best = null;
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

/** The reasons the tooltip lists: the attendance line is drawn on its own row for everyone, so the reason of the same name is dropped. */
export function tipReasons(reasons: string[] | undefined): string[] {
    return (reasons || []).filter((r) => !r.startsWith("Anwesenheit "));
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
        groups: input.groups.map((g) => ({ index: g.index, slots: g.slots.map((s) => ({ ...personFrom(people, s.userId, s.locked), pos: s.pos })) })),
        bench: input.bench.map((b) => personFrom(people, b.userId, b.locked)),
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
    const lines = [];
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
    if (publish.outdated) {
        lines.unshift(t("setup.publish.outdated", { version: publish.posted.version }));
    }
    return { tone, text: parts.join(" · "), tip: t("setup.publish.tip"), sub: lines.join("\n") || t("setup.publish.reapproveSub"), running, canPost: true };
}
