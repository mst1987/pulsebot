// The German bot texts (src/config/botText/de/): every English sentence the code
// passes to tr(lang, "…") has a German entry, no entry is left over, and no
// English sentence has two German ones.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const SRC = path.join(ROOT, "src");
const DIR = path.join(SRC, "config", "botText", "de");

function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return ["node_modules", "web-client"].includes(e.name) ? [] : walk(full);
        return e.name.endsWith(".js") ? [full] : [];
    });
}

/** Every literal of `tr(<lang>, "…")` (double quotes, as the lint rule writes them), unescaped. */
function usedSentences() {
    const out = new Map();
    const pattern = /\btr\(\s*[^,()]+(?:\([^()]*\))?\s*,\s*"((?:[^"\\]|\\.)*)"/g;
    for (const file of walk(SRC)) {
        // comment lines may show tr() as an example — only code counts
        const src = fs.readFileSync(file, "utf8").split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");
        for (const m of src.matchAll(pattern)) {
            const text = JSON.parse(`"${m[1]}"`);
            if (!out.has(text)) out.set(text, path.relative(ROOT, file));
        }
    }
    return out;
}

const AREA_FILES = fs.readdirSync(DIR).filter((f) => f.endsWith(".js") && f !== "index.js");

// Each area file once by name, so test/docs/testMirror.test.js sees it loaded (a new area adds its line).
const AREAS = {
    "common.js": require("../../../src/config/botText/de/common"),
    "availability.js": require("../../../src/config/botText/de/availability"),
    "signup.js": require("../../../src/config/botText/de/signup"),
    "profile.js": require("../../../src/config/botText/de/profile"),
    "events.js": require("../../../src/config/botText/de/events"),
    "setup.js": require("../../../src/config/botText/de/setup"),
    "talk.js": require("../../../src/config/botText/de/talk"),
};

describe("config/botText/de", () => {
    it("loads every area file through the index", () => {
        const index = fs.readFileSync(path.join(DIR, "index.js"), "utf8");
        for (const file of AREA_FILES) {
            expect({ file, listed: index.includes(`require("./${file.replace(/\.js$/, "")}")`) }).toEqual({ file, listed: true });
            const area = AREAS[file];
            expect({ file, namedInThisTest: !!area }).toEqual({ file, namedInThisTest: true });
            for (const [en, de] of Object.entries(area)) {
                expect({ en, type: typeof de, empty: !String(de).trim() }).toEqual({ en, type: "string", empty: false });
            }
        }
    });

    it("has a German text for every sentence the code translates", () => {
        const de = require("../../../src/config/botText/de");
        const missing = [...usedSentences()].filter(([text]) => !Object.prototype.hasOwnProperty.call(de, text)).map(([text, file]) => `${file}: ${text}`);
        expect(missing).toEqual([]);
    });

    it("keeps no German text that no code asks for", () => {
        const de = require("../../../src/config/botText/de");
        const used = usedSentences();
        // a sentence picked at run time from a table (tr(lang, TABLE[key])) counts when the table holds it literally
        const tables = walk(SRC).filter((f) => !f.startsWith(DIR)).map((f) => fs.readFileSync(f, "utf8")).join("\n");
        const unused = Object.keys(de).filter((en) => !used.has(en) && !tables.includes(JSON.stringify(en)));
        expect(unused).toEqual([]);
    });

    it("keeps the placeholders of the English sentence", () => {
        const de = require("../../../src/config/botText/de");
        const names = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        const wrong = Object.entries(de).filter(([en, text]) => JSON.stringify(names(en)) !== JSON.stringify(names(text))).map(([en]) => en);
        expect(wrong).toEqual([]);
    });
});
