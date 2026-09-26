// Where the bot keeps its data (#419): <repo>/data unless EVENTHELPER_DATA_DIR
// says otherwise.
const path = require("path");

const REPO = path.join(__dirname, "..", "..");

describe("config/paths", () => {
    const saved = process.env.EVENTHELPER_DATA_DIR;
    afterEach(() => {
        if (saved === undefined) delete process.env.EVENTHELPER_DATA_DIR;
        else process.env.EVENTHELPER_DATA_DIR = saved;
        jest.resetModules();
    });

    describe("resolveDataDir", () => {
        const { resolveDataDir } = require("../../src/config/paths");

        it("is <repo>/data without an override", () => {
            expect(resolveDataDir({})).toBe(path.join(REPO, "data"));
            expect(resolveDataDir({ EVENTHELPER_DATA_DIR: "   " })).toBe(path.join(REPO, "data"));
            expect(resolveDataDir(null)).toBe(path.join(REPO, "data"));
        });

        it("takes an absolute override as it is", () => {
            const abs = path.resolve(path.sep, "srv", "eventhelper", "data");
            expect(resolveDataDir({ EVENTHELPER_DATA_DIR: abs })).toBe(abs);
        });

        it("reads a relative override from the repository root, not the working directory", () => {
            expect(resolveDataDir({ EVENTHELPER_DATA_DIR: " data-dev " })).toBe(path.join(REPO, "data-dev"));
        });
    });

    it("builds every path below DATA_DIR", () => {
        delete process.env.EVENTHELPER_DATA_DIR;
        const paths = require("../../src/config/paths");
        expect(paths.DATA_DIR).toBe(path.join(REPO, "data"));
        expect(paths.SETTINGS_DIR).toBe(path.join(REPO, "data", "settings"));
        expect(paths.dataPath("sim", "results.json")).toBe(path.join(REPO, "data", "sim", "results.json"));
        expect(paths.dataPath()).toBe(paths.DATA_DIR);
        expect(paths.settingsPath("events.json")).toBe(path.join(REPO, "data", "settings", "events.json"));
    });

    it("moves every store with EVENTHELPER_DATA_DIR", () => {
        const dir = path.resolve(path.sep, "tmp", "eh-data");
        process.env.EVENTHELPER_DATA_DIR = dir;
        jest.resetModules();
        const paths = require("../../src/config/paths");
        expect(paths.DATA_DIR).toBe(dir);
        expect(paths.settingsPath("config.json")).toBe(path.join(dir, "settings", "config.json"));
        expect(require("../../src/web/eventStore").EVENTS_FILE).toBe(path.join(dir, "settings", "events.json"));
        expect(require("../../src/web/reportStore").REPORTS_DIR).toBe(path.join(dir, "reports"));
    });
});
