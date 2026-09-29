import type { Catalog, CatalogMob, CatalogSpell } from "../../api";

// The raid plan per game version (#544): the catalog, the raid plan templates and the tactic profiles each belong to
// one or more game versions; a plan only offers what belongs to its own. The server filters the catalog of a plan
// (catalogView(versionId)); these helpers do the same on the pages that list everything (the catalog page, the
// template list, the pickers).

/** The version an old record without one belongs to: everything was TBC before #544 (the server migrates it once). */
export const LEGACY_VERSION = "tbc";

/** Whether a catalog entry exists in a game version (the server's inVersion: no `versions` = every version, no version asked = all). */
export function inVersion(entry: { versions?: string[] }, versionId: string): boolean {
    return !versionId || !Array.isArray(entry.versions) || entry.versions.length === 0 || entry.versions.indexOf(versionId) >= 0;
}

/** The mobs and spells of one game version. */
export function catalogOfVersion<C extends Catalog>(catalog: C, versionId: string): { mobs: CatalogMob[]; spells: CatalogSpell[] } {
    return { mobs: catalog.mobs.filter((m) => inVersion(m, versionId)), spells: catalog.spells.filter((s) => inVersion(s, versionId)) };
}

/** The records (templates, tactic profiles) of one game version. */
export function ofVersion<T extends { versionId?: string }>(list: T[], versionId: string): T[] {
    return list.filter((x) => (x.versionId || LEGACY_VERSION) === versionId);
}

/** The templates an event is offered: its own version's first, the others apart (applying one of those asks first). */
export function splitByVersion<T extends { versionId?: string }>(list: T[], versionId: string): { own: T[]; other: T[] } {
    const own = ofVersion(list, versionId);
    return { own, other: list.filter((x) => own.indexOf(x) < 0) };
}

/**
 * The version chips of the catalog form: the known game versions, plus a version an entry names that the rule sets do
 * not know (Tricks of the Trade's "wotlk"), so saving never drops it unseen.
 */
export function versionChips(known: { id: string; short: string }[], chosen: string[]): { id: string; label: string }[] {
    const out = known.map((v) => ({ id: v.id, label: v.short }));
    for (const v of chosen) if (!out.some((o) => o.id === v)) out.push({ id: v, label: versionLabel([], v) });
    return out;
}

/**
 * The short name of a version for a chip ("TBC", "Forever"): the rule set's when it is known, else from the id (a short
 * one in capitals, "tbc" -> "TBC"; a longer one capitalised, "forever" -> "Forever").
 */
export function versionLabel(known: { id: string; short: string }[], id: string): string {
    const hit = known.find((v) => v.id === id);
    if (hit) return hit.short;
    return id.length <= 3 ? id.toUpperCase() : id.charAt(0).toUpperCase() + id.slice(1);
}
