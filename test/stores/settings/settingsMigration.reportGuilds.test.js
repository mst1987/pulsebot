jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());
jest.mock("../../../src/stores/loot/reportStore", () => ({ listReports: jest.fn(() => []), getReport: () => null, assignGuilds: jest.fn(() => 0) }));

const fs = require("fs");
const { settingsPath } = require("../../../src/config/paths");
const reportStore = require("../../../src/stores/loot/reportStore");
const { migrateSettings, migrateReportGuilds } = require("../../../src/stores/settings/settingsMigration");

const A = "1100000000000000001";
const B = "1100000000000000002";
const quiet = { log: () => {}, warn: () => {} };

beforeEach(() => {
    fs.__store.clear();
    reportStore.assignGuilds.mockReset();
    reportStore.assignGuilds.mockReturnValue(0);
    reportStore.listReports.mockClear();
});

// #920: every evaluation from before gets a server of its own, once - the log's, or the first server.
describe("stores/settings/settingsMigration report servers (#920)", () => {
    function load(config = { discordServers: { servers: [{ guildId: A, label: "" }, { guildId: B, label: "" }], links: [] } }) {
        fs.__store.set(settingsPath("config.json"), JSON.stringify(config));
        fs.__store.set(settingsPath("logs.json"), JSON.stringify({ logs: [
            { id: "l1", reportId: "R1", guildId: B, reportRefId: "abc111" },
            { id: "l2", reportId: "R2", guildId: B },
        ] }));
    }
    const marked = () => JSON.parse(fs.__store.get(settingsPath("migrations.json")) || "{}");

    it("stamps a report with the server of its log, one without a log with the first server", () => {
        load();
        reportStore.assignGuilds.mockReturnValue(2);
        expect(migrateReportGuilds()).toEqual(["reports: 2 Auswertung(en) ihrem Discord-Server fest zugeordnet (#920)"]);
        const pick = reportStore.assignGuilds.mock.calls[0][0];
        expect(pick({ id: "abc111" })).toBe(B);
        expect(pick({ id: "fff999" })).toBe(A);
        expect(marked().done.reportGuilds).toEqual(expect.any(Number));
    });

    it("runs only once: a second run neither lists nor writes a report", () => {
        load();
        migrateReportGuilds();
        reportStore.assignGuilds.mockClear();
        reportStore.listReports.mockClear();
        expect(migrateReportGuilds()).toEqual([]);
        expect(reportStore.assignGuilds).not.toHaveBeenCalled();
        expect(reportStore.listReports).not.toHaveBeenCalled();
    });

    it("skips the run when the mark is already set", () => {
        load();
        fs.__store.set(settingsPath("migrations.json"), JSON.stringify({ done: { reportGuilds: 1 } }));
        expect(migrateReportGuilds()).toEqual([]);
        expect(reportStore.assignGuilds).not.toHaveBeenCalled();
        expect(reportStore.listReports).not.toHaveBeenCalled();
    });

    it("sets no mark without a reports folder (a fresh install writes nothing)", () => {
        load();
        reportStore.assignGuilds.mockReturnValue(null);
        expect(migrateReportGuilds()).toEqual([]);
        expect(fs.__store.has(settingsPath("migrations.json"))).toBe(false);
    });

    it("runs as a start-up step and says nothing when nothing changed", () => {
        load();
        const { changes, error } = migrateSettings(quiet);
        expect(error).toBeUndefined();
        expect(reportStore.assignGuilds).toHaveBeenCalled();
        expect(changes.filter((c) => c.includes("#920") && c.startsWith("reports:"))).toEqual([]);
    });
});
