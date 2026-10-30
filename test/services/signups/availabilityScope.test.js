// Welche Raids ein Ab-/Anwesenheits-Eintrag abdeckt (src/services/signups/availabilityScope.js):
// Tag, Server + Kategorie, bei Anwesenheiten ein Charakter der Raid-Version - und Alt-Einträge.

let mockConfig = {};
jest.mock("../../../src/stores/settings/settingsStore", () => ({ getConfig: () => mockConfig }));

const { covers, scopeOf, scopeCovers, charactersOf, charactersFor, eventServer } = require("../../../src/services/signups/availabilityScope");

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
        expect(charactersFor({ character: "Old", spec: "x" }, event({ versionId: "forever" }))).toHaveLength(1);
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
