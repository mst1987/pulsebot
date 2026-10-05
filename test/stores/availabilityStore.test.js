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
        store.setPanel({ categoryId: "cat1", guildId: "g", channelId: "c2", messageId: "m2", postedBy: "u", hash: "abc" }, { now: 2 });
        expect(store.listPanels()).toEqual([{ categoryId: "cat1", guildId: "g", channelId: "c2", messageId: "m2", postedBy: "u", postedAt: 2, hash: "abc" }]);
        expect(store.getPanel("cat1").messageId).toBe("m2");
        // a redraw only changes the fingerprint
        expect(store.markPanelDrawn("cat1", "def")).toBe(true);
        expect(store.getPanel("cat1")).toMatchObject({ messageId: "m2", postedAt: 2, hash: "def" });
        expect(store.markPanelDrawn("cat9", "x")).toBe(false);
        expect(store.removePanel("cat1").messageId).toBe("m2");
        expect(store.removePanel("cat1")).toBeNull();
        expect(store.getPanel("cat1")).toBeNull();
    });
});

describe("Links des Organizers", () => {
    const link = (label = "WCL", url = "https://www.warcraftlogs.com/x") => ({ label, url });
    beforeEach(() => {
        for (const id of Object.keys(store.listLinks())) store.setLinks(id, []);
    });

    it("prüft die Links: Grenzen, Text, Adresse", () => {
        expect(store.MAX_LINKS).toBe(5);
        expect(store.LINK_LABEL_MAX).toBe(40);
        expect(store.checkLinks([link(), link("Sheet", "http://example.com/a")])).toEqual({ value: [link(), link("Sheet", "http://example.com/a")] });
        expect(store.checkLinks(Array.from({ length: 6 }, (_, i) => link(`L${i}`))).error).toBe("Höchstens 5 Links je Kategorie.");
        expect(store.checkLinks([link("", "https://x.example")]).error).toBe("Der Link „https://x.example“ braucht einen Text.");
        expect(store.checkLinks([link("a".repeat(41))]).error).toBe(`„${"a".repeat(41)}“ ist zu lang (höchstens 40 Zeichen).`);
        expect(store.checkLinks([link("a".repeat(40))]).value).toHaveLength(1);
        expect(store.checkLinks([link("Ohne Adresse", "")]).error).toBe("„Ohne Adresse“ braucht eine Adresse mit https://.");
        for (const url of ["ftp://x.example", "javascript:alert(1)", "www.x.example", "https://x .example", "https://"]) {
            expect(store.checkLinks([link("Bad", url)]).error).toBe("„Bad“ braucht eine Adresse mit https://.");
        }
    });

    it("schneidet Text und Adresse zu und lässt ganz leere Zeilen weg", () => {
        expect(store.checkLinks([{ label: "  Info  ", url: "  https://x.example  " }, { label: " ", url: "" }, null, {}])).toEqual({ value: [{ label: "Info", url: "https://x.example" }] });
        expect(store.checkLinks(undefined)).toEqual({ value: [] });
        expect(store.checkLinks("kaputt")).toEqual({ value: [] });
    });

    it("zählt beim Text Zeichen, nicht UTF-16-Einheiten", () => {
        expect(store.checkLinks([link("🔥".repeat(40))]).value).toHaveLength(1);
        expect(store.checkLinks([link("🔥".repeat(41))]).error).toContain("zu lang");
    });

    it("speichert die Links je Kategorie und liest sie in Reihenfolge", () => {
        expect(store.getLinks("cat1")).toEqual([]);
        expect(store.setLinks("cat1", [link("B"), link("A", "https://a.example")])).toEqual({ links: [link("B"), link("A", "https://a.example")] });
        store.setLinks("cat2", [link("C", "https://c.example")]);
        expect(store.getLinks("cat1").map((l) => l.label)).toEqual(["B", "A"]);
        expect(store.listLinks()).toEqual({ cat1: [link("B"), link("A", "https://a.example")], cat2: [link("C", "https://c.example")] });
    });

    it("ersetzt die Links einer Kategorie und entfernt sie mit einer leeren Liste", () => {
        store.setLinks("cat1", [link()]);
        store.setLinks("cat1", [link("Neu", "https://neu.example")]);
        expect(store.getLinks("cat1")).toEqual([link("Neu", "https://neu.example")]);
        expect(store.setLinks("cat1", [])).toEqual({ links: [] });
        expect(store.getLinks("cat1")).toEqual([]);
        expect(store.listLinks()).toEqual({});
        // a list of empty rows counts as empty, too
        store.setLinks("cat1", [link()]);
        store.setLinks("cat1", [{ label: "", url: "" }]);
        expect(store.listLinks()).toEqual({});
    });

    it("sagt Fehler und speichert dann nichts, auch ohne Kategorie", () => {
        store.setLinks("cat1", [link()]);
        expect(store.setLinks("cat1", [link("", "https://x.example")]).error).toContain("braucht einen Text");
        expect(store.getLinks("cat1")).toEqual([link()]);
        expect(store.setLinks("", [link()])).toEqual({ error: "Keine Kategorie gewählt." });
        expect(store.setLinks(undefined, [link()]).error).toBe("Keine Kategorie gewählt.");
        expect(store.listLinks()).toEqual({ cat1: [link()] });
    });

    it("behält die Links, wenn das Panel neu gepostet oder entfernt wird", () => {
        store.setLinks("cat1", [link()]);
        store.setPanel({ categoryId: "cat1", guildId: "g", channelId: "c1", messageId: "m1" });
        store.setPanel({ categoryId: "cat1", guildId: "g", channelId: "c2", messageId: "m2" });
        store.markPanelDrawn("cat1", "h");
        expect(store.getLinks("cat1")).toEqual([link()]);
        store.removePanel("cat1");
        expect(store.getLinks("cat1")).toEqual([link()]);
    });

    it("liefert Kopien, die den Store nicht verändern", () => {
        store.setLinks("cat1", [link()]);
        store.getLinks("cat1")[0].label = "geändert";
        expect(store.getLinks("cat1")[0].label).toBe("WCL");
    });
});
