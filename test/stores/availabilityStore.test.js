// Der Store der Ab-/Anwesenheiten und der Panels je Raid-Kategorie.
const store = require("../../src/stores/availabilityStore");
const { tempStoreFile } = require("../helpers/tempStore");

const ANNA = "200000000000000001";
const entry = (over = {}) => ({ userId: ANNA, kind: "absence", from: "2030-03-20", to: "2030-03-25", ...over });

beforeAll(() => store.useFile(tempStoreFile("eh-availability-store.json")));
afterAll(() => store.useFile(null));
beforeEach(() => {
    for (const e of store.listEntries()) store.removeEntry(e.id);
    for (const p of store.listPanels()) store.removePanel(p.categoryId);
});

describe("Einträge", () => {
    it("speichert einen Eintrag mit Id und leerem applied, sortiert nach Beginn", () => {
        const late = store.addEntry(entry({ from: "2030-04-01", to: "2030-04-02" })).entry;
        const early = store.addEntry(entry({ comment: "  Urlaub  " })).entry;
        expect(early).toMatchObject({ kind: "absence", comment: "Urlaub", applied: {}, skip: [] });
        expect(store.listEntries({ userId: ANNA }).map((e) => e.id)).toEqual([early.id, late.id]);
        expect(store.listEntries({ userId: "someone" })).toEqual([]);
    });

    it("lehnt unvollständige Einträge ab", () => {
        expect(store.addEntry(entry({ userId: "" })).error).toBe("Kein Raider.");
        expect(store.addEntry(entry({ kind: "x" })).error).toBe("Unbekannte Art – Abwesenheit oder Anwesenheit.");
        expect(store.addEntry(entry({ from: "20.03." })).error).toBe("Bitte ein gültiges Von- und Bis-Datum angeben.");
        expect(store.addEntry(entry({ to: "2030-03-01" })).error).toBe("Das Bis-Datum liegt vor dem Von-Datum.");
        expect(store.addEntry(entry({ kind: "presence" })).error).toBe("Für eine Anwesenheit bitte Charakter und Spec wählen.");
        expect(store.listEntries()).toEqual([]);
    });

    it("begrenzt die Einträge je Raider", () => {
        for (let i = 0; i < store.MAX_ENTRIES; i += 1) store.addEntry(entry());
        expect(store.addEntry(entry()).error).toBe(`Höchstens ${store.MAX_ENTRIES} Einträge – lösche zuerst einen alten.`);
        expect(store.addEntry(entry({ userId: "200000000000000002" })).entry).toBeTruthy();
    });

    it("markiert jeden Raid nur einmal je Eintrag", () => {
        const { id } = store.addEntry(entry()).entry;
        expect(store.markApplied(id, "eh-a", { ok: true }, { now: 5 })).toBe(true);
        expect(store.markApplied(id, "eh-a", { ok: false, error: "x" })).toBe(false);
        expect(store.markApplied(id, "eh-b", { ok: false, error: "Anmeldeschluss" }, { now: 6 })).toBe(true);
        expect(store.markApplied("missing", "eh-a")).toBe(false);
        expect(store.getEntry(id).applied).toEqual({ "eh-a": { at: 5, ok: true }, "eh-b": { at: 6, ok: false, error: "Anmeldeschluss" } });
    });

    it("entfernt Einträge und räumt lange vergangene weg", () => {
        const old = store.addEntry(entry({ from: "2030-01-01", to: "2030-01-02" })).entry;
        const recent = store.addEntry(entry({ from: "2030-03-01", to: "2030-03-02" })).entry;
        expect(store.prune("2030-03-20")).toBe(1);
        expect(store.prune("kaputt")).toBe(0);
        expect(store.listEntries().map((e) => e.id)).toEqual([recent.id]);
        expect(store.removeEntry(old.id)).toBeNull();
        expect(store.removeEntry(recent.id).id).toBe(recent.id);
    });
});

describe("Panels", () => {
    it("merkt sich je Kategorie ein Panel und ersetzt ein früheres", () => {
        store.setPanel({ categoryId: "cat1", guildId: "g", channelId: "c1", messageId: "m1" }, { now: 1 });
        store.setPanel({ categoryId: "cat1", guildId: "g", channelId: "c2", messageId: "m2", postedBy: "u" }, { now: 2 });
        expect(store.listPanels()).toEqual([{ categoryId: "cat1", guildId: "g", channelId: "c2", messageId: "m2", postedBy: "u", postedAt: 2 }]);
        expect(store.getPanel("cat1").messageId).toBe("m2");
        expect(store.removePanel("cat1").messageId).toBe("m2");
        expect(store.removePanel("cat1")).toBeNull();
        expect(store.getPanel("cat1")).toBeNull();
    });
});
