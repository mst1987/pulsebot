// Which section the plan, the template editor and the sheet open on (lib/raidplan.ts startSection), the section remembered per plan,
// and the switch that plans a boss / trash section without its map (components wiring in BoardWorkspace / PlanPublicPage).
const fs = require("fs");
const path = require("path");
const { loadTs } = require("./i18nHelper");

const lib = loadTs("lib/raidplan.ts", { t: (k) => k });
const dir = path.join(__dirname, "../../src/web-client/src");
const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");

const SECTIONS = [
    { key: "general", general: true },
    { key: "defaults" },
    { key: "bt/najentus" },
    { key: "bt/supremus" },
    { key: "bt/trash" },
];

describe("the section a plan opens on", () => {
    it("opens on \"Allgemein\" the first time", () => {
        expect(lib.startSection(SECTIONS, "", "", [])).toBe("general");
    });

    it("a deep link wins, then the section last open, unknown keys are ignored", () => {
        expect(lib.startSection(SECTIONS, "bt/supremus", "bt/trash", [])).toBe("bt/supremus");
        expect(lib.startSection(SECTIONS, "", "bt/trash", [])).toBe("bt/trash");
        expect(lib.startSection(SECTIONS, "bt/gone", "bt/also-gone", [])).toBe("general");
    });

    it("without \"Allgemein\" (the sheet leaves it out when empty) it takes the first shown section", () => {
        const noGeneral = SECTIONS.slice(2);
        expect(lib.startSection(noGeneral, "", "", [])).toBe("bt/najentus");
        expect(lib.startSection(noGeneral, "", "", ["bt/najentus"])).toBe("bt/supremus");
        expect(lib.startSection([], "", "", [])).toBe("");
    });
});

describe("the section remembered per plan", () => {
    afterEach(() => { delete global.window; });

    it("stores and reads it per plan id", () => {
        const store = {};
        global.window = { localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } } };
        lib.rememberSection("eh_1", "bt/supremus");
        expect(store["eh.raidplan.section.eh_1"]).toBe("bt/supremus");
        expect(lib.rememberedSection("eh_1")).toBe("bt/supremus");
        expect(lib.rememberedSection("eh_2")).toBe("");
    });

    it("answers \"\" and does not throw when the storage is blocked", () => {
        global.window = { localStorage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } } };
        expect(lib.rememberedSection("eh_1")).toBe("");
        expect(() => lib.rememberSection("eh_1", "general")).not.toThrow();
    });
});

describe("a section planned without its map", () => {
    it("an old board shows its map, only an explicit false hides it", () => {
        expect(lib.boardOf({}, "bt/supremus").showMap).toBe(true);
        expect(lib.boardOf({ "bt/supremus": { notes: "x" } }, "bt/supremus").showMap).toBe(true);
        expect(lib.boardOf({ "bt/supremus": { showMap: false } }, "bt/supremus").showMap).toBe(false);
    });

    it("the editor drops the map tools and says the objects stay; the sheet drops the image", () => {
        const ws = read("pages/raid-detail/raidplan/BoardWorkspace.tsx");
        expect(ws).toContain("board.showMap === false");
        expect(ws).toContain("raidBoard.map.offNote");
        expect(ws).toContain("raidBoard.map.hiddenKept");
        const sheet = read("pages/PlanPublicPage.tsx");
        expect(sheet).toContain("boss.showMap !== false && (");
        expect(sheet).toContain("\" no-map\"");
    });
});
