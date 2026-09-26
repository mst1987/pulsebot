// Layering guard (#425): src/web/ is the HTTP side of the bot (routes, pages,
// what only the admin menu reads). The bot's commands and utils must not reach
// into it; what they need lives below it, in src/services/ (domain logic) and
// src/stores/ (the JSON stores). Services and stores stay web-free as well,
// with one named exception: the `fail(status, code, message)` result shape of
// web/http/apiResult.js, which a few services return to their route.
//
//   commands, utils  ->  services, stores, config, classes, utils
//   services, stores ->  the same, plus web/http/apiResult.js
//
// Every `require("./...")` counts, the lazy ones inside a function too.
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "..", "src");
const WEB = path.join(SRC, "web");
const ALLOWED_FOR_SERVICES = new Set([path.join(WEB, "http", "apiResult.js")]);

function jsFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return jsFiles(full);
        return entry.name.endsWith(".js") ? [full] : [];
    });
}

/** The files under src/web/ a file requires by a relative path. */
function webRequires(file) {
    const text = fs.readFileSync(file, "utf8");
    const out = [];
    for (const m of text.matchAll(/require\(\s*["'`](\.{1,2}\/[^"'`]+)["'`]\s*\)/g)) {
        const target = path.resolve(path.dirname(file), m[1]);
        if (target === WEB || target.startsWith(WEB + path.sep)) out.push(target.endsWith(".js") ? target : `${target}.js`);
    }
    return out;
}

const rel = (file) => path.relative(SRC, file).split(path.sep).join("/");

function violations(layers, allowed = new Set()) {
    const found = [];
    for (const layer of layers) {
        for (const file of jsFiles(path.join(SRC, layer))) {
            for (const target of webRequires(file)) {
                if (!allowed.has(target)) found.push(`${rel(file)} -> ${rel(target)}`);
            }
        }
    }
    return found;
}

describe("layering: nothing below src/web requires from it", () => {
    it("finds the requires it looks for", () => {
        const events = path.join(SRC, "services", "events", "eventCreate.js");
        expect(webRequires(events).map(rel)).toContain("web/http/apiResult.js");
    });

    it("commands and utils never require from web/", () => {
        expect(violations(["commands", "utils"])).toEqual([]);
    });

    it("services and stores require from web/ only the apiResult shape", () => {
        expect(violations(["services", "stores"], ALLOWED_FOR_SERVICES)).toEqual([]);
    });

    it("src/web holds no loose module any more, only its cluster folders", () => {
        const loose = fs.readdirSync(WEB).filter((name) => name.endsWith(".js"));
        expect(loose).toEqual([]);
    });
});
