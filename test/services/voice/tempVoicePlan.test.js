// The plan of a raid's temporary voice channel (services/voice/tempVoicePlan.js).
const { DateTime } = require("luxon");
const plan = require("../../../src/services/voice/tempVoicePlan");

// Sa 31.10.2026, 20:00 Berlin.
const START = DateTime.fromISO("2026-10-31T20:00", { zone: "Europe/Berlin" }).toSeconds();
const CAT = "111111111111111111";
const PARENT = "222222222222222222";
const FIXED = "333333333333333333";

const raid = (over = {}) => ({
    id: "eh-1", guildId: "g1", categoryId: CAT, instanceIds: ["ssc"], title: "SSC", startTime: START, durationMinutes: 180, ...over,
});
const config = (cat = {}, extra = {}) => ({ categoryTempVoice: { [CAT]: cat }, ...extra });

describe("services/voice/tempVoicePlan", () => {
    describe("renderVoiceName", () => {
        it("drops {nr} with its separator while there is one raid", () => {
            const values = { raid: "SSC", nr: "", datum: "Sa 31.10." };
            expect(plan.renderVoiceName("{raid} {nr} · {datum}", values)).toBe("SSC · Sa 31.10.");
            expect(plan.renderVoiceName("{raid} {nr} · {datum}", { ...values, nr: "2" })).toBe("SSC 2 · Sa 31.10.");
        });

        it("leaves no dangling or doubled separators", () => {
            expect(plan.renderVoiceName("{raid} · {leader}", { raid: "SSC", leader: "" })).toBe("SSC");
            expect(plan.renderVoiceName("{leader} - {raid}", { raid: "SSC", leader: "" })).toBe("SSC");
            expect(plan.renderVoiceName("{raid} · {nr} · {datum}", { raid: "SSC", nr: "", datum: "Sa 31.10." })).toBe("SSC · Sa 31.10.");
            expect(plan.renderVoiceName("{raid}   {zeit}", { raid: "SSC", zeit: "20:00" })).toBe("SSC 20:00");
        });

        it("keeps unknown placeholders as written and cuts to Discord's length", () => {
            expect(plan.renderVoiceName("{raid} {foo}", { raid: "SSC" })).toBe("SSC {foo}");
            expect(plan.renderVoiceName("{raid}", { raid: "x".repeat(150) })).toHaveLength(100);
        });
    });

    it("spells day and time in the server's zone", () => {
        expect(plan.dayLabel(START)).toBe("Sa 31.10.");
        expect(plan.dayLabel(START, "en")).toBe("Sat 31.10.");
        expect(plan.timeLabel(START)).toBe("20:00");
        expect(plan.dayLabel(0)).toBe("");
    });

    it("names the raid by its instances, else by its title", () => {
        expect(plan.raidLabel(raid({ instanceIds: ["ssc", "tk"] }))).toBe("SSC/TK");
        expect(plan.raidLabel(raid({ instanceIds: [], title: "Kara Run" }))).toBe("Kara Run");
    });

    describe("which raid is temporary", () => {
        it("follows the mode and the raid-2 switch", () => {
            expect(plan.isTemporary({ mode: "temp" }, 1)).toBe(true);
            expect(plan.isTemporary({ mode: "none" }, 2)).toBe(false);
            expect(plan.isTemporary({ mode: "existing", fromRaid2: false }, 2)).toBe(false);
            expect(plan.isTemporary({ mode: "existing", fromRaid2: true }, 1)).toBe(false);
            expect(plan.isTemporary({ mode: "existing", fromRaid2: true }, 2)).toBe(true);
        });

        it("gives no plan without a mode, to a cancelled raid or without a start", () => {
            expect(plan.planFor(raid(), { config: {} })).toBeNull();
            expect(plan.planFor(raid({ status: "cancelled" }), { config: config({ mode: "temp" }) })).toBeNull();
            expect(plan.planFor(raid({ startTime: 0 }), { config: config({ mode: "temp" }) })).toBeNull();
        });

        it("lets the primary's own voice plan override the category", () => {
            const own = raid({ voicePlan: { mode: "temp", nameTemplate: "{raid} {zeit}", leadMinutes: 15 } });
            const p = plan.planFor(own, { config: config({ mode: "none", closeAfterMinutes: 30 }) });
            expect(p).toMatchObject({ name: "SSC 20:00", openAt: START - 15 * 60, limitAt: START + 180 * 60 + 30 * 60, own: true });
            expect(plan.planFor(raid({ voicePlan: { mode: "none" } }), { config: config({ mode: "temp" }) })).toBeNull();
        });
    });

    it("plans a single raid with the defaults", () => {
        const p = plan.planFor(raid(), { config: config({ mode: "temp", parentId: PARENT }) });
        expect(p).toEqual({
            eventId: "eh-1", guildId: "g1", index: 1, total: 1, mode: "temp", name: "SSC · Sa 31.10.", parentId: PARENT,
            onlyAssigned: false, members: [], openAt: START - 30 * 60, startAt: START, endAt: START + 180 * 60,
            limitAt: START + 240 * 60, emptyMinutes: 5, fixedChannelId: "", own: false,
        });
    });

    it("numbers the raids of a split event and only plans raid 2 under the raid-2 switch", () => {
        const primary = raid();
        const second = raid({ id: "eh-2", raidGroupId: "eh-1", raidIndex: 2, leaderId: "u9" });
        const cfg = config({ mode: "existing", fromRaid2: true, nameTemplate: "{raid} {nr} · {leader}" }, { categoryVoiceChannel: { [CAT]: FIXED } });
        const group = [primary, second];
        expect(plan.planFor(primary, { group, config: cfg })).toBeNull();
        const p = plan.planFor(second, { group, config: cfg, leaderName: (id) => (id === "u9" ? "Lahelo" : "") });
        expect(p).toMatchObject({ index: 2, total: 2, name: "SSC 2 · Lahelo", fixedChannelId: FIXED, mode: "existing" });
    });

    it("falls back to the default duration and lists only the assigned when asked", () => {
        const setup = {
            groups: [{ index: 1, slots: [{ userId: "a" }, { userId: "b" }] }],
            bench: [{ userId: "c" }],
            approved: { groups: [{ index: 1, slots: [{ userId: "a" }] }] },
        };
        const p = plan.planFor(raid({ durationMinutes: null, setup }), { config: config({ mode: "temp", onlyAssigned: true }) });
        expect(p.endAt).toBe(START + 180 * 60);
        expect(p.members).toEqual(["a"]);
        expect(plan.assignedUserIds({ setup: { groups: setup.groups, bench: setup.bench } })).toEqual(["a", "b"]);
        expect(plan.assignedUserIds({})).toEqual([]);
    });
});
