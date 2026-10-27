// Raid-Helper switched on for every server (#927), for suites written before
// Raid-Helper was set per server: they mock the Raid-Helper class and a config
// without `serverSettings`, which would now mean "Raid-Helper off everywhere".
//
//   jest.mock("../../../src/utils/raidhelper/servers", () => require("../../helpers/raidhelperOn").serversMock());
//
// Only the resolver is replaced; the key is a dummy and never reaches a request
// (the suites mock src/classes/raidhelper).
const SERVERS = "../../src/utils/raidhelper/servers";
const TEST_GUILD = "rh-test-guild";

function serversMock() {
    const actual = jest.requireActual(SERVERS);
    const on = (guildId) => {
        const id = String(guildId || TEST_GUILD);
        return { guildId: id, enabled: true, serverId: id, apiKey: "dummy", hasKey: true, active: true };
    };
    return {
        ...actual,
        raidhelperOf: jest.fn(on),
        raidhelperActive: jest.fn(() => true),
        activeRaidhelperGuilds: jest.fn(() => [TEST_GUILD]),
    };
}

module.exports = { serversMock, TEST_GUILD };
