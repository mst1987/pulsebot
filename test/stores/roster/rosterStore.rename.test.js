// Ein Charakter wird umbenannt (rosterStore.renameMemberChar): jedes Roster,
// das ihn beim Raider führt, auch ein abgeschlossenes, trägt den neuen Schlüssel
// und Namen an seiner Stelle.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());

const fs = require("fs");
const rosterStore = require("../../../src/stores/roster/rosterStore");

const A = "100000000000000001";
const B = "100000000000000002";
const NOW = "2026-10-13T18:00:00.000Z";

beforeEach(() => fs.__store.clear());

function rosterWith(name, members, { multi = false } = {}) {
    const r = rosterStore.createRoster({ name, versionId: "tbc", allowMultipleChars: multi }, { now: NOW });
    for (const [uid, chars] of Object.entries(members)) rosterStore.upsertMember(r.id, uid, { chars }, { now: NOW });
    return r.id;
}

describe("stores/roster/rosterStore renameMemberChar", () => {
    it("ersetzt Schlüssel und Namen an derselben Stelle, in offenen und abgeschlossenen Rostern", () => {
        const open = rosterWith("Mo", { [A]: ["Nerathil", "Gentle"], [B]: ["Gentle"] }, { multi: true });
        const closed = rosterWith("Alt", { [A]: ["Gentle"] });
        rosterStore.upsertMember(open, A, { spec: "Druid-Restoration" }, { now: NOW });
        rosterStore.closeRoster(closed, { now: NOW });

        expect(rosterStore.renameMemberChar(A, "gentle", "blattwerk", "Blattwerk", { actor: "9", now: NOW })).toBe(2);

        const m = rosterStore.getRoster(open).members[A];
        expect(m.chars).toEqual(["nerathil", "blattwerk"]);
        expect(m.charNames).toEqual({ nerathil: "Nerathil", blattwerk: "Blattwerk" });
        expect(rosterStore.getRoster(closed).members[A].chars).toEqual(["blattwerk"]);
        // another raider's "Gentle" is not his
        expect(rosterStore.getRoster(open).members[B].chars).toEqual(["gentle"]);
        expect(rosterStore.getRoster(open).history.at(-1)).toMatchObject({ by: "9", userId: A, what: "member", detail: "char gentle → blattwerk" });
    });

    it("nur die Schreibweise: Schlüssel bleibt, der angezeigte Name wird neu", () => {
        const id = rosterWith("Mo", { [A]: ["gentle"] });
        expect(rosterStore.renameMemberChar(A, "gentle", "gentle", "Gentle", { now: NOW })).toBe(1);
        expect(rosterStore.getRoster(id).members[A]).toMatchObject({ chars: ["gentle"], charNames: { gentle: "Gentle" } });
    });

    it("tut nichts ohne passenden Charakter oder mit leeren Angaben", () => {
        rosterWith("Mo", { [A]: ["Nerathil"] });
        expect(rosterStore.renameMemberChar(A, "gentle", "blattwerk", "Blattwerk")).toBe(0);
        expect(rosterStore.renameMemberChar("", "nerathil", "x", "X")).toBe(0);
        expect(rosterStore.renameMemberChar(A, "nerathil", "x", "")).toBe(0);
    });
});
