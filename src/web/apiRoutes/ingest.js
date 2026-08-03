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
const { addImport: addLootImport } = require("../lootStore");
const { rememberFromLoot } = require("../characterInfo");
const { parseEventHelperSessions, enrichItemNames, LootParseError } = require("../../utils/lootImport");
const { bestDayMatch } = require("../lootEventMatch");
const { verifyToken, touchToken, bearerFrom } = require("../ingestTokenStore");
const { upsertPending, resolutionFor } = require("../lootInboxStore");

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
            if (added) rememberFromLoot(session.items);
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

module.exports = { ingestLoot };
