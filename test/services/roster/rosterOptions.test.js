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
        expect(rosterCategories("g1", { categoryIds: ["700000000000000001"] })).toEqual([
            { id: "700000000000000001", name: "Donnerstag", versionId: "tbc", rosterId: r.id, rosterName: "Do" },
            { id: "700000000000000002", name: "Freitag", versionId: "tbc", rosterId: null, rosterName: "" },
        ]);
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
            kaders: [{ id: "k1", name: "K", inRoster: 1, candidates: 1, attendanceCategories: [], rosterId: null, rosterName: "" }],
        }));
        expect(opts.versions.map((v) => v.id)).toEqual(expect.arrayContaining(["tbc", "forever"]));
        expect(rosterOptions({ guildId: "g1", canSeeKader: false }).kaders).toEqual([]);
        const none = rosterOptions({});
        expect(none).toEqual(expect.objectContaining({ guildId: "", canManageRoles: false, online: false, roles: [] }));
    });
});
