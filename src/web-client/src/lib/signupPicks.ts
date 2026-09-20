// Several own characters per signup (#293), the dialog's side: which characters
// · specs are picked, in which order — the first is the choice, the others
// "kann auch mit" — and, since #320, with which status each of them comes.
// The server checks every pick again (signupService.js); these rules only keep
// the dialog from offering what cannot work.
//
// A status per character is not a second signup: "Spät" on one character leaves
// the others where they are, exactly as the Discord buttons have done since
// #302 (signupCharacters.js). The signup's own status mirrors the first
// character's — signupStatusOf() is that rule — so a person still takes at most
// one seat.
//
// Written to be strippable like setupEditor.ts (test/web-client/signupsPage.test.js
// runs it for real): `import type`, `export type` and one-line signatures only.
import type { OwnSignup, SignupProfile, SignupProfileCharacter, SignupStatus } from "../api";

/** The same limit as the server's (signupCharacters.MAX_CHARACTERS). */
export const MAX_CHARACTERS = 3;

export type CharacterPick = { characterKey: string; spec: string; status?: SignupStatus };

/** A character's spec to start with: the first one with usable gear, else the first. */
export function firstSpec(character: SignupProfileCharacter | undefined): string {
    if (!character || !character.specs.length) return "";
    const geared = character.specs.find((s) => s.gear !== "none");
    return (geared || character.specs[0]).key;
}

/**
 * The picks a dialog opens with: the stored characters that still fit the
 * profile — each with the status it was stored with (#320) — else the main.
 * Without `status` the picks carry none at all, which is what the bulk dialog
 * wants: several raids share one status, so no character may bring its own.
 */
export function initialPicks(profile: SignupProfile, mine: OwnSignup | null, status?: SignupStatus): CharacterPick[] {
    const out = [];
    const stored = mine && mine.characters && mine.characters.length ? mine.characters : (mine && mine.spec ? [{ character: mine.character, spec: mine.spec, status: mine.status }] : []);
    for (const c of stored) {
        const ch = profile.characters.find((x) => x.name.toLowerCase() === String(c.character || "").toLowerCase());
        if (!ch || !ch.specs.some((s) => s.key === c.spec) || out.some((p) => p.characterKey === ch.key)) continue;
        out.push({ characterKey: ch.key, spec: c.spec, status: c.status && c.status !== "absence" ? c.status : status });
    }
    if (out.length) return out.slice(0, MAX_CHARACTERS);
    const main = profile.characters.find((c) => c.main && c.specs.length) || profile.characters.find((c) => c.specs.length);
    return main ? [{ characterKey: main.key, spec: firstSpec(main), status }] : [];
}

/** Whether another character can be added: under the limit and one left that is not picked. */
export function canAddPick(profile: SignupProfile, picks: CharacterPick[]): boolean {
    return picks.length < MAX_CHARACTERS && profile.characters.some((c) => c.specs.length && !picks.some((p) => p.characterKey === c.key));
}

/** Add the next character that is not picked yet, with its first geared spec and the first pick's status. */
export function addPick(profile: SignupProfile, picks: CharacterPick[]): CharacterPick[] {
    const next = picks.length < MAX_CHARACTERS ? profile.characters.find((c) => c.specs.length && !picks.some((p) => p.characterKey === c.key)) : undefined;
    if (!next) return picks;
    return [...picks, { characterKey: next.key, spec: firstSpec(next), status: picks[0]?.status }];
}

/** Move a pick up (-1) or down (+1); the order is the priority. */
export function movePick(picks: CharacterPick[], index: number, delta: number): CharacterPick[] {
    const to = index + delta;
    if (index < 0 || index >= picks.length || to < 0 || to >= picks.length) return picks;
    const out = picks.slice();
    const item = out[index];
    out[index] = out[to];
    out[to] = item;
    return out;
}

export function removePick(picks: CharacterPick[], index: number): CharacterPick[] {
    return picks.filter((_, i) => i !== index);
}

/** Another character for one pick: its first geared spec, its status kept; a character picked twice stays only here. */
export function setPickCharacter(profile: SignupProfile, picks: CharacterPick[], index: number, characterKey: string): CharacterPick[] {
    const character = profile.characters.find((c) => c.key === characterKey);
    if (!character) return picks;
    const next = { characterKey, spec: firstSpec(character), status: picks[index]?.status };
    return picks.map((p, i) => (i === index ? next : p)).filter((p, i) => i === index || p.characterKey !== characterKey);
}

export function setPickSpec(picks: CharacterPick[], index: number, spec: string): CharacterPick[] {
    return picks.map((p, i) => (i === index ? { characterKey: p.characterKey, spec, status: p.status } : p));
}

/** One character's own status — the others keep theirs (#320, like the Discord buttons since #302). */
export function setPickStatus(picks: CharacterPick[], index: number, status: SignupStatus): CharacterPick[] {
    return picks.map((p, i) => (i === index ? { characterKey: p.characterKey, spec: p.spec, status } : p));
}

/** Every character on the same status — what the dialog's big switch does. */
export function setAllStatuses(picks: CharacterPick[], status: SignupStatus): CharacterPick[] {
    return picks.map((p) => ({ characterKey: p.characterKey, spec: p.spec, status }));
}

/** The status every picked character shares, "" when they differ (then the big switch shows none as chosen). */
export function commonStatus(picks: CharacterPick[], fallback: SignupStatus): string {
    if (!picks.length) return fallback;
    const first = picks[0].status || fallback;
    return picks.every((p) => (p.status || fallback) === first) ? first : "";
}

/**
 * The signup's own status: an absence is for the whole person, otherwise the
 * first character's — the same rule the store applies (signupStore.normalizeSignup),
 * so the dialog never sends a top level the server would replace.
 */
export function signupStatusOf(picks: CharacterPick[], status: SignupStatus): SignupStatus {
    if (status === "absence" || !picks.length) return status;
    return picks[0].status || status;
}

/** The picks as the API takes them: character names, specs and each character's status. */
export function picksToInput(profile: SignupProfile, picks: CharacterPick[]): { character: string; spec: string; status?: SignupStatus }[] {
    const out = [];
    for (const p of picks) {
        const ch = profile.characters.find((c) => c.key === p.characterKey);
        if (!ch || !ch.specs.some((s) => s.key === p.spec)) continue;
        out.push(p.status ? { character: ch.name, spec: p.spec, status: p.status } : { character: ch.name, spec: p.spec });
    }
    return out;
}
