jest.mock("fs", () => require("../../../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { settingsPath } = require("../../../../src/config/paths");
const { serverSetting, serverVisuals, ownVisualsOf } = require("../../../../src/services/discord/servers/serverSettings");

const A = "111111111111111111";
const B = "222222222222222222";

beforeEach(() => fs.__store.clear());

describe("services/discord/servers/serverSettings (#917)", () => {
    const config = { serverSettings: { [A]: { lang: "en", off: false, empty: "" } } };

    it("reads the value of the server's block", () => {
        expect(serverSetting(A, "lang", { config })).toBe("en");
        expect(serverSetting(` ${A} `, "lang", { config })).toBe("en");
        expect(serverSetting(A, "off", { config, fallback: true })).toBe(false);
        expect(serverSetting(A, "empty", { config, fallback: "x" })).toBe("");
    });

    it("never answers with another server's value", () => {
        expect(serverSetting(B, "lang", { config })).toBeUndefined();
        expect(serverSetting(B, "lang", { config, fallback: "de" })).toBe("de");
        expect(serverSetting("", "lang", { config, fallback: "de" })).toBe("de");
    });

    it("falls back for a key the block does not hold", () => {
        expect(serverSetting(A, "missing", { config, fallback: 3 })).toBe(3);
        expect(serverSetting(A, "missing", { config })).toBeUndefined();
        expect(serverSetting(A, "lang", { config: {} })).toBeUndefined();
    });

    it("reads the stored settings when no config is handed in", () => {
        fs.__store.set(settingsPath("config.json"), JSON.stringify({ guildId: A, serverSettings: { [A]: {} } }));
        expect(serverSetting(A, "lang", { fallback: "de" })).toBe("de");
        expect(serverSetting(A, "lang")).toBeUndefined();
    });
});

describe("services/discord/servers/serverSettings: picture switches per server (#961)", () => {
    const ON = { overviewWeekStrip: true, setupImage: true, eventCover: true };

    it("keeps only known switches with a boolean", () => {
        expect(ownVisualsOf({ setupImage: false, eventCover: "no", other: true })).toEqual({ setupImage: false });
        expect(ownVisualsOf(null)).toEqual({});
    });

    it("lays the server's own switches over the global default; no server = the default", () => {
        const config = { discordVisuals: { eventCover: false }, serverSettings: { [A]: { discordVisuals: { eventCover: true, setupImage: false } } } };
        expect(serverVisuals(A, { config })).toEqual({ ...ON, setupImage: false });
        expect(serverVisuals(B, { config })).toEqual({ ...ON, eventCover: false });
        expect(serverVisuals("", { config })).toEqual({ ...ON, eventCover: false });
        expect(serverVisuals(A, { config: {} })).toEqual(ON);
    });

    it("reads the stored config when none is passed", () => {
        fs.__store.set(settingsPath("config.json"), JSON.stringify({ guildId: A, serverSettings: { [A]: { discordVisuals: { overviewWeekStrip: false } } } }));
        expect(serverVisuals(A)).toEqual({ ...ON, overviewWeekStrip: false });
    });
});
