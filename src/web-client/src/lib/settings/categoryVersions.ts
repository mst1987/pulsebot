// A fixed version per raid category (#738): the rules the Spielversion
// section and the save bar share. Every active category plays one version; a
// category switched on just now starts with the main version and is written
// on save (the server refuses an active category without one). Changing the
// version of a category that was already active is a switch — a new section —
// and goes through the confirmation dialog first.

export type SwitchFix = { series: string };

/** The version a category's row shows: its own, else the main version (a category switched on just now). */
export function categoryVersionOf(map: Record<string, string>, id: string, mainVersion: string): string {
    return map[id] || mainVersion;
}

/** The map the save sends: every active category with a version, the rest as they were. */
export function categoryVersionsToSave(map: Record<string, string>, activeIds: string[], mainVersion: string): Record<string, string> {
    const out: Record<string, string> = Object.fromEntries(Object.entries(map).filter(([, id]) => id));
    for (const id of activeIds) if (!out[id]) out[id] = mainVersion;
    return out;
}

/**
 * The version a saved category plays, "" for one not active when the page was
 * loaded (it gets its first version, no section starts).
 */
export function savedCategoryVersion(saved: { categoryIds?: string[]; categoryVersion?: Record<string, string>; mainVersion?: string }, id: string): string {
    if (!(saved.categoryIds || []).includes(id)) return "";
    return (saved.categoryVersion || {})[id] || saved.mainVersion || "tbc";
}

/** Whether picking `versionId` for a category is a switch that needs the dialog. */
export function isVersionSwitch(saved: Parameters<typeof savedCategoryVersion>[0], id: string, versionId: string): boolean {
    const was = savedCategoryVersion(saved, id);
    return !!was && was !== versionId;
}

/** The dialog's choices to send: only for categories the draft really switches, and only a real choice. */
export function switchFixesToSend(
    fixes: Record<string, SwitchFix>,
    saved: Parameters<typeof savedCategoryVersion>[0],
    draftMap: Record<string, string>,
): Record<string, SwitchFix> {
    return Object.fromEntries(Object.entries(fixes).filter(([id, fix]) => !!fix.series && !!draftMap[id] && isVersionSwitch(saved, id, draftMap[id])));
}
