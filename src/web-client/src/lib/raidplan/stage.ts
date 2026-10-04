// The pure parts of the read view's stage (/p/<token>, "Karte als Bühne"): where a section sits in the plan, its neighbours
// for the bar's arrows, the sections grouped by instance for the section menu, and the visitor's group. No DOM, no React.
import type { RaidplanPlayer, RaidplanPublicBoss } from "../../api";

type Section = Pick<RaidplanPublicBoss, "key" | "instanceName" | "trash" | "general">;

/**
 * Where a section sits, for the bar's kicker: its instance and its number among that instance's bosses ("Boss 2 von 5").
 * Trash has an instance but no number, "Allgemein" has neither; an unknown key gives the empty place.
 */
export function sectionPlace(sections: Section[], key: string): { instance: string; index: number; count: number } {
    const b = sections.find((x) => x.key === key);
    if (!b || b.general) return { instance: "", index: 0, count: 0 };
    const bosses = sections.filter((x) => !x.general && !x.trash && x.instanceName === b.instanceName);
    return { instance: b.instanceName, index: b.trash ? 0 : bosses.indexOf(b) + 1, count: b.trash ? 0 : bosses.length };
}

/** The sections before and after `key` in `sections` (the shown ones: "Nur für mich" leaves some out); null at either end. */
export function neighbours<T extends { key: string }>(sections: T[], key: string): { prev: T | null; next: T | null } {
    const i = sections.findIndex((x) => x.key === key);
    if (i < 0) return { prev: null, next: null };
    return { prev: i > 0 ? sections[i - 1] : null, next: i < sections.length - 1 ? sections[i + 1] : null };
}

/**
 * The sections in runs of one instance, in plan order, for the section menu: "Allgemein" (no instance) is a run of its own.
 * A plan that comes back to an instance later gets a second run of it rather than reordering the plan.
 */
export function sectionGroups<T extends Section>(sections: T[]): { instance: string; items: T[] }[] {
    const runs: { instance: string; items: T[] }[] = [];
    for (const s of sections) {
        const instance = s.general ? "" : s.instanceName;
        const last = runs[runs.length - 1];
        if (last && last.instance === instance) last.items.push(s);
        else runs.push({ instance, items: [s] });
    }
    return runs;
}

/** The visitor's character in the plan (the first of `meIds` the roster holds) and its group (0 = none). */
export function myPlayer(roster: RaidplanPlayer[], meIds: string[]): { player: RaidplanPlayer | null; group: number } {
    for (const id of meIds) {
        const p = roster.find((r) => r.userId === id && !r.outOfPlan);
        if (p) return { player: p, group: p.group > 0 ? p.group : 0 };
    }
    return { player: null, group: 0 };
}
