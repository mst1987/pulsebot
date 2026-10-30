// classColorProps hands the class colour over as custom properties: --cc for the
// dark theme and, for a known WoW class, --cc-l with its hand-darkened light shade
// (design pilot C, tokens.css --cls-*). An unknown colour keeps the generic mix.
import { describe, expect, it } from "vitest";
import { classColorProps } from "../ClassSpec";

describe("classColorProps", () => {
    it("gives nothing for an unknown class", () => {
        expect(classColorProps()).toEqual({});
        expect(classColorProps("")).toEqual({});
    });

    it("maps a known class colour onto its light token, case-insensitively", () => {
        const props = classColorProps("#ffffff");
        expect(props.className).toBe("class-colored");
        expect(props.style).toEqual({ "--cc": "#ffffff", "--cc-l": "var(--cls-priest)" });
        expect(classColorProps("#FFF569").style).toMatchObject({ "--cc-l": "var(--cls-rogue)" });
    });

    it("leaves --cc-l out for any other colour", () => {
        const props = classColorProps("#123456");
        expect(props.style).toEqual({ "--cc": "#123456" });
    });
});
