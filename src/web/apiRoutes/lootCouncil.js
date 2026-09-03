// The caster loot council endpoints.
//
// Two speeds, deliberately split:
//   GET  /api/lootcouncil             — the whole picture from stored data, one
//                                       page load, no simulation. `?item=<id>`
//                                       narrows it to "this just dropped: who?"
//   GET  /api/lootcouncil/item-search — the picker behind that question, and
//                                       the lookup "for whom is this BiS?"
//   GET  /api/lootcouncil/bislists    — the lists themselves, per class and spec
//   POST /api/lootcouncil/sim         — start the DPS simulation in the background
//   GET  /api/lootcouncil/sim         — poll it
//
// Everything the page shows works without the simulation; the sim only ever
// *replaces* the stat-weight estimate with a measured number. That split is the
// point — the binary is optional (see utils/wowsims/engine.js), and a council
// looking at last month's loot should never be blocked on a simulator.

const { ok, error: apiError } = require("../apiResponse");
const { requireAdmin, requireCsrf } = require("../apiMiddleware");
const { readJsonBody } = require("../apiBody");
const { activeGuildFor } = require("../activeGuild");
const { userCan } = require("../../config/permissions");
const { councilRoster, bisGaps, candidatesForItem, filterOptions, resolveContentFilter, itemView, bisSpecsView } = require("../lootCouncil");
const { bisLists } = require("../bisLists");
const { primeArmoryGear } = require("../armoryGear");
const { sourceForItem } = require("../../config/tbcContent");
const { startCouncilSim, getJob } = require("../simStore");
const { searchItems } = require("../../config/wowsims");
const councilStore = require("../councilStore");
const { gearFor, charKey } = require("../charGear");
const { characterMap } = require("../characterStore");
const { specFor } = require("../../config/casterSpecs");
const engine = require("../../utils/wowsims/engine");
const discord = require("../discord");
const { getConfig } = require("../settingsStore");

/** Comma-separated query params ("t5,t6") as a clean array. */
function listParam(url, name) {
    const raw = url.searchParams.get(name) || "";
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** The raid categories the filter can narrow to, named for the dropdown. */
function categoryOptions(guildId) {
    const config = getConfig();
    const ids = config.categoryIds || [];
    const known = new Map(discord.listCategories(guildId).map((c) => [c.id, c.name]));
    return ids.map((id) => ({ id, name: known.get(id) || id }));
}

/**
 * GET /api/lootcouncil — roster, BiS gaps and filter options.
 *
 * Query: role, tiers, contents, category, bisTier, item (candidates for one item)
 */
async function getLootCouncil(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!userCan(user, "lootcouncil", "read")) return apiError(res, 403, "Kein Zugriff auf den Loot-Council.");

    const role = url.searchParams.get("role") || "";
    const tierIds = listParam(url, "tiers");
    const contentIds = listParam(url, "contents");
    const categoryId = url.searchParams.get("category") || "";
    const bisTier = url.searchParams.get("bisTier") || "";
    const guildId = activeGuildFor(req);

    const opts = { role, tierIds, contentIds, categoryId, bisTier };
    let built = councilRoster(opts);
    // A set that still holds a boss-specific piece is the one case the logs
    // cannot answer — only the armory knows what is on that raider *now*. Asked
    // then and only then, and only for those names, so a normal council costs
    // no extra call at all. If it answers, the roster is built again with it.
    const needArmory = built.rows.filter((r) => r.gear && r.gear.dropped.length).map((r) => r.character);
    if (needArmory.length) {
        try {
            const primed = await primeArmoryGear(needArmory);
            if (primed.answered) built = councilRoster(opts);
        } catch (e) {
            console.error("armory gear failed:", e.message);
        }
    }
    const {
        rows, avgLootCount, bisTier: usedBisTier, skipped, categorySources,
    } = built;
    const contentFilter = resolveContentFilter({ tierIds, contentIds });

    // One named item ("this just dropped") short-circuits the BiS list: the
    // council wants the candidates for that item, not the whole gap report.
    const itemId = Number(url.searchParams.get("item") || 0);
    const focus = itemId > 0
        // Against the tier that was actually used, so "BiS für …" names the same
        // lists the roster's BiS column is counted against.
        ? { item: itemView(itemId, usedBisTier), candidates: candidatesForItem(itemId, rows) }
        : null;

    ok(res, {
        roster: rows,
        avgLootCount,
        // Who the council has set aside, so the page can offer them back — and
        // say why a familiar name is missing instead of looking broken.
        excluded: Object.entries(councilStore.listExcluded())
            .map(([key, entry]) => ({ key, ...entry }))
            .sort((a, b) => (b.at || 0) - (a.at || 0)),
        gaps: focus ? [] : bisGaps(rows, { contentIds: contentFilter }),
        focus,
        options: { ...filterOptions(), categories: categoryOptions(guildId) },
        // `bisTier` is what was actually used: the admin's pick, or — when they
        // made none — the tier derived from the guild's newest loot. The page
        // says which, so "12/16 BiS" is never read against the wrong list.
        filter: {
            role, tierIds, contentIds, categoryId,
            bisTier: usedBisTier, bisTierDerived: !bisTier,
            // How many names the filters took out, and on what basis the
            // category filter knew who belongs. Without this a shrunken list
            // reads as a bug rather than as the filter doing its job.
            skipped,
            categorySources,
        },
        sim: {
            available: engine.isAvailable(),
            version: engine.WOWSIMS_VERSION,
            // What the page tells the reader when there is no binary: the
            // numbers are stat-weight estimates, not simulated DPS.
            hint: engine.isAvailable()
                ? ""
                : "Keine WoWSims-Simulation verfügbar (WOWSIMCLI_PATH nicht gesetzt) — die Upgrade-Werte sind Schätzungen aus Stat-Gewichten.",
        },
        activeGuildId: guildId,
    });
}

/**
 * POST /api/lootcouncil/sim — start simulating.
 * Body: { id, subjects: [{key, specKey}], items: [itemId] }
 */
async function postLootCouncilSim(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    // Running a simulation is work the server does on request, so it takes write
    // level — a read-only council member sees the stat-weight numbers.
    if (!userCan(user, "lootcouncil", "write")) return apiError(res, 403, "Kein Zugriff auf den Loot-Council.");
    if (!requireCsrf(req, res)) return;

    const body = await readJsonBody(req);
    const id = String(body.id || "").trim();
    if (!id) return apiError(res, 400, "Job-Id fehlt.");
    const subjects = (Array.isArray(body.subjects) ? body.subjects : [])
        .map((s) => ({ key: String((s && s.key) || "").trim(), specKey: String((s && s.specKey) || "").trim() }))
        .filter((s) => s.key && s.specKey);
    if (!subjects.length) return apiError(res, 400, "Keine Raider angegeben.");
    const items = (Array.isArray(body.items) ? body.items : []).map(Number).filter((n) => n > 0);

    if (!engine.isAvailable()) {
        return apiError(res, 503, "Keine WoWSims-Simulation verfügbar — WOWSIMCLI_PATH ist nicht gesetzt.");
    }
    const started = startCouncilSim(id, subjects, items);
    ok(res, { ...started, id });
}

/**
 * POST /api/lootcouncil/exclude — stop planning with a raider, or resume.
 * Body: { character, exclude: boolean, reason? }
 *
 * A roster built from history keeps everyone who ever raided, and someone who
 * left the guild wins the "hat am längsten nichts bekommen" ranking simply by
 * not raiding — their drought grows forever. Excluding is reversible and never
 * touches the loot history, so the numbers stay whole.
 */
async function postExclude(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!userCan(user, "lootcouncil", "write")) return apiError(res, 403, "Kein Zugriff auf den Loot-Council.");
    if (!requireCsrf(req, res)) return;

    const body = await readJsonBody(req);
    const character = String(body.character || "").trim();
    if (!character) return apiError(res, 400, "Kein Charakter angegeben.");

    if (body.exclude === false) {
        const removed = councilStore.include(character);
        return ok(res, { character, excluded: false, changed: removed });
    }
    const entry = councilStore.exclude(character, {
        reason: String(body.reason || "").trim(),
        by: user.name || user.id,
    });
    if (!entry) return apiError(res, 400, "Kein Charakter angegeben.");
    ok(res, { character, excluded: true, entry });
}

/**
 * GET /api/lootcouncil/export?character=… — that raider's loadout as a WoWSims
 * "From JSON" import, so anyone can paste it into wowsims.github.io/tbc and
 * check the number this page shows.
 *
 * Built from the same pieces as our own run, so it reproduces our DPS rather
 * than a different one — an export that quietly differs would make the page
 * look wrong when it is not.
 */
async function getExport(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!userCan(user, "lootcouncil", "read")) return apiError(res, 403, "Kein Zugriff auf den Loot-Council.");

    const character = String(url.searchParams.get("character") || "").trim();
    if (!character) return apiError(res, 400, "Kein Charakter angegeben.");
    // The spec decides the rotation and the buff set, so it has to be the same
    // one the page judged them by — and, one step earlier, the same role: the
    // export has to be built from the set the page compared, not from the
    // healing gear of whatever raid happens to be the newest.
    const known = characterMap()[charKey(character)] || {};
    const knownSpec = specFor(known.className, known.spec);
    const gear = gearFor(character, { roleFor: () => (knownSpec ? knownSpec.role : "") });
    if (!gear) return apiError(res, 404, `Für ${character} ist kein Gear bekannt — der Charakter taucht in keiner der letzten CLA-Auswertungen auf.`);

    const specEntry = knownSpec || specFor(gear.className, known.spec);
    if (!specEntry) return apiError(res, 400, `Für ${character} ist keine Caster-Spec bekannt.`);

    const built = engine.buildIndividualExport({ gear, specEntry });
    if (!built.supported) return apiError(res, 400, built.warnings.join(" ") || "Diese Spec lässt sich nicht exportieren.");

    // Whoever checks the number in WoWSims has the raider's armory open next to
    // it, so every place where this loadout deliberately differs from their last
    // raid has to be named — otherwise the export looks wrong where it is right.
    const substitutions = gear.items
        .filter((it) => it.replacedSituational)
        .map((it) => `Statt „${it.replacedSituational.itemName}“ (${it.replacedSituational.note}) steht hier „${it.itemName}“ aus einer älteren Auswertung.`);
    const stillSituational = gear.items
        .filter((it) => it.situational)
        .map((it) => `„${it.itemName}“ ${it.situational.note} — keine ältere Auswertung zeigt etwas anderes auf dem Slot.`);

    ok(res, {
        character: gear.character,
        spec: specEntry.key,
        specLabel: specEntry.label,
        // Where to paste it — the WoWSims import does not switch class itself.
        simUrl: SIM_URLS[specEntry.key] || SIM_URLS[specEntry.simSpec] || "https://wowsims.github.io/tbc/",
        seenAt: gear.seenAt,
        reportTitle: gear.reportTitle,
        warnings: [...built.warnings, ...substitutions, ...stillSituational],
        json: JSON.stringify(built.data, null, 2),
    });
}

// Which WoWSims page an export belongs on. The individual import reads gear and
// talents from the JSON but not the class, so pasting a priest export on the
// mage sim silently produces nonsense.
const SIM_URLS = {
    "Priest-Shadow": "https://wowsims.github.io/tbc/priest/dps/",
    "Mage-Arcane": "https://wowsims.github.io/tbc/mage/",
    "Mage-Fire": "https://wowsims.github.io/tbc/mage/",
    "Mage-Frost": "https://wowsims.github.io/tbc/mage/",
    "Warlock-Destruction": "https://wowsims.github.io/tbc/warlock/",
    "Warlock-Affliction": "https://wowsims.github.io/tbc/warlock/",
    "Warlock-Demonology": "https://wowsims.github.io/tbc/warlock/",
    "Druid-Balance": "https://wowsims.github.io/tbc/balance_druid/",
    "Shaman-Elemental": "https://wowsims.github.io/tbc/elemental_shaman/",
};

/**
 * GET /api/lootcouncil/item-search?q=…&tier=… — items for the "this just
 * dropped" picker, searched in the generated caster table (config/wowsims).
 *
 * Each hit carries whose BiS list it is on, because the same search answers the
 * other direction too: the BiS-Listen tab looks a piece up to find out *for
 * whom* it is best in slot. An item on nobody's list comes back with an empty
 * `bisSpecs` — which is the answer, not a gap.
 */
async function getItemSearch(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!userCan(user, "lootcouncil", "read")) return apiError(res, 403, "Kein Zugriff auf den Loot-Council.");
    const tier = url.searchParams.get("tier") || "";
    const items = searchItems(url.searchParams.get("q") || "").map((it) => {
        const source = sourceForItem(it.id) || {};
        return {
            ...it,
            contentId: source.content || "",
            boss: source.boss || "",
            bisSpecs: bisSpecsView(it.id, tier),
        };
    });
    ok(res, { items });
}

/**
 * POST /api/lootcouncil/armory — fetch the current gear of these raiders from
 * the armory, so the page stops judging them on their last logged raid.
 *
 * Deliberately a button and not a page load. It is a call per raider to an API
 * outside this app: doing it on every view would make the council slow and
 * would spend somebody else's rate limit on a page nobody is reading. And it is
 * a decision — "nimm den Stand von jetzt" — which belongs to the reader.
 */
async function postArmoryRefresh(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!userCan(user, "lootcouncil", "write")) return apiError(res, 403, "Kein Zugriff auf den Loot-Council.");
    if (!requireCsrf(req, res)) return;

    const body = await readJsonBody(req);
    const characters = Array.isArray(body.characters) ? body.characters : [];
    if (!characters.length) return apiError(res, 400, "Keine Charaktere angegeben.");

    const result = await primeArmoryGear(characters, { full: true, force: true });
    if (!result.configured) {
        return apiError(res, 400, "Für die Armory fehlen die Battle.net-Zugangsdaten (Einstellungen → Verbindungen).");
    }
    ok(res, result);
}

/**
 * GET /api/lootcouncil/bislists?tier=… — which gear set is BiS for which caster
 * DPS class and spec, as the matrix the tab draws (see web/bisLists.js).
 */
async function getBisLists(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!userCan(user, "lootcouncil", "read")) return apiError(res, 403, "Kein Zugriff auf den Loot-Council.");
    ok(res, bisLists(url.searchParams.get("tier") || ""));
}

/** GET /api/lootcouncil/sim?id=… — poll a running simulation. */
async function getLootCouncilSim(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!userCan(user, "lootcouncil", "read")) return apiError(res, 403, "Kein Zugriff auf den Loot-Council.");
    const job = getJob(url.searchParams.get("id") || "");
    if (!job) return ok(res, { status: "unknown" });
    ok(res, job);
}

module.exports = {
    getLootCouncil, postLootCouncilSim, getLootCouncilSim,
    getItemSearch, getBisLists, postExclude, getExport, postArmoryRefresh,
};
