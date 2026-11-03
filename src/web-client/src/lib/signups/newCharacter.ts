// A signup without a character of the raid's version (#907): the three picks
// of the dialog (class -> spec -> name) and when they are complete.

export type NewCharacter = { classId: string; spec: string; name: string };

/** A Discord name as a WoW name: letters only, at most 12 — the member may still change it. */
export function nameFromAccount(account: string): string {
    return Array.from(account.replace(/[^\p{L}]/gu, "")).slice(0, 12).join("");
}

/** `lastName`: the raid's version wants "Vorname Nachname" (WoW Forever); the server checks the name rule itself. */
export function newCharacterReady(pick: NewCharacter, lastName = false): boolean {
    if (!pick.classId || !pick.spec) return false;
    const parts = pick.name.trim().split(/\s+/);
    return lastName ? parts.length === 2 && parts.every((p) => p.length >= 2) : pick.name.trim().length >= 2;
}
