// The pure rules of editing a roster (#655-#657): refusal codes in words, role
// results, character order and assignment, history lines, buffs, steppers.
import { afterEach, describe, expect, it } from "vitest";
import { switchLang } from "../../test/i18n";
import type { RosterHistoryEntry, RosterRoleResult } from "../../api";
import {
    assignChar, buffState, changedRoleLines, dateInputValue, errorText, failedRoleLines, historyText, moveChar,
    nameOfKey, slotSquares, statusSince, stepValue, syncOpenCount,
} from "./rosterEdit";

const entry = (what: string, detail = "", over: Partial<RosterHistoryEntry> = {}): RosterHistoryEntry =>
    ({ at: "2026-10-02T18:00:00.000Z", by: "1", byName: "Marc", userId: "2", userName: "Devi", what, detail, ...over });
const result = (over: Partial<RosterRoleResult> = {}): RosterRoleResult =>
    ({ roleId: "r1", roleName: "Raider", give: true, ok: true, code: "done", changed: true, ...over });

afterEach(() => switchLang("de"));

describe("errorText", () => {
    it("translates a known code, a role code, and names an unknown one", () => {
        expect(errorText({ code: "single_char_only", message: "x" })).toBe("Dieses Roster erlaubt nur einen Charakter je Person.");
        expect(errorText({ code: "role_too_high", message: "x" })).toMatch(/über der höchsten Rolle des Bots/);
        expect(errorText({ code: "boom", message: "Server sagt" })).toBe("Das hat nicht geklappt (boom).");
        expect(errorText(null)).toBe("Das hat nicht geklappt (?).");
    });

    it("speaks English", async () => {
        await switchLang("en");
        expect(errorText({ code: "not_manager", message: "" })).toBe("Only admins and this roster's managers may do that.");
    });
});

describe("role results", () => {
    it("lists the failed writes with their reason and the changed ones in short", () => {
        const list = [result(), result({ roleName: "", roleId: "999", give: false, ok: false, code: "no_permission", changed: false }), result({ ok: true, changed: false, code: "unchanged" })];
        expect(failedRoleLines(list)).toEqual(["999 konnte nicht genommen werden: Dem Bot fehlt das Recht „Rollen verwalten“."]);
        expect(changedRoleLines(list)).toEqual(["@Raider gegeben"]);
        expect(failedRoleLines(undefined)).toEqual([]);
    });
});

describe("characters", () => {
    it("moves one place up or down, and stays put at an edge", () => {
        expect(moveChar(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
        expect(moveChar(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
        expect(moveChar(["a", "b"], 0, -1)).toEqual(["a", "b"]);
        expect(moveChar(["a", "b"], 1, 1)).toEqual(["a", "b"]);
    });

    it("appends with several characters allowed, else replaces", () => {
        expect(assignChar(["a"], "b", true)).toEqual(["a", "b"]);
        expect(assignChar(["a"], "a", true)).toEqual(["a"]);
        expect(assignChar(["a"], "b", false)).toEqual(["b"]);
        expect(assignChar(["a"], "", false)).toEqual(["a"]);
    });

    it("reads a stored key back as a name", () => {
        expect(nameOfKey("forever~aldric sturmwind")).toBe("Aldric Sturmwind");
        expect(nameOfKey("devi")).toBe("Devi");
    });
});

describe("historyText", () => {
    it("words every code of the store and of the role sync", () => {
        expect(historyText(entry("created", "Raid", { userId: "", userName: "" }))).toBe("Roster angelegt");
        expect(historyText(entry("created", "migration"))).toBe("Roster aus den Raider-Rollen der Kategorie übernommen");
        expect(historyText(entry("settings", "name, slots, roleIds"))).toBe("Einstellungen geändert: Name, Plätze, Discord-Rollen");
        expect(historyText(entry("member-added", "trial, devi, forever~grim bart"))).toBe("Devi aufgenommen als Probe mit Devi, Grim Bart");
        expect(historyText(entry("member-added", "via Discord · core, devi"))).toBe("Devi aufgenommen als Stamm mit Devi (über Discord)");
        expect(historyText(entry("member", "status core → bench; chars a, b; note; trialUntil -"))).toBe("Devi: Status Stamm → Ersatz, Charaktere: A, B, Notiz geändert, Probezeit ohne Enddatum");
        expect(historyText(entry("member", "chars -"))).toBe("Devi: keine Charaktere mehr");
        expect(historyText(entry("member-removed", "via Discord"))).toBe("Devi aus dem Roster genommen (über Discord)");
        expect(historyText(entry("role-given", "@Raider"))).toBe("Rolle @Raider an Devi gegeben");
        expect(historyText(entry("role-take-failed", "@Raider: role_too_high"))).toMatch(/^Rolle @Raider konnte Devi nicht genommen werden: Die Rolle liegt über/);
        expect(historyText(entry("something-new", "x"))).toBe("something-new · x");
    });

    it("leaves the person out in the member's own list", () => {
        expect(historyText(entry("member-added", "core"), false)).toBe("Aufgenommen als Stamm");
        expect(historyText(entry("role-taken", "@Raider"), false)).toBe("Rolle @Raider genommen");
        expect(historyText(entry("member", "status trial → core"), false)).toBe("Status Probe → Stamm");
    });

    it("speaks English", async () => {
        await switchLang("en");
        expect(historyText(entry("member-added", "core, devi"))).toBe("Devi added as Core with Devi");
        expect(historyText(entry("role-give-failed", "@Raider: offline"))).toBe("Role @Raider could not be given to Devi: The bot is not connected to Discord right now.");
    });
});

describe("small rules", () => {
    it("rates buffs by how many bring them", () => {
        const buff = (providers: string[]) => ({ key: "k", label: "", labelEn: "", icon: "", scope: "raid", providers, covered: providers.length > 0 });
        expect(buffState(buff([]))).toBe("missing");
        expect(buffState(buff(["a"]))).toBe("thin");
        expect(buffState(buff(["a", "b"]))).toBe("covered");
    });

    it("counts the people the sync asks to act on", () => {
        expect(syncOpenCount(null)).toBe(0);
        expect(syncOpenCount({ inRosterWithoutRole: [{ userId: "1", displayName: "", status: "core" }], roleWithoutRoster: [], withoutChar: [{ userId: "2", displayName: "", suggestion: null }] })).toBe(2);
    });

    it("keeps a stepper inside its bounds and draws the squares", () => {
        expect(stepValue(0, -1)).toBe(0);
        expect(stepValue(200, 1)).toBe(200);
        expect(stepValue(3, 1)).toBe(4);
        expect(slotSquares(3, 2)).toEqual(["on", "on", "off"]);
        expect(slotSquares(2, 3)).toEqual(["on", "on", "on"]);
        expect(slotSquares(0, 0)).toEqual([]);
    });

    it("gives a date input its day and the drawer its status line", () => {
        expect(dateInputValue("2026-10-23T00:00:00.000Z")).toBe("2026-10-23");
        expect(dateInputValue(null)).toBe("");
        expect(statusSince({ status: "trial", since: "2026-06-02T10:00:00.000Z" })).toBe("Probe seit 2.6.2026");
        expect(statusSince({ status: "core", since: "" })).toBe("Stamm");
    });
});
