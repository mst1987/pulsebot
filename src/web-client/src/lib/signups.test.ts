// The fill label of the signups page (#516): overbooked raids read "25/25 (+3)",
// word for word like the Discord message (src/utils/signup/capacity.js).
import { describe, expect, it } from "vitest";
import { fillTone, seatLabel } from "./signups";
import { requireBackend } from "../test/backend";

describe("seatLabel (#516)", () => {
    it("writes the fill, an overbooking as (+n), and matches the server", () => {
        const { seatsText } = requireBackend("utils/signup/capacity");
        const cases: [number, number, string][] = [[22, 25, "22/25"], [25, 25, "25/25"], [28, 25, "25/25 (+3)"], [12, 0, "12"]];
        for (const [attending, size, text] of cases) {
            expect(seatLabel(attending, size)).toBe(text);
            expect(seatsText(attending, size)).toBe(text);
        }
    });

    it("keeps the full tone for an overbooked raid", () => {
        expect(fillTone(28, 25)).toBe("ok");
    });
});
