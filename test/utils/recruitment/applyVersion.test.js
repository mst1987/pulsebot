// The game version of an application (#553): carried by the apply button and
// the embed's "Version" field; anything unknown or missing is TBC.
const av = require("../../../src/utils/recruitment/applyVersion");

describe("utils/recruitment/applyVersion", () => {
    it("builds the button id with a known version, the bare one without", () => {
        expect(av.applyButtonId("classic")).toBe("apply:classic");
        expect(av.applyButtonId("wotlk")).toBe("apply");
        expect(av.applyButtonId()).toBe("apply");
    });

    it("recognises the apply button and reads its version", () => {
        expect(av.isApplyButtonId("apply")).toBe(true);
        expect(av.isApplyButtonId("apply:forever")).toBe(true);
        expect(av.isApplyButtonId("apply-class")).toBe(false);
        expect(av.isApplyButtonId(undefined)).toBe(false);
        expect(av.versionOfApplyButton("apply:classic")).toBe("classic");
        expect(av.versionOfApplyButton("apply")).toBe("tbc");
        expect(av.versionOfApplyButton("apply:wotlk")).toBe("tbc");
        expect(av.versionOfApplyButton("apply-class")).toBe("tbc");
    });

    it("writes the label into the embed and reads label, short or id back", () => {
        expect(av.VERSION_FIELD).toBe("Version");
        expect(av.versionFieldValue("classic")).toBe("Classic Era");
        expect(av.versionFieldValue("nope")).toBe("TBC Anniversary");
        expect(av.versionOfFieldValue("Classic Era")).toBe("classic");
        expect(av.versionOfFieldValue(" forever ")).toBe("forever");
        expect(av.versionOfFieldValue("TBC")).toBe("tbc");
        expect(av.versionOfFieldValue("")).toBe("tbc");
        expect(av.versionOfFieldValue("Wotlk")).toBe("tbc");
    });
});
