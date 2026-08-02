// softres.it integration: derive raid instances from an event title and create a
// soft-reserve list on softres.it.
//
// softres.it has no public API. It used to expose a plain `POST /api/raid/create`
// that took a JSON raid object and answered with `{ raidId, token }`. The 2026
// rewrite replaced that with a Laravel/Inertia app: the create endpoint is now
// `POST /raid`, it is CSRF-gated (session cookie + matching X-XSRF-TOKEN header),
// it wants snake_case fields and *numeric* instance ids, and it answers a
// successful write with a 302 to `/raid/{raidId}?adminToken={token}` instead of a
// JSON body. Hard reserves no longer travel with the create call either — they
// are two follow-up writes against the fresh raid.
//
// See config/softresInstances.js for the instance codes and their numeric ids.

const axios = require("axios");
const httpsAgent = require("./httpAgent");
const { INSTANCES } = require("../config/softresInstances");

const SOFTRES_BASE = "https://softres.it";
const VALID_FACTIONS = ["Alliance", "Horde"];
const XSRF_COOKIE = "XSRF-TOKEN";
// softres.it can be slow to answer under load; give it generous headroom so
// creating/re-creating a list doesn't fail with a premature timeout.
const TIMEOUT = 45000;

// Lower-case a title and strip accents so keyword matching is robust to
// "Zul'Aman" vs "zulaman" etc.
function normalizeTitle(title) {
    return String(title || "")
        .toLowerCase()
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/['’`]/g, "'");
}

// Does the normalized title contain `keyword` as a standalone token? Digits and
// letters are word chars; boundaries are anything else. Keeps "mc" from matching
// inside "mechanar" while still catching "mc+bwl" or "mc, bwl".
function titleHasKeyword(normTitle, keyword) {
    const k = normalizeTitle(keyword).replace(/[+]/g, "\\+");
    const re = new RegExp(`(^|[^a-z0-9])${k}([^a-z0-9]|$)`, "i");
    return re.test(normTitle);
}

/**
 * Derive softres.it instances from a Raid-Helper event title. Returns the matched
 * instances as { code, name, edition, slots } in catalogue order, de-duplicated.
 * When several editions match (rare), the edition of the first match wins and only
 * instances of that edition are returned, since a softres list is single-edition.
 * @param {string} title
 * @param {string} [preferEdition] restrict matching to this edition when given
 */
function parseInstancesFromTitle(title, preferEdition = "") {
    const norm = normalizeTitle(title);
    if (!norm) return [];
    const matches = [];
    for (const [code, inst] of Object.entries(INSTANCES)) {
        if (preferEdition && inst.edition !== preferEdition) continue;
        if ((inst.keywords || []).some((kw) => titleHasKeyword(norm, kw))) {
            matches.push({ code, name: inst.name, edition: inst.edition, slots: inst.slots });
        }
    }
    if (!matches.length) return [];
    const edition = preferEdition || matches[0].edition;
    return matches.filter((m) => m.edition === edition);
}

/** All instances for an edition, as { code, name, slots }, catalogue order. */
function instancesForEdition(edition) {
    return Object.entries(INSTANCES)
        .filter(([, inst]) => inst.edition === edition)
        .map(([code, inst]) => ({ code, name: inst.name, slots: inst.slots }));
}

/** The edition of an instance code, or "" if the code is unknown. */
function editionOf(code) {
    const inst = INSTANCES[String(code || "").trim()];
    return inst ? inst.edition : "";
}

/** The display name of an instance code, or the code itself if unknown. */
function nameOf(code) {
    const inst = INSTANCES[String(code || "").trim()];
    return inst ? inst.name : String(code || "");
}

/**
 * Expected raid size for a set of chosen instance codes: the largest `slots`
 * among them (not summed — picking e.g. SSC + TK still means one 25-man raid).
 * Used as the signup target on the event detail page. Unknown codes are
 * ignored; returns 0 when nothing is known.
 */
function targetSizeForInstances(codes = []) {
    const sizes = (codes || [])
        .map((c) => INSTANCES[String(c || "").trim()])
        .filter(Boolean)
        .map((inst) => inst.slots);
    return sizes.length ? Math.max(...sizes) : 0;
}

/** The distinct editions present in the catalogue, in a sensible order. */
function listEditions() {
    const order = ["classic", "tbc", "wotlk"];
    const present = new Set(Object.values(INSTANCES).map((i) => i.edition));
    return order.filter((e) => present.has(e));
}

const EDITION_LABELS = { classic: "Classic", tbc: "The Burning Crusade", wotlk: "Wrath of the Lich King" };

/** Full instance catalogue grouped by edition: [{ edition, label, instances }]. */
function catalogue() {
    return listEditions().map((edition) => ({
        edition,
        label: EDITION_LABELS[edition] || edition,
        instances: instancesForEdition(edition),
    }));
}

/**
 * Translate our instance codes into the numeric ids softres.it wants on the wire,
 * de-duplicated and in the order given. An unknown code is an error rather than a
 * silent drop: a list quietly missing a raid the raidlead ticked is worse than a
 * visible failure.
 */
function instanceIdsForCodes(codes = []) {
    const seen = new Set();
    const ids = [];
    for (const raw of codes || []) {
        const code = String(raw || "").trim();
        if (!code || seen.has(code)) continue;
        seen.add(code);
        const inst = INSTANCES[code];
        if (!inst) throw new Error(`Unbekannte Instanz: ${code}`);
        ids.push(inst.id);
    }
    if (!ids.length) throw new Error("Mindestens eine Instanz wählen.");
    return ids;
}

/**
 * Turn a list of { id, note? } hard reserves into softres.it's `item_notes`
 * shape. Only entries that actually carry a note survive — softres drops empty
 * ones anyway, and the hard-reserve flag itself travels separately (see
 * `hardReserveIds`).
 */
function buildItemNotes(hardReserves = []) {
    return (hardReserves || [])
        .map((hr) => ({ id: Number(hr.id) || 0, note: String(hr.note || "").trim() }))
        .filter((hr) => hr.id > 0 && hr.note !== "");
}

/** The plain item ids of a hard-reserve list, de-duplicated, invalid ids dropped. */
function hardReserveIds(hardReserves = []) {
    return [...new Set((hardReserves || []).map((hr) => Number(hr.id) || 0).filter((id) => id > 0))];
}

/**
 * Build the payload softres.it's `POST /raid` expects. Kept pure and exported so
 * it can be unit-tested without hitting the network.
 *
 * `protection` (softres.it's "User Protection") defaults to **true**: raiders have
 * to sign in (Discord or Battle.net) before they can reserve, and can then only
 * edit their own reserves. With it off, anyone can edit anyone's reserves. Pass
 * `protection: false` to opt out for a single list.
 */
function buildCreatePayload({ instances, edition, amount, faction, hideReserves, protection } = {}) {
    const ids = instanceIdsForCodes(instances);
    if (!VALID_FACTIONS.includes(faction)) throw new Error("Fraktion muss \"Alliance\" oder \"Horde\" sein.");
    const amt = Math.max(1, Math.min(6, Number(amount) || 1));
    return {
        edition: String(edition || "tbc"),
        instances: ids,
        // softres.it switched to lower-case faction slugs in the rewrite.
        faction: faction.toLowerCase(),
        protection: protection === undefined ? true : Boolean(protection),
        reserve_limit: amt,
        item_limit: 0,
        item_reserve_limit: 0,
        hide_reserves: Boolean(hideReserves),
        notes_enabled: true,
        class_restrictions: true,
    };
}

// --- HTTP plumbing -------------------------------------------------------
// Laravel gates every write behind a session cookie plus the matching XSRF
// token, so a create is: GET the start page to pick both up, then POST with
// them. The handful of cookies live in a Map rather than a cookie-jar
// dependency — one short-lived session per create is all this ever needs.

function absorbCookies(jar, setCookie) {
    for (const line of setCookie || []) {
        const pair = String(line).split(";")[0];
        const eq = pair.indexOf("=");
        if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    return jar;
}

function cookieHeader(jar) {
    return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

/** Turn an axios failure into a German error carrying softres.it's own complaint. */
function softresError(err) {
    const data = err && err.response && err.response.data;
    if (data && typeof data === "object") {
        // Laravel validation errors: { message, errors: { field: [msg, ...] } }
        const first = Object.values(data.errors || {}).flat().find(Boolean);
        const detail = first || data.message;
        if (detail) return new Error(`softres.it lehnte die Anfrage ab: ${detail}`);
    }
    const status = err && err.response && err.response.status;
    if (status) return new Error(`softres.it antwortete mit HTTP ${status}.`);
    return new Error(`softres.it nicht erreichbar: ${(err && err.message) || "unbekannter Fehler"}`);
}

/** Open a session: fetch the start page and keep its session + XSRF cookies. */
async function openSession() {
    const jar = new Map();
    try {
        const res = await axios.get(`${SOFTRES_BASE}/`, { httpsAgent, timeout: TIMEOUT });
        absorbCookies(jar, res.headers["set-cookie"]);
    } catch (err) {
        throw softresError(err);
    }
    if (!jar.has(XSRF_COOKIE)) throw new Error("softres.it lieferte kein CSRF-Token — Seite geändert?");
    return jar;
}

/**
 * One authenticated request against softres.it. A successful write answers with
 * a 302 back to the raid page, so 3xx counts as success here and is *not*
 * followed — the Location header is where the new raid id and token live.
 */
async function send(jar, method, path, data) {
    let res;
    try {
        res = await axios.request({
            method,
            url: `${SOFTRES_BASE}${path}`,
            data,
            httpsAgent,
            timeout: TIMEOUT,
            maxRedirects: 0,
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                "X-Requested-With": "XMLHttpRequest",
                "X-XSRF-TOKEN": decodeURIComponent(jar.get(XSRF_COOKIE) || ""),
                Cookie: cookieHeader(jar),
            },
            validateStatus: (s) => s >= 200 && s < 400,
        });
    } catch (err) {
        throw softresError(err);
    }
    absorbCookies(jar, res.headers["set-cookie"]);
    return res;
}

/**
 * Pull the raid id and admin token out of the redirect softres.it answers a
 * successful create with: `/raid/{raidId}?adminToken={token}`.
 */
function parseCreatedLocation(location) {
    if (!location) return null;
    let url;
    try {
        url = new URL(location, SOFTRES_BASE);
    } catch {
        return null;
    }
    const m = /^\/raid\/([A-Za-z0-9]+)\/?$/.exec(url.pathname);
    if (!m) return null;
    return { raidId: m[1], token: url.searchParams.get("adminToken") || "" };
}

/** The view and edit URLs for a raid id + admin token. */
function raidUrls(raidId, token) {
    const url = `${SOFTRES_BASE}/raid/${raidId}`;
    return { url, editUrl: token ? `${url}?adminToken=${token}` : url };
}

/**
 * Create a soft-reserve list on softres.it. Returns the ids and the shareable
 * URLs. Throws on a validation error or a network failure.
 *
 * Hard reserves are applied as two follow-up writes, because the create endpoint
 * no longer accepts them: `POST /raid/{id}/hardReserve` flags the items, `PUT
 * /raid/{id}` carries the per-item notes and the raid note. Those run
 * best-effort and report back via `hardReserveError` — a list that exists but is
 * missing its hard reserves is far more useful than a hard failure that leaves
 * an orphaned list behind on softres.it.
 * @returns {Promise<{ raidId, token, url, editUrl, hardReserveError? }>}
 */
async function createRaid(opts = {}) {
    const payload = buildCreatePayload(opts);
    const jar = await openSession();
    const res = await send(jar, "post", "/raid", payload);
    const created = parseCreatedLocation(res.headers && res.headers.location);
    if (!created) throw new Error("softres.it hat keine Raid-ID zurückgegeben.");

    const result = { ...created, ...raidUrls(created.raidId, created.token) };
    const items = hardReserveIds(opts.hardReserves);
    const itemNotes = buildItemNotes(opts.hardReserves);
    const note = String(opts.note || "").trim();
    if (!items.length && !itemNotes.length && !note) return result;

    try {
        // Claim manager rights for this session — the token is what proves them.
        if (created.token) await send(jar, "get", `/raid/${created.raidId}?adminToken=${created.token}`);
        if (items.length) await send(jar, "post", `/raid/${created.raidId}/hardReserve`, { items });
        if (itemNotes.length || note) {
            const update = {};
            if (itemNotes.length) update.item_notes = itemNotes;
            if (note) update.note = note;
            await send(jar, "put", `/raid/${created.raidId}`, update);
        }
    } catch (err) {
        result.hardReserveError = err.message;
    }
    return result;
}

module.exports = {
    SOFTRES_BASE, VALID_FACTIONS,
    normalizeTitle, titleHasKeyword, parseInstancesFromTitle,
    instancesForEdition, listEditions, editionOf, nameOf, catalogue, targetSizeForInstances,
    instanceIdsForCodes, buildItemNotes, hardReserveIds, buildCreatePayload,
    parseCreatedLocation, raidUrls, createRaid,
};
