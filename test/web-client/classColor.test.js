// classColorProps() gibt { className, style } zurück. In JSX überschreibt ein
// Spread jedes vorher gesetzte Attribut — steht er also im *selben* Tag hinter
// einem eigenen className, ist das eigene weg, und das Element verliert lautlos
// seine ganze Gestaltung. Genau das ist passiert: die Spec-Schalter im Tab
// „BiS-Listen" standen als nackte graue Kästen da, weil `lc-blspec` durch
// `class-colored` ersetzt wurde. Im Code unsichtbar, am Bildschirm sofort — also
// hält es ein Scan fest.
//
// Erlaubt bleibt beides einzeln: der Spread auf einem Element ohne eigene Klasse
// (dann ist `class-colored` genau richtig), oder `style={classColorProps(x).style}`
// neben einer eigenen Klasse.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "../../src/web-client/src");

function clientSources() {
    const out = [];
    for (const dir of ["pages", "components"]) {
        const full = path.join(CLIENT, dir);
        for (const file of fs.readdirSync(full)) {
            if (file.endsWith(".tsx")) out.push([`${dir}/${file}`, fs.readFileSync(path.join(full, file), "utf8")]);
        }
    }
    return out;
}

/** Every spread of classColorProps that sits in a tag which sets its own class. */
function overwrittenClassNames(src) {
    const out = [];
    const spread = /\{\.\.\.classColorProps\(/g;
    for (let hit = spread.exec(src); hit; hit = spread.exec(src)) {
        // The tag this spread belongs to starts at the nearest "<" before it.
        const tag = src.slice(src.lastIndexOf("<", hit.index), hit.index);
        if (/\bclassName=/.test(tag)) out.push(tag.split("\n")[0].trim());
    }
    return out;
}

describe("class colours", () => {
    it("never spreads classColorProps over an element's own className", () => {
        for (const [name, src] of clientSources()) {
            expect({ file: name, overwritten: overwrittenClassNames(src) })
                .toEqual({ file: name, overwritten: [] });
        }
    });

    it("catches the shape it is meant to catch", () => {
        // Damit der Scan nicht stillschweigend nichts mehr prüft.
        expect(overwrittenClassNames('<button className="x" {...classColorProps(c)}>')).toHaveLength(1);
        expect(overwrittenClassNames('<b {...classColorProps(c)}>')).toEqual([]);
        expect(overwrittenClassNames('<b className="x" style={classColorProps(c).style}>')).toEqual([]);
    });
});
