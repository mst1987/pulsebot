// The Kaderplaner's pure logic: board counts, filters with their counts,
// grouping, the setup moves and hints, the text for Discord.
import { describe, expect, it } from "vitest";
import { kaderView, U } from "../../pages/kader/kader.fixture";
import {
    attText, averageAttendance, byId, classCounts, focusOf, groupHints, moveToSlot, pickRoster,
    raidBuffStatus, removeFromGroups, roleCards, specLine, statusOf, unassigned,
} from "./model";
import { EMPTY_FILTERS, cleanFilters, countWith, filterCount, groupPlayers, passes, sortPlayers } from "./players";
import { setupText } from "./setupText";

const view = kaderView();
const players = byId(view.players);
const roster = view.rosters[0];
const status = (id: string) => statusOf(roster, id);

describe("lib/kader/model", () => {
    it("knows who is in the roster, on the bench or free", () => {
        expect([U.tank, U.sham, U.mage].map(status)).toEqual(["kader", "bench", "none"]);
        expect(statusOf(null, U.tank)).toBe("none");
    });

    it("fills the role cards up to their targets", () => {
        const cards = roleCards(roster, players);
        expect(cards.map((c) => [c.role, c.count, c.target, c.slots.length])).toEqual([["tank", 1, 2, 2], ["healer", 1, 5, 5], ["melee", 0, 7, 7], ["ranged", 0, 6, 6]]);
        expect(cards[0].slots[0]?.userId).toBe(U.tank);
        expect(cards[0].slots[1]).toBeNull();
    });

    it("counts classes, raid buffs and the average attendance of the roster", () => {
        expect(classCounts(roster, players, view.classes).map((c) => [c.key, c.n])).toEqual([["Shaman", 1], ["Warrior", 1]]);
        expect(raidBuffStatus(roster, players, view.buffs.raid).map((b) => b.ok)).toEqual([false]);
        expect(averageAttendance(roster, players)).toBe(75);
        expect(averageAttendance({ ...roster, members: [] }, players)).toBeNull();
    });

    it("shows no attendance as a dash and names class and spec", () => {
        expect(attText(players.get(U.sham)!)).toBe("—");
        expect(attText(players.get(U.tank)!)).toBe("90 %");
        expect(specLine(players.get(U.tank)!, view.classes)).toBe("Krieger · Schutz");
        expect(specLine(players.get(U.hand)!, view.classes)).toBe("noch kein Forever-Charakter");
    });

    it("picks the remembered roster, else the first", () => {
        expect(pickRoster(view, "r1")?.id).toBe("r1");
        expect(pickRoster(view, "gone")?.id).toBe("r1");
        expect(pickRoster({ ...view, rosters: [] }, "r1")).toBeNull();
    });

    it("moves a player onto a slot and swaps the one sitting there", () => {
        let groups = moveToSlot([[null, null], [null, null]], "a", 0, 0);
        expect(groups).toEqual([["a", null], [null, null]]);
        groups = moveToSlot(groups, "b", 1, 1);
        groups = moveToSlot(groups, "a", 1, 1);
        expect(groups).toEqual([["b", null], [null, "a"]]);
        expect(moveToSlot(groups, "a", 5, 0)).toBe(groups);
        expect(removeFromGroups(groups, "a")).toEqual([["b", null], [null, null]]);
    });

    it("lists who has no group yet, names a group's focus and its buff hints", () => {
        const variant = { id: "v", name: "A", groups: [[U.tank, null, null, null, null]] };
        expect(unassigned(roster, variant)).toEqual([U.heal]);
        const roles = new Map([[U.tank, "tank" as const], [U.heal, "healer" as const], [U.sham, "melee" as const]]);
        expect(focusOf([U.tank, null], roles)).toBe("tank");
        expect(focusOf([U.tank, U.heal], roles)).toBe("mixed");
        expect(focusOf([null], roles)).toBe("empty");
        // two melee who want Windfury and no shaman bringing it: missing
        const warrior2 = { ...players.get(U.tank)!, userId: "w2" };
        const map = new Map([...players, ["w2", warrior2]]);
        expect(groupHints([U.tank, "w2"], map, view.buffs.party)).toEqual([{ key: "windfury", label: "Totem des Windzorns", ok: false }]);
        expect(groupHints([U.tank, U.sham], players, view.buffs.party)).toEqual([{ key: "windfury", label: "Totem des Windzorns", ok: true }]);
        expect(groupHints([U.tank], players, view.buffs.party)).toEqual([]);
    });
});

describe("lib/kader/players", () => {
    it("filters and counts each option without its own filter", () => {
        const f = { ...EMPTY_FILTERS, classes: ["Shaman"] };
        expect(view.players.filter((p) => passes(p, f, status, view.classes)).map((p) => p.userId)).toEqual([U.heal, U.sham]);
        // the count beside "Mage" ignores the class filter itself
        expect(countWith(view.players, f, status, view.classes, "classes", (p) => p.userId === U.mage)).toBe(1);
        expect(passes(players.get(U.tank)!, { ...EMPTY_FILTERS, days: ["mi", "do"] }, status, view.classes)).toBe(true);
        expect(passes(players.get(U.heal)!, { ...EMPTY_FILTERS, days: ["mi", "do"] }, status, view.classes)).toBe(false);
        expect(passes(players.get(U.mage)!, { ...EMPTY_FILTERS, minAtt: 90 }, status, view.classes)).toBe(false);
        expect(passes(players.get(U.hand)!, { ...EMPTY_FILTERS, classes: ["-"] }, status, view.classes)).toBe(true);
        expect(passes(players.get(U.mage)!, { ...EMPTY_FILTERS, q: "funken" }, status, view.classes)).toBe(true);
        expect(filterCount({ ...EMPTY_FILTERS, roles: ["tank"], minAtt: 50 })).toBe(2);
    });

    it("repairs stored filters", () => {
        expect(cleanFilters({ roles: ["tank", "boss"], minAtt: 33, days: ["mo", "xx"], q: 5 })).toEqual({ ...EMPTY_FILTERS, roles: ["tank"], days: ["mo"] });
        expect(cleanFilters(null)).toEqual(EMPTY_FILTERS);
    });

    it("sorts by attendance (nothing counted last) or by name", () => {
        expect(sortPlayers(view.players, "att").map((p) => p.userId)).toEqual([U.tank, U.mage, U.heal, U.hand, U.sham]);
        expect(sortPlayers(view.players, "name").map((p) => p.displayName)).toEqual(["Aldric", "Liss", "Mira", "Neuling", "Tomas"]);
    });

    it("groups by role, class, attendance and status with count, mix and average", () => {
        const byRole = groupPlayers(view.players, "role", view.classes, status);
        expect(byRole.map((g) => [g.key, g.items.length])).toEqual([["tank", 1], ["healer", 1], ["melee", 1], ["ranged", 1], ["-", 1]]);
        const byClass = groupPlayers(view.players, "cls", view.classes, status);
        const shamans = byClass.find((g) => g.key === "Shaman")!;
        expect(shamans).toMatchObject({ inKader: 1, avg: 60, color: "#0070DE" });
        expect(shamans.mix).toEqual([{ key: "Shaman", color: "#0070DE", n: 2, share: 100 }]);
        const byAtt = groupPlayers(view.players, "att", view.classes, status);
        expect(byAtt.map((g) => g.key)).toEqual(["tier-0", "tier-1", "tier-2", "tier-none"]);
        expect(groupPlayers(view.players, "status", view.classes, status).map((g) => [g.key, g.items.length])).toEqual([["kader", 2], ["bench", 1], ["none", 2]]);
        expect(groupPlayers(view.players, "none", view.classes, status)[0].avg).toBe(77);
    });
});

describe("lib/kader/setupText", () => {
    it("writes the groups, who is left and the bench for Discord", () => {
        const variant = { id: "v", name: "Plan", groups: [[U.tank, null, null, null, null], [null, null, null, null, null]] };
        expect(setupText({ variant, roster, players, classes: view.classes })).toBe([
            "**Hyjal Mittwoch · Plan**",
            "",
            "**Gruppe 1**",
            "1. Aldric Sturmwind (Krieger · Schutz) @Aldric",
            "",
            "**Gruppe 2**",
            "(leer)",
            "",
            "**Noch ohne Gruppe:** Mira Sonnlicht (Schamane · Wiederherstellung) @Mira",
            "",
            "**Ersatzbank:** Tomas Erdherz (Schamane · Verstärkung) @Tomas",
        ].join("\n"));
    });
});
