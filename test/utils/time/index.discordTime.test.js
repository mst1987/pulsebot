const {
    toSeconds, discordTimestamp, serverDateTime, SERVER_ZONE,
} = require("../../../src/utils/time");

// Thu 17 Sep 2026, 17:30 UTC = 19:30 in Berlin (CEST).
const THU = Date.UTC(2026, 8, 17, 17, 30) / 1000;
// Mon 14 Dec 2026, 18:00 UTC = 19:00 in Berlin (CET).
const WINTER = Date.UTC(2026, 11, 14, 18, 0) / 1000;

describe("utils/time: Discord texts", () => {
    it("reads seconds and milliseconds alike, 0 for nothing", () => {
        expect(toSeconds(THU)).toBe(THU);
        expect(toSeconds(THU * 1000)).toBe(THU);
        expect(toSeconds("")).toBe(0);
        expect(toSeconds(-5)).toBe(0);
    });

    it("writes Discord timestamps, so every reader sees their own language and zone", () => {
        expect(discordTimestamp(THU)).toBe(`<t:${THU}:F>`);
        expect(discordTimestamp(THU * 1000, "R")).toBe(`<t:${THU}:R>`);
        expect(discordTimestamp(THU, "D")).toBe(`<t:${THU}:D>`);
        expect(discordTimestamp(THU, "x")).toBe(`<t:${THU}:F>`);
        expect(discordTimestamp(0)).toBe("");
    });

    it("reads a moment in server time, in English, where no timestamp can render", () => {
        expect(SERVER_ZONE).toBe("Europe/Berlin");
        expect(serverDateTime(THU).toFormat("ccc d LLL HH:mm")).toBe("Thu 17 Sep 19:30");
        expect(serverDateTime(WINTER).toFormat("ccc d LLL HH:mm")).toBe("Mon 14 Dec 19:00");
        expect(serverDateTime(0)).toBeNull();
    });
});
