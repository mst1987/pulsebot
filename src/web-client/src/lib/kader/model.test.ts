import { describe, expect, it } from "vitest";
import { t } from "../../i18n";
import { kader, kaderView, U, ME } from "../../pages/kader/kader.fixture";
import {
    attText, attendanceOf, byId, canMove, className, countStates, dayOf, daysSince, entriesIn, historyText, mainPick, nameOf,
    playerName, roleCounts, searchText, specName, specRole, stampOf, wishLabel, wishOptions, MOVES, STATES,
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

    it("takes the attendance of the planner's version, else the main version's with its label", () => {
        expect(attendanceOf(view, players.get(U.tank))).toEqual({ pct: 90, version: "" });
        expect(attendanceOf(view, players.get(U.mage))).toEqual({ pct: 80, version: "TBC" });
        expect(attendanceOf(view, players.get(U.hand))).toBeNull();
        expect(attText(null)).toBe("—");
        expect(attText({ pct: 75 })).toBe("75 %");
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
