// Welche Raids ein Ab-/Anwesenheits-Eintrag abdeckt (src/services/signups/availabilityScope.js):
// Tag, Server + Kategorie, bei Anwesenheiten ein Charakter der Raid-Version - und Alt-Einträge.

let mockConfig = {};
jest.mock("../../../src/stores/settings/settingsStore", () => ({ getConfig: () => mockConfig }));
jest.mock("../../../src/services/events/eventServer", () => ({ guildOfCategory: (id) => ({ catA: "g1", catB: "g2" })[id] || "" }));

const { covers, scopeOf, scopeCovers, entryOnServer, charactersOf, charactersFor, eventServer, specLabel, scopeView, charactersView } = require("../../../src/services/signups/availabilityScope");

const START = Math.floor(Date.UTC(2030, 2, 20, 18) / 1000); // 2030-03-20 19:00 server time
const event = (over = {}) => ({ id: "eh-1", startTime: START, categoryId: "cat1", ...over });
const entry = (over = {}) => ({ kind: "absence", from: "2030-03-18", to: "2030-03-22", ...over });

beforeEach(() => {
    mockConfig = { guildId: "g1", discordServers: { servers: [{ guildId: "g1" }, { guildId: "g2" }] } };
});

describe("scopeOf", () => {
    it("liest den Scope, eine Alt-Kategorie und den Alt-Eintrag ohne Kategorie", () => {
        expect(scopeOf({ scope: [{ guildId: "g1", categoryIds: ["c", ""] }, null, { guildId: "" }] })).toEqual([{ guildId: "g1", categoryIds: ["c"] }]);
        expect(scopeOf({ scope: [], categoryId: "cat1" })).toEqual([{ guildId: "", categoryIds: ["cat1"] }]);
        expect(scopeOf({ categoryId: "" })).toBeNull();
        expect(scopeOf(null)).toBeNull();
    });
});

describe("eventServer / scopeCovers", () => {
    it("nimmt den Server des Raids, sonst den ersten der Liste", () => {
        expect(eventServer(event({ guildId: "g2" }), mockConfig)).toBe("g2");
        expect(eventServer(event(), mockConfig)).toBe("g1");
        expect(eventServer(event())).toBe("g1"); // the settings' config
    });

    it("deckt nur den eigenen Server, dort alle oder die genannten Kategorien", () => {
        const all1 = { scope: [{ guildId: "g1", categoryIds: [] }] };
        expect(scopeCovers(all1, event(), { config: mockConfig })).toBe(true);
        expect(scopeCovers(all1, event({ guildId: "g2" }), { config: mockConfig })).toBe(false);
        const cat2 = { scope: [{ guildId: "g2", categoryIds: ["cat9"] }] };
        expect(scopeCovers(cat2, event({ guildId: "g2", categoryId: "cat9" }))).toBe(true);
        expect(scopeCovers(cat2, event({ guildId: "g2" }))).toBe(false);
        // older entries: one category anywhere, or everything
        expect(scopeCovers({ categoryId: "cat1" }, event({ guildId: "g2" }))).toBe(true);
        expect(scopeCovers({ categoryId: "" }, event({ guildId: "g2", categoryId: "x" }))).toBe(true);
    });
});

describe("entryOnServer (welche Einträge eine Server-Ansicht zeigt)", () => {
    it("zeigt Einträge mit einem Teil auf dem Server, keine eines anderen Servers", () => {
        expect(entryOnServer({ scope: [{ guildId: "g1", categoryIds: [] }] }, "g1")).toBe(true);
        expect(entryOnServer({ scope: [{ guildId: "g1", categoryIds: ["catA"] }] }, "g2")).toBe(false);
        expect(entryOnServer({ scope: [{ guildId: "g1", categoryIds: [] }, { guildId: "g2", categoryIds: ["catB"] }] }, "g2")).toBe(true);
    });

    it("Alt-Einträge: die Kategorie nach ihrem Server, unbekannt und ohne Kategorie überall", () => {
        expect(entryOnServer({ categoryId: "catA" }, "g1")).toBe(true);
        expect(entryOnServer({ categoryId: "catA" }, "g2")).toBe(false);
        expect(entryOnServer({ categoryId: "unbekannt" }, "g2")).toBe(true);
        expect(entryOnServer({ categoryId: "" }, "g2")).toBe(true);
        expect(entryOnServer({ categoryId: "x" }, "g2", { guildOfCategory: () => "g2" })).toBe(true);
    });

    it("ohne Server zeigt alles", () => {
        expect(entryOnServer({ scope: [{ guildId: "g1", categoryIds: [] }] }, "")).toBe(true);
    });
});

describe("charactersOf / charactersFor", () => {
    const chars = [
        { character: "A", spec: "Mage-Arcane", versionId: "tbc" },
        { character: "B", spec: "Priest-Shadow", versionId: "forever" },
        { character: "C", spec: "Warrior-Arms", versionId: "tbc" },
    ];

    it("liest einen Alt-Einzelcharakter als Liste", () => {
        expect(charactersOf({ character: "Old", spec: "Mage-Fire" })).toEqual([{ character: "Old", spec: "Mage-Fire", versionId: "" }]);
        expect(charactersOf({ characters: [{ character: "" }, null] })).toEqual([]);
        expect(charactersOf({ characters: chars, character: "A" })).toHaveLength(3);
    });

    it("nimmt die Charaktere der Raid-Version in Reihenfolge, gekürzt auf max", () => {
        const e = { characters: chars };
        expect(charactersFor(e, event({ versionId: "tbc" })).map((c) => c.character)).toEqual(["A", "C"]);
        expect(charactersFor(e, event({ versionId: "tbc" }), { max: 1 }).map((c) => c.character)).toEqual(["A"]);
        expect(charactersFor(e, event({ versionId: "forever" })).map((c) => c.character)).toEqual(["B"]);
        // a character without version counts everywhere
        expect(charactersFor({ character: "Old", spec: "Mage-Fire" }, event({ versionId: "forever" }))).toHaveLength(1);
    });

    it("filtert Specs, die die Raid-Version nicht kennt, vor dem Kürzen", () => {
        const e = { characters: [{ character: "Bad", spec: "Foo-Bar", versionId: "tbc" }, ...chars] };
        // the unknown spec takes no place: max 1 is A, not Bad
        expect(charactersFor(e, event({ versionId: "tbc" }), { max: 1 }).map((c) => c.character)).toEqual(["A"]);
        expect(charactersFor({ character: "Old", spec: "x" }, event({ versionId: "forever" }))).toEqual([]);
        expect(covers(entry({ kind: "presence", characters: [{ character: "Bad", spec: "Foo-Bar", versionId: "tbc" }] }), event({ versionId: "tbc" }))).toBe(false);
    });
});

describe("covers", () => {
    it("prüft Tag, Scope und bei Anwesenheit die Version", () => {
        const scope = [{ guildId: "g1", categoryIds: [] }];
        expect(covers(entry({ scope }), event(), { config: mockConfig })).toBe(true);
        expect(covers(entry({ scope, from: "2030-03-21" }), event(), { config: mockConfig })).toBe(false);
        expect(covers(entry({ scope, to: "2030-03-19" }), event(), { config: mockConfig })).toBe(false);
        expect(covers(entry({ scope }), event({ guildId: "g2" }), { config: mockConfig })).toBe(false);
        const presence = entry({ scope, kind: "presence", characters: [{ character: "A", spec: "Mage-Arcane", versionId: "tbc" }] });
        expect(covers(presence, event({ versionId: "tbc" }), { config: mockConfig })).toBe(true);
        expect(covers(presence, event({ versionId: "forever" }), { config: mockConfig })).toBe(false);
        expect(covers(entry(), { id: "x" })).toBe(false);
        expect(covers(null, event())).toBe(false);
    });
});

describe("scopeView / charactersView (the web's dialog and the overview's drawer)", () => {
    const names = { servers: { g1: "Pulse" }, categories: { cat1: "Raids TBC" } };

    it("names servers and categories from the names handed in, unknown ones stay empty", () => {
        const e = entry({ scope: [{ guildId: "g1", categoryIds: [] }, { guildId: "g2", categoryIds: ["cat1", "catX"] }] });
        expect(scopeView(e, names)).toEqual([
            { guildId: "g1", name: "Pulse", categories: [] },
            { guildId: "g2", name: "", categories: [{ id: "cat1", name: "Raids TBC" }, { id: "catX", name: "" }] },
        ]);
    });

    it("an older entry: one category without server, everything as an empty list", () => {
        expect(scopeView(entry({ categoryId: "cat1" }), names)).toEqual([{ guildId: "", name: "", categories: [{ id: "cat1", name: "Raids TBC" }] }]);
        expect(scopeView(entry(), names)).toEqual([]);
        expect(scopeView(entry({ categoryId: "cat1" }))).toEqual([{ guildId: "", name: "", categories: [{ id: "cat1", name: "" }] }]);
    });

    it("gives every character its spec label, the key when the rule set does not know it", () => {
        const e = { characters: [{ character: "A", spec: "Mage-Arcane", versionId: "tbc" }, { character: "B", spec: "Foo-Bar", versionId: "tbc" }, { character: "C", spec: "" }] };
        expect(charactersView(e)).toEqual([
            { character: "A", spec: "Mage-Arcane", versionId: "tbc", specLabel: "Arkan" },
            { character: "B", spec: "Foo-Bar", versionId: "tbc", specLabel: "Foo-Bar" },
            { character: "C", spec: "", versionId: "", specLabel: "" },
        ]);
        expect(charactersView(entry())).toEqual([]);
        expect(specLabel("")).toBe("");
    });
});
