// services/addons/addonConfig.js: the default addons, the normaliser of the
// stored/submitted list and the file patterns.
const {
    DEFAULT_ADDONS, MAX_ADDONS, defaultAddons, normalizeAddon, normalizeAddonList, normalizeGithub,
    normalizeIcon, normalizeRepo, normalizePatterns, normalizeVersions, slugify, assetMatches,
} = require("../../../src/services/addons/addonConfig");

describe("the default addons", () => {
    it("are the three own addons, the two private ones for Forever", () => {
        expect(DEFAULT_ADDONS.map((a) => [a.id, a.repo, a.private, a.versions])).toEqual([
            ["levelhelper", "mst1987/levelhelper", true, ["forever"]],
            ["professionkit", "mst1987/professionkit", true, ["forever"]],
            ["eventhelper-sync", "mst1987/eventhelper-addon", false, ["tbc", "forever"]],
        ]);
        expect(DEFAULT_ADDONS.find((a) => a.id === "eventhelper-sync").assets).toEqual(["EventHelperSync.exe", "EventHelperSync-*.zip"]);
    });

    it("survive their own normaliser unchanged", () => {
        expect(normalizeAddonList(defaultAddons())).toEqual(defaultAddons());
    });

    it("hand out a fresh copy every time", () => {
        const a = defaultAddons();
        a[0].versions.push("tbc");
        expect(defaultAddons()[0].versions).toEqual(["forever"]);
    });
});

describe("normalizeAddon", () => {
    it("takes a github url as the repo and an id from the name", () => {
        expect(normalizeAddon({ name: "Mein Addon!", repo: "https://github.com/me/my-addon.git/" })).toMatchObject({
            id: "mein-addon", name: "Mein Addon!", repo: "me/my-addon", private: false, enabled: true, icon: "inv_misc_questionmark",
        });
    });

    it("refuses an entry without a name or a usable repo", () => {
        expect(normalizeAddon({ name: "", repo: "a/b" })).toBeNull();
        expect(normalizeAddon({ name: "x", repo: "../../etc" })).toBeNull();
        expect(normalizeAddon({ name: "x", repo: "a/b/c" })).toBeNull();
        expect(normalizeAddon(null)).toBeNull();
        expect(normalizeAddon([])).toBeNull();
    });

    it("keeps known versions only, in the rule sets' order", () => {
        expect(normalizeVersions(["forever", "wotlk", "tbc"])).toEqual(["tbc", "forever"]);
        expect(normalizeVersions("tbc")).toEqual([]);
    });

    it("reduces a zamimg url to the icon name and refuses anything else", () => {
        expect(normalizeIcon("https://wow.zamimg.com/images/wow/icons/large/inv_gizmo_01.jpg")).toBe("inv_gizmo_01");
        expect(normalizeIcon("INV_Misc_Map02")).toBe("inv_misc_map02");
        expect(normalizeIcon("javascript:alert(1)")).toBe("inv_misc_questionmark");
        expect(normalizeIcon("https://evil.example/x.jpg")).toBe("inv_misc_questionmark");
    });

    it("keeps file patterns of file-name characters only", () => {
        expect(normalizePatterns("A-*.zip, ../x, B?.exe, A-*.zip")).toEqual(["A-*.zip", "B?.exe"]);
        expect(normalizePatterns(["a", "b", "c", "d", "e", "f", "g"])).toHaveLength(6);
    });

    it("cuts long texts", () => {
        const a = normalizeAddon({ name: "n".repeat(100), repo: "a/b", description: "d".repeat(400), install: "i".repeat(700) });
        expect([a.name.length, a.description.length, a.install.length]).toEqual([60, 300, 600]);
    });

    it("checks the repo on its own", () => {
        expect(normalizeRepo(" mst1987/levelhelper ")).toBe("mst1987/levelhelper");
        expect(normalizeRepo("http://www.github.com/a/b")).toBe("a/b");
        expect(normalizeRepo("nope")).toBe("");
    });

    it("slugifies names", () => {
        expect(slugify("Über Addon 2")).toBe("uber-addon-2");
        expect(slugify("!!!")).toBe("");
    });
});

describe("normalizeAddonList", () => {
    it("drops unusable entries and a second entry with the same id", () => {
        const list = normalizeAddonList([
            { id: "a", name: "A", repo: "x/a" },
            { name: "", repo: "x/b" },
            { id: "a", name: "A2", repo: "x/a2" },
            { name: "B", repo: "x/b" },
        ]);
        expect(list.map((a) => [a.id, a.name])).toEqual([["a", "A"], ["b", "B"]]);
    });

    it("keeps an emptied list empty, and something that is no list becomes the defaults", () => {
        expect(normalizeAddonList([])).toEqual([]);
        expect(normalizeAddonList(undefined)).toEqual(defaultAddons());
    });

    it("keeps at most MAX_ADDONS", () => {
        const many = Array.from({ length: MAX_ADDONS + 5 }, (_, i) => ({ name: `A${i}`, repo: `x/a${i}` }));
        expect(normalizeAddonList(many)).toHaveLength(MAX_ADDONS);
    });
});

describe("normalizeGithub", () => {
    it("keeps the token as a trimmed string and nothing else", () => {
        expect(normalizeGithub({ token: " t ", extra: 1 })).toEqual({ token: "t" });
        expect(normalizeGithub(null)).toEqual({ token: "" });
    });
});

describe("assetMatches", () => {
    const addon = { assets: ["LevelHelper-*.zip", "Tool?.exe"] };

    it("matches whole file names with * and ?, ignoring case", () => {
        expect(assetMatches(addon, "LevelHelper-0.3.0.zip")).toBe(true);
        expect(assetMatches(addon, "levelhelper-1.zip")).toBe(true);
        expect(assetMatches(addon, "Tool1.exe")).toBe(true);
        expect(assetMatches(addon, "LevelHelper-0.3.0.zip.sig")).toBe(false);
        expect(assetMatches(addon, "Tool12.exe")).toBe(false);
    });

    it("treats the dot as a dot, not as any character", () => {
        expect(assetMatches({ assets: ["a.zip"] }, "abzip")).toBe(false);
    });

    it("offers every file without a pattern", () => {
        expect(assetMatches({ assets: [] }, "anything.bin")).toBe(true);
    });
});

describe("storedAddonList", () => {
    const { storedAddonList } = require("../../../src/services/addons/addonConfig");
    const one = { id: "a", name: "A", repo: "x/a" };

    it("reads a missing list as the defaults", () => {
        expect(storedAddonList({})).toEqual(defaultAddons());
        expect(storedAddonList(null)).toEqual(defaultAddons());
    });

    it("heals an empty list without the edit mark, keeps one an admin emptied", () => {
        expect(storedAddonList({ addonDownloads: [] })).toEqual(defaultAddons());
        expect(storedAddonList({ addonDownloads: [{ name: "", repo: "" }] })).toEqual(defaultAddons());
        expect(storedAddonList({ addonDownloads: [], addonDownloadsCustomized: true })).toEqual([]);
    });

    it("keeps a stored list with entries as it is, single addons removed", () => {
        expect(storedAddonList({ addonDownloads: [one] }).map((a) => a.id)).toEqual(["a"]);
        expect(storedAddonList({ addonDownloads: [one], addonDownloadsCustomized: true }).map((a) => a.id)).toEqual(["a"]);
    });
});
