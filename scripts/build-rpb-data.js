// Generates src/config/rpbData.js from the RPB reference CSVs.
// Run once (and again if the RPB config sheet changes). Not used at runtime.
//
// Source: reference/rpb/config/configNew.csv — the shared CLA/RPB master config
// sheet (1pIbbPkn9i5jxyQ60Xt86fLthtbdCAmFriIpPSvmXiu0, tab "configNew"), plus
// reference/rpb/spell_haste_config.csv.
//
// The config sheet is laid out horizontally: row 2 holds the section headers and
// each section occupies a block of columns — an "[id]" column carrying the machine
// readable entry, followed by one translated label column per language (DE/CN/RU/FR).
// An entry looks like:
//     Starfire [2912*,8949*,...,26986] {3.5}
//     Blessing of Protection [10278] --300--
//     Bloodlust [2825] --600-- ++40++
// where  [] = spell ids ("*" marks a non-max rank, only counted for the
// "mostly lower rank used" warning), {} = base cast time in seconds,
// -- -- = cooldown in seconds, ++ ++ = seconds of uptime the cooldown grants.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const REF = path.join(ROOT, "reference", "rpb");

// --- CSV parsing ----------------------------------------------------------
function parseCsv(file) {
    const text = fs.readFileSync(file, "utf8");
    const rows = [];
    let row = [], cur = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQ) {
            if (c === "\"" && text[i + 1] === "\"") { cur += "\""; i++; }
            else if (c === "\"") inQ = false;
            else cur += c;
        } else if (c === "\"") inQ = true;
        else if (c === ",") { row.push(cur); cur = ""; }
        else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
        else if (c === "\r") { /* skip */ }
        else cur += c;
    }
    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    return rows;
}

const conf = parseCsv(path.join(REF, "config", "configNew.csv"));
const HEADER_ROW = 1; // 0-based index of the row carrying the section headers

/** Column index whose header (row 2) matches the given predicate. */
function findColumn(pred) {
    const row = conf[HEADER_ROW] || [];
    for (let c = 0; c < row.length; c++) {
        if (pred((row[c] || "").trim())) return c;
    }
    return -1;
}

/** All non-empty cells of a column below the header row. */
function columnValues(col) {
    if (col < 0) return [];
    const out = [];
    for (let r = HEADER_ROW + 1; r < conf.length; r++) {
        const v = ((conf[r] || [])[col] || "").trim();
        if (v) out.push(v);
    }
    return out;
}

/**
 * Parse one config entry into a structured tracked-ability object.
 * Returns null for entries that carry no spell ids (pure spacers/notes).
 */
function parseEntry(raw, label) {
    const idPart = raw.match(/\[([^\]]*)\]/);
    if (!idPart) return null;
    const ids = [];
    const lowerRankIds = [];
    for (const tok of idPart[1].split(",")) {
        const t = tok.trim();
        if (!t) continue;
        const isLowerRank = t.endsWith("*");
        const id = t.replace(/\*/g, "").trim();
        if (!/^\d+$/.test(id)) continue;
        ids.push(id);
        if (isLowerRank) lowerRankIds.push(id);
    }
    if (ids.length === 0) return null;

    const name = raw.split(" [")[0].trim();
    const castTime = raw.match(/\{([\d.]+)\}/);
    const cooldown = raw.match(/--(\d+)--/);
    const uptime = raw.match(/\+\+(\d+)\+\+/);

    const entry = {
        name,
        label: (label || name).split(" [")[0].split(" {")[0].trim() || name,
        ids,
    };
    if (lowerRankIds.length) entry.lowerRankIds = lowerRankIds;
    if (castTime) entry.castTime = Number(castTime[1]);
    if (cooldown) entry.cooldown = Number(cooldown[1]);
    if (uptime) entry.uptimeSeconds = Number(uptime[1]);
    // "(uptime%)" in the name means the value is reported as an uptime percentage
    if (/uptime%/i.test(name)) entry.isUptime = true;
    if (/overheal/i.test(name)) entry.isOverheal = true;
    return entry;
}

/**
 * Read a section: the "[id]" column plus its German label column (the next
 * column over, "<section> DE").
 */
function readSection(idHeaderPred, deHeaderPred) {
    const idCol = findColumn(idHeaderPred);
    const deCol = findColumn(deHeaderPred);
    const raws = columnValues(idCol);
    const labels = columnValues(deCol);
    const out = [];
    // The label column is aligned row-wise with the id column, so index by the
    // raw row rather than by the compacted list.
    const idRows = [];
    for (let r = HEADER_ROW + 1; r < conf.length; r++) {
        const v = ((conf[r] || [])[idCol] || "").trim();
        if (v) idRows.push(r);
    }
    raws.forEach((raw, i) => {
        const r = idRows[i];
        const label = idCol >= 0 && deCol >= 0 ? ((conf[r] || [])[deCol] || "").trim() : "";
        const entry = parseEntry(raw, label);
        if (entry) out.push(entry);
    });
    if (out.length === 0 && labels.length === 0 && idCol < 0) {
        throw new Error("section not found in configNew.csv");
    }
    return out;
}

const CLASSES = ["Druid", "Hunter", "Mage", "Paladin", "Priest", "Rogue", "Shaman", "Warlock", "Warrior"];

// --- per-class sections ---------------------------------------------------
const SINGLE_TARGET_CASTS = {};
const AOE_CASTS = {};
const CLASS_COOLDOWNS = {};
for (const cls of CLASSES) {
    SINGLE_TARGET_CASTS[cls] = readSection(
        (h) => h.startsWith(`singleTargetCasts tracked ${cls} [`),
        (h) => h === `singleTargetCasts tracked ${cls} DE`,
    );
    AOE_CASTS[cls] = readSection(
        (h) => h.startsWith(`aoeCasts tracked ${cls} [`),
        (h) => h === `aoeCasts tracked ${cls} DE`,
    );
    CLASS_COOLDOWNS[cls] = readSection(
        (h) => h.startsWith(`classCooldowns tracked ${cls} [`),
        (h) => h === `classCooldowns tracked ${cls} DE`,
    );
}

// --- global sections ------------------------------------------------------
const DAMAGE_TAKEN = readSection(
    (h) => h.startsWith("damageTaken tracked ["),
    (h) => h === "damageTaken tracked DE",
);
const DEBUFFS = readSection(
    (h) => h.startsWith("debuffs tracked ["),
    (h) => h === "debuffs tracked DE",
);

/**
 * statsAndMisc entries carry no spell ids — they are derived statistics read out
 * of the WCL hit details (e.g. "Dodge outgoing", "Crushing Blow incoming") or
 * from buff uptimes ("Battle Shout uptime on you%"). Keep name + German label.
 */
function readNameSection(idHeaderPred, deHeaderPred) {
    const idCol = findColumn(idHeaderPred);
    const deCol = findColumn(deHeaderPred);
    const out = [];
    for (let r = HEADER_ROW + 1; r < conf.length; r++) {
        const name = ((conf[r] || [])[idCol] || "").trim();
        if (!name) continue;
        const label = deCol >= 0 ? ((conf[r] || [])[deCol] || "").trim() : "";
        out.push({ name, label: label || name });
    }
    return out;
}
const STATS_AND_MISC = readNameSection(
    (h) => h.startsWith("statsAndMisc tracked ["),
    (h) => h === "statsAndMisc tracked DE",
);
const TRINKETS_AND_RACIALS = readSection(
    (h) => h.startsWith("trinketsAndRacials tracked ["),
    (h) => h === "trinketsAndRacials tracked DE",
);
const ENGINEERING = readSection(
    (h) => h.startsWith("engineering tracked ["),
    (h) => h === "engineering tracked DE",
);
const OTHER_CASTS = readSection(
    (h) => h.startsWith("otherCasts tracked ["),
    (h) => h === "otherCasts tracked DE",
);
const ABSORBS = readSection(
    (h) => h.startsWith("absorbs tracked ["),
    (h) => h === "absorbs tracked DE",
);

// --- section headings (German, from the header cells themselves) ----------
// e.g. "damageTaken DE {Vermeidbarer erhaltener Schaden ...}" -> the {} content
function sectionHeading(prefix) {
    for (const row of conf) {
        for (const cell of row) {
            const v = (cell || "").trim();
            if (v.startsWith(prefix + " DE")) {
                const m = v.match(/\{([^}]*)\}/);
                if (m) return m[1].trim();
            }
        }
    }
    return "";
}
const HEADINGS = {
    singleTargetCasts: sectionHeading("singleTargetCasts"),
    aoeCasts: sectionHeading("aoeCasts"),
    classCooldowns: sectionHeading("classCooldowns"),
    statsAndMisc: sectionHeading("statsAndMisc"),
    trinketsAndRacials: sectionHeading("trinketsAndRacials"),
    damageTaken: sectionHeading("damageTaken"),
    debuffs: sectionHeading("debuffs"),
    otherCasts: sectionHeading("otherCasts"),
    absorbs: sectionHeading("absorbs"),
    engineering: sectionHeading("engineering"),
    interrupts: sectionHeading("interrupts"),
};

// --- trash kill requirements ---------------------------------------------
// The validate*Log tabs list, per raid zone, how much trash a log must contain to
// count as a full clear. Column 1 carries the zone tag, column 3 the minimum and
// column 12 a human-readable requirement line that also carries the npc ids:
//     "- 20 Tidewalker Depth-Seer/... (ID: 21224,21225,21226,21227)"
const VALIDATE_FILES = [
    "validateKaraLog.csv",
    "validateSSCTKLog.csv",
    "validateMHBTLog.csv",
    "validateZALog.csv",
    "validateSWLog.csv",
];
const TRASH_REQUIREMENTS = {};
for (const file of VALIDATE_FILES) {
    const full = path.join(REF, "config", file);
    if (!fs.existsSync(full)) continue;
    const rows = parseCsv(full);
    for (const row of rows) {
        const zone = (row[1] || "").trim();
        const nameEn = (row[2] || "").trim();
        const min = (row[3] || "").trim();
        const nameDe = (row[5] || "").trim();
        const reqText = (row[12] || "").trim();
        if (!zone || !nameEn || !/^\d+$/.test(min)) continue;

        const ids = [];
        const idMatch = reqText.match(/\(ID:\s*([\d,\s]+)\)/);
        if (idMatch) {
            for (const tok of idMatch[1].split(",")) {
                const t = tok.trim();
                if (/^\d+$/.test(t)) ids.push(t);
            }
        } else {
            const single = (row[0] || "").trim();
            if (/^\d+$/.test(single)) ids.push(single);
        }
        if (ids.length === 0) continue;

        (TRASH_REQUIREMENTS[zone] || (TRASH_REQUIREMENTS[zone] = [])).push({
            name: nameEn,
            label: nameDe || nameEn,
            minimum: Number(min),
            ids,
        });
    }
}

// --- spell haste from gear ------------------------------------------------
const sh = parseCsv(path.join(REF, "spell_haste_config.csv"));
const SPELL_HASTE_ITEMS = {};
for (const row of sh) {
    const id = (row[0] || "").trim();
    const v = (row[1] || "").trim();
    if (/^\d+$/.test(id) && /^\d+$/.test(v)) SPELL_HASTE_ITEMS[id] = Number(v);
}

// --- icons ----------------------------------------------------------------
// Warcraft Logs carries an `abilityIcon` on most table rows, but not on all of
// them, and any report evaluated before that field was read carries none at all.
// The config knows every spell id, so the icon is resolved here — once, at build
// time — and baked into the generated file. The report is then independent of
// what an individual log happens to include.
//
// The mapping lives in reference/rpb/spell-icons.json so it is reviewable in git
// and a re-run costs no requests for anything already known.
const ICON_CACHE = path.join(REF, "spell-icons.json");

function loadIconCache() {
    try {
        return JSON.parse(fs.readFileSync(ICON_CACHE, "utf8"));
    } catch {
        return {};
    }
}

/**
 * Ids to try for an entry's icon, best first: highest rank before downranks.
 * Several are needed because some entries lead with a generic NPC-ability id that
 * neither database carries an icon for (e.g. "Cleave" starts at 797), while a
 * later id in the same entry resolves fine.
 */
function iconCandidatesOf(entry) {
    const lower = entry.lowerRankIds || [];
    const max = entry.ids.filter((id) => !lower.includes(id));
    return [...max, ...entry.ids.filter((id) => lower.includes(id))].slice(0, MAX_ICON_TRIES);
}
// Costs nothing for entries that resolve on the first try (the loop breaks); only
// the stubborn ones walk further. "Cleave" needs seven.
const MAX_ICON_TRIES = 10;

/** Every parsed entry across every section, so one pass covers them all. */
function allEntries() {
    const list = [];
    const push = (section) => { for (const e of section || []) list.push(e); };
    for (const cls of CLASSES) {
        push(SINGLE_TARGET_CASTS[cls]);
        push(AOE_CASTS[cls]);
        push(CLASS_COOLDOWNS[cls]);
    }
    push(DAMAGE_TAKEN);
    push(DEBUFFS);
    push(TRINKETS_AND_RACIALS);
    push(ENGINEERING);
    push(OTHER_CASTS);
    push(ABSORBS);
    return list;
}

// The TBC branch first: it is the era the RPB tracks, and Wowhead's retail
// database no longer knows a good third of these spell ids (old ranks, removed
// abilities). Retail is only the fallback, for the handful of ids TBC lacks.
const ICON_SOURCES = [
    "https://nether.wowhead.com/tbc/tooltip/spell/",
    "https://nether.wowhead.com/tooltip/spell/",
];

async function fetchSpellIcon(id) {
    const axios = require("axios");
    for (const base of ICON_SOURCES) {
        try {
            const { data } = await axios.get(`${base}${id}`, {
                timeout: 20000,
                headers: { "User-Agent": "Mozilla/5.0 (EventHelper build script)" },
            });
            if (data && data.icon) return String(data.icon).toLowerCase();
        } catch {
            // try the next branch
        }
    }
    return "";
}

async function resolveIcons() {
    const cache = loadIconCache();
    const entries = allEntries();

    let lookedUp = 0;
    let resolved = 0;
    const unresolved = [];
    for (const entry of entries) {
        for (const id of iconCandidatesOf(entry)) {
            if (cache[id] === undefined) {
                // Cache misses too: an id Wowhead does not know will not start
                // resolving on the next run, and re-querying it every time is waste.
                cache[id] = await fetchSpellIcon(id);
                lookedUp++;
                if (lookedUp % 50 === 0) console.log(`  icons: ${lookedUp} looked up`);
            }
            if (cache[id]) { entry.icon = cache[id]; break; }
        }
        if (entry.icon) resolved++;
        else unresolved.push(`${entry.name} [${entry.ids.slice(0, 3).join(",")}]`);
    }
    if (lookedUp) fs.writeFileSync(ICON_CACHE, `${JSON.stringify(cache)}\n`);

    return { entries: entries.length, resolved, lookedUp, unresolved };
}

// --- emit -----------------------------------------------------------------
function render() {
    return `// AUTO-GENERATED by scripts/build-rpb-data.js from reference/rpb/*.csv.
// Do not edit by hand; re-run the generator instead.
// Reference data for the WoW TBC "Role Performance Breakdown" (RPB) by Lars Maag / shariva.
//
// Entry shape: { name, label (German), ids: [spellId], icon?, lowerRankIds?, castTime?,
//                cooldown?, uptimeSeconds?, isUptime?, isOverheal? }

module.exports = {
    // Kalecgos is excluded from every RPB number (two-realm fight breaks the maths).
    EXCLUDED_ENCOUNTER_ID: 724,

    // TBC: 15.77 haste rating = 1% spell haste.
    HASTE_RATING_PER_PERCENT: 15.77,

    // Haste effects whose uses inflate the raw cast count. Each use saves roughly
    // \`seconds\` of cast time, which the RPB subtracts before computing activity.
    // ids + seconds are taken from the RPB Apps Script (RPB.js ~L1507-1522, L2609-2628).
    HASTE_BUFFS: [
        { key: "bloodlust", label: "Kampfrausch/Heldentum", ids: ["2825", "32182"], seconds: 9 },
        { key: "icyVeins", label: "Eisige Adern", ids: ["12472"], seconds: 3 },
        { key: "skull", label: "Schädel von Gul'dan", ids: ["40396"], seconds: 1.5 },
        { key: "berserking", label: "Berserker", ids: ["26635"], seconds: 0.5 },
        { key: "scrollOfBlindingLight", label: "Rolle des blendenden Lichts", ids: ["23733"], seconds: 3.1 },
        { key: "quagmirransEye", label: "Quagmirrans Auge", ids: ["33370", "33369"], seconds: 1 },
        { key: "scarabOfTheInfiniteCycle", label: "Skarabäus des unendlichen Zyklus", ids: ["33953"], seconds: 1 },
        { key: "mysticalSkyfireDiamond", label: "Mystischer Himmelsfeuerdiamant", ids: ["18803"], seconds: 0.6 },
        { key: "mindQuickeningGem", label: "Edelstein der Gedankenbeschleunigung", ids: ["23723"], seconds: 4.8 },
        { key: "bladeOfWizardry", label: "Klinge der Zauberei", ids: ["38317"], seconds: 0.9 },
    ],

    // German section headings taken from the config sheet itself.
    HEADINGS: ${JSON.stringify(HEADINGS, null, 8).replace(/\n/g, "\n    ")},

    // itemId -> spell haste rating (for the activity correction)
    SPELL_HASTE_ITEMS: ${JSON.stringify(SPELL_HASTE_ITEMS)},

    // zone tag -> trash that must be killed for the log to count as a full clear
    TRASH_REQUIREMENTS: ${JSON.stringify(TRASH_REQUIREMENTS)},

    // per-class tracked casts
    SINGLE_TARGET_CASTS: ${JSON.stringify(SINGLE_TARGET_CASTS)},
    AOE_CASTS: ${JSON.stringify(AOE_CASTS)},
    CLASS_COOLDOWNS: ${JSON.stringify(CLASS_COOLDOWNS)},

    // global tracked sections
    DAMAGE_TAKEN: ${JSON.stringify(DAMAGE_TAKEN)},
    DEBUFFS: ${JSON.stringify(DEBUFFS)},
    STATS_AND_MISC: ${JSON.stringify(STATS_AND_MISC)},
    TRINKETS_AND_RACIALS: ${JSON.stringify(TRINKETS_AND_RACIALS)},
    ENGINEERING: ${JSON.stringify(ENGINEERING)},
    OTHER_CASTS: ${JSON.stringify(OTHER_CASTS)},
    ABSORBS: ${JSON.stringify(ABSORBS)},
};
`;
}

async function main() {
    const icons = await resolveIcons();
    const outPath = path.join(ROOT, "src", "config", "rpbData.js");
    fs.writeFileSync(outPath, render());
    console.log("wrote", outPath);
    console.log({ icons });
    console.log({
        classes: Object.fromEntries(CLASSES.map((c) => [c, {
            st: SINGLE_TARGET_CASTS[c].length,
            aoe: AOE_CASTS[c].length,
            cd: CLASS_COOLDOWNS[c].length,
        }])),
        damageTaken: DAMAGE_TAKEN.length,
        debuffs: DEBUFFS.length,
        statsAndMisc: STATS_AND_MISC.length,
        trinketsAndRacials: TRINKETS_AND_RACIALS.length,
        engineering: ENGINEERING.length,
        otherCasts: OTHER_CASTS.length,
        absorbs: ABSORBS.length,
        spellHasteItems: Object.keys(SPELL_HASTE_ITEMS).length,
        trashRequirements: Object.fromEntries(
            Object.entries(TRASH_REQUIREMENTS).map(([z, l]) => [z, l.length]),
        ),
        headings: HEADINGS,
    });
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
