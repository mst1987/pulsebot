// The addon download centre in Discord (design "Addon-Downloadzentrale", Okt 2026):
// ONE bot message in a channel the admin picks (Einstellungen → Module → Addons)
// with every addon of the channel's game version and a "Herunterladen" button
// each; a click sends the file to the clicking member alone
// (services/addons/addonCenterBot.js). The builders are addonCenterPanel.js, the
// settings and what was posted stores/addonCenterStore.js.
//
// The job (startAddonCenter, every CHECK_MS, first FIRST_DELAY_MS after the
// start) asks the release cache (addonReleases.releaseFor, 10 minutes) for each
// addon of the centre and compares the newest version with the one it knows:
//   - none known yet (first check, a new addon): only remembered, nothing posted;
//   - a newer one: "NEU" for seven days in the centre, and — when "Neue Versionen
//     im Kanal melden" is on — an update message into the same channel, pinging
//     the update role (none set = no ping). Old update messages stay.
// Then the centre is redrawn when what it shows changed (its `hash`), and posted
// anew when its message is gone (deleted in Discord: linkWatch.js tells
// onCenterMessageDeleted at once; while the bot was away, the next check finds it).
// Nothing runs while no centre is posted or the bot is offline.
const crypto = require("crypto");
const store = require("../../stores/addonCenterStore");
const { getConfig } = require("../../stores/configStore");
const discord = require("../discord/discord");
const { appEmojiMap } = require("../discord/appEmojis");
const { serverLang } = require("../discord/botLanguage");
const { categoryIdOfChannel } = require("../events/commandVersion");
const { mainVersionFor, isVersionVisible } = require("../events/mainVersion");
const { enabledAddons, releaseFor } = require("./addonReleases");
const { assetMatches } = require("./addonConfig");
const { centerPayload, updatePayload } = require("./addonCenterPanel");
const log = require("../../logger").child("addonCenter");

const FIRST_DELAY_MS = 60 * 1000;
const CHECK_MS = 15 * 60 * 1000;
/** After a deletion in Discord the centre comes back this soon. */
const REDRAW_DELAY_MS = 5 * 1000;

const str = (v) => String(v === undefined || v === null ? "" : v).trim();
const isUnknownMessage = (e) => !!(e && (e.code === 10008 || /unknown message/i.test(str(e && e.message))));

/** "1.10.2" > "1.9.0": numeric parts compared in turn, a missing part is 0; -1, 0 or 1. */
function compareVersions(a, b) {
    const pa = str(a).replace(/^v/i, "").split(/[.+-]/);
    const pb = str(b).replace(/^v/i, "").split(/[.+-]/);
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
        const x = pa[i] || "0";
        const y = pb[i] || "0";
        const nx = Number(x);
        const ny = Number(y);
        if (Number.isFinite(nx) && Number.isFinite(ny)) {
            if (nx !== ny) return nx > ny ? 1 : -1;
        } else if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
}

/** The game version of a channel: its category's (as /addons reads it), a hidden one falls back to the main version. */
function channelVersion(channelId, config) {
    const client = discord.getClient();
    const cache = client && client.channels && client.channels.cache;
    const channel = cache && typeof cache.get === "function" ? cache.get(str(channelId)) : null;
    const categoryId = channel ? categoryIdOfChannel(channel, channel.guild) : "";
    const wanted = mainVersionFor({ categoryId, config });
    return isVersionVisible(wanted, config) ? wanted : mainVersionFor({ config });
}

/** The addons the centre shows for a version: enabled, not orga-only, of that version. */
function centerAddons(config, versionId) {
    return enabledAddons(config, versionId, { orga: false });
}

/** Each addon of the centre with its release (cached), the files it offers and its NEU mark. */
async function centerEntries(config, versionId, { now = Date.now() } = {}) {
    const addons = centerAddons(config, versionId);
    const results = await Promise.all(addons.map((addon) => releaseFor(addon, { config, now })));
    const seen = store.getSeen();
    return addons.map((addon, i) => {
        const result = results[i];
        const release = result.release || null;
        const known = seen[addon.id];
        // NEU only for the version it was set for
        const newSince = known && release && known.version === release.version ? known.newSince : 0;
        return {
            addon,
            state: result.state,
            release,
            files: release ? (release.assets || []).filter((a) => assetMatches(addon, a.name)) : [],
            newSince,
        };
    });
}

/** The fingerprint of a payload: its components as Discord gets them. */
function payloadHash(payload) {
    return crypto.createHash("sha1").update(JSON.stringify(payload.components)).digest("hex").slice(0, 16);
}

/** The centre as it should look now, for the channel it lives in. */
async function currentPayload({ channelId, config, now = Date.now() } = {}) {
    const cfg = config || getConfig();
    const settings = store.getSettings();
    const versionId = channelVersion(channelId, cfg);
    const entries = await centerEntries(cfg, versionId, { now });
    const built = centerPayload({ entries, subscribe: !!settings.roleId, lang: serverLang(cfg), emojis: appEmojiMap(), now });
    if (built.dropped) log.warn(`${built.dropped} addon(s) do not fit into the centre (Discord allows 40 components); they are on the download page`);
    return { ...built, versionId, entries };
}

/** Remember the version of every addon the bot knows nothing of yet (a new centre announces nothing it already shows). */
function rememberVersions(entries) {
    const seen = store.getSeen();
    for (const e of entries) {
        if (e.release && !seen[e.addon.id]) store.setSeen(e.addon.id, { version: e.release.version, previous: "", newSince: 0, notifiedAt: 0 });
    }
}

/**
 * Post the centre into the configured channel and drop the earlier one.
 * @returns {Promise<{ center?: object, error?: string }>}
 */
async function postCenter({ by = "", config, now = Date.now() } = {}) {
    const { channelId } = store.getSettings();
    if (!channelId) return { error: "Kein Kanal gewählt." };
    if (!discord.isOnline()) return { error: "Der Bot ist gerade nicht mit Discord verbunden." };
    let built;
    let posted;
    try {
        built = await currentPayload({ channelId, config, now });
        posted = await discord.postPayload(channelId, built.payload);
    } catch (e) {
        return { error: `Die Downloadzentrale konnte nicht gepostet werden: ${str(e && e.message) || e}` };
    }
    const earlier = store.getCenter();
    if (earlier && earlier.messageId !== posted.messageId) await discord.deleteMessage(earlier.channelId, earlier.messageId);
    const center = store.setCenter({ guildId: posted.guildId, channelId: posted.channelId, messageId: posted.messageId, url: posted.url, postedBy: by, hash: payloadHash(built.payload) }, { now });
    rememberVersions(built.entries);
    log.info(`centre posted in ${posted.channelId} (${built.shown} addons, version ${built.versionId})`);
    return { center };
}

/** Take the centre down (the message too, best-effort). Returns the removed one or null. */
async function removeCenter() {
    const center = store.clearCenter();
    if (center) await discord.deleteMessage(center.channelId, center.messageId);
    return center;
}

/** Whether a message is still there; throws when the channel cannot be read at all. */
async function messageExists(channelId, messageId) {
    const channel = await discord.fetchTextChannel(channelId);
    try {
        await channel.messages.fetch(str(messageId));
        return true;
    } catch (e) {
        if (isUnknownMessage(e)) return false;
        throw e;
    }
}

// The centre's redraw failed and was said so once — a channel that is gone
// would otherwise fill the log every quarter of an hour.
let warned = false;

/**
 * Redraw the centre when what it shows changed (or `force`), post it anew when its
 * message is gone. Never throws.
 * @returns {Promise<"none" | "unchanged" | "edited" | "reposted" | "failed">}
 */
async function refreshCenter({ config, force = false, now = Date.now() } = {}) {
    const center = store.getCenter();
    if (!center) return "none";
    try {
        const built = await currentPayload({ channelId: center.channelId, config, now });
        const hash = payloadHash(built.payload);
        let result;
        if (!force && center.hash === hash && await messageExists(center.channelId, center.messageId)) {
            result = "unchanged";
        } else {
            try {
                await discord.editPayload(center.channelId, center.messageId, built.payload);
                store.markCenterDrawn(hash);
                result = "edited";
            } catch (e) {
                if (!isUnknownMessage(e)) throw e;
                // deleted in Discord: back into its channel, as a new message
                const posted = await discord.postPayload(center.channelId, built.payload);
                store.setCenter({ ...center, guildId: posted.guildId, channelId: posted.channelId, messageId: posted.messageId, url: posted.url, hash }, { now });
                log.info(`centre was deleted in Discord, posted anew in ${posted.channelId}`);
                result = "reposted";
            }
        }
        warned = false;
        return result;
    } catch (e) {
        if (!warned) log.warn(`centre not redrawn: ${str(e && e.message) || e}`);
        warned = true;
        return "failed";
    }
}

/** Post the update message of one addon's new version into the centre's channel (pinging the update role). */
async function postUpdate({ addon, release, previous, files, settings, center, config, now }) {
    const payload = updatePayload({
        addon,
        release,
        previous,
        roleId: settings.roleId,
        centerUrl: center && center.url ? center.url : "",
        download: files.length > 0,
        lang: serverLang(config),
        emojis: appEmojiMap(),
    });
    const channel = await discord.fetchTextChannel(settings.channelId);
    const posted = await channel.send(payload);
    store.addUpdate({ addonId: addon.id, version: release.version, guildId: channel.guildId, channelId: channel.id, messageId: posted.id }, { now });
    log.info(`update posted: ${addon.id} ${previous || "?"} -> ${release.version} in ${channel.id}${settings.roleId ? " (role ping)" : ""}`);
}

/**
 * Compare each addon's newest version with the known one (see the head comment).
 * @returns {Promise<{ remembered: string[], updated: string[], announced: string[] }>}
 */
async function checkVersions({ config, now = Date.now() } = {}) {
    const cfg = config || getConfig();
    const settings = store.getSettings();
    const center = store.getCenter();
    const out = { remembered: [], updated: [], announced: [] };
    if (!center) return out;
    const entries = await centerEntries(cfg, channelVersion(center.channelId, cfg), { now });
    const seen = store.getSeen();
    for (const e of entries) {
        if (!e.release) continue;
        const known = seen[e.addon.id];
        const version = e.release.version;
        if (!known) {
            store.setSeen(e.addon.id, { version, previous: "", newSince: 0, notifiedAt: 0 });
            out.remembered.push(e.addon.id);
            continue;
        }
        if (known.version === version) continue;
        if (compareVersions(version, known.version) < 0) {
            // an older "latest" (a release withdrawn): taken over quietly, never announced
            store.setSeen(e.addon.id, { version, previous: known.version, newSince: 0, notifiedAt: 0 });
            continue;
        }
        store.setSeen(e.addon.id, { version, previous: known.version, newSince: now, notifiedAt: 0 });
        out.updated.push(e.addon.id);
        if (!settings.announce) continue;
        try {
            await postUpdate({ addon: e.addon, release: e.release, previous: known.version, files: e.files, settings, center, config: cfg, now });
            store.setSeen(e.addon.id, { version, previous: known.version, newSince: now, notifiedAt: now });
            out.announced.push(e.addon.id);
        } catch (err) {
            log.warn(`update of ${e.addon.id} ${version} not posted: ${str(err && err.message) || err}`);
        }
    }
    return out;
}

// One check at a time: a click on "Neu posten" during a check waits for it.
let running = null;

/** One round of the job: versions, then the centre. Never throws. */
function runCheck({ config, now = Date.now() } = {}) {
    if (running) return running;
    running = (async () => {
        if (!store.getCenter() || !discord.isOnline()) return { skipped: true };
        let versions = { remembered: [], updated: [], announced: [] };
        try {
            versions = await checkVersions({ config, now });
        } catch (e) {
            log.warn(`version check failed: ${str(e && e.message) || e}`);
        }
        const center = await refreshCenter({ config, now });
        store.setCheckedAt(now);
        return { ...versions, center };
    })().finally(() => { running = null; });
    return running;
}

let nudgeTimer = null;

/** Redraw the centre after a short pause (a deletion in Discord, a changed setting). */
function scheduleRefresh({ delayMs = REDRAW_DELAY_MS, force = false } = {}) {
    if (!store.getCenter()) return null;
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => {
        nudgeTimer = null;
        refreshCenter({ force }).catch(() => {});
    }, delayMs);
    if (nudgeTimer.unref) nudgeTimer.unref();
    return nudgeTimer;
}

/**
 * A message was deleted in Discord (services/discord/linkWatch.js): the centre's
 * fingerprint is forgotten, so its redraw hits "Unknown Message" and posts it anew.
 * Returns whether it was the centre.
 */
function onCenterMessageDeleted(messageId, { delayMs = REDRAW_DELAY_MS } = {}) {
    const center = store.getCenter();
    if (!center || center.messageId !== str(messageId)) return false;
    store.markCenterDrawn("");
    scheduleRefresh({ delayMs });
    return true;
}

/**
 * Save the settings of Einstellungen → Module → Addons and follow them in Discord:
 * another channel moves the posted centre there (the old message is deleted), a
 * changed role or switch redraws it ("Updates abonnieren" shows only with a role).
 * @returns {Promise<{ settings?: object, center?: object|null, error?: string }>}
 */
async function saveSettings(patch = {}, { by = "", config, now = Date.now() } = {}) {
    const before = store.getSettings();
    const saved = store.setSettings(patch);
    if (saved.error) return saved;
    const center = store.getCenter();
    if (!center) return { settings: saved.settings, center: null };
    if (saved.settings.channelId !== before.channelId) {
        if (!saved.settings.channelId) {
            await removeCenter();
            return { settings: saved.settings, center: null };
        }
        const moved = await postCenter({ by, config, now });
        if (moved.error) return { settings: saved.settings, center: store.getCenter(), error: moved.error };
        return { settings: saved.settings, center: moved.center };
    }
    if (saved.settings.roleId !== before.roleId) await refreshCenter({ config, force: true, now });
    return { settings: saved.settings, center: store.getCenter() };
}

let stopFn = null;

/** Check every `intervalMs`, the first time `firstDelayMs` after the start (the bot is logged in by then). Idempotent. */
function startAddonCenter({ firstDelayMs = FIRST_DELAY_MS, intervalMs = CHECK_MS } = {}) {
    if (stopFn) return stopFn;
    let interval = null;
    const tick = () => { runCheck().catch(() => {}); };
    const first = setTimeout(() => {
        tick();
        interval = setInterval(tick, intervalMs);
        if (interval.unref) interval.unref();
    }, firstDelayMs);
    if (first.unref) first.unref();
    stopFn = () => {
        clearTimeout(first);
        if (interval) clearInterval(interval);
        clearTimeout(nudgeTimer);
        nudgeTimer = null;
        stopFn = null;
    };
    return stopFn;
}

/** Stop what startAddonCenter() set up (idempotent). */
function stopAddonCenter() {
    if (stopFn) stopFn();
}

module.exports = {
    FIRST_DELAY_MS, CHECK_MS, compareVersions, channelVersion, centerAddons, centerEntries, currentPayload, payloadHash,
    postCenter, removeCenter, refreshCenter, checkVersions, runCheck, scheduleRefresh, onCenterMessageDeleted, saveSettings,
    startAddonCenter, stopAddonCenter,
};
