#!/usr/bin/env node
// Gives every default mob of the raid plan catalog an icon and writes src/config/mobIcons.json.
//
//   node scripts/fetch-mob-icons.js [--offline]
//
// Warcraft Logs (the source of the boss icons, scripts/fetch-boss-icons.js) has no icons for adds or trash, so each
// mob gets a similar WoW icon of the Wowhead icon CDN by the kind of creature it is (src/web/raidplanMobIconRules.js,
// the table to edit). Every candidate is checked with a real request (HTTP 200 and an image); the first that exists
// is taken, and the result of each check is written next to it — nothing is entered blind. The JSON is generated:
// do not edit it by hand. Idempotent. --offline keeps the results already in the JSON and only re-derives the mapping.
const fs = require("fs");
const path = require("path");
const { MOBS } = require("../src/web/raidplanCatalogDefaults");
const { KIND_ICONS, MOB_KINDS, ICON_CHOICES } = require("../src/web/raidplanMobIconRules");

const OUT = path.join(__dirname, "..", "src", "config", "mobIcons.json");
const URL_OF = (name) => `https://wow.zamimg.com/images/wow/icons/large/${name}.jpg`;

async function check(name, known, offline) {
    if (known[name]) return known[name];
    if (offline) return { status: 0, type: "" };
    try {
        const r = await fetch(URL_OF(name));
        return { status: r.status, type: r.headers.get("content-type") || "" };
    } catch (e) {
        return { status: 0, type: String(e.message) };
    }
}
const good = (c) => c.status === 200 && /^image\//.test(c.type);

async function main() {
    const offline = process.argv.includes("--offline");
    let known = {};
    try { known = JSON.parse(fs.readFileSync(OUT, "utf8")).verified || {}; } catch { /* first run */ }
    const verified = {};
    const ok = async (name) => { if (!verified[name]) verified[name] = await check(name, known, offline); return good(verified[name]); };

    const icons = {};
    const problems = [];
    for (const m of MOBS) {
        const slug = m.id.replace(/^d:/, "");
        const kind = MOB_KINDS[slug] || "generic";
        const candidates = [...(KIND_ICONS[kind] || []), ...KIND_ICONS.generic];
        let chosen = "";
        for (const c of candidates) { if (await ok(c)) { chosen = c; break; } }
        if (chosen) icons[m.id] = { icon: chosen, kind };
        else problems.push(m.id);
    }
    const choices = {};
    for (const [cat, list] of Object.entries(ICON_CHOICES)) {
        choices[cat] = [];
        for (const n of list) { if (await ok(n)) choices[cat].push(n); else console.warn(`Auswahl-Icon ${n} (${cat}) existiert nicht, weggelassen`); }
    }
    fs.writeFileSync(OUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), source: "wow.zamimg.com icon CDN, similar icons by creature kind", icons, choices, verified }, null, 2)}\n`);
    console.log(`${Object.keys(icons).length}/${MOBS.length} Mobs mit Icon, ${Object.keys(verified).length} Icons geprüft → ${path.relative(path.join(__dirname, ".."), OUT)}`);
    if (problems.length) { console.error(`ohne Icon: ${problems.join(", ")}`); process.exit(1); }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
