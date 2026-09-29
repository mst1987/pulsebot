// Characters per game version (#543): a raider plays TBC and WoW Forever side
// by side. The profile groups its characters by version, the signup dialog
// offers only the event's, roster and history filter by it — the main version
// first everywhere.

/** A version as the pages name it. */
export type VersionRef = { id: string; label: string; short?: string };

/** What every character stored before versions is. */
export const LEGACY_VERSION = "tbc";

/** The version of a character, TBC when it carries none. */
export function versionOf(c: { versionId?: string }): string {
    return c.versionId || LEGACY_VERSION;
}

export type VersionGroup<T> = { id: string; label: string; characters: T[] };

/**
 * Characters grouped by version: the main version first, then the order the
 * server lists the versions in, then any version it did not name. Empty groups
 * are left out; the characters keep their order inside a group.
 */
export function groupByVersion<T extends { versionId?: string }>(characters: T[], versions: VersionRef[], mainVersion = ""): VersionGroup<T>[] {
    const byId = new Map<string, T[]>();
    for (const c of characters) {
        const id = versionOf(c);
        if (!byId.has(id)) byId.set(id, []);
        byId.get(id)!.push(c);
    }
    const order = [mainVersion, ...versions.map((v) => v.id), ...byId.keys()].filter((id, i, all) => id && all.indexOf(id) === i);
    return order
        .filter((id) => byId.has(id))
        .map((id) => {
            const v = versions.find((x) => x.id === id);
            return { id, label: (v && (v.short || v.label)) || id, characters: byId.get(id)! };
        });
}

/** The characters of one version — what a signup for an event of that version may pick. "" = all. */
export function charactersOfVersion<T extends { versionId?: string }>(characters: T[], versionId: string): T[] {
    return versionId ? characters.filter((c) => versionOf(c) === versionId) : characters;
}
