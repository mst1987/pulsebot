// The example setups of a Kader (docs/kaderplaner.md, "Beispiel-Setups"): who
// stands where, who is still without a group, the buff hints of a group and the
// text for Discord. A 10er shows groups 1–2; whoever stands in 3–4 counts as
// unplaced until it is a 20er again. Pure.
import type { KaderClassDef, KaderData, KaderEntry, KaderPartyBuff, KaderRaidBuff, KaderRole, KaderSlot, KaderState, KaderVariant, KaderView } from "../../api";
import { getLang, t } from "../../i18n";
import { className, playerName, specName, specRole } from "./model";

/** A buff's name in the menu language: the rule set's English name, else its German one. */
export function buffLabel(buff: KaderRaidBuff): string {
    return getLang() === "en" && buff.labelEn ? buff.labelEn : buff.label;
}

export const GROUP_SIZE = 5;
export type Groups = KaderSlot[][];

/** How many groups a size shows: 2 for a 10er, 4 for a 20er. */
export const visibleGroups = (v: KaderVariant): number => Math.max(1, Math.min(v.groups.length, v.size / GROUP_SIZE));

/** The players standing in the groups the size shows. */
export function placedIds(v: KaderVariant): Set<string> {
    const out = new Set<string>();
    v.groups.slice(0, visibleGroups(v)).forEach((g) => g.forEach((s) => { if (s) out.add(s.userId); }));
    return out;
}

const STATE_ORDER: Record<string, number> = { roster: 0, provisional: 1, bench: 2, tentative: 3 };

/** The players of the chosen states without a place in the visible groups: roster first, then Vorläufig, bench, tentative. */
export function unplaced(view: KaderView, kader: KaderData, v: KaderVariant, sources: KaderState[]): string[] {
    const placed = placedIds(v);
    return Object.entries(kader.players)
        .filter(([id, e]) => sources.includes(e.state) && !placed.has(id))
        .sort(([a, ea], [b, eb]) => (STATE_ORDER[ea.state] - STATE_ORDER[eb.state]) || playerName(view, a, ea).localeCompare(playerName(view, b, eb)))
        .map(([id]) => id);
}

/** The specs a player can stand for: their decision and their wishes. */
export function specsFor(entry: KaderEntry): string[] {
    const out: string[] = [];
    if (entry.decision) out.push(entry.decision.spec);
    for (const w of entry.wishes) if (!out.includes(w.spec)) out.push(w.spec);
    return out;
}

/** The spec a player stands for by default: the decision in the roster, else the first wish. */
export function defaultSpec(entry: KaderEntry): string {
    if (entry.state === "roster" && entry.decision) return entry.decision.spec;
    return entry.wishes[0] ? entry.wishes[0].spec : (entry.decision ? entry.decision.spec : "");
}

/** Puts a player on a slot; whoever stood there takes the player's old place (or is out of the groups). */
export function moveToSlot(groups: Groups, userId: string, spec: string, gi: number, si: number): Groups {
    if (!groups[gi] || si < 0 || si >= groups[gi].length) return groups;
    const next = groups.map((g) => [...g]);
    let fi = -1;
    let fj = -1;
    next.forEach((g, i) => g.forEach((s, j) => {
        if (s && s.userId === userId) { fi = i; fj = j; }
    }));
    const occupant = next[gi][si];
    if (occupant && occupant.userId === userId) return groups;
    const moving = fi >= 0 ? next[fi][fj] : null;
    if (fi >= 0) next[fi][fj] = occupant;
    next[gi][si] = { userId, spec: moving ? moving.spec : spec };
    return next;
}

export function removeFromGroups(groups: Groups, userId: string): Groups {
    return groups.map((g) => g.map((s) => (s && s.userId === userId ? null : s)));
}

export function setSlotSpec(groups: Groups, gi: number, si: number, spec: string): Groups {
    return groups.map((g, i) => g.map((s, j) => (i === gi && j === si && s ? { ...s, spec } : s)));
}

/** The role counts of the placed players, by the spec of each slot. */
export function slotRoles(classes: KaderClassDef[], v: KaderVariant): Record<KaderRole, number> {
    const out: Record<KaderRole, number> = { tank: 0, healer: 0, melee: 0, ranged: 0 };
    v.groups.slice(0, visibleGroups(v)).forEach((g) => g.forEach((s) => {
        const role = s ? specRole(classes, s.spec) : null;
        if (role) out[role] += 1;
    }));
    return out;
}

export type Hint = { key: string; label: string; ok: boolean; important: boolean };

/**
 * The buff hints of one group, by the spec of each slot: a party buff somebody
 * in it brings (ok), or an important one at least two members would want and
 * nobody brings (missing).
 */
export function groupHints(slots: KaderSlot[], party: KaderPartyBuff[]): Hint[] {
    const specs = slots.filter((s): s is NonNullable<KaderSlot> => !!s && !!s.spec).map((s) => s.spec);
    const out: Hint[] = [];
    for (const buff of party) {
        const provided = specs.some((s) => buff.providers.includes(s));
        const wanting = specs.filter((s) => buff.beneficiaries.includes(s)).length;
        if (provided) out.push({ key: buff.key, label: buffLabel(buff), ok: true, important: buff.important });
        else if (buff.important && wanting >= 2) out.push({ key: buff.key, label: buffLabel(buff), ok: false, important: true });
    }
    return out;
}

/** The text of one variant for Discord: the visible groups as numbered lists, then who has no group yet. */
export function setupText({ view, kader, variant, sources }: { view: KaderView; kader: KaderData; variant: KaderVariant; sources: KaderState[] }): string {
    const line = (userId: string, spec: string): string => {
        const entry = kader.players[userId];
        const name = playerName(view, userId, entry);
        const s = specName(view.classes, spec);
        const cls = spec ? className(view.classes, spec.split("-")[0]) : "";
        return cls ? `${name} (${cls}${s ? ` · ${s}` : ""})` : name;
    };
    const out = [`**${kader.name} · ${variant.name} · ${t("kader.setups.sizeN", { n: variant.size })}**`, ""];
    variant.groups.slice(0, visibleGroups(variant)).forEach((g, i) => {
        out.push(`**${t("kader.setups.group", { n: i + 1 })}**`);
        const slots = g.filter((s): s is NonNullable<KaderSlot> => !!s);
        if (!slots.length) out.push(t("kader.setups.emptyGroup"));
        slots.forEach((s, j) => out.push(`${j + 1}. ${line(s.userId, s.spec)}`));
        out.push("");
    });
    const rest = unplaced(view, kader, variant, sources);
    if (rest.length) out.push(`**${t("kader.setups.withoutGroup")}:** ${rest.map((id) => line(id, defaultSpec(kader.players[id]))).join(", ")}`);
    return out.join("\n").trim();
}
