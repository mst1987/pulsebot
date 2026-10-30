// "Alle Charaktere": Zeilen, Filter, Austausch nach dem Speichern und die
// Meldung nach einer Umbenennung (lib/profile/allCharacters.ts).
import { describe, expect, it } from "vitest";
import type { CharacterOwner, ProfileCharacter } from "../../../api";
import { t } from "../../../i18n";
import { characterRows, editToast, filterRows, replaceRaider, unverified } from "../allCharacters";

function char(over: Partial<ProfileCharacter>): ProfileCharacter {
    return {
        key: "x", name: "X", versionId: "tbc", realm: "", className: "Mage", source: "manual", armory: null, armoryUrl: "",
        evidence: { verified: true, via: "log" }, specs: [], canOfftank: false, canHeal: false,
        suggested: { canOfftank: false, canHeal: false }, possible: { canOfftank: false, canHeal: true }, claimedBy: [],
        ...over,
    };
}

const ANNA: CharacterOwner = { userId: "u1", name: "Anna", characters: [char({ key: "gentle", name: "Gentle", evidence: { verified: false, via: "" } }), char({ key: "nera", name: "Nera", realm: "Thunderstrike" })] };
const BERT: CharacterOwner = { userId: "u2", name: "Bert", characters: [char({ key: "forever~bo res", name: "Bo Res", versionId: "forever" })] };

describe("lib/profile/allCharacters", () => {
    it("macht aus jedem Charakter jedes Raiders eine Zeile", () => {
        expect(characterRows([ANNA, BERT]).map((r) => `${r.owner}:${r.character.name}`)).toEqual(["Anna:Gentle", "Anna:Nera", "Bert:Bo Res"]);
    });

    it("filtert nach Suche (Charakter, Raider, Realm), Version und „nur ungeprüfte“", () => {
        const rows = characterRows([ANNA, BERT]);
        const names = (f: Parameters<typeof filterRows>[1]) => filterRows(rows, f).map((r) => r.character.name);
        const none = { search: "", version: "", onlyUnverified: false };
        expect(names({ ...none, search: "bert" })).toEqual(["Bo Res"]);
        expect(names({ ...none, search: "THUNDER" })).toEqual(["Nera"]);
        expect(names({ ...none, version: "forever" })).toEqual(["Bo Res"]);
        expect(names({ ...none, onlyUnverified: true })).toEqual(["Gentle"]);
        expect(unverified(char({ evidence: undefined }))).toBe(false);
    });

    it("tauscht nach dem Speichern genau diesen Raider aus", () => {
        const next = { ...ANNA, characters: [] };
        expect(replaceRaider([ANNA, BERT], next)).toEqual([next, BERT]);
        expect(replaceRaider([BERT], next)).toEqual([BERT, next]);
    });

    it("sagt nach dem Speichern, was mit dem neuen Namen mitkam", () => {
        expect(editToast("Gentle", null, null)).toBe(t("profile.edit.saved"));
        expect(editToast("Gentle", "Gentle", null)).toBe(t("profile.edit.saved"));
        expect(editToast("Gentle", "Blattwerk", { rosters: 0, assignments: 0, signups: 0, guildBank: 0, availability: 0 }))
            .toBe(t("profile.edit.renamed", { from: "Gentle", to: "Blattwerk" }));
        expect(editToast("Gentle", "Blattwerk", { rosters: 1, assignments: 0, signups: 3, guildBank: 0, availability: 0 }))
            .toBe("Gentle heißt jetzt Blattwerk – mitgenommen: 1 Roster, 3 Anmeldungen.");
    });
});
