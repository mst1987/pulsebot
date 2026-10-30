// The addon download centre in Discord (design "Addon-Downloadzentrale", Okt 2026):
// ONE bot message in a channel the admin picks (Einstellungen → Module → Addons)
// with every addon of the channel's game version, a "Herunterladen" button
// and a "Patchnotes" link (to the web page) each; a click sends the file to the clicking member alone
// (services/addons/addonCenterBot.js). The builders are addonCenterPanel.js, the
// settings and what was posted stores/addonCenterStore.js.
//
// The job (startAddonCenter, every CHECK_MS, first FIRST_DELAY_MS after the
// start) asks the release cache (addonReleases.releaseFor, 10 minutes) for each
// addon of the centre and compares the newest version with the one it knows:
//   - none known yet (first check, a new addon): only remembered, nothing posted;
//   - a newer one (of the centre's game version): "NEU" for seven days in the centre and,
//     when a role is set, ONE short message in the centre's channel that pings it (all
//     addons updated in the same check in it, no patch notes, a link to the web page
//     instead). The ping is deleted when the next one comes and 12 hours after it was
//     posted at the latest (PING_TTL_MS; expirePing, every round, also without a centre).
// Then the centre is redrawn when what it shows changed (its `hash`), and posted
// anew when its message is gone (deleted in Discord: linkWatch.js tells
// onCenterMessageDeleted at once; while the bot was away, the next check finds it).
// Nothing runs while no centre is posted or the bot is offline.
const crypto = require("crypto");
const store = require("../../stores/addonCenterStore");
const { getConfig } = require("../../stores/configStore");
const discord = require("../discord/discord");
const { appEmojiMap } = require("../discord/appEmojis");
const { versionLabel } = require("../versions/versionSettings");
const { serverLang } = require("../discord/botLanguage");
const { categoryIdOfChannel } = require("../versions/commandVersion");
const { mainVersionFor, isVersionVisible, knownVersion } = require("../versions/mainVersion");
const { enabledAddons, releaseFor } = require("./addonReleases");
const { assetMatches } = require("./addonConfig");
const { centerPayload, patchNotesUrl, escapeMd } = require("./addonCenterPanel");
const { privilegedReason } = require("../discord/roles/selfRole");
const { tr } = require("../../utils/i18n/botText");
const log = require("../../logger").child("addonCenter");

const FIRST_DELAY_MS = 60 * 1000;
const CHECK_MS = 15 * 60 * 1000;
/** After a deletion in Discord the centre comes back this soon. */
const REDRAW_DELAY_MS = 5 * 1000;
/** An update ping is deleted this long after it was posted. */
const PING_TTL_MS = 12 * 60 * 60 * 1000;

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
function categoryVersion(channelId, config) {
    const client = discord.getClient();
    const cache = client && client.channels && client.channels.cache;
    const channel = cache && typeof cache.get === "function" ? cache.get(str(channelId)) : null;
    const categoryId = channel ? categoryIdOfChannel(channel, channel.guild) : "";
    const wanted = mainVersionFor({ categoryId, config });
    return isVersionVisible(wanted, config) ? wanted : mainVersionFor({ config });
}

/**
 * The game version the centre shows: the one picked in the settings (versionId),
 * while it is known and visible, else that of the channel's category.
 */
function channelVersion(channelId, config) {
    const picked = store.getSettings().versionId;
    if (picked && knownVersion(picked) === picked && isVersionVisible(picked, config)) return picked;
    return categoryVersion(channelId, config);
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

/**
 * Whether the centre offers "Updates abonnieren": only with an update role that carries
 * no rights (services/discord/roles/selfRole.js) — the bot rights from the config and the rosters always,
 * what it grants in Discord when the channel's server is in the cache.
 */
function offersSubscribe(channelId, config) {
    const { roleId } = store.getSettings();
    if (!roleId) return false;
    const client = discord.getClient();
    const cache = client && client.channels && client.channels.cache;
    const channel = cache && typeof cache.get === "function" ? cache.get(str(channelId)) : null;
    const guild = channel && channel.guild ? channel.guild : null;
    const roles = guild && guild.roles ? guild.roles.cache : null;
    const role = roles && typeof roles.get === "function" ? roles.get(roleId) || null : null;
    return !privilegedReason(config, roleId, role, guild);
}

/** The centre as it should look now, for the channel it lives in. */
async function currentPayload({ channelId, config, now = Date.now() } = {}) {
    const cfg = config || getConfig();
    const versionId = channelVersion(channelId, cfg);
    const entries = await centerEntries(cfg, versionId, { now });
    const subscribe = offersSubscribe(channelId, cfg);
    const built = centerPayload({ entries, subscribe, lang: serverLang(cfg), emojis: appEmojiMap(), now, versionLabel: versionLabel(versionId) });
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

/**
 * The text of the ping: the role, each addon with its version and a link to its patch notes on the web page,
 * plus "Jetzt auch auf CurseForge" for an addon with a CurseForge page.
 */
function pingContent(roleId, updates, lang) {
    const items = updates.map((u) => {
        const links = [`[${tr(lang, "Patch notes")}](<${patchNotesUrl(u.id)}>)`];
        if (u.curseforge) links.push(`[${tr(lang, "Now also on CurseForge")}](<${u.curseforge}>)`);
        return `**${escapeMd(u.name)} ${escapeMd(u.version)}** (${links.join(" · ")})`;
    });
    return items.length === 1
        ? tr(lang, "{role} {item} is here.", { role: `<@&${roleId}>`, item: items[0] })
        : tr(lang, "{role} New versions: {items}", { role: `<@&${roleId}>`, items: items.join(" · ") });
}

/** Delete the stored ping message (an already deleted one is fine) and forget it. */
async function dropPing() {
    const ping = store.clearPing();
    if (ping) await discord.deleteMessage(ping.channelId, ping.messageId);
    return ping;
}

/**
 * Delete the ping once it is PING_TTL_MS old. Never throws.
 * @returns {Promise<boolean>} whether one was deleted
 */
async function expirePing({ now = Date.now() } = {}) {
    try {
        const ping = store.getPing();
        if (!ping || now - ping.postedAt < PING_TTL_MS) return false;
        if (!discord.isOnline()) return false;
        await dropPing();
        return true;
    } catch (e) {
        log.warn(`update ping not deleted: ${str(e && e.message) || e}`);
        return false;
    }
}

/**
 * Ping the role about the addons updated in this check: the earlier ping goes first, one message
 * for all of them. Nothing without a role. Never throws.
 * @returns {Promise<boolean>} whether a ping was posted
 */
async function postUpdatePing(updates, { config, now = Date.now() } = {}) {
    const { roleId, channelId } = store.getSettings();
    const center = store.getCenter();
    const target = (center && center.channelId) || channelId;
    if (!roleId || !target || !updates.length || !discord.isOnline()) return false;
    try {
        await dropPing();
        const posted = await discord.postRolePing(target, roleId, pingContent(roleId, updates, serverLang(config || getConfig())));
        store.setPing({ channelId: posted.channelId, messageId: posted.messageId }, { now });
        log.info(`update ping for ${updates.map((u) => `${u.id} ${u.version}`).join(", ")} posted in ${posted.channelId}`);
        return true;
    } catch (e) {
        log.warn(`update ping not posted: ${str(e && e.message) || e}`);
        return false;
    }
}

/**
 * Compare each addon's newest version with the known one (see the head comment).
 * @returns {Promise<{ remembered: string[], updated: string[], pinged: boolean }>}
 */
async function checkVersions({ config, now = Date.now() } = {}) {
    const cfg = config || getConfig();
    const center = store.getCenter();
    const out = { remembered: [], updated: [], pinged: false };
    if (!center) return out;
    const updates = [];
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
            // an older "latest" (a release withdrawn): taken over quietly
            store.setSeen(e.addon.id, { version, previous: known.version, newSince: 0, notifiedAt: 0 });
            continue;
        }
        store.setSeen(e.addon.id, { version, previous: known.version, newSince: now, notifiedAt: 0 });
        out.updated.push(e.addon.id);
        updates.push({ id: e.addon.id, name: e.addon.name, version, curseforge: e.addon.curseforge || "" });
    }
    if (updates.length) out.pinged = await postUpdatePing(updates, { config: cfg, now });
    return out;
}

// One check at a time: a click on "Neu posten" during a check waits for it.
let running = null;

/** One round of the job: versions, then the centre. Never throws. */
function runCheck({ config, now = Date.now() } = {}) {
    if (running) return running;
    running = (async () => {
        await expirePing({ now });
        if (!store.getCenter() || !discord.isOnline()) return { skipped: true };
        let versions = { remembered: [], updated: [], pinged: false };
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
 * changed game version redraws it, a changed role when "Updates abonnieren" comes or goes
 * (it shows only with a role that carries no rights).
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
    if (saved.settings.versionId !== before.versionId) {
        // another game version shows other addons: their versions are only remembered
        try {
            rememberVersions(await centerEntries(config || getConfig(), channelVersion(center.channelId, config || getConfig()), { now }));
        } catch (e) {
            log.warn(`versions of the new game version not remembered: ${str(e && e.message) || e}`);
        }
    }
    if (saved.settings.versionId !== before.versionId) await refreshCenter({ config, force: true, now });
    // another role: the fingerprint covers the button, so only a change in it is drawn
    else if (saved.settings.roleId !== before.roleId) await refreshCenter({ config, now });
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
    FIRST_DELAY_MS, CHECK_MS, PING_TTL_MS, pingContent, expirePing, compareVersions, channelVersion, categoryVersion, centerAddons, centerEntries, currentPayload, payloadHash,
    postCenter, removeCenter, refreshCenter, checkVersions, runCheck, scheduleRefresh, onCenterMessageDeleted, saveSettings,
    startAddonCenter, stopAddonCenter,
};
