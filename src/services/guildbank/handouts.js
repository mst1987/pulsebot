// The guild bank hand-out list for the in-game addon (#634, epic #635): the
// sync tool pulls the confirmed requests (GET /api/ingest/guildbank/handouts),
// the addon shows them as a list to tick off (eventhelper-addon#17) or fills
// the mail with them (eventhelper-addon#18), and the sync tool reports the
// ticked ones back (POST /api/ingest/guildbank/handouts). Same bearer token as
// the scan upload; the shapes are documented in docs/loot-import.md
// ("Ausgabeliste für das Addon").
//
// Format "eventhelper-guildbank-handouts" version 1, shared with the
// eventhelper-addon repo: when a field changes, VERSION grows on both sides.
// All times are unix SECONDS (Lua's time()), strings plain UTF-8.
//
// Reporting back moves a request confirmed -> handedOut through
// services/signups/guildBank.handOutRequest (card redrawn, raider DMed). The
// stock is never changed here: reservations.handedOutSince takes a handed-out
// amount off "Verfügbar" until the next scan. Idempotent: an id reported again
// is answered as `duplicate` and touches nothing.
const store = require("../../stores/guildBankStore");
const stockStore = require("../../stores/guildBankStockStore");
const profiles = require("../../stores/raiderProfileStore");
const stockView = require("./stockView");
const guildBank = require("../signups/guildBank");
const { serverOfToken } = require("./guildBankStock");

const FORMAT = "eventhelper-guildbank-handouts";
const VERSION = 1;
/** How many ids one report may carry. */
const MAX_DONE = 200;
const ID_MAX = 40;
const BY_MAX = 60;
const VIAS = ["manual", "mail"];

const str = (v) => String(v === undefined || v === null ? "" : v).trim();
const seconds = (ms) => (Number(ms) > 0 ? Math.floor(Number(ms) / 1000) : 0);

/** The profile's class id ("Priest", "DK") as the game's class token ("PRIEST", "DEATHKNIGHT"); "" when unknown. */
function classFileOf(className) {
    const key = str(className).toUpperCase().replace(/[\s_-]/g, "");
    if (!key) return "";
    return key === "DK" ? "DEATHKNIGHT" : key;
}

/** The recipient of a request in game, or null when the raider has no character of the bank's version. */
function characterOf(request, bank) {
    const name = str(request.characterName);
    if (!name) return null;
    let classFile = "";
    try {
        const c = profiles.findCharacter(profiles.getProfile(request.userId), name, bank.gameVersion);
        classFile = c ? classFileOf(c.className) : "";
    } catch {
        // a broken profile never costs the hand-out its recipient
    }
    return {
        name,
        realm: str(request.realm) || bank.realm,
        faction: str(request.faction) || bank.faction,
        classFile,
    };
}

/** One confirmed request as the addon reads it. */
function handoutView(request, bank) {
    const stock = stockView.stockItem(bank.key, request.itemId);
    const tabNames = new Map((bank.tabs || []).map((t) => [String(t.index), t.name || ""]));
    const tabs = stock
        ? Object.entries(stock.tabs || {})
            .map(([index, count]) => ({ index: Number(index), name: tabNames.get(String(index)) || "", count: Number(count) || 0 }))
            .filter((t) => t.index > 0 && t.count > 0)
            .sort((a, b) => a.index - b.index)
        : [];
    const quality = stock && Number.isInteger(stock.quality) ? stock.quality : -1;
    return {
        id: request.id,
        itemId: request.itemId,
        name: (stock && stock.name) || request.item || `Item ${request.itemId}`,
        icon: (stock && stock.icon) || request.icon || "",
        quality,
        amount: request.amount,
        purpose: request.purpose,
        character: characterOf(request, bank),
        requestedBy: request.userName,
        requestedAt: seconds(request.createdAt),
        confirmedBy: request.handledByName,
        confirmedAt: seconds(request.handledAt),
        // in the bank's visible tabs by the last scan, minus what was handed out since
        inBank: stock ? Math.max(0, (Number(stock.count) || 0) - (Number(stock.handedOut) || 0)) : 0,
        tabs,
    };
}

/**
 * The banks a token may see: every bank assigned to a Discord server (tokens
 * carry no server today), or only its server's when it has one
 * (guildBankStock.serverOfToken). `bankKey` narrows to one bank.
 */
function banksFor(token, bankKey = "") {
    const server = serverOfToken(token);
    const key = str(bankKey).toLowerCase();
    return stockStore.listBanks()
        .filter((b) => b.guildId && (!server || b.guildId === server) && (!key || b.key === key))
        .map((b) => stockStore.getBank(b.key))
        .filter(Boolean);
}

/**
 * The hand-out list: per bank its confirmed requests from the stock (oldest
 * confirmation first). A bank without any is listed with `handouts: []`, so the
 * addon can clear its list.
 * @param {{ token?: object, bankKey?: string, now?: number }} [o]
 */
function handoutList({ token = {}, bankKey = "", now = Date.now() } = {}) {
    const confirmed = store.listRequests({ status: "confirmed" }).filter((r) => r.itemId > 0 && r.bankKey);
    const banks = banksFor(token, bankKey).map((bank) => ({
        key: bank.key,
        gameVersion: bank.gameVersion,
        realm: bank.realm,
        guild: bank.guild,
        faction: bank.faction,
        scannedAt: seconds(bank.scannedAt),
        handouts: confirmed
            .filter((r) => r.bankKey === bank.key)
            .sort((a, b) => (a.handledAt || a.createdAt) - (b.handledAt || b.createdAt))
            .map((r) => handoutView(r, bank)),
    }));
    return { format: FORMAT, version: VERSION, generatedAt: seconds(now), banks };
}

/** Thrown for a report that is no report (400 in the route). */
class HandoutReportError extends Error {}

/** One entry of `done` (an id, or `{ id, via, by, at }`) as `{ id, via, by, at }`, or null. */
function doneEntry(raw) {
    const entry = raw && typeof raw === "object" ? raw : { id: raw };
    if (typeof entry.id !== "string" && typeof entry.id !== "number") return null;
    const id = str(entry.id).slice(0, ID_MAX);
    if (!id) return null;
    return {
        id,
        via: VIAS.includes(entry.via) ? entry.via : "manual",
        by: str(typeof entry.by === "string" ? entry.by : "").replace(/\s+/g, " ").slice(0, BY_MAX),
        at: Number.isFinite(Number(entry.at)) ? Math.floor(Number(entry.at)) : 0,
    };
}

/**
 * The report's `done` list, checked: at most MAX_DONE entries, each id once
 * (the first entry wins).
 * @throws {HandoutReportError}
 */
function parseReport(body) {
    const done = body && typeof body === "object" ? body.done : undefined;
    if (!Array.isArray(done)) throw new HandoutReportError("`done` fehlt oder ist keine Liste.");
    if (done.length > MAX_DONE) throw new HandoutReportError(`Höchstens ${MAX_DONE} Einträge je Meldung.`);
    const seen = new Set();
    const entries = [];
    let invalid = 0;
    for (const raw of done) {
        const entry = doneEntry(raw);
        if (!entry) {
            invalid += 1;
            continue;
        }
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        entries.push(entry);
    }
    return { entries, invalid };
}

/**
 * When the hand-out happened, in ms: the addon's `at` (unix s) when it is
 * plausible — not in the future, not older than the request's confirmation —
 * else now. It matters for the stock: a hand-out before the bank's next scan is
 * in that scan already (reservations.handedOutSince).
 */
function handedOutAt(at, request, now) {
    const ms = at > 0 ? at * 1000 : 0;
    if (!ms || ms > now || ms < (Number(request.handledAt) || 0)) return now;
    return ms;
}

/** Whether a request belongs to a bank the token may report for. */
function inScope(request, token) {
    const server = serverOfToken(token);
    if (!server) return true;
    const bank = stockStore.getBank(request.bankKey);
    return !!bank && bank.guildId === server;
}

/**
 * Take the addon's report: each confirmed request in `done` is handed out
 * (card, DM). Never throws for a bad id — every id lands in exactly one list:
 *   ok            handed out now
 *   duplicate     handed out before (a second report, or the orga's button)
 *   notConfirmed  not (or no longer) confirmed: the orga released it, or it was declined
 *   unknown       no such request, a free-text one, or another server's
 * `invalid` counts the entries that were no id at all.
 * @throws {HandoutReportError} for a body without a `done` list or with too many entries
 */
async function reportHandouts(body, { token = {}, now = Date.now(), config } = {}) {
    const { entries, invalid } = parseReport(body);
    const result = { format: FORMAT, version: VERSION, ok: [], duplicate: [], notConfirmed: [], unknown: [], invalid };
    const tokenName = str(token && token.name);
    for (const { id, via, by, at } of entries) {
        const request = store.getRequest(id);
        if (!request || !request.itemId || !inScope(request, token)) {
            result.unknown.push(id);
            continue;
        }
        if (request.status === "handedOut") {
            result.duplicate.push(id);
            continue;
        }
        if (request.status !== "confirmed") {
            result.notConfirmed.push(id);
            continue;
        }
        const done = await guildBank.handOutRequest(id, {
            by: str(token && token.createdBy) || "addon",
            byName: by || tokenName || "Addon",
            via,
        }, { config, now: handedOutAt(at, request, now) });
        if (!done.error) result.ok.push(id);
        else if (done.request && done.request.status === "handedOut") result.duplicate.push(id);
        else if (done.request) result.notConfirmed.push(id);
        else result.unknown.push(id);
    }
    return result;
}

module.exports = {
    FORMAT, VERSION, MAX_DONE, HandoutReportError,
    classFileOf, handoutList, parseReport, reportHandouts,
};
