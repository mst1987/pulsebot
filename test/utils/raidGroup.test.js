// The pure readers of a raid group (#811) on an event record.
const { raidGroupIdOf, inRaidGroup, isRaidSibling, isRaidPrimary, signupEventIdOf, raidIndexOf } = require("../../src/utils/raidGroup");

const plain = { id: "eh-a" };
const primary = { id: "eh-a", raidGroupId: "eh-a", raidGroupIndex: 1 };
const sibling = { id: "eh-b", raidGroupId: "eh-a", raidGroupIndex: 2 };

describe("utils/raidGroup", () => {
    it("tells a plain event, a group's first raid and a further raid apart", () => {
        expect([inRaidGroup(plain), isRaidPrimary(plain), isRaidSibling(plain)]).toEqual([false, false, false]);
        expect([inRaidGroup(primary), isRaidPrimary(primary), isRaidSibling(primary)]).toEqual([true, true, false]);
        expect([inRaidGroup(sibling), isRaidPrimary(sibling), isRaidSibling(sibling)]).toEqual([true, false, true]);
        expect(raidGroupIdOf(sibling)).toBe("eh-a");
        expect(raidGroupIdOf(null)).toBe("");
    });

    it("reads every raid's signups from the group's first raid", () => {
        expect(signupEventIdOf(plain)).toBe("eh-a");
        expect(signupEventIdOf(primary)).toBe("eh-a");
        expect(signupEventIdOf(sibling)).toBe("eh-a");
        expect(signupEventIdOf({ id: "eh-x" })).toBe("eh-x");
    });

    it("numbers the raids: 1 for the first (or no group), the stored place else, 2 for a further raid without one", () => {
        expect(raidIndexOf(plain)).toBe(1);
        expect(raidIndexOf(primary)).toBe(1);
        expect(raidIndexOf(sibling)).toBe(2);
        expect(raidIndexOf({ id: "eh-c", raidGroupId: "eh-a", raidGroupIndex: 3 })).toBe(3);
        expect(raidIndexOf({ id: "eh-c", raidGroupId: "eh-a" })).toBe(2);
    });
});
