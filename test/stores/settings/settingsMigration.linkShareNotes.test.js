jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());
jest.mock("../../../src/stores/loot/reportStore", () => ({ listReports: jest.fn(() => []), getReport: () => null, assignGuilds: jest.fn(() => 0) }));

const fs = require("fs");
const { settingsPath } = require("../../../src/config/paths");
const configStore = require("../../../src/stores/settings/configStore");
const { migrateSettings, migrateLinkShareNotes } = require("../../../src/stores/settings/settingsMigration");

const A = "1100000000000000001";
const B = "1100000000000000002";
const CH = "1400000000000000011";
const servers = [{ guildId: A, label: "" }, { guildId: B, label: "" }];
const quiet = { log: () => {}, warn: () => {} };

const load = (links, extra = {}) => fs.__store.set(settingsPath("config.json"), JSON.stringify({ discordServers: { servers, links, ...extra } }));
const stored = () => JSON.parse(fs.__store.get(settingsPath("config.json")));
const marked = () => JSON.parse(fs.__store.get(settingsPath("migrations.json")) || "{}");
const link = (from, to, extra = {}) => ({ from, to, channelId: CH, lang: "", versions: [], ...extra });

beforeEach(() => fs.__store.clear());
afterEach(() => jest.restoreAllMocks());

// #1078: sharing Vermerke became a switch per link, off by default - the links of before keep sharing, once.
describe("stores/settings/settingsMigration link switch (#1078)", () => {
    it("turns the switch on for the links of before and leaves the rest of the block alone", () => {
        load([link(A, B, { lang: "en", versions: ["tbc"] })], { talkGuildId: B });
        const before = stored();
        expect(migrateLinkShareNotes()).toEqual(["config.json: Vermerke teilen an 1 bestehender/n Verknüpfung(en) eingeschaltet (#1078)"]);
        expect(stored()).toEqual({
            discordServers: { ...before.discordServers, links: [link(A, B, { lang: "en", versions: ["tbc"], shareNotes: true })] },
        });
        expect(marked().done.linkShareNotes).toEqual(expect.any(Number));
    });

    it("keeps a switch turned off by hand off at the next start", () => {
        load([link(A, B)]);
        migrateLinkShareNotes();
        load([link(A, B)]); // the orga turns it off: normalizeLinks stores no field
        expect(migrateLinkShareNotes()).toEqual([]);
        expect(stored().discordServers.links).toEqual([link(A, B)]);
    });

    it("marks a server without links too, so a link made later with the switch off stays off", () => {
        load([]);
        expect(migrateLinkShareNotes()).toEqual([]);
        expect(marked().done.linkShareNotes).toEqual(expect.any(Number));
        load([link(A, B)]);
        expect(migrateLinkShareNotes()).toEqual([]);
        expect(stored().discordServers.links).toEqual([link(A, B)]);
    });

    it("marks a fresh install without a config.json, and writes none", () => {
        expect(migrateLinkShareNotes()).toEqual([]);
        expect(marked().done.linkShareNotes).toEqual(expect.any(Number));
        expect(fs.__store.has(settingsPath("config.json"))).toBe(false);
    });

    it("a crash while writing leaves no mark and no half state: the next start does it", () => {
        load([link(A, B), link(B, A)]);
        const before = fs.__store.get(settingsPath("config.json"));
        const write = jest.spyOn(configStore, "writeStored").mockImplementationOnce(() => {
            throw new Error("disk full");
        });
        expect(() => migrateLinkShareNotes()).toThrow("disk full");
        expect(fs.__store.get(settingsPath("config.json"))).toBe(before);
        expect(marked().done).toBeUndefined();
        write.mockRestore();
        expect(migrateLinkShareNotes()).toEqual(["config.json: Vermerke teilen an 2 bestehender/n Verknüpfung(en) eingeschaltet (#1078)"]);
        expect(stored().discordServers.links).toEqual([link(A, B, { shareNotes: true }), link(B, A, { shareNotes: true })]);
    });

    it("a crash right after the write repeats without harm: the state is the same", () => {
        load([link(A, B)]);
        migrateLinkShareNotes();
        fs.__store.delete(settingsPath("migrations.json"));
        expect(migrateLinkShareNotes()).toEqual([]);
        expect(stored().discordServers.links).toEqual([link(A, B, { shareNotes: true })]);
        expect(marked().done.linkShareNotes).toEqual(expect.any(Number));
    });

    it("gives a link onto the same server nothing: it shares with nobody", () => {
        load([link(A, A), link(A, B)]);
        migrateLinkShareNotes();
        expect(stored().discordServers.links).toEqual([link(A, A), link(A, B, { shareNotes: true })]);
    });

    it("runs at the start, and the second start changes nothing", () => {
        load([link(A, B)]);
        const first = migrateSettings(quiet);
        expect(first.error).toBeUndefined();
        expect(first.changes).toEqual(expect.arrayContaining([expect.stringContaining("Vermerke teilen an 1")]));
        expect(stored().discordServers.links[0].shareNotes).toBe(true);
        const second = migrateSettings(quiet);
        expect(second.changes.filter((line) => line.includes("Vermerke teilen"))).toEqual([]);
    });
});
