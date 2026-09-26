// The data directory guard of test/setup/environment.js (#433): no suite may
// write into the checkout's data/ - sessions, settings and stores go to a
// scratch directory of the suite's own.
const os = require("os");
const path = require("path");

const REPO_DATA = path.join(__dirname, "..", "..", "data");

describe("test data directory", () => {
    it("points EVENTHELPER_DATA_DIR at a scratch directory, not the checkout's data/", () => {
        const dir = process.env.EVENTHELPER_DATA_DIR;
        expect(dir).toEqual(expect.stringContaining("eh-test-data-"));
        expect(path.resolve(dir).startsWith(path.resolve(os.tmpdir()))).toBe(true);
    });

    it("sends every store path of src/config/paths.js there", () => {
        const paths = require("../../src/config/paths");
        expect(paths.DATA_DIR).toBe(path.resolve(process.env.EVENTHELPER_DATA_DIR));
        expect(paths.dataPath("sessions.json").startsWith(path.resolve(REPO_DATA))).toBe(false);
        expect(paths.SETTINGS_DIR).toBe(path.join(paths.DATA_DIR, "settings"));
    });
});
