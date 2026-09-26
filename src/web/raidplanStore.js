// The raid plan of an own event ("Raidplan"): per boss a board with player
// tokens on a room map, target rows with assigned players, and a note.
//
// One plan per event, stored in data/settings/raidplans.json:
//   { eventId, version, status: "draft" | "published", publicToken,
//     templateId, bosses: { [bossKey]: board } }
// A board (raidplanBoard.js) holds tokens, slots, marks, zones, target rows, a note and profileId.
// templateId names the raid plan template that was copied in (a snapshot, no live link).
// profileId names the tactic profile (raidplanProfileStore.js) the rows were taken
// from; the rows themselves are copies, the assignment (userIds) lives only here.
//
// - Players are only ever a userId. Name, class, spec and role come from the
//   event's setup at read time (raidplan.js) and are never copied in here.
// - x/y are relative to the board (0..1), so a plan looks the same on any screen.
// - `version` bumps on every save; a save carrying an older version is refused
//   (optimistic concurrency, two orga members editing the same plan).
// - `publicToken` is what /p/<token> is read with. It is minted the first time
//   the plan is published and stays while the plan is unpublished (the link then
//   just does not answer); rotating it kills the old link for good.
// - Room maps are files in data/raidplan-maps/, one per boss key or per instance
//   (the fallback of all its bosses). Nothing here fetches a picture from
//   anywhere: the orga uploads them.
const fs = require("fs");
const path = require("path");
const { dataPath, settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");
const crypto = require("crypto");
const { instanceById } = require("../config/gameVersions");
const { ZONES } = require("../config/bosses");
const { wowIconUrl } = require("../config/menu");

const DEFAULT_FILE = settingsPath("raidplans.json");
const DEFAULT_MAP_DIR = dataPath("raidplan-maps");

const board = require("./raidplanBoard");
const inherit = require("./raidplanInherit");
const { str } = require("../utils/text");
const { isSnowflake } = require("../utils/ids");

const LIMITS = { ...board.LIMITS, mapBytes: 3 * 1024 * 1024 };

let mapDir = DEFAULT_MAP_DIR;

const store = createJsonStore({
    file: DEFAULT_FILE,
    defaults: () => [],
    normalize: (data) => (Array.isArray(data.plans) ? data.plans : []),
});

/** Tests point the store (and the map folder) somewhere of their own. */
function useFile(file, dir) {
    store.useFile(file);
    mapDir = dir || (file ? path.join(path.dirname(file), "raidplan-maps") : DEFAULT_MAP_DIR);
}


// ---- bosses of an event ------------------------------------------------------

const slug = (name) => str(name).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

const ICON_ID_BY_NAME = new Map();
for (const zone of ZONES) {
    for (const enc of zone.encounters || []) ICON_ID_BY_NAME.set(slug(enc.name), Number(enc.id));
}

// bosses the rule set names differently than Warcraft Logs does (the boss key stays the rule set's, only the picture is looked up by
// the WCL name): "Reliquary of the Lost" is WCL's encounter 606 "Reliquary of Souls" (docs/raidplan.md, "Section bar and boss icons")
const ICON_NAME_ALIASES = { "reliquary-of-the-lost": "reliquary-of-souls" };

/** The boss picture of a name (`/bosses/<id>.jpg`), "" when WCL does not know the encounter. */
function bossIconByName(name) {
    const key = slug(name);
    const id = ICON_ID_BY_NAME.get(ICON_NAME_ALIASES[key] || key);
    return id ? `/bosses/${id}.jpg` : "";
}

/** The stable key of one boss: `<instanceId>/<name slug>`. */
function bossKeyOf(instanceId, name) {
    return `${instanceId}/${slug(name)}`;
}

/**
 * The bosses of the instances an event is set to, in raid order:
 * `{ key, instanceId, instanceName, name, iconUrl, instanceIcon }`. Two entries that are
 * no boss come with them: "Trash" (`trash: true`, key `<instance>/trash`) after the bosses of
 * each instance — a board of its own for the pulls — and "Allgemein" (`general: true`, key
 * `general`) once at the end: the assignments of the whole raid.
 */
function bossesForInstances(instanceIds) {
    const out = [];
    const seen = new Set();
    for (const id of Array.isArray(instanceIds) ? instanceIds : []) {
        const inst = instanceById(id);
        if (!inst) continue;
        for (const name of inst.bosses || []) {
            const key = bossKeyOf(inst.id, name);
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
                key, instanceId: inst.id, instanceName: inst.name, name,
                iconUrl: bossIconByName(name) || wowIconUrl(inst.icon, 56),
            });
        }
        if (!seen.has(`${inst.id}/trash`)) seen.add(`${inst.id}/trash`);
        else continue;
        out.push({
            key: `${inst.id}/trash`, instanceId: inst.id, instanceName: inst.name, name: "Trash", trash: true,
            iconUrl: wowIconUrl("inv_misc_bone_humanskull_01", 56),
        });
    }
    // "Allgemein" (the raid-wide assignments) comes FIRST, before the bosses and the trash
    if (out.length) {
        out.unshift({ key: GENERAL_KEY, instanceId: "", instanceName: "", name: "Allgemein", general: true, iconUrl: wowIconUrl("inv_misc_note_01", 56) });
    }
    return out;
}

const GENERAL_KEY = "general";
const BOSS_KEY = /^([a-z0-9]+)\/([a-z0-9-]+)$/;

function isBossKey(k) {
    const m = k.match(BOSS_KEY);
    if (!m) return false;
    const inst = instanceById(m[1]);
    return !!inst && (m[2] === "trash" || (inst.bosses || []).some((b) => slug(b) === m[2]));
}

/**
 * Whether a map key is well formed and names a real place:
 *   <instance>                     the default map of an instance
 *   <instance>/<boss>              the default map of a boss
 *   t/<templateId>/<instance>/<boss>   a template's own map of that boss
 *   e/<eventId>/<instance>/<boss>      one event plan's own map of that boss
 * Whether the template / event exists is the caller's question (the route asks).
 */
function isMapKey(key) {
    const k = str(key);
    if (/^[a-z0-9]+$/.test(k)) return !!instanceById(k);
    if (isBossKey(k)) return true;
    const m = k.match(/^([te])\/([a-z0-9-]{3,40})\/(.+)$/);
    return !!m && isBossKey(m[3]);
}

/** The template / event a scoped map key belongs to: `{ scope: "t" | "e", id }`, or null for a default map. */
function mapScope(key) {
    const m = str(key).match(/^([te])\/([a-z0-9-]{3,40})\//);
    return m ? { scope: m[1], id: m[2] } : null;
}

const templateMapKey = (templateId, bossKey) => `t/${templateId}/${bossKey}`;
const eventMapKey = (eventId, bossKey) => `e/${eventId}/${bossKey}`;

// ---- persistence ---------------------------------------------------------------

function readAll() {
    return store.read();
}

function writeAll(plans) {
    store.write({ plans });
}

function newToken() {
    return crypto.randomBytes(18).toString("base64url");
}

/**
 * The switch of a Raid-Helper event's plan (docs/raidplan.md, "Raid-Helper-Events"): a Raid-Helper event has no instance, size or game
 * version of its own, so the plan record carries them - taken from the title when the orga switched the plan on and corrected there.
 * null for an own event (its event record says all this) and for anything that is not such a switch.
 */
function normalizeLink(raw) {
    const r = raw && typeof raw === "object" ? raw : null;
    if (!r || r.source !== "raidhelper") return null;
    const ids = Array.isArray(r.instanceIds) ? [...new Set(r.instanceIds.map(str).filter((id) => !!instanceById(id)))].slice(0, 6) : [];
    const size = Math.floor(Number(r.size) || 0);
    const composition = r.composition && typeof r.composition === "object" && !Array.isArray(r.composition)
        ? Object.fromEntries(["tank", "healer", "melee", "ranged"].filter((k) => Number.isFinite(Number(r.composition[k]))).map((k) => [k, Math.max(0, Math.min(40, Math.floor(Number(r.composition[k]))))]))
        : null;
    return {
        source: "raidhelper",
        enabled: r.enabled === true,
        instanceIds: ids,
        versionId: /^[a-z0-9-]{2,20}$/.test(str(r.versionId)) ? str(r.versionId) : "tbc",
        size: size >= 1 && size <= 40 ? size : 0,
        composition: composition && Object.keys(composition).length ? composition : null,
        title: str(r.title).slice(0, 120),
        guildId: isSnowflake(str(r.guildId)) ? str(r.guildId) : "",
        startTime: Math.max(0, Math.floor(Number(r.startTime) || 0)),
        changedAt: Number(r.changedAt) || 0,
        changedBy: str(r.changedBy),
    };
}

/**
 * Who the players of a Raid-Helper plan were the last time its line-up was loaded: `{ [userId]: { character, spec, rhName } }`. A raider
 * Raid-Helper no longer lists keeps his places and shows under this name ("nicht mehr im Setup") until the next save with a loaded
 * line-up drops him. Only for players the plan names; nothing else is kept.
 */
function normalizeKnown(raw) {
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    for (const [uid, p] of Object.entries(raw).slice(0, 200)) {
        if (!/^[\w-]{1,40}$/.test(uid) || !p || typeof p !== "object") continue;
        out[uid] = { character: str(p.character).slice(0, 40), spec: str(p.spec).slice(0, 40), rhName: str(p.rhName).slice(0, 40), group: Math.max(0, Math.min(20, Math.floor(Number(p.group) || 0))) };
    }
    return out;
}

/** A plan as it is stored: every field present, nothing else. */
function normalizePlan(raw, eventId) {
    const r = raw && typeof raw === "object" ? raw : {};
    return {
        eventId: str(eventId || r.eventId),
        version: Math.max(0, Math.floor(Number(r.version) || 0)),
        status: r.status === "published" ? "published" : "draft",
        publicToken: /^[A-Za-z0-9_-]{16,64}$/.test(str(r.publicToken)) ? str(r.publicToken) : "",
        templateId: /^[a-f0-9]{6,24}$/.test(str(r.templateId)) ? str(r.templateId) : "",
        bosses: r.bosses && typeof r.bosses === "object" ? r.bosses : {},
        updatedAt: Number(r.updatedAt) || 0,
        updatedBy: str(r.updatedBy),
        link: normalizeLink(r.link),
        known: normalizeKnown(r.known),
    };
}

/**
 * The userIds a plan's bosses name anywhere: tokens and slots (`userId`), `user:` references in rows and steps, player targets, a row's
 * picks, flex roles (keys of `roles`) and lists of `users`. A walk over the stored boards, so a new place a player can stand is found too
 * as long as it uses one of these shapes.
 */
function playersOf(bosses) {
    const ids = new Set();
    const add = (u) => { if (typeof u === "string" && /^[\w-]{1,40}$/.test(u)) ids.add(u); };
    const walk = (v, depth) => {
        if (depth > 8 || !v || typeof v !== "object") return;
        if (Array.isArray(v)) {
            for (const x of v) {
                if (typeof x === "string" && x.startsWith("user:")) add(x.slice(5));
                else walk(x, depth + 1);
            }
            return;
        }
        if (v.kind === "player") add(v.ref);
        for (const [k, x] of Object.entries(v)) {
            if (k === "userId") add(x);
            else if (k === "picks" && x && typeof x === "object") Object.values(x).forEach(add);
            else if (k === "roles" && x && typeof x === "object" && !Array.isArray(x)) Object.keys(x).forEach(add);
            else if (k === "users" && Array.isArray(x)) x.forEach(add);
            else if (typeof x === "string" && x.startsWith("user:")) add(x.slice(5));
            else walk(x, depth + 1);
        }
    };
    walk(bosses, 0);
    return ids;
}

/**
 * The `known` line-up of a plan after a save with a loaded one (`roster`: [{ userId, character, spec, rhName, group }]): the whole
 * loaded line-up (a Raid-Helper that is switched off or down later still shows it, "gespeicherter Stand"), plus the raiders the plan
 * names that it no longer lists, under the name they had (until they are dropped from the plan).
 */
function knownAfter(bosses, roster, before = {}) {
    const out = {};
    for (const p of (roster || []).filter((x) => x && !x.gone)) {
        const uid = str(p.userId);
        if (uid) out[uid] = { character: str(p.character || p.name), spec: str(p.spec), rhName: str(p.rhName), group: Number(p.group) || 0 };
    }
    for (const uid of playersOf(bosses)) if (!out[uid] && before[uid]) out[uid] = before[uid];
    return normalizeKnown(out);
}

/** The plan of an event, or null when none was saved yet. */
function getPlan(eventId) {
    const id = str(eventId);
    const hit = readAll().find((p) => p && p.eventId === id);
    return hit ? normalizePlan(hit, id) : null;
}

/** The published plan behind a public token, or null. Unpublished plans never answer. */
function getPublishedByToken(token) {
    const t = str(token);
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(t)) return null;
    const hit = readAll().find((p) => p && p.publicToken === t && p.status === "published");
    return hit ? normalizePlan(hit) : null;
}

/** An empty plan for an event that has none (nothing is written). */
function emptyPlan(eventId) {
    return normalizePlan({}, eventId);
}

// ---- validation ------------------------------------------------------------------

/**
 * Cleans the bosses of a save. Only boss keys the event has are kept; on each
 * board (raidplanBoard.cleanBoard) players only for `allowedUserIds` (a raider who
 * left the setup drops out instead of blocking every later save), coordinates
 * clamped, texts cut. Returns `{ bosses, dropped }`, or `{ code: "invalid", error }`
 * for a body that is not a plan at all or a board over a limit.
 */
function cleanBosses(input, { bossKeys, allowedUserIds, profileIds = [] }) {
    if (input === undefined || input === null || typeof input !== "object" || Array.isArray(input)) {
        return { code: "invalid", error: "Der Raidplan hat ein ungültiges Format." };
    }
    const keys = new Set(bossKeys);
    const out = {};
    let dropped = 0;
    for (const [key, raw] of Object.entries(input)) {
        // A boss the event no longer has (its instances changed) is dropped, not an error.
        if (!keys.has(key)) { dropped += 1; continue; }
        const r = board.cleanBoard(raw, { allowedUserIds, profileIds });
        if (r.error) return r;
        dropped += r.dropped;
        // A boss nobody touched is not stored at all.
        if (board.boardHasContent(r.board)) out[key] = r.board;
    }
    return { bosses: out, dropped };
}

/**
 * Saves the bosses of an event's plan. `version` must be the one the caller read:
 * anything else is a `conflict` (someone saved in between). Creates the plan on
 * the first save. Returns `{ plan, dropped }` or `{ code, error }`.
 */
function savePlan(eventId, { version, bosses }, { bossKeys, allowedUserIds, profileIds, userId, knownRoster = null, now = Date.now() }) {
    const id = str(eventId);
    const plans = readAll();
    const idx = plans.findIndex((p) => p && p.eventId === id);
    const current = idx === -1 ? emptyPlan(id) : normalizePlan(plans[idx], id);
    if (Number(version) !== current.version) {
        return { code: "conflict", error: "Der Raidplan wurde inzwischen geändert. Bitte neu laden." };
    }
    const cleaned = cleanBosses(bosses, { bossKeys, allowedUserIds, profileIds });
    if (cleaned.error) return cleaned;
    const next = { ...current, bosses: cleaned.bosses, version: current.version + 1, updatedAt: now, updatedBy: str(userId) };
    // a Raid-Helper plan saved with a loaded line-up remembers who its players were (a raider who leaves keeps a name)
    if (Array.isArray(knownRoster)) next.known = knownAfter(next.bosses, knownRoster, current.known);
    if (idx === -1) plans.push(next); else plans[idx] = next;
    writeAll(plans);
    return { plan: next, dropped: cleaned.dropped };
}

/**
 * Copies a raid plan template into an event's plan as a snapshot: for every boss
 * the template has and the event has, the board is replaced by the template's
 * (new ids, no players on free tokens, the open slots filled from `roster`), and
 * `templateId` remembers where it came from. Bosses the template does not cover
 * are left alone. Later changes to the template do not reach the plan. `version`
 * is checked like a save. Returns `{ plan }` or `{ code, error }`.
 */
function applyTemplate(eventId, template, { version, bossKeys, roster, userId, trackKnown = false, now = Date.now() }) {
    const id = str(eventId);
    const plans = readAll();
    const idx = plans.findIndex((p) => p && p.eventId === id);
    const current = idx === -1 ? emptyPlan(id) : normalizePlan(plans[idx], id);
    if (Number(version) !== current.version) {
        return { code: "conflict", error: "Der Raidplan wurde inzwischen geändert. Bitte neu laden." };
    }
    const allowed = new Set(bossKeys);
    const bosses = { ...current.bosses };
    const defaultRows = ((template.bosses || {})[inherit.DEFAULTS_KEY] || {}).assignments || [];
    const meta = new Map(bossesForInstances(template.instanceIds).map((b) => [b.key, b]));
    let mobsOfCatalog = null;
    // every boss (and trash) the event has gets the template's board, or an empty one when the template has only the Standard for it
    const keys = new Set([...Object.keys(template.bosses || {}).filter((k) => k !== inherit.DEFAULTS_KEY), ...(defaultRows.length > 0 ? bossKeys.filter((k) => meta.has(k) && !meta.get(k).general) : [])]);
    for (const key of keys) {
        if (!allowed.has(key)) continue;
        let tb = (template.bosses || {})[key] || {};
        const bm = meta.get(key);
        if (defaultRows.length > 0 && bm && !bm.general) {
            if (!mobsOfCatalog) mobsOfCatalog = require("./raidplanCatalogStore").listMobs();
            const section = inherit.sectionOf(bm, mobsOfCatalog, tb.mobs);
            tb = { ...tb, assignments: inherit.effectiveRows(defaultRows, tb, section) };
        }
        const copy = board.reidBoard({ ...tb, tokens: [], inheritOff: [], profileId: tb.profileId || "" });
        copy.slots = board.fillSlots(copy.slots, roster);
        const cleaned = board.cleanBoard(copy, { allowedUserIds: roster.map((p) => p.userId), profileIds: tb.profileId ? [tb.profileId] : [] });
        if (cleaned.error) return cleaned;
        if (board.boardHasContent(cleaned.board)) bosses[key] = cleaned.board; else delete bosses[key];
    }
    const next = { ...current, bosses, templateId: template.id, version: current.version + 1, updatedAt: now, updatedBy: str(userId) };
    if (trackKnown) next.known = knownAfter(next.bosses, roster, current.known);
    if (idx === -1) plans.push(next); else plans[idx] = next;
    writeAll(plans);
    return { plan: next };
}

/**
 * Publishes or unpublishes the plan; the first publish mints the token, `rotate`
 * mints a new one (the old link stops working). Returns `{ plan }`.
 */
function setPublished(eventId, published, { rotate = false, userId, now = Date.now() } = {}) {
    const id = str(eventId);
    const plans = readAll();
    const idx = plans.findIndex((p) => p && p.eventId === id);
    const current = idx === -1 ? emptyPlan(id) : normalizePlan(plans[idx], id);
    const next = { ...current, status: published ? "published" : "draft", updatedAt: now, updatedBy: str(userId) };
    if ((published && !next.publicToken) || rotate) next.publicToken = newToken();
    if (idx === -1) plans.push(next); else plans[idx] = next;
    writeAll(plans);
    return { plan: next };
}

/**
 * Switches the raid plan of a Raid-Helper event on or off and sets what the event itself does not say (instances, size, version,
 * composition; docs/raidplan.md, "Raid-Helper-Events"). Switching off keeps the plan (a later switch-on finds it again) but withdraws the
 * public link: the plan goes back to draft. Creates the record on the first switch-on. Returns `{ plan }` or `{ code, error }`.
 */
function setLink(eventId, input, { userId, knownRoster = null, now = Date.now() } = {}) {
    const id = str(eventId);
    if (!/^[\w-]{3,40}$/.test(id)) return { code: "invalid", error: "Unbekanntes Event." };
    const plans = readAll();
    const idx = plans.findIndex((p) => p && p.eventId === id);
    const current = idx === -1 ? emptyPlan(id) : normalizePlan(plans[idx], id);
    const link = normalizeLink({ ...(current.link || {}), ...(input || {}), source: "raidhelper", changedAt: now, changedBy: str(userId) });
    if (link.enabled && !link.instanceIds.length) return { code: "invalid", error: "Bitte mindestens eine Instanz wählen." };
    const next = { ...current, link };
    if (!link.enabled) next.status = "draft";
    if (Array.isArray(knownRoster) && knownRoster.length) next.known = knownAfter(current.bosses, knownRoster, current.known);
    if (idx === -1) plans.push(next); else plans[idx] = next;
    writeAll(plans);
    return { plan: next };
}

/** Removes the plan of an event (it was deleted). */
function deletePlan(eventId) {
    const id = str(eventId);
    const plans = readAll();
    const rest = plans.filter((p) => !(p && p.eventId === id));
    if (rest.length === plans.length) return false;
    writeAll(rest);
    return true;
}

// ---- room maps -----------------------------------------------------------------------

const MAP_TYPES = [
    { ext: "png", mime: "image/png" },
    { ext: "jpg", mime: "image/jpeg" },
    { ext: "webp", mime: "image/webp" },
];

/** The image type a buffer really is (by its first bytes, not by what the upload claims), or null. */
function sniffImage(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
    if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return MAP_TYPES[0];
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return MAP_TYPES[1];
    if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return MAP_TYPES[2];
    return null;
}

const mapBase = (key) => str(key).replace(/\//g, "__");

function mapFiles(key) {
    return MAP_TYPES.map((t) => ({ ...t, file: path.join(mapDir, `${mapBase(key)}.${t.ext}`) }));
}

/** The stored map of a key: `{ buffer, mime, mtime }` or null. */
function readMap(key) {
    if (!isMapKey(key)) return null;
    for (const f of mapFiles(key)) {
        try {
            const stat = fs.statSync(f.file);
            return { buffer: fs.readFileSync(f.file), mime: f.mime, mtime: Math.floor(stat.mtimeMs) };
        } catch {
            // next type
        }
    }
    return null;
}

/** When the map of a key was stored (ms), 0 for none. Cheap: no file is read. */
function mapVersion(key) {
    if (!isMapKey(key)) return 0;
    for (const f of mapFiles(key)) {
        try {
            return Math.floor(fs.statSync(f.file).mtimeMs);
        } catch {
            // next type
        }
    }
    return 0;
}

/** Stores an uploaded map. Returns `{ ok: true, mime }` or `{ code, error }`. */
function saveMap(key, buffer) {
    if (!isMapKey(key)) return { code: "invalid", error: "Unbekannter Boss oder Instanz." };
    if (!Buffer.isBuffer(buffer) || !buffer.length) return { code: "invalid", error: "Keine Datei erhalten." };
    if (buffer.length > LIMITS.mapBytes) return { code: "too_large", error: "Das Bild ist größer als 3 MB." };
    const type = sniffImage(buffer);
    if (!type) return { code: "invalid", error: "Nur PNG, JPG oder WebP." };
    fs.mkdirSync(mapDir, { recursive: true });
    for (const f of mapFiles(key)) fs.rmSync(f.file, { force: true });
    fs.writeFileSync(path.join(mapDir, `${mapBase(key)}.${type.ext}`), buffer);
    return { ok: true, mime: type.mime };
}

/** Removes a stored map. True when there was one. */
function deleteMap(key) {
    if (!isMapKey(key)) return false;
    let had = false;
    for (const f of mapFiles(key)) {
        if (fs.existsSync(f.file)) { fs.rmSync(f.file, { force: true }); had = true; }
    }
    return had;
}

/**
 * The map a boss shows, most specific first: this event plan's own map, the
 * template's map, the boss's default map, the instance's default map. Returns
 * `{ key, version, source }` (`source`: "event" | "template" | "boss" | "instance")
 * or null. The version goes into the url so a new upload is not hidden by the cache.
 */
function mapForBoss(boss, { eventId = "", templateId = "" } = {}) {
    const candidates = [];
    if (eventId) candidates.push(["event", eventMapKey(eventId, boss.key)]);
    if (templateId) candidates.push(["template", templateMapKey(templateId, boss.key)]);
    candidates.push(["boss", boss.key], ["instance", boss.instanceId]);
    for (const [source, key] of candidates) {
        const version = mapVersion(key);
        if (version) return { key, version, source };
    }
    return null;
}

module.exports = {
    useFile, LIMITS, slug, bossKeyOf, bossesForInstances, bossIconByName, isMapKey,
    GENERAL_KEY, getPlan, getPublishedByToken, emptyPlan, savePlan, applyTemplate, mapScope, templateMapKey, eventMapKey, setPublished, deletePlan, cleanBosses,
    setLink, normalizeLink, playersOf, knownAfter,
    sniffImage, readMap, saveMap, deleteMap, mapVersion, mapForBoss,
};
