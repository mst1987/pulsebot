// Wohin die Sim-Exporte verlinken. Ein Link, der erst aus der geladenen Seite
// heraus weiterleitet, kostet jeden Klick einen Umweg — und der alte
// Schattenpriester-Pfad antwortete überhaupt nicht mehr (404). Beides sieht man
// dem Code nicht an, also hält es ein Scan fest.
//
// ⚠️ Die Adressen wurden gegen die echte Seite geprüft. Ein erfundener Pfad
// antwortet dort mit 200 und einer 1,8-KB-Platzhalterseite statt mit einem
// Fehler — "es lädt" ist also kein Beleg, und wer hier etwas ändert, muss die
// Seiten daran unterscheiden, was sie tatsächlich zurückgeben.
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "../../src");

function sources(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...sources(full));
        else if (entry.name.endsWith(".js")) out.push([path.relative(SRC, full), fs.readFileSync(full, "utf8")]);
    }
    return out;
}

describe("WoWSims links", () => {
    it("links the live site, not the address that only forwards", () => {
        for (const [name, src] of sources(SRC)) {
            const linked = [...src.matchAll(/["'`](https:\/\/wowsims\.github\.io[^"'`]*)["'`]/g)].map((m) => m[1]);
            expect({ file: name, stale: linked }).toEqual({ file: name, stale: [] });
        }
    });

    it("sends every caster spec to a page that exists", () => {
        // Der Priester-Pfad war der kaputte: /tbc/priest/dps/ gibt es, die
        // Spec-Varianten (/priest/shadow/) nicht.
        const src = fs.readFileSync(path.join(SRC, "web/apiRoutes/lootCouncil.js"), "utf8");
        const block = src.slice(src.indexOf("const SIM_URLS"), src.indexOf("};", src.indexOf("const SIM_URLS")));
        const urls = [...block.matchAll(/"(https:[^"]+)"/g)].map((m) => m[1]);
        expect(urls.length).toBeGreaterThanOrEqual(9);
        for (const url of urls) {
            expect(url).toMatch(/^https:\/\/www\.wowsims\.com\/tbc\//);
            // Jede Adresse endet auf einem der geprüften Pfade.
            expect(url).toMatch(/\/(dps|balance|elemental)\/$/);
        }
    });
});
