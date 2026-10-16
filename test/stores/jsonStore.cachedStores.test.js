// The big stores read on every page keep their file cached (jsonStore
// `cache: true`): parsed once while it does not change, again after a write or
// an edit by hand, and every read a copy a caller may change. One check per
// store that only switched the cache on; signups, events, profiles and the
// Raid-Helper snapshots have their own in their suites.
jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());
jest.mock("../../src/utils/loot/wowhead", () => ({
    ...jest.requireActual("../../src/utils/loot/wowhead"),
    lookupItem: jest.fn(async () => null),
}));

const fs = require("fs");
const rosterStore = require("../../src/stores/rosterStore");
const characterStore = require("../../src/stores/characterStore");
const logStore = require("../../src/stores/logStore");
const lootStore = require("../../src/stores/lootStore");

const parses = (file) => fs.readFileSync.mock.calls.filter(([p]) => p === file).length;

beforeEach(() => {
    fs.__store.clear();
    fs.readFileSync.mockClear();
});

const cases = [
    {
        name: "rosterStore",
        file: rosterStore.ROSTERS_FILE,
        content: (n) => ({
            rosters: Object.fromEntries(Array.from({ length: n }, (_, i) => [`r${i}`, { id: `r${i}`, name: `Roster ${i}`, guildId: "g1", categoryId: `cat${i}`, versionId: "tbc" }])),
            migratedCategories: [],
        }),
        read: () => rosterStore.listRosters(),
        size: () => rosterStore.listRosters().length,
    },
    {
        name: "characterStore",
        file: characterStore.CHARACTERS_FILE,
        content: (n) => ({ characters: Array.from({ length: n }, (_, i) => ({ key: `c${i}`, character: `C${i}`, className: "Mage" })) }),
        read: () => characterStore.listCharacters(),
        size: () => characterStore.listCharacters().length,
    },
    {
        name: "logStore",
        file: logStore.LOGS_FILE,
        content: (n) => ({ logs: Array.from({ length: n }, (_, i) => ({ id: `l${i}`, reportId: `r${i}`, detectedAt: i })) }),
        read: () => logStore.listLogs(),
        size: () => logStore.listLogs().length,
    },
    {
        name: "lootStore",
        file: lootStore.LOOT_FILE,
        content: (n) => ({ items: Array.from({ length: n }, (_, i) => ({ id: `i${i}`, itemId: 100 + i, character: "Anna", awardedAt: i })) }),
        read: () => lootStore.listAll(),
        size: () => lootStore.listAll().length,
    },
];

describe.each(cases)("$name keeps its file cached", ({ file, content, read, size }) => {
    it("parses the file once while it does not change, again after an edit by hand", () => {
        fs.__store.set(file, JSON.stringify(content(2)));
        for (let i = 0; i < 5; i += 1) read();
        expect(parses(file)).toBe(1);
        fs.__store.set(file, JSON.stringify(content(3)));
        expect(size()).toBe(3);
        expect(parses(file)).toBe(2);
    });

    it("hands out copies a caller may change without touching the cache", () => {
        fs.__store.set(file, JSON.stringify(content(2)));
        const first = read();
        const id = first[0].id;
        first[0].id = "x";
        first.length = 0;
        expect(size()).toBe(2);
        expect(read().map((row) => row.id)).toContain(id);
    });
});
