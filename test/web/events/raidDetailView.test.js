// The raid detail read (#424): raidDetailView.js builds the payload of
// GET /api/raids/detail from one builder per part; apiRoutes/events/raidDetail.js only
// sends it. The byte-for-byte comparison against the old handler was done on
// the dev data before the move (see the PR); these tests pin each part.
const ADMIN = { id: "1", name: "Admin", isAdmin: true };
let mockUser = ADMIN;
jest.mock("../../../src/web/http/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
// the server of a raid is eventServer.test's / apiHandler.server.test's matter (#925): every raid here is on g1
jest.mock("../../../src/services/events/eventServer", () => ({
    allOnServer: jest.fn(() => true), serverOfEntry: jest.fn(() => "g1"), guildOfCategory: jest.fn(() => "g1"), liveGuildOf: jest.fn(() => "g1"),
}));
jest.mock("../../../src/services/events/raidEventGroups", () => ({ loadEventGroups: jest.fn(), eventLookbackSince: jest.fn(() => 123) }));
jest.mock("../../../src/stores/settings/settingsStore", () => ({
    getConfig: jest.fn(() => ({})),
    listNotify: jest.fn(() => [{ id: "n1" }]),
    listRaidsheets: jest.fn(() => [{ id: "sheet-kara", name: "Karazhan", keywords: ["kara"] }]),
    resolveEventSheetLink: jest.fn(() => ({ url: "https://sheet" })),
}));
jest.mock("../../../src/services/discord/discord", () => ({
    listMembersWithRoles: jest.fn(),
    listHumanMembers: jest.fn(async () => ({ members: [], error: null })),
    listRoles: jest.fn(() => [{ id: "r1", name: "Raider" }]),
    resolveUserNames: jest.fn(async (g, ids) => Object.fromEntries(ids.map((id) => [id, `Name ${id}`]))),
    getGuild: jest.fn(() => null),
    memberRoleIds: jest.fn(async () => []),
}));
jest.mock("../../../src/utils/raidhelper/client", () => ({ createRaidhelperClient: jest.fn(), raidhelperDisabled: jest.fn(() => false) }));
jest.mock("../../../src/stores/events/raidEventStore", () => ({ getRaidEvent: jest.fn(() => null) }));
// `isClosed`: the raid plan's step asks the category orga (categoryOrga.canOrgaEvent, #726)
jest.mock("../../../src/stores/roster/rosterStore", () => ({ rosterForCategory: jest.fn(() => null), listRosters: jest.fn(() => []), isClosed: jest.fn(() => false) }));
jest.mock("../../../src/stores/events/eventStore", () => ({ getEvent: jest.fn(() => null), isOwnEventId: jest.fn((id) => String(id).startsWith("eh")) }));
jest.mock("../../../src/stores/events/signupStore", () => ({ listSignups: jest.fn(() => []), getSignup: jest.fn(() => null) }));
jest.mock("../../../src/stores/raidplan/raidplanStore", () => ({ getPlan: jest.fn(() => null) }));
jest.mock("../../../src/stores/events/eventSheetStore", () => ({ getEventSheet: jest.fn(() => null) }));
jest.mock("../../../src/stores/raidplan/raidplanPostStore", () => ({ getRaidplanPost: jest.fn(() => null) }));
jest.mock("../../../src/stores/events/eventSoftresStore", () => ({ getEventSoftres: jest.fn(() => null) }));
jest.mock("../../../src/stores/events/eventLootSystemStore", () => ({ lootSystemOf: jest.fn(() => "softres") }));
jest.mock("../../../src/stores/loot/lootStore", () => ({ listByEvent: jest.fn(() => []), listAll: jest.fn(() => []) }));
jest.mock("../../../src/services/events/eventSources", () => ({ listStoredEvents: jest.fn(() => []) }));
jest.mock("../../../src/stores/roster/raiderCharactersStore", () => ({ resolveAssignmentProfiles: jest.fn(() => ({})) }));
jest.mock("../../../src/stores/loot/logStore", () => ({
    ...jest.requireActual("../../../src/stores/loot/logStore"),
    listLogs: jest.fn(() => []),
    listLogsForEvent: jest.fn(() => []),
}));
jest.mock("../../../src/services/logcheck/logChannel", () => ({ backfillLogTitles: jest.fn(async () => {}) }));

const { loadEventGroups } = require("../../../src/services/events/raidEventGroups");
const settingsStore = require("../../../src/stores/settings/settingsStore");
const discord = require("../../../src/services/discord/discord");
const { createRaidhelperClient, raidhelperDisabled } = require("../../../src/utils/raidhelper/client");
const { getRaidEvent } = require("../../../src/stores/events/raidEventStore");
const { getEvent } = require("../../../src/stores/events/eventStore");
const { listSignups } = require("../../../src/stores/events/signupStore");
const raidplanStore = require("../../../src/stores/raidplan/raidplanStore");
const { getEventSoftres } = require("../../../src/stores/events/eventSoftresStore");
const logStore = require("../../../src/stores/loot/logStore");
const { backfillLogTitles } = require("../../../src/services/logcheck/logChannel");
const { buildRaidDetail, _internal } = require("../../../src/web/events/raidDetailView");
const { getRaidDetail } = require("../../../src/web/apiRoutes/events/raidDetail");
const { mockRes, status, json } = require("../../helpers/http");
const { knownChannels } = require("../../helpers/linkCheck");
const notes = require("../../../src/stores/roster/userNotesStore");
const { tempStoreFile } = require("../../helpers/tempStore");

// The Discord channels these tests link exist (#537: only a link to an existing channel is shown).
beforeEach(() => knownChannels("c1", "c2", "c"));

const FUTURE = Math.floor(Date.now() / 1000) + 86400;
const PAST = Math.floor(Date.now() / 1000) - 86400;
const SLOTS = [
    { name: "Tanki", userId: "u1", className: "Warrior", specName: "Protection", groupNumber: 1, slotNumber: 1 },
    { name: "Heili", userId: "u2", className: "Paladin", specName: "Holy", groupNumber: 1, slotNumber: 2 },
];
const rhEvent = (over = {}) => ({
    id: "rh1", source: "raidhelper", title: "Kara Montag", startTime: FUTURE, channelId: "c1", channelName: "kara", channelState: "ok",
    signupCount: 2, signUps: [{ userId: "u1", specName: "Protection", status: "signed" }], ...over,
});
const ownEvent = (over = {}) => ({
    id: "eh-1", source: "eventhelper", title: "Tempest Keep", startTime: FUTURE, channelId: "c2", channelName: "tk",
    signupCount: 1, signUps: [{ userId: "u7", specName: "Arms", status: "signed" }], size: 25, signupDeadline: FUTURE - 3600,
    instanceIds: ["tempest-keep"], ...over,
});
const groupsWith = (event, extra = {}) => ({ groups: [{ categoryId: "cat1", categoryName: "TBC", events: [event] }], error: null, stale: false, ...extra });
const rhClient = (getSetup) => createRaidhelperClient.mockReturnValue({ getSetup });

const sent = (r) => ({ status: status(r), body: json(r) });

beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    settingsStore.getConfig.mockReturnValue({});
    rhClient(async () => ({ setup: SLOTS }));
    discord.listMembersWithRoles.mockResolvedValue({ members: [{ id: "u1", name: "Tanki" }, { id: "u9", name: "Fehlt" }], error: null });
});
afterEach(() => console.error.mockRestore());

describe("web/events/raidDetailView buildRaidDetail", () => {
    it("fails with 404 for an unknown event and with 400 when the events could not be loaded", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(rhEvent()));
        expect(await buildRaidDetail({ guildId: "g1", eventId: "weg" })).toEqual({ error: { status: 404, code: "not_found", message: "Event nicht gefunden." } });
        loadEventGroups.mockResolvedValue({ groups: [], error: "Raid-Helper down", stale: true });
        expect(await buildRaidDetail({ guildId: "g1", eventId: "weg" })).toEqual({ error: { status: 400, code: "events_unavailable", message: "Raid-Helper down" } });
        expect(loadEventGroups).toHaveBeenCalledWith("g1", { sinceSeconds: 123 });
    });

    it("builds a Raid-Helper event: live setup, attendance, sheet match, steps null", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(rhEvent()));
        settingsStore.getConfig.mockReturnValue({ categoryRoles: { cat1: ["r1"] }, categoryLootTool: { cat1: "gargul" } });
        raidplanStore.getPlan.mockReturnValue({ link: { enabled: true } });
        raidhelperDisabled.mockReturnValue(true);
        const { body } = await buildRaidDetail({ guildId: "g1", eventId: "rh1" });
        expect(Object.keys(body)).toEqual([
            "event", "planning", "setupFromSnapshot", "categoryName", "openToAll", "guildId", "eventsWarning", "notifyTemplates", "roles",
            "raidsheets", "matchedSheetId", "setup", "setupError", "tankCandidates", "eventSheet", "sheetLink", "raidplanPost", "eventSoftres",
            "softresCatalogue", "softresEdition", "softresOff", "versionId", "wowheadPath", "archived", "softresSuggested", "attendance", "ownSignups", "ownSetup", "raidGroup", "ownSetupPost",
            "ownSetupEditors", "attendanceRoleIds", "attendanceSource", "membersError", "signupTarget", "roleTargets", "lootItems", "lootTool", "lootSystem", "eventLogs", "unlinkedLogs",
            "orga", "viewer", "progress", "steps", "playerSummaries",
        ]);
        // no rights handed in: no Vermerke short form either (only `rights.canSeeShort` adds it, #981)
        // no rights handed in (an older caller): the orga's view counts as the orga's rights
        expect(body.viewer).toEqual({ canOrga: true, canPlan: true, canSwitchPlan: true });
        expect(body.event).toEqual({
            id: "rh1", source: "raidhelper", title: "Kara Montag", startTime: FUTURE, channelId: "c1", channelName: "kara", channelState: "ok",
            signupCount: 2, isPast: false, signupsKnown: true, signUpsFromSnapshot: false, raidplanEnabled: true, raidhelperDisabled: true,
        });
        expect(body.setup.groups).toHaveLength(1);
        expect(body.setupFromSnapshot).toBe(false);
        expect(body.tankCandidates.length).toBeGreaterThan(0);
        expect(body.attendance.responded.map((m) => m.id)).toEqual(["u1"]);
        expect(body.attendance.missing.map((m) => m.id)).toEqual(["u9"]);
        expect(body.attendanceRoleIds).toEqual(["r1"]);
        // a category with raider roles is no PuG raid
        expect(body.openToAll).toBe(false);
        expect(body.signupTarget).toBe(2);
        expect(body.matchedSheetId).toBe("sheet-kara");
        expect(body.softresEdition).toBe("tbc");
        expect(body.softresCatalogue.every((g) => g.edition === "tbc")).toBe(true);
        expect(body.softresSuggested).toContain("kara");
        expect(body.lootTool).toBe("gargul");
        expect(body.ownSignups).toBeNull();
        expect(body.steps).toBeNull();
        expect(Array.isArray(body.progress.steps)).toBe(true);
        // the plan is switched on but empty (#502): nothing posted, nothing to post
        expect(body.raidplanPost).toEqual({ filled: false, published: false, publicPath: "", channelId: "", messageId: "", message: "", postedAt: 0 });
        expect(body.progress.steps.map((s) => s.key)).toContain("raidplan");
        // no fixed sheet and no pick: the category plans with the raid plan, so there is no sheet step
        expect(body.planning).toBe("raidplan");
        expect(body.progress.steps.map((s) => s.key)).not.toContain("sheet");
        expect(body.eventsWarning).toBeNull();
        expect(body.roles).toEqual([{ id: "r1", name: "Raider" }]);
    });

    it("leaves the raid plan out of a category that plans with a sheet", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(rhEvent()));
        settingsStore.getConfig.mockReturnValue({ categoryPlanning: { cat1: "sheet" } });
        raidplanStore.getPlan.mockReturnValue({ link: { enabled: true } });
        const { body } = await buildRaidDetail({ guildId: "g1", eventId: "rh1" });
        expect(body.planning).toBe("sheet");
        expect(body.event.raidplanEnabled).toBe(false);
        expect(body.raidplanPost).toBeNull();
        expect(body.progress.steps.map((s) => s.key)).toEqual(expect.arrayContaining(["sheet"]));
        expect(body.progress.steps.map((s) => s.key)).not.toContain("raidplan");
    });

    it("plans a version without a raid sheet layout with the raid plan, whatever the category picked (#751)", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(rhEvent()));
        settingsStore.getConfig.mockReturnValue({ categoryVersion: { cat1: "forever" }, categoryPlanning: { cat1: "sheet" } });
        const { body } = await buildRaidDetail({ guildId: "g1", eventId: "rh1" });
        expect(body.planning).toBe("raidplan");
        expect(body.progress.steps.map((s) => s.key)).not.toContain("sheet");
    });

    it("follows the version of the event's category (#542): no softres edition, no TBC list, the version's own sheet", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(rhEvent()));
        settingsStore.getConfig.mockReturnValue({
            categoryVersion: { cat1: "forever" },
            versionSettings: { tbc: { softresEdition: "tbc", wowheadPath: "tbc", raidsheetId: "sheet-kara" }, forever: { raidsheetId: "sheet-fv" } },
        });
        settingsStore.listRaidsheets.mockReturnValueOnce([
            { id: "sheet-kara", name: "Karazhan", keywords: ["kara"] },
            { id: "sheet-fv", name: "Forever", keywords: [] },
        ]);
        const { body } = await buildRaidDetail({ guildId: "g1", eventId: "rh1" });
        expect(body.versionId).toBe("forever");
        expect(body.softresEdition).toBe("");
        expect(body.softresCatalogue).toEqual([]);
        expect(body.softresSuggested).toEqual([]);
        expect(body.wowheadPath).toBe("");
        // "Kara Montag" names the TBC sheet's keyword, but that sheet is TBC's own
        expect(body.matchedSheetId).toBe("sheet-fv");
    });

    it("falls back to the frozen snapshot when Raid-Helper returns an empty raidplan or fails", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(rhEvent()));
        getRaidEvent.mockReturnValue({ setup: SLOTS });
        rhClient(async () => ({ setup: [] }));
        let { body } = await buildRaidDetail({ guildId: "g1", eventId: "rh1" });
        expect(body.setupFromSnapshot).toBe(true);
        expect(body.setup.groups).toHaveLength(1);
        rhClient(async () => { throw new Error("rh down"); });
        ({ body } = await buildRaidDetail({ guildId: "g1", eventId: "rh1" }));
        expect(body.setupFromSnapshot).toBe(true);
        expect(body.setupError).toBeNull();
        expect(body.tankCandidates.length).toBeGreaterThan(0);
    });

    it("reports a setup that could not be loaded when there is no snapshot", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(rhEvent()));
        getRaidEvent.mockReturnValue(null);
        rhClient(async () => { throw new Error("rh down"); });
        let { body } = await buildRaidDetail({ guildId: "g1", eventId: "rh1" });
        expect(body.setup).toBeNull();
        expect(body.setupError).toBe("rh down");
        expect(body.tankCandidates).toEqual([]);
        rhClient(async () => { throw new Error(""); });
        ({ body } = await buildRaidDetail({ guildId: "g1", eventId: "rh1" }));
        expect(body.setupError).toBe("Setup konnte nicht geladen werden.");
    });

    it("builds an own event: manage state, own signups with names, size as target, five steps", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(ownEvent(), { stale: true }));
        settingsStore.getConfig.mockReturnValue({ categoryRoles: { cat1: ["r1"] } });
        getEvent.mockReturnValue({
            status: "cancelled", signupsClosed: true, cancel: { reason: "Urlaub", archived: true }, log: [{}, {}], autoSuggest: true,
            setupPost: { channelId: "c2", messageId: "m1", version: 3, dms: { total: 5, sent: 4, failed: ["x"] } },
            setup: { status: "approved", version: 3, groups: [{ slots: [{}, {}] }], bench: [{}], pool: [], checks: { ok: true } }, size: 25,
        });
        listSignups.mockReturnValue([{ userId: "u7", character: "Devihra", spec: "Warrior-Arms", role: "melee", status: "signed" }]);
        const { body } = await buildRaidDetail({ guildId: "g1", eventId: "eh-1" });
        expect(createRaidhelperClient).not.toHaveBeenCalled();
        expect(body.event).toMatchObject({
            source: "eventhelper", status: "cancelled", signupsClosed: true, cancelReason: "Urlaub", cancelArchived: true,
            logCount: 2, autoSuggest: true, size: 25, signupDeadline: FUTURE - 3600, raidplanEnabled: true,
        });
        expect(body.event).not.toHaveProperty("raidhelperDisabled");
        expect(body.setup).toEqual(expect.objectContaining({ groups: [] }));
        expect(body.ownSetupPost).toEqual({ channelId: "c2", messageId: "m1", version: 3, dms: { total: 5, sent: 4, failed: 1 } });
        expect(body.ownSetup).toMatchObject({ status: "approved", placed: 2, bench: 1, ok: true });
        expect(body.ownSignups).toEqual([expect.objectContaining({ userId: "u7", name: "Name u7" })]);
        expect(body.signupTarget).toBe(25);
        expect(body.softresSuggested).toEqual(expect.any(Array));
        expect(Array.isArray(body.steps.steps || body.steps)).toBe(true);
        expect(body.eventsWarning).toBe("Raid-Helper aktuell nicht erreichbar — zeige zwischengespeicherte Event-Daten.");
        // the stored record is read once for the head, the setup state and its post
        expect(getEvent).toHaveBeenCalledTimes(1);
    });

    it("sends the outside reads out side by side: Raid-Helper, Discord and Warcraft Logs do not wait for each other", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(rhEvent()));
        settingsStore.getConfig.mockReturnValue({ categoryRoles: { cat1: ["r1"] } });
        let answerSetup;
        rhClient(() => new Promise((resolve) => { answerSetup = resolve; }));
        const pending = buildRaidDetail({ guildId: "g1", eventId: "rh1" });
        await new Promise((resolve) => setImmediate(resolve));
        // Raid-Helper has not answered yet, and the member list and the log titles are already asked
        expect(discord.listMembersWithRoles).toHaveBeenCalledTimes(1);
        expect(backfillLogTitles).toHaveBeenCalledTimes(1);
        answerSetup({ setup: SLOTS });
        const { body } = await pending;
        expect(body.setup.groups).toHaveLength(1);
        expect(body.attendance.missing.map((m) => m.id)).toEqual(["u9"]);
    });

    it("waits for the slowest outside read, not for the sum of them", async () => {
        jest.useFakeTimers();
        try {
            loadEventGroups.mockResolvedValue(groupsWith(rhEvent()));
            settingsStore.getConfig.mockReturnValue({ categoryRoles: { cat1: ["r1"] } });
            const after = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));
            rhClient(() => after(1000, { setup: SLOTS }));
            discord.listMembersWithRoles.mockImplementation(() => after(1000, { members: [{ id: "u1", name: "Tanki" }], error: null }));
            backfillLogTitles.mockImplementation(() => after(1000, 0));
            let done = false;
            const pending = buildRaidDetail({ guildId: "g1", eventId: "rh1" }).then((r) => { done = true; return r; });
            await jest.advanceTimersByTimeAsync(1000);
            expect(done).toBe(true); // in sequence it would still need two more seconds
            expect((await pending).body.setup.groups).toHaveLength(1);
        } finally {
            jest.useRealTimers();
            backfillLogTitles.mockImplementation(async () => {});
        }
    });

    // Posting the plan's link is a raid plan write (docs/permissions.md): without it there is no step to nudge.
    it("leaves out the plan's link state and the \"Einteilungen\" step for a reader who may not post it", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(ownEvent()));
        getEvent.mockReturnValue({ status: "active", setup: null });
        const ids = (body) => body.steps.steps.map((s) => s.id);
        const all = (await buildRaidDetail({ guildId: "g1", eventId: "eh-1" })).body;
        expect(ids(all)).toContain("plan");
        const without = (await buildRaidDetail({ guildId: "g1", eventId: "eh-1", planPost: false })).body;
        expect(ids(without)).toEqual(ids(all).filter((id) => id !== "plan"));
        expect(without.raidplanPost).toBeNull();
    });

    it("measures the missing list against the roster's core and trial members where the category has a roster (#658)", async () => {
        const rosterStore = require("../../../src/stores/roster/rosterStore");
        rosterStore.rosterForCategory.mockReturnValue({ roleIds: [], members: { u1: { status: "core" }, u5: { status: "trial" }, u6: { status: "bench" } } });
        discord.listHumanMembers.mockResolvedValueOnce({ members: [{ id: "u1", displayName: "Tanki" }, { id: "u5", displayName: "Neu" }, { id: "u6", displayName: "Bank" }], error: null });
        try {
            loadEventGroups.mockResolvedValue(groupsWith(rhEvent()));
            const { body } = await buildRaidDetail({ guildId: "g1", eventId: "rh1" });
            expect(body.attendanceSource).toBe("roster");
            expect(body.attendanceRoleIds).toEqual([]);
            expect(body.attendance.missing.map((m) => m.id)).toEqual(["u5"]);
            expect(body.attendance.responded.map((m) => m.id)).toEqual(["u1"]);
            expect(discord.listMembersWithRoles).not.toHaveBeenCalled();
            expect(body.signupTarget).toBe(2);
        } finally {
            rosterStore.rosterForCategory.mockReturnValue(null);
        }
    });

    it("leaves the member list alone when the roster of a past raid is unknown", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(rhEvent({ startTime: PAST, signUps: [] })));
        settingsStore.getConfig.mockReturnValue({ categoryRoles: { cat1: ["r1"] } });
        const { body } = await buildRaidDetail({ guildId: "g1", eventId: "rh1" });
        expect(discord.listMembersWithRoles).not.toHaveBeenCalled();
        expect(body.event).toMatchObject({ isPast: true, signupsKnown: false });
        expect(body.attendance).toEqual({ responded: [], missing: [] });
        expect(body.signupTarget).toBe(0);
    });

    it("takes the signup target from a created softres list", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(rhEvent()));
        getEventSoftres.mockReturnValue({ instances: ["kara"] });
        const { body } = await buildRaidDetail({ guildId: "g1", eventId: "rh1" });
        expect(body.signupTarget).toBe(10);
    });

    it("lists this event's logs and the unassigned ones of this guild, with their evaluated sections", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(rhEvent()));
        const own = { id: "l1", eventId: "rh1", status: "done" };
        logStore.listLogsForEvent.mockReturnValue([own]);
        logStore.listLogs.mockReturnValue([own, { id: "l2", guildId: "g1" }, { id: "l3", guildId: "g2" }, { id: "l4", guildId: "g1", sections: ["rpb"] }, { id: "l5" }]);
        const { body } = await buildRaidDetail({ guildId: "g1", eventId: "rh1" });
        expect(body.eventLogs).toEqual([{ id: "l1", eventId: "rh1", status: "done", sections: ["cla"] }]);
        expect(body.unlinkedLogs.map((l) => [l.id, l.sections])).toEqual([["l2", []], ["l4", ["rpb"]]]);
        expect(backfillLogTitles).toHaveBeenCalledTimes(1);
    });
});

describe("web/events/raidDetailView parts", () => {
    it("setupPostState is null until the setup was posted", () => {
        getEvent.mockReturnValue({ setupPost: { channelId: "c" } });
        expect(_internal.setupPostState("e")).toBeNull();
        getEvent.mockReturnValue(null);
        expect(_internal.setupPostState("e")).toBeNull();
        getEvent.mockReturnValue({ setupPost: { messageId: "m" } });
        expect(_internal.setupPostState("e")).toEqual({ channelId: "", messageId: "m", version: 0, dms: null });
    });

    it("manageState has defaults for an event it does not know", () => {
        getEvent.mockReturnValue(null);
        expect(_internal.manageState("e")).toEqual({
            status: "active", signupsClosed: false, cancelReason: "", cancelArchived: false, logCount: 0, autoSuggest: false,
        });
    });

    it("raidplanSwitchedOn reads the plan's link", () => {
        raidplanStore.getPlan.mockReturnValue({ link: { enabled: false } });
        expect(_internal.raidplanSwitchedOn("e")).toBe(false);
        raidplanStore.getPlan.mockReturnValue(null);
        expect(_internal.raidplanSwitchedOn("e")).toBe(false);
    });
});

describe("GET /api/raids/detail (the route only speaks HTTP)", () => {
    it("sends the payload as data", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(rhEvent()));
        const r = mockRes();
        await getRaidDetail({ headers: {} }, r, new URL("http://x/api/raids/detail?event=%20rh1%20"));
        const { status, body } = sent(r);
        expect(status).toBe(200);
        expect(body.data.event.id).toBe("rh1");
        expect(body.data.guildId).toBe("g1");
    });

    it("sends the failure with its status", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(rhEvent()));
        const r = mockRes();
        await getRaidDetail({ headers: {} }, r, new URL("http://x/api/raids/detail"));
        expect(sent(r)).toEqual({ status: 404, body: { error: { code: "not_found", message: "Event nicht gefunden." } } });
    });

    it("hands the \"Einteilungen\" step only to a caller with raidplan write", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(ownEvent()));
        getEvent.mockReturnValue({ status: "active", setup: null });
        const stepIds = async (user) => {
            mockUser = user;
            const r = mockRes();
            await getRaidDetail({ headers: {} }, r, new URL("http://x/api/raids/detail?event=eh-1"));
            return json(r).data.steps.steps.map((s) => s.id);
        };
        try {
            // the step bar is the orga's (a raider gets none, see "a raider's read" below): every caller here is an orga role
            expect(await stepIds(ADMIN)).toContain("plan");
            expect(await stepIds({ id: "o", isAdmin: false, isOrga: true, access: { raids: { read: true, write: true } } })).not.toContain("plan");
            expect(await stepIds({ id: "p", isAdmin: false, isOrga: true, access: { raids: { read: true, write: false }, raidplan: { read: true, write: false } } })).not.toContain("plan");
            expect(await stepIds({ id: "w", isAdmin: false, isOrga: true, access: { raids: { read: true, write: false }, raidplan: { read: true, write: true } } })).toContain("plan");
        } finally {
            mockUser = ADMIN;
        }
    });
});

describe("a raider's read (Oct 2026: raids of foreign categories and the orga's parts are the orga's)", () => {
    const RAIDER = { id: "u7", name: "Rai", isAdmin: false, access: { raids: { read: true, write: true } } };
    const ORGA_ROLE = { id: "o1", name: "Lead", isAdmin: false, isOrga: true, access: { raids: { read: true, write: true } } };
    const read = async (user, eventId) => {
        mockUser = user;
        const r = mockRes();
        await getRaidDetail({ headers: {} }, r, new URL(`http://x/api/raids/detail?event=${eventId}`));
        mockUser = ADMIN;
        return sent(r);
    };
    const rosterStore = require("../../../src/stores/roster/rosterStore");
    const signupStore = require("../../../src/stores/events/signupStore");
    const signups = [
        { userId: "u7", character: "Rai", spec: "Warrior-Arms", status: "signed", canAlso: ["tank"], comment: "mine", at: 1 },
        { userId: "u8", character: "Other", spec: "Mage-Fire", status: "absence", canAlso: ["healer"], comment: "secret", at: 2 },
    ];

    beforeEach(() => {
        rosterStore.rosterForCategory.mockReturnValue(null);
        signupStore.listSignups.mockReturnValue([]);
        getEvent.mockReturnValue(null);
    });

    it("answers a raid of a foreign category with the 404 of an unknown one; the orga role opens it", async () => {
        // cat1 is no event category: hidden from the raider, even with raids write
        settingsStore.getConfig.mockReturnValue({ categoryIds: ["other"] });
        loadEventGroups.mockResolvedValue(groupsWith(rhEvent({ signUps: [] })));
        expect(await read(RAIDER, "rh1")).toEqual({ status: 404, body: { error: { code: "not_found", message: "Event nicht gefunden." } } });
        expect((await read(ORGA_ROLE, "rh1")).status).toBe(200);
    });

    it("shows a foreign raid the raider signed up for, and one whose roster opened its raids", async () => {
        settingsStore.getConfig.mockReturnValue({ categoryIds: ["other"] });
        loadEventGroups.mockResolvedValue(groupsWith(rhEvent({ signUps: [{ userId: "u7", specName: "Arms", status: "signed" }] })));
        expect((await read(RAIDER, "rh1")).status).toBe(200);
        loadEventGroups.mockResolvedValue(groupsWith(rhEvent({ signUps: [] })));
        rosterStore.rosterForCategory.mockReturnValue({ categoryId: "cat1", publicRaids: true, roleIds: [], members: {} });
        expect((await read(RAIDER, "rh1")).status).toBe(200);
    });

    it("leaves the orga's parts out: logs, attendance, other people's comments, summaries, steps, dialog data", async () => {
        settingsStore.getConfig.mockReturnValue({ categoryRoles: { cat1: ["r1"] } });
        // a stale event list: the orga would read the sync warning, a raider does not
        loadEventGroups.mockResolvedValue(groupsWith(ownEvent(), { stale: true, error: "Raid-Helper down" }));
        getEvent.mockReturnValue({ status: "active", setup: null, log: [{ action: "x" }, { action: "y" }] });
        signupStore.listSignups.mockReturnValue(signups);
        getEventSoftres.mockReturnValue({ url: "https://softres.it/raid/abc", editUrl: "https://softres.it/raid/abc?token=t", token: "t", instances: ["kara"], amount: 2, postedMessage: "hi" });
        logStore.listLogsForEvent.mockReturnValue([{ id: "l1", title: "Log", status: "done" }]);
        logStore.listLogs.mockReturnValue([{ id: "l2", title: "Frei", status: "open" }]);
        const { status: code, body } = await read(RAIDER, "eh-1");
        expect(code).toBe(200);
        const d = body.data;
        expect(d.orga).toBe(false);
        expect(d.eventLogs).toEqual([]);
        expect(d.unlinkedLogs).toEqual([]);
        expect(d.attendance).toEqual({ responded: [], missing: [] });
        expect(d.attendanceRoleIds).toEqual([]);
        expect(d.attendanceSource).toBeNull();
        expect(d.membersError).toBeNull();
        expect(d.notifyTemplates).toEqual([]);
        expect(d.roles).toEqual([]);
        expect(d.raidsheets).toEqual([]);
        expect(d.ownSetupEditors).toEqual([]);
        expect(d.playerSummaries).toEqual({});
        expect(d.steps).toBeNull();
        expect(d.progress).toEqual({ steps: [], next: "", primary: null });
        expect(d.event.logCount).toBe(0);
        expect(d.eventsWarning).toBeNull();
        expect(d).not.toHaveProperty("pingTargets");
        // the softres link stays, the edit link and the posted message do not
        expect(d.eventSoftres).toEqual({ url: "https://softres.it/raid/abc", editUrl: "", edition: "", instances: ["kara"], amount: 2, hardReserveCount: 0 });
        // the signup list keeps names, characters, specs and roles; only the raider's own comment and "kann auch" stay
        const mine = d.ownSignups.find((s) => s.userId === "u7");
        const other = d.ownSignups.find((s) => s.userId === "u8");
        expect(mine).toMatchObject({ character: "Rai", comment: "mine", canAlso: ["tank"] });
        expect(other).toMatchObject({ character: "Other", name: "Name u8", comment: "", canAlso: [] });
        // nothing of the orga's parts was even read
        expect(discord.listMembersWithRoles).not.toHaveBeenCalled();
        expect(backfillLogTitles).not.toHaveBeenCalled();
    });

    it("keeps all of it for the orga role", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(ownEvent()));
        getEvent.mockReturnValue({ status: "active", setup: null });
        signupStore.listSignups.mockReturnValue(signups);
        const d = (await read(ORGA_ROLE, "eh-1")).body.data;
        expect(d.orga).toBe(true);
        expect(d.ownSignups.find((s) => s.userId === "u8")).toMatchObject({ comment: "secret", canAlso: ["healer"] });
        expect(d.steps).not.toBeNull();
        expect(d.notifyTemplates).toEqual([{ id: "n1" }]);
        // the global orga with raids write: every raid's actions, every role of the server for the Aufruf
        expect(d.viewer).toEqual({ canOrga: true, canPlan: false, canSwitchPlan: false });
        expect(d.roles).toEqual([{ id: "r1", name: "Raider" }]);
    });
});

// #729: the orga of a category (a manager of its current roster, no orga rank, no raider role of the category)
describe("the orga of the raid's category", () => {
    const MANAGER = { id: "m1", name: "Mgr", isAdmin: false, access: { raids: { read: true, write: false } } };
    const rosterStore = require("../../../src/stores/roster/rosterStore");
    const signupStore = require("../../../src/stores/events/signupStore");
    const ROSTER = { id: "r-cat1", categoryId: "cat1", versionId: "tbc", guildId: "g1", managers: { userIds: ["m1"], roleIds: [] }, members: {}, roleIds: ["r1"] };
    const read = async (user, eventId) => {
        mockUser = user;
        const r = mockRes();
        await getRaidDetail({ headers: {} }, r, new URL(`http://x/api/raids/detail?event=${eventId}`));
        mockUser = ADMIN;
        return sent(r);
    };

    beforeEach(() => {
        // cat1 is no category they may sign up for: only the roster makes the raid theirs
        settingsStore.getConfig.mockReturnValue({ categoryIds: ["other"] });
        rosterStore.listRosters.mockReturnValue([ROSTER]);
        rosterStore.rosterForCategory.mockImplementation((cat, version) => (cat === "cat1" && (!version || version === "tbc") ? ROSTER : null));
        signupStore.listSignups.mockReturnValue([]);
        discord.listRoles.mockReturnValue([{ id: "r1", name: "Raider" }, { id: "r-other", name: "Andere" }, { id: "r-admin", name: "Admin" }]);
        getEvent.mockImplementation((id) => (id === "eh-1" ? { id: "eh-1", guildId: "g1", categoryId: "cat1", versionId: "tbc", status: "active", setup: null } : null));
    });
    afterEach(() => {
        rosterStore.listRosters.mockReturnValue([]);
        rosterStore.rosterForCategory.mockReset();
        rosterStore.rosterForCategory.mockReturnValue(null);
        discord.listRoles.mockReturnValue([{ id: "r1", name: "Raider" }]);
        getEvent.mockReset();
        getEvent.mockReturnValue(null);
    });

    it("opens their raid without a raider role (no 404), in the orga's view with the orga's rights", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(ownEvent()));
        const { status: code, body } = await read(MANAGER, "eh-1");
        expect(code).toBe(200);
        const d = body.data;
        expect(d.orga).toBe(true);
        expect(d.steps).not.toBeNull();
        expect(d.notifyTemplates).toEqual([{ id: "n1" }]);
        // their raid plan too (#726): the tab and the Raid-Helper switch, without the area `raidplan`
        expect(d.viewer).toEqual({ canOrga: true, canPlan: true, canSwitchPlan: true });
        // the Anmelde-Aufruf offers the raider roles of the category only (POST /api/raids/notify refuses the rest)
        expect(d.roles).toEqual([{ id: "r1", name: "Raider" }]);
    });

    it("gets none of the server's unassigned logs without `cla` write - they are every category's (review #729)", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(ownEvent()));
        logStore.listLogsForEvent.mockReturnValue([{ id: "l-own", eventId: "eh-1", status: "done" }]);
        logStore.listLogs.mockReturnValue([{ id: "l-free", guildId: "g1", title: "Fremde Kategorie" }]);
        try {
            let d = (await read(MANAGER, "eh-1")).body.data;
            expect(d.eventLogs.map((l) => l.id)).toEqual(["l-own"]);
            expect(d.unlinkedLogs).toEqual([]);
            // with `cla` write the "Log zuordnen" dialog is theirs, and its candidates with it
            d = (await read({ ...MANAGER, access: { ...MANAGER.access, cla: { read: true, write: true } } }, "eh-1")).body.data;
            expect(d.unlinkedLogs.map((l) => l.id)).toEqual(["l-free"]);
        } finally {
            logStore.listLogsForEvent.mockReturnValue([]);
            logStore.listLogs.mockReturnValue([]);
        }
    });

    it("keeps a raid of another category as before: 404 without a signup, the raider's view with one", async () => {
        const foreign = { ...ownEvent({ id: "eh-2" }) };
        loadEventGroups.mockResolvedValue({ groups: [{ categoryId: "cat2", categoryName: "Andere", events: [foreign] }], error: null, stale: false });
        expect((await read(MANAGER, "eh-2")).status).toBe(404);
        loadEventGroups.mockResolvedValue({ groups: [{ categoryId: "cat2", categoryName: "Andere", events: [{ ...foreign, signUps: [{ userId: "m1", status: "signed" }] }] }], error: null, stale: false });
        const d = (await read(MANAGER, "eh-2")).body.data;
        expect(d.orga).toBe(false);
        expect(d.viewer).toEqual({ canOrga: false, canPlan: false, canSwitchPlan: false });
        expect(d.roles).toEqual([]);
    });

    it("gives the orga the Vermerke short form of the signed-up people, the raider never (#981)", async () => {
        const MARKER = "VERMERK-MARKER-981";
        notes.useFile(tempStoreFile("user-notes.json"));
        try {
            notes.addEntry("g1", "u7", { level: "shadowban", reason: "behavior", text: MARKER }, { by: "x", byName: MARKER, name: "Arms" });
            notes.addEntry("g1", "m1", { level: "warning", reason: "no_show", text: MARKER }, { by: "x", byName: MARKER, name: "Mgr" });
            notes.addEntry("g1", "u-other", { level: "hint", reason: "loot" }, { by: "x", byName: "x", name: "Other" });
            loadEventGroups.mockResolvedValue(groupsWith(ownEvent()));
            const orga = (await read(MANAGER, "eh-1")).body.data;
            expect(orga.orga).toBe(true);
            // only who is signed up, never the text or the author
            expect(orga.vermerke).toEqual({ u7: { level: "shadowban", reasons: { behavior: 1 } } });
            expect(JSON.stringify(orga)).not.toContain(MARKER);

            // the raider's view of a raid of another category, the noted raider signed up himself
            const foreign = ownEvent({ id: "eh-2", signUps: [{ userId: "m1", status: "signed" }, { userId: "u7", status: "signed" }] });
            loadEventGroups.mockResolvedValue({ groups: [{ categoryId: "cat2", categoryName: "Andere", events: [foreign] }], error: null, stale: false });
            const raider = (await read(MANAGER, "eh-2")).body.data;
            expect(raider.orga).toBe(false);
            expect(raider).not.toHaveProperty("vermerke");
            expect(JSON.stringify(raider)).not.toContain(MARKER);
            expect(JSON.stringify(raider)).not.toMatch(/shadowban|no_show/);
        } finally {
            notes.useFile(null);
        }
    });

    it("gives an orga without raids write (no roster manager) the orga view but no Vermerke short form (#981)", async () => {
        notes.useFile(tempStoreFile("user-notes-orga-read.json"));
        try {
            notes.addEntry("g1", "u7", { level: "shadowban", reason: "behavior" }, { by: "x", byName: "x", name: "Arms" });
            loadEventGroups.mockResolvedValue(groupsWith(ownEvent()));
            const ORGA_READ = { id: "o1", name: "Orga", isAdmin: false, isOrga: true, access: { raids: { read: true, write: false } } };
            const d = (await read(ORGA_READ, "eh-1")).body.data;
            expect(d.orga).toBe(true);
            expect(d).not.toHaveProperty("vermerke");
            expect(JSON.stringify(d)).not.toMatch(/shadowban/);
        } finally {
            notes.useFile(null);
        }
    });

    it("covers who is placed without a signup: a Raid-Helper setup's slots and an own event's stored setup (#981)", async () => {
        notes.useFile(tempStoreFile("user-notes-placed.json"));
        try {
            notes.addEntry("g1", "u2", { level: "warning", reason: "no_show" }, { by: "x", byName: "x", name: "Heili" });
            notes.addEntry("g1", "p1", { level: "hint", reason: "loot" }, { by: "x", byName: "x", name: "Placed" });
            notes.addEntry("g1", "p2", { level: "shadowban", reason: "behavior" }, { by: "x", byName: "x", name: "Bench" });
            // Raid-Helper: u2 stands in the setup (slot id) without a signup (only u1 signed up)
            rhClient(async () => ({ setup: SLOTS.map((s) => ({ ...s, id: s.userId, userId: undefined })) }));
            loadEventGroups.mockResolvedValue(groupsWith(rhEvent()));
            const rh = (await buildRaidDetail({ guildId: "g1", eventId: "rh1", rights: { canOrga: true, canSeeShort: true } })).body;
            expect(rh.vermerke).toEqual({ u2: { level: "warning", reasons: { no_show: 1 } } });

            // own event: p1 placed in a group, p2 on the bench, neither signed up
            loadEventGroups.mockResolvedValue(groupsWith(ownEvent()));
            getEvent.mockImplementation((id) => (id === "eh-1" ? {
                id: "eh-1", guildId: "g1", categoryId: "cat1", versionId: "tbc", status: "active",
                setup: { groups: [{ index: 1, slots: [{ userId: "p1", character: "Placed" }] }], bench: [{ userId: "p2", character: "Bench" }] },
            } : null));
            const own = (await buildRaidDetail({ guildId: "g1", eventId: "eh-1", rights: { canOrga: true, canSeeShort: true } })).body;
            expect(own.vermerke).toEqual({
                p1: { level: "hint", reasons: { loot: 1 } },
                p2: { level: "shadowban", reasons: { behavior: 1 } },
            });
            // the same raid without the right: no field
            const without = (await buildRaidDetail({ guildId: "g1", eventId: "eh-1", rights: { canOrga: true, canSeeShort: false } })).body;
            expect(without).not.toHaveProperty("vermerke");
        } finally {
            notes.useFile(null);
        }
    });

    it("gives a full admin who manages the roster no orga view in \"So sieht es ein Raider\"", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(ownEvent()));
        discord.memberRoleIds.mockClear();
        // effectiveUser of "Ansicht als" with no role: the admin's id, the base access, no admin rank
        const asRaider = { ...MANAGER, viewAs: { roleIds: [], at: 1 } };
        expect((await read(asRaider, "eh-1")).status).toBe(404);
        // viewed as the raider role of the category: the raider's view, never the admin's own manager rights
        settingsStore.getConfig.mockReturnValue({ categoryIds: ["cat1"] });
        const d = (await read({ ...asRaider, viewAs: { roleIds: ["r1"], at: 1 } }, "eh-1")).body.data;
        expect(d.orga).toBe(false);
        expect(d.viewer.canOrga).toBe(false);
        expect(discord.memberRoleIds).not.toHaveBeenCalled();
    });
});

describe("web/events/raidDetailView roleTargetsOf", () => {
    it("reads the planned places per role from an own event's composition", () => {
        expect(_internal.roleTargetsOf({ composition: { tank: 3, healer: 7, melee: 8, ranged: 7 } })).toEqual({ tank: 3, healer: 7, melee: 8, ranged: 7 });
    });

    it("leaves out a role without a planned number, and is null without any", () => {
        expect(_internal.roleTargetsOf({ composition: { tank: 2, healer: 5, melee: null, ranged: undefined } })).toEqual({ tank: 2, healer: 5 });
        expect(_internal.roleTargetsOf({ composition: { tank: 0, healer: 0 } })).toBeNull();
        expect(_internal.roleTargetsOf({})).toBeNull();
        expect(_internal.roleTargetsOf(null)).toBeNull();
    });
});
