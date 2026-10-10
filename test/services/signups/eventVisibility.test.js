// Which raids a member sees (services/signups/eventVisibility.js, Oct 2026): the orga every raid, a
// raider the raids of the categories they may sign up for, of the categories whose roster opened
// them (`publicRaids`) and every raid they signed up for. An area right is no orga rank.
jest.mock("../../../src/stores/rosterStore", () => ({ rosterForCategory: jest.fn(() => null) }));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../../src/stores/signupStore", () => ({ getSignup: jest.fn(() => null) }));
jest.mock("../../../src/stores/raidEventStore", () => ({ getRaidEvent: jest.fn(() => null) }));
jest.mock("../../../src/stores/eventStore", () => ({
    getEvent: jest.fn(() => null),
    isOwnEventId: jest.fn((id) => String(id).startsWith("eh_")),
}));
jest.mock("../../../src/services/discord/discord", () => ({ memberRoleIds: jest.fn(async () => []) }));

const rosterStore = require("../../../src/stores/rosterStore");
const settingsStore = require("../../../src/stores/settingsStore");
const signupStore = require("../../../src/stores/signupStore");
const { getRaidEvent } = require("../../../src/stores/raidEventStore");
const { getEvent } = require("../../../src/stores/eventStore");
const discord = require("../../../src/services/discord/discord");
const vis = require("../../../src/services/signups/eventVisibility");

const ADMIN = { id: "a", isAdmin: true };
const ORGA = { id: "o", isAdmin: false, isOrga: true };
// a raider role holding raids read and write: still no orga
const RAIDER = { id: "u1", isAdmin: false, access: { raids: { read: true, write: true } } };
// two event categories, "mo" for the holders of role r-mo, "mi" open to everybody
const CONFIG = { categoryIds: ["mo", "mi"], categoryRoles: { mo: ["r-mo"] } };

beforeEach(() => {
    jest.clearAllMocks();
    settingsStore.getConfig.mockReturnValue(CONFIG);
    discord.memberRoleIds.mockResolvedValue([]);
    rosterStore.rosterForCategory.mockReturnValue(null);
});

describe("raidViewer", () => {
    it("reads no roles for the orga and the roles of a raider", async () => {
        expect(await vis.raidViewer(ADMIN, "g")).toMatchObject({ orga: true, roleIds: [] });
        expect(await vis.raidViewer(ORGA, "g")).toMatchObject({ orga: true, roleIds: [] });
        expect(discord.memberRoleIds).not.toHaveBeenCalled();
        discord.memberRoleIds.mockResolvedValueOnce(["r-mo", 5]);
        expect(await vis.raidViewer(RAIDER, "g")).toEqual({ orga: false, userId: "u1", roleIds: ["r-mo", "5"], config: CONFIG });
        expect(discord.memberRoleIds).toHaveBeenCalledWith("g", "u1");
    });

    it("counts an unknown or failed role lookup as no roles", async () => {
        discord.memberRoleIds.mockResolvedValueOnce(null);
        expect((await vis.raidViewer(RAIDER, "g")).roleIds).toEqual([]);
        discord.memberRoleIds.mockRejectedValueOnce(new Error("offline"));
        expect((await vis.raidViewer(RAIDER, "g")).roleIds).toEqual([]);
    });
});

describe("eventShown / visibleEvents", () => {
    const raider = (roleIds = []) => ({ orga: false, userId: "u1", roleIds, config: CONFIG });

    it("shows the orga every raid", () => {
        expect(vis.eventShown({ id: "x", categoryId: "foreign" }, { orga: true })).toBe(true);
        expect(vis.eventShown({ id: "x", categoryId: "foreign" }, null)).toBe(true);
    });

    it("shows a raider the categories they may sign up for, nothing else", () => {
        expect(vis.eventShown({ id: "x", categoryId: "mi" }, raider())).toBe(true);
        expect(vis.eventShown({ id: "x", categoryId: "mo" }, raider())).toBe(false);
        expect(vis.eventShown({ id: "x", categoryId: "mo" }, raider(["r-mo"]))).toBe(true);
        expect(vis.eventShown({ id: "x", categoryId: "foreign" }, raider(["r-mo"]))).toBe(false);
        expect(vis.eventShown(null, raider())).toBe(false);
    });

    it("shows a foreign raid the raider signed up for: in its signUps, the own store or the snapshot", () => {
        expect(vis.eventShown({ id: "rh1", categoryId: "foreign", signUps: [{ userId: "u1" }] }, raider())).toBe(true);
        expect(vis.eventShown({ id: "rh1", categoryId: "foreign", signUps: [{ userId: "u2" }] }, raider())).toBe(false);
        signupStore.getSignup.mockReturnValueOnce({ userId: "u1" });
        expect(vis.eventShown({ id: "eh_1", categoryId: "foreign" }, raider())).toBe(true);
        expect(signupStore.getSignup).toHaveBeenCalledWith("eh_1", "u1");
        getRaidEvent.mockReturnValueOnce({ signUps: [{ userId: "u1" }] });
        expect(vis.eventShown({ id: "rh2", categoryId: "foreign" }, raider())).toBe(true);
        expect(vis.hasSignup({ id: "rh3" }, "")).toBe(false);
        expect(vis.hasSignup({}, "u1")).toBe(false);
    });

    it("shows the raids of a category whose roster opened them, without opening the signup", () => {
        rosterStore.rosterForCategory.mockImplementation((cat) => (cat === "foreign" ? { categoryId: "foreign", publicRaids: true } : { publicRaids: false }));
        expect(vis.eventShown({ id: "x", categoryId: "foreign" }, raider())).toBe(true);
        expect(vis.eventShown({ id: "x", categoryId: "other" }, raider())).toBe(false);
        expect(vis.rosterOpensRaids("")).toBe(false);
        rosterStore.rosterForCategory.mockReturnValueOnce({ categoryId: "foreign" });
        expect(vis.rosterOpensRaids("foreign")).toBe(false);
        rosterStore.rosterForCategory.mockImplementationOnce(() => { throw new Error("broken"); });
        expect(vis.rosterOpensRaids("foreign")).toBe(false);
    });

    it("filters a list, handing in each row's signups", () => {
        const rows = [{ id: "a", categoryId: "mi" }, { id: "b", categoryId: "foreign" }, { id: "c", categoryId: "foreign" }];
        const signUps = { c: [{ userId: "u1" }] };
        expect(vis.visibleEvents(rows, raider(), (row) => signUps[row.id]).map((r) => r.id)).toEqual(["a", "c"]);
        expect(vis.visibleEvents(rows, { orga: true })).toBe(rows);
        expect(vis.visibleEvents(null, raider())).toEqual([]);
    });
});

describe("eventCategoryOf / userSeesEvent", () => {
    it("finds the category of an own event, a snapshot or an upcoming Raid-Helper event", async () => {
        getEvent.mockReturnValueOnce({ id: "eh_1", categoryId: "mi", guildId: "g" });
        expect(await vis.eventCategoryOf("eh_1")).toEqual({ categoryId: "mi", guildId: "g" });
        expect(await vis.eventCategoryOf("eh_2")).toBeNull();
        getRaidEvent.mockReturnValueOnce({ categoryId: "mo", guildId: "g", signUps: [] });
        expect(await vis.eventCategoryOf("rh1")).toEqual({ categoryId: "mo", guildId: "g", signUps: [] });
        const loadGroups = jest.fn(async () => ({ groups: [{ categoryId: "mi", events: [{ id: "rh2", signUps: [{ userId: "u1" }] }] }] }));
        expect(await vis.eventCategoryOf("rh2", { loadGroups })).toEqual({ categoryId: "mi", guildId: "", signUps: [{ userId: "u1" }] });
        expect(await vis.eventCategoryOf("rh9", { loadGroups })).toBeNull();
        expect(await vis.eventCategoryOf("rh9")).toBeNull();
        expect(await vis.eventCategoryOf("rh9", { loadGroups: async () => { throw new Error("down"); } })).toBeNull();
        expect(await vis.eventCategoryOf("")).toBeNull();
    });

    it("lets the orga open everything and a raider only what they may see", async () => {
        expect(await vis.userSeesEvent(ORGA, { eventId: "eh_x" })).toBe(true);
        expect(getEvent).not.toHaveBeenCalled();
        expect(await vis.userSeesEvent(RAIDER, { guildId: "g", eventId: "eh_1", categoryId: "mi" })).toBe(true);
        expect(await vis.userSeesEvent(RAIDER, { guildId: "g", eventId: "eh_1", categoryId: "mo" })).toBe(false);
        getEvent.mockReturnValueOnce({ id: "eh_1", categoryId: "mo", guildId: "g" });
        discord.memberRoleIds.mockResolvedValueOnce(["r-mo"]);
        expect(await vis.userSeesEvent(RAIDER, { eventId: "eh_1" })).toBe(true);
        expect(discord.memberRoleIds).toHaveBeenLastCalledWith("g", "u1");
    });

    it("hides an event whose category cannot be told, unless the raider signed up for it", async () => {
        // no event categories at all: an unknown category would pass the role rule - unknown stays hidden
        settingsStore.getConfig.mockReturnValue({});
        expect(await vis.userSeesEvent(RAIDER, { eventId: "rh-unknown" })).toBe(false);
        signupStore.getSignup.mockReturnValue({ userId: "u1" });
        expect(await vis.userSeesEvent(RAIDER, { eventId: "eh_9" })).toBe(true);
        signupStore.getSignup.mockReturnValue(null);
    });
});
