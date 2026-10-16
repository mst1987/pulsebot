// Raid groups (#811) in the raid lists: further raids under their first raid.
import { describe, expect, it } from "vitest";
import { isFurtherRaid, withRaidGroups } from "./raidGroups";

const row = (id: string, raidGroupId = "", raidGroupIndex = 0) => ({ id, raidGroupId, raidGroupIndex });

describe("withRaidGroups", () => {
    it("moves the further raids under their first raid, in their order", () => {
        const out = withRaidGroups([row("a"), row("za3", "za", 3), row("za", "za", 1), row("za2", "za", 2)]);
        expect(out.map((r) => r.id)).toEqual(["a", "za"]);
        expect(out[1].groupRaids?.map((r) => r.id)).toEqual(["za2", "za3"]);
        expect(out[0].groupRaids).toBeUndefined();
    });

    it("keeps a further raid whose first raid is not in the list as a row of its own", () => {
        expect(withRaidGroups([row("za2", "za", 2)]).map((r) => r.id)).toEqual(["za2"]);
    });

    it("tells a further raid", () => {
        expect(isFurtherRaid(row("za2", "za", 2))).toBe(true);
        expect(isFurtherRaid(row("za", "za", 1))).toBe(false);
        expect(isFurtherRaid(row("x"))).toBe(false);
    });
});
