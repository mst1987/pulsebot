// Generates src/config/claData.js from the cloned Apps Script source + extracted CSVs.
// Run once (and again if the CLA source changes). Not used at runtime.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const REF = path.join(ROOT, "reference", "cla");
const gear = fs.readFileSync(path.join(REF, "appsscript", "GearIssues.js"), "utf8");
const gearLines = gear.split(/\r?\n/);

// --- helpers --------------------------------------------------------------
function idsOnLine(idx) {
    // all "12345" string-literal numeric ids on a single (long) line
    const line = gearLines[idx] || "";
    const m = line.match(/"\d+"/g) || [];
    return [...new Set(m.map((s) => s.replace(/"/g, "")))];
}
function lineIndexBefore(marker) {
    const i = gearLines.findIndex((l) => l.includes(marker));
    if (i < 0) throw new Error("marker not found: " + marker);
    return i - 1; // the condition is on the preceding (long) line
}
function lineIndexContaining(marker) {
    const i = gearLines.findIndex((l) => l.includes(marker));
    if (i < 0) throw new Error("marker not found: " + marker);
    return i;
}

// gem color sets (condition line precedes the counter assignment)
const META = idsOnLine(lineIndexBefore("metaGemfound = gem.id;"));
const YELLOW = idsOnLine(lineIndexBefore("yellowGemsFound++;"));
const RED = idsOnLine(lineIndexBefore("redGemsFound++;"));
const BLUE = idsOnLine(lineIndexBefore("blueGemsFound++;"));

// uncut gems: condition contains the first uncut id "23112"
const UNCUT = idsOnLine(lineIndexContaining('gem.id.toString() == "23112"'));

// acceptable gems that are NOT flagged at the uncommon (==60) / rare (<100) thresholds.
// These appear as long "&& gem.id.toString() != \"...\"" chains.
const ACCEPTABLE_UNCOMMON = idsOnLine(lineIndexContaining("gemsToConsider > 2 && gem.itemLevel == 60"));
const ACCEPTABLE_RARE = idsOnLine(lineIndexContaining("gemsToConsider > 3 && gem.itemLevel < 100"));

// items that cannot/should not be checked for enchants (shirts, relics, special trinkets...)
const ITEMS_WITHOUT_ENCHANT = idsOnLine(lineIndexContaining('item.id.toString() != "21471"'));

// --- CSV parsing ----------------------------------------------------------
function parseCsv(file) {
    const text = fs.readFileSync(path.join(REF, file), "utf8");
    const rows = [];
    let row = [], cur = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQ) {
            if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
            else if (c === '"') inQ = false;
            else cur += c;
        } else if (c === '"') inQ = true;
        else if (c === ",") { row.push(cur); cur = ""; }
        else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
        else if (c === "\r") { /* skip */ }
        else cur += c;
    }
    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    return rows;
}

// gear_issues.csv: col B(1)="id [slot]" + col C(2)=name  -> enchant blacklist
//                  col E(4)=item id    + col F(5)=name   -> excluded gear (ignore)
const gi = parseCsv("gear_issues.csv");
const ENCHANT_BLACKLIST = [];
const EXCLUDED_GEAR = [];
for (let r = 4; r < gi.length; r++) {
    const idSlot = (gi[r][1] || "").trim();
    const name = (gi[r][2] || "").trim();
    if (/^\d+/.test(idSlot)) {
        const id = idSlot.split("[")[0].trim();
        const slotM = idSlot.match(/\[(\d+)\]/);
        ENCHANT_BLACKLIST.push({ id, slot: slotM ? slotM[1] : null, name });
    }
    const exId = (gi[r][4] || "").trim();
    const exName = (gi[r][5] || "").trim();
    if (/^\d+$/.test(exId)) EXCLUDED_GEAR.push({ id: exId, name: exName });
}

// sockets.csv: item id -> number of sockets
const sk = parseCsv("sockets.csv");
const SOCKETS = {};
for (let r = 1; r < sk.length; r++) {
    const id = (sk[r][0] || "").trim();
    const n = (sk[r][1] || "").trim();
    if (/^\d+$/.test(id) && /^\d+$/.test(n)) SOCKETS[id] = Number(n);
}

// shadow_resistance_config.csv: item id -> SR value
const sr = parseCsv("shadow_resistance_config.csv");
const SHADOW_RESISTANCE = {};
for (let r = 0; r < sr.length; r++) {
    const id = (sr[r][0] || "").trim();
    const v = (sr[r][1] || "").trim();
    if (/^\d+$/.test(id) && /^-?\d+$/.test(v)) SHADOW_RESISTANCE[id] = Number(v);
}

// master_buffConsumables.csv: columns = Battle Elixir, Guardian Elixir, Flask,
// Food Buff, Scrolls, Weapon Enhancement, JC neck. Cells are spell GUIDs (some
// annotated like "33077 [Agi]"). We keep the leading numeric guid per cell.
const bc = parseCsv("master_buffConsumables.csv");
function columnGuids(colIdx) {
    const out = [];
    for (let r = 1; r < bc.length; r++) {
        const cell = (bc[r][colIdx] || "").trim();
        const guid = cell.split("[")[0].trim();
        if (/^\d+$/.test(guid)) out.push(guid);
    }
    return [...new Set(out)];
}
const CONSUMABLES = {
    battleElixir: columnGuids(0),
    guardianElixir: columnGuids(1),
    flask: columnGuids(2),
    food: columnGuids(3),
    jcNeck: columnGuids(6),
};

// --- emit -----------------------------------------------------------------
const out = `// AUTO-GENERATED by scripts/build-cla-data.js from the CLA Apps Script source
// and reference/cla/*.csv. Do not edit by hand; re-run the generator instead.
// Reference data for the WoW TBC log audit ("CLA" by Lars Maag / shariva).

/* eslint-disable */
module.exports = {
    // WCL/WoW equip slot indices that can carry a permanent enchant
    ENCHANTABLE_SLOTS: [0, 2, 4, 6, 7, 8, 9, 14, 15, 16],

    // gem item-level thresholds map to a "minimum gem quality" selection (default: rare)
    GEM_QUALITY: { ignore: 0, common: 1, uncommon: 2, rare: 3, epic: 4 },

    META_GEM_IDS: ${JSON.stringify(META)},
    YELLOW_GEM_IDS: ${JSON.stringify(YELLOW)},
    RED_GEM_IDS: ${JSON.stringify(RED)},
    BLUE_GEM_IDS: ${JSON.stringify(BLUE)},
    UNCUT_GEM_IDS: ${JSON.stringify(UNCUT)},

    // gems that are acceptable despite hitting a quality threshold (special/notable gems)
    ACCEPTABLE_UNCOMMON_GEM_IDS: ${JSON.stringify(ACCEPTABLE_UNCOMMON)},
    ACCEPTABLE_RARE_GEM_IDS: ${JSON.stringify(ACCEPTABLE_RARE)},

    // items that take no (relevant) enchant -> skipped by the no-enchant check
    ITEMS_WITHOUT_ENCHANT: ${JSON.stringify(ITEMS_WITHOUT_ENCHANT)},

    // suboptimal/cheap enchant blacklist: { id, slot|null, name }
    ENCHANT_BLACKLIST: ${JSON.stringify(ENCHANT_BLACKLIST, null, 0)},

    // off-spec / joke gear excluded from the no-enchant check: { id, name }
    EXCLUDED_GEAR: ${JSON.stringify(EXCLUDED_GEAR, null, 0)},

    // itemId -> number of gem sockets
    SOCKETS: ${JSON.stringify(SOCKETS)},

    // itemId -> shadow resistance value (for the Mother Shahraz check)
    SHADOW_RESISTANCE: ${JSON.stringify(SHADOW_RESISTANCE)},

    // consumable buff spell GUIDs per category (from the master config sheet)
    CONSUMABLES: ${JSON.stringify(CONSUMABLES)},
};
`;

const outPath = path.join(ROOT, "src", "config", "claData.js");
fs.writeFileSync(outPath, out);
console.log("wrote", outPath);
console.log({
    META: META.length, YELLOW: YELLOW.length, RED: RED.length, BLUE: BLUE.length,
    UNCUT: UNCUT.length, ACCEPTABLE_UNCOMMON: ACCEPTABLE_UNCOMMON.length,
    ACCEPTABLE_RARE: ACCEPTABLE_RARE.length, ITEMS_WITHOUT_ENCHANT: ITEMS_WITHOUT_ENCHANT.length,
    ENCHANT_BLACKLIST: ENCHANT_BLACKLIST.length, EXCLUDED_GEAR: EXCLUDED_GEAR.length,
    SOCKETS: Object.keys(SOCKETS).length, SHADOW_RESISTANCE: Object.keys(SHADOW_RESISTANCE).length,
    CONSUMABLES: Object.fromEntries(Object.entries(CONSUMABLES).map(([k, v]) => [k, v.length])),
});
