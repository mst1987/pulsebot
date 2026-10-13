// The spec and class icons the drawn setup embeds (utils/image/specIcons.js): read from
// assets/specs/ (checked in), handed out as data URIs.
const fs = require("fs");
const path = require("path");
const { buildClasses } = require("../../../src/config/gameVersions/classes");
const { ICON_DIR, iconDataUri, specIconDataUri } = require("../../../src/utils/image/specIcons");

describe("utils/image/specIcons", () => {
    it("has a checked-in icon for every spec and class of the rule set", () => {
        const icons = buildClasses().flatMap((c) => [c.icon, ...c.specs.map((s) => s.icon)]);
        const missing = icons.filter((icon) => !fs.existsSync(path.join(ICON_DIR, `${icon}.jpg`)));
        expect(missing).toEqual([]);
    });

    it("hands an icon out as a JPEG data URI, the same string every time", () => {
        const uri = iconDataUri("spell_holy_holybolt");
        expect(uri.startsWith("data:image/jpeg;base64,/9j/")).toBe(true);
        expect(iconDataUri("spell_holy_holybolt")).toBe(uri);
    });

    it("answers \"\" for a missing icon and never leaves the folder", () => {
        expect(iconDataUri("inv_does_not_exist")).toBe("");
        expect(iconDataUri("../../package")).toBe("");
        expect(iconDataUri("")).toBe("");
        expect(iconDataUri(null)).toBe("");
    });

    it("takes the spec's icon, else the class's, else none", () => {
        expect(specIconDataUri("Paladin-Holy", "Paladin")).toBe(iconDataUri("spell_holy_holybolt"));
        expect(specIconDataUri("Shaman", "Shaman")).toBe(iconDataUri("classicon_shaman"));
        expect(specIconDataUri("Mage-Nonsense")).toBe(iconDataUri("classicon_mage"));
        expect(specIconDataUri("DK-Blood", "DK")).toBe("");
        expect(specIconDataUri(undefined, undefined)).toBe("");
    });
});
