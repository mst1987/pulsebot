// The counter of the signups page (#520): the single Discord accounts alone,
// "28 angemeldet" / "28 signed up" — no "/size", word for word like the Discord
// message (src/utils/signup/capacity.js signedUpText).
import { describe, expect, it } from "vitest";
import { fillTone, signedUpLabel } from "./signups";
import { requireBackend } from "../test/backend";
import { inLang } from "../test/i18n";

describe("signedUpLabel (#520)", () => {
    it("writes the accounts alone, in both languages, and matches the server's English", async () => {
        expect(signedUpLabel(28)).toBe("28 angemeldet");
        expect(signedUpLabel(0)).toBe("0 angemeldet");
        const { signedUpText } = requireBackend("utils/signup/capacity");
        await inLang("en", () => {
            for (const n of [0, 12, 28]) {
                expect(signedUpLabel(n)).toBe(`${n} signed up`);
                expect(signedUpText(n)).toBe(signedUpLabel(n));
            }
        });
    });

    it("never shows a slash", () => {
        expect(signedUpLabel(28)).not.toMatch(/\//);
    });

    it("keeps the full tone for an overbooked raid", () => {
        expect(fillTone(28, 25)).toBe("ok");
    });
});
