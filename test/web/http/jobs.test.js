// The background jobs moved out of server.js (#424): jobs.js starts each one
// exactly once, in the old order, and stopJobs() ends all of them.
const mockCalls = [];
function mockJob(startName, stopName) {
    return {
        [startName]: jest.fn(() => mockCalls.push(`start:${startName}`)),
        [stopName]: jest.fn(() => mockCalls.push(`stop:${stopName}`)),
    };
}
jest.mock("../../../src/services/discord/discord", () => ({ setClient: jest.fn() }));
jest.mock("../../../src/utils/setup/sheetCleanup", () => mockJob("startSheetCleanup", "stopSheetCleanup"));
jest.mock("../../../src/services/events/raidhelperSync", () => mockJob("startRaidhelperSync", "stopRaidhelperSync"));
jest.mock("../../../src/services/logcheck/wclGuildSync", () => mockJob("startWclGuildSync", "stopWclGuildSync"));
jest.mock("../../../src/services/logcheck/logAutoLink", () => mockJob("startLogAutoLink", "stopLogAutoLink"));
jest.mock("../../../src/services/events/eventMessage", () => mockJob("startEventMessageSync", "stopEventMessageSync"));
jest.mock("../../../src/web/events/reminders", () => mockJob("startReminders", "stopReminders"));
jest.mock("../../../src/services/discord/roleSync", () => mockJob("startRoleSync", "stopRoleSync"));
jest.mock("../../../src/services/roster/rosterRoleSync", () => mockJob("startRosterRoleSync", "stopRosterRoleSync"));
jest.mock("../../../src/services/talk/talkOverview", () => mockJob("startTalkOverview", "stopTalkOverview"));
jest.mock("../../../src/web/events/eventSeries", () => mockJob("startEventSeries", "stopEventSeries"));
jest.mock("../../../src/utils/recruitment/applicationState", () => mockJob("start", "stop"));
jest.mock("../../../src/services/signups/availabilityPanel", () => mockJob("startPanelRefresh", "stopPanelRefresh"));
jest.mock("../../../src/services/events/orgaHub", () => mockJob("startOrgaHubs", "stopOrgaHubs"));
jest.mock("../../../src/services/vermerke/orgaSignupNotice", () => mockJob("startOrgaSignupNotice", "stopOrgaSignupNotice"));
jest.mock("../../../src/services/events/raidOverview", () => mockJob("startRaidOverviews", "stopRaidOverviews"));
jest.mock("../../../src/services/addons/addonCenter", () => mockJob("startAddonCenter", "stopAddonCenter"));
jest.mock("../../../src/services/guildbank/itemMeta", () => mockJob("startMetaRefresh", "stopMetaRefresh"));
jest.mock("../../../src/services/loot/softresDetect", () => mockJob("startSoftresDetect", "stopSoftresDetect"));
jest.mock("../../../src/services/loot/softresStatus", () => mockJob("startSoftresStatus", "stopSoftresStatus"));
jest.mock("../../../src/services/system/systemMonitor", () => mockJob("start", "stop"));
jest.mock("../../../src/services/backup/snapshotJob", () => mockJob("startBackupJob", "stopBackupJob"));
jest.mock("../../../src/services/backup/backupAlerts", () => mockJob("startBackupAlerts", "stopBackupAlerts"));
jest.mock("../../../src/services/backup/restoreTestJob", () => mockJob("startRestoreTestJob", "stopRestoreTestJob"));

const discord = require("../../../src/services/discord/discord");
const { startJobs, stopJobs, JOBS } = require("../../../src/web/http/jobs");

const START_ORDER = [
    "start", "startSheetCleanup", "startRaidhelperSync", "startLogAutoLink", "startWclGuildSync", "startEventMessageSync",
    "startReminders", "startRoleSync", "startRosterRoleSync", "startTalkOverview", "startEventSeries", "start", "startPanelRefresh", "startOrgaHubs", "startOrgaSignupNotice", "startRaidOverviews", "startAddonCenter", "startMetaRefresh", "startSoftresDetect", "startSoftresStatus", "startBackupJob", "startRestoreTestJob", "startBackupAlerts",
];

beforeEach(() => {
    stopJobs();
    mockCalls.length = 0;
    jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => console.log.mockRestore());

describe("web/http/jobs", () => {
    it("starts every job exactly once, in the order server.js and bot.js used", () => {
        const names = startJobs();
        expect(mockCalls).toEqual(START_ORDER.map((n) => `start:${n}`));
        expect(names).toEqual([
            "systemMonitor", "sheetCleanup", "raidhelperSync", "logAutoLink", "wclGuildSync", "eventMessageSync",
            "reminders", "roleSync", "rosterRoleSync", "talkOverview", "eventSeries", "applicationState", "availabilityPanels", "orgaHubs", "orgaSignupNotice", "raidOverviews", "addonCenter", "guildBankItemMeta", "softresDetect", "softresStatus", "backupSnapshots", "backupRestoreTest", "backupAlerts",
        ]);
        expect(JOBS.map((j) => j.name)).toEqual(names);
    });

    it("says once in the log which jobs came up", () => {
        startJobs();
        startJobs();
        const lines = console.log.mock.calls.map((c) => c[0]).filter((l) => /Background jobs started/.test(l));
        expect(lines).toEqual(["Background jobs started: systemMonitor, sheetCleanup, raidhelperSync, logAutoLink, wclGuildSync, eventMessageSync, reminders, roleSync, rosterRoleSync, talkOverview, eventSeries, applicationState, availabilityPanels, orgaHubs, orgaSignupNotice, raidOverviews, addonCenter, guildBankItemMeta, softresDetect, softresStatus, backupSnapshots, backupRestoreTest, backupAlerts"]);
    });

    // #608: what a job asks Raid-Helper counts as background work (utils/raidhelper/budget.js)
    it("starts every job as background work, and the timers it sets keep that", async () => {
        const raidhelperSync = require("../../../src/services/events/raidhelperSync");
        const { isBackground } = require("../../../src/utils/raidhelper/budget");
        let inTimer = null;
        let atStart = null;
        raidhelperSync.startRaidhelperSync.mockImplementationOnce(() => {
            atStart = isBackground();
            setTimeout(() => { inTimer = isBackground(); }, 0).unref();
        });
        startJobs();
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(atStart).toBe(true);
        expect(inTimer).toBe(true);
        expect(isBackground()).toBe(false);
    });

    it("is idempotent: a second call starts nothing", () => {
        startJobs();
        mockCalls.length = 0;
        startJobs();
        expect(mockCalls).toEqual([]);
    });

    it("hands the bot client to the Discord module before any job runs", () => {
        const client = { id: "client" };
        discord.setClient.mockImplementation(() => mockCalls.push("setClient"));
        startJobs(client);
        expect(discord.setClient).toHaveBeenCalledWith(client);
        expect(mockCalls[0]).toBe("setClient");
    });

    it("leaves the client alone when none is passed", () => {
        startJobs();
        expect(discord.setClient).not.toHaveBeenCalled();
    });

    it("stops every job, in reverse order, and can start them again afterwards", () => {
        startJobs();
        mockCalls.length = 0;
        stopJobs();
        expect(mockCalls).toEqual([
            "stop:stopBackupAlerts", "stop:stopRestoreTestJob", "stop:stopBackupJob", "stop:stopSoftresStatus", "stop:stopSoftresDetect", "stop:stopMetaRefresh", "stop:stopAddonCenter", "stop:stopRaidOverviews", "stop:stopOrgaSignupNotice", "stop:stopOrgaHubs", "stop:stopPanelRefresh", "stop:stop", "stop:stopEventSeries", "stop:stopTalkOverview", "stop:stopRosterRoleSync", "stop:stopRoleSync", "stop:stopReminders",
            "stop:stopEventMessageSync", "stop:stopWclGuildSync", "stop:stopLogAutoLink", "stop:stopRaidhelperSync", "stop:stopSheetCleanup", "stop:stop",
        ]);
        mockCalls.length = 0;
        startJobs();
        expect(mockCalls).toHaveLength(START_ORDER.length);
    });
});
