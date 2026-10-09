// The start page's data assembly: the top-item card, the next raids and their
// details modal, and the area figures. Raid-Helper, Discord and the stores are
// mocked; the rules applied to their data live in dashboardOverview.js (own test).
jest.mock("../../../src/stores/lootStore", () => {
    const actual = jest.requireActual("../../../src/stores/lootStore");
    return {
        listAll: jest.fn(() => []),
        listByEvent: jest.fn(() => []),
        // The trimming itself is real: the dashboard row's shape is exactly the
        // one the history pages get.
        charLootPreview: actual.charLootPreview,
    };
});
jest.mock("../../../src/stores/settingsStore", () => ({
    getConfig: jest.fn(() => ({})),
    resolveEventSheetLink: jest.fn((own) => (own && own.url ? { url: own.url } : null)),
}));
jest.mock("../../../src/services/events/raidEventGroups", () => ({ loadEventGroups: jest.fn(() => Promise.resolve({ groups: [], error: null })) }));
jest.mock("../../../src/stores/reportStore", () => ({ listReports: jest.fn(() => []), getReport: jest.fn(() => null) }));
jest.mock("../../../src/stores/lootInboxStore", () => ({ listPending: jest.fn(() => []) }));
jest.mock("../../../src/web/characters/roster", () => ({ buildRoster: jest.fn(() => ({ chars: [], categories: [] })) }));
jest.mock("../../../src/stores/raiderCharactersStore", () => ({ resolveAssignmentProfiles: jest.fn(() => ({})) }));
jest.mock("../../../src/stores/raidEventStore", () => ({ listRaidEvents: jest.fn(() => []) }));
// The EventHelper's own events, read through the real adapter (eventSources.js).
jest.mock("../../../src/stores/eventStore", () => ({
    listEvents: jest.fn(() => []), getEvent: jest.fn(), isOwnEventId: (id) => String(id).startsWith("eh-"),
}));
jest.mock("../../../src/stores/signupStore", () => ({ listSignups: jest.fn(() => []) }));
jest.mock("../../../src/services/events/raidEventScan", () => ({ scanRaidEvents: jest.fn(() => Promise.resolve({ error: null })) }));
jest.mock("../../../src/stores/eventSheetStore", () => ({ getEventSheet: jest.fn(() => null) }));
jest.mock("../../../src/stores/eventSoftresStore", () => ({ getEventSoftres: jest.fn(() => null) }));
jest.mock("../../../src/stores/logStore", () => ({ listLogs: jest.fn(() => []) }));
jest.mock("../../../src/services/events/recentEvents", () => ({
    buildRecentEvents: jest.fn(() => []),
    matchLogsForEvent: jest.fn(() => []),
    pendingLogsForEvent: jest.fn(() => []),
}));
jest.mock("../../../src/services/logcheck/logAutoLink", () => ({ autoLinkLogs: jest.fn(() => Promise.resolve()) }));
jest.mock("../../../src/services/logcheck/reportList", () => ({ logPostedAt: jest.fn(() => 0) }));
jest.mock("../../../src/stores/characterStore", () => ({ characterMap: jest.fn(() => ({})) }));
jest.mock("../../../src/utils/raidhelper/client", () => ({ createRaidhelperClient: jest.fn() }));
jest.mock("../../../src/services/discord/discord", () => ({
    getChannelCategoryMap: jest.fn(() => ({})),
    listMembersWithRoles: jest.fn(() => Promise.resolve({ members: [], error: null })),
    listHumanMembers: jest.fn(() => Promise.resolve({ members: [], error: null })),
    resolveUserNames: jest.fn(async () => ({})),
    memberRoleIds: jest.fn(async () => []),
}));
jest.mock("../../../src/stores/rosterStore", () => ({ rosterForCategory: jest.fn(() => null), listRosters: jest.fn(() => []) }));

const lootStore = require("../../../src/stores/lootStore");
const settingsStore = require("../../../src/stores/settingsStore");
const charStore = require("../../../src/stores/characterStore");
const eventSheetStore = require("../../../src/stores/eventSheetStore");
const eventSoftresStore = require("../../../src/stores/eventSoftresStore");
const raidEventGroups = require("../../../src/services/events/raidEventGroups");
const reportStore = require("../../../src/stores/reportStore");
const lootInboxStore = require("../../../src/stores/lootInboxStore");
const { buildRoster } = require("../../../src/web/characters/roster");
const { createRaidhelperClient } = require("../../../src/utils/raidhelper/client");
const discord = require("../../../src/services/discord/discord");
const rosterStore = require("../../../src/stores/rosterStore");
const {
    loadTopLoot, loadNextRaids, loadNextRaidDetails, loadLatestReport, loadRosterFigures, loadInbox, loadNewLoot,
    dashboardVersions, loadTrialEndings,
} = require("../../../src/web/dashboard/dashboardData");

// A loot row as lootStore.listAll() hands it out (already decorated).
const lootRow = (over = {}) => ({
    itemId: 30883, itemName: "Kalter Fels", itemIconUrl: "https://x/i.jpg", itemQuality: 4,
    itemLink: "https://www.wowhead.com/tbc/item=30883", character: "Kilrogg", characterKey: "kilrogg",
    realm: "Thunderstrike",
    response: "BiS", offspec: false, reason: "bis", reasonLabel: "BiS", reasonTone: "good",
    contentId: "ssc", boss: "Hydross", categoryId: "cat1", eventId: "e1", eventLabel: "Montagsraid",
    awardedAt: 1000, source: "gargul", ...over,
});

beforeEach(() => {
    jest.clearAllMocks();
    settingsStore.getConfig.mockReturnValue({});
    lootStore.listAll.mockReturnValue([]);
    charStore.characterMap.mockReturnValue({});
});

describe("web/dashboard/dashboardData loadTopLoot", () => {
    it("returns nothing and reports no configuration when no top items are defined", () => {
        lootStore.listAll.mockReturnValue([lootRow()]);
        expect(loadTopLoot()).toEqual({ items: [], configured: 0 });
    });

    it("keeps only the awards of configured top items", () => {
        settingsStore.getConfig.mockReturnValue({ topItems: [{ id: 30883 }, { id: 32235 }] });
        lootStore.listAll.mockReturnValue([
            lootRow({ itemId: 12345, itemName: "Irgendwas" }),
            lootRow(),
            lootRow({ itemId: 32235, itemName: "Anderes Top-Item", character: "Shalya" }),
        ]);

        const { items, configured } = loadTopLoot();

        expect(configured).toBe(2);
        expect(items.map((it) => [it.itemId, it.character])).toEqual([[30883, "Kilrogg"], [32235, "Shalya"]]);
    });

    // The item id is the only field every export carries; a Gargul row may have
    // no name at all until the Wowhead backfill runs.
    it("matches by item id even when the id arrives as a string", () => {
        settingsStore.getConfig.mockReturnValue({ topItems: [{ id: 30883 }] });
        lootStore.listAll.mockReturnValue([lootRow({ itemId: "30883", itemName: "" })]);
        expect(loadTopLoot().items).toHaveLength(1);
    });

    it("carries the fields the dashboard row renders", () => {
        settingsStore.getConfig.mockReturnValue({ topItems: [{ id: 30883 }] });
        lootStore.listAll.mockReturnValue([lootRow()]);

        expect(loadTopLoot().items[0]).toMatchObject({
            itemId: 30883, itemName: "Kalter Fels", itemIconUrl: "https://x/i.jpg", itemQuality: 4,
            itemLink: "https://www.wowhead.com/tbc/item=30883",
            character: "Kilrogg", realm: "Thunderstrike", boss: "Hydross",
            response: "BiS", reasonLabel: "BiS", reasonTone: "good",
            eventId: "e1", eventLabel: "Montagsraid", awardedAt: 1000,
        });
    });

    // listAll() is already sorted newest-award-first, so the cap keeps the newest.
    it("caps the list at the requested limit", () => {
        settingsStore.getConfig.mockReturnValue({ topItems: [{ id: 30883 }] });
        lootStore.listAll.mockReturnValue([
            lootRow({ character: "A", awardedAt: 3000 }),
            lootRow({ character: "B", awardedAt: 2000 }),
            lootRow({ character: "C", awardedAt: 1000 }),
        ]);
        expect(loadTopLoot(2).items.map((it) => it.character)).toEqual(["A", "B"]);
    });

    it("filters by game version (#545): an own event's version, else TBC", () => {
        settingsStore.getConfig.mockReturnValue({ topItems: [{ id: 30883 }] });
        const eventStore = require("../../../src/stores/eventStore");
        eventStore.getEvent.mockImplementation((id) => (id === "eh-9" ? { versionId: "forever" } : null));
        lootStore.listAll.mockReturnValue([
            lootRow({ character: "Aldric", eventId: "eh-9" }), // WoW Forever
            lootRow({ character: "Kilrogg", eventId: "e1" }), // no own event = TBC
        ]);
        expect(loadTopLoot(5, "forever").items.map((it) => it.character)).toEqual(["Aldric"]);
        expect(loadTopLoot(5, "tbc").items.map((it) => it.character)).toEqual(["Kilrogg"]);
        expect(loadTopLoot(5).items.map((it) => it.character).sort()).toEqual(["Aldric", "Kilrogg"]);
    });

    it("shows at most five awards by default", () => {
        settingsStore.getConfig.mockReturnValue({ topItems: [{ id: 30883 }] });
        lootStore.listAll.mockReturnValue(
            ["A", "B", "C", "D", "E", "F"].map((c, i) => lootRow({ character: c, awardedAt: 6000 - i })),
        );
        expect(loadTopLoot().items.map((it) => it.character)).toEqual(["A", "B", "C", "D", "E"]);
    });

    it("ignores top-item entries without a usable id", () => {
        settingsStore.getConfig.mockReturnValue({ topItems: [{ id: 0 }, { name: "kaputt" }] });
        lootStore.listAll.mockReturnValue([lootRow()]);
        expect(loadTopLoot()).toEqual({ items: [], configured: 0 });
    });

    // Class colour and spec icon come from the character store, resolved
    // server-side like everywhere else in the app.
    describe("class/spec of the winner", () => {
        beforeEach(() => {
            settingsStore.getConfig.mockReturnValue({ topItems: [{ id: 30883 }] });
            lootStore.listAll.mockReturnValue([lootRow()]);
        });

        it("adds the class colour and spec icon of a known character", () => {
            charStore.characterMap.mockReturnValue({ kilrogg: { className: "Mage", spec: "Fire" } });

            const row = loadTopLoot().items[0];

            expect(row.className).toBe("Mage");
            expect(row.spec).toBe("Fire");
            expect(row.classColor).toBe("#69CCF0");
            expect(row.specIconUrl).toMatch(/^https:\/\/wow\.zamimg\.com\/images\/wow\/icons\/large\/.+\.jpg$/);
        });

        it("leaves the look empty for a character nobody resolved yet", () => {
            expect(loadTopLoot().items[0]).toMatchObject({
                className: "", spec: "", classColor: "", specIconUrl: "",
            });
        });

        // Reading the store costs a file read; nothing matched means nothing to
        // annotate.
        it("does not touch the character store when no top item was awarded", () => {
            lootStore.listAll.mockReturnValue([lootRow({ itemId: 999 })]);
            expect(loadTopLoot()).toEqual({ items: [], configured: 1 });
            expect(charStore.characterMap).not.toHaveBeenCalled();
        });
    });
});

describe("web/dashboard/dashboardData loadNextRaids", () => {
    const rh = { getAllEvents: jest.fn(), getSetup: jest.fn() };
    beforeEach(() => {
        createRaidhelperClient.mockReturnValue(rh);
        discord.getChannelCategoryMap.mockReturnValue({
            c1: { name: "bt-donnerstag", categoryId: "cat1" },
            c2: { name: "hyjal-montag", categoryId: "cat2" },
        });
    });

    it("returns nothing without a guild", async () => {
        expect(await loadNextRaids("")).toEqual({ raids: [], error: null });
    });

    it("takes the next raids of the guild with role fill, sheet and softres", async () => {
        rh.getAllEvents.mockResolvedValue([
            { id: "x", title: "Fremd", channelId: "other", startTime: 1 },
            { id: "e1", title: "Black Temple", channelId: "c1", startTime: 100, signUps: [{ specName: "Protection1" }, { specName: "Absence" }] },
            { id: "e2", title: "Hyjal", channelId: "c2", startTime: 200, signUps: [] },
            { id: "e3", title: "Kara", channelId: "c2", startTime: 300 },
        ]);
        rh.getSetup.mockImplementation((id) => (id === "e2"
            ? Promise.resolve({ setup: [{ name: "A", specName: "Holy1" }, { name: "" }] })
            : Promise.reject(new Error("no plan"))));
        eventSheetStore.getEventSheet.mockImplementation((id) => (id === "e2" ? { url: "https://sheet", playerCount: 25, filledAt: "t" } : null));
        eventSoftresStore.getEventSoftres.mockImplementation((id) => (id === "e1" ? { url: "https://softres.it/raid/x" } : null));

        const { raids, error } = await loadNextRaids("g1", 2);

        expect(error).toBeNull();
        expect(raids.map((r) => r.id)).toEqual(["e1", "e2"]);
        expect(raids[0]).toMatchObject({
            channelName: "bt-donnerstag", categoryId: "cat1", icon: "achievement_boss_illidan", size: 25,
            signupCount: 1, setupCount: 0, sheet: null, softres: { url: "https://softres.it/raid/x" },
        });
        expect(raids[0].roles.map((r) => r.filled)).toEqual([1, 0, 0]);
        expect(raids[1]).toMatchObject({ setupCount: 1, sheet: { url: "https://sheet", playerCount: 25, filledAt: "t" }, softres: null });
        expect(raids[1].roles.map((r) => r.filled)).toEqual([0, 1, 0]);
    });

    it("puts the EventHelper's own raids between Raid-Helper's, with their planned size and composition", async () => {
        const eventStore = require("../../../src/stores/eventStore");
        const { listSignups } = require("../../../src/stores/signupStore");
        const future = Math.floor(Date.now() / 1000) + 86400;
        rh.getAllEvents.mockResolvedValue([{ id: "e1", title: "Black Temple", channelId: "c1", startTime: future + 100, signUps: [] }]);
        rh.getSetup.mockResolvedValue({ setup: [] });
        eventStore.listEvents.mockReturnValue([{
            id: "eh-1", source: "eventhelper", guildId: "g1", categoryId: "cat2", categoryName: "Mo", channelId: "c9", channelName: "kara-eh",
            title: "Kara", leaderId: "", startTime: future, versionId: "tbc", instanceIds: ["kara"], size: 10,
            composition: { tank: 2, healer: 3, melee: 0, ranged: 0 },
        }]);
        listSignups.mockReturnValue([{ userId: "u1", spec: "Paladin-Holy", role: "healer", status: "signed" }]);
        try {
            const { raids, error } = await loadNextRaids("g1", 2);
            expect(error).toBeNull();
            expect(raids.map((r) => [r.id, r.source])).toEqual([["eh-1", "eventhelper"], ["e1", "raidhelper"]]);
            expect(raids[0]).toMatchObject({ channelName: "kara-eh", categoryId: "cat2", size: 10, signupCount: 1, setupCount: 0 });
            expect(raids[0].roles.map((r) => [r.filled, r.target])).toEqual([[0, 2], [1, 3], [0, 5]]);
            // no raidplan is asked for at Raid-Helper for an own event
            expect(rh.getSetup).not.toHaveBeenCalledWith("eh-1");
        } finally {
            eventStore.listEvents.mockReturnValue([]);
            listSignups.mockReturnValue([]);
        }
    });

    it("filters by game version (#545): an own event's own, a Raid-Helper one falls back to TBC", async () => {
        const eventStore = require("../../../src/stores/eventStore");
        const future = Math.floor(Date.now() / 1000) + 86400;
        rh.getAllEvents.mockResolvedValue([{ id: "e1", title: "Black Temple", channelId: "c1", startTime: future + 100, signUps: [] }]);
        rh.getSetup.mockResolvedValue({ setup: [] });
        eventStore.listEvents.mockReturnValue([{
            id: "eh-1", source: "eventhelper", guildId: "g1", categoryId: "cat2", categoryName: "Mo", channelId: "c9", channelName: "kara-eh",
            title: "Barrow Deeps", leaderId: "", startTime: future, versionId: "forever", instanceIds: [], size: 10,
            composition: { tank: 2, healer: 3, melee: 0, ranged: 0 },
        }]);
        try {
            const forever = await loadNextRaids("g1", 2, { versionId: "forever" });
            expect(forever.raids.map((r) => r.id)).toEqual(["eh-1"]);
            const tbc = await loadNextRaids("g1", 2, { versionId: "tbc" });
            expect(tbc.raids.map((r) => r.id)).toEqual(["e1"]);
            const all = await loadNextRaids("g1", 2);
            expect(all.raids.map((r) => r.id).sort()).toEqual(["e1", "eh-1"]);
        } finally {
            eventStore.listEvents.mockReturnValue([]);
        }
    });

    it("counts an own event's approved setup (never a draft) and takes its icon from its raids (#291)", async () => {
        const eventStore = require("../../../src/stores/eventStore");
        const future = Math.floor(Date.now() / 1000) + 86400;
        rh.getAllEvents.mockResolvedValue([]);
        const approved = {
            id: "eh-2", source: "eventhelper", guildId: "g1", categoryId: "cat2", channelId: "c9", title: "Mittwoch",
            startTime: future, versionId: "tbc", instanceIds: ["tk", "ssc"], size: 25, composition: { tank: 3, healer: 6 },
            setup: {
                status: "approved",
                approved: { groups: [{ index: 1, slots: [{ userId: "u1", character: "Zibbo", spec: "Priest-Shadow", classId: "Priest", role: "ranged" }] }], bench: [] },
            },
        };
        eventStore.listEvents.mockReturnValue([approved]);
        eventStore.getEvent.mockImplementation((id) => (id === "eh-2" ? approved : null));
        try {
            const { raids } = await loadNextRaids("g1", 1);
            expect(raids[0]).toMatchObject({ id: "eh-2", setupCount: 1, icon: "achievement_boss_kael'thassunstrider_01" });
            eventStore.getEvent.mockImplementation(() => ({ ...approved, setup: { status: "draft", groups: [{ slots: [{ userId: "u1" }] }] } }));
            const draft = await loadNextRaids("g1", 1);
            expect(draft.raids[0].setupCount).toBe(0);
            expect(rh.getSetup).not.toHaveBeenCalled();
        } finally {
            eventStore.listEvents.mockReturnValue([]);
            eventStore.getEvent.mockReset();
        }
    });

    it("reports a Raid-Helper failure instead of throwing", async () => {
        rh.getAllEvents.mockRejectedValue(new Error("kaputt"));
        expect(await loadNextRaids("g1")).toEqual({ raids: [], error: "kaputt" });
    });
});

describe("web/dashboard/dashboardData dashboardVersions", () => {
    const eventStore = require("../../../src/stores/eventStore");

    afterEach(() => {
        eventStore.listEvents.mockReturnValue([]);
    });

    it("without a guild: only the main version, no stored events to read", () => {
        expect(dashboardVersions("", {})).toEqual({
            mainVersion: "tbc",
            versions: [{ id: "tbc", label: "TBC Anniversary", short: "TBC", count: 0 }],
        });
    });

    it("finds every version among the stored (own) events, cheaply — no live Raid-Helper call (#545)", () => {
        eventStore.listEvents.mockReturnValue([
            { id: "eh-1", versionId: "forever", startTime: 1 },
            { id: "eh-2", versionId: "forever", startTime: 2 },
            { id: "eh-3", versionId: "tbc", startTime: 3 },
        ]);
        expect(dashboardVersions("g1", {})).toEqual({
            mainVersion: "tbc",
            versions: [
                { id: "tbc", label: "TBC Anniversary", short: "TBC", count: 1 },
                { id: "forever", label: "WoW Forever", short: "Forever", count: 2 },
            ],
        });
        // Cheap: only the local stored events, never the live Raid-Helper client.
        expect(createRaidhelperClient).not.toHaveBeenCalled();
    });

    it("reads the main version from the given config", () => {
        expect(dashboardVersions("", { config: { mainVersion: "forever" } }).mainVersion).toBe("forever");
    });
});

describe("web/dashboard/dashboardData loadNextRaidDetails", () => {
    const rh = { getSetup: jest.fn(() => Promise.resolve({ setup: [] })) };
    const event = {
        id: "e1", title: "Black Temple", startTime: 100, channelId: "c1", channelName: "bt",
        signUps: [
            { userId: "u1", specName: "Protection1", status: "signed" },
            { userId: "u2", specName: "Holy1", status: "tentative" },
        ],
    };
    beforeEach(() => {
        createRaidhelperClient.mockReturnValue(rh);
        raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [{ categoryId: "cat1", events: [event] }], error: null });
    });

    it("says whether an event is unknown or Raid-Helper failed", async () => {
        expect(await loadNextRaidDetails("g1", "nope")).toEqual({ error: "Event nicht gefunden.", notFound: true });
        raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [], error: "down" });
        expect(await loadNextRaidDetails("g1", "e1")).toEqual({ error: "down", notFound: false });
    });

    it("lists signups per class and who of the category has not signed up", async () => {
        settingsStore.getConfig.mockReturnValue({ categoryRoles: { cat1: ["role1"] } });
        discord.listMembersWithRoles.mockResolvedValue({
            members: [{ id: "u1", displayName: "Brokk" }, { id: "u2", displayName: "Mondklinge" }, { id: "u3", displayName: "Frostbart" }],
            error: null,
        });

        const { raid, error } = await loadNextRaidDetails("g1", "e1");

        expect(error).toBeNull();
        expect(discord.listMembersWithRoles).toHaveBeenCalledWith("g1", ["role1"]);
        expect(raid).toMatchObject({ id: "e1", signupCount: 1, rolesConfigured: true, membersError: null, sheet: null });
        expect(raid.classes).toEqual([expect.objectContaining({ className: "Paladin", count: 1 })]);
        expect(raid.notSignedUp.map((p) => [p.name, p.status])).toEqual([["Mondklinge", "tentative"], ["Frostbart", "none"]]);
        expect(raid.fetchedAt).toEqual(expect.any(Number));
    });

    it("expects the roster's core and trial members where the category has a roster (#658)", async () => {
        rosterStore.rosterForCategory.mockReturnValue({ roleIds: [], members: { u1: { status: "core" }, u3: { status: "trial" }, u4: { status: "pause" } } });
        discord.listHumanMembers.mockResolvedValueOnce({ members: [{ id: "u1", displayName: "Brokk" }, { id: "u3", displayName: "Frostbart" }, { id: "u4", displayName: "Pause" }], error: null });
        const { raid } = await loadNextRaidDetails("g1", "e1");
        expect(discord.listMembersWithRoles).not.toHaveBeenCalled();
        expect(raid.rolesConfigured).toBe(true);
        expect(raid.notSignedUp.map((p) => [p.name, p.status])).toEqual([["Frostbart", "none"]]);
        rosterStore.rosterForCategory.mockReturnValue(null);
    });

    it("skips the member lookup when the category has no raider roles", async () => {
        const { raid } = await loadNextRaidDetails("g1", "e1");
        expect(discord.listMembersWithRoles).not.toHaveBeenCalled();
        expect(raid).toMatchObject({ rolesConfigured: false, notSignedUp: [] });
    });
});

describe("web/dashboard/dashboardData area loaders", () => {
    it("reads the newest report with its open recommendations", () => {
        reportStore.listReports.mockReturnValue([{ id: "r2", zone: "Black Temple", generatedAt: 9 }, { id: "r1" }]);
        reportStore.getReport.mockReturnValue({
            players: [{ issues: [1] }],
            recommendations: { raid: [{ key: "a" }], players: [{ name: "X", items: [{ key: "b" }, { key: "c" }] }] },
            recommendationReview: { raid: {}, players: { X: { b: { approved: true } } } },
        });
        expect(loadLatestReport()).toMatchObject({ id: "r2", zone: "Black Temple", problems: 1, open: 2 });
        expect(reportStore.getReport).toHaveBeenCalledWith("r2");
    });

    it("has no report tile without reports or on an unreadable one", () => {
        reportStore.listReports.mockReturnValue([]);
        expect(loadLatestReport()).toBeNull();
        reportStore.listReports.mockReturnValue([{ id: "r1" }]);
        reportStore.getReport.mockImplementation(() => { throw new Error("broken"); });
        jest.spyOn(console, "error").mockImplementation(() => {});
        expect(loadLatestReport()).toBeNull();
        console.error.mockRestore();
    });

    it("counts the roster and who has no Discord account", () => {
        buildRoster.mockReturnValue({ chars: [{ assigned: true }, { assigned: false }, { assigned: false }] });
        expect(loadRosterFigures("g1")).toEqual({ total: 3, withoutDiscord: 2 });
    });

    it("hands out the pending inbox sessions", () => {
        lootInboxStore.listPending.mockReturnValue([{ id: "s1", items: [1, 2] }, { id: "s2" }]);
        expect(loadInbox()).toEqual([{ id: "s1", items: [1, 2] }, { id: "s2", items: [] }]);
    });

    it("counts top-item awards since the last raid", () => {
        settingsStore.getConfig.mockReturnValue({ topItems: [{ id: 30883 }] });
        const start = 1_800_000_000;
        lootStore.listAll.mockReturnValue([
            lootRow({ awardedAt: start * 1000 + 60_000 }),
            lootRow({ awardedAt: (start - 3 * 86400) * 1000, character: "Alt" }),
        ]);
        expect(loadNewLoot(start)).toEqual({ count: 1, since: start * 1000 });
        expect(loadNewLoot(0)).toEqual({ count: 0, since: 0 });
    });
});

describe("web/dashboard/dashboardData loadMissingChannels (#537)", () => {
    const { loadMissingChannels } = require("../../../src/web/dashboard/dashboardData");
    const eventStore = require("../../../src/stores/eventStore");
    const { knownChannels, linkCheck } = require("../../helpers/linkCheck");
    const now = 1_800_000_000_000;

    afterEach(() => linkCheck._reset());

    it("lists the upcoming own raids whose channel is known to be gone, soonest first", async () => {
        knownChannels("c-ok");
        linkCheck.channelDeleted("c-gone");
        linkCheck.channelDeleted("c-gone2");
        eventStore.listEvents.mockReturnValueOnce([
            { id: "eh-3", title: "Gruul", startTime: 300, channelId: "c-gone2", channelName: "fr-gruul" },
            { id: "eh-1", title: "Kara", startTime: 100, channelId: "c-gone", channelName: "mi-kara" },
            { id: "eh-2", title: "SSC", startTime: 200, channelId: "c-ok" },
            { id: "eh-4", title: "Abgesagt", startTime: 150, channelId: "c-gone", status: "cancelled" },
            { id: "eh-5", title: "Unbekannt", startTime: 160, channelId: "c-unknown" },
        ]);
        const list = await loadMissingChannels("g1", now);
        expect(eventStore.listEvents).toHaveBeenCalledWith("g1", { sinceSeconds: Math.floor(now / 1000) });
        expect(list).toEqual([
            { eventId: "eh-1", title: "Kara", startTime: 100, channelName: "mi-kara" },
            { eventId: "eh-3", title: "Gruul", startTime: 300, channelName: "fr-gruul" },
        ]);
    });

    it("answers nothing without a guild or when the store fails", async () => {
        expect(await loadMissingChannels("")).toEqual([]);
        eventStore.listEvents.mockImplementationOnce(() => { throw new Error("disk"); });
        expect(await loadMissingChannels("g1")).toEqual([]);
    });
});

describe("web/dashboard/dashboardData loadTrialEndings (#658)", () => {
    const NOW = Date.parse("2026-10-09T12:00:00.000Z");
    const DAY = 24 * 60 * 60 * 1000;
    const roster = (over = {}) => ({
        id: "r1", guildId: "g1", name: "Donnerstag", managers: { roleIds: [], userIds: [] },
        members: {
            "111111111111111111": { status: "trial", trialUntil: new Date(NOW + 2 * DAY).toISOString() },
            "222222222222222222": { status: "trial", trialUntil: new Date(NOW + 30 * DAY).toISOString() },
        },
        ...over,
    });

    it("lists the trials ending soon in rosters the caller manages, with the name and the extended end", async () => {
        rosterStore.listRosters.mockReturnValueOnce([roster()]);
        discord.resolveUserNames.mockResolvedValueOnce({ "111111111111111111": "Zibbo" });
        const list = await loadTrialEndings("g1", { id: "9", isAdmin: true }, { now: NOW });
        expect(rosterStore.listRosters).toHaveBeenCalledWith("g1");
        expect(list).toEqual([{
            rosterId: "r1", rosterName: "Donnerstag", userId: "111111111111111111", displayName: "Zibbo",
            trialUntil: new Date(NOW + 2 * DAY).toISOString(), overdue: false, extendTo: new Date(NOW + 16 * DAY).toISOString(),
        }]);
    });

    it("leaves out rosters the caller does not manage, and swallows a failure", async () => {
        rosterStore.listRosters.mockReturnValueOnce([roster()]);
        expect(await loadTrialEndings("g1", { id: "9", isAdmin: false }, { now: NOW })).toEqual([]);
        rosterStore.listRosters.mockReturnValueOnce([roster({ managers: { roleIds: [], userIds: ["9"] } })]);
        expect(await loadTrialEndings("g1", { id: "9", isAdmin: false }, { now: NOW })).toHaveLength(1);
        rosterStore.listRosters.mockImplementationOnce(() => { throw new Error("disk"); });
        jest.spyOn(console, "error").mockImplementationOnce(() => {});
        expect(await loadTrialEndings("g1", { id: "9", isAdmin: true }, { now: NOW })).toEqual([]);
    });
});
