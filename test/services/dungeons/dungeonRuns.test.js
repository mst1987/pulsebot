// A LevelHelper upload into the store: new runs, the same run reported again
// (by id, or by dungeon + group + start), merging and the achievement points.
const store = require("../../../src/stores/roster/dungeonRunStore");
const { ingestLevelHelper, mergeRun, sameGroup, findSameRun, START_WINDOW } = require("../../../src/services/dungeons/dungeonRuns");
const { LevelHelperParseError, LH_FORMAT } = require("../../../src/utils/dungeons/levelHelperUpload");
const { tempStoreFile } = require("../../helpers/tempStore");

const GROUP = [{ guid: "0A1", name: "Devira", class: "PALADIN" }, { guid: "0A2", name: "Thalor", class: "WARRIOR" }];
const run = (over = {}) => ({
    id: "r1", dungeon: "The Deadmines", seconds: 1902, start: 1791700000, instance: 123, medal: "silver", members: GROUP, at: 1791702000, ...over,
});
const upload = (runs, over = {}) => ({ format: LH_FORMAT, v: 1, versionId: "forever", guild: "Pulse", uploader: { account: "a#1" }, runs, characters: [], ...over });

beforeAll(() => store.useFile(tempStoreFile("dungeon-runs.json")));
afterAll(() => store.useFile(null));
beforeEach(() => store.update(() => ({ runs: [], characters: [] })));

describe("ingestLevelHelper", () => {
    it("stores a new run with its version, guild, uploader and addon id", () => {
        const result = ingestLevelHelper(upload([run()]), { tokenName: "Devi-PC", now: 5000 });
        expect(result).toMatchObject({ versionId: "forever", runs: { added: 1, merged: 0, skipped: 0 }, characters: { updated: 0 } });
        const [stored] = store.listRuns("forever");
        expect(stored).toMatchObject({
            versionId: "forever", guild: "Pulse", dungeon: "The Deadmines", seconds: 1902, medal: "silver",
            addonIds: ["r1"], uploadedBy: "Devi-PC", account: "a#1", receivedAt: 5000, recordPostedAt: 0,
        });
        expect(stored.id).toMatch(/^dr_[0-9a-f]{12}$/);
        expect(result.touched).toEqual([stored.id]);
    });

    it("skips the same run uploaded again (same id, nothing new)", () => {
        ingestLevelHelper(upload([run()]));
        const again = ingestLevelHelper(upload([run()]));
        expect(again.runs).toEqual({ added: 0, merged: 0, skipped: 1 });
        expect(again.touched).toEqual([]);
        expect(store.listRuns()).toHaveLength(1);
    });

    it("merges another PC's report of the run: same dungeon, same group, start within 120 s", () => {
        ingestLevelHelper(upload([run()]));
        const other = ingestLevelHelper(upload([run({
            id: "other-pc", start: 1791700000 + 90, seconds: 1897, medal: "gold",
            // the other PC knows the members by name only, one in another case
            members: [{ guid: "", name: "devira", class: "" }, { guid: "", name: "Thalor", class: "WARRIOR" }],
        })]));
        expect(other.runs).toEqual({ added: 0, merged: 1, skipped: 0 });
        const [stored] = store.listRuns();
        expect(stored).toMatchObject({ seconds: 1897, medal: "gold", start: 1791700000, addonIds: ["r1", "other-pc"] });
        expect(stored.members).toHaveLength(2);
        expect(other.touched).toEqual([stored.id]);
    });

    it("keeps a run of its own when the start is further apart, another group or another dungeon", () => {
        ingestLevelHelper(upload([run()]));
        const result = ingestLevelHelper(upload([
            run({ id: "late", start: 1791700000 + START_WINDOW + 1 }),
            run({ id: "other-group", members: [GROUP[0], { guid: "0B9", name: "Mira", class: "MAGE" }] }),
            run({ id: "other-dungeon", dungeon: "Wailing Caverns" }),
        ]));
        expect(result.runs).toEqual({ added: 3, merged: 0, skipped: 0 });
    });

    it("never merges across game versions", () => {
        ingestLevelHelper(upload([run()]));
        const result = ingestLevelHelper(upload([run()], { versionId: "tbc" }));
        expect(result.runs.added).toBe(1);
        expect(store.listRuns("forever")).toHaveLength(1);
        expect(store.listRuns("tbc")).toHaveLength(1);
    });

    it("dedups within one upload too", () => {
        const result = ingestLevelHelper(upload([run(), run({ id: "r1b", start: 1791700030 })]));
        expect(result.runs).toEqual({ added: 1, merged: 1, skipped: 0 });
    });

    it("refuses garbage before anything is stored", () => {
        expect(() => ingestLevelHelper(upload([run(), run({ id: "bad", seconds: 5 })]))).toThrow(LevelHelperParseError);
        expect(store.listRuns()).toEqual([]);
    });

    it("takes over the achievement points, newer readings only, one row per character", () => {
        const character = (over) => ({ guid: "0A1", name: "Devira", realm: "Forever", class: "PALADIN", level: 18, points: 340, count: 34, golds: 2, at: 1791702000, ...over });
        expect(ingestLevelHelper(upload([], { characters: [character({ guid: null })] })).characters).toEqual({ updated: 1 });
        // now with its guid: the row of the name becomes the guid's
        ingestLevelHelper(upload([], { characters: [character({ points: 400, at: 1791703000 })] }));
        // an older reading changes nothing
        expect(ingestLevelHelper(upload([], { characters: [character({ points: 10, at: 1791600000 })] })).characters).toEqual({ updated: 0 });
        // a later reading without the guid finds the guid's row
        ingestLevelHelper(upload([], { characters: [character({ guid: null, points: 410, at: 1791704000 })] }));
        const rows = store.listCharacters("forever");
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ key: "forever:g:0A1", guid: "0A1", points: 410 });
    });
});

describe("mergeRun", () => {
    const stored = (over = {}) => ({ ...run(), id: "dr_1", addonIds: ["r1"], members: GROUP.map((m) => ({ ...m })), ...over });

    it("keeps the fastest time within 10 s and the better medal", () => {
        const r = stored({ medal: "silver" });
        expect(mergeRun(r, run({ id: "x", seconds: 1895, medal: "gold" }))).toEqual({ changed: true, faster: true });
        expect(r).toMatchObject({ seconds: 1895, medal: "gold" });
    });

    it("does not let a report further than 10 s apart change the time", () => {
        const r = stored();
        expect(mergeRun(r, run({ id: "x", seconds: 1800, medal: "gold" })).faster).toBe(false);
        expect(r).toMatchObject({ seconds: 1902, medal: "silver" });
    });

    it("joins the members, fills a missing guid and keeps the earliest start", () => {
        const r = stored({ members: [{ guid: "", name: "Devira", class: "" }] });
        mergeRun(r, run({ id: "x", start: 1791699950, members: GROUP }));
        expect(r.members).toEqual(GROUP);
        expect(r.start).toBe(1791699950);
    });

    it("reports nothing changed for the same report", () => {
        const r = stored();
        expect(mergeRun(r, run())).toEqual({ changed: false, faster: false });
    });
});

describe("sameGroup / findSameRun", () => {
    it("compares by guid, else by lower-case name, and needs the same size", () => {
        expect(sameGroup(GROUP, [{ guid: "", name: "THALOR" }, { guid: "0A1", name: "Other" }])).toBe(true);
        expect(sameGroup(GROUP, [GROUP[0]])).toBe(false);
        expect(sameGroup(GROUP, [GROUP[0], { guid: "0A9", name: "Thalor" }])).toBe(false);
    });

    it("finds by addon id first", () => {
        const runs = [{ ...run(), id: "dr_1", versionId: "forever", addonIds: ["abc"], members: GROUP }];
        expect(findSameRun(runs, "forever", run({ id: "abc", dungeon: "Elsewhere" }))).toBe(runs[0]);
        expect(findSameRun(runs, "tbc", run({ id: "abc" }))).toBeNull();
    });
});
