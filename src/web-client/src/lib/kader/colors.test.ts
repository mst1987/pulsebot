import { describe, expect, it } from "vitest";
import type { KaderQuestion } from "../../api";
import { QUESTIONS } from "../../pages/kader/kader.fixture";
import { DAY_KEYS, OPTION_COLORS, isOptionColor, optionColors, toneAttrs, toneOf } from "./colors";

describe("lib/kader/colors", () => {
    const [days, voice, note] = QUESTIONS;

    it("has a small palette of named colours", () => {
        expect(OPTION_COLORS).toEqual(["blue", "amber", "rose", "teal", "violet", "lime", "orange", "slate"]);
        expect(isOptionColor("teal")).toBe(true);
        expect(isOptionColor("#ff0000")).toBe(false);
        expect(isOptionColor(undefined)).toBe(false);
    });

    it("hands out the palette by position, keeping an option's own colour and skipping the ones taken", () => {
        expect(optionColors([{}, {}, {}])).toEqual(["blue", "amber", "rose"]);
        // "Selten" keeps slate; the others take the first free colours
        expect(optionColors(voice.options)).toEqual(["blue", "amber", "slate"]);
        // an own colour is never handed out twice automatically
        expect(optionColors([{}, { color: "blue" }, {}])).toEqual(["amber", "blue", "rose"]);
        // an unknown stored colour counts as none
        expect(optionColors([{ color: "pink" }])).toEqual(["blue"]);
        // more options than colours: by position once the palette is used up
        const many = optionColors(Array.from({ length: 10 }, () => ({})));
        expect(many.slice(0, 8)).toEqual([...OPTION_COLORS]);
        expect(many.slice(8)).toEqual(["blue", "amber"]);
    });

    it("colours weekdays with the day colours, choices with the palette, free text not at all", () => {
        expect(days.options.map((o) => toneOf(days, o.id))).toEqual(DAY_KEYS.map((day) => ({ day })));
        expect(toneOf(voice, "o2")).toEqual({ opt: "amber" });
        expect(toneOf(voice, "o3")).toEqual({ opt: "slate" });
        expect(toneOf(voice, "gone")).toBeNull();
        expect(toneOf(note, "x")).toBeNull();
        // seven options that are not the weekdays are an ordinary choice
        const seven: KaderQuestion = { ...days, options: days.options.map((o, i) => ({ ...o, label: `Wahl ${i}` })) };
        expect(toneOf(seven, seven.options[0].id)).toEqual({ opt: "blue" });
    });

    it("sets the data attribute the stylesheet colours by", () => {
        expect(toneAttrs({ day: "mi" })).toEqual({ "data-day": "mi" });
        expect(toneAttrs({ opt: "rose" })).toEqual({ "data-opt": "rose" });
        expect(toneAttrs(null)).toEqual({});
    });
});
