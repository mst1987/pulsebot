import { describe, expect, it } from "vitest";
import { entry, QUESTIONS } from "../../pages/kader/kader.fixture";
import {
    answerLabels, canComplete, dayShort, draftOf, isAnswered, isWeekdays, moveWish, patchOf, placeWish, progress, statusOf, toggleAnswer,
} from "./interview";

const [days, voice, remark] = QUESTIONS;
const mage = { className: "Mage", spec: "Mage-Frost" };
const fire = { className: "Mage", spec: "Mage-Fire" };
const tank = { className: "Warrior", spec: "Warrior-Protection" };

describe("lib/kader/interview", () => {
    it("knows an answer from none, per kind of question", () => {
        expect(isAnswered(days, ["d1"])).toBe(true);
        expect(isAnswered(days, [])).toBe(false);
        expect(isAnswered(voice, "o1")).toBe(true);
        expect(isAnswered(remark, "  ")).toBe(false);
        expect(isAnswered(remark, undefined)).toBe(false);
    });

    it("counts the wishes plus every required question", () => {
        const open = entry({ wishes: [] });
        expect(progress(open, QUESTIONS)).toMatchObject({ done: 0, total: 2 });
        const half = entry({ wishes: [mage] });
        expect(progress(half, QUESTIONS).missing.map((q) => q.id)).toEqual(["q1"]);
        expect(canComplete(half, QUESTIONS)).toBe(false);
        const full = entry({ wishes: [mage], interview: { ...half.interview, answers: { q1: ["d3"] } } });
        expect(progress(full, QUESTIONS)).toMatchObject({ done: 2, total: 2 });
        expect(canComplete(full, QUESTIONS)).toBe(true);
    });

    it("tells open, started and held apart", () => {
        const e = entry();
        expect(statusOf(e)).toBe("open");
        expect(statusOf({ ...e, interview: { ...e.interview, startedAt: "x" } })).toBe("started");
        expect(statusOf({ ...e, interview: { ...e.interview, startedAt: "x", completedAt: "y" } })).toBe("done");
    });

    it("reads answers as labels in option order", () => {
        expect(answerLabels(days, ["d4", "d3"])).toEqual(["Mittwoch", "Donnerstag"]);
        expect(answerLabels(voice, "o2")).toEqual(["Meistens"]);
        expect(answerLabels(remark, "Twink auf TBC")).toEqual(["Twink auf TBC"]);
        expect(answerLabels(voice, undefined)).toEqual([]);
    });

    it("recognises the seven weekdays in German and English", () => {
        expect(isWeekdays(days)).toBe(true);
        expect(isWeekdays({ ...days, options: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, i) => ({ id: String(i), label })) })).toBe(true);
        expect(isWeekdays(voice)).toBe(false);
        expect(isWeekdays({ ...days, type: "text" })).toBe(false);
        expect(dayShort("Mittwoch")).toBe("Mi");
        expect(dayShort("Mo")).toBe("Mo");
    });

    it("switches an option: one answer on and off, several in option order", () => {
        expect(toggleAnswer(voice, undefined, "o2")).toBe("o2");
        expect(toggleAnswer(voice, "o2", "o2")).toBe("");
        expect(toggleAnswer(voice, "o2", "o3")).toBe("o3");
        expect(toggleAnswer(days, ["d4"], "d1")).toEqual(["d1", "d4"]);
        expect(toggleAnswer(days, ["d1", "d4"], "d1")).toEqual(["d4"]);
    });

    it("saves only what changed", () => {
        const stored = entry({ wishes: [mage], interview: { ...entry().interview, answers: { q2: "o1", q3: "Twink" }, note: "alt", lead: "u1" } });
        const draft = draftOf(stored);
        expect(patchOf(draft, stored)).toBeNull();
        // the same text with spaces around is no change; an emptied answer goes as ""
        expect(patchOf({ ...draft, answers: { ...draft.answers, q3: " Twink " } }, stored)).toBeNull();
        expect(patchOf({ ...draft, answers: { ...draft.answers, q2: "" } }, stored)).toEqual({ answers: { q2: "" } });
        expect(patchOf({ ...draft, wishes: [fire, mage], note: "neu", lead: "" }, stored)).toEqual({ wishes: [fire, mage], note: "neu", lead: "" });
        expect(patchOf({ ...draft, answers: { ...draft.answers, q1: ["d1"] } }, stored)).toEqual({ answers: { q1: ["d1"] } });
    });

    it("moves wishes by arrow and by drag", () => {
        expect(moveWish([mage, fire, tank], 0, 1)).toEqual([fire, mage, tank]);
        expect(moveWish([mage, fire], 0, -1)).toEqual([mage, fire]);
        expect(placeWish([mage, fire, tank], 2, 0)).toEqual([tank, mage, fire]);
        expect(placeWish([mage, fire], 1, 1)).toEqual([mage, fire]);
    });
});
