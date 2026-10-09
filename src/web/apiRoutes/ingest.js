// POST /api/ingest/loot — the main endpoint the loot-sync companion tool talks to
// (plus /api/ingest/raids for its raid list, /api/ingest/guildbank for guild
// bank scans and /api/ingest/guildbank/handouts for the in-game hand-out list).
//
// Unlike every other /api/* route this one has no Discord session behind it: the
// uploader runs unattended on a raidleader's PC and authenticates with a bearer
// token (ingestTokenStore.js). apiAccess.js therefore exempts it from the
// session gate and this handler does the whole auth itself.
//
// Nothing uploaded here becomes loot history on its own. A session lands in the
// inbox for a human to confirm — except when that same session was already
// accepted before, in which case its new items append straight to the event it
// was accepted into (see lootInboxStore.js's header for why that matters).
const { ok, error } = require("../http/apiResponse");
const { readJsonBody } = require("../http/apiBody");
const { activeGuildFor } = require("../http/activeGuild");
const { loadEventGroups, eventLookbackSince } = require("../../services/events/raidEventGroups");
const { addImport: addLootImport, eventsWithLoot } = require("../../stores/lootStore");
const { rememberFromLoot } = require("../../services/characters/characterInfo");
const { parseEventHelperSessions, enrichItemNames, LootParseError } = require("../../utils/loot/lootImport");
const { linkItemsForImport } = require("../../services/loot/lootVersion");
const { bestDayMatch } = require("../loot/lootEventMatch");
const { verifyToken, touchToken, bearerFrom } = require("../../stores/ingestTokenStore");
const { upsertPending, resolutionFor, noteAppended, listPending } = require("../../stores/lootInboxStore");
const { councilRoster } = require("../loot/lootCouncil");
const { councilOptsFromQuery, categoryOptions } = require("../loot/councilQuery");
const { councilSyncPayload, councilSyncPayloadV2, councilSyncPayloadV3 } = require("../loot/councilSync");
const { councilCategoryIds, categoryInstances, categoryCouncil } = require("../loot/councilView");
const { getConfig } = require("../../stores/settingsStore");
const { listKnownCategories } = require("../../services/discord/categoryNames");
const { ingestScan } = require("../../services/guildbank/guildBankStock");
const { queueLookups } = require("../../services/guildbank/itemMeta");
const { queueItemEmojiSync } = require("../../services/guildbank/itemEmojis");
const { GuildBankParseError } = require("../../utils/guildbank/guildBankScan");
const { handoutList, reportHandouts, HandoutReportError } = require("../../services/guildbank/handouts");

/** The token behind the request, or null after sending the 401. */
function requireToken(req, res) {
    const raw = bearerFrom(req);
    if (!raw) {
        error(res, 401, "no_token", "Kein API-Token übermittelt (Authorization: Bearer …).");
        return null;
    }
    const token = verifyToken(raw);
    if (!token) {
        error(res, 401, "bad_token", "API-Token unbekannt oder zurückgezogen.");
        return null;
    }
    return token;
}

/**
 * When a session started, in ms. The addon's own session start is the honest
 * answer; the earliest award is the fallback for a payload that didn't carry one.
 */
function sessionTime(session) {
    if (session.startedAt) return session.startedAt;
    const times = session.items.map((i) => i.awardedAt || 0).filter(Boolean);
    return times.length ? Math.min(...times) : 0;
}

/**
 * The Raid-Helper event a session most likely belongs to, as a *suggestion* only
 * — the admin confirms it in the inbox. Best-effort: if Raid-Helper is
 * unreachable the upload still succeeds without a suggestion, because losing the
 * raid's loot to a failed API call would be far worse than losing the convenience.
 */
async function suggestMatch(req, session) {
    const at = sessionTime(session);
    if (!at) return null;
    try {
        const { groups } = await loadEventGroups(activeGuildFor(req), { sinceSeconds: eventLookbackSince() });
        const all = groups.flatMap((g) => g.events.map((ev) => ({ ev, g })));
        const { match, candidates, ambiguous } = bestDayMatch(at, all.map((x) => x.ev));
        const shape = (ev) => {
            const found = all.find((x) => x.ev === ev);
            return {
                eventId: ev.id,
                eventLabel: ev.title || ev.id,
                startTime: Number(ev.startTime) || 0,
                categoryId: found ? (found.g.categoryId || "") : "",
                categoryName: found ? (found.g.categoryName || "") : "",
            };
        };
        return {
            ambiguous,
            suggested: match ? shape(match) : null,
            candidates: candidates.map(shape),
        };
    } catch (e) {
        console.error("ingest: event match failed:", (e && e.message) || e);
        return null;
    }
}

async function ingestLoot(req, res) {
    const token = requireToken(req, res);
    if (!token) return;

    const body = await readJsonBody(req);
    let parsed;
    try {
        parsed = parseEventHelperSessions(body);
    } catch (e) {
        return error(res, 400, "parse_failed", e instanceof LootParseError ? e.message : "Upload konnte nicht gelesen werden.");
    }
    touchToken(token.id);

    const { meta, sessions } = parsed;
    const results = [];
    for (const session of sessions) {
        if (!session.items.length) {
            results.push({ sessionId: session.sessionId, status: "empty", added: 0 });
            continue;
        }
        const prior = resolutionFor(session.sessionId);
        if (prior && prior.action === "dismissed") {
            results.push({ sessionId: session.sessionId, status: "dismissed", added: 0 });
            continue;
        }
        await enrichItemNames(session.items);

        if (prior && prior.action === "accepted" && prior.eventId) {
            // Already confirmed once — the rest of the raid needs no second click.
            linkItemsForImport(session.items, { eventId: prior.eventId, categoryId: prior.categoryId });
            const { added, skipped } = addLootImport(prior.eventId, session.items, {
                categoryId: prior.categoryId,
                eventLabel: prior.eventLabel,
            });
            if (added) {
                rememberFromLoot(session.items);
                // Shown as "+n nachgeliefert" in the inbox's linked list.
                noteAppended(session.sessionId, added);
            }
            results.push({
                sessionId: session.sessionId,
                status: "appended",
                eventId: prior.eventId,
                eventLabel: prior.eventLabel,
                added,
                skipped,
            });
            continue;
        }

        const match = await suggestMatch(req, session);
        const { entry, added, created } = upsertPending(session, {
            realm: meta.realm,
            reporter: meta.reporter,
            addonVersion: meta.addonVersion,
            tokenId: token.id,
            tokenName: token.name,
            match,
        });
        results.push({
            sessionId: session.sessionId,
            status: created ? "pending" : "updated",
            inboxId: entry.id,
            added,
            total: entry.itemCount,
            suggested: match && match.suggested ? match.suggested.eventLabel : "",
        });
    }

    ok(res, { received: sessions.length, results }, 201);
}

/**
 * Status of each recent raid event for the loot-sync tool's raid list: whether
 * loot is already in the history for it ("done"), whether an upload for it
 * waits unconfirmed in the Addon-Inbox ("pending"), whether one of the tool's
 * local sessions falls on its day and could be uploaded for it ("ready"), or
 * neither ("empty"). Pure and side-effect-free — the caller supplies
 * everything read from disk/the Raid-Helper API, so this is unit-testable with
 * plain object literals, no mocking needed.
 *
 * A session already sitting in the inbox (pending or resolved) is never
 * offered as "ready" again — re-clicking upload for a raid that was already
 * sent would just look like nothing happened. "done" means the loot really is
 * in the history (or the session was accepted into the event); an inbox card
 * that only *suggests* the event is "pending", whichever PC uploaded it. It
 * used to count as "done", and the tool then showed "Importiert" for a raid
 * whose loot page was still empty.
 *
 * @param {object[]} events    recent events (both sources), as loadEventGroups() gives them,
 *                             each already carrying its own `categoryId`/`categoryName`
 * @param {object[]} sessions  the sync tool's local sessions:
 *                             { sessionId, startedAt, items, gargul, rclc, excluded }
 * @param {{ lootedEventIds: Set<string>, pending: object[], resolutionFor: (id: string) => object|null }} known
 */
function computeRaidStatus(events, sessions, { lootedEventIds, pending, resolutionFor: resolveSession }) {
    const pendingBySession = new Map(pending.map((p) => [p.sessionId, p]));
    const alreadySent = (sessionId) => pendingBySession.has(sessionId) || Boolean(resolveSession(sessionId));

    const doneEventIds = new Set(lootedEventIds);
    for (const session of sessions) {
        const sessionId = String(session.sessionId || "");
        if (!sessionId) continue;
        const resolved = resolveSession(sessionId);
        if (resolved && resolved.eventId) doneEventIds.add(resolved.eventId);
    }

    // Every unconfirmed inbox card that names an event — not only the ones
    // this PC sent: a card from another raidleader's upload waits just as much.
    const inboxByEventId = new Map();
    for (const entry of pending) {
        const eventId = entry?.match?.suggested?.eventId;
        if (eventId && !inboxByEventId.has(eventId)) inboxByEventId.set(eventId, entry);
    }

    const readyByEventId = new Map();
    for (const session of sessions) {
        if (session.excluded) continue;
        const sessionId = String(session.sessionId || "");
        if (!sessionId || alreadySent(sessionId)) continue;
        const at = Number(session.startedAt) || 0;
        if (!at) continue;
        const { match } = bestDayMatch(at, events);
        if (match && !readyByEventId.has(match.id)) readyByEventId.set(match.id, session);
    }

    return events
        .map((ev) => {
            const done = doneEventIds.has(ev.id);
            const inbox = done ? null : inboxByEventId.get(ev.id) || null;
            const session = done || inbox ? null : readyByEventId.get(ev.id) || null;
            return {
                eventId: ev.id,
                title: ev.title || ev.id,
                startTime: Number(ev.startTime) || 0,
                categoryId: ev.categoryId || "",
                categoryName: ev.categoryName || "",
                source: ev.source || "",
                status: done ? "done" : inbox ? "pending" : session ? "ready" : "empty",
                matchedSessionId: session ? session.sessionId : null,
                itemCount: session ? Number(session.items) || 0 : null,
                gargul: session ? Number(session.gargul) || 0 : null,
                rclc: session ? Number(session.rclc) || 0 : null,
                // How much waits in the inbox card — "41 Items warten auf Bestätigung".
                inboxItems: inbox ? Number(inbox.itemCount) || (inbox.items || []).length : null,
            };
        })
        .sort((a, b) => b.startTime - a.startTime);
}

/**
 * POST /api/ingest/raids — same bearer-token auth as ingestLoot above. The
 * loot-sync tool sends its local sessions' aggregate fields (no item detail
 * needed) and gets back the recent raids with their status, so its raid list
 * can show "done"/"pending"/"ready"/"empty" without re-implementing the Europe/Berlin
 * day-match this project already trusts for the real upload (see
 * computeRaidStatus() and lootEventMatch.js's bestDayMatch()).
 */
async function ingestRaidStatus(req, res) {
    const token = requireToken(req, res);
    if (!token) return;
    touchToken(token.id);

    const body = await readJsonBody(req);
    const sessions = Array.isArray(body.sessions) ? body.sessions : [];

    const guildId = activeGuildFor(req);
    const { groups } = await loadEventGroups(guildId, { sinceSeconds: eventLookbackSince() });
    const events = groups.flatMap((g) => g.events.map((ev) => ({
        ...ev,
        categoryId: g.categoryId || "",
        categoryName: g.categoryName || "",
    })));

    const raids = computeRaidStatus(events, sessions, {
        lootedEventIds: new Set(eventsWithLoot().map((e) => e.eventId)),
        pending: listPending(),
        resolutionFor,
    });

    ok(res, { raids });
}

/**
 * GET /api/ingest/council - the slim loot-council roster for the sync tool,
 * same bearer-token auth as the uploads. The tool writes it into a Lua file the
 * in-game addon reads: each raider's need weighting and what they received.
 *
 * Three versions (docs/loot-import.md):
 *   v3 - `?v=3` (or higher) and no `category`: version 2 with every council
 *        role, the roster status, loot points, tenure and each category's own
 *        weighting and item classes (#670) - the sync tools from 1.14.0.
 *   v2 - `?v=2` (or `?categories=council`) and no `category`: every category
 *        whose loot system is Loot-Council, each built with the view the orga
 *        stored for it on the council page (role, tiers, raids, BiS list,
 *        version) through the page's own path, armory step included
 *        (councilView.js) - the game shows exactly what the page shows.
 *   v1 - everything else, unchanged for the sync tools up to 1.9.0, which send
 *        `category`/`role` and accept only version 1: one category, filtered by
 *        those two only, stored data only.
 */
async function ingestCouncil(req, res, url) {
    const token = requireToken(req, res);
    if (!token) return;
    touchToken(token.id);

    const params = url ? url.searchParams : new URLSearchParams();
    if (!params.has("category") && Number(params.get("v")) >= 3) {
        return ok(res, councilSyncPayloadV3(await councilEntries(req)));
    }
    if (!params.has("category") && (params.get("v") === "2" || params.get("categories") === "council")) {
        return ok(res, councilSyncPayloadV2(await councilEntries(req)));
    }
    // v1: only the two documented filters count; the tool never narrows by tier or version.
    const opts = councilOptsFromQuery(new URLSearchParams({
        category: params.get("category") || "",
        role: params.get("role") || "",
    }));
    const built = councilRoster(opts);
    ok(res, councilSyncPayload(built, {
        categoryId: opts.categoryId,
        categories: categoryOptions(activeGuildFor(req)),
        role: opts.role,
        bisTierDerived: !opts.bisTier,
    }));
}

/**
 * Every Loot-Council category with its profile's view, one after another (the
 * armory cache is shared) - what versions 2 and 3 are built from.
 *
 * Since #676 a council runs per roster: a roster with category runs on the
 * category's loot system, so "every Loot-Council roster with category" plus
 * "every Loot-Council category without roster" is exactly the list of
 * Loot-Council categories - `id` stays the category id, weights and view come
 * from the roster's profile (categoryCouncil). A roster WITHOUT category is
 * left out: the addon picks a council by the raid's instances, and such a
 * roster has no raid template to name them (docs/loot-import.md).
 */
async function councilEntries(req) {
    const config = getConfig();
    // Live names first, else the ones seen earlier (categoryNames.js) - the
    // token request has no session, so the active guild may be a guess.
    const names = new Map(listKnownCategories(activeGuildFor(req)).filter((c) => c.name).map((c) => [c.id, c.name]));
    const entries = [];
    for (const id of councilCategoryIds(config)) {
        const { opts, built, profile, roster } = await categoryCouncil(id);
        entries.push({ id, name: names.get(id) || id, opts, built, instances: categoryInstances(config, id), profile, roster });
    }
    return entries;
}

/**
 * POST /api/ingest/guildbank — a guild bank scan from the sync tool
 * (`eventhelper-guildbank` v1, utils/guildbank/guildBankScan.js), same
 * bearer-token auth as the loot upload. The scan replaces the bank's stock;
 * what the orga decided per item stays (stores/guildBankStockStore.js). Item
 * names are looked up on Wowhead only after the answer went out.
 */
async function ingestGuildBank(req, res) {
    const token = requireToken(req, res);
    if (!token) return;

    const body = await readJsonBody(req);
    let result;
    try {
        result = ingestScan(body, { token });
    } catch (e) {
        if (e instanceof GuildBankParseError) return error(res, 400, "parse_failed", e.message);
        throw e;
    }
    touchToken(token.id);

    const { scan, status, bank, newItems, lookups } = result;
    ok(res, {
        status,
        bankKey: bank.key,
        gameVersion: bank.gameVersion,
        guild: bank.guild,
        realm: bank.realm,
        pending: bank.pending,
        scannedAt: bank.scannedAt,
        tabs: scan.tabs.length,
        items: Object.keys(scan.items).length,
        newItems: newItems.length,
    }, 201);
    if (lookups.length) queueLookups(bank.gameVersion, lookups);
    // items already on "give" get (or keep) their emoji (#633); the sync runs in the background
    if (status !== "stale" && bank.counts && bank.counts.give > 0) queueItemEmojiSync();
}

/**
 * GET /api/ingest/guildbank/handouts[?bank=<key>] — the confirmed guild bank
 * requests per bank for the addon's hand-out list (#634), same bearer-token
 * auth. Format "eventhelper-guildbank-handouts" v1, services/guildbank/handouts.js.
 */
async function ingestHandoutList(req, res, url) {
    const token = requireToken(req, res);
    if (!token) return;
    touchToken(token.id);
    const bankKey = url ? url.searchParams.get("bank") || "" : "";
    ok(res, handoutList({ token, bankKey }));
}

/**
 * POST /api/ingest/guildbank/handouts { done: [id | { id, via, by, at }] } —
 * what was ticked off (or mailed) in game: each confirmed request is handed
 * out. Idempotent; per-id results, never a failure for a bad id.
 */
async function ingestHandoutReport(req, res) {
    const token = requireToken(req, res);
    if (!token) return;
    const body = await readJsonBody(req);
    let result;
    try {
        result = await reportHandouts(body, { token });
    } catch (e) {
        if (e instanceof HandoutReportError) return error(res, 400, "parse_failed", e.message);
        throw e;
    }
    touchToken(token.id);
    ok(res, result);
}

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "POST", path: "/api/ingest/loot", handler: ingestLoot, auth: "token" },
    { method: "POST", path: "/api/ingest/raids", handler: ingestRaidStatus, auth: "token" },
    { method: "GET", path: "/api/ingest/council", handler: ingestCouncil, auth: "token" },
    { method: "POST", path: "/api/ingest/guildbank", handler: ingestGuildBank, auth: "token" },
    { method: "GET", path: "/api/ingest/guildbank/handouts", handler: ingestHandoutList, auth: "token" },
    { method: "POST", path: "/api/ingest/guildbank/handouts", handler: ingestHandoutReport, auth: "token" },
];

module.exports = { ingestLoot, ingestRaidStatus, ingestCouncil, ingestGuildBank, ingestHandoutList, ingestHandoutReport, computeRaidStatus, routes };
