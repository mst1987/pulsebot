// No code folder holds more than MAX_FILES modules (#1006). A folder with 60
// files side by side is one nobody overlooks any more; past this size it gets
// sub-folders by topic. Counted are code files (.js/.ts/.tsx/...) without tests
// - a test lives next to its module or in __tests__ and follows its size -
// under src/, test/ and scripts/. Images, translations and other data are not
// code and are not counted.
//
// The folders that were already too full when the guard came stood in ALLOWED
// with the issue that split them; since Epic #1005 the list is empty. An entry
// that is no longer needed fails too, so it stays a list of open issues only.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const MAX_FILES = 25;
const CODE = /\.(c|m)?[jt]sx?$/;
const TEST = /\.test\.(c|m)?[jt]sx?$/;

const ALLOWED = {};

function codeCounts() {
    const counts = {};
    const walk = (dir) => {
        for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
            const rel = `${dir}/${entry.name}`;
            if (entry.isDirectory()) {
                if (entry.name !== "node_modules" && entry.name !== "dist") walk(rel);
            } else if (CODE.test(entry.name) && !TEST.test(entry.name)) {
                counts[dir] = (counts[dir] || 0) + 1;
            }
        }
    };
    ["src", "test", "scripts"].forEach(walk);
    return counts;
}

describe("folder size", () => {
    const counts = codeCounts();

    test(`no code folder holds more than ${MAX_FILES} modules`, () => {
        const tooFull = Object.entries(counts)
            .filter(([dir, n]) => n > MAX_FILES && !ALLOWED[dir])
            .map(([dir, n]) => `${dir}: ${n} Dateien - in Unterordner nach Thema teilen (npm run move)`);
        expect(tooFull).toEqual([]);
    });

    test("every exception is still needed", () => {
        const done = Object.keys(ALLOWED)
            .filter((dir) => (counts[dir] || 0) <= MAX_FILES)
            .map((dir) => `${dir} (${ALLOWED[dir]}) ist aufgeteilt - aus ALLOWED streichen`);
        expect(done).toEqual([]);
    });
});
