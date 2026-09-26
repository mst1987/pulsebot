const { TIMEZONE } = require("../../src/config/timezone");
const { SERVER_ZONE } = require("../../src/utils/discordTime");

describe("config/timezone", () => {
    it("is the realm's zone", () => {
        expect(TIMEZONE).toBe("Europe/Berlin");
    });

    it("is the zone the Discord texts use as well", () => {
        expect(SERVER_ZONE).toBe(TIMEZONE);
    });
});
