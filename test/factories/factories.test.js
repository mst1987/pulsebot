// The fixture factories (#433): fresh objects, defaults a suite can rely on,
// `over` wins, and an explicit undefined removes a default.
const { event, ownEvent, signup, series, sec, DAY } = require("./events");
const { makeWcl, fight, GRUUL, fights } = require("./wcl");
const { board, icon, person } = require("./raidplan");
const { normalizeSignup } = require("../../src/web/signupStore");

describe("test/factories", () => {
    it("event: a Raid-Helper-shaped event, over wins", () => {
        expect(event()).toEqual({ id: "e1", title: "Kara", startTime: 2000000000, channelId: "c1" });
        expect(event({ id: "e2", channelId: undefined })).toEqual({ id: "e2", title: "Kara", startTime: 2000000000, channelId: undefined });
        expect(event()).not.toBe(event());
    });

    it("ownEvent: three days ahead, deadline in two, a 10er Karazhan", () => {
        const now = sec(Date.now());
        const e = ownEvent({ title: "Kara Do" });
        expect(e).toMatchObject({ id: "eh-kara", source: "eventhelper", title: "Kara Do", size: 10, composition: { tank: 2, healer: 3, melee: 0, ranged: 0 } });
        expect(e.startTime - now).toBeGreaterThanOrEqual(3 * DAY - 1);
        expect(e.startTime - e.signupDeadline).toBe(DAY);
    });

    it("signup: a signed signup the real normalizeSignup accepts", () => {
        expect(signup({ userId: "u9" })).toEqual({ userId: "u9", character: "Brokk", spec: "Warrior-Protection", role: "tank", status: "signed", at: 1 });
        const { character, spec } = signup();
        expect(normalizeSignup({ character, spec }).value).toMatchObject({ character: "Brokk", spec: "Warrior-Protection", role: "tank", status: "signed" });
    });

    it("series: Wednesdays 19:30 of one category", () => {
        expect(series({ weekdays: [3, 6] })).toMatchObject({ categoryId: "cat1", enabled: true, weekdays: [3, 6], time: "19:30", daysBefore: 6 });
    });

    it("makeWcl answers every table empty and takes replacements", async () => {
        const table = { entries: [{ name: "A" }] };
        const wcl = makeWcl({ getCasts: jest.fn(async () => table) });
        await expect(wcl.getCasts()).resolves.toBe(table);
        await expect(wcl.getBuffs()).resolves.toEqual({ auras: [] });
        await expect(wcl.getDeaths()).resolves.toEqual({ entries: [] });
        await expect(wcl.getAllEvents()).resolves.toEqual([]);
    });

    it("fight / GRUUL: the Gruul kill", () => {
        expect(GRUUL).toEqual({ id: 3, boss: 650, name: "Gruul the Dragonkiller", kill: true, start_time: 300000, end_time: 420000 });
        expect(Object.isFrozen(GRUUL)).toBe(true);
        expect(fight({ id: 4, kill: undefined })).toMatchObject({ id: 4, boss: 650, kill: undefined });
    });

    it("fights: n pulls, optionally wipes before the kill", () => {
        expect(fights(2)).toEqual({
            end: 1900,
            fights: [
                { id: 1, boss: 600, name: "Boss 1", start_time: 0, end_time: 900 },
                { id: 2, boss: 601, name: "Boss 2", start_time: 1000, end_time: 1900 },
            ],
        });
        const pulls = fights(4, { wipes: 2 }).fights;
        expect(pulls.map((f) => [f.boss, f.kill])).toEqual([[600, false], [600, false], [600, true], [603, true]]);
        expect(fights(0)).toEqual({ end: 0, fights: [] });
    });

    it("raidplan: board, icon, person", () => {
        expect(board({ notes: "n" })).toEqual({ tokens: [], slots: [], marks: [], zones: [], targets: [], icons: [], notes: "n" });
        expect(icon({ x: 0.1 })).toEqual({ iconKey: "boss:609", x: 0.1, y: 0.5 });
        expect(person({ userId: "u2", role: "healer" })).toEqual({ userId: "u2", classId: "warrior", role: "healer", group: 1 });
    });
});
