// The dev-only Raid-Helper stand-in (src/utils/raidhelper/fixture.js): off in production whatever the variable says, never a network
// request, refuses every write.
jest.mock("../../../src/classes/raidhelper", () => jest.fn().mockImplementation(() => ({ real: true })));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));

const fs = require("fs");
const { tempStoreFile } = require("../../helpers/tempStore");
const fixture = require("../../../src/utils/raidhelper/fixture");
const { createRaidhelperClient } = require("../../../src/utils/raidhelper/client");
const { raidhelperLineup } = require("../../../src/web/raidhelperRoster");

describe("fixtureMode", () => {
    it("is off without the variable and ALWAYS off in production", () => {
        expect(fixture.fixtureMode({})).toBe("");
        expect(fixture.fixtureMode({ EVENTHELPER_RH_FIXTURE: "0" })).toBe("");
        expect(fixture.fixtureMode({ EVENTHELPER_RH_FIXTURE: "1" })).toBe("on");
        expect(fixture.fixtureMode({ EVENTHELPER_RH_FIXTURE: "down" })).toBe("down");
        expect(fixture.fixtureMode({ EVENTHELPER_RH_FIXTURE: "nogroups" })).toBe("nogroups");
        for (const v of ["1", "down", "signups"]) expect(fixture.fixtureMode({ EVENTHELPER_RH_FIXTURE: v, NODE_ENV: "production" })).toBe("");
    });
});

describe("createRaidhelperClient", () => {
    const saved = { fx: process.env.EVENTHELPER_RH_FIXTURE, env: process.env.NODE_ENV };
    afterEach(() => {
        if (saved.fx === undefined) delete process.env.EVENTHELPER_RH_FIXTURE; else process.env.EVENTHELPER_RH_FIXTURE = saved.fx;
        process.env.NODE_ENV = saved.env;
    });

    it("hands out the fixture only outside production", () => {
        process.env.EVENTHELPER_RH_FIXTURE = "1";
        process.env.NODE_ENV = "development";
        expect(createRaidhelperClient().fixture).toBe(true);
        process.env.NODE_ENV = "production";
        expect(createRaidhelperClient()).toEqual({ real: true });
        delete process.env.EVENTHELPER_RH_FIXTURE;
        process.env.NODE_ENV = "development";
        expect(createRaidhelperClient()).toEqual({ real: true });
    });
});

describe("the fixture client", () => {
    const client = (mode) => fixture.fixtureClient({ mode, channelIdOf: () => "chan1", now: () => 1_800_000_000_000 });

    it("lists one event in two days with 25 nicknames in five groups, one unknown spec", async () => {
        const c = client("on");
        const [ev] = await c.fetchEvents(0);
        expect(ev).toMatchObject({ id: fixture.FIXTURE_EVENT_ID, title: "BT 25er Fixture", channelId: "chan1" });
        expect(ev.startTime).toBeGreaterThan(1_800_000_000);
        expect((await c.getEvent(ev.id)).signUps.length).toBeGreaterThan(25);
        const setup = await c.getSetup(ev.id);
        const lineup = raidhelperLineup({ setupSlots: setup.setup, signUps: ev.signUps });
        expect(lineup).toMatchObject({ source: "raidplan", hasGroups: true, unknown: ["Frost"] });
        expect(lineup.groups.map((g) => g.slots.length)).toEqual([5, 5, 5, 5, 5]);
        expect(await c.getSetup("other")).toBeUndefined();
        expect((await c.getEvent("other")).id).toBeUndefined();
    });

    it("nogroups / signups / down", async () => {
        const ng = await client("nogroups").getSetup(fixture.FIXTURE_EVENT_ID);
        expect(raidhelperLineup({ setupSlots: ng.setup }).hasGroups).toBe(false);
        expect(await client("signups").getSetup(fixture.FIXTURE_EVENT_ID)).toBeUndefined();
        const ev = await client("signups").getEvent(fixture.FIXTURE_EVENT_ID);
        const lineup = raidhelperLineup({ signUps: ev.signUps });
        // the doubled raider counts once, the bench apart, the absence not at all
        expect(lineup.source).toBe("signups");
        expect(lineup.groups.flatMap((g) => g.slots).length).toBe(25);
        expect(lineup.bench.map((s) => s.character)).toEqual(["Bankdrücker"]);
        await expect(client("down").getEvent(fixture.FIXTURE_EVENT_ID)).rejects.toThrow(/antwortet nicht/);
        await expect(client("down").fetchEvents(0)).rejects.toThrow();
        expect(await client("down").getSetup(fixture.FIXTURE_EVENT_ID)).toBeUndefined();
    });

    it("gone: one raider left both lists", async () => {
        expect(fixture.fixtureMode({ EVENTHELPER_RH_FIXTURE: "gone" })).toBe("gone");
        const c = client("gone");
        const left = fixture.userIdOf(3);
        expect((await c.getSetup(fixture.FIXTURE_EVENT_ID)).setup.map((s) => s.id)).not.toContain(left);
        expect((await c.getEvent(fixture.FIXTURE_EVENT_ID)).signUps.map((s) => s.userId)).not.toContain(left);
        expect((await c.getSetup(fixture.FIXTURE_EVENT_ID)).setup).toHaveLength(24);
    });

    it("a mode file switches the running fixture (e.g. to down and back)", async () => {
        const file = tempStoreFile("rh-fixture-mode.txt");
        const c = fixture.fixtureClient({ mode: "on", channelIdOf: () => "c", modeFile: file });
        expect((await c.getEvent(fixture.FIXTURE_EVENT_ID)).id).toBe(fixture.FIXTURE_EVENT_ID);
        fs.writeFileSync(file, "down\n");
        await expect(c.getEvent(fixture.FIXTURE_EVENT_ID)).rejects.toThrow();
        fs.writeFileSync(file, "nonsense");
        expect(fixture.fileMode(file)).toBe("");
        expect((await c.getEvent(fixture.FIXTURE_EVENT_ID)).id).toBe(fixture.FIXTURE_EVENT_ID);
    });

    it("refuses every write", async () => {
        const c = client("on");
        for (const w of ["createEvent", "signUp", "signUpToRaid"]) await expect(c[w]({})).rejects.toThrow(/nichts geschrieben/);
    });
});
