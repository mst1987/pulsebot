#!/usr/bin/env node
/**
 * The healer BiS lists — scraped from Wowhead's TBC Classic guides.
 *
 * WoWSims-TBC ships every healing gear set as an empty placeholder and has no
 * priest healing sim at all, so `fetch-wowsims-data.js` produces nothing for
 * the five healing specs. Wowhead's per-phase BiS guides are the source the
 * guild actually reads, so they are the source here too.
 *
 * What that costs, stated rather than hidden: Wowhead lists ITEMS, not
 * loadouts. A guide carries no gem or enchant ids, so a healer's BiS list is
 * unsocketed and unenchanted — enough to answer "how far is this raider from
 * BiS", not enough to simulate against. It is also a written recommendation
 * rather than a sim result, and opinionated where healing is opinionated
 * (which trinket pair, throughput against regen).
 *
 * Run:  npm run bis:refresh   (this, then fetch-wowsims-data.js, then this again)
 * Out:  src/config/wowhead/bisSets.json  (same shape as the WoWSims one)
 *
 * Why twice: this script needs the item table to know which slot an item goes
 * in, and the item table needs this script's ids to carry a healing relic at
 * all — a relic has no stats, so the WoWSims filter drops it. The first pass
 * writes down what it could not place ("pending"), the item table takes those
 * along, and the second pass resolves them. Running it alone is fine and
 * converges the same way, one run later.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const wowsims = require("../src/config/wowsims");

const OUT_FILE = path.join(__dirname, "..", "src", "config", "wowhead", "bisSets.json");

// One hub page per healing spec; the hub links every phase, so the phase urls
// are discovered rather than guessed. A hub that moves fails loudly here
// instead of silently producing a spec with no list.
const SPECS = [
    { key: "Priest-Holy", hub: "priest-healer-gear-bis-burning-crusade-classic-wow" },
    { key: "Druid-Restoration", hub: "druid-healer-gear-bis-burning-crusade-classic-wow" },
    { key: "Shaman-Restoration", hub: "shaman-healer-gear-bis-burning-crusade-classic-wow" },
    { key: "Paladin-Holy", hub: "holy-paladin-healer-gear-bis-burning-crusade-classic-wow" },
];

// Wowhead counts raid phases, we count tiers. Phase 4 is Zul'Aman, which is no
// tier of its own and sits between T6 and Sunwell — skipped for the same reason
// the WoWSims sets skip it. Pre-raid has no tier to hang on: the council always
// measures against a raid tier.
const PHASE_TIER = { 1: "t4", 2: "t5", 3: "t6", 5: "t65" };

// Which equipment slots a set fills, in character-sheet order. Slot 16 (off
// hand) is not required — a two-handed weapon takes it.
const WANTED_SLOTS = [0, 1, 2, 14, 4, 8, 9, 5, 6, 7, 10, 11, 12, 13, 15, 16, 17];
const REQUIRED_SLOTS = WANTED_SLOTS.filter((slot) => slot !== 16);
const SLOT_NAMES = {
    0: "Kopf", 1: "Hals", 2: "Schultern", 4: "Brust", 5: "Gürtel", 6: "Beine",
    7: "Füße", 8: "Armschienen", 9: "Hände", 10: "Ring 1", 11: "Ring 2",
    12: "Schmuck 1", 13: "Schmuck 2", 14: "Umhang", 15: "Waffe", 16: "Nebenhand",
    17: "Wand/Idol/Relikt",
};

// How good a guide calls a row. The wording varies per slot ("BiS",
// "Throughput BiS", "Regen BiS (CoH)", "Great", "Viable", "Option"), so it is
// scored by what it contains rather than matched exactly.
function rankScore(rank) {
    const text = String(rank || "").toLowerCase();
    if (text.includes("bis")) return 3;
    if (text.includes("great")) return 2;
    return 1;
}

function get(url, depth = 0) {
    if (depth > 5) return Promise.reject(new Error("zu viele Weiterleitungen: " + url));
    return new Promise((resolve, reject) => {
        const headers = { "user-agent": "Mozilla/5.0 (EventHelper BiS-Import)" };
        https.get(url, { headers }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                resolve(get(new URL(res.headers.location, url).toString(), depth + 1));
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error("HTTP " + res.statusCode + " für " + url));
                return;
            }
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => { body += chunk; });
            res.on("end", () => resolve(body));
        }).on("error", reject);
    });
}

/**
 * The guide text out of a Wowhead page.
 *
 * The visible guide is not served as HTML — it is handed to a
 * `markup.printHtml(...)` call as one JS string literal in Wowhead's own markup
 * language. That literal carries the tables, so it is read out and unescaped
 * rather than the rendered DOM being parsed.
 */
function guideBody(html) {
    const marker = "markup.printHtml(\"";
    const at = html.indexOf(marker);
    if (at < 0) throw new Error("kein Guide-Text auf der Seite gefunden");
    let i = at + marker.length;
    let raw = "";
    while (i < html.length) {
        const c = html[i];
        if (c === "\\") { raw += c + html[i + 1]; i += 2; continue; }
        if (c === "\"") break;
        raw += c;
        i++;
    }
    return JSON.parse("\"" + raw + "\"");
}

/** The phase guides a hub page links, as `{ [phase]: url }`. */
function phaseLinks(hubBody) {
    const links = {};
    const re = /\[cta-button=(https:\/\/[^\s\]]+)[^\]]*\]\s*Phase (\d)[^[]*\[\/cta-button\]/g;
    let m;
    while ((m = re.exec(hubBody))) links[Number(m[2])] = m[1];
    return links;
}

/**
 * The item rows of a guide, per slot section.
 *
 * Everything inside a `[toggler]` is dropped: those hold the "if you cannot get
 * the above" fallbacks, which the guide itself says are not BiS.
 */
function slotSections(body) {
    const sections = [];
    const headRe = /\[h3 toc="([^"]+)"\]/g;
    const heads = [];
    let m;
    while ((m = headRe.exec(body))) heads.push({ name: m[1], at: m.index });
    for (let i = 0; i < heads.length; i++) {
        const end = i + 1 < heads.length ? heads[i + 1].at : body.length;
        let text = body.slice(heads[i].at, end);
        const toggler = text.indexOf("[toggler");
        if (toggler >= 0) text = text.slice(0, toggler);
        const rows = [];
        const rowRe = /\[tr\]\s*\[td\]([^[\]]*)\[\/td\]\s*\[td\]\s*\[item=(\d+)\]/g;
        let r;
        while ((r = rowRe.exec(text))) rows.push({ rank: r[1].trim(), id: Number(r[2]) });
        if (rows.length) sections.push({ name: heads[i].name, rows });
    }
    return sections;
}

/**
 * Where an item may go, narrower than the item table's own answer.
 *
 * The table lists both hands for every weapon, because a council asking "what
 * would this drop replace" wants to see both pieces that could come off. A BiS
 * list is the other question — what someone *wears* — and there a main-hand
 * weapon is never an off-hand: without this, the Weapons section's second-best
 * entry took the off-hand slot and the actual off-hand had nowhere to go.
 */
function slotsFor(item) {
    if (item.hand === "off") return [16];
    if (item.hand) return [15];
    return item.slots.filter((slot) => WANTED_SLOTS.includes(slot));
}

/**
 * The parsed sections turned into one set, one item per equipment slot.
 *
 * Which slot an item goes in comes from the item table, not from the section
 * heading — the headings are prose ("Weapons", "Offhands", "Idols") and the
 * item knows the answer exactly. That also settles the case a heading cannot:
 * a two-handed weapon takes the off hand with it, so the off-hand section's
 * pick finds no free slot and is dropped instead of being worn beside a staff.
 *
 * Sections are walked in page order, rows within a section best rank first, so
 * the doubled slots take the two best rows — the guides mark only one ring
 * "BiS" and expect the next one down to sit next to it.
 */
function buildSet(sections) {
    const taken = new Map();
    const pending = new Set();
    for (const section of sections) {
        const ranked = section.rows
            .map((row, i) => ({ ...row, i, score: rankScore(row.rank) }))
            .sort((a, b) => b.score - a.score || a.i - b.i);
        const unknown = [];
        let filled = 0;
        for (const row of ranked) {
            const item = wowsims.item(row.id);
            if (!item) { unknown.push(row); continue; }
            const free = slotsFor(item).find((s) => !taken.has(s));
            if (free === undefined) continue;
            taken.set(free, { id: row.id });
            filled++;
            if (item.hand === "two") taken.set(16, null); // blocked, not filled
        }
        // Worth chasing: what the guide itself calls BiS, and everything a
        // section named when it could not place a single item — that section's
        // slot is open, so its rows are the only candidates there are. A merely
        // "Great" alternative next to a slot that did get filled is not.
        for (const row of unknown) if (row.score === 3 || !filled) pending.add(row.id);
    }
    const open = REQUIRED_SLOTS.filter((slot) => !taken.get(slot));
    return {
        items: WANTED_SLOTS.map((slot) => taken.get(slot) || null).filter(Boolean),
        open,
        // Ids the item table does not carry but a list wants. The WoWSims table
        // filters on stats, and a healing relic has none — its whole value is an
        // effect — so every idol, totem and libram lands here on a first run and
        // is picked up by the next `fetch-wowsims-data.js`.
        pending: [...pending],
    };
}

async function setFor(url) {
    return buildSet(slotSections(guideBody(await get(url))));
}

async function main() {
    const sets = {};
    const pending = new Set();
    const problems = [];
    for (const spec of SPECS) {
        process.stdout.write(spec.key + ": Hub laden … ");
        const links = phaseLinks(guideBody(await get("https://www.wowhead.com/tbc/guides/" + spec.hub)));
        const phases = Object.keys(PHASE_TIER).map(Number).filter((p) => links[p]);
        process.stdout.write(phases.length + " Phasen\n");
        if (!phases.length) problems.push(spec.key + ": der Hub verlinkt keine Phase");
        sets[spec.key] = {};
        for (const phase of phases) {
            const tier = PHASE_TIER[phase];
            const set = await setFor(links[phase]);
            sets[spec.key][tier] = set.items;
            for (const id of set.pending) pending.add(id);
            const open = set.open.map((slot) => SLOT_NAMES[slot] || slot).join(", ");
            console.log("  " + tier + ": " + set.items.length + " Teile" + (open ? " — offen: " + open : ""));
            if (set.open.length) problems.push(spec.key + " " + tier + ": " + open + " ohne Item");
        }
    }

    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    const out = {
        _generated: "scripts/fetch-wowhead-bis.js — nicht von Hand bearbeiten",
        _source: "https://www.wowhead.com/tbc/guides/classes/best-in-slot-guides-burning-crusade-classic",
        _note: "Wowhead nennt nur Items: keine Sockel, keine Verzauberungen.",
        fetchedAt: new Date().toISOString().slice(0, 10),
        pending: [...pending].sort((a, b) => a - b),
        sets,
    };
    fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 1) + "\n");
    console.log("\n" + OUT_FILE + " geschrieben.");
    if (pending.size) {
        console.log("Der Item-Tabelle unbekannt: " + [...pending].join(", ")
            + " — `npm run bis:refresh` nimmt auf, was Raid-Gear ist; Grünes bleibt draußen.");
    }
    if (problems.length) {
        console.log("\nZu prüfen:");
        for (const p of problems) console.log("  ! " + p);
    }
}

// Der Parser ist die eigentliche Arbeit hier und gehört geprüft, ohne dafür
// Wowhead anzufragen — also: als Modul nur die reinen Funktionen, gelaufen wird
// nur beim direkten Aufruf.
module.exports = { guideBody, phaseLinks, slotSections, buildSet, rankScore, PHASE_TIER };

if (require.main === module) {
    main().catch((err) => {
        console.error(err.message);
        process.exit(1);
    });
}
