// The addon's name for the login notice, from the id in the address.
import { describe, expect, it } from "vitest";
import { addonNameOf } from "./addonName";

describe("addonNameOf", () => {
    it("makes the id readable", () => {
        expect(addonNameOf("levelhelper")).toBe("Levelhelper");
        expect(addonNameOf("eventhelper-sync")).toBe("Eventhelper Sync");
        expect(addonNameOf("macro_helper")).toBe("Macro Helper");
    });

    it("decodes the address part and survives a broken escape", () => {
        expect(addonNameOf("aura%20kit")).toBe("Aura Kit");
        expect(addonNameOf("%E0%A4%A")).toBe("%E0%A4%A");
        expect(addonNameOf("")).toBe("");
    });

    it("stays short", () => {
        expect(addonNameOf("a".repeat(200)).length).toBe(60);
    });
});
