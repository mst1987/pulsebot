// The row dialog of the assignments ("Zuweisungs-Modal", design "Variante B" of the Raidplan canvas), pure: which categories a slot of
// the assignment bar offers (who / at whom / task), what a category lists (role slots and players in ONE list, grouped tank / healer /
// DPS, with a search and filter tabs), which of its entries are chosen, the counters of the category navigation, the roles a class can
// play, and the lines of the "So sieht es im Sheet aus" preview. The dialog (pages/raid-detail/raidplan/AssignModal.tsx) only draws
// what this answers. Tested for real in test/web-client/assignModal.test.js; written with function declarations and one-line
// signatures only (strippable by the test helper).
import { SLOT_ORDER, classRefLabelFor, resolveAssignee, resolveTarget, slotChoices, type AssignCtx, type Resolved } from "./assign";
import { isClassRef } from "./classRefs";
import type { RaidplanAssignment, RaidplanPlayer, RaidplanSlot } from "../api";

/** The three slots of the assignment bar: who does it, at whom / what, and the task (text and spell). */
export const BAR_SLOTS = ["who", "at", "task"];
/** Every category of the navigation, in its order. */
export const CATEGORY_ORDER = ["people", "classes", "roles", "groups", "marks", "mobs", "spells", "text"];
/** The filter tabs of the people list. */
export const PEOPLE_TABS = ["all", "tank", "healer", "dps"];
/** The roles a class can play in TBC (the spec role of the setup; classes with one role have none to pick). */
export const CLASS_ROLE_CHOICES = { Warrior: ["tank", "dps"], Paladin: ["tank", "healer", "dps"], Druid: ["tank", "healer", "dps"], Priest: ["healer", "dps"], Shaman: ["healer", "dps"], Hunter: [], Rogue: [], Mage: [], Warlock: [] };

export type PeopleEntry = { key: string; kind: string; group: string; n: number; player: RaidplanPlayer | null; label: string };
export type PreviewLine = { who: Resolved; targets: Resolved[]; open: boolean; order: number };

/** The categories a slot of the bar offers: who = people and classes; at = people, groups, classes, marks, mobs (tanking and CC rows first), free text; task = the spells (when the type has any) and the free text. */
export function categoriesFor(slot: string, type: string, hasMobs: boolean, hasSpells: boolean): string[] {
    if (slot === "who") return ["people", "classes", "roles"];
    if (slot === "task") return hasSpells ? ["spells", "text"] : ["text"];
    const mobFirst = hasMobs && ["tank", "trashtank", "special", "cc", "kick", "dispel"].indexOf(type) >= 0;
    const out = mobFirst ? ["mobs", "people", "groups", "roles", "classes", "marks", "text"] : ["people", "groups", "roles", "classes", "marks", "mobs", "text"];
    return hasMobs ? out : out.filter((c) => c !== "mobs");
}

/** The category a slot opens with (its first). */
export function firstCategory(slot: string, type: string, hasMobs: boolean, hasSpells: boolean): string {
    return categoriesFor(slot, type, hasMobs, hasSpells)[0];
}

/** Which group of the people list a slot kind or a spec role belongs to: tank, healer, or dps (melee, ranged, dps). */
export function peopleGroupOf(kindOrRole: string): string {
    return kindOrRole === "tank" || kindOrRole === "healer" ? kindOrRole : "dps";
}

/**
 * The people list of a slot: `mode` "slot" = the role slots of the board (a slot reference follows whoever stands in it; the chip shows the
 * player's name when the slot is filled, else the slot), "player" = the raiders of the setup (a fixed player). Key: an assignee reference
 * (`slot:healer:2`, `user:<id>`) for "who", a target key (`slot|healer:2`, `player|<id>`) for "at". Sorted tank, healer, DPS; within a
 * group by slot number / setup order.
 */
export function peopleEntries(slots: RaidplanSlot[], roster: RaidplanPlayer[], mode: string, slot: string): PeopleEntry[] {
    const byId = {};
    for (const p of roster) byId[p.userId] = p;
    const out = [];
    if (mode === "player") {
        for (const p of roster) out.push({ key: slot === "who" ? `user:${p.userId}` : `player|${p.userId}`, kind: "player", group: peopleGroupOf(p.role), n: 0, player: p, label: p.character });
    } else {
        for (const s of slotChoices(slots)) {
            const at = slots.find((x) => x.kind === s.kind && x.n === s.n && x.userId);
            const player = at ? byId[at.userId] || null : null;
            out.push({ key: slot === "who" ? `slot:${s.ref}` : `slot|${s.ref}`, kind: s.kind, group: peopleGroupOf(s.kind), n: s.n, player, label: player ? player.character : "" });
        }
    }
    const order = ["tank", "healer", "dps"];
    return out.map((e, i) => ({ e, i })).sort((a, b) => order.indexOf(a.e.group) - order.indexOf(b.e.group) || (mode === "slot" ? SLOT_ORDER.indexOf(a.e.kind) - SLOT_ORDER.indexOf(b.e.kind) || a.e.n - b.e.n : a.i - b.i)).map((x) => x.e);
}

/** The people list filtered by a tab (all / tank / healer / dps) and a search (name, class, slot kind or number; case ignored). */
export function filterPeople(list: PeopleEntry[], tab: string, query: string): PeopleEntry[] {
    const q = query.trim().toLowerCase();
    return list.filter((e) => {
        if (tab && tab !== "all" && e.group !== tab) return false;
        if (!q) return true;
        const hay = [e.label, e.kind, String(e.n || ""), e.player ? e.player.className : "", e.player ? e.player.spec : ""].join(" ").toLowerCase();
        return hay.indexOf(q) >= 0;
    });
}

/** The people list split into its groups (tank, healer, dps), only the groups that have entries. */
export function peopleGroups(list: PeopleEntry[]): { group: string; entries: PeopleEntry[] }[] {
    const out = [];
    for (const g of ["tank", "healer", "dps"]) {
        const entries = list.filter((e) => e.group === g);
        if (entries.length > 0) out.push({ group: g, entries });
    }
    return out;
}

/** The chosen keys of a slot: who = the assignees, at = the targets as `kind|ref`, task = the spell id. */
export function chosenKeys(row: RaidplanAssignment, slot: string): string[] {
    if (slot === "who") return row.assignees.slice();
    if (slot === "at") return row.targets.map((t) => `${t.kind}|${t.ref}`);
    return row.spell ? [row.spell.id] : [];
}

/** The category a chosen key belongs to (for the counters of the navigation). */
export function categoryOfKey(slot: string, key: string): string {
    if (slot === "task") return "spells";
    if (slot === "who") return isClassRef(key) ? "classes" : key.indexOf("role:") === 0 ? "roles" : "people";
    const kind = key.slice(0, key.indexOf("|"));
    if (kind === "slot" || kind === "player") return "people";
    if (kind === "group") return "groups";
    if (kind === "role") return "roles";
    if (kind === "class") return "classes";
    if (kind === "mark") return "marks";
    if (kind === "mob") return "mobs";
    return "text";
}

/** How many entries of each category the slot holds (the counters of the navigation). */
export function chosenCounts(row: RaidplanAssignment, slot: string): Record<string, number> {
    const out = {};
    for (const k of chosenKeys(row, slot)) {
        const c = categoryOfKey(slot, k);
        out[c] = (out[c] || 0) + 1;
    }
    if (slot === "task" && row.title) out["text"] = 1;
    return out;
}

/** How many raiders of a class the raid has for a role filter (the small number on a class tile; "" = any spec, "tank" = its tanks ...). */
export function classCount(roster: RaidplanPlayer[], classId: string, role: string, roles: Record<string, string>): number {
    let n = 0;
    for (const p of roster) {
        if (classId !== "Any" && p.classId !== classId) continue;
        const r = (roles || {})[p.userId] || p.role;
        if (!role || (role === "dps" ? r !== "tank" && r !== "healer" : r === role)) n += 1;
    }
    return n;
}

/**
 * The lines of the preview ("So sieht es im Sheet aus"): one line per assignee of the row as it resolves now (`filled`: the row with its
 * class references resolved, same order as `row`), each with the targets. A line is `open` when nobody fills the place - that is the one
 * mark it carries (no other badge). A kick rotation keeps its order (1, 2, 3).
 */
export function previewLines(row: RaidplanAssignment, filled: RaidplanAssignment, ctx: AssignCtx): PreviewLine[] {
    const targets = (filled.targets || row.targets).map((t) => resolveTarget(t, ctx));
    return row.assignees.map((ref, i) => {
        const r = resolveAssignee(filled.assignees[i] || ref, ctx);
        // an open class place is named as the row names it: "Magier-Tank 1" on a tanking row
        const who = r.kind === "class" ? { ...r, label: classRefLabelFor(r.ref, row.type) } : r;
        return { who, targets, open: who.open, order: i + 1 };
    });
}

/** The text of the preview line for screen readers and tests: "Pfeilchen -> Tankwart", an open place "Jäger 2 (offen) -> Tankwart". */
export function previewText(line: PreviewLine, openWord: string): string {
    const who = line.who.player ? line.who.player.character : `${line.who.label}${line.open ? ` (${openWord})` : ""}`;
    const at = line.targets.map((t) => (t.player ? t.player.character : t.label)).join(", ");
    return at ? `${who} -> ${at}` : who;
}

/** The slot that follows (Tab in the bar, "weiter"): who -> at -> task -> who. */
export function nextSlot(slot: string, dir: number): string {
    const i = BAR_SLOTS.indexOf(slot);
    return BAR_SLOTS[(i + (dir < 0 ? BAR_SLOTS.length - 1 : 1)) % BAR_SLOTS.length];
}
