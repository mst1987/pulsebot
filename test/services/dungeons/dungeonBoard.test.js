// The tables of the dungeon page and /bestzeiten: per dungeon, the overall
// medal ranking and the achievement points — one version at a time.
const store = require("../../../src/stores/dungeonRunStore");
const board = require("../../../src/services/dungeons/dungeonBoard");
const { tempStoreFile } = require("../../helpers/tempStore");

const DEVI = { guid: "0A1", name: "Devira", class: "PALADIN" };
const THAL = { guid: "0A2", name: "Thalor", class: "WARRIOR" };
const MIRA = { guid: "", name: "Mira", class: "MAGE" };

let n = 0;
const run = (over = {}) => {
    n += 1;
    return {
        id: `dr_${n}`, versionId: "forever", guild: "Pulse", dungeon: "The Deadmines", seconds: 1900, start: 1791700000 + n, at: 1791702000 + n,
        instance: null, medal: "gold", members: [DEVI, THAL], addonIds: [`a${n}`], receivedAt: 1000 + n, updatedAt: 0, ...over,
    };
};

beforeAll(() => store.useFile(tempStoreFile("dungeon-runs.json")));
afterAll(() => store.useFile(null));
beforeEach(() => store.update(() => ({ runs: [], characters: [] })));

describe("classOf", () => {
    it("maps WoW's class tokens to the rule set's class with colour and icon", () => {
        expect(board.classOf("forever", "PALADIN")).toEqual({ classId: "Paladin", color: "#F58CBA", icon: "classicon_paladin" });
        expect(board.classOf("tbc", "")).toEqual({ classId: "", color: "", icon: "" });
        expect(board.classOf("forever", "NOPE")).toEqual({ classId: "", color: "", icon: "" });
    });
});

describe("dungeonTables", () => {
    it("lists every dungeon by name with its ten fastest runs, fastest first", () => {
        const runs = [
            ...Array.from({ length: 12 }, (_, i) => run({ seconds: 2000 - i * 10, medal: i > 8 ? "gold" : "silver" })),
            run({ dungeon: "Ragefire Chasm", seconds: 900, medal: null }),
        ];
        const tables = board.dungeonTables(runs);
        expect(tables.map((t) => t.dungeon)).toEqual(["Ragefire Chasm", "The Deadmines"]);
        const dm = tables[1];
        expect(dm).toMatchObject({ runCount: 12, goldRuns: 3, bestSeconds: 1890 });
        expect(dm.runs).toHaveLength(10);
        expect(dm.runs.map((r) => r.seconds)).toEqual([1890, 1900, 1910, 1920, 1930, 1940, 1950, 1960, 1970, 1980]);
        expect(dm.runs[0]).toMatchObject({ rank: 1, medal: "gold", startedAt: expect.any(Number) });
        expect(dm.runs[0].members[0]).toEqual({ name: "Devira", classId: "Paladin", color: "#F58CBA", icon: "classicon_paladin" });
    });

    it("puts the earlier run first at the same time", () => {
        const a = run({ seconds: 1000, start: 1791700500 });
        const b = run({ seconds: 1000, start: 1791700100 });
        expect(board.dungeonTables([a, b])[0].runs.map((r) => r.id)).toEqual([b.id, a.id]);
    });
});

describe("playerTable", () => {
    it("counts each player's medals over the runs and names the dungeons with gold", () => {
        const players = board.playerTable([
            run({ medal: "gold" }),
            run({ medal: "gold", dungeon: "Wailing Caverns" }),
            run({ medal: "silver", members: [DEVI, MIRA] }),
            run({ medal: "bronze", members: [MIRA] }),
            run({ medal: null, members: [THAL] }),
        ]);
        expect(players.map((p) => [p.rank, p.name, p.gold, p.silver, p.bronze, p.runs])).toEqual([
            [1, "Devira", 2, 1, 0, 3],
            [2, "Thalor", 2, 0, 0, 3],
            [3, "Mira", 0, 1, 1, 2],
        ]);
        expect(players[0]).toMatchObject({ goldDungeons: ["The Deadmines", "Wailing Caverns"], classId: "Paladin" });
    });

    it("joins a name-only member to the guid player of the same name", () => {
        const players = board.playerTable([run(), run({ members: [{ guid: "", name: "devira", class: "" }] })]);
        expect(players.find((p) => p.key === "g:0A1")).toMatchObject({ runs: 2, gold: 2 });
        expect(players).toHaveLength(2);
    });
});

describe("characterTable", () => {
    it("sorts by achievement points and adds the class", () => {
        const rows = board.characterTable([
            { key: "forever:n:a", versionId: "forever", name: "Ann", realm: "", class: "MAGE", level: 10, points: 100, count: 10, golds: 0, at: 1791700000 },
            { key: "forever:n:b", versionId: "forever", name: "Bob", realm: "", class: "ROGUE", level: 20, points: 300, count: 30, golds: 1, at: 1791700000 },
        ]);
        expect(rows.map((r) => [r.rank, r.name, r.points, r.classId])).toEqual([[1, "Bob", 300, "Rogue"], [2, "Ann", 100, "Mage"]]);
        expect(rows[0].readAt).toBe(1791700000000);
    });
});

describe("dungeonBoard", () => {
    it("answers for exactly one version", () => {
        store.update((doc) => {
            doc.runs.push(run(), run({ versionId: "tbc", dungeon: "Shadow Labyrinth" }));
            doc.characters.push({ key: "tbc:n:x", versionId: "tbc", name: "X", at: 1 });
        });
        const forever = board.dungeonBoard("forever");
        expect(forever.dungeons.map((d) => d.dungeon)).toEqual(["The Deadmines"]);
        expect(forever.characters).toEqual([]);
        expect(forever.totals).toEqual({ runs: 1, characters: 0 });
        expect(board.dungeonBoard("tbc").dungeons.map((d) => d.dungeon)).toEqual(["Shadow Labyrinth"]);
        expect(board.versionsWithData().sort()).toEqual(["forever", "tbc"]);
        expect(board.dungeonNames("forever")).toEqual(["The Deadmines"]);
    });
});

describe("formatSeconds", () => {
    it("writes minutes and seconds, hours when needed", () => {
        expect(board.formatSeconds(1902)).toBe("31:42");
        expect(board.formatSeconds(65)).toBe("1:05");
        expect(board.formatSeconds(3725)).toBe("1:02:05");
    });
});
