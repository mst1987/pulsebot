// The client's Vitest suites live in a __tests__ folder next to their module
// (#1007): lib/raidplan/assign/assign.ts -> lib/raidplan/assign/__tests__/assign.test.ts, so a
// folder lists its modules and not twice as many files. A test written next to
// the module, the old way, fails here with the place it belongs.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "../../../../src/web-client/src");

function testFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return testFiles(full);
        return /\.test\.tsx?$/.test(entry.name) ? [path.relative(CLIENT, full).split(path.sep).join("/")] : [];
    });
}

test("every client test sits in a __tests__ folder", () => {
    const misplaced = testFiles(CLIENT)
        .filter((file) => path.posix.basename(path.posix.dirname(file)) !== "__tests__")
        .map((file) => `${file} -> ${path.posix.dirname(file)}/__tests__/${path.posix.basename(file)}`);
    expect(misplaced).toEqual([]);
});
