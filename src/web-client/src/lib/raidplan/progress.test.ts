// #534: the raid window and the section the plan turns to (lib/raidplan/progress.ts).
import { describe, expect, it } from "vitest";
import { followTarget, inRaidWindow } from "./progress";

const START = 1_800_000_000; // seconds, as the payloads carry it
const MS = START * 1000;
const live = (over: Partial<{ killed: string[]; current: string | null; next: string | null }> = {}) => ({ live: true, killed: [], current: null, next: null, updatedAt: 1, ...over });

describe("inRaidWindow", () => {
    it("runs from 30 minutes before the start to 6 hours after", () => {
        expect(inRaidWindow(START, MS - 30 * 60_000 - 1)).toBe(false);
        expect(inRaidWindow(START, MS - 30 * 60_000)).toBe(true);
        expect(inRaidWindow(START, MS + 6 * 3_600_000)).toBe(true);
        expect(inRaidWindow(START, MS + 6 * 3_600_000 + 1)).toBe(false);
    });
    it("takes a start in ms as well and refuses none", () => {
        expect(inRaidWindow(MS, MS)).toBe(true);
        expect(inRaidWindow(0, MS)).toBe(false);
        expect(inRaidWindow(Number.NaN, MS)).toBe(false);
    });
});

describe("followTarget", () => {
    const keys = ["general", "bt/supremus", "bt/shade-of-akama"];
    it("prefers the boss being fought, else the next one", () => {
        expect(followTarget(live({ current: "bt/shade-of-akama", next: "bt/supremus" }), keys)).toBe("bt/shade-of-akama");
        expect(followTarget(live({ next: "bt/supremus" }), keys)).toBe("bt/supremus");
    });
    it("says nothing without a live log, when all is down or the page lacks the section", () => {
        expect(followTarget(null, keys)).toBeNull();
        expect(followTarget({ ...live({ next: "bt/supremus" }), live: false }, keys)).toBeNull();
        expect(followTarget(live(), keys)).toBeNull();
        expect(followTarget(live({ next: "bt/illidan-stormrage" }), keys)).toBeNull();
    });
});
