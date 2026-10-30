// The per-server values of #924: one server's channel/role or nothing - never another server's.
jest.mock("../../../../src/stores/settings/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));

const settingsStore = require("../../../../src/stores/settings/settingsStore");
const defaults = require("../../../../src/services/discord/servers/serverDefaults");

const MAIN = "1700000000000000001";
const PUGS = "1700000000000000002";
const CONFIG = {
    guildId: MAIN,
    discordServers: { servers: [{ guildId: MAIN }, { guildId: PUGS }], links: [] },
    serverSettings: {
        [MAIN]: {
            applicationChannelId: "1700000000000000011", officerRoleId: "1700000000000000021",
            signupNoteChannelId: "1700000000000000012", guildBankChannelId: "1700000000000000013",
            raidDefaults: { channelId: "1700000000000000014" },
        },
        [PUGS]: { officerRoleId: " 1700000000000000022 ", applicationChannelId: "#bewerbungen", raidDefaults: { channelId: "" } },
    },
};
const opts = { config: CONFIG };

describe("services/discord/servers/serverDefaults (#924)", () => {
    it("reads each value of the server named", () => {
        expect(defaults.applicationChannelId(MAIN, opts)).toBe("1700000000000000011");
        expect(defaults.officerRoleId(MAIN, opts)).toBe("1700000000000000021");
        expect(defaults.signupNoteChannelId(MAIN, opts)).toBe("1700000000000000012");
        expect(defaults.guildBankChannelId(MAIN, opts)).toBe("1700000000000000013");
        expect(defaults.raidDefaultChannelId(MAIN, opts)).toBe("1700000000000000014");
        expect(defaults.officerRoleId(PUGS, opts)).toBe("1700000000000000022");
    });

    it("answers nothing for a server without an entry, a malformed id or no server", () => {
        expect(defaults.signupNoteChannelId(PUGS, opts)).toBe("");
        expect(defaults.guildBankChannelId(PUGS, opts)).toBe("");
        expect(defaults.applicationChannelId(PUGS, opts)).toBe("");
        expect(defaults.raidDefaultChannelId(PUGS, opts)).toBe("");
        expect(defaults.applicationChannelId("", opts)).toBe("");
        expect(defaults.raidDefaultChannelId(undefined, opts)).toBe("");
        expect(defaults.officerRoleId("1700000000000000009", opts)).toBe("");
    });

    it("never falls back to the old global fields", () => {
        const old = { guildId: MAIN, applicationChannelId: "1700000000000000011", raidDefaults: { channelId: "1700000000000000014" } };
        expect(defaults.applicationChannelId(MAIN, { config: old })).toBe("");
        expect(defaults.raidDefaultChannelId(MAIN, { config: old })).toBe("");
    });

    it("lists every server's value of one key and the officer roles of all servers", () => {
        expect(defaults.everyServer("officerRoleId", opts)).toEqual([
            { guildId: MAIN, value: "1700000000000000021" },
            { guildId: PUGS, value: "1700000000000000022" },
        ]);
        expect(defaults.everyServer("guildBankChannelId", opts)).toEqual([{ guildId: MAIN, value: "1700000000000000013" }]);
        expect(defaults.officerRoleIds(opts)).toEqual(["1700000000000000021", "1700000000000000022"]);
        expect(defaults.everyServer("officerRoleId", { config: { serverSettings: { [MAIN]: null } } })).toEqual([]);
    });

    it("reads the stored config when none is handed in", () => {
        settingsStore.getConfig.mockReturnValue(CONFIG);
        expect(defaults.applicationChannelId(MAIN)).toBe("1700000000000000011");
        expect(defaults.officerRoleIds()).toEqual(["1700000000000000021", "1700000000000000022"]);
        settingsStore.getConfig.mockReturnValue({});
        expect(defaults.everyServer("officerRoleId")).toEqual([]);
    });
});
