// Characters of WoW Forever are called "first last" in one text. Shown as a whole up to
// MAX_FULL_LENGTH characters ("Aldric Sturmwind" has just that), longer the last name shrinks to
// its first letter ("Konstantinos M."). Display only: stored names and comparisons stay as they are.

const MAX_FULL_LENGTH = 16;

/** A long name of two parts with its last name shortened; everything else unchanged. */
export function shortCharacterName(name: string): string {
    if (!name || [...name].length <= MAX_FULL_LENGTH) return name;
    const parts = name.trim().split(/\s+/);
    if (parts.length < 2) return name;
    const [initial] = [...parts[parts.length - 1]];
    return `${parts.slice(0, -1).join(" ")} ${initial}.`;
}

/** The name for a line of a raid: shortened only where characters have a last name. */
export function shownCharacterName(name: string, lastNames: boolean | undefined): string {
    return lastNames ? shortCharacterName(name) : name;
}
