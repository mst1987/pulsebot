// Pure raid-setup → Google-Sheets logic, extracted from the /fillsetup command so
// it can be reused by the web admin menu (fill any configured raidsheet per event).
// This module never touches Discord or the network directly: buildSetupWrite() is a
// pure transform, and fillSetupSheet() takes an already-constructed SheetsClient.

const classlist = require("../config/classlist");

// Build reverse lookup: both by key ("Destro") and by spec field ("Destruction")
const SPEC_LOOKUP = {};
for (const [key, val] of Object.entries(classlist)) {
    SPEC_LOOKUP[key] = val;
    if (val.spec) SPEC_LOOKUP[val.spec] = val;
}

// WoW class colors (RGB 0–1)
const CLASS_COLORS = {
    "Warrior": { red: 0.780, green: 0.612, blue: 0.431 },  // #C79C6E
    "Paladin": { red: 0.961, green: 0.549, blue: 0.729 },  // #F58CBA
    "Hunter":  { red: 0.671, green: 0.831, blue: 0.451 },  // #ABD473
    "Rogue":   { red: 1.000, green: 0.961, blue: 0.412 },  // #FFF569
    "Priest":  { red: 1.000, green: 1.000, blue: 1.000 },  // #FFFFFF
    "Shaman":  { red: 0.000, green: 0.439, blue: 0.871 },  // #0070DE
    "Mage":    { red: 0.412, green: 0.800, blue: 0.941 },  // #69CCF0
    "Warlock": { red: 0.580, green: 0.510, blue: 0.788 },  // #9482C9
    "Druid":   { red: 1.000, green: 0.490, blue: 0.039 },  // #FF7D0A
    "DK":      { red: 0.769, green: 0.122, blue: 0.231 },  // #C41F3B
    "Tank":    { red: 0.780, green: 0.612, blue: 0.431 },  // Warrior-Farbe für generische Tanks
};

// Icon-level overrides for specs where clazz is "Tank" but the real class differs
const ICON_COLOR_OVERRIDES = {
    "protpala": CLASS_COLORS["Paladin"],
    "blooddk":  CLASS_COLORS["DK"],
};

function getClassColor(entry) {
    if (!entry) return null;
    return ICON_COLOR_OVERRIDES[entry.icon] || CLASS_COLORS[entry.clazz] || null;
}

// ---- Role detection via classlist.js icon / sodclazz / clazz ----
const isProtPala         = (e) => e?.icon === "protpala";
const isGuardian         = (e) => e?.icon === "guardian";
const isHolyPala         = (e) => e?.icon === "holypala";
const isRestoSham        = (e) => e?.icon === "restosham";
// "restoration" is the druid icon — the shaman one is "restosham".
const isRestoDruid       = (e) => e?.icon === "restoration";
const isElemental        = (e) => e?.icon === "elemental";
const isHolyOrDiscPriest = (e) => e?.icon === "holypriest" || e?.icon === "discipline";
const isHealer           = (e) => e?.sodclazz === "Healer";
const isWarlock          = (e) => e?.clazz === "Warlock";
const isAffliction       = (e) => e?.icon === "affliction";
const isPriest           = (e) => e?.clazz === "Priest";
const isMage             = (e) => e?.clazz === "Mage";
const isHunter           = (e) => e?.clazz === "Hunter";
const isRogue            = (e) => e?.clazz === "Rogue";
const isShadow           = (e) => e?.icon === "shadow";
const isBalance          = (e) => e?.icon === "balance";
const isFeral            = (e) => e?.icon === "feral";
const isSurvival         = (e) => e?.icon === "survival";
const isArms             = (e) => e?.icon === "arms";
const isFury             = (e) => e?.icon === "fury";
const isWarrior          = (e) => e?.clazz === "Warrior";
const isEnhancement      = (e) => e?.icon === "enhancement";

function getClassEntry(specName) {
    return specName ? (SPEC_LOOKUP[specName] || null) : null;
}

function getSlotName(slot) {
    return slot.name || slot.charName || slot.characterName || "";
}

function getSlotSpec(slot) {
    return slot.specName || slot.spec || slot.className || "";
}

// Raid group of a slot. Raid-Helper's raidplan API names the field
// `groupNumber`; `group` only appears on hand-built payloads. Without that
// fallback the index heuristic below takes over, and since it assumes five
// players per group, a single non-full group shifts everyone behind it into
// the wrong one.
function getSlotGroup(slot, index) {
    for (const value of [slot.group, slot.groupNumber]) {
        const n = typeof value === "number" ? value : parseInt(value, 10);
        if (Number.isInteger(n) && n >= 1) return n;
    }
    return Math.floor(index / 5) + 1;
}

// Pick healers in priority order, tracking used names. Each slot has a wanted
// spec (slot 2 is the resto druid, slot 4 the priest — that is how the raid
// leader arranges the healer column by hand); when nobody of that spec signed
// up the slot falls back to the next unused healer instead of staying empty.
const HEALER_SLOT_SPECS = [
    isHolyPala,
    isRestoDruid,
    isRestoSham,
    isHolyOrDiscPriest,
    null,
];

function buildHealerSlots(healers) {
    const used = new Set();

    function next(fn) {
        const h = healers.find((h) => (!fn || fn(h.entry)) && !used.has(h.name));
        if (h) used.add(h.name);
        return h || null;
    }

    // Two passes: every slot first gets its wanted spec, only then are the
    // leftovers handed out. A single pass would let slot 1's fallback eat the
    // resto druid that slot 2 is waiting for.
    const slots = HEALER_SLOT_SPECS.map((fn) => (fn ? next(fn) : null));
    return slots.map((player) => player || next());
}

// Columns that only some raidsheets have. They are found by their header text
// in row 26 rather than hard-coded, so a sheet without the header (the Tier 4/5
// one has neither) simply doesn't get them written, and moving the column in
// the sheet needs no code change.
const HEADER_ROW = 26;
const OPTIONAL_COLUMN_HEADERS = {
    spellkicks: "spellkicks",
    decurse: "decurse",
};

/** A1 column letter for a zero-based index (A..Z — the range we scan). */
function columnLetter(index) {
    return String.fromCharCode(65 + index);
}

/**
 * Map the header row (values from column A onwards) to column letters:
 * ["", …, "SpellKicks", …, "Decurse"] → { spellkicks: "F", decurse: "K" }.
 * The first match wins; unknown headers are ignored.
 */
function resolveOptionalColumns(headerValues) {
    const found = {};
    (headerValues || []).forEach((value, i) => {
        if (i > 25) return;
        const header = String(value || "").trim().toLowerCase();
        for (const [key, wanted] of Object.entries(OPTIONAL_COLUMN_HEADERS)) {
            if (header === wanted && !found[key]) found[key] = columnLetter(i);
        }
    });
    return found;
}

// Build a column of `rows` player slots, padding with null
function toColumn(players, rows) {
    const result = [];
    for (let i = 0; i < rows; i++) result.push(players[i] || null);
    return result;
}

// Build write values for a column
function columnEntries(playerSlots) {
    return playerSlots.map((p) => [p ? p.name : ""]);
}

// Single cell value
function singleEntry(player) {
    return [[player ? player.name : ""]];
}

// Enrich raw Raidhelper slots into { name, group, entry } player objects.
function enrichPlayers(slots) {
    return (slots || [])
        .filter((s) => getSlotName(s))
        .map((s, i) => ({
            name:  getSlotName(s),
            group: getSlotGroup(s, i),
            entry: getClassEntry(getSlotSpec(s)),
        }));
}

/**
 * Turn Raidhelper setup slots into the Google-Sheets batch payload.
 * Pure and deterministic except for the two random tie-breaks kept from the
 * original command (corruption warlock + SS-target healer order).
 *
 * @param {Array} slots  raw Raidhelper raidplan slots
 * @param {object} opts  { tab = "Setup", tank3 = "" }
 * @returns {{ writeData: Array, clearRanges: string[], playerColors: Array, summary: object }}
 */
function buildSetupWrite(slots, opts = {}) {
    const tab = opts.tab || process.env.GOOGLE_SHEET_NAME || "Setup";
    const tank3 = opts.tank3 || "";

    const players = enrichPlayers(slots);

    // ---- Groups ----
    const groups = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    for (const p of players) {
        if (p.group >= 1 && p.group <= 5) groups[p.group].push(p);
    }

    // ---- Role filters ----
    const protPalas   = players.filter((p) => isProtPala(p.entry));
    const guardians   = players.filter((p) => isGuardian(p.entry));
    const healers     = players.filter((p) => isHealer(p.entry));
    const warlocks    = players.filter((p) => isWarlock(p.entry));
    const afflWLs     = players.filter((p) => isAffliction(p.entry));
    const priests     = players.filter((p) => isPriest(p.entry));
    const mages       = players.filter((p) => isMage(p.entry));
    const hunters     = players.filter((p) => isHunter(p.entry));
    const rogues        = players.filter((p) => isRogue(p.entry));
    const shadowPriests = players.filter((p) => isShadow(p.entry));
    const enhancers   = players.filter((p) => isEnhancement(p.entry));
    const warriors    = players.filter((p) => isWarrior(p.entry));
    const armsWarrs   = players.filter((p) => isArms(p.entry));
    const furyWarrs   = players.filter((p) => isFury(p.entry));
    const balDruids   = players.filter((p) => isBalance(p.entry));
    const feralDruids = players.filter((p) => isFeral(p.entry));
    const survHunters = players.filter((p) => isSurvival(p.entry));
    const eleShamans  = players.filter((p) => isElemental(p.entry));
    const restoDruids = players.filter((p) => isRestoDruid(p.entry));

    // ---- Debuffs (row 22) ----
    const afflWL  = afflWLs[0] || null;
    const otherWLs = warlocks.filter((p) => p !== afflWL);
    const corWL   = otherWLs.length
        ? otherWLs[Math.floor(Math.random() * otherWLs.length)]
        : null;
    const d22 = shadowPriests[0] || null;
    const e22 = rogues[0] || null;
    const f22 = balDruids[0] || feralDruids[0] || null;
    const g22 = survHunters[0] || null;
    // H22: Arms else Fury; I22: Fury (different player if H22 already used one)
    const h22 = armsWarrs[0] || furyWarrs[0] || null;
    const i22 = armsWarrs.length > 0 ? (furyWarrs[0] || null) : (furyWarrs[1] || null);

    // ---- Healer slots C11-C15 ----
    const healerSlotPlayers = buildHealerSlots(healers);

    // ---- SS Targets H27-H31 ----
    const shuffledHealers = [...healers].sort(() => Math.random() - 0.5);
    const ssPlayers = [
        protPalas[0] || null,
        guardians[0] || null,
        shuffledHealers[0] || null,
        shuffledHealers[1] || null,
        shuffledHealers[2] || null,
    ];

    // ---- Kick column D27:D31 (Rogues → Warriors → Enhancers, max 5) ----
    // That order is the raid's kick priority: Kick first, then Pummel/Shield
    // Bash, Earth Shock last.
    const meleeCol = toColumn([...rogues, ...warriors, ...enhancers], 5);

    // ---- Build write data ----
    const R = (range, values) => ({ range: `${tab}!${range}`, values });

    const writeData = [
        // Groups
        R("B3:B7",   columnEntries(toColumn(groups[1], 5))),
        R("C3:C7",   columnEntries(toColumn(groups[2], 5))),
        R("D3:D7",   columnEntries(toColumn(groups[3], 5))),
        R("E3:E7",   columnEntries(toColumn(groups[4], 5))),
        R("F3:F7",   columnEntries(toColumn(groups[5], 5))),
        // Tanks
        R("B11",     singleEntry(protPalas[0] || null)),
        R("B12",     singleEntry(guardians[0] || null)),
        R("B13",     [[tank3]]),
        // Healers
        R("C11:C15", columnEntries(healerSlotPlayers)),
        // Debuffs row 22
        R("B22",     singleEntry(afflWL)),
        R("C22",     singleEntry(corWL)),
        R("D22",     singleEntry(d22)),
        R("E22",     singleEntry(e22)),
        R("F22",     singleEntry(f22)),
        R("G22",     singleEntry(g22)),
        R("H22",     singleEntry(h22)),
        R("I22",     singleEntry(i22)),
        // Class blocks
        R("B27:B29", columnEntries(toColumn(priests, 3))),
        R("C27:C29", columnEntries(toColumn(mages, 3))),
        R("D27:D31", columnEntries(meleeCol)),
        R("E27:E30", columnEntries(toColumn(hunters, 4))),
        R("G27:G31", columnEntries(toColumn(warlocks, 5))),
        R("H27:H31", columnEntries(ssPlayers)),
    ];

    // ---- Optional columns (only where the sheet carries the header) ----
    // SpellKicks: elemental shamans first (Wind Shock), then mages (Counterspell).
    // Decurse: mages first (Remove Curse), then the druids (Abolish Curse).
    const columns = opts.columns || {};
    if (columns.spellkicks) {
        const col = columns.spellkicks;
        writeData.push(R(`${col}27:${col}31`, columnEntries(toColumn([...eleShamans, ...mages], 5))));
    }
    if (columns.decurse) {
        const col = columns.decurse;
        writeData.push(R(`${col}27:${col}31`, columnEntries(toColumn([...mages, ...restoDruids, ...balDruids], 5))));
    }

    // ---- Player → class color map for conditional formatting ----
    const playerColors = [...new Map(
        players
            .filter((p) => getClassColor(p.entry))
            .map((p) => [p.name, { name: p.name, color: getClassColor(p.entry) }])
    ).values()];

    const summary = {
        playerCount: players.length,
        tanks: [protPalas[0]?.name || "?", guardians[0]?.name || "?", tank3 || "(leer)"],
        healers: healers.length,
        warlocks: warlocks.length,
        priests: priests.length,
        mages: mages.length,
        hunters: hunters.length,
    };

    return { writeData, clearRanges: [`${tab}!D11:G15`], playerColors, summary };
}

/**
 * Read row 26 of the sheet and resolve the optional columns from its headers.
 * Never throws: an unreadable sheet (old client, no permission, network) just
 * means no optional columns, i.e. exactly the pre-existing behaviour.
 */
async function readOptionalColumns(sheetsClient, tab) {
    if (typeof sheetsClient.readRange !== "function") return {};
    try {
        const rows = await sheetsClient.readRange(`${tab}!A${HEADER_ROW}:Z${HEADER_ROW}`);
        return resolveOptionalColumns((rows && rows[0]) || []);
    } catch (e) {
        console.log(`[fillSetup] Header-Zeile nicht lesbar, optionale Spalten übersprungen: ${e.message}`);
        return {};
    }
}

/**
 * Fill a raidsheet from Raidhelper setup slots using an already-constructed
 * SheetsClient. Clears the manual-tank block, writes the setup, then applies
 * class-colour conditional formatting. Guarded by a hard timeout so a hung
 * Sheets API call can't wedge the caller.
 *
 * @param {object} sheetsClient  instance of classes/sheets.js SheetsClient
 * @param {Array}  slots         raw Raidhelper raidplan slots
 * @param {object} opts          { tab, tank3, columns, timeoutMs = 150000 }
 * @returns {Promise<object>} the summary from buildSetupWrite
 */
async function fillSetupSheet(sheetsClient, slots, opts = {}) {
    const tab = opts.tab || process.env.GOOGLE_SHEET_NAME || "Setup";
    const timeoutMs = opts.timeoutMs || 150000;

    let timeoutId;
    let summary;
    try {
        await Promise.race([
            (async () => {
                // Which optional columns this sheet has can only be answered by
                // the sheet itself, so the header row is read before building
                // the payload. Best-effort: a sheet we can't read is filled the
                // way it always was, rather than not at all.
                const columns = opts.columns || await readOptionalColumns(sheetsClient, tab);
                const built = buildSetupWrite(slots, { ...opts, tab, columns });
                summary = built.summary;

                await Promise.all([
                    sheetsClient.batchClear(built.clearRanges),
                    sheetsClient.batchWrite(built.writeData),
                ]);
                const playerColors = built.playerColors;
                await sheetsClient.applyConditionalFormatting(playerColors);
            })(),
            new Promise((_, reject) => {
                timeoutId = setTimeout(
                    () => reject(new Error(`Timeout nach ${Math.round(timeoutMs / 1000)}s — Sheets API antwortet nicht`)),
                    timeoutMs
                );
            }),
        ]);
    } finally {
        // Clear the race timeout so it doesn't keep the process alive when the
        // Sheets work wins the race.
        clearTimeout(timeoutId);
    }

    return summary;
}

module.exports = {
    enrichPlayers,
    buildSetupWrite,
    fillSetupSheet,
    resolveOptionalColumns,
    getClassColor,
    CLASS_COLORS,
};
