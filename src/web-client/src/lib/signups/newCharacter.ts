// A signup without a character of the raid's version (#907): the three picks
// of the dialog (class -> spec -> name) and when they are complete.

export type NewCharacter = { classId: string; spec: string; name: string };

/** A Discord name as a WoW name: letters only, at most 12 — the member may still change it. */
export function nameFromAccount(account: string): string {
    return Array.from(account.replace(/[^\p{L}]/gu, "")).slice(0, 12).join("");
}

export function newCharacterReady(pick: NewCharacter): boolean {
    return !!pick.classId && !!pick.spec && pick.name.trim().length >= 2;
}
