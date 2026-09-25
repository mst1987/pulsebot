// scripts/seed-test-raid.js writes a whole test raid into the local stores - but only when it is started as a script. A `require`
// (a test, a syntax check) must run nothing and write nothing: once a require by mistake created an event and rebuilt "BT Demo".
//
// Deterministic in any environment (CI: no .env.dev, no data/, a cold Jest cache): the module is loaded once BEFORE the spies (Jest
// transforms it then and may write its own cache files with fs), and loaded again in a fresh module registry with the spies on - that
// second load runs the script's top level exactly like a `require` does, without Jest's cache writes. Only writes of the project count
// (data/, the stores), never Jest's.
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../../scripts/seed-test-raid.js");
const ROOT = path.join(__dirname, "../..");

/** A write the script could have caused: a path inside the project (not node_modules, not a cache). */
const ownWrite = (target) => {
    const p = path.resolve(String(target || ""));
    return p.startsWith(ROOT) && !p.includes(`${path.sep}node_modules${path.sep}`) && !p.includes(`${path.sep}.cache${path.sep}`);
};

describe("seed-test-raid", () => {
    afterEach(() => jest.restoreAllMocks());

    it("does nothing when it is required: no file of the project written, nothing printed, no exit", () => {
        // warm-up: Jest's transform (and its cache writes) happens here, not under the spies
        jest.isolateModules(() => { require(FILE); });
        const write = jest.spyOn(fs, "writeFileSync");
        const rename = jest.spyOn(fs, "renameSync");
        const mkdir = jest.spyOn(fs, "mkdirSync");
        const log = jest.spyOn(console, "log").mockImplementation(() => {});
        const err = jest.spyOn(console, "error").mockImplementation(() => {});
        const exit = jest.spyOn(process, "exit").mockImplementation(() => {});
        let mod = null;
        jest.isolateModules(() => { mod = require(FILE); });
        expect(write.mock.calls.filter((c) => ownWrite(c[0]))).toEqual([]);
        expect(rename.mock.calls.filter((c) => ownWrite(c[1]))).toEqual([]);
        expect(mkdir.mock.calls.filter((c) => ownWrite(c[0]))).toEqual([]);
        expect(log).not.toHaveBeenCalled();
        expect(err).not.toHaveBeenCalled();
        expect(exit).not.toHaveBeenCalled();
        expect(typeof mod.main).toBe("function");
        expect(typeof mod.seedPlan).toBe("function");
        expect(mod.ROSTER).toHaveLength(25);
        expect(mod.TEMPLATE_NAME).toBe("BT Demo");
    });

    it("starts only as a script (require.main === module), never by a bare call; its stores are loaded inside main / seedPlan only", () => {
        const src = fs.readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
        expect(src).toContain("if (require.main === module) main();");
        expect(src).not.toMatch(/^main\(\);$/m);
        // at the top level only fs: every store (which could write) is required inside a function
        const top = src.split("\n").filter((l) => /^const .*require\(/.test(l));
        expect(top).toEqual(["const fs = require(\"fs\");"]);
    });
});
