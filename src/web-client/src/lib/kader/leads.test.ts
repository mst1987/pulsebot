import { describe, expect, it } from "vitest";
import { entry, kader } from "../../pages/kader/kader.fixture";
import { LEAD_ALL, LEAD_HUES, LEAD_ME, LEAD_NONE, cleanLeadPick, interviewersOf, leadHue, leadHues, leadMatches } from "./leads";

const A = "111111111111111111";
const B = "222222222222222222";
const C = "333333333333333333";
const D = "444444444444444444";

describe("lead colours", () => {
    it("gives a lead the same colour whatever the order of the list", () => {
        const forward = leadHues([A, B, C]);
        const backward = leadHues([C, B, A]);
        expect(backward).toEqual(forward);
        expect(leadHue([A, B, C], B)).toBe(forward[B]);
    });

    it("keeps the colour of a lead when somebody else is removed", () => {
        const three = leadHues([A, B, C]);
        const hueOfA = three[A];
        // the lowest id is never moved by a collision, so removing the others cannot change it
        expect(leadHues([A]) [A]).toBe(hueOfA);
        expect(leadHue([A, B], A)).toBe(hueOfA);
    });

    it("tells apart up to as many leads as there are colours", () => {
        const four = Object.values(leadHues([A, B, C, D]));
        expect(new Set(four).size).toBe(LEAD_HUES);
        expect(Math.max(...four)).toBeLessThan(LEAD_HUES);
    });

    it("gives somebody who is no lead (any more) a colour from their id", () => {
        const hue = leadHue([A], D);
        expect(hue).toBeGreaterThanOrEqual(0);
        expect(hue).toBeLessThan(LEAD_HUES);
        expect(leadHue([A], D)).toBe(hue);
    });
});

describe("the interviewer pick", () => {
    const withLead = (lead: string) => entry({ state: "selected", interview: { ...entry().interview, lead } });

    it("lists the leads, then a former lead who still has interviews", () => {
        const k = kader({ leads: [A, B] });
        expect(interviewersOf(k, [withLead(C), withLead(A), withLead("")])).toEqual([A, B, C]);
    });

    it("matches all, me, nobody and one person", () => {
        expect(leadMatches(withLead(A), LEAD_ALL, A)).toBe(true);
        expect(leadMatches(withLead(A), LEAD_ME, A)).toBe(true);
        expect(leadMatches(withLead(B), LEAD_ME, A)).toBe(false);
        expect(leadMatches(withLead(""), LEAD_ME, A)).toBe(false);
        expect(leadMatches(withLead(""), LEAD_NONE, A)).toBe(true);
        expect(leadMatches(withLead(B), LEAD_NONE, A)).toBe(false);
        expect(leadMatches(withLead(B), B, A)).toBe(true);
        expect(leadMatches(withLead(A), B, A)).toBe(false);
    });

    it("repairs a stored pick", () => {
        expect(cleanLeadPick(B, [A, B])).toBe(B);
        expect(cleanLeadPick(C, [A, B])).toBe(LEAD_ALL);
        expect(cleanLeadPick(LEAD_ME, [])).toBe(LEAD_ME);
        expect(cleanLeadPick(LEAD_NONE, [])).toBe(LEAD_NONE);
        expect(cleanLeadPick(7, [A])).toBe(LEAD_ALL);
        expect(cleanLeadPick(undefined, [A])).toBe(LEAD_ALL);
    });
});
