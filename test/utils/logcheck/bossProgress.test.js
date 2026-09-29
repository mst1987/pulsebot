// #534: which bosses of a plan the log shows down, fought and next (src/utils/logcheck/bossProgress.js).
const { deriveProgress, sectionForFight, fightKeys, isRunning } = require("../../../src/utils/logcheck/bossProgress");
const { bossesForInstances } = require("../../../src/stores/raidplanStore");

/** The plan sections of some instances, as the service hands them in (no "Allgemein", no trash). */
const sections = (...ids) => bossesForInstances(ids).filter((b) => !b.general && !b.trash).map((b) => ({ key: b.key, name: b.name, instanceId: b.instanceId }));

let seq = 0;
/** A finished v1 boss fight (Anniversary ids by default: 50xxx for BT/Hyjal). */
const fight = (boss, name, kill, extra = {}) => ({ id: ++seq, boss, name, kill, inProgress: false, start_time: seq * 1000, end_time: seq * 1000 + 500, ...extra });
const trash = () => ({ id: ++seq, boss: 0, name: "Illidari Nightlord", start_time: seq * 1000, end_time: seq * 1000 + 100 });

const BT = sections("bt");

describe("deriveProgress", () => {
    it("counts a kill, never a wipe, and names the first boss still standing as next", () => {
        const p = deriveProgress({ fights: [
            fight(50601, "High Warlord Naj'entus", true),
            trash(),
            fight(50602, "Supremus", false),
            fight(50602, "Supremus", false),
        ] }, BT);
        expect(p.killed).toEqual(["bt/high-warlord-najentus"]);
        expect(p.current).toBeNull();
        expect(p.next).toBe("bt/supremus");
    });

    it("names the boss of a fight the live log is still writing as current", () => {
        const running = deriveProgress({ fights: [
            fight(50601, "High Warlord Naj'entus", true),
            fight(50602, "Supremus", undefined, { inProgress: true }),
        ] }, BT);
        expect(running).toMatchObject({ killed: ["bt/high-warlord-najentus"], current: "bt/supremus", next: "bt/supremus" });
        // no outcome yet counts as running too
        expect(deriveProgress({ fights: [fight(50602, "Supremus", undefined)] }, BT).current).toBe("bt/supremus");
        // a finished wipe is not "current", and trash after a boss ends it
        expect(deriveProgress({ fights: [fight(50602, "Supremus", false)] }, BT).current).toBeNull();
        expect(deriveProgress({ fights: [fight(50602, "Supremus", undefined, { inProgress: true }), trash()] }, BT).current).toBeNull();
    });

    it("finds the boss by its encounter id when the name is not the table's (Anniversary offsets, WCL names)", () => {
        const p = deriveProgress({ fights: [
            // German client, untranslated name: the offset id 50601 folds back to 601 = Naj'entus
            fight(50601, "Oberster Kriegsfürst Naj'entus", true),
            fight(50602, "Supremus", true),
            fight(50603, "Shade of Akama", true),
            fight(50604, "Teron Gorefiend", true),
            // WCL's "Reliquary of Souls" is the table's "Reliquary of the Lost"
            fight(50606, "Reliquary of Souls", true),
        ] }, BT);
        expect(p.killed).toEqual([
            "bt/high-warlord-najentus", "bt/supremus", "bt/shade-of-akama", "bt/teron-gorefiend", "bt/reliquary-of-the-lost",
        ]);
        // the order since #534: after the Reliquary comes Bloodboil
        expect(p.next).toBe("bt/gurtogg-bloodboil");
        // the original ids (no offset) work as well, and so does an SSC id with the 100000 offset
        expect(sectionForFight(fight(606, "?", true), BT).key).toBe("bt/reliquary-of-the-lost");
        expect(sectionForFight(fight(100623, "Hydross", true), sections("ssc")).key).toBe("ssc/hydross-the-unstable");
    });

    it("ignores trash and bosses of raids the plan does not hold", () => {
        const p = deriveProgress({ fights: [trash(), fight(50618, "Rage Winterchill", true), trash()] }, BT);
        expect(p).toEqual({ killed: [], current: null, next: "bt/high-warlord-najentus" });
        expect(sectionForFight(trash(), BT)).toBeNull();
        expect(sectionForFight(fight(0, "Supremus", true), BT)).toBeNull();
    });

    it("goes over the plan's sections of several instances in their order", () => {
        const plan = sections("hyjal", "bt", "gruul");
        const hyjal = ["Rage Winterchill", "Anetheron", "Kaz'rogal", "Azgalor", "Archimonde"].map((n, i) => fight(50618 + i, n, true));
        const p = deriveProgress({ fights: hyjal }, plan);
        expect(p.killed).toHaveLength(5);
        // Hyjal cleared: the next section with a boss standing is BT's first
        expect(p.next).toBe("bt/high-warlord-najentus");

        const bt = BT.map((s) => fight(0, s.name, true, { boss: 1 }));
        const full = deriveProgress({ fights: [...hyjal, ...bt] }, plan);
        expect(full.next).toBe("gruul/high-king-maulgar");
        expect(full.killed).toEqual(plan.filter((s) => s.instanceId !== "gruul").map((s) => s.key));
    });

    it("follows the instance the raid is in, even when the plan lists another one first", () => {
        const plan = sections("hyjal", "bt");
        const p = deriveProgress({ fights: [fight(50601, "High Warlord Naj'entus", true)] }, plan);
        expect(p.next).toBe("bt/supremus");
        // a wipe on BT's first boss with nothing killed yet stays in BT as well
        expect(deriveProgress({ fights: [fight(50601, "High Warlord Naj'entus", false)] }, plan).next).toBe("bt/high-warlord-najentus");
        // nothing pulled: the plan's first boss
        expect(deriveProgress({ fights: [] }, plan).next).toBe("hyjal/rage-winterchill");
    });

    it("says null for next when every boss is down, and copes with empty input", () => {
        const p = deriveProgress({ fights: BT.map((s) => fight(1, s.name, true)) }, BT);
        expect(p.next).toBeNull();
        expect(p.killed).toHaveLength(BT.length);
        expect(deriveProgress(null, BT)).toEqual({ killed: [], current: null, next: "bt/high-warlord-najentus" });
        expect(deriveProgress({ fights: [fight(1, "Supremus", true)] }, null)).toEqual({ killed: [], current: null, next: null });
    });

    it("counts Karazhan's opera under its event", () => {
        const kara = sections("kara");
        const p = deriveProgress({ fights: [fight(50652, "Attumen the Huntsman", true), fight(50655, "The Big Bad Wolf", true)] }, kara);
        expect(p.killed).toEqual(["kara/attumen-the-huntsman", "kara/opera-event"]);
        expect(p.next).toBe("kara/moroes");
    });
});

describe("helpers", () => {
    it("fightKeys holds the name and WCL's name for the id", () => {
        expect(fightKeys({ boss: 50606, name: "Reliquary of Souls" })).toEqual(["reliquaryofthelost", "reliquaryofthelost"]);
        expect(fightKeys({ boss: 0, name: "" })).toEqual([]);
        expect(fightKeys(null)).toEqual([]);
    });

    it("isRunning reads inProgress and a missing outcome", () => {
        expect(isRunning({ inProgress: true, kill: false })).toBe(true);
        expect(isRunning({ kill: true })).toBe(false);
        expect(isRunning({})).toBe(true);
    });
});
