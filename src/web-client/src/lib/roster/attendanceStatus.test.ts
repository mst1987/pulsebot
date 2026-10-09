import { afterEach, describe, expect, it } from "vitest";
import { switchLang } from "../../test/i18n";
import { EDIT_ORDER, STATUS_ORDER, countsAsPresent, countsForQuota, detailText, overrideLine, statusLabel, statusLetter, statusOf, verdictText } from "./attendanceStatus";
import { attendanceGrid } from "./attendanceGrid";
import { member } from "../../pages/roster/rosters.fixture";

afterEach(() => switchLang("de"));

describe("attendanceStatus (#677)", () => {
    it("knows the statuses, their order in the tooltip and in the menu, and which count", () => {
        expect(STATUS_ORDER).toEqual(["present", "bench", "noSignup", "absence", "vacation", "noShow", "tentative"]);
        // the orga never sets "tentative" by hand: it only says the setup left a "maybe" out
        expect(EDIT_ORDER).toEqual(["present", "bench", "vacation", "absence", "noSignup", "noShow"]);
        expect(STATUS_ORDER.filter(countsAsPresent)).toEqual(["present", "bench"]);
        expect(STATUS_ORDER.filter((s) => !countsForQuota(s))).toEqual(["tentative"]);
    });

    it("takes the server's code, else an older answer's German word, else attended", () => {
        expect(statusOf({ status: "vacation" })).toBe("vacation");
        expect(statusOf({ status: "weird", reason: "abgemeldet" })).toBe("absence");
        expect(statusOf({ reason: "Ersatzbank" })).toBe("bench");
        expect(statusOf({ reason: "angemeldet (später)" })).toBe("present");
        expect(statusOf({ reason: "???", attended: false })).toBe("noShow");
        expect(statusOf({ attended: true })).toBe("present");
    });

    it("words status, letter, detail and verdict in German and English", async () => {
        expect(STATUS_ORDER.map(statusLabel)).toEqual(["Dabei", "Bench", "Nicht angemeldet", "Abgemeldet", "Urlaub", "Nicht erschienen", "Vielleicht"]);
        expect(STATUS_ORDER.map(statusLetter)).toEqual(["D", "B", "?", "A", "U", "X", "V"]);
        expect(verdictText({ status: "tentative", detail: "tentativeNotPlaced" })).toBe("Vielleicht · vorläufig, nicht aufgestellt – zählt nicht");
        expect(detailText("benchSetup")).toBe("im Setup auf der Bank");
        expect(detailText("override")).toBe("");
        expect(detailText(undefined)).toBe("");
        expect(verdictText({ status: "present", detail: "late" })).toBe("Dabei · angemeldet (später)");
        expect(verdictText({ status: "noShow" })).toBe("Nicht erschienen");
        await switchLang("en");
        expect(STATUS_ORDER.map(statusLabel)).toEqual(["Present", "Bench", "Not signed up", "Signed off", "Vacation", "No-show", "Tentative"]);
        expect(verdictText({ status: "absence", detail: "absence" })).toBe("Signed off · signed off for this raid");
    });

    it("names who set a night by hand and when, with the reason", () => {
        const o = { status: "bench" as const, reason: "hat gewartet", by: "1", byName: "Marc", at: Date.UTC(2026, 9, 9, 12) };
        expect(overrideLine(o)).toBe("von Hand: Bench (Marc, 09.10.)");
        expect(overrideLine({ ...o, byName: "", by: "", at: 0 })).toBe("von Hand: Bench");
        expect(verdictText({ status: "bench", override: o })).toBe("von Hand: Bench (Marc, 09.10.) · hat gewartet");
    });
});

describe("attendanceGrid", () => {
    it("puts the oldest night first, the members by roster status then name, null where a night was not counted", () => {
        const a = member("Zora", { status: "core", attendance: { attended: 1, total: 1, pct: 100, missed: [], present: [{ eventId: "n1", title: "K", startTime: 10, status: "bench" }] } });
        const b = member("Abel", { status: "trial", attendance: { attended: 0, total: 1, pct: 0, missed: [{ eventId: "n2", title: "K", startTime: 20, reason: "", status: "noShow" }], present: [] } });
        const c = member("Mia", { status: "core", attendance: null });
        const { columns, rows } = attendanceGrid({ members: [b, a, c], nights: [{ eventId: "n2", title: "K", startTime: 20 }, { eventId: "n1", title: "K", startTime: 10 }] });
        expect(columns.map((x) => x.eventId)).toEqual(["n1", "n2"]);
        expect(rows.map((r) => r.member.displayName)).toEqual(["Mia", "Zora", "Abel"]);
        expect(rows[1].cells.map((x) => x && x.status)).toEqual(["bench", null]);
        expect(rows[2].cells.map((x) => x && x.attended)).toEqual([null, false]);
        expect(rows[0].cells).toEqual([null, null]);
        expect(attendanceGrid({ members: [], nights: undefined })).toEqual({ columns: [], rows: [] });
    });
});
