// The raid plan of an own event ("Raidplan"): per boss a board with player
// tokens on a room map, target rows with assigned players, and a note.
//
// One plan per event, stored in data/settings/raidplans.json:
//   { eventId, version, status: "draft" | "published", publicToken,
//     bosses: { [bossKey]: { tokens: [{ userId, x, y }], targets: [{ id, title, userIds }], notes, profileId } } }
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
const crypto = require("crypto");
const { instanceById } = require("../config/gameVersions");
const { ZONES } = require("../config/bosses");
const { wowIconUrl } = require("../config/menu");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const DEFAULT_FILE = path.join(DATA_DIR, "settings", "raidplans.json");
const DEFAULT_MAP_DIR = path.join(DATA_DIR, "raidplan-maps");

const LIMITS = {
    tokensPerBoss: 60,
    targetsPerBoss: 30,
    usersPerTarget: 25,
    title: 80,
    notes: 1000,
    mapBytes: 3 * 1024 * 1024,
};

let planFile = DEFAULT_FILE;
let mapDir = DEFAULT_MAP_DIR;

/** Tests point the store (and the map folder) somewhere of their own. */
function useFile(file, dir) {
    planFile = file || DEFAULT_FILE;
    mapDir = dir || (file ? path.join(path.dirname(file), "raidplan-maps") : DEFAULT_MAP_DIR);
}

const str = (v) => String(v === null || v === undefined ? "" : v).trim();

// ---- bosses of an event ------------------------------------------------------

const slug = (name) => str(name).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

const ICON_ID_BY_NAME = new Map();
for (const zone of ZONES) {
    for (const enc of zone.encounters || []) ICON_ID_BY_NAME.set(slug(enc.name), Number(enc.id));
}

/** The boss picture of a name (`/bosses/<id>.jpg`), "" when WCL does not know the encounter. */
function bossIconByName(name) {
    const id = ICON_ID_BY_NAME.get(slug(name));
    return id ? `/bosses/${id}.jpg` : "";
}

/** The stable key of one boss: `<instanceId>/<name slug>`. */
function bossKeyOf(instanceId, name) {
    return `${instanceId}/${slug(name)}`;
}

/**
 * The bosses of the instances an event is set to, in raid order:
 * `{ key, instanceId, instanceName, name, iconUrl, instanceIcon }`.
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
    }
    return out;
}

/** Whether a map key is a known instance id or a known boss key. */
function isMapKey(key) {
    const k = str(key);
    if (/^[a-z0-9]+$/.test(k)) return !!instanceById(k);
    const m = k.match(/^([a-z0-9]+)\/([a-z0-9-]+)$/);
    if (!m) return false;
    const inst = instanceById(m[1]);
    return !!inst && (inst.bosses || []).some((b) => slug(b) === m[2]);
}

// ---- persistence ---------------------------------------------------------------

function readAll() {
    try {
        const data = JSON.parse(fs.readFileSync(planFile, "utf8"));
        return Array.isArray(data.plans) ? data.plans : [];
    } catch {
        return [];
    }
}

function writeAll(plans) {
    fs.mkdirSync(path.dirname(planFile), { recursive: true });
    fs.writeFileSync(planFile, JSON.stringify({ plans }, null, 2));
}

function newToken() {
    return crypto.randomBytes(18).toString("base64url");
}

function newTargetId() {
    return crypto.randomBytes(5).toString("hex");
}

const clamp01 = (n) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const round4 = (n) => Math.round(n * 10000) / 10000;

/** A plan as it is stored: every field present, nothing else. */
function normalizePlan(raw, eventId) {
    const r = raw && typeof raw === "object" ? raw : {};
    return {
        eventId: str(eventId || r.eventId),
        version: Math.max(0, Math.floor(Number(r.version) || 0)),
        status: r.status === "published" ? "published" : "draft",
        publicToken: /^[A-Za-z0-9_-]{16,64}$/.test(str(r.publicToken)) ? str(r.publicToken) : "",
        bosses: r.bosses && typeof r.bosses === "object" ? r.bosses : {},
        updatedAt: Number(r.updatedAt) || 0,
        updatedBy: str(r.updatedBy),
    };
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
 * Cleans the bosses of a save. Only boss keys the event has are kept, tokens and
 * assignments only for `allowedUserIds` (a raider who left the setup drops out
 * instead of blocking every later save), coordinates are clamped, texts cut.
 * Returns `{ bosses, dropped }`, or `{ code: "invalid", error }` for a body that
 * is not a plan at all.
 */
function cleanBosses(input, { bossKeys, allowedUserIds, profileIds = [] }) {
    if (input === undefined || input === null || typeof input !== "object" || Array.isArray(input)) {
        return { code: "invalid", error: "Der Raidplan hat ein ungültiges Format." };
    }
    const keys = new Set(bossKeys);
    const profiles = new Set(profileIds.map(str));
    const allowed = new Set([...allowedUserIds].map(str));
    const out = {};
    let dropped = 0;
    for (const [key, raw] of Object.entries(input)) {
        // A boss the event no longer has (its instances changed) is dropped, not an error.
        if (!keys.has(key)) { dropped += 1; continue; }
        const board = raw && typeof raw === "object" ? raw : {};
        const seenTokens = new Set();
        const tokens = [];
        for (const t of Array.isArray(board.tokens) ? board.tokens : []) {
            const userId = str(t && t.userId);
            if (!userId || seenTokens.has(userId)) { dropped += 1; continue; }
            if (!allowed.has(userId)) { dropped += 1; continue; }
            if (tokens.length >= LIMITS.tokensPerBoss) return { code: "invalid", error: `Höchstens ${LIMITS.tokensPerBoss} Spieler je Boss.` };
            seenTokens.add(userId);
            tokens.push({ userId, x: round4(clamp01(Number(t.x))), y: round4(clamp01(Number(t.y))) });
        }
        const rawTargets = Array.isArray(board.targets) ? board.targets : [];
        if (rawTargets.length > LIMITS.targetsPerBoss) return { code: "invalid", error: `Höchstens ${LIMITS.targetsPerBoss} Aufgabenzeilen je Boss.` };
        const seenIds = new Set();
        const targets = rawTargets.map((tg) => {
            const t = tg && typeof tg === "object" ? tg : {};
            let id = str(t.id).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24);
            if (!id || seenIds.has(id)) id = newTargetId();
            seenIds.add(id);
            const users = [];
            for (const u of Array.isArray(t.userIds) ? t.userIds : []) {
                const userId = str(u);
                if (!allowed.has(userId) || users.includes(userId)) { dropped += 1; continue; }
                if (users.length >= LIMITS.usersPerTarget) break;
                users.push(userId);
            }
            return { id, title: str(t.title).slice(0, LIMITS.title), userIds: users };
        });
        const notes = String(board.notes === undefined || board.notes === null ? "" : board.notes).slice(0, LIMITS.notes);
        // The tactic profile the rows were taken from; one that was deleted since is forgotten.
        const profileId = profiles.has(str(board.profileId)) ? str(board.profileId) : "";
        // A boss nobody touched is not stored at all.
        if (!tokens.length && !targets.length && !notes.trim() && !profileId) continue;
        out[key] = { tokens, targets, notes, profileId };
    }
    return { bosses: out, dropped };
}

/**
 * Saves the bosses of an event's plan. `version` must be the one the caller read:
 * anything else is a `conflict` (someone saved in between). Creates the plan on
 * the first save. Returns `{ plan, dropped }` or `{ code, error }`.
 */
function savePlan(eventId, { version, bosses }, { bossKeys, allowedUserIds, profileIds, userId, now = Date.now() }) {
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
    if (idx === -1) plans.push(next); else plans[idx] = next;
    writeAll(plans);
    return { plan: next, dropped: cleaned.dropped };
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

const mapBase = (key) => str(key).replace("/", "__");

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
 * The map a boss uses: its own, else its instance's. `{ key, version, own }` or
 * null. The version goes into the url so a new upload is not hidden by the cache.
 */
function mapForBoss(boss) {
    const own = mapVersion(boss.key);
    if (own) return { key: boss.key, version: own, own: true };
    const inst = mapVersion(boss.instanceId);
    return inst ? { key: boss.instanceId, version: inst, own: false } : null;
}

module.exports = {
    useFile, LIMITS, slug, bossKeyOf, bossesForInstances, isMapKey,
    getPlan, getPublishedByToken, emptyPlan, savePlan, setPublished, deletePlan, cleanBosses,
    sniffImage, readMap, saveMap, deleteMap, mapVersion, mapForBoss,
};
