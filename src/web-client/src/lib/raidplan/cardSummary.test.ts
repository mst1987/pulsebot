// The one-line summaries of folded blocks (#559): an assignment card ("5 Zeilen, 1 abweichend, 1 offen") and the Besetzung ("25 besetzt, 2 offen").
import { describe, expect, it } from "vitest";
import type { RaidplanAssignment } from "../../api";
import { cardSummary, slotSummary } from "./assignLine";
import type { AssignCtx } from "./assign";

const ctx: AssignCtx = { slots: [], players: new Map(), catalog: null, filled: [], groupColors: {}, groupMarks: {}, icons: [] };
const row = (id: string, origin?: string): RaidplanAssignment => ({ id, type: "heal", assignees: [], targets: [{ kind: "group", ref: "1" }], note: "", title: "", spell: null, suggested: false, ...(origin ? { origin } : {}) } as unknown as RaidplanAssignment);

describe("cardSummary deviating (#559)", () => {
    it("counts the rows that differ from the Standard for this boss, not the copies applied from a template", () => {
        const rows = [row("a"), row("b", "d1"), row("c", "d2"), row("d", "default")];
        expect(cardSummary(rows, rows, ctx, false)).toMatchObject({ rows: 4, deviating: 2 });
    });
    it("inherited rows (resolved with origin = their Standard row) are not deviations: only the `own` rows count", () => {
        const inherited = [row("i1", "d1"), row("i2", "d2")];
        const own = [row("a"), row("b", "d3")];
        expect(cardSummary([...inherited, ...own], [...inherited, ...own], ctx, false, own)).toMatchObject({ rows: 4, deviating: 1 });
    });
    it("no deviation, no rows", () => {
        expect(cardSummary([], [], ctx, false)).toEqual({ rows: 0, open: 0, deviating: 0 });
    });
});

describe("slotSummary (#559)", () => {
    const slots = [{ kind: "tank", userId: "a" }, { kind: "healer", userId: "" }, { kind: "dps", userId: "b" }, { kind: "group", userId: "" }];
    it("an event: raiders standing in a slot are filled, the rest open; a group marker is no slot", () => {
        expect(slotSummary(slots, true)).toEqual({ total: 3, filled: 2, open: 1 });
    });
    it("a template has nobody in a slot, so nothing is open", () => {
        expect(slotSummary(slots, false)).toEqual({ total: 3, filled: 0, open: 0 });
    });
});
