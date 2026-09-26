#!/usr/bin/env node
// Gives every default mob of the raid plan catalog an icon and writes src/config/generated/mobIcons.json.
//
//   node scripts/fetch-mob-icons.js [--offline] [--force]
//
// 1. PORTRAITS (the real thing): for every mob in src/web/raidplanMobNpcs.js the Wowhead TBC page of the NPC is fetched,
//    its title has to name the mob, its display id is read, and the model render of that display
//    (wow.zamimg.com/modelviewer/tbc/webthumbs/npc/<id % 256>/<id>.png) is cropped to a round-friendly square
//    (head and shoulders for a figure, the whole creature for a compact one; scripts/lib/png.js) and stored as
//    src/web-client/public/mobs/<npcId>.png (64 px, served at /mobs/<npcId>.png, icon key `mob:<npcId>`).
// 2. PLACEHOLDERS: every other mob gets a similar WoW icon of the Wowhead icon CDN by the kind of creature it is
//    (src/web/raidplanMobIconRules.js, the table to edit). The catalog marks those as "Platzhalter-Icon".
// Every request is checked (HTTP 200 and an image) and the result of each check is written next to the entry —
// nothing is entered blind. The JSON is generated: do not edit it by hand. Idempotent: a portrait that is stored and
// recorded is not fetched again (--force fetches it again). --offline keeps the results already in the JSON and only
// re-derives the mapping.
const fs = require("fs");
const path = require("path");
const { MOBS } = require("../src/web/raidplanCatalogDefaults");
const { KIND_ICONS, MOB_KINDS, ICON_CHOICES } = require("../src/web/raidplanMobIconRules");
const { MOB_NPCS } = require("../src/web/raidplanMobNpcs");
const png = require("./lib/png");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "src", "config", "generated", "mobIcons.json");
const DIR = path.join(ROOT, "src", "web-client", "public", "mobs");
const URL_OF = (name) => `https://wow.zamimg.com/images/wow/icons/large/${name}.jpg`;
const PAGE_OF = (id) => `https://www.wowhead.com/tbc/npc=${id}`;
const THUMB_OF = (display) => `https://wow.zamimg.com/modelviewer/tbc/webthumbs/npc/${display % 256}/${display}.png`;
const UA = { "User-Agent": "Mozilla/5.0 (compatible; EventHelperIconCheck/1.0)" };
const SIZE = 64;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** The NPC's Wowhead page: its name (title) and its display id, or null when it does not answer. */
async function npcPage(id) {
    const r = await fetch(PAGE_OF(id), { headers: UA });
    if (r.status !== 200) return null;
    const t = await r.text();
    const title = (t.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
    const d = t.match(/displayId&quot;:(\d+)/) || t.match(/displayId = (\d+)/);
    return { name: title.split(" - ")[0].trim(), display: d ? Number(d[1]) : 0 };
}

/** One portrait: verify the page, fetch and crop the render, store it. Returns the record for the JSON, or an error text. */
async function portrait(mob, npcId, prev, force, offline) {
    const file = path.join(DIR, `${npcId}.png`);
    if (prev && prev.npcId === npcId && fs.existsSync(file) && !force) return { rec: prev };
    if (offline) return { error: "offline and not stored yet" };
    const page = await npcPage(npcId);
    if (!page) return { error: `npc ${npcId}: page does not answer` };
    // the page's title names the mob (the catalog says "Abomination", Wowhead says "Abomination" too; "Shadowy Necromancer" is the exception, see the table)
    const wanted = mob.name.toLowerCase();
    const got = page.name.toLowerCase();
    if (got !== wanted && !(NAME_ALIASES[mob.id] || []).includes(got)) return { error: `npc ${npcId} is "${page.name}", not "${mob.name}"` };
    if (!page.display) return { error: `npc ${npcId}: no display id` };
    const r = await fetch(THUMB_OF(page.display), { headers: UA });
    const type = r.headers.get("content-type") || "";
    if (r.status !== 200 || !/^image\/png/.test(type)) return { error: `render of display ${page.display}: ${r.status} ${type}` };
    const img = png.decode(Buffer.from(await r.arrayBuffer()));
    const box = png.alphaBox(img);
    if (!box) return { error: `render of display ${page.display} is empty` };
    const rect = png.portraitRect(img, box);
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(file, png.encode(png.cropScale(img, rect, SIZE)));
    return { rec: { npcId, name: page.name, displayId: page.display, icon: `mob:${npcId}`, crop: rect, source: THUMB_OF(page.display), verified: { status: r.status, type } } };
}

// Wowhead names that differ from the catalog's on purpose
const NAME_ALIASES = { "d:hyjal-necromancer": ["shadowy necromancer"] };

async function main() {
    const offline = process.argv.includes("--offline");
    const force = process.argv.includes("--force");
    let old = {};
    try { old = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch { /* first run */ }
    const known = old.verified || {};
    const verified = {};
    const ok = async (name) => { if (!verified[name]) verified[name] = await check(name, known, offline); return good(verified[name]); };

    const icons = {};
    const portraits = {};
    const problems = [];
    const notes = [];
    for (const m of MOBS) {
        const slug = m.id.replace(/^d:/, "");
        const kind = MOB_KINDS[slug] || "generic";
        const candidates = [...(KIND_ICONS[kind] || []), ...KIND_ICONS.generic];
        let chosen = "";
        for (const c of candidates) { if (await ok(c)) { chosen = c; break; } }
        if (chosen) icons[m.id] = { icon: chosen, kind };
        else problems.push(m.id);
        if (MOB_NPCS[slug]) {
            try {
                const res = await portrait(m, MOB_NPCS[slug], (old.portraits || {})[m.id], force, offline);
                if (res.rec) portraits[m.id] = res.rec;
                else notes.push(`${m.id}: ${res.error}`);
            } catch (e) {
                notes.push(`${m.id}: ${e.message}`);
            }
            if (!offline) await sleep(150);
        }
    }
    const choices = {};
    for (const [cat, list] of Object.entries(ICON_CHOICES)) {
        choices[cat] = [];
        for (const n of list) { if (await ok(n)) choices[cat].push(n); else console.warn(`Auswahl-Icon ${n} (${cat}) existiert nicht, weggelassen`); }
    }
    const generatedAt = offline && old.generatedAt ? old.generatedAt : new Date().toISOString();
    fs.writeFileSync(OUT, `${JSON.stringify({
        generatedAt,
        source: "portraits: Wowhead TBC model renders of the NPC (wow.zamimg.com/modelviewer/tbc/webthumbs), cropped by scripts/lib/png.js; placeholders: wow.zamimg.com icon CDN, similar icons by creature kind",
        portraits, icons, choices, verified,
    }, null, 2)}\n`);
    console.log(`${Object.keys(portraits).length}/${MOBS.length} Mobs mit Portrait, ${MOBS.length - Object.keys(portraits).length} mit Platzhalter-Icon, ${Object.keys(verified).length} Icons geprüft → ${path.relative(ROOT, OUT)}`);
    for (const n of notes) console.error(`kein Portrait: ${n}`);
    if (problems.length) { console.error(`ohne Icon: ${problems.join(", ")}`); process.exit(1); }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
