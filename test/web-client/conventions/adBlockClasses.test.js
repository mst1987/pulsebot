// No class or id an ad blocker hides.
//
// The page "Addons" (#818) shipped with the prefix "ad-" (ad-grid, ad-card).
// EasyList, the default list of uBlock Origin, AdBlock Plus, Brave and most
// others, hides `.ad-card` and `.ad-grid` on every site - so for every admin
// with an ad blocker the page showed its head and the line under the cards and
// nothing between: no card, no message, no error. Nothing in the code was
// wrong, which is why it took a report from production to find.
//
// The generic rules hide hundreds of names starting with "ad-", "ads-",
// "advert", "sponsor"; the safe rule is to use none of those starts at all.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "..", "src", "web-client", "src");

// The starts generic cosmetic filters aim at (EasyList ##.ad-…, ##.ads-…, ##.advert…, ##.sponsor…).
const BLOCKED = /^(ad|ads|adv|advert|advertisement|advertising|sponsor|sponsored|banner-ad|adbox|adsbox)([-_]|$)/i;

/** Every file under the client source with one of the extensions (tests left out). */
function filesOf(dir, exts) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...filesOf(full, exts));
        else if (exts.some((e) => entry.name.endsWith(e)) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
}

/** The class and id names a stylesheet selects. */
function cssNames(css) {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
    // selectors only: what stands before a "{"
    const selectors = [...clean.matchAll(/([^{}]+)\{/g)].map((m) => m[1]);
    const names = [];
    for (const sel of selectors) for (const m of sel.matchAll(/[.#]([A-Za-z_][\w-]*)/g)) names.push(m[1]);
    return names;
}

/** The class and id names a component writes as plain strings. */
function tsxNames(src) {
    const names = [];
    for (const m of src.matchAll(/\b(?:className|id|htmlFor)=["']([^"']+)["']/g)) names.push(...m[1].split(/\s+/));
    // className={`… ${x}`} and buttonClass(…, "extra"): the literal parts
    for (const m of src.matchAll(/className=\{`([^`]*)`\}/g)) names.push(...m[1].replace(/\$\{[^}]*\}/g, " ").split(/\s+/));
    for (const m of src.matchAll(/buttonClass\([^)]*?"([\w -]+)"\)/g)) names.push(...m[1].split(/\s+/));
    return names.filter(Boolean);
}

describe("class names an ad blocker would hide", () => {
    it("recognises the names that hid the page Addons", () => {
        expect(BLOCKED.test("ad-card")).toBe(true);
        expect(BLOCKED.test("ad-grid")).toBe(true);
        expect(BLOCKED.test("ads")).toBe(true);
        expect(BLOCKED.test("addon-card")).toBe(false);
        expect(BLOCKED.test("dlp-card")).toBe(false);
        expect(BLOCKED.test("admin")).toBe(false);
    });

    it("are used by no stylesheet of the client", () => {
        const bad = [];
        for (const file of filesOf(CLIENT, [".css"])) {
            for (const name of cssNames(fs.readFileSync(file, "utf8"))) {
                if (BLOCKED.test(name)) bad.push(`${path.relative(CLIENT, file)}: ${name}`);
            }
        }
        expect([...new Set(bad)]).toEqual([]);
    });

    it("are used by no component of the client", () => {
        const bad = [];
        for (const file of filesOf(CLIENT, [".tsx"])) {
            for (const name of tsxNames(fs.readFileSync(file, "utf8"))) {
                if (BLOCKED.test(name)) bad.push(`${path.relative(CLIENT, file)}: ${name}`);
            }
        }
        expect([...new Set(bad)]).toEqual([]);
    });

    it("keeps the page Addons on its own prefix", () => {
        const page = fs.readFileSync(path.join(CLIENT, "pages", "addon", "AddonPage.tsx"), "utf8");
        expect(page).toContain("\"dlp-card\"");
        expect(page).toContain("\"dlp-grid\"");
    });
});
