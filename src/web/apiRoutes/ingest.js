// POST /api/ingest/loot — the one endpoint the loot-sync companion tool talks to.
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
const { ok, error } = require("../apiResponse");
const { readJsonBody } = require("../apiBody");
const { activeGuildFor } = require("../activeGuild");
const { loadEventGroups, eventLookbackSince } = require("../raidEventGroups");
const { addImport: addLootImport, eventsWithLoot } = require("../lootStore");
const { rememberFromLoot } = require("../characterInfo");
const { parseEventHelperSessions, enrichItemNames, LootParseError } = require("../../utils/lootImport");
const { bestDayMatch } = require("../lootEventMatch");
const { verifyToken, touchToken, bearerFrom } = require("../ingestTokenStore");
const { upsertPending, resolutionFor, noteAppended, listPending } = require("../lootInboxStore");

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
 * loot is already in the history for it ("done"), whether one of the tool's
 * local sessions falls on its day and could be uploaded for it ("ready"), or
 * neither ("empty"). Pure and side-effect-free — the caller supplies
 * everything read from disk/the Raid-Helper API, so this is unit-testable with
 * plain object literals, no mocking needed.
 *
 * A session already sitting in the inbox (pending or resolved) is never
 * offered as "ready" again — re-clicking upload for a raid that was already
 * sent would just look like nothing happened. Its event still counts as
 * "done" once resolved, or once the suggested match from its (possibly still
 * unconfirmed) inbox entry names an event, so the desktop tool doesn't ask
 * for a raid the raidleader already uploaded, just because an admin hasn't
 * confirmed it yet.
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
        const suggested = pendingBySession.get(sessionId)?.match?.suggested;
        if (suggested && suggested.eventId) doneEventIds.add(suggested.eventId);
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
            const session = done ? null : readyByEventId.get(ev.id) || null;
            return {
                eventId: ev.id,
                title: ev.title || ev.id,
                startTime: Number(ev.startTime) || 0,
                categoryId: ev.categoryId || "",
                categoryName: ev.categoryName || "",
                source: ev.source || "",
                status: done ? "done" : session ? "ready" : "empty",
                matchedSessionId: session ? session.sessionId : null,
                itemCount: session ? Number(session.items) || 0 : null,
                gargul: session ? Number(session.gargul) || 0 : null,
                rclc: session ? Number(session.rclc) || 0 : null,
            };
        })
        .sort((a, b) => b.startTime - a.startTime);
}

/**
 * POST /api/ingest/raids — same bearer-token auth as ingestLoot above. The
 * loot-sync tool sends its local sessions' aggregate fields (no item detail
 * needed) and gets back the recent raids with their status, so its raid list
 * can show "done"/"ready"/"empty" without re-implementing the Europe/Berlin
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

module.exports = { ingestLoot, ingestRaidStatus, computeRaidStatus };
