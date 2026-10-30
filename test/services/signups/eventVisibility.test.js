// Which raids a member sees (services/signups/eventVisibility.js, Oct 2026): the orga every raid, a
// raider the raids of the categories they may sign up for, of the categories whose roster opened
// them (`publicRaids`) and every raid they signed up for. An area right is no orga rank.
// a category has one roster per version (#739): a raid asks for the roster of its version
jest.mock("../../../src/services/roster/categoryRoster", () => ({
    rosterOfEvent: jest.fn(() => null),
    currentRoster: jest.fn(() => null),
    rosterOfCategory: jest.fn(() => null),
    isCurrentRoster: jest.fn(() => false),
    currentVersionOf: jest.fn(() => "tbc"),
}));
jest.mock("../../../src/stores/settings/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../../src/stores/events/signupStore", () => ({ getSignup: jest.fn(() => null) }));
jest.mock("../../../src/stores/events/raidEventStore", () => ({ getRaidEvent: jest.fn(() => null) }));
jest.mock("../../../src/stores/events/eventStore", () => ({
    getEvent: jest.fn(() => null),
    isOwnEventId: jest.fn((id) => String(id).startsWith("eh_")),
}));
jest.mock("../../../src/services/discord/discord", () => ({ memberRoleIds: jest.fn(async () => []) }));
// the rosters of the orga of a category (#729): steered per test
jest.mock("../../../src/stores/roster/rosterStore", () => ({ listRosters: jest.fn(() => []) }));

const categoryRoster = require("../../../src/services/roster/categoryRoster");
const rosterStore = require("../../../src/stores/roster/rosterStore");
const memberRoleMemory = require("../../../src/services/discord/roles/memberRoleMemory");
const settingsStore = require("../../../src/stores/settings/settingsStore");
const signupStore = require("../../../src/stores/events/signupStore");
const { getRaidEvent } = require("../../../src/stores/events/raidEventStore");
const { getEvent } = require("../../../src/stores/events/eventStore");
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
    categoryRoster.rosterOfEvent.mockReturnValue(null);
    categoryRoster.currentRoster.mockReturnValue(null);
    categoryRoster.isCurrentRoster.mockReturnValue(false);
    rosterStore.listRosters.mockReturnValue([]);
    memberRoleMemory._resetForTests();
});

describe("raidViewer", () => {
    it("reads no roles for the orga and the roles of a raider", async () => {
        expect(await vis.raidViewer(ADMIN, "g")).toMatchObject({ orga: true, roleIds: [] });
        expect(await vis.raidViewer(ORGA, "g")).toMatchObject({ orga: true, roleIds: [] });
        expect(discord.memberRoleIds).not.toHaveBeenCalled();
        discord.memberRoleIds.mockResolvedValueOnce(["r-mo", 5]);
        expect(await vis.raidViewer(RAIDER, "g")).toEqual({ orga: false, userId: "u1", roleIds: ["r-mo", "5"], orgaCategories: [], config: CONFIG });
        expect(discord.memberRoleIds).toHaveBeenCalledWith("g", "u1");
    });

    it("counts an unknown or failed role lookup as no roles - unless a read of the last minutes stands in", async () => {
        discord.memberRoleIds.mockResolvedValueOnce(null);
        expect((await vis.raidViewer(RAIDER, "g")).roleIds).toEqual([]);
        discord.memberRoleIds.mockRejectedValueOnce(new Error("offline"));
        expect((await vis.raidViewer(RAIDER, "g")).roleIds).toEqual([]);
        // memberRoleMemory: a Discord hiccup right after a good read keeps the roles
        discord.memberRoleIds.mockResolvedValueOnce(["r-mo"]);
        expect((await vis.raidViewer(RAIDER, "g")).roleIds).toEqual(["r-mo"]);
        discord.memberRoleIds.mockRejectedValueOnce(new Error("offline"));
        expect((await vis.raidViewer(RAIDER, "g")).roleIds).toEqual(["r-mo"]);
    });

    it("waits at most ROLE_FETCH_MS for a hanging Discord lookup (review #729)", async () => {
        jest.useFakeTimers();
        try {
            discord.memberRoleIds.mockImplementationOnce(() => new Promise(() => {}));
            const pending = vis.raidViewer(RAIDER, "g");
            await jest.advanceTimersByTimeAsync(3000);
            expect((await pending).roleIds).toEqual([]);
        } finally {
            jest.useRealTimers();
        }
    });

    it("names the categories whose current roster the raider manages (#729), and shows their raids", async () => {
        const roster = { id: "r1", categoryId: "mo", versionId: "tbc", guildId: "g", managers: { userIds: ["u1"], roleIds: [] } };
        rosterStore.listRosters.mockReturnValue([roster, { id: "r2", categoryId: "other", guildId: "g", managers: { userIds: ["x"] } }]);
        categoryRoster.currentRoster.mockImplementation((cat) => (cat === "mo" ? roster : { id: "r2", categoryId: "other", guildId: "g", managers: { userIds: ["x"] } }));
        const viewer = await vis.raidViewer(RAIDER, "g");
        expect(viewer.orgaCategories).toEqual(["mo"]);
        // without the raider role r-mo: their category shows, another one does not
        expect(vis.eventShown({ id: "x", categoryId: "mo" }, viewer)).toBe(true);
        expect(vis.eventShown({ id: "x", categoryId: "other" }, viewer)).toBe(false);
        // the orga needs no such list
        expect((await vis.raidViewer(ORGA, "g")).orgaCategories).toEqual([]);
    });

    it("counts with the viewed roles under \"Ansicht als\" - never the admin's own roles, account or signups", async () => {
        const roster = { id: "r1", categoryId: "mo", versionId: "tbc", guildId: "g", managers: { userIds: ["a"], roleIds: ["r-mgr"] } };
        rosterStore.listRosters.mockReturnValue([roster]);
        categoryRoster.currentRoster.mockReturnValue(roster);
        // "So sieht es ein Raider": no role - the admin manages the roster by account, the view does not
        const asRaider = { id: "a", isAdmin: false, access: {}, viewAs: { roleIds: [], at: 1 } };
        signupStore.getSignup.mockReturnValue({ userId: "a" });
        let viewer = await vis.raidViewer(asRaider, "g");
        expect(viewer).toMatchObject({ orga: false, userId: "", roleIds: [], orgaCategories: [] });
        expect(discord.memberRoleIds).not.toHaveBeenCalled();
        expect(vis.eventShown({ id: "eh_1", categoryId: "mo" }, viewer)).toBe(false);
        signupStore.getSignup.mockReturnValue(null);
        // viewed as the raider role, then as the manager role
        viewer = await vis.raidViewer({ ...asRaider, viewAs: { roleIds: ["r-mo"], at: 1 } }, "g");
        expect(viewer.roleIds).toEqual(["r-mo"]);
        expect(vis.eventShown({ id: "x", categoryId: "mo" }, viewer)).toBe(true);
        viewer = await vis.raidViewer({ ...asRaider, viewAs: { roleIds: ["r-mgr"], at: 1 } }, "g");
        expect(viewer.orgaCategories).toEqual(["mo"]);
        expect(discord.memberRoleIds).not.toHaveBeenCalled();
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

    it("follows signupAccess: a roster-only category shows to its members, not to role holders alone", () => {
        const config = { categoryIds: ["ro"], categoryRoles: {} };
        categoryRoster.rosterOfCategory.mockImplementation((cat) => (cat === "ro" ? { categoryId: "ro", signupOnly: true, roleIds: [], members: { u1: { status: "core" }, u2: { status: "pause" } } } : null));
        expect(vis.eventShown({ id: "x", categoryId: "ro" }, { orga: false, userId: "u1", roleIds: [], config })).toBe(true);
        expect(vis.eventShown({ id: "x", categoryId: "ro" }, { orga: false, userId: "u2", roleIds: [], config })).toBe(false);
        expect(vis.eventShown({ id: "x", categoryId: "ro" }, { orga: false, userId: "u3", roleIds: ["r-mo"], config })).toBe(false);
        categoryRoster.rosterOfCategory.mockReturnValue(null);
    });

    it("reads a further raid's signup at the group's first raid (#811): a raider moved into \"Raid 2\" still sees it", () => {
        // eh_2 is the second raid of the group eh_1: the signups are eh_1's
        getEvent.mockImplementation((id) => (id === "eh_2" ? { id: "eh_2", categoryId: "foreign", raidGroupId: "eh_1", raidGroupIndex: 2 } : null));
        signupStore.getSignup.mockImplementation((eventId, uid) => (eventId === "eh_1" && uid === "u1" ? { userId: "u1" } : null));
        expect(vis.eventShown({ id: "eh_2", categoryId: "foreign" }, raider())).toBe(true);
        expect(signupStore.getSignup).toHaveBeenLastCalledWith("eh_1", "u1");
        expect(vis.hasSignup({ id: "eh_2", raidGroupId: "eh_1" }, "u1")).toBe(true);
        expect(vis.hasSignup({ id: "eh_2" }, "u2")).toBe(false);
        // outside a group the raid's own signups count
        getEvent.mockReturnValue(null);
        expect(vis.hasSignup({ id: "eh_3" }, "u1")).toBe(false);
        expect(signupStore.getSignup).toHaveBeenLastCalledWith("eh_3", "u1");
        getEvent.mockReset();
        getEvent.mockReturnValue(null);
        signupStore.getSignup.mockReset();
        signupStore.getSignup.mockReturnValue(null);
    });

    it("userSeesEvent opens a further raid to a raider signed up at the first raid", async () => {
        getEvent.mockImplementation((id) => (id === "eh_2" ? { id: "eh_2", categoryId: "foreign", guildId: "g", raidGroupId: "eh_1", raidGroupIndex: 2 } : null));
        signupStore.getSignup.mockImplementation((eventId, uid) => (eventId === "eh_1" && uid === "u1" ? { userId: "u1" } : null));
        expect(await vis.userSeesEvent(RAIDER, { eventId: "eh_2" })).toBe(true);
        getEvent.mockReset();
        getEvent.mockReturnValue(null);
        signupStore.getSignup.mockReset();
        signupStore.getSignup.mockReturnValue(null);
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
        categoryRoster.rosterOfEvent.mockImplementation((ev) => (ev.categoryId === "foreign" ? { categoryId: "foreign", publicRaids: true } : { publicRaids: false }));
        expect(vis.eventShown({ id: "x", categoryId: "foreign" }, raider())).toBe(true);
        expect(vis.eventShown({ id: "x", categoryId: "other" }, raider())).toBe(false);
        expect(vis.rosterOpensRaids("")).toBe(false);
        expect(vis.rosterOpensRaids({ id: "x" })).toBe(false);
        categoryRoster.currentRoster.mockReturnValueOnce({ categoryId: "foreign" });
        expect(vis.rosterOpensRaids("foreign")).toBe(false);
        categoryRoster.currentRoster.mockImplementationOnce(() => { throw new Error("broken"); });
        expect(vis.rosterOpensRaids("foreign")).toBe(false);
    });

    it("asks the roster of the raid's version, a bare category the one it plays now (#739)", () => {
        categoryRoster.rosterOfEvent.mockImplementation((ev) => ({ publicRaids: ev.versionId === "tbc" }));
        expect(vis.eventShown({ id: "x", categoryId: "foreign", versionId: "tbc" }, raider())).toBe(true);
        expect(vis.eventShown({ id: "x", categoryId: "foreign", versionId: "forever" }, raider())).toBe(false);
        expect(categoryRoster.rosterOfEvent).toHaveBeenLastCalledWith({ id: "x", categoryId: "foreign", versionId: "forever" }, { config: CONFIG });
        const rows = [{ id: "a", categoryId: "foreign", versionId: "tbc" }, { id: "b", categoryId: "foreign", versionId: "forever" }];
        expect(vis.visibleEvents(rows, raider()).map((r) => r.id)).toEqual(["a"]);
        categoryRoster.currentRoster.mockReturnValueOnce({ publicRaids: true });
        expect(vis.rosterOpensRaids("foreign")).toBe(true);
        expect(categoryRoster.currentRoster).toHaveBeenLastCalledWith("foreign", { config: undefined });
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
