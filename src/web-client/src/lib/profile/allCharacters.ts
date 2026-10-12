import type { CharacterEditMoved, CharacterOwner, ProfileCharacter } from "../../api";
import { t } from "../../i18n";

// "Alle Charaktere" — the orga's tab on the profile page (pages/profile/
// AllCharactersTab.tsx): one row per character of every raider profile, a
// search over character, raider and realm, the game version and "nur
// ungeprüfte" as filters. Pure, so the list's rules are tested without a page.

export type CharacterRow = { userId: string; owner: string; character: ProfileCharacter };

export type CharacterFilter = { search: string; version: string; onlyUnverified: boolean };

/** Every character of every raider, one row each. */
export function characterRows(raiders: CharacterOwner[]): CharacterRow[] {
    return raiders.flatMap((r) => r.characters.map((character) => ({ userId: r.userId, owner: r.name, character })));
}

/** Whether nothing confirms the character exists in game (no log, loot, armory, orga). */
export function unverified(c: ProfileCharacter): boolean {
    return !!c.evidence && !c.evidence.verified;
}

/** The rows the filters let through. The search matches character, raider and realm, case-insensitively. */
export function filterRows(rows: CharacterRow[], f: CharacterFilter): CharacterRow[] {
    const q = f.search.trim().toLowerCase();
    return rows.filter((r) => (!f.version || (r.character.versionId || "tbc") === f.version)
        && (!f.onlyUnverified || unverified(r.character))
        && (!q || [r.character.name, r.owner, r.character.realm].some((s) => (s || "").toLowerCase().includes(q))));
}

/** The list after a write: that raider as the server answered, the others as they were. */
export function replaceRaider(raiders: CharacterOwner[], next: CharacterOwner): CharacterOwner[] {
    return raiders.some((r) => r.userId === next.userId) ? raiders.map((r) => (r.userId === next.userId ? next : r)) : [...raiders, next];
}

const MOVED_ORDER = ["rosters", "signups", "assignments", "guildBank", "availability"] as const;

/**
 * The toast after a save: "Gentle heißt jetzt Blattwerk" plus what came along
 * ("2 Anmeldungen, 1 Roster"), or the plain "gespeichert" when the name stayed.
 */
export function editToast(from: string, to: string | null, moved: CharacterEditMoved): string {
    if (!to || to === from) return t("profile.edit.saved");
    const parts = MOVED_ORDER.filter((k) => moved && moved[k] > 0).map((k) => t(`profile.edit.moved.${k}`, { count: moved ? moved[k] : 0 }));
    return parts.length
        ? t("profile.edit.renamedWith", { from, to, what: parts.join(", ") })
        : t("profile.edit.renamed", { from, to });
}
