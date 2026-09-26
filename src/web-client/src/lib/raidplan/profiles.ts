import type { RaidplanBoard, RaidplanBoss, RaidplanProfile, RaidplanAssignType } from "../../api";
import { t } from "../../i18n";
import { boardOf, newRowId } from "./model";
import { objectCount } from "./objects";

/**
 * The board after a profile was applied: its rows replace the board's rows, the
 * note comes along, `profileId` remembers where they came from. Players assigned
 * to a row whose title the profile keeps (ignoring case) stay assigned; tokens,
 * slots, marks and zones are not touched.
 */
export function applyProfile(board: RaidplanBoard, profile: RaidplanProfile): RaidplanBoard {
    const own = board.assignments.filter((a) => a.type === "other");
    const kept = new Map(own.map((a) => [a.title.trim().toLowerCase(), a]));
    const rows = profile.targets.map((r) => {
        const old = kept.get(r.title.trim().toLowerCase());
        return old ? { ...old, title: r.title } : { id: newRowId(), type: "other" as RaidplanAssignType, title: r.title, spell: null, assignees: [], targets: [], note: "", suggested: false };
    });
    return { ...board, assignments: [...board.assignments.filter((a) => a.type !== "other"), ...rows], notes: profile.notes || board.notes, profileId: profile.id };
}

/** The rows of a board as a profile stores them: the titles of its assignments, no players. */
export function profileRows(board: RaidplanBoard): { title: string }[] {
    return board.assignments.map((a) => ({ title: a.title.trim() })).filter((r) => r.title);
}

/** The profiles that fit a boss: made for every boss, for its instance, or for exactly this boss. */
export function profilesFor(profiles: RaidplanProfile[], bossKey: string): RaidplanProfile[] {
    const instance = bossKey.split("/")[0];
    return profiles.filter((p) => !p.bossKey || p.bossKey === bossKey || p.bossKey === instance);
}

/** Profiles matching a search text (name or category), grouped by category; "no category" comes last. */
export function groupProfiles(profiles: RaidplanProfile[], query: string): { category: string; profiles: RaidplanProfile[] }[] {
    const q = query.trim().toLowerCase();
    const hits = profiles.filter((p) => !q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
    const groups = new Map();
    for (const p of hits) {
        if (!groups.has(p.category)) groups.set(p.category, []);
        groups.get(p.category).push(p);
    }
    const out = [...groups.entries()].map(([category, list]) => ({ category, profiles: list }));
    return out.sort((a, b) => {
        if (!a.category !== !b.category) return a.category ? -1 : 1;
        return a.category.localeCompare(b.category);
    });
}

/** How many objects and rows a boss holds — the small dot next to it in the boss list. */
export function boardCount(bosses: Record<string, Partial<RaidplanBoard>>, key: string): number {
    const b = boardOf(bosses, key);
    return objectCount(b) + (b.assignments || []).length + (b.steps || []).length;
}

/** Whether a section (boss, trash, Allgemein) comes with the shared sheet: every one does unless its board says inSheet: false. */
export function sheetIncluded(bosses: Record<string, Partial<RaidplanBoard>>, key: string): boolean {
    const b = bosses[key];
    return !b || b.inSheet !== false;
}

/** The sections the sheet-quick-actions put IN, by mode: "all", "none", "bosses" (no trash, no Allgemein), "noTrash" (everything but the trash). */
export function sheetKeysFor(sections: RaidplanBoss[], mode: string): string[] {
    const keep = (b: RaidplanBoss) => (mode === "all" ? true : mode === "none" ? false : mode === "bosses" ? !b.trash && !b.general : !b.trash);
    return sections.filter(keep).map((b) => b.key);
}

/**
 * The name a section carries in the section bar (editor, template editor and sheet alike): a boss by its name, "Allgemein", "Standard",
 * and a trash section by its instance when the plan covers several ("Trash · Black Temple") - so every chip says what it is.
 */
export function sectionLabel(b: { name: string; trash?: boolean; general?: boolean; defaults?: boolean; instanceName?: string }, severalInstances: boolean): string {
    if (b.defaults) return t("raidBoard.defaults.title");
    if (b.general) return t("raidBoard.assign.general");
    if (b.trash) return severalInstances && b.instanceName ? `${t("raidBoard.assign.trash")} · ${b.instanceName}` : t("raidBoard.assign.trash");
    return b.name;
}

/** Whether a plan's sections come from more than one instance (then a trash chip names its instance). */
export function severalInstances(bosses: { key?: string; instanceId?: string; general?: boolean; defaults?: boolean }[]): boolean {
    const ids: string[] = [];
    // the sheet's sections carry no instanceId: their key starts with it ("bt/supremus")
    for (const b of bosses) { const id = b.instanceId || (b.key && b.key.indexOf("/") > 0 ? b.key.split("/")[0] : ""); if (!b.general && !b.defaults && id && ids.indexOf(id) < 0) ids.push(id); }
    return ids.length > 1;
}
