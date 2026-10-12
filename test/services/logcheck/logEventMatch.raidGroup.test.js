// Logs of a raid group (#811): its raids start together in the same category, so
// time and category cannot tell them apart. The log's title naming the raid's
// number decides it ("Zul'Aman 2" → Raid 2); otherwise the log stays ambiguous and
// the matching offers every raid of the group.
const { bestMatch, autoMatches, annotateMatches, siblingPick, raidNumberOf } = require("../../../src/services/logcheck/logEventMatch");

const START = 2000000000; // seconds
const posted = (START + 30 * 60) * 1000;
const za = { id: "eh-za", title: "Zul'Aman", startTime: START, categoryId: "cat", raidGroupId: "eh-za", raidGroupIndex: 1 };
const za2 = { id: "eh-za2", title: "Zul'Aman 2", startTime: START, categoryId: "cat", raidGroupId: "eh-za", raidGroupIndex: 2 };
const log = (title) => ({ id: "l1", postedAt: posted, categoryId: "cat", title });

describe("logEventMatch with a raid group", () => {
    it("reads the raid number of a title", () => {
        expect(raidNumberOf("Zul'Aman 2")).toBe(2);
        expect(raidNumberOf("ZA #2")).toBe(2);
        expect(raidNumberOf("Raid 1 ZA")).toBe(1);
        expect(raidNumberOf("Zul'Aman")).toBe(0);
        expect(raidNumberOf("SSC 25")).toBe(0);
    });

    it("attaches a log of Raid 2 to Raid 2 when its title says so", () => {
        const result = bestMatch(log("Zul'Aman 2"), [za, za2]);
        expect(result.match.event.id).toBe("eh-za2");
        expect(result.ambiguous).toBe(false);
        expect(autoMatches([log("ZA #2")], [za, za2]).map((m) => m.event.id)).toEqual(["eh-za2"]);
    });

    it("stays ambiguous without a number — the matching offers the group's raids", () => {
        const result = bestMatch(log("Zul'Aman"), [za, za2]);
        expect(result.ambiguous).toBe(true);
        expect(autoMatches([log("Zul'Aman")], [za, za2])).toEqual([]);
        const [annotated] = annotateMatches([log("Zul'Aman")], [za, za2]);
        expect(annotated.candidates.map((c) => [c.eventId, c.raidGroupIndex])).toEqual([["eh-za", 1], ["eh-za2", 2]]);
    });

    it("picks only among the raids of one group", () => {
        const other = { id: "eh-kara", title: "Kara", startTime: START, categoryId: "cat" };
        expect(siblingPick(log("Kara 2"), [{ event: other, diffMs: 0 }, { event: za2, diffMs: 0 }])).toBeNull();
        expect(siblingPick(log("Zul'Aman 3"), [{ event: za, diffMs: 0 }, { event: za2, diffMs: 0 }])).toBeNull();
    });
});
