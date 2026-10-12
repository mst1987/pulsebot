const { cleanIcon, iconOptions, resolveIcon, applyIcon, nextIcon, ICON_NONE } = require("../../../src/services/events/eventIcon");

const CATEGORY = ["🔥・mi-16-09-ssc-tk", "🔥・mi-09-09-ssc-tk", "💀・do-10-09-bt", "plain"];
const icons = (over = {}) => iconOptions({ derivedName: "🔥・mi-23-09-ssc-tk", raidLabel: "SSC + TK", instanceIds: ["ssc", "tk"], categoryNames: CATEGORY, ...over });

describe("services/events/eventIcon", () => {
    it("reads a code only in its known shapes", () => {
        for (const ok of ["", "x", "r0", "c11"]) expect(cleanIcon(ok)).toBe(ok);
        for (const bad of ["w", "r", "r123", "c-1", "x1", "<b>", undefined, null]) expect(cleanIcon(bad)).toBe("");
    });

    it("builds Wie zuletzt, Passt zu, In dieser Kategorie, Kein Icon without a repeated emoji", () => {
        const { options, separator } = icons();
        expect(separator).toBe("・");
        expect(options[0]).toEqual({ code: "", label: "Wie zuletzt", emoji: "🔥" });
        expect(options[options.length - 1]).toEqual({ code: ICON_NONE, label: "Kein Icon", emoji: "" });
        const emojis = options.map((o) => o.emoji).filter(Boolean);
        expect(new Set(emojis).size).toBe(emojis.length);
        expect(options.find((o) => o.code === "c1")).toEqual({ code: "c1", label: "In dieser Kategorie", emoji: "💀" });
        expect(new Set(options.map((o) => o.code)).size).toBe(options.length);
    });

    it("stays within 25 options and works without raid, template or category channels", () => {
        const many = Array.from({ length: 40 }, (_, i) => `${String.fromCodePoint(0x1F400 + i)}・name-${i}`);
        expect(icons({ categoryNames: many, instanceIds: Object.keys(require("../../../src/config/raidEmojis").RAID_EMOJIS) }).options.length).toBeLessThanOrEqual(25);
        const bare = iconOptions();
        expect(bare.options.map((o) => o.code)).toEqual(["", ICON_NONE]);
        expect(bare.options[0].emoji).toBe("");
        expect(iconOptions({ instanceIds: ["ssc"] }).options[1].label).toBe("Passt zum Raid");
    });

    it("applies the pick to a name, normalised, with the category's separator", () => {
        const set = icons();
        expect(applyIcon("🔥・mi-23-09-ssc-tk", "", set)).toBe("🔥・mi-23-09-ssc-tk");
        expect(applyIcon("🔥・mi-23-09-ssc-tk", "r0", set)).toBe("🐍・mi-23-09-ssc-tk");
        expect(applyIcon("🔥・mi-23-09-ssc-tk", "x", set)).toBe("mi-23-09-ssc-tk");
        expect(applyIcon("mi-23-09-ssc-tk", "r0", set)).toBe("🐍・mi-23-09-ssc-tk");
        // an unknown code is "Wie zuletzt"
        expect(applyIcon("🔥・mi-23", "r99", set)).toBe("🔥・mi-23");
        expect(applyIcon("mi-23", "x", set)).toBe("mi-23");
        const bars = iconOptions({ categoryNames: ["💀│a", "🐍│b"], instanceIds: ["ssc"] });
        expect(applyIcon("mi-23", "c0", bars)).toBe("💀│mi-23");
    });

    it("resolves and cycles through the options, wrapping around", () => {
        const { options } = icons();
        expect(resolveIcon(options, "nope")).toBe(options[0]);
        expect(nextIcon(options, "")).toBe(options[1].code);
        expect(nextIcon(options, ICON_NONE)).toBe("");
        expect(nextIcon(options, "nope")).toBe(options[1].code);
    });
});
