describe("config/variables", () => {
    const REQUIRED_KEYS = [
        "adminUserId",
        "raidhelperServerId",
        "raidhelperBotId",
        "categoryIds",
        "embedAccentColor",
        "googleSpreadsheetId",
        "googleSheetName",
        "googleSheetGid",
        "defaultTimeout",
        "applicationChannelId",
        "officerRoleId",
        "applyArmoryUrlTemplate",
        "applyWclUrlTemplate",
        "blizzardClientId",
        "blizzardClientSecret",
        "blizzardRegion",
        "blizzardRealmSlug",
        "blizzardNamespace",
        "webPort",
        "publicBaseUrl",
        "discordClientId",
        "discordClientSecret",
        "logcheckAdminIds",
        "adminRoleIds",
        "guildId",
        "devAutoLogin",
        "TIMEZONE",
    ];

    // Load with a clean env so the documented defaults are exercised.
    let variables;
    let savedEnv;
    beforeAll(() => {
        savedEnv = { ...process.env };
        for (const key of [
            "ADMIN_USER_ID",
            "APPLICATION_CHANNEL_ID",
            "OFFICER_ROLE_ID",
            "APPLY_ARMORY_URL",
            "APPLY_WCL_URL",
            "WEB_PORT",
            "PUBLIC_BASE_URL",
            "CLIENT_ID",
            "DISCORD_CLIENT_SECRET",
            "CLIENT_SECRET",
            "LOGCHECK_ADMIN_IDS",
            "BLIZZARD_CLIENT_ID",
            "BLIZZARD_CLIENT_SECRET",
            "BLIZZARD_REGION",
            "BLIZZARD_REALM",
            "BLIZZARD_NAMESPACE",
            "GUILD_ID",
        ]) {
            delete process.env[key];
        }
        jest.resetModules();
        variables = require("../../src/config/variables");
    });

    afterAll(() => {
        process.env = savedEnv;
    });

    it("exposes exactly the expected keys", () => {
        expect(Object.keys(variables).sort()).toEqual([...REQUIRED_KEYS].sort());
    });

    it("uses the documented default reply timeout", () => {
        expect(variables.defaultTimeout).toBe(60000);
    });

    // The guild the bot is installed in: used for the admin-role check and
    // preselected in the admin menu's server switcher (web/http/activeGuild.js).
    it("defaults the guild id to the guild's own server", () => {
        expect(variables.guildId).toBe("1354128137792917555");
    });

    it("defaults adminUserId sanely", () => {
        expect(variables.adminUserId).toBe("233598324022837249");
    });

    it("exposes categoryIds as a non-empty array of id strings", () => {
        expect(Array.isArray(variables.categoryIds)).toBe(true);
        expect(variables.categoryIds.length).toBeGreaterThan(0);
        for (const id of variables.categoryIds) {
            expect(typeof id).toBe("string");
            expect(id).toMatch(/^\d+$/);
        }
    });

    it("provides Discord id strings for the well-known ids", () => {
        expect(variables.raidhelperBotId).toMatch(/^\d+$/);
    });

    it("defaults the web port to 3005 and derives the public base url from it", () => {
        expect(variables.webPort).toBe(3005);
        expect(variables.publicBaseUrl).toBe("http://localhost:3005");
    });

    it("re-exports the one server time zone", () => {
        expect(variables.TIMEZONE).toBe("Europe/Berlin");
        expect(variables.TIMEZONE).toBe(require("../../src/config/timezone").TIMEZONE);
    });

    it("keeps the {char} placeholder in the url templates", () => {
        expect(variables.applyArmoryUrlTemplate).toContain("{char}");
        expect(variables.applyWclUrlTemplate).toContain("{char}");
    });

    it("defaults the Battle.net config to empty credentials on the Thunderstrike EU realm", () => {
        expect(variables.blizzardClientId).toBe("");
        expect(variables.blizzardClientSecret).toBe("");
        expect(variables.blizzardRegion).toBe("eu");
        expect(variables.blizzardRealmSlug).toBe("thunderstrike");
        expect(variables.blizzardNamespace).toBe("");
    });

    it("derives logcheckAdminIds as a trimmed non-empty list including the admin", () => {
        expect(Array.isArray(variables.logcheckAdminIds)).toBe(true);
        expect(variables.logcheckAdminIds).toContain("233598324022837249");
        for (const id of variables.logcheckAdminIds) {
            expect(id).toBe(id.trim());
            expect(id.length).toBeGreaterThan(0);
        }
    });
});
