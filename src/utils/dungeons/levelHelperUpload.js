// Parser for the dungeon runs the WoW addon LevelHelper keeps and the sync tool
// (eventhelper-addon) uploads to POST /api/ingest/levelhelper.
//
// Wire format `levelhelper-runs` v1:
//
//   { format: "levelhelper-runs", v: 1,
//     versionId: "forever",                 game version of the install (config/gameVersions id)
//     guild: "Pulse",                       guild name as the addon stores it ("" = unknown)
//     uploader: { account: "405280973#1" },
//     runs: [{ id, dungeon, seconds, start, instance, medal, members: [{ guid, name, class }], at }],
//     characters: [{ guid, name, realm, class, level, points, count, golds, at }] }
//
// Times are unix seconds (Lua's time()). Everything is checked and a request
// with anything that does not fit is refused as a whole (400): the addon keeps
// its runs, so nothing is lost, and a half-read upload would hide the problem.
// The sync tool therefore leaves out what the server would refuse (a run under
// a minute, one without members). Unknown fields are ignored, so a newer addon
// that only adds fields still uploads; a higher `v` is refused.
const { rulesFor } = require("../../config/gameVersions");

const LH_FORMAT = "levelhelper-runs";
const LH_VERSION = 1;

/** Per request — the sync tool sends in batches of these. */
const MAX_RUNS = 500;
const MAX_CHARACTERS = 200;
/** A group run lasts at least a minute and at most four hours. */
const MIN_SECONDS = 60;
const MAX_SECONDS = 14400;
const MAX_MEMBERS = 5;
const MEDALS = ["gold", "silver", "bronze"];

const ID_MAX = 64;
const DUNGEON_MAX = 80;
const NAME_MAX = 48;
const REALM_MAX = 60;
const GUILD_MAX = 60;
const GUID_MAX = 64;
const ACCOUNT_MAX = 64;
const CLASS_MAX = 20;
const LEVEL_MAX = 100;
const POINTS_MAX = 1_000_000;
const COUNT_MAX = 100_000;
// unix seconds between 2001 and 2096: a time in ms or a 0 is a broken upload
const TIME_MIN = 1_000_000_000;
const TIME_MAX = 4_000_000_000;

class LevelHelperParseError extends Error {
    constructor(message) {
        super(message);
        this.name = "LevelHelperParseError";
    }
}

const fail = (where, what) => { throw new LevelHelperParseError(`${where}: ${what}`); };
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const missing = (v) => v === undefined || v === null;

/** A string of at most `max` characters (whitespace folded); `required` refuses "". */
function text(v, where, { max, required = false, allowNull = false } = {}) {
    if (missing(v)) {
        if (required) fail(where, "fehlt");
        if (!allowNull && v === null) fail(where, "darf nicht null sein");
        return "";
    }
    if (typeof v !== "string") fail(where, "muss Text sein");
    const s = v.replace(/\s+/g, " ").trim();
    if (required && !s) fail(where, "ist leer");
    if (s.length > max) fail(where, `ist länger als ${max} Zeichen`);
    return s;
}

/** A whole number in [min, max]. */
function int(v, where, { min, max }) {
    if (typeof v !== "number" || !Number.isInteger(v)) fail(where, "muss eine ganze Zahl sein");
    if (v < min || v > max) fail(where, `${v} liegt nicht zwischen ${min} und ${max}`);
    return v;
}

/** The addon's run id: a string, or a whole number (Lua may hand it over as one). */
function runId(v, where) {
    if (typeof v === "number" && Number.isInteger(v) && v >= 0) return String(v);
    return text(v, where, { max: ID_MAX, required: true });
}

/** WoW's class token ("PALADIN", "DEATHKNIGHT"); "" when the addon did not know it. */
function classToken(v, where) {
    const s = text(v, where, { max: CLASS_MAX, allowNull: true }).toUpperCase();
    if (s && !/^[A-Z_]+$/.test(s)) fail(where, "ist kein Klassen-Token");
    return s;
}

/** A guid as the addon shortens it; "" when it has none. */
function guid(v, where) {
    return text(v, where, { max: GUID_MAX, allowNull: true });
}

/** Who a member is, for comparing: the guid, else the lower-case name. */
function memberKey(m) {
    return m.guid ? `g:${m.guid}` : `n:${m.name.toLowerCase()}`;
}

function parseMember(raw, where) {
    if (!isObj(raw)) fail(where, "muss ein Objekt sein");
    return {
        guid: guid(raw.guid, `${where}.guid`),
        name: text(raw.name, `${where}.name`, { max: NAME_MAX, required: true }),
        class: classToken(raw.class, `${where}.class`),
    };
}

function parseRun(raw, where) {
    if (!isObj(raw)) fail(where, "muss ein Objekt sein");
    const seconds = raw.seconds;
    if (typeof seconds !== "number" || !Number.isFinite(seconds)) fail(`${where}.seconds`, "muss eine Zahl sein");
    if (seconds < MIN_SECONDS || seconds > MAX_SECONDS) fail(`${where}.seconds`, `${seconds} liegt nicht zwischen ${MIN_SECONDS} und ${MAX_SECONDS}`);
    const start = int(raw.start, `${where}.start`, { min: TIME_MIN, max: TIME_MAX });
    let instance = null;
    if (!missing(raw.instance)) instance = int(raw.instance, `${where}.instance`, { min: 0, max: 2_147_483_647 });
    let medal = null;
    if (!missing(raw.medal)) {
        if (!MEDALS.includes(raw.medal)) fail(`${where}.medal`, "muss gold, silver, bronze oder null sein");
        medal = raw.medal;
    }
    if (!Array.isArray(raw.members)) fail(`${where}.members`, "muss eine Liste sein");
    if (raw.members.length < 1 || raw.members.length > MAX_MEMBERS) fail(`${where}.members`, `braucht 1 bis ${MAX_MEMBERS} Mitglieder`);
    const members = [];
    const seen = new Set();
    raw.members.forEach((m, i) => {
        const member = parseMember(m, `${where}.members[${i}]`);
        const key = memberKey(member);
        if (!seen.has(key)) {
            seen.add(key);
            members.push(member);
        }
    });
    const at = missing(raw.at) ? start + Math.round(seconds) : int(raw.at, `${where}.at`, { min: TIME_MIN, max: TIME_MAX });
    return {
        id: runId(raw.id, `${where}.id`),
        dungeon: text(raw.dungeon, `${where}.dungeon`, { max: DUNGEON_MAX, required: true }),
        seconds: Math.round(seconds),
        start,
        instance,
        medal,
        members,
        at,
    };
}

function parseCharacter(raw, where) {
    if (!isObj(raw)) fail(where, "muss ein Objekt sein");
    const count = (v, field, max) => (missing(v) ? 0 : int(v, `${where}.${field}`, { min: 0, max }));
    return {
        guid: guid(raw.guid, `${where}.guid`),
        name: text(raw.name, `${where}.name`, { max: NAME_MAX, required: true }),
        realm: text(raw.realm, `${where}.realm`, { max: REALM_MAX, allowNull: true }),
        class: classToken(raw.class, `${where}.class`),
        level: count(raw.level, "level", LEVEL_MAX),
        points: count(raw.points, "points", POINTS_MAX),
        count: count(raw.count, "count", COUNT_MAX),
        golds: count(raw.golds, "golds", COUNT_MAX),
        at: int(raw.at, `${where}.at`, { min: TIME_MIN, max: TIME_MAX }),
    };
}

/** A list field: missing = empty, anything but a list or more than `max` entries is refused. */
function list(v, where, max) {
    if (missing(v)) return [];
    if (!Array.isArray(v)) fail(where, "muss eine Liste sein");
    if (v.length > max) fail(where, `höchstens ${max} Einträge je Upload (${v.length} gesendet)`);
    return v;
}

/**
 * The checked upload, or a LevelHelperParseError naming the first field that
 * does not fit ("runs[3].seconds: 30 liegt nicht zwischen 60 und 14400").
 * @returns {{ versionId: string, guild: string, account: string,
 *   runs: { id, dungeon, seconds, start, instance, medal, members: { guid, name, class }[], at }[],
 *   characters: { guid, name, realm, class, level, points, count, golds, at }[] }}
 */
function parseLevelHelperUpload(body) {
    if (!isObj(body)) fail("Upload", "kein JSON-Objekt");
    if (body.format !== LH_FORMAT) fail("format", `muss „${LH_FORMAT}“ sein`);
    if (typeof body.v !== "number" || !Number.isInteger(body.v) || body.v < 1) fail("v", "muss eine ganze Zahl ab 1 sein");
    if (body.v > LH_VERSION) fail("v", `Version ${body.v} ist neuer als dieser Server (${LH_VERSION}) – EventHelper aktualisieren`);
    const versionId = text(body.versionId, "versionId", { max: 30, required: true });
    if (!rulesFor(versionId)) fail("versionId", `„${versionId}“ ist keine bekannte Spielversion`);
    if (!missing(body.uploader) && !isObj(body.uploader)) fail("uploader", "muss ein Objekt sein");
    const account = text(isObj(body.uploader) ? body.uploader.account : "", "uploader.account", { max: ACCOUNT_MAX, allowNull: true });
    return {
        versionId,
        guild: text(body.guild, "guild", { max: GUILD_MAX, allowNull: true }),
        account,
        runs: list(body.runs, "runs", MAX_RUNS).map((r, i) => parseRun(r, `runs[${i}]`)),
        characters: list(body.characters, "characters", MAX_CHARACTERS).map((c, i) => parseCharacter(c, `characters[${i}]`)),
    };
}

module.exports = {
    LH_FORMAT, LH_VERSION, MAX_RUNS, MAX_CHARACTERS, MIN_SECONDS, MAX_SECONDS, MAX_MEMBERS, MEDALS,
    LevelHelperParseError, parseLevelHelperUpload, memberKey,
};
