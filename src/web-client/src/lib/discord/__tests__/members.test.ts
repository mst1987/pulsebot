// System › Discord › Mitglieder, the pure part: filters and their counts, the sort
// values, the role cell, the roster column and the deep link.
import { describe, expect, it } from "vitest";
import type { MemberRole, ServerMember } from "../../../api";
import {
    NO_FILTER, classColorOf, filterCounts, filterMembers, isOutsideRoster, joinedDate, matchesQuery,
    memberFromQuery, memberSortValue, rosterView, rostersOfCharacter, splitRoles, versionShort,
} from "../members";

function member(over: Partial<ServerMember>): ServerMember {
    return { id: "u", name: "Name", username: "name", avatarUrl: null, bot: false, joinedAt: null, roleIds: [], rosters: [], characters: [], missingRosters: [], ...over };
}

const ROLES: MemberRole[] = [
    { id: "orga", name: "Orga", color: "#e74c3c", position: 9 },
    { id: "raider", name: "Raider", color: "", position: 5 },
    { id: "koch", name: "Kochen", color: "#2ecc71", position: 2 },
    { id: "angel", name: "Angeln", color: "", position: 1 },
];
const BY_ID = new Map(ROLES.map((r) => [r.id, r]));

const THRALL = member({
    id: "t", name: "Thrall", username: "thrall_99", roleIds: ["orga", "raider"], joinedAt: Date.UTC(2026, 5, 2, 12),
    rosters: [{ id: "r1", name: "Naxx-Kader", categoryId: "c1", versionId: "forever", status: "core" }],
    characters: [{ name: "Gromm", className: "Warrior", versionId: "tbc", rosterIds: [] }, { name: "Thrallo", className: "Shaman", versionId: "forever", rosterIds: ["r1"] }],
});
const JAINA = member({ id: "j", name: "Jaina", username: "jaina", roleIds: ["koch"], characters: [{ name: "Proudmoore", className: "Mage", versionId: "tbc", rosterIds: [] }] });
const NOBODY = member({ id: "n", name: "Neu", username: "neu" });
const BOT = member({ id: "b", name: "PulseBot", username: "pulsebot", bot: true, roleIds: ["raider"] });
const ALL = [THRALL, JAINA, NOBODY, BOT];

describe("members: filters", () => {
    it("searches name, Discord name and characters, ignoring case and blanks", () => {
        expect(matchesQuery(THRALL, "")).toBe(true);
        expect(matchesQuery(THRALL, "  THR ")).toBe(true);
        expect(matchesQuery(THRALL, "_99")).toBe(true);
        expect(matchesQuery(THRALL, "gromm")).toBe(true);
        expect(matchesQuery(THRALL, "jaina")).toBe(false);
    });

    it("never counts a bot as outside the roster", () => {
        expect(isOutsideRoster(NOBODY)).toBe(true);
        expect(isOutsideRoster(THRALL)).toBe(false);
        expect(isOutsideRoster(BOT)).toBe(false);
    });

    it("hides bots by default and combines the switches", () => {
        expect(filterMembers(ALL, NO_FILTER).map((m) => m.id)).toEqual(["t", "j", "n"]);
        expect(filterMembers(ALL, { ...NO_FILTER, hideBots: false }).map((m) => m.id)).toEqual(["t", "j", "n", "b"]);
        expect(filterMembers(ALL, { ...NO_FILTER, noRole: true }).map((m) => m.id)).toEqual(["n"]);
        expect(filterMembers(ALL, { ...NO_FILTER, notInRoster: true }).map((m) => m.id)).toEqual(["j", "n"]);
        expect(filterMembers(ALL, { ...NO_FILTER, roleId: "raider", hideBots: false }).map((m) => m.id)).toEqual(["t", "b"]);
        expect(filterMembers(ALL, { ...NO_FILTER, query: "proud" }).map((m) => m.id)).toEqual(["j"]);
    });

    it("counts beside the switches leave the bots out while they are hidden", () => {
        expect(filterCounts(ALL, true)).toEqual({ noRole: 1, notInRoster: 2, bots: 1 });
        expect(filterCounts([...ALL, member({ id: "b2", bot: true })], false)).toEqual({ noRole: 2, notInRoster: 2, bots: 2 });
    });
});

describe("members: sorting", () => {
    it("sorts roles by the highest role, unknown or none last", () => {
        expect(memberSortValue(THRALL, "roles", BY_ID)).toBe(9);
        expect(memberSortValue(JAINA, "roles", BY_ID)).toBe(2);
        expect(memberSortValue(NOBODY, "roles", BY_ID)).toBe(-1);
        expect(memberSortValue(member({ roleIds: ["gone"] }), "roles", BY_ID)).toBe(-1);
    });

    it("sorts the roster column roster first, then characters, then nothing", () => {
        expect(memberSortValue(THRALL, "roster", BY_ID)).toBe("0naxx-kader");
        expect(memberSortValue(JAINA, "roster", BY_ID)).toBe("1proudmoore");
        expect(memberSortValue(NOBODY, "roster", BY_ID)).toBe("2neu");
        expect(memberSortValue(THRALL, "joined", BY_ID)).toBe(THRALL.joinedAt);
        expect(memberSortValue(NOBODY, "joined", BY_ID)).toBe(0);
        expect(memberSortValue(THRALL, "name", BY_ID)).toBe("thrall");
    });
});

describe("members: cells", () => {
    it("shows at most max roles and keeps the rest for the tooltip, dropping unknown ids", () => {
        const { shown, more } = splitRoles(["orga", "gone", "raider", "koch", "angel"], BY_ID, 3);
        expect(shown.map((r) => r.id)).toEqual(["orga", "raider", "koch"]);
        expect(more.map((r) => r.id)).toEqual(["angel"]);
        expect(splitRoles([], BY_ID).shown).toEqual([]);
    });

    it("formats the join date and leaves an unknown one empty", () => {
        expect(joinedDate(Date.UTC(2026, 5, 2, 12))).toMatch(/02\D06\D2026|06\D02\D2026/);
        expect(joinedDate(null)).toBe("");
    });

    it("names versions short and colours known classes only", () => {
        expect(versionShort("tbc")).toBe("TBC");
        expect(versionShort("forever")).toBe("Forever");
        expect(versionShort("")).toBe("");
        expect(classColorOf("Shaman")).toBe("#0070DE");
        expect(classColorOf("Any")).toBe("");
        expect(classColorOf("")).toBe("");
        expect(classColorOf("Unknown")).toBe("");
    });

    it("picks the character of the roster's version for the roster column", () => {
        expect(rosterView(THRALL)).toEqual({ kind: "roster", character: THRALL.characters[1], roster: THRALL.rosters[0], more: 0 });
        const two = member({ rosters: [THRALL.rosters[0], { ...THRALL.rosters[0], id: "r2", name: "Zweit" }] });
        expect(rosterView(two)).toEqual({ kind: "roster", character: null, roster: THRALL.rosters[0], more: 1 });
        expect(rosterView(JAINA)).toEqual({ kind: "outside", character: JAINA.characters[0] });
        expect(rosterView(NOBODY)).toEqual({ kind: "none" });
    });

    it("takes the character that stands in the roster, not the first of the version", () => {
        // two characters of the same version: only the second is in the roster
        const twin = member({
            rosters: [THRALL.rosters[0]],
            characters: [
                { name: "Erster", className: "Warrior", versionId: "forever", rosterIds: [] },
                { name: "Zweiter", className: "Shaman", versionId: "forever", rosterIds: ["r1"] },
            ],
        });
        expect(rosterView(twin)).toMatchObject({ kind: "roster", character: { name: "Zweiter" } });
        // no character in the roster: the first one stands for the member
        const loose = member({ rosters: [THRALL.rosters[0]], characters: [twin.characters[0]] });
        expect(rosterView(loose)).toMatchObject({ character: { name: "Erster" } });
    });

    it("lists the rosters a character stands in, in the member's order", () => {
        const both = member({
            rosters: [THRALL.rosters[0], { ...THRALL.rosters[0], id: "r2", name: "Zweit" }],
            characters: [{ name: "Thrallo", className: "Shaman", versionId: "forever", rosterIds: ["r2", "r1"] }],
        });
        expect(rostersOfCharacter(both, both.characters[0]).map((r) => r.id)).toEqual(["r1", "r2"]);
        expect(rostersOfCharacter(THRALL, THRALL.characters[0])).toEqual([]);
    });

    it("finds the member of a deep link only when it is on the list", () => {
        expect(memberFromQuery(ALL, "j")).toBe(JAINA);
        expect(memberFromQuery(ALL, "x")).toBeNull();
        expect(memberFromQuery(ALL, null)).toBeNull();
    });
});
