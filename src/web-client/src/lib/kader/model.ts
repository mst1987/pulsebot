// The Kaderplaner's pure logic (docs/kaderplaner.md): who stands where, the
// numbers of the board's side panel, the buff hints of a group. Everything the
// server already decided (the effective character, its role, what deviates from
// the profile) comes with the view model; this only counts and sorts.
import type { KaderCharacter, KaderClassDef, KaderPartyBuff, KaderPlayer, KaderRaidBuff, KaderRole, KaderRoster, KaderVariant, KaderView } from "../../api";
import { classLabel, specLabel } from "../wowNames";
import { t } from "../../i18n";

export type Status = "kader" | "bench" | "none";

export const ROLES: KaderRole[] = ["tank", "healer", "melee", "ranged"];
export const GROUP_SIZE = 5;

export const byId = (players: KaderPlayer[]): Map<string, KaderPlayer> => new Map(players.map((p) => [p.userId, p]));

/** The character the planner uses for a player (the planner's pick, else the profile's main). */
export function activeOf(p: KaderPlayer | undefined | null): KaderCharacter | null {
    if (!p) return null;
    return p.characters.find((c) => c.id === p.activeCharacterId) || null;
}

export function classDef(classes: KaderClassDef[], key: string | undefined | null): KaderClassDef | null {
    return (key && classes.find((c) => c.key === key)) || null;
}

/** The class colour, handed to the stylesheet as --cc (never as color:, see ClassSpec.tsx). */
export function colorOf(classes: KaderClassDef[], p: KaderPlayer | null | undefined): string {
    const a = activeOf(p);
    const c = a ? classDef(classes, a.className) : null;
    return c ? c.color : "";
}

/** "Krieger" / "Warrior" for a class key, the server's label as the fallback. */
export function className(classes: KaderClassDef[], key: string): string {
    const c = classDef(classes, key);
    return classLabel(key, c ? c.name : key);
}

/** "Schutz" / "Protection" for a spec key ("Warrior-Protection"). */
export function specName(classes: KaderClassDef[], key: string | null | undefined): string {
    if (!key) return "";
    const cls = classDef(classes, key.split("-")[0]);
    const spec = cls ? cls.specs.find((s) => s.key === key) : null;
    return specLabel(key, spec ? spec.name : key);
}

/** Whether a player is in the roster, on its bench or neither. */
export function statusOf(roster: KaderRoster | null, userId: string): Status {
    if (!roster) return "none";
    if (roster.members.some((m) => m.userId === userId)) return "kader";
    if (roster.bench.includes(userId)) return "bench";
    return "none";
}

export const pctOf = (p: KaderPlayer): number | null => (p.attendance ? p.attendance.pct : null);

/** Attendance for sorting: best first, nothing counted last. */
export const attSortValue = (p: KaderPlayer): number => (p.attendance ? p.attendance.pct : -1);

/** Name, Discord name, characters, class and spec — what the search looks through. */
export function searchText(p: KaderPlayer, classes: KaderClassDef[]): string {
    const chars = p.characters.map((c) => `${c.name} ${className(classes, c.className)} ${specName(classes, c.mainSpec)}`).join(" ");
    return `${p.displayName} ${chars}`.toLowerCase();
}

export type RoleCard = { role: KaderRole; target: number; count: number; slots: (KaderPlayer | null)[] };

/** The four role cards of the board: filled slots first, then empty ones up to the target. */
export function roleCards(roster: KaderRoster, players: Map<string, KaderPlayer>): RoleCard[] {
    return ROLES.map((role) => {
        const filled = roster.members.filter((m) => m.role === role).map((m) => players.get(m.userId)).filter((p): p is KaderPlayer => !!p);
        const target = roster.targets[role] ?? 0;
        const slots: (KaderPlayer | null)[] = [...filled];
        while (slots.length < target) slots.push(null);
        return { role, target, count: filled.length, slots };
    });
}

export type ClassCount = { key: string; color: string; n: number };

/** How many of each class the roster holds, most first. */
export function classCounts(roster: KaderRoster, players: Map<string, KaderPlayer>, classes: KaderClassDef[]): ClassCount[] {
    const counts = new Map<string, number>();
    for (const m of roster.members) {
        const a = activeOf(players.get(m.userId));
        if (a && a.className) counts.set(a.className, (counts.get(a.className) || 0) + 1);
    }
    return [...counts.entries()]
        .map(([key, n]) => ({ key, color: classDef(classes, key)?.color || "", n }))
        .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
}

/** Whether a player's main spec brings a buff (providers are spec keys). */
export function provides(buff: KaderRaidBuff, p: KaderPlayer | undefined): boolean {
    const a = activeOf(p);
    return !!a && !!a.mainSpec && buff.providers.includes(a.mainSpec);
}

/** Which of the side panel's raid buffs the roster brings. */
export function raidBuffStatus(roster: KaderRoster, players: Map<string, KaderPlayer>, raid: KaderRaidBuff[]): { buff: KaderRaidBuff; ok: boolean }[] {
    const members = roster.members.map((m) => players.get(m.userId));
    return raid.map((buff) => ({ buff, ok: members.some((p) => provides(buff, p)) }));
}

/** The average attendance of the roster, null while nobody has any. */
export function averageAttendance(roster: KaderRoster, players: Map<string, KaderPlayer>): number | null {
    const rates = roster.members.map((m) => players.get(m.userId)).map((p) => (p ? pctOf(p) : null)).filter((x): x is number => x !== null);
    if (!rates.length) return null;
    return Math.round(rates.reduce((a, b) => a + b, 0) / rates.length);
}

/** The roster a page shows: the remembered one when it still exists, else the first. */
export function pickRoster(view: KaderView, wanted: string): KaderRoster | null {
    return view.rosters.find((r) => r.id === wanted) || view.rosters[0] || null;
}

// ------------------------------------------------------------------ setup

export type Groups = (string | null)[][];

/** Roster members that sit in no group yet, in roster order. */
export function unassigned(roster: KaderRoster, variant: KaderVariant): string[] {
    const placed = new Set(variant.groups.flat().filter((x): x is string => !!x));
    return roster.members.map((m) => m.userId).filter((id) => !placed.has(id));
}

/** Puts a player on a slot; whoever sat there takes the player's old place (or is out of the groups). */
export function moveToSlot(groups: Groups, userId: string, gi: number, si: number): Groups {
    if (!groups[gi] || groups[gi].length <= si) return groups;
    const next = groups.map((g) => [...g]);
    let fi = -1;
    let fj = -1;
    next.forEach((g, i) => g.forEach((id, j) => {
        if (id === userId) { fi = i; fj = j; }
    }));
    const occupant = next[gi][si];
    if (occupant === userId) return groups;
    if (fi >= 0) next[fi][fj] = occupant;
    next[gi][si] = userId;
    return next;
}

export function removeFromGroups(groups: Groups, userId: string): Groups {
    return groups.map((g) => g.map((id) => (id === userId ? null : id)));
}

export type Hint = { key: string; label: string; ok: boolean };

/**
 * The buff hints of one group: a party buff somebody in it brings (ok), or an
 * important one at least two members would want and nobody brings (missing).
 */
export function groupHints(ids: (string | null)[], players: Map<string, KaderPlayer>, party: KaderPartyBuff[]): Hint[] {
    const members = ids.filter((x): x is string => !!x).map((id) => players.get(id)).filter((p): p is KaderPlayer => !!p);
    const out: Hint[] = [];
    for (const buff of party) {
        const provided = members.some((p) => provides(buff, p));
        const wanting = members.filter((p) => {
            const a = activeOf(p);
            return !!a && !!a.mainSpec && buff.beneficiaries.includes(a.mainSpec);
        }).length;
        if (provided) out.push({ key: buff.key, label: buff.label, ok: true });
        else if (buff.important && wanting >= 2) out.push({ key: buff.key, label: buff.label, ok: false });
    }
    return out;
}

/** The role most of a group stands for, "mixed" on a tie, "empty" without anybody. */
export function focusOf(ids: (string | null)[], roles: Map<string, KaderRole>): KaderRole | "mixed" | "empty" {
    const counts = new Map<KaderRole, number>();
    for (const id of ids) {
        const r = id ? roles.get(id) : undefined;
        if (r) counts.set(r, (counts.get(r) || 0) + 1);
    }
    if (!counts.size) return "empty";
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) return "mixed";
    return sorted[0][0];
}

/** "Krieger · Schutz", "noch kein Forever-Char" without a character. */
export function specLine(player: KaderPlayer, classes: KaderClassDef[]): string {
    const a = activeOf(player);
    if (!a) return t("kader.player.noCharLong");
    const spec = specName(classes, a.mainSpec);
    return `${className(classes, a.className)} · ${spec || t("kader.player.noSpec")}`;
}

/** "83 %", or "—" while nothing is counted. */
export function attText(player: KaderPlayer): string {
    const pct = pctOf(player);
    return pct === null ? "—" : `${pct} %`;
}
