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
// Everything the page shows works without the simulation; the sim is what
// puts a gain next to a candidate at all — the page shows no estimates. That
// split is the point — the binary is optional (see utils/wowsims/engine.js),
// and a council looking at last month's loot should never be blocked on a
// simulator.

const { ok, error: apiError } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { activeGuildFor } = require("../http/activeGuild");
const { userCan } = require("../../config/permissions");
const { councilRoster, bisGaps, candidateSplit, filterOptions, resolveContentFilter, itemView, bisSpecsView } = require("../lootCouncil");
const { bisLists } = require("../bisLists");
const { primeArmoryGear, clearArmoryFor } = require("../armoryGear");
const { loadLogGear, clearLogGear, recentLogs } = require("../../stores/logGearStore");
const { sourceForItem } = require("../../config/tbcContent");
const { startCouncilSim, getJob } = require("../../stores/simStore");
const { searchItems } = require("../../config/wowsims");
const councilStore = require("../../stores/councilStore");
const { gearFor, charKey } = require("../charGear");
const { characterMap } = require("../../stores/characterStore");
const { specFor, ROLES } = require("../../config/casterSpecs");
const engine = require("../../utils/wowsims/engine");
const discord = require("../discord");
const { getConfig } = require("../../stores/settingsStore");

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
const getLootCouncil = withUser({}, async ({ user, req, res, url }) => {
    if (!userCan(user, "lootcouncil", "read")) return apiError(res, 403, "forbidden", "Kein Zugriff auf den Loot-Council.");

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
    // council wants the candidates for that item, not the whole gap report —
    // and, next to them, who cannot wear it at all, so a short list is explained.
    const itemId = Number(url.searchParams.get("item") || 0);
    const focus = itemId > 0
        // Against the tier that was actually used, so "BiS für …" names the same
        // lists the roster's BiS column is counted against.
        ? { item: itemView(itemId, usedBisTier), ...candidateSplit(itemId, rows) }
        : null;

    ok(res, {
        roster: rows,
        avgLootCount,
        // The bot's newest logs, so the log panel at a raider can offer them
        // to pick from instead of asking for a link every time.
        recentLogs: recentLogs(),
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
            // What the page tells the reader when there is no binary: there
            // is no gain to show at all, because the page shows no estimates.
            hint: engine.isAvailable()
                ? ""
                : "Keine WoWSims-Simulation verfügbar (WOWSIMCLI_PATH nicht gesetzt) — ohne Simulation zeigt die Seite keine Zugewinne, geschätzt wird nichts.",
        },
        activeGuildId: guildId,
    });
});

/**
 * POST /api/lootcouncil/sim — start simulating.
 * Body: { id, subjects: [{key, specKey}], items: [itemId] }
 *
 * Running a simulation is work the server does on request, so it takes write
 * level (`write: "lootcouncil"`) - a read-only council member sees the numbers.
 */
const postLootCouncilSim = withUser({ write: "lootcouncil", csrf: true, body: true }, async ({ body, res }) => {
    const id = String(body.id || "").trim();
    if (!id) return apiError(res, 400, "bad_request", "Job-Id fehlt.");
    const subjects = (Array.isArray(body.subjects) ? body.subjects : [])
        .map((s) => ({ key: String((s && s.key) || "").trim(), specKey: String((s && s.specKey) || "").trim() }))
        .filter((s) => s.key && s.specKey);
    if (!subjects.length) return apiError(res, 400, "bad_request", "Keine Raider angegeben.");
    const items = (Array.isArray(body.items) ? body.items : []).map(Number).filter((n) => n > 0);

    if (!engine.isAvailable()) {
        return apiError(res, 503, "sim_unavailable", "Keine WoWSims-Simulation verfügbar — WOWSIMCLI_PATH ist nicht gesetzt.");
    }
    const started = startCouncilSim(id, subjects, items);
    ok(res, { ...started, id });
});

/**
 * POST /api/lootcouncil/exclude — stop planning with a raider, or resume.
 * Body: { character, exclude: boolean, reason? }
 *
 * A roster built from history keeps everyone who ever raided, and someone who
 * left the guild wins the "hat am längsten nichts bekommen" ranking simply by
 * not raiding — their drought grows forever. Excluding is reversible and never
 * touches the loot history, so the numbers stay whole.
 */
const postExclude = withUser({ write: "lootcouncil", csrf: true, body: true }, async ({ user, body, res }) => {
    const character = String(body.character || "").trim();
    if (!character) return apiError(res, 400, "bad_request", "Kein Charakter angegeben.");

    if (body.exclude === false) {
        const removed = councilStore.include(character);
        return ok(res, { character, excluded: false, changed: removed });
    }
    const entry = councilStore.exclude(character, {
        reason: String(body.reason || "").trim(),
        by: user.name || user.id,
    });
    if (!entry) return apiError(res, 400, "bad_request", "Kein Charakter angegeben.");
    ok(res, { character, excluded: true, entry });
});

/**
 * POST /api/lootcouncil/role — als was ein Raider eingeplant ist.
 *
 * Body: { character, role: "caster" | "healer" | "" }
 *
 * Ein Heiler, der heute Offspec spielt, ist für diesen Abend ein DPS — mit
 * Casterset, Caster-BiS und Caster-Simulation. Aus den Daten geht das nicht
 * hervor, also ist es eine Festlegung; ein leeres `role` nimmt sie zurück.
 */
const postRole = withUser({ write: "lootcouncil", csrf: true, body: true }, async ({ user, body, res }) => {
    const character = String(body.character || "").trim();
    if (!character) return apiError(res, 400, "bad_request", "Kein Charakter angegeben.");
    const role = String(body.role || "").trim();
    if (role && !ROLES.some((r) => r.id === role)) return apiError(res, 400, "invalid_input", `Unbekannte Rolle: ${role}`);

    const entry = councilStore.setRole(character, role, { by: user.name || user.id });
    ok(res, { character, role: entry ? entry.role : "", entry });
});

/**
 * GET /api/lootcouncil/export?character=… — that raider's loadout as a WoWSims
 * "From JSON" import, so anyone can paste it into wowsims.com/tbc and
 * check the number this page shows.
 *
 * Built from the same pieces as our own run, so it reproduces our DPS rather
 * than a different one — an export that quietly differs would make the page
 * look wrong when it is not.
 */
const getExport = withUser({}, async ({ user, res, url }) => {
    if (!userCan(user, "lootcouncil", "read")) return apiError(res, 403, "forbidden", "Kein Zugriff auf den Loot-Council.");

    const character = String(url.searchParams.get("character") || "").trim();
    if (!character) return apiError(res, 400, "bad_request", "Kein Charakter angegeben.");
    // The spec decides the rotation and the buff set, so it has to be the same
    // one the page judged them by — and, one step earlier, the same role: the
    // export has to be built from the set the page compared, not from the
    // healing gear of whatever raid happens to be the newest.
    const known = characterMap()[charKey(character)] || {};
    const knownSpec = specFor(known.className, known.spec);
    const gear = gearFor(character, { roleFor: () => (knownSpec ? knownSpec.role : "") });
    if (!gear) return apiError(res, 404, "not_found", `Für ${character} ist kein Gear bekannt — der Charakter taucht in keiner der letzten CLA-Auswertungen auf.`);

    const specEntry = knownSpec || specFor(gear.className, known.spec);
    if (!specEntry) return apiError(res, 400, "spec_required", `Für ${character} ist keine Caster-Spec bekannt.`);

    const built = engine.buildIndividualExport({ gear, specEntry });
    if (!built.supported) return apiError(res, 400, "unsupported", built.warnings.join(" ") || "Diese Spec lässt sich nicht exportieren.");

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
        simUrl: SIM_URLS[specEntry.key] || SIM_URLS[specEntry.simSpec] || "https://www.wowsims.com/tbc/",
        seenAt: gear.seenAt,
        reportTitle: gear.reportTitle,
        warnings: [...built.warnings, ...substitutions, ...stillSituational],
        json: JSON.stringify(built.data, null, 2),
    });
});

// Which WoWSims page an export belongs on. The individual import reads gear and
// talents from the JSON but not the class, so pasting a priest export on the
// mage sim silently produces nonsense.
//
// wowsims.com, not the old wowsims.github.io: that one only forwards from
// inside the loaded page, so every link cost a detour — and its shadow-priest
// path answers 404 outright. Every address below was checked against the live
// site; an invented path there answers 200 with a 1.8 KB placeholder rather
// than an error, so "it loads" is not proof and the pages were told apart by
// what they actually return.
const SIM_URLS = {
    "Priest-Shadow": "https://www.wowsims.com/tbc/priest/dps/",
    "Mage-Arcane": "https://www.wowsims.com/tbc/mage/dps/",
    "Mage-Fire": "https://www.wowsims.com/tbc/mage/dps/",
    "Mage-Frost": "https://www.wowsims.com/tbc/mage/dps/",
    "Warlock-Destruction": "https://www.wowsims.com/tbc/warlock/dps/",
    "Warlock-Affliction": "https://www.wowsims.com/tbc/warlock/dps/",
    "Warlock-Demonology": "https://www.wowsims.com/tbc/warlock/dps/",
    "Druid-Balance": "https://www.wowsims.com/tbc/druid/balance/",
    "Shaman-Elemental": "https://www.wowsims.com/tbc/shaman/elemental/",
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
const getItemSearch = withUser({}, async ({ user, res, url }) => {
    if (!userCan(user, "lootcouncil", "read")) return apiError(res, 403, "forbidden", "Kein Zugriff auf den Loot-Council.");
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
});

/**
 * POST /api/lootcouncil/armory — fetch the current gear of these raiders from
 * the armory, so the page stops judging them on their last logged raid.
 *
 * Deliberately a button and not a page load. It is a call per raider to an API
 * outside this app: doing it on every view would make the council slow and
 * would spend somebody else's rate limit on a page nobody is reading. And it is
 * a decision — "nimm den Stand von jetzt" — which belongs to the reader.
 */
const postArmoryRefresh = withUser({ write: "lootcouncil", csrf: true, body: true }, async ({ body, res }) => {
    const characters = Array.isArray(body.characters) ? body.characters : [];
    if (!characters.length) return apiError(res, 400, "bad_request", "Keine Charaktere angegeben.");

    const result = await primeArmoryGear(characters, { full: true, force: true });
    if (!result.configured) {
        return apiError(res, 400, "armory_not_configured", "Für die Armory fehlen die Battle.net-Zugangsdaten (Einstellungen → Verbindungen).");
    }
    ok(res, result);
});

/**
 * POST /api/lootcouncil/loggear — load one raider's gear from a Warcraft-Logs
 * report, or forget a loaded one.
 * Body: { character, reportId?, link?, clear? }
 *
 * Without reportId/link the bot's newest logs are tried in turn. A loaded log
 * replaces the armory's answer for that raider (it is the newer request), so
 * the armory cache entry is dropped with it.
 */
const postLogGear = withUser({ write: "lootcouncil", csrf: true, body: true }, async ({ body, res }) => {
    const character = String(body.character || "").trim();
    if (!character) return apiError(res, 400, "bad_request", "Kein Charakter angegeben.");
    if (body.clear) {
        // "Zurück zur Auswertung": both hand-picked sources go, the loaded log
        // and the armory answer, so the evaluations' set is what shows next.
        const cleared = clearLogGear(character);
        clearArmoryFor(character);
        return ok(res, { cleared });
    }
    try {
        const { snapshot, tried } = await loadLogGear(character, { reportId: body.reportId, link: body.link });
        clearArmoryFor(character);
        ok(res, {
            reportId: snapshot.reportId,
            reportTitle: snapshot.reportTitle,
            reportStart: snapshot.reportStart,
            items: snapshot.armory.length,
            tried,
        });
    } catch (e) {
        if (e && e.logGear) return apiError(res, e.status || 404, "log_gear", e.message);
        throw e;
    }
});

/**
 * GET /api/lootcouncil/bislists?tier=… — which gear set is BiS for which caster
 * DPS class and spec, as the matrix the tab draws (see web/bisLists.js).
 */
const getBisLists = withUser({}, async ({ user, res, url }) => {
    if (!userCan(user, "lootcouncil", "read")) return apiError(res, 403, "forbidden", "Kein Zugriff auf den Loot-Council.");
    ok(res, bisLists(url.searchParams.get("tier") || ""));
});

/** GET /api/lootcouncil/sim?id=… — poll a running simulation. */
const getLootCouncilSim = withUser({}, async ({ user, res, url }) => {
    if (!userCan(user, "lootcouncil", "read")) return apiError(res, 403, "forbidden", "Kein Zugriff auf den Loot-Council.");
    const job = getJob(url.searchParams.get("id") || "");
    if (!job) return ok(res, { status: "unknown" });
    ok(res, job);
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/lootcouncil", handler: getLootCouncil, area: "lootcouncil" },
    { method: "GET", path: "/api/lootcouncil/export", handler: getExport, area: "lootcouncil" },
    { method: "POST", path: "/api/lootcouncil/exclude", handler: postExclude, area: "lootcouncil" },
    { method: "GET", path: "/api/lootcouncil/item-search", handler: getItemSearch, area: "lootcouncil" },
    { method: "POST", path: "/api/lootcouncil/role", handler: postRole, area: "lootcouncil" },
    { method: "POST", path: "/api/lootcouncil/armory", handler: postArmoryRefresh, area: "lootcouncil" },
    { method: "POST", path: "/api/lootcouncil/loggear", handler: postLogGear, area: "lootcouncil" },
    { method: "GET", path: "/api/lootcouncil/bislists", handler: getBisLists, area: "lootcouncil" },
    { method: "GET", path: "/api/lootcouncil/sim", handler: getLootCouncilSim, area: "lootcouncil" },
    { method: "POST", path: "/api/lootcouncil/sim", handler: postLootCouncilSim, area: "lootcouncil" },
];

module.exports = {
    getLootCouncil, postLootCouncilSim, getLootCouncilSim,
    getItemSearch, getBisLists, postExclude, postRole, getExport, postArmoryRefresh, postLogGear,
    routes,
};
