jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());
jest.mock("../../src/stores/reportStore", () => ({ listReports: () => [], getReport: () => null, assignGuilds: jest.fn(() => 0) }));

const fs = require("fs");
const { settingsPath } = require("../../src/config/paths");
const reportStore = require("../../src/stores/reportStore");
const { migrateSettings, migrateReportGuilds } = require("../../src/stores/settingsMigration");

const A = "1100000000000000001";
const B = "1100000000000000002";
const quiet = { log: () => {}, warn: () => {} };

beforeEach(() => {
    fs.__store.clear();
});

// #920: an evaluation without a log was made somewhere nobody wrote down - the first server takes it.
describe("stores/settingsMigration report servers (#920)", () => {
    function load(config = { discordServers: { servers: [{ guildId: A, label: "" }, { guildId: B, label: "" }], links: [] } }) {
        fs.__store.set(settingsPath("config.json"), JSON.stringify(config));
        fs.__store.set(settingsPath("logs.json"), JSON.stringify({ logs: [
            { id: "l1", reportId: "R1", guildId: B, reportRefId: "abc111" },
            { id: "l2", reportId: "R2", guildId: B },
        ] }));
    }

    it("gives the first server to reports without a log and without a server", () => {
        load();
        reportStore.assignGuilds.mockReturnValue(2);
        expect(migrateReportGuilds()).toEqual(["reports: 2 Auswertung(en) ohne Log dem ersten Discord-Server zugeordnet (#920)"]);
        const pick = reportStore.assignGuilds.mock.calls[0][0];
        expect(pick({ id: "fff999" })).toBe(A);
        // a report with a log follows the log; one with a server keeps it
        expect(pick({ id: "abc111" })).toBe("");
        expect(pick({ id: "fff999", guildId: B })).toBe("");
    });

    it("runs as a start-up step and says nothing when nothing changed", () => {
        load();
        reportStore.assignGuilds.mockReturnValue(0);
        const { changes, error } = migrateSettings(quiet);
        expect(error).toBeUndefined();
        expect(reportStore.assignGuilds).toHaveBeenCalled();
        expect(changes.filter((c) => c.includes("#920"))).toEqual([]);
    });
});
