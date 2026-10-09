import { describe, expect, it } from "vitest";
import {
    MEMBER_VIEW_DEFAULT, dpsTarget, filterMembers, groupByStatus, initialOf, readMemberView, sortMembers, statusCounts,
} from "./rosters";
import { member, memberChar } from "../../pages/roster/rosters.fixture";

const A = member("Anna", { role: "tank", attendance: { attended: 1, total: 2, pct: 50, missed: [] }, since: "2026-01-01T00:00:00.000Z" });
const B = member("bert", { role: "healer", hasRole: false, attendance: null, chars: [memberChar("Zed")], since: "2026-03-01T00:00:00.000Z" });
const C = member("Carl", { status: "pause", role: "dps", hasRole: null });
const D = member("Dora", { status: "trial", role: "", chars: [] });

describe("readMemberView", () => {
    it("reads a stored view field by field and falls back on anything unknown", () => {
        expect(readMemberView(null)).toEqual(MEMBER_VIEW_DEFAULT);
        expect(readMemberView({ statuses: ["pause", "core", "nope"] as never, role: "mage" as never, search: 3 as never }))
            .toEqual({ statuses: ["core", "pause"], role: "all", search: "" });
        expect(readMemberView({ statuses: [], role: "healer", search: "x" })).toEqual({ statuses: [], role: "healer", search: "x" });
    });
});

describe("filterMembers", () => {
    it("keeps the picked statuses, the role and a search over name and characters", () => {
        const all = [A, B, C, D];
        expect(filterMembers(all, MEMBER_VIEW_DEFAULT).map((m) => m.displayName)).toEqual(["Anna", "bert", "Dora"]);
        expect(filterMembers(all, { ...MEMBER_VIEW_DEFAULT, role: "healer" }).map((m) => m.displayName)).toEqual(["bert"]);
        expect(filterMembers(all, { ...MEMBER_VIEW_DEFAULT, search: " zed " }).map((m) => m.displayName)).toEqual(["bert"]);
        expect(filterMembers(all, { statuses: ["pause"], role: "all", search: "" }).map((m) => m.displayName)).toEqual(["Carl"]);
    });
});

describe("sortMembers / groupByStatus / statusCounts", () => {
    it("sorts by name (case-insensitive), attendance (none last), Discord role (missing first) and date", () => {
        expect(sortMembers([B, A], "name", "asc").map((m) => m.displayName)).toEqual(["Anna", "bert"]);
        expect(sortMembers([B, A], "attendance", "desc").map((m) => m.displayName)).toEqual(["Anna", "bert"]);
        expect(sortMembers([A, C, B], "discord", "asc").map((m) => m.displayName)).toEqual(["bert", "Anna", "Carl"]);
        expect(sortMembers([A, B], "since", "desc").map((m) => m.displayName)).toEqual(["bert", "Anna"]);
        expect(sortMembers([D, A], "chars", "asc").map((m) => m.displayName)).toEqual(["Anna", "Dora"]);
        expect(sortMembers([B, A], "role", "asc").map((m) => m.displayName)).toEqual(["Anna", "bert"]);
    });

    it("groups in the status order and counts per status", () => {
        expect(groupByStatus([C, D, A]).map((g) => [g.status, g.rows.length])).toEqual([["core", 1], ["trial", 1], ["pause", 1]]);
        expect(statusCounts([A, B, C, D])).toEqual({ core: 2, trial: 1, bench: 0, pause: 1 });
    });
});

describe("small helpers", () => {
    it("takes the avatar letter and the damage target", () => {
        expect(initialOf("lunaria")).toBe("L");
        expect(initialOf("")).toBe("?");
        expect(dpsTarget({ total: 25, tank: 3, healer: 7 })).toBe(15);
        expect(dpsTarget({ total: 0, tank: 3, healer: 7 })).toBe(0);
    });
});
