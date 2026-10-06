// The guild bank items' icons as application emojis of the bot (#633): the
// request form's selects show each offered item with its WoW icon. An item set
// to "give" (Ausgebbar) in any bank gets an emoji `gb_<itemId>`, made from its
// zamimg icon (wowhead.iconUrl, the large 56 px jpg — Discord takes it as it
// is); an item no bank offers any more loses it again. One emoji per item id,
// shared by every bank and game version — it lives while at least one bank has
// the item on "give" (the "reference count" is guildBankStockStore.offeredIcons,
// computed, never stored). The emoji id is kept in the stock store
// (`emojis[itemId]`, item views read it as `emojiId`).
//
// Application emojis belong to the bot's application (max. 2000, independent of
// any server's slots); appEmojis.js holds the bot's own `eh_` icons, this module
// only ever touches `gb_` names. A full application is skipped with a log line.
//
// queueItemEmojiSync() is what the callers use (the web route that changes an
// item's status, the scan upload, the bot's start): it never blocks and never
// throws — it waits a moment (several clicks in a row become one run), runs one
// sync at a time, pauses between Discord calls and tries again later when a
// call failed or the bot was offline. Without an emoji the select shows the item
// without one.
const { Routes } = require("discord.js");
const stockStore = require("../../stores/guildBankStockStore");
const discord = require("../discord/discord");
const { downloadIcon } = require("../discord/appEmojiSync");
const { iconUrl } = require("../../utils/loot/wowhead");
const logger = require("../../logger");

const PREFIX = "gb_";
/** Discord's limit of application emojis. */
const MAX_APP_EMOJIS = 2000;
/** How long a queued sync waits for more changes. */
const DEBOUNCE_MS = 2000;
/** The pause between two emoji calls (create / delete) of one run. */
const PAUSE_MS = 1000;
/** When a failed or skipped run is tried again. */
const RETRY_MS = 15 * 60 * 1000;

/** "gb_22854" — 2–32 characters of [a-z0-9_]. */
const emojiName = (itemId) => `${PREFIX}${Math.floor(Number(itemId) || 0)}`;
/** The item id of a `gb_<id>` name, 0 for any other name. */
const itemIdOfName = (name) => (/^gb_\d+$/.test(String(name || "")) ? Number(String(name).slice(PREFIX.length)) : 0);

const defaultSleep = (ms) => new Promise((resolve) => { const t = setTimeout(resolve, ms); if (t.unref) t.unref(); });

/** The application's emojis (`GET /applications/{id}/emojis` answers `{ items }`). */
async function listAppEmojis(rest, appId) {
    const res = await rest.get(Routes.applicationEmojis(appId));
    return (Array.isArray(res) ? res : (res && res.items) || []).filter((e) => e && e.id && e.name);
}

const errorText = (e) => (e && e.message) || String(e);

/** One run's Discord side: the application's emojis, how many there are, a pause between calls. */
function runContext({ rest, appId, app, sleep, fetchImpl, now }) {
    const ctx = {
        rest, appId, fetchImpl, now,
        appById: new Map(app.map((e) => [String(e.id), e])),
        appByItem: new Map(app.filter((e) => itemIdOfName(e.name)).map((e) => [String(itemIdOfName(e.name)), e])),
        total: app.length,
        first: true,
        out: { created: [], deleted: [], adopted: [], failed: [], full: [] },
    };
    ctx.pause = async () => { if (!ctx.first) await sleep(PAUSE_MS); ctx.first = false; };
    ctx.remove = async (emojiId) => {
        await ctx.pause();
        try {
            await rest.delete(Routes.applicationEmoji(appId, emojiId));
            ctx.total -= 1;
        } catch (e) {
            // already gone is fine (Unknown Emoji, 10014)
            if (!(e && (e.code === 10014 || e.status === 404))) throw e;
        }
    };
    return ctx;
}

/** Step 1: forget (and delete) the emojis of items no bank offers any more, or whose icon changed or that are gone. */
async function dropStale(ctx, wanted) {
    for (const [itemId, emoji] of Object.entries(stockStore.itemEmojis())) {
        const inApp = ctx.appById.has(emoji.id);
        if (wanted[itemId] && wanted[itemId] === emoji.icon && inApp) continue;
        try {
            if (inApp) await ctx.remove(emoji.id);
            ctx.appByItem.delete(itemId);
            stockStore.setItemEmoji(itemId, null);
            if (!wanted[itemId]) ctx.out.deleted.push(Number(itemId));
        } catch (e) {
            ctx.out.failed.push({ itemId: Number(itemId), error: errorText(e) });
        }
    }
}

/** Step 2: stray `gb_` emojis nobody remembers — adopt an offered item's (same icon assumed), delete the rest. */
async function sweepStrays(ctx, wanted) {
    const remembered = stockStore.itemEmojis();
    for (const [itemId, e] of ctx.appByItem) {
        if (remembered[itemId]) continue;
        if (wanted[itemId]) {
            stockStore.setItemEmoji(itemId, { id: e.id, name: e.name, icon: wanted[itemId], createdAt: ctx.now });
            ctx.out.adopted.push(Number(itemId));
            continue;
        }
        try {
            await ctx.remove(e.id);
            ctx.out.deleted.push(Number(itemId));
        } catch (err) {
            ctx.out.failed.push({ itemId: Number(itemId), error: errorText(err) });
        }
    }
}

/** Step 3: create the missing ones while the application has room. */
async function createMissing(ctx, wanted) {
    const have = stockStore.itemEmojis();
    for (const [itemId, icon] of Object.entries(wanted)) {
        if (have[itemId]) continue;
        if (ctx.total >= MAX_APP_EMOJIS) {
            ctx.out.full.push(Number(itemId));
            continue;
        }
        await ctx.pause();
        try {
            const image = await downloadIcon(iconUrl(icon), ctx.fetchImpl);
            const created = await ctx.rest.post(Routes.applicationEmojis(ctx.appId), { body: { name: emojiName(itemId), image } });
            ctx.total += 1;
            stockStore.setItemEmoji(itemId, { id: created.id, name: created.name || emojiName(itemId), icon, createdAt: ctx.now });
            ctx.out.created.push(Number(itemId));
        } catch (e) {
            ctx.out.failed.push({ itemId: Number(itemId), error: errorText(e) });
        }
    }
}

/**
 * Bring the application's `gb_` emojis in line with what the banks offer:
 * create the missing ones, delete those of items no bank offers any more (and
 * stray `gb_` emojis nobody remembers), re-create one whose icon changed or
 * that was deleted by hand. Adopts an existing `gb_<id>` instead of making a
 * second one. Never throws for a single emoji — those land in `failed`.
 * @param {{ client?: object, fetchImpl?: Function, sleep?: Function, now?: number, log?: Function }} [opts]
 * @returns {Promise<{ skipped?: string, created: number[], deleted: number[], adopted: number[], failed: { itemId: number, error: string }[], full: number[] }>}
 */
async function syncItemEmojis({ client = discord.getClient(), fetchImpl = fetch, sleep = defaultSleep, now = Date.now(), log = logger.info } = {}) {
    const appId = client && client.application && client.application.id;
    const rest = client && client.rest;
    if (!appId || !rest) return { created: [], deleted: [], adopted: [], failed: [], full: [], skipped: "offline" };

    const wanted = stockStore.offeredIcons();
    const ctx = runContext({ rest, appId, app: await listAppEmojis(rest, appId), sleep, fetchImpl, now });
    await dropStale(ctx, wanted);
    await sweepStrays(ctx, wanted);
    await createMissing(ctx, wanted);
    const out = ctx.out;
    if (out.full.length) logger.warn(`[guildBank] ${out.full.length} Item-Emojis nicht angelegt: die Anwendung hat schon ${MAX_APP_EMOJIS} Emojis.`);
    for (const f of out.failed) logger.warn(`[guildBank] Item-Emoji ${f.itemId}: ${f.error}`);
    if (out.created.length || out.deleted.length || out.adopted.length) {
        log(`[guildBank] Item-Emojis: ${out.created.length} angelegt, ${out.deleted.length} gelöscht, ${out.adopted.length} übernommen.`);
    }
    return out;
}

// ---- the queue -------------------------------------------------------------

let timer = null;
let retryTimer = null;
let running = null;
let again = false;
let runner = (opts) => syncItemEmojis(opts);

function schedule(fn, ms) {
    const t = setTimeout(fn, ms);
    if (t.unref) t.unref();
    return t;
}

/** Run once now (one at a time; a request while running runs again right after). Never throws. */
async function runQueued() {
    timer = null;
    if (running) {
        again = true;
        return running;
    }
    running = (async () => {
        let result;
        try {
            result = await runner();
        } catch (e) {
            logger.warn(`[guildBank] Item-Emojis nicht abgeglichen: ${(e && e.message) || e}`);
            result = { skipped: "error" };
        }
        if (result && (result.skipped || (result.failed && result.failed.length))) {
            if (!retryTimer) retryTimer = schedule(() => { retryTimer = null; queueItemEmojiSync(); }, RETRY_MS);
        }
        return result;
    })();
    try {
        return await running;
    } finally {
        running = null;
        if (again) {
            again = false;
            queueItemEmojiSync();
        }
    }
}

/** Ask for a sync soon, in the background: the callers never wait for Discord. */
function queueItemEmojiSync({ delay = DEBOUNCE_MS } = {}) {
    if (timer) clearTimeout(timer);
    timer = schedule(() => { void runQueued(); }, delay);
}

/** Tests: swap the sync the queue runs (null = the real one) and drop pending timers. */
function _setRunnerForTests(fn) {
    runner = fn || ((opts) => syncItemEmojis(opts));
    if (timer) clearTimeout(timer);
    if (retryTimer) clearTimeout(retryTimer);
    timer = null;
    retryTimer = null;
    running = null;
    again = false;
}

module.exports = {
    PREFIX, MAX_APP_EMOJIS, DEBOUNCE_MS, PAUSE_MS, RETRY_MS,
    emojiName, itemIdOfName, syncItemEmojis, queueItemEmojiSync, runQueued, _setRunnerForTests,
};
