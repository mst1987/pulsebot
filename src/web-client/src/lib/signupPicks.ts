// Several own characters per signup (#293), the dialog's side: which characters
// · specs are picked, in which order — the first is the choice, the others
// "kann auch mit". The server checks every pick again (signupService.js); these
// rules only keep the dialog from offering what cannot work.
//
// Written to be strippable like setupEditor.ts (test/web-client/signupsPage.test.js
// runs it for real): `import type`, `export type` and one-line signatures only.
import type { OwnSignup, SignupProfile, SignupProfileCharacter } from "../api";

/** The same limit as the server's (signupCharacters.MAX_CHARACTERS). */
export const MAX_CHARACTERS = 3;

export type CharacterPick = { characterKey: string; spec: string };

/** A character's spec to start with: the first one with usable gear, else the first. */
export function firstSpec(character: SignupProfileCharacter | undefined): string {
    if (!character || !character.specs.length) return "";
    const geared = character.specs.find((s) => s.gear !== "none");
    return (geared || character.specs[0]).key;
}

/** The picks a dialog opens with: the stored characters that still fit the profile, else the main. */
export function initialPicks(profile: SignupProfile, mine: OwnSignup | null): CharacterPick[] {
    const out = [];
    const stored = mine && mine.characters && mine.characters.length ? mine.characters : (mine && mine.spec ? [{ character: mine.character, spec: mine.spec }] : []);
    for (const c of stored) {
        const ch = profile.characters.find((x) => x.name.toLowerCase() === String(c.character || "").toLowerCase());
        if (!ch || !ch.specs.some((s) => s.key === c.spec) || out.some((p) => p.characterKey === ch.key)) continue;
        out.push({ characterKey: ch.key, spec: c.spec });
    }
    if (out.length) return out.slice(0, MAX_CHARACTERS);
    const main = profile.characters.find((c) => c.main && c.specs.length) || profile.characters.find((c) => c.specs.length);
    return main ? [{ characterKey: main.key, spec: firstSpec(main) }] : [];
}

/** Whether another character can be added: under the limit and one left that is not picked. */
export function canAddPick(profile: SignupProfile, picks: CharacterPick[]): boolean {
    return picks.length < MAX_CHARACTERS && profile.characters.some((c) => c.specs.length && !picks.some((p) => p.characterKey === c.key));
}

/** Add the next character that is not picked yet, with its first geared spec. */
export function addPick(profile: SignupProfile, picks: CharacterPick[]): CharacterPick[] {
    const next = picks.length < MAX_CHARACTERS ? profile.characters.find((c) => c.specs.length && !picks.some((p) => p.characterKey === c.key)) : undefined;
    if (!next) return picks;
    return [...picks, { characterKey: next.key, spec: firstSpec(next) }];
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

/** Another character for one pick: its first geared spec; a character picked twice stays only here. */
export function setPickCharacter(profile: SignupProfile, picks: CharacterPick[], index: number, characterKey: string): CharacterPick[] {
    const character = profile.characters.find((c) => c.key === characterKey);
    if (!character) return picks;
    const next = { characterKey, spec: firstSpec(character) };
    return picks.map((p, i) => (i === index ? next : p)).filter((p, i) => i === index || p.characterKey !== characterKey);
}

export function setPickSpec(picks: CharacterPick[], index: number, spec: string): CharacterPick[] {
    return picks.map((p, i) => (i === index ? { characterKey: p.characterKey, spec } : p));
}

/** The picks as the API takes them: character names and specs, only what the profile still has. */
export function picksToInput(profile: SignupProfile, picks: CharacterPick[]): { character: string; spec: string }[] {
    const out = [];
    for (const p of picks) {
        const ch = profile.characters.find((c) => c.key === p.characterKey);
        if (ch && ch.specs.some((s) => s.key === p.spec)) out.push({ character: ch.name, spec: p.spec });
    }
    return out;
}
