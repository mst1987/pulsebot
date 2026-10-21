// rosterOptions (#657): what the "Roster anlegen" dialog offers.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());
jest.mock("../../../src/services/discord/discord", () => ({ isOnline: jest.fn(() => true), getGuild: jest.fn() }));
jest.mock("../../../src/services/discord/roleSync", () => ({ canManageRoles: jest.fn(() => true) }));
jest.mock("../../../src/services/discord/categoryNames", () => ({
    listKnownCategories: jest.fn(() => [
        { id: "700000000000000001", name: "Donnerstag" },
        { id: "700000000000000002", name: "Freitag" },
        { id: "700000000000000003", name: "Off-Topic" },
        { id: "700000000000000004", name: "" },
    ]),
}));
jest.mock("../../../src/services/events/eventSources", () => ({
    listStoredEvents: jest.fn(() => [{ categoryId: "700000000000000002" }, { categoryId: "700000000000000004" }, {}]),
}));
jest.mock("../../../src/stores/raidTemplateStore", () => ({
    getRaidTemplate: jest.fn((id) => (id === "t25" ? { id: "t25", name: "SSC 25", size: 25, composition: { tank: 3, healer: 6 } } : (id === "legacy" ? { id: "legacy", size: null } : null))),
}));

const fs = require("fs");
const discord = require("../../../src/services/discord/discord");
const rosterStore = require("../../../src/stores/rosterStore");
const kaderStore = require("../../../src/stores/kaderStore");
const { rosterOptions, rosterCategories, serverRoles, templateSlots } = require("../../../src/services/roster/rosterOptions");

const role = (id, name, rawPosition, extra = {}) => ({ id, name, rawPosition, position: rawPosition, color: 0, hexColor: "#000000", managed: false, ...extra });
const GUILD = {
    id: "g1",
    members: { me: { roles: { highest: { position: 10 } } } },
    roles: { cache: new Map([
        ["g1", role("g1", "@everyone", 0)],
        ["900000000000000001", role("900000000000000001", "Raider", 5, { color: 1, hexColor: "#ff0000" })],
        ["900000000000000002", role("900000000000000002", "Admin", 20)],
        ["900000000000000003", role("900000000000000003", "Bot", 3, { managed: true })],
    ]) },
};

beforeEach(() => {
    fs.__store.clear();
    discord.isOnline.mockReturnValue(true);
    discord.getGuild.mockImplementation((id) => (id === "g1" ? GUILD : null));
});

describe("services/roster/rosterOptions", () => {
    it("lists the raid categories with the roster each has", () => {
        const r = rosterStore.createRoster({ name: "Do", guildId: "g1", categoryId: "700000000000000001" });
        expect(rosterCategories("g1", { categoryIds: ["700000000000000001", "700000000000000002"] })).toEqual([
            {
                id: "700000000000000001", name: "Donnerstag", active: true, versionId: "tbc", rosterId: r.id, rosterName: "Do",
                rosters: [{ id: r.id, name: "Do", versionId: "tbc", closed: false }],
            },
            { id: "700000000000000002", name: "Freitag", active: true, versionId: "tbc", rosterId: null, rosterName: "", rosters: [] },
        ]);
    });

    it("names the roster of the version the category plays and lists every version's (#739)", () => {
        const tbc = rosterStore.createRoster({ name: "Do", guildId: "g1", categoryId: "700000000000000001", versionId: "tbc" });
        rosterStore.closeRoster(tbc.id, { reason: "version_switch" });
        const forever = rosterStore.createRoster({ name: "Do F", guildId: "g1", categoryId: "700000000000000001", versionId: "forever" });
        const config = { categoryIds: ["700000000000000001"], categoryVersion: { "700000000000000001": "forever" } };
        const [cat] = rosterCategories("g1", config);
        expect(cat).toMatchObject({ versionId: "forever", rosterId: forever.id, rosterName: "Do F" });
        expect(cat.rosters).toEqual(expect.arrayContaining([
            { id: tbc.id, name: "Do", versionId: "tbc", closed: true },
            { id: forever.id, name: "Do F", versionId: "forever", closed: false },
        ]));
        // played in TBC (before the switch): the closed TBC roster is the category's
        expect(rosterCategories("g1", { categoryIds: ["700000000000000001"] })[0]).toMatchObject({ versionId: "tbc", rosterId: tbc.id });
    });

    it("offers no deactivated category - one that has a roster stays, marked inactive (#744)", () => {
        const r = rosterStore.createRoster({ name: "Do", guildId: "g1", categoryId: "700000000000000001" });
        // Freitag had raids but is no longer active: no new roster for it
        expect(rosterCategories("g1", { categoryIds: ["700000000000000003"] }).map((c) => [c.id, c.active, c.rosterId])).toEqual([
            ["700000000000000001", false, r.id],
            ["700000000000000003", true, null],
        ]);
        // an install that never picked a category still offers every raid category
        expect(rosterCategories("g1", { categoryIds: [] }).map((c) => c.id)).toEqual(["700000000000000001", "700000000000000002"]);
    });

    it("lists the roles highest first, without @everyone, with whether the bot can hand them out", () => {
        expect(serverRoles("g1")).toEqual([
            { id: "900000000000000002", name: "Admin", color: "", position: 20, manageable: false },
            { id: "900000000000000001", name: "Raider", color: "#ff0000", position: 5, manageable: true },
            { id: "900000000000000003", name: "Bot", color: "", position: 3, manageable: false },
        ]);
        expect(serverRoles("nope")).toEqual([]);
        expect(serverRoles("")).toEqual([]);
    });

    it("prefills slots from the category's raid template when it has a size", () => {
        const cats = [{ id: "a" }, { id: "b" }, { id: "c" }];
        expect(templateSlots(cats, { categoryRaidTemplate: { a: "t25", b: "legacy", c: "gone" } })).toEqual({
            a: { total: 25, tank: 3, healer: 6, bench: 0, templateId: "t25", templateName: "SSC 25" },
        });
    });

    it("answers everything, the Kader only for a reader of the Kaderplaner", () => {
        kaderStore.writePlanner("g1", { v: 2, accounts: [], assignments: {}, kaders: [{ id: "k1", name: "K", leads: ["1"], players: { "111111111111111111": { state: "roster" } } }] });
        const opts = rosterOptions({ guildId: "g1", config: {}, canSeeKader: true });
        expect(opts).toEqual(expect.objectContaining({
            guildId: "g1", defaultVersion: "tbc", canManageRoles: true, online: true,
            kaders: [{ id: "k1", name: "K", versionId: "forever", inRoster: 1, candidates: 1, attendanceCategories: [], rosterId: null, rosterName: "", takenOver: false }],
        }));
        // the dialog of one version (#741): only its Kader; a hidden version offers nothing (#563)
        expect(rosterOptions({ guildId: "g1", config: {}, canSeeKader: true, versionId: "tbc" })).toEqual(expect.objectContaining({ kaders: [], defaultVersion: "tbc" }));
        expect(rosterOptions({ guildId: "g1", config: {}, canSeeKader: true, versionId: "forever" }).kaders.map((k) => k.id)).toEqual(["k1"]);
        expect(rosterOptions({ guildId: "g1", config: { hideOtherVersions: true }, canSeeKader: true }).kaders).toEqual([]);
        const split = { categoryIds: ["700000000000000001", "700000000000000002"], categoryVersion: { "700000000000000001": "forever" } };
        expect(rosterOptions({ guildId: "g1", config: split, versionId: "forever" }).categories.map((c) => c.id)).toEqual(["700000000000000001"]);
        expect(rosterOptions({ guildId: "g1", config: split, versionId: "tbc" }).categories.map((c) => c.id)).toEqual(["700000000000000002"]);
        expect(rosterOptions({ guildId: "g1", config: { ...split, hideOtherVersions: true } }).categories.map((c) => c.id)).toEqual(["700000000000000002"]);
        expect(opts.versions.map((v) => v.id)).toEqual(expect.arrayContaining(["tbc", "forever"]));
        expect(opts.versions.find((v) => v.id === "tbc").icon).toBe("expansionicon_burningcrusade");
        expect(rosterOptions({ guildId: "g1", canSeeKader: false }).kaders).toEqual([]);
        const none = rosterOptions({});
        expect(none).toEqual(expect.objectContaining({ guildId: "", canManageRoles: false, online: false, roles: [] }));
    });
});
