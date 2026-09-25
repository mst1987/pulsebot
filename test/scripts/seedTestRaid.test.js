// scripts/seed-test-raid.js writes a whole test raid into the local stores - but only when it is started as a script. A `require`
// (a test, a syntax check) must run nothing and write nothing: once a require by mistake created an event and rebuilt "BT Demo".
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../../scripts/seed-test-raid.js");

describe("seed-test-raid", () => {
    afterEach(() => jest.restoreAllMocks());

    it("does nothing when it is required: no file written, nothing printed, no exit", () => {
        const write = jest.spyOn(fs, "writeFileSync");
        const rename = jest.spyOn(fs, "renameSync");
        const log = jest.spyOn(console, "log").mockImplementation(() => {});
        const err = jest.spyOn(console, "error").mockImplementation(() => {});
        const exit = jest.spyOn(process, "exit").mockImplementation(() => {});
        const mod = require(FILE);
        expect(write).not.toHaveBeenCalled();
        expect(rename).not.toHaveBeenCalled();
        expect(log).not.toHaveBeenCalled();
        expect(err).not.toHaveBeenCalled();
        expect(exit).not.toHaveBeenCalled();
        expect(typeof mod.main).toBe("function");
        expect(typeof mod.seedPlan).toBe("function");
        expect(mod.ROSTER).toHaveLength(25);
        expect(mod.TEMPLATE_NAME).toBe("BT Demo");
    });

    it("starts only as a script (require.main === module), never by a bare call", () => {
        const src = fs.readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
        expect(src).toContain("if (require.main === module) main();");
        expect(src).not.toMatch(/^main\(\);$/m);
    });
});
