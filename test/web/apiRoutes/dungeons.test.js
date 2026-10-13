// GET /api/dungeons through the real router: who may read it and that it
// answers one game version at a time.
const { body, status, routerClient } = require("../../helpers/http");

jest.mock("../../../src/web/http/auth", () => ({
    getUser: jest.fn(),
    getRealUser: jest.fn(),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
}));
jest.mock("../../../src/stores/settingsStore", () => ({
    ...jest.requireActual("../../../src/stores/settingsStore"),
    getConfig: jest.fn(() => ({ mainVersion: "forever" })),
}));

const { getUser } = require("../../../src/web/http/auth");
const { getConfig } = require("../../../src/stores/settingsStore");
const store = require("../../../src/stores/dungeonRunStore");
const { tempStoreFile } = require("../../helpers/tempStore");
const { get } = routerClient(require("../../../src/web/apiRoutes/dungeons"));

const ADMIN = { id: "1", name: "Admin", isAdmin: true };
const MEMBER = { id: "7", name: "Rai", isAdmin: false, access: { signup: { read: true, write: true } } };
const LOOT_ONLY = { id: "8", name: "Lo", isAdmin: false, access: { loot: { read: true, write: false } } };

const run = (over) => ({
    id: "dr_1", versionId: "forever", dungeon: "The Deadmines", seconds: 1900, start: 1791700000, at: 1791702000, medal: "gold",
    members: [{ guid: "1", name: "Devira", class: "PALADIN" }], addonIds: ["a"], ...over,
});

beforeAll(() => store.useFile(tempStoreFile("dungeon-runs.json")));
afterAll(() => store.useFile(null));
beforeEach(() => {
    getUser.mockReturnValue(ADMIN);
    getConfig.mockReturnValue({ mainVersion: "forever" });
    store.update(() => ({
        runs: [run(), run({ id: "dr_2", versionId: "tbc", dungeon: "Shadow Labyrinth" })],
        characters: [{ key: "forever:g:1", versionId: "forever", name: "Devira", class: "PALADIN", points: 340, at: 1791702000 }],
    }));
});

describe("GET /api/dungeons", () => {
    it("answers the main version without ?version=, with the other versions that have data", async () => {
        const data = body(await get("/api/dungeons"));
        expect(data.versionId).toBe("forever");
        expect(data.dungeons.map((d) => d.dungeon)).toEqual(["The Deadmines"]);
        expect(data.players[0]).toMatchObject({ name: "Devira", gold: 1, classId: "Paladin" });
        expect(data.characters[0]).toMatchObject({ name: "Devira", points: 340 });
        expect(data.otherVersions).toEqual(["TBC"]);
    });

    it("answers the version asked for, never a mix", async () => {
        const data = body(await get("/api/dungeons", { version: "tbc" }));
        expect(data.versionId).toBe("tbc");
        expect(data.dungeons.map((d) => d.dungeon)).toEqual(["Shadow Labyrinth"]);
        expect(data.characters).toEqual([]);
    });

    it("answers only the main version while the other versions are hidden", async () => {
        getConfig.mockReturnValue({ mainVersion: "forever", hideOtherVersions: true });
        const data = body(await get("/api/dungeons", { version: "tbc" }));
        expect(data.versionId).toBe("forever");
        expect(data.otherVersions).toEqual([]);
    });

    it("is open to every member (base access) and closed to an account without roster or signup", async () => {
        getUser.mockReturnValue(MEMBER);
        expect(status(await get("/api/dungeons"))).toBe(200);
        getUser.mockReturnValue(LOOT_ONLY);
        expect(status(await get("/api/dungeons"))).toBe(403);
        getUser.mockReturnValue(null);
        expect(status(await get("/api/dungeons"))).toBe(401);
    });

    it("answers an empty board for a version without data", async () => {
        store.update(() => ({ runs: [], characters: [] }));
        const data = body(await get("/api/dungeons", { version: "classic" }));
        expect(data).toMatchObject({ versionId: "classic", dungeons: [], players: [], characters: [], totals: { runs: 0, characters: 0 }, otherVersions: [] });
    });
});
