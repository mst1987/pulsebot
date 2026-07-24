describe("config/variables", () => {
    const REQUIRED_KEYS = [
        "API_BASE_URL",
        "legendaryID",
        "adminUserId",
        "raidhelperBotId",
        "categoryIds",
        "highestBidsChannelId",
        "highestBidsMessageId",
        "googleSpreadsheetId",
        "googleSheetName",
        "googleSheetGid",
        "maxBidAmount",
        "defaultTimeout",
        "applicationChannelId",
        "officerRoleId",
        "applyArmoryUrlTemplate",
        "applyWclUrlTemplate",
        "webPort",
        "publicBaseUrl",
        "discordClientId",
        "discordClientSecret",
        "logcheckAdminIds",
        "adminRoleIds",
        "guildId",
        "devAutoLogin",
    ];

    // Load with a clean env so the documented defaults are exercised.
    let variables;
    let savedEnv;
    beforeAll(() => {
        savedEnv = { ...process.env };
        for (const key of [
            "API_BASE_URL",
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

    it("uses the documented default auction settings", () => {
        expect(variables.maxBidAmount).toBe(5000000);
        expect(variables.defaultTimeout).toBe(60000);
    });

    it("defaults adminUserId and API_BASE_URL sanely", () => {
        expect(variables.adminUserId).toBe("233598324022837249");
        expect(typeof variables.API_BASE_URL).toBe("string");
        expect(variables.API_BASE_URL).toBe("https://pulse-gdkp.de:3001/api");
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
        expect(variables.legendaryID).toMatch(/^\d+$/);
        expect(variables.raidhelperBotId).toMatch(/^\d+$/);
        expect(variables.highestBidsChannelId).toMatch(/^\d+$/);
        expect(variables.highestBidsMessageId).toMatch(/^\d+$/);
    });

    it("defaults the web port to 3005 and derives the public base url from it", () => {
        expect(variables.webPort).toBe(3005);
        expect(variables.publicBaseUrl).toBe("http://localhost:3005");
    });

    it("keeps the {char} placeholder in the url templates", () => {
        expect(variables.applyArmoryUrlTemplate).toContain("{char}");
        expect(variables.applyWclUrlTemplate).toContain("{char}");
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
