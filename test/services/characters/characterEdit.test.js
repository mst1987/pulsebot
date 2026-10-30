// Einen Charakter bearbeiten und alles nachziehen, was am alten Namen hing
// (services/characters/characterEdit.js): Roster, Kategorie-Zuordnung ohne
// Roster, Anmeldungen der Version, offene Gildenbank-Anfragen, Anwesenheiten.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());

const fs = require("fs");
const profiles = require("../../../src/stores/roster/raiderProfileStore");
const rosterStore = require("../../../src/stores/roster/rosterStore");
const raiderCharactersStore = require("../../../src/stores/roster/raiderCharactersStore");
const signupStore = require("../../../src/stores/events/signupStore");
const guildBankStore = require("../../../src/stores/loot/guildBankStore");
const availabilityStore = require("../../../src/stores/events/availabilityStore");
const { editProfileCharacter } = require("../../../src/services/characters/characterEdit");

const A = "100000000000000001";
const NOW = "2026-10-13T18:00:00.000Z";

beforeEach(() => fs.__store.clear());

function setUp() {
    profiles.addCharacter(A, { name: "Gentle", className: "Druid", source: "manual", specs: ["Druid-Restoration"] });
    const roster = rosterStore.createRoster({ name: "Mo", versionId: "tbc" }, { now: NOW });
    rosterStore.upsertMember(roster.id, A, { chars: ["Gentle"] }, { now: NOW });
    raiderCharactersStore.setCategoryAssignments("ohne-roster", { [A]: "Gentle" });
    signupStore.saveSignup("eh-1", A, { character: "Gentle", spec: "Druid-Restoration" });
    const request = guildBankStore.addRequest({ userId: A, userName: "Anna", categoryId: "c", item: "Trank", amount: 1 }, { now: Date.now() }).request;
    guildBankStore.setRecipientName(request.id, { characterName: "Gentle" });
    const entry = availabilityStore.addEntry({ userId: A, kind: "presence", from: "2030-01-01", to: "2030-01-02", character: "Gentle", spec: "Druid-Restoration", versionId: "tbc" }).entry;
    return { rosterId: roster.id, requestId: request.id, entryId: entry.id };
}

describe("services/characters/characterEdit", () => {
    it("benennt um und zieht Roster, Zuordnung, Anmeldungen, Gildenbank und Anwesenheit nach", () => {
        const { rosterId, requestId, entryId } = setUp();
        const res = editProfileCharacter(A, "gentle", { name: "Blattwerk" }, { actor: "9" });

        expect(res.character).toMatchObject({ key: "blattwerk", name: "Blattwerk" });
        expect(res.moved).toEqual({ rosters: 1, assignments: 1, signups: 1, guildBank: 1, availability: 1 });
        expect(rosterStore.getRoster(rosterId).members[A].chars).toEqual(["blattwerk"]);
        expect(raiderCharactersStore.getCategoryAssignments("ohne-roster")).toEqual({ [A]: "Blattwerk" });
        expect(signupStore.getSignup("eh-1", A).character).toBe("Blattwerk");
        expect(guildBankStore.getRequest(requestId).characterName).toBe("Blattwerk");
        expect(availabilityStore.getEntry(entryId).character).toBe("Blattwerk");
    });

    it("ohne neuen Namen zieht nichts nach", () => {
        setUp();
        const res = editProfileCharacter(A, "gentle", { realm: "Thunderstrike" });
        expect(res.renamed).toBeNull();
        expect(res.moved).toBeNull();
        expect(signupStore.getSignup("eh-1", A).character).toBe("Gentle");
    });

    it("reicht einen Fehler des Stores durch und ändert nichts", () => {
        setUp();
        expect(editProfileCharacter(A, "gentle", { name: "X1" })).toMatchObject({ code: "bad_name" });
        expect(signupStore.getSignup("eh-1", A).character).toBe("Gentle");
    });
});
