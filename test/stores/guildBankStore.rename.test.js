// Ein Charakter wird umbenannt (guildBankStore.renameRecipient): offene
// Anfragen des Raiders für ihn gehen an den neuen Namen, erledigte nicht.
jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const store = require("../../src/stores/guildBankStore");

const NOW = Date.UTC(2026, 9, 13);

beforeEach(() => fs.__store.clear());

const add = (over = {}) => store.addRequest({ userId: "u1", userName: "Anna", categoryId: "cat1", item: "Super Mana Potion", amount: "10", ...over }, { now: NOW }).request;

describe("stores/guildBankStore renameRecipient", () => {
    it("benennt offene Anfragen um, nimmt die alte Prüfung weg und lässt erledigte und fremde stehen", () => {
        const open = add();
        store.setRecipientName(open.id, { characterName: "Gentle", realm: "Spineshatter", by: "9", checked: true }, { now: NOW });
        const done = add();
        store.setRecipientName(done.id, { characterName: "Gentle" }, { now: NOW });
        store.resolveRequest(done.id, { status: "done", by: "9" }, { now: NOW });
        const other = add({ userId: "u2" });
        store.setRecipientName(other.id, { characterName: "Gentle" }, { now: NOW });

        expect(store.renameRecipient("u1", "gentle", { characterName: "Blattwerk", realm: "Thunderstrike" })).toBe(1);

        const after = store.getRequest(open.id);
        expect(after).toMatchObject({ characterName: "Blattwerk", realm: "Thunderstrike", recipientCheckedAt: 0 });
        expect(store.getRequest(done.id).characterName).toBe("Gentle");
        expect(store.getRequest(other.id).characterName).toBe("Gentle");
    });

    it("ohne Realm bleibt der alte, ohne Treffer passiert nichts", () => {
        const r = add();
        store.setRecipientName(r.id, { characterName: "Gentle-Spineshatter", realm: "Spineshatter" }, { now: NOW });
        expect(store.renameRecipient("u1", "gentle", { characterName: "Blattwerk" })).toBe(1);
        expect(store.getRequest(r.id)).toMatchObject({ characterName: "Blattwerk", realm: "Spineshatter" });
        expect(store.renameRecipient("u1", "niemand", { characterName: "X" })).toBe(0);
        expect(store.renameRecipient("u1", "blattwerk", { characterName: "" })).toBe(0);
    });
});
