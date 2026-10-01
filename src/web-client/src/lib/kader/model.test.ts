import { describe, expect, it } from "vitest";
import { t } from "../../i18n";
import { CAT, kader, kaderView, RAID_CATEGORIES, U, ME } from "../../pages/kader/kader.fixture";
import {
    attPartsText, attText, attendanceCategoriesOf, attendanceOf, byId, canMove, categoryLabel, className, countStates, dayOf, daysSince, entriesIn,
    historyText, mainPick, nameOf, playerName, roleCounts, rolesOf, searchText, specName, specRole, stampOf, togglePick, versionsDiffer, wishLabel,
    wishOptions, MOVES, STATES,
} from "./model";

describe("lib/kader/model", () => {
    const view = kaderView();

    it("lists what a player can stand for: the wishes in order, a decision outside them first", () => {
        const k = kader();
        expect(wishOptions(k.players[U.heal]).map((o) => [o.rank, o.pick.spec])).toEqual([[1, "Shaman-Restoration"], [2, "Shaman-Enhancement"]]);
        const decided = { ...k.players[U.tank], decision: { className: "Warrior", spec: "Warrior-Fury" } };
        expect(wishOptions(decided).map((o) => [o.rank, o.pick.spec])).toEqual([[0, "Warrior-Fury"], [1, "Warrior-Protection"]]);
        // a slot's spec that is no longer wished stays visible as the current one
        expect(wishOptions(k.players[U.heal], "Mage-Frost")[0]).toEqual({ rank: -1, pick: { className: "Mage", spec: "Mage-Frost" } });
    });
    const players = byId(view.players);

    it("knows the moves the server allows, back steps included", () => {
        expect(canMove("pool", "selected")).toBe(true);
        expect(canMove("pool", "provisional")).toBe(false);
        expect(canMove("selected", "pool")).toBe(true);
        expect(canMove("roster", "provisional")).toBe(true);
        expect(canMove("bench", "roster")).toBe(true);
        expect(canMove("roster", "roster")).toBe(false);
        // every state leads somewhere, and nothing leads straight from the pool to a decision
        for (const s of STATES) expect(MOVES[s].length).toBeGreaterThan(0);
    });

    it("names classes, specs, roles and wishes", () => {
        expect(className(view.classes, "Shaman")).toBe("Schamane");
        expect(specName(view.classes, "Shaman-Restoration")).toBe("Wiederherstellung");
        expect(specRole(view.classes, "Warrior-Protection")).toBe("tank");
        expect(specRole(view.classes, "Nope-Nope")).toBeNull();
        expect(wishLabel(view.classes, { className: "Mage", spec: "Mage-Frost" })).toBe("Magier · Frost");
        expect(wishLabel(view.classes, null)).toBe("");
    });

    it("shows what a player plays: the decision in the roster, else the first wish, else the prefilled character", () => {
        const k = kader();
        expect(mainPick(players.get(U.tank), k.players[U.tank])).toEqual({ className: "Warrior", spec: "Warrior-Protection" });
        expect(mainPick(players.get(U.heal), k.players[U.heal])).toEqual({ className: "Shaman", spec: "Shaman-Restoration" });
        expect(mainPick(players.get(U.mage))).toEqual({ className: "Mage", spec: "Mage-Frost" });
        expect(mainPick(players.get(U.hand), k.players[U.hand])).toBeNull();
    });

    it("names players and whoever acted, the system for a migration", () => {
        const k = kader();
        expect(playerName(view, U.tank)).toBe("Aldric");
        // a Discord name that is just the id falls back to what the Kader kept
        expect(playerName(view, U.done, k.players[U.done])).toBe("Brakk");
        expect(playerName(view, "nobody-known")).toBe("nobody-known");
        expect(nameOf(view, ME)).toBe("Admin");
        expect(nameOf(view, "")).toBe(t("kader.system"));
    });

    it("counts the states and lists the entries of some", () => {
        const k = kader();
        expect(countStates(k)).toEqual({ pool: 1, selected: 2, provisional: 1, roster: 1, bench: 1, tentative: 1 });
        expect(entriesIn(k, ["roster", "bench"]).map(([id]) => id).sort()).toEqual([U.tank, U.sham].sort());
    });

    it("sums the attendance over the Kader's raid categories only, with each category's share", () => {
        const k = kader();
        const tank = attendanceOf(view, k, players.get(U.tank));
        // Mo 9/11 + Do 7/10
        expect(tank && { attended: tank.attended, counted: tank.counted, pct: tank.pct }).toEqual({ attended: 16, counted: 21, pct: 76 });
        expect(attPartsText(tank)).toBe("Mo Raid 9/11 · Do Raid 7/10");
        // the nights of every picked category, newest first, each with its category
        expect(tank?.nights.map((n) => [n.date, n.category])).toEqual([["2026-09-28", "Mo Raid"], ["2026-09-24", "Do Raid"], ["2026-09-21", "Mo Raid"]]);
        // Liss: the PUG nights are not picked, only Do counts
        expect(attendanceOf(view, k, players.get(U.mage))?.pct).toBe(40);
        expect(attPartsText(attendanceOf(view, k, players.get(U.mage)))).toBe("Do Raid 2/5");
        // picked, but no night counted for Tomas; Neuling has no attendance at all
        expect(attendanceOf(view, k, players.get(U.sham))).toBeNull();
        expect(attendanceOf(view, k, players.get(U.hand))).toBeNull();
        expect(attendanceOf(view, k, undefined)).toBeNull();
        expect(attText(null)).toBe("—");
        expect(attText({ pct: 75 })).toBe("75 %");
        expect(attPartsText(null)).toBe("");
    });

    it("shows no attendance at all while the Kader picked no category — no fallback", () => {
        const none = kader({ attendanceCategories: [] });
        expect(attendanceCategoriesOf(view, none)).toEqual([]);
        expect(attendanceOf(view, none, players.get(U.tank))).toBeNull();
        // an id the server no longer knows as a raid category counts for nothing
        const gone = kader({ attendanceCategories: ["deleted-category", CAT.do] });
        expect(attendanceCategoriesOf(view, gone).map((c) => c.id)).toEqual([CAT.do]);
        expect(attendanceOf(view, gone, players.get(U.tank))?.pct).toBe(70);
        // only the PUG category: Liss 4/4
        expect(attendanceOf(view, kader({ attendanceCategories: [CAT.pug] }), players.get(U.mage))?.pct).toBe(100);
    });

    it("switches a category of the pick on and off, in the server's order", () => {
        expect(togglePick(view, [CAT.do], CAT.mo)).toEqual([CAT.mo, CAT.do]);
        expect(togglePick(view, [CAT.mo, CAT.do], CAT.mo)).toEqual([CAT.do]);
        expect(togglePick(view, ["deleted-category"], CAT.pug)).toEqual([CAT.pug]);
        expect(togglePick(view, undefined, CAT.pug)).toEqual([CAT.pug]);
    });

    it("names a category with its game version only while the categories play different ones", () => {
        expect(versionsDiffer(view)).toBe(false);
        expect(categoryLabel(view, RAID_CATEGORIES[0])).toBe("Mo Raid");
        const mixed = kaderView({ raidCategories: [...RAID_CATEGORIES, { id: "c-fv", name: "Forever Raid", versionId: "forever", versionLabel: "Forever", nights: 0 }] });
        expect(versionsDiffer(mixed)).toBe(true);
        expect(categoryLabel(mixed, RAID_CATEGORIES[0])).toBe("Mo Raid · TBC");
    });

    it("lists the Discord roles a player holds that the server knows", () => {
        expect(rolesOf(view, players.get(U.tank)).map((r) => r.name)).toEqual(["Raider"]);
        expect(rolesOf(view, players.get(U.sham))).toEqual([]);
        expect(rolesOf(view, undefined)).toEqual([]);
    });

    it("searches names, characters and wishes", () => {
        const k = kader();
        expect(searchText(view, U.tank, k.players[U.tank])).toContain("aldric sturmwind");
        expect(searchText(view, U.heal, k.players[U.heal])).toContain("verstärkung");
    });

    it("counts roles of picks and leaves unknown specs out", () => {
        expect(roleCounts(view.classes, [{ className: "Warrior", spec: "Warrior-Protection" }, { className: "Mage", spec: "Mage-Frost" }, null, { className: "X", spec: "X-Y" }]))
            .toEqual({ tank: 1, healer: 0, melee: 0, ranged: 1 });
    });

    it("formats times and days", () => {
        expect(dayOf("")).toBe("");
        expect(dayOf("2026-10-02T18:00:00.000Z")).toBe("02.10.");
        expect(stampOf("2026-10-02T18:14:00.000Z")).toBe("02.10. 20:14");
        expect(daysSince("2026-09-20T12:00:00.000Z", Date.parse("2026-09-30T13:00:00.000Z"))).toBe(10);
        expect(daysSince("")).toBeNull();
    });

    it("tells the history in words", () => {
        expect(historyText(view, { at: "", by: ME, type: "state", from: "selected", to: "provisional" })).toBe("Vorauswahl → Vorläufig");
        expect(historyText(view, { at: "", by: ME, type: "decision", className: "Mage", spec: "Mage-Frost" })).toBe("Entscheidung: Magier · Frost");
        expect(historyText(view, { at: "", by: ME, type: "vote", vote: "yes" })).toBe("Stimme: dafür");
        expect(historyText(view, { at: "", by: ME, type: "vote", vote: "none" })).toBe(t("kader.history.voteNone"));
        expect(historyText(view, { at: "", by: "", type: "migrated", to: "roster" })).toContain("Roster");
        expect(historyText(view, { at: "", by: ME, type: "something-new" })).toBe("something-new");
    });
});
