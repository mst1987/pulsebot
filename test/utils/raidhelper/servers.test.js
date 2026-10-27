// Raid-Helper per Discord server (#927): which server is active, with which id
// and key, and what the settings page may see of it (never the key).
const {
    raidhelperSettingOf, raidhelperOf, activeRaidhelperGuilds, raidhelperActive, maskedRaidhelper, knownGuildIds,
} = require("../../../src/utils/raidhelper/servers");

const A = "111111111111111111";
const B = "222222222222222222";
const C = "333333333333333333";
const KEY = "fake-stored-key-WXYZ9876";
const ENV = { RAIDHELPER_API_KEY: "fake-env-key-for-tests" };
const config = (serverSettings, extra = {}) => ({
    discordServers: { servers: [{ guildId: A }, { guildId: B }] },
    serverSettings,
    ...extra,
});

describe("utils/raidhelper/servers", () => {
    it("reads a server without a block as off", () => {
        expect(raidhelperSettingOf(A, {})).toEqual({ enabled: false, serverId: "", apiKey: "", envKey: false, at: 0, byName: "" });
        expect(raidhelperOf(A, {}, ENV)).toEqual({ guildId: A, enabled: false, serverId: A, apiKey: "", hasKey: false, active: false });
    });

    it("is active only when switched on with a key at hand", () => {
        expect(raidhelperActive(A, config({ [A]: { raidhelper: { enabled: true } } }), ENV)).toBe(false);
        expect(raidhelperActive(A, config({ [A]: { raidhelper: { enabled: false, apiKey: KEY } } }), ENV)).toBe(false);
        expect(raidhelperActive(A, config({ [A]: { raidhelper: { enabled: true, apiKey: KEY } } }), ENV)).toBe(true);
        expect(raidhelperActive("", config({ "": { raidhelper: { enabled: true, apiKey: KEY } } }), ENV)).toBe(false);
    });

    it("uses the .env key only for the server the migration marked", () => {
        const cfg = config({ [A]: { raidhelper: { enabled: true, envKey: true } }, [B]: { raidhelper: { enabled: true } } });
        expect(raidhelperOf(A, cfg, ENV)).toMatchObject({ apiKey: ENV.RAIDHELPER_API_KEY, active: true });
        expect(raidhelperOf(B, cfg, ENV)).toMatchObject({ apiKey: "", active: false });
        expect(raidhelperOf(A, cfg, {})).toMatchObject({ active: false });
    });

    it("prefers a key entered in the settings over the .env key", () => {
        const cfg = config({ [A]: { raidhelper: { enabled: true, envKey: true, apiKey: KEY } } });
        expect(raidhelperOf(A, cfg, ENV).apiKey).toBe(KEY);
    });

    it("asks Raid-Helper under the guild's own id unless an override is set", () => {
        expect(raidhelperOf(A, config({ [A]: { raidhelper: { enabled: true, apiKey: KEY } } }), ENV).serverId).toBe(A);
        expect(raidhelperOf(A, config({ [A]: { raidhelper: { enabled: true, apiKey: KEY, serverId: ` ${C} ` } } }), ENV).serverId).toBe(C);
    });

    it("knows the configured servers, the stored blocks and the home guild, each once", () => {
        expect(knownGuildIds(config({ [C]: {} }, { guildId: A }))).toEqual([A, B, C]);
        expect(knownGuildIds(null)).toEqual([]);
    });

    it("lists the active servers in server order", () => {
        const cfg = config({ [B]: { raidhelper: { enabled: true, apiKey: KEY } }, [A]: { raidhelper: { enabled: true, envKey: true } }, [C]: { raidhelper: { enabled: false, apiKey: KEY } } });
        expect(activeRaidhelperGuilds(cfg, ENV)).toEqual([A, B]);
        expect(activeRaidhelperGuilds(cfg, {})).toEqual([B]);
    });

    it("shows the page whether there is a key and its last 4 characters, never the key", () => {
        const masked = maskedRaidhelper(A, config({ [A]: { raidhelper: { enabled: true, apiKey: KEY, at: 5, byName: "Orga" } } }), ENV);
        expect(masked).toEqual({ enabled: true, serverId: "", hasKey: true, keyLast4: "9876", envKey: false, active: true, at: 5, byName: "Orga" });
        expect(JSON.stringify(masked)).not.toContain(KEY);
    });

    it("shows no last characters of a short key or of the .env key", () => {
        expect(maskedRaidhelper(A, config({ [A]: { raidhelper: { enabled: true, apiKey: "short1" } } }), ENV)).toMatchObject({ hasKey: true, keyLast4: "" });
        const env = maskedRaidhelper(A, config({ [A]: { raidhelper: { enabled: true, envKey: true } } }), ENV);
        expect(env).toMatchObject({ hasKey: true, keyLast4: "", envKey: true });
        expect(JSON.stringify(env)).not.toContain(ENV.RAIDHELPER_API_KEY);
    });
});
