// softres.it integration: derive raid instances from an event title and create a
// soft-reserve list via softres.it's (internal) API. softres.it has no public API
// but its create endpoint accepts a raid object and returns { raidId, token }; the
// token is the edit secret. See config/softresInstances.js for the instance codes.

const axios = require("axios");
const httpsAgent = require("./httpAgent");
const { INSTANCES } = require("../config/softresInstances");

const SOFTRES_BASE = "https://softres.it";
const VALID_FACTIONS = ["Alliance", "Horde"];

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

// Turn a list of { id, raider?, note? } hard reserves into softres itemNotes.
function buildItemNotes(hardReserves = []) {
    return (hardReserves || [])
        .map((hr) => ({ id: Number(hr.id) || 0, raider: String(hr.raider || "").trim(), note: String(hr.note || "").trim() }))
        .filter((hr) => hr.id > 0)
        .map((hr) => ({
            id: hr.id,
            hardReserved: true,
            raider: hr.raider,
            note: hr.note,
            roles: [],
            specs: [],
            ignoreClassRestrict: false,
        }));
}

/**
 * Build the payload softres.it's POST /api/raid/create expects. Kept pure and
 * exported so it can be unit-tested without hitting the network.
 */
function buildCreatePayload({ instances, edition, amount, faction, hardReserves, note, hideReserves } = {}) {
    const codes = [...new Set((instances || []).map((c) => String(c).trim()).filter(Boolean))];
    if (!codes.length) throw new Error("Mindestens eine Instanz wählen.");
    if (!VALID_FACTIONS.includes(faction)) throw new Error("Fraktion muss \"Alliance\" oder \"Horde\" sein.");
    const amt = Math.max(1, Math.min(6, Number(amount) || 1));
    return {
        instances: codes,
        edition: String(edition || "tbc"),
        amount: amt,
        faction,
        itemLimit: 0,
        hideReserves: Boolean(hideReserves),
        characterNotes: true,
        restrictByClass: true,
        allowDuplicate: true,
        plusModifier: 1,
        plusType: 0,
        lock: false,
        discord: false,
        note: String(note || "").trim(),
        itemNotes: buildItemNotes(hardReserves),
        reserved: [],
    };
}

/**
 * Create a soft-reserve list on softres.it. Returns the ids and the shareable
 * URLs. Throws on a validation error (softres returns `{ code, error }`) or a
 * network failure.
 * @returns {Promise<{ raidId: string, token: string, url: string, editUrl: string }>}
 */
async function createRaid(opts = {}) {
    const payload = buildCreatePayload(opts);
    const { data } = await axios.post(`${SOFTRES_BASE}/api/raid/create`, payload, {
        httpsAgent,
        timeout: 20000,
        headers: { "Content-Type": "application/json" },
    });
    if (!data || data.code !== undefined || !data.raidId) {
        const detail = data && data.error && data.error.details && data.error.details[0]
            ? data.error.details[0].message : "unbekannter Fehler";
        throw new Error(`softres.it lehnte die Anfrage ab: ${detail}`);
    }
    return {
        raidId: data.raidId,
        token: data.token || "",
        url: `${SOFTRES_BASE}/raid/${data.raidId}`,
        editUrl: data.token ? `${SOFTRES_BASE}/raid/${data.raidId}/${data.token}` : `${SOFTRES_BASE}/raid/${data.raidId}`,
    };
}

module.exports = {
    SOFTRES_BASE, VALID_FACTIONS,
    normalizeTitle, titleHasKeyword, parseInstancesFromTitle,
    instancesForEdition, listEditions, editionOf, nameOf, catalogue,
    buildItemNotes, buildCreatePayload, createRaid,
};
