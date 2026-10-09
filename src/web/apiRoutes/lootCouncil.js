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
//   GET  /api/lootcouncil/views       — the stored filters per raid category
//   POST /api/lootcouncil/view        — store one (the addon uses them too)
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
const { bisGaps, candidateSplit, filterOptions, resolveContentFilter, itemView, bisSpecsView } = require("../loot/lootCouncil");
const { bisLists } = require("../loot/bisLists");
const { primeArmoryGear, clearArmoryFor } = require("../../services/loot/armoryGear");
const { loadLogGear, clearLogGear, recentLogs } = require("../../stores/logGearStore");
const { sourceForItem } = require("../../config/tbcContent");
const { startCouncilSim, getJob } = require("../../stores/simStore");
const { searchItems } = require("../../config/wowsims");
const councilStore = require("../../stores/councilStore");
const { gearFor, charKey } = require("../../services/loot/charGear");
const { characterMap } = require("../../stores/characterStore");
const { specFor, ROLES } = require("../../config/casterSpecs");
const engine = require("../../utils/wowsims/engine");
const { getConfig } = require("../../stores/settingsStore");
const { mainVersionFor } = require("../../services/events/mainVersion");
const { councilOptsFromQuery, categoryOptions } = require("../loot/councilQuery");
const { buildCouncilView, councilCategoryIds } = require("../loot/councilView");
const { settingsForVersion } = require("../../services/events/versionSettings");

/**
 * GET /api/lootcouncil — roster, BiS gaps and filter options.
 *
 * Query: role, tiers, contents, category, bisTier, bench (Ersatz from the
 * category's roster as candidates), item (candidates for one item)
 */
const getLootCouncil = withUser({}, async ({ user, req, res, url }) => {
    if (!userCan(user, "lootcouncil", "read")) return apiError(res, 403, "forbidden", "Kein Zugriff auf den Loot-Council.");

    const guildId = activeGuildFor(req);
    // The version the council looks at, the character filter and the rest of the
    // query: see councilQuery.js.
    const opts = councilOptsFromQuery(url.searchParams);
    const { role, tierIds, contentIds, categoryId, bisTier, versionId, config, mainVersion, charVersion } = opts;
    // Roster plus the armory step for boss-specific pieces: councilView.js,
    // shared with the sync tool's endpoint so the game sees the same numbers.
    const built = await buildCouncilView(opts);
    const {
        rows, avgLootCount, bisTier: usedBisTier, skipped, categorySources, versions, rosterSource, outsiders,
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
        // With a roster: who stood there without being in it, folded and unranked (#667).
        outsiders: outsiders || [],
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
            // The category's roster (#667): name, counts per status, whether
            // Ersatz is shown, and who it holds without a council spec.
            roster: rosterSource || null,
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
        versionId,
        // Where the page's item links go ("" = no Wowhead links for this version).
        wowheadPath: settingsForVersion(versionId, { config }).wowheadPath,
        // The character version filter (#545): what is shown ("" = all), the
        // default, and the choices — independent of `versionId` above.
        version: charVersion,
        mainVersion,
        versions,
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
 * GET /api/lootcouncil/views — die gespeicherte Ansicht je Raid-Kategorie
 * (Rolle, Tiers, Raids, BiS-Liste, Version) und welche Kategorien als
 * Loot-Council laufen. Mit genau dieser Ansicht rechnet auch das Addon im
 * Spiel (GET /api/ingest/council?v=2); ohne gespeicherte gilt `defaults`.
 */
const getViews = withUser({}, async ({ user, res }) => {
    if (!userCan(user, "lootcouncil", "read")) return apiError(res, 403, "forbidden", "Kein Zugriff auf den Loot-Council.");
    const views = {};
    for (const [categoryId, entry] of Object.entries(councilStore.listViews())) {
        const { role, tiers, contents, bisTier, version } = entry;
        views[categoryId] = { role, tiers, contents, bisTier, version };
    }
    ok(res, {
        views,
        defaults: { ...councilStore.VIEW_DEFAULTS, tiers: [], contents: [] },
        councilCategories: councilCategoryIds(getConfig()),
    });
});

/**
 * POST /api/lootcouncil/view — die Ansicht einer Kategorie speichern.
 * Body: { category, role, tiers, contents, bisTier, version }
 *
 * Ändert, was das Addon im Spiel für diese Kategorie zeigt — deshalb Schreibrecht
 * wie beim Ausplanen und der Rolle.
 */
const postView = withUser({ write: "lootcouncil", csrf: true, body: true }, async ({ user, body, res }) => {
    const category = String(body.category || "").trim();
    if (!category) return apiError(res, 400, "bad_request", "Keine Kategorie angegeben.");
    const entry = councilStore.setView(category, body, { by: user.name || user.id });
    const { role, tiers, contents, bisTier, version } = entry;
    ok(res, { category, view: { role, tiers, contents, bisTier, version } });
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

    const versionId = mainVersionFor({ categoryId: String(body.category || ""), config: getConfig() });
    const result = await primeArmoryGear(characters, { full: true, force: true, versionId });
    if (!result.configured) {
        if (result.reason === "version_not_configured") {
            return apiError(res, 400, "armory_not_configured", "Armory für diese Spielversion nicht eingerichtet (Einstellungen → Spielversion).");
        }
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
 * DPS class and spec, as the matrix the tab draws (see web/loot/bisLists.js).
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
    { method: "GET", path: "/api/lootcouncil/views", handler: getViews, area: "lootcouncil" },
    { method: "POST", path: "/api/lootcouncil/view", handler: postView, area: "lootcouncil" },
    { method: "POST", path: "/api/lootcouncil/armory", handler: postArmoryRefresh, area: "lootcouncil" },
    { method: "POST", path: "/api/lootcouncil/loggear", handler: postLogGear, area: "lootcouncil" },
    { method: "GET", path: "/api/lootcouncil/bislists", handler: getBisLists, area: "lootcouncil" },
    { method: "GET", path: "/api/lootcouncil/sim", handler: getLootCouncilSim, area: "lootcouncil" },
    { method: "POST", path: "/api/lootcouncil/sim", handler: postLootCouncilSim, area: "lootcouncil" },
];

module.exports = {
    getLootCouncil, postLootCouncilSim, getLootCouncilSim,
    getItemSearch, getBisLists, postExclude, postRole, getExport, postArmoryRefresh, postLogGear,
    getViews, postView,
    routes,
};
