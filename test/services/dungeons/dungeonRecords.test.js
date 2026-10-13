// "Neue Gildenrekorde posten": which runs are records and when a card goes out.
jest.mock("../../../src/services/discord/discord", () => ({ postPayload: jest.fn() }));

const discord = require("../../../src/services/discord/discord");
const store = require("../../../src/stores/dungeonRunStore");
const { newRecords, postNewRecords, recordSetting, MAX_POSTS } = require("../../../src/services/dungeons/dungeonRecords");
const { cardText } = require("../../helpers/cardText");
const { tempStoreFile } = require("../../helpers/tempStore");

const NOW = 1791800000 * 1000;
const CHANNEL = "123456789012345678";
const on = (over = {}) => ({ botLanguage: "de", dungeonRecords: { post: true, channelId: CHANNEL }, ...over });

const run = (over = {}) => ({
    id: "dr_new", versionId: "forever", dungeon: "The Deadmines", seconds: 1800, start: 1791790000, at: 1791792000, medal: "gold",
    members: [{ guid: "1", name: "Devira", class: "PALADIN" }], addonIds: ["a"], recordPostedAt: 0, ...over,
});

beforeAll(() => store.useFile(tempStoreFile("dungeon-runs.json")));
afterAll(() => store.useFile(null));
beforeEach(() => {
    jest.clearAllMocks();
    discord.postPayload.mockResolvedValue({ id: "m1" });
    store.update(() => ({ runs: [], characters: [] }));
});

describe("newRecords", () => {
    const old = run({ id: "dr_old", seconds: 1900, at: 1791000000 });

    it("is the touched gold run that is now the fastest, with the time it beat", () => {
        expect(newRecords([old, run()], ["dr_new"], { now: NOW })).toEqual([{ run: run(), previous: 1900 }]);
    });

    it("is nothing for a slower run, a silver run, an old run or one already posted", () => {
        expect(newRecords([old, run({ seconds: 2000 })], ["dr_new"], { now: NOW })).toEqual([]);
        expect(newRecords([old, run({ medal: "silver" })], ["dr_new"], { now: NOW })).toEqual([]);
        expect(newRecords([run({ at: 1791000000 })], ["dr_new"], { now: NOW })).toEqual([]);
        expect(newRecords([run({ recordPostedAt: 1 })], ["dr_new"], { now: NOW })).toEqual([]);
    });

    it("counts the first gold run of a dungeon, and at most three per upload", () => {
        const runs = Array.from({ length: 5 }, (_, i) => run({ id: `dr_${i}`, dungeon: `D${i}` }));
        const records = newRecords(runs, runs.map((r) => r.id), { now: NOW });
        expect(records).toHaveLength(MAX_POSTS);
        expect(records[0].previous).toBe(0);
    });
});

describe("postNewRecords", () => {
    it("posts each record as a card into the channel and marks it", async () => {
        store.update((doc) => { doc.runs.push(run()); });
        expect(await postNewRecords({ versionId: "forever", touched: ["dr_new"] }, { config: on(), now: NOW })).toBe(1);
        expect(discord.postPayload).toHaveBeenCalledWith(CHANNEL, expect.any(Object));
        expect(cardText(discord.postPayload.mock.calls[0][1])).toContain("Neuer Gildenrekord");
        expect(store.listRuns()[0].recordPostedAt).toBe(NOW);
        // never twice
        expect(await postNewRecords({ versionId: "forever", touched: ["dr_new"] }, { config: on(), now: NOW })).toBe(0);
    });

    it("posts nothing while the setting is off, without a channel or for a hidden version", async () => {
        store.update((doc) => { doc.runs.push(run()); });
        const touched = { versionId: "forever", touched: ["dr_new"] };
        expect(await postNewRecords(touched, { config: on({ dungeonRecords: { post: false, channelId: CHANNEL } }), now: NOW })).toBe(0);
        expect(await postNewRecords(touched, { config: on({ dungeonRecords: { post: true, channelId: "" } }), now: NOW })).toBe(0);
        expect(await postNewRecords(touched, { config: on({ mainVersion: "tbc", hideOtherVersions: true }), now: NOW })).toBe(0);
        expect(discord.postPayload).not.toHaveBeenCalled();
    });

    it("logs a failed post and leaves the run unmarked", async () => {
        store.update((doc) => { doc.runs.push(run()); });
        discord.postPayload.mockRejectedValue(new Error("Missing Access"));
        expect(await postNewRecords({ versionId: "forever", touched: ["dr_new"] }, { config: on(), now: NOW })).toBe(0);
        expect(store.listRuns()[0].recordPostedAt).toBe(0);
    });

    it("reads the setting as off unless post is literally true", () => {
        expect(recordSetting({})).toEqual({ post: false, channelId: "" });
        expect(recordSetting({ dungeonRecords: { post: "yes", channelId: " 1 " } })).toEqual({ post: false, channelId: "1" });
    });
});
