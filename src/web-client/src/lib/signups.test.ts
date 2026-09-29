// The counter of the signups page (#520): the single Discord accounts alone,
// "28 angemeldet" / "28 signed up" — no "/size", word for word like the Discord
// message (src/utils/signup/capacity.js signedUpText).
import { describe, expect, it } from "vitest";
import { classesForRows, fillTone, signedUpLabel } from "./signups";
import { requireBackend } from "../test/backend";
import { inLang } from "../test/i18n";

describe("classesForRows (#541)", () => {
    const cls = (id: string) => [{ id, label: id, color: "", icon: "" }];
    const data = { classes: cls("main"), classesByVersion: { tbc: cls("tbc"), forever: cls("forever") } };

    it("takes the list of the rows' version when they share one", () => {
        expect(classesForRows(data, [{ versionId: "forever" }])).toEqual(cls("forever"));
        expect(classesForRows(data, [{ versionId: "tbc" }, { versionId: "tbc" }])).toEqual(cls("tbc"));
    });

    it("falls back to the main version's list for mixed, unknown or missing versions", () => {
        expect(classesForRows(data, [{ versionId: "tbc" }, { versionId: "forever" }])).toEqual(cls("main"));
        expect(classesForRows(data, [{ versionId: "classic" }])).toEqual(cls("main"));
        expect(classesForRows(data, [])).toEqual(cls("main"));
        expect(classesForRows({ classes: cls("main") }, [{ versionId: "tbc" }])).toEqual(cls("main"));
    });
});

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
