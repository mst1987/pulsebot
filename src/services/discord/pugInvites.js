// The bot's own invites and where a member came from (#905, PuG server).
//
// A link `from → to` can get a permanent invite on its source server `from`
// (maxAge 0, maxUses 0, unique): the partner server `to` hands it out, so a
// member who joins through it came from that partner. A server can also get
// one general invite (the web hands it to non-members, #907). Invites are made
// only on a click in the settings — never at start or on saving a link. The
// codes live in discordInviteStore; `inviteUrlForLink` / `generalInviteUrl`
// read them synchronously, creating and replacing are the async functions below.
//
// Check (`reconcileInvites`, at ready, on opening the settings page and every
// 10 minutes): an invite somebody deleted on Discord is marked deleted (never
// made again on its own: the page offers to create it anew); the invite of a
// link or server that is gone is deleted on Discord and its record dropped.
// inviteCreate / inviteDelete only speed this up — they need "Kanäle
// verwalten", which the bot is not asked for.
//
// Origin: only servers with at least one stored invite of the bot are tracked.
// The bot keeps the use counters of their invites in memory. Joins of a server
// are collected and read together: when exactly one counter rose, and by as
// many as joins are pending, they all came through it; anything else leaves
// them unknown — and an unknown origin is not stored. Only the bot's own codes
// are stored (memberOriginStore).
//
// Rights (docs/discord-servers.md): "Einladung erstellen" to create the
// invites, "Server verwalten" to read them and their use counters and to
// delete an old one.
const { ChannelType, PermissionsBitField } = require("discord.js");
const discord = require("./discord");
const guildRoles = require("./guildRoles");
const inviteStore = require("../../stores/discordInviteStore");
const originStore = require("../../stores/memberOriginStore");
const eventStore = require("../../stores/eventStore");
const signupStore = require("../../stores/signupStore");
const log = require("../../logger").child("pugInvites");

const INVITE_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const INVITE_PERMISSIONS = [
    { flag: "CreateInstantInvite", label: "Einladung erstellen" },
    { flag: "ManageGuild", label: "Server verwalten" },
];
const REASON = "EventHelper: Einladung je Verknüpfung";
const REMOVED_REASON = "EventHelper: Verknüpfung oder Server entfernt";
const CHECK_INTERVAL_MS = 10 * 60 * 1000;

const urlOf = (record) => (record && record.code && !record.deleted ? `https://discord.gg/${record.code}` : "");

/** The invite URL of a link ("from:to"), "" when it has none (or it was deleted). Synchronous, reads the store only. */
function inviteUrlForLink(linkKey) {
    return urlOf(inviteStore.getLinkInvite(linkKey));
}

/** The general invite URL of a server, "" when it has none (or it was deleted). Synchronous, reads the store only. */
function generalInviteUrl(guildId) {
    return urlOf(inviteStore.getGeneralInvite(guildId));
}

/** The labels of the invite rights the bot lacks on a guild ([] when it has them or cannot tell). */
function missingInvitePermissions(guild) {
    const me = guild && guild.members && guild.members.me;
    if (!me || !me.permissions || typeof me.permissions.has !== "function") return [];
    return INVITE_PERMISSIONS
        .filter((p) => !me.permissions.has(PermissionsBitField.Flags[p.flag]))
        .map((p) => p.label);
}

function missingText(labels) {
    return labels.length === 1
        ? `Dem Bot fehlt das Recht „${labels[0]}“.`
        : `Dem Bot fehlen die Rechte ${labels.map((l) => `„${l}“`).join(" und ")}.`;
}

/**
 * The channel the invites of a guild point at: the one set in the settings,
 * else the server's system channel, else its first text channel.
 */
function inviteChannelOf(guild) {
    const cache = guild && guild.channels && guild.channels.cache;
    if (!cache) return null;
    const usable = (c) => c && INVITE_CHANNEL_TYPES.includes(c.type);
    const configured = cache.get(inviteStore.getInviteChannel(guild.id));
    if (usable(configured)) return configured;
    const system = guild.systemChannelId ? cache.get(guild.systemChannelId) : null;
    if (usable(system)) return system;
    return [...cache.values()].filter(usable).sort((a, b) => (a.rawPosition || 0) - (b.rawPosition || 0))[0] || null;
}

// Use counters per tracked guild: guildId -> Map(code -> uses). A guild that
// is missing was never read (or could not be).
const usesByGuild = new Map();
// Everything that reads the counters of one guild runs one after another on
// its chain: attributing joins, warming, the existence check.
const chains = new Map();
// Joins that wait to be attributed: guildId -> [{ userId, resolve }].
const pendingByGuild = new Map();
// Running creations per store key ("link:<key>" / "general:<guildId>"): a
// second click while one runs gets the same promise, not a second invite.
const inflight = new Map();
let reconcileRunning = null;

/** Queue `step` on the chain of a guild; resolves with its result (never rejects). */
function onChain(guildId, step) {
    const next = (chains.get(guildId) || Promise.resolve())
        .then(step)
        .catch((error) => {
            log.warn(`invite step of ${guildId} failed: ${error.message}`);
            return null;
        });
    chains.set(guildId, next);
    return next;
}

/** The guild's invites as a discord.js collection, null when they cannot be read. */
async function fetchInvites(guild) {
    try {
        return await guild.invites.fetch();
    } catch (error) {
        log.debug(`invites of ${guild && guild.id} unreadable: ${error.message}`);
        return null;
    }
}

function usesOf(invites) {
    const out = new Map();
    for (const invite of invites.values()) out.set(invite.code, Number(invite.uses) || 0);
    return out;
}

/**
 * Mark a stored code as deleted — only while its record still holds that code
 * (a regenerated invite has replaced it otherwise). True when it was marked.
 */
function markDeleted({ code, guildId, linkKey }) {
    const record = linkKey ? inviteStore.getLinkInvite(linkKey) : inviteStore.getGeneralInvite(guildId);
    if (record.code !== code || record.deleted) return false;
    if (linkKey) inviteStore.setLinkInvite(linkKey, { deleted: true });
    else inviteStore.setGeneralInvite(guildId, { deleted: true });
    return true;
}

/** The servers whose joins are attributed: those with a live stored invite of the bot. */
function trackedGuildIds() {
    return [...new Set(inviteStore.knownCodes().map((k) => k.guildId))];
}

/**
 * Read the invites of one tracked guild (on its chain): stored codes that are
 * gone on Discord are marked deleted, and the counters are refreshed unless
 * joins wait to be attributed (they compare against the old counters).
 */
async function refreshGuild(guildId) {
    const guild = discord.getGuild(guildId);
    if (!guild) return;
    // Taken before the read: an invite made while it runs is not in it and must not count as gone.
    const stored = inviteStore.knownCodes().filter((k) => k.guildId === guildId);
    const invites = await fetchInvites(guild);
    if (!invites) return;
    for (const known of stored) {
        if (invites.has(known.code)) continue;
        if (markDeleted(known)) log.info(`invite ${known.code} of ${guildId} is gone on Discord, marked deleted`);
    }
    if (!(pendingByGuild.get(guildId) || []).length) usesByGuild.set(guildId, usesOf(invites));
}

/** Read the counters of every tracked server, each on its chain. */
async function warmUses() {
    await Promise.all(trackedGuildIds().map((guildId) => onChain(guildId, () => refreshGuild(guildId))));
}

/** Delete an invite on Discord as far as the bot may; never throws. */
async function deleteOnDiscord(guildId, code) {
    const guild = code ? discord.getGuild(guildId) : null;
    if (!guild || !guild.invites || typeof guild.invites.delete !== "function") return;
    try {
        await guild.invites.delete(code, REMOVED_REASON);
    } catch (error) {
        log.warn(`invite ${code} of ${guildId} not deleted: ${error.message}`);
    }
    const uses = usesByGuild.get(guildId);
    if (uses) uses.delete(code);
}

/**
 * The check: invites of links and servers that are gone are deleted on Discord
 * and dropped from the store, then every tracked server's invites are read
 * (vanished ones marked deleted, counters refreshed). Runs once at a time.
 */
function reconcileInvites() {
    if (reconcileRunning) return reconcileRunning;
    reconcileRunning = (async() => {
        const linkKeys = new Set(guildRoles.links().map((l) => `${l.from}:${l.to}`));
        const servers = new Set(guildRoles.serverIds());
        for (const key of inviteStore.linkKeys()) {
            if (linkKeys.has(key)) continue;
            const record = inviteStore.getLinkInvite(key);
            if (!record.deleted) await deleteOnDiscord(key.split(":")[0], record.code);
            inviteStore.removeLinkInvite(key);
        }
        for (const guildId of inviteStore.generalGuildIds()) {
            if (servers.has(guildId)) continue;
            const record = inviteStore.getGeneralInvite(guildId);
            if (!record.deleted) await deleteOnDiscord(guildId, record.code);
            inviteStore.removeGeneralInvite(guildId);
            inviteStore.setInviteChannel(guildId, "");
        }
        for (const guildId of [...usesByGuild.keys()]) {
            if (!trackedGuildIds().includes(guildId)) usesByGuild.delete(guildId);
        }
        await warmUses();
    })().finally(() => {
        reconcileRunning = null;
    });
    return reconcileRunning;
}

let checkTimer = null;

/** Start the periodic check (idempotent, unref'd): one run now, then every 10 minutes. */
function startInviteCheck({ intervalMs = CHECK_INTERVAL_MS } = {}) {
    if (checkTimer) return checkTimer;
    const run = () => reconcileInvites().catch((error) => log.warn(`invite check failed: ${error.message}`));
    run();
    checkTimer = setInterval(run, intervalMs);
    if (checkTimer.unref) checkTimer.unref();
    return checkTimer;
}

/** Stop the periodic check (idempotent). */
function stopInviteCheck() {
    if (checkTimer) clearInterval(checkTimer);
    checkTimer = null;
}

/**
 * Make sure a stored invite exists (or, with `regenerate`, replace it).
 * `set(patch)` / `get()` address the store record. Returns the record.
 */
async function ensureInvite({ guildId, get, set, regenerate = false }) {
    const guild = discord.getGuild(guildId);
    if (!guild) return set({ error: "Der Bot ist nicht auf diesem Server." });
    const missing = missingInvitePermissions(guild);
    if (missing.length) return set({ error: missingText(missing) });

    const stored = get();
    const invites = await fetchInvites(guild);
    if (!invites) return set({ error: "Einladungen nicht lesbar." });
    const existing = stored.code ? invites.get(stored.code) || null : null;
    if (existing && !regenerate) return stored.error || stored.deleted ? set({ error: "", deleted: false }) : stored;

    const channel = inviteChannelOf(guild);
    if (!channel) return set({ error: "Kein Textkanal für die Einladung gefunden." });
    let created;
    try {
        created = await channel.createInvite({ maxAge: 0, maxUses: 0, unique: true, reason: REASON });
    } catch (error) {
        return set({ error: `Einladung nicht erstellt: ${error.message}` });
    }
    // Stored before the old one goes: its inviteDelete then no longer matches a stored code.
    const record = set({ code: created.code, channelId: channel.id, createdAt: Date.now(), error: "", deleted: false });
    // The first invite of a guild starts its tracking: the counters are read on its chain.
    if (!usesByGuild.has(guild.id)) onChain(guild.id, () => refreshGuild(guild.id));
    else usesByGuild.get(guild.id).set(created.code, Number(created.uses) || 0);
    if (existing) {
        try {
            await existing.delete(REASON);
        } catch (error) {
            log.warn(`old invite ${existing.code} not deleted: ${error.message}`);
        }
    }
    return record;
}

/** Run `make` once per key at a time: a second call while it runs shares its promise. */
function once(key, make) {
    if (inflight.has(key)) return inflight.get(key);
    const run = Promise.resolve().then(make).finally(() => inflight.delete(key));
    inflight.set(key, run);
    return run;
}

function linkTarget(linkKey) {
    return guildRoles.links().find((l) => `${l.from}:${l.to}` === String(linkKey || "")) || null;
}

function linkInvite(linkKey, regenerate) {
    const link = linkTarget(linkKey);
    if (!link) return Promise.resolve(null);
    return once(`link:${linkKey}`, () => ensureInvite({
        guildId: link.from,
        get: () => inviteStore.getLinkInvite(linkKey),
        set: (patch) => inviteStore.setLinkInvite(linkKey, patch),
        regenerate,
    }));
}

function generalInvite(guildId, regenerate) {
    const id = String(guildId || "");
    if (!id || !guildRoles.serverIds().includes(id)) return Promise.resolve(null);
    return once(`general:${id}`, () => ensureInvite({
        guildId: id,
        get: () => inviteStore.getGeneralInvite(id),
        set: (patch) => inviteStore.setGeneralInvite(id, patch),
        regenerate,
    }));
}

/** Create the invite of a link unless it has one that still exists. Returns the store record, null for an unknown link. */
function ensureLinkInvite(linkKey) {
    return linkInvite(linkKey, false);
}

/** Replace the invite of a link with a new one; the old one is deleted. Null for an unknown link. */
function regenerateLinkInvite(linkKey) {
    return linkInvite(linkKey, true);
}

/** Create the general invite of a server unless it has one that still exists. Null for a server not in the list. */
function ensureGeneralInvite(guildId) {
    return generalInvite(guildId, false);
}

/** Replace the general invite of a server; the old one is deleted. Null for a server not in the list. */
function regenerateGeneralInvite(guildId) {
    return generalInvite(guildId, true);
}

/** inviteCreate (only with "Kanäle verwalten"): a counter starts at its uses (usually 0). */
function onInviteCreate(invite) {
    const guildId = invite && invite.guild && invite.guild.id;
    const uses = guildId ? usesByGuild.get(guildId) : null;
    if (uses && invite.code) uses.set(invite.code, Number(invite.uses) || 0);
}

/**
 * inviteDelete (only with "Kanäle verwalten"): the counter goes, and an invite
 * of ours is marked deleted at once — the check would find it later anyway.
 */
function onInviteDelete(invite) {
    const guildId = invite && invite.guild && invite.guild.id;
    const code = invite && invite.code;
    if (!guildId || !code) return;
    const uses = usesByGuild.get(guildId);
    if (uses) uses.delete(code);
    const known = inviteStore.knownCodes().find((k) => k.code === code && k.guildId === guildId);
    if (known) markDeleted(known);
}

/**
 * Attribute every join of a guild that waits (on its chain). One counter rose,
 * by exactly the number of waiting joins: they all came through it. Otherwise
 * — none, several, or a different rise — they all stay unknown and nothing is
 * stored. Only the bot's own codes are stored.
 */
async function settleJoins(guild) {
    const batch = pendingByGuild.get(guild.id) || [];
    pendingByGuild.delete(guild.id);
    if (!batch.length) return;
    const before = usesByGuild.get(guild.id) || null;
    const invites = await fetchInvites(guild);
    const after = invites ? usesOf(invites) : null;
    if (after) usesByGuild.set(guild.id, after);
    else usesByGuild.delete(guild.id);

    let origin = null;
    if (before && after) {
        const risen = [...after.entries()]
            .map(([code, uses]) => [code, uses - (before.get(code) || 0)])
            .filter(([, delta]) => delta > 0);
        if (risen.length === 1 && risen[0][1] === batch.length) {
            const known = inviteStore.knownCodes().find((k) => k.code === risen[0][0] && k.guildId === guild.id);
            if (known) origin = { inviteCode: known.code, linkKey: known.linkKey };
        }
    }
    for (const join of batch) {
        let stored = null;
        if (origin) {
            try {
                stored = originStore.recordOrigin({ guildId: guild.id, userId: join.userId, ...origin });
            } catch (error) {
                log.warn(`origin of ${join.userId} not recorded: ${error.message}`);
            }
        }
        join.resolve(stored);
    }
}

/**
 * guildMemberAdd: note through which invite the member came (tracked servers
 * only, bots never). Never throws; resolves with the stored origin or null.
 */
function onMemberAdd(member) {
    try {
        const guild = member && member.guild;
        const guildId = guild && guild.id;
        if (!guildId || !member.user || member.user.bot) return Promise.resolve(null);
        if (!trackedGuildIds().includes(guildId)) return Promise.resolve(null);
        return new Promise((resolve) => {
            const pending = pendingByGuild.get(guildId) || [];
            pending.push({ userId: member.id, resolve });
            pendingByGuild.set(guildId, pending);
            // The first waiting join queues the read; later ones join its batch.
            if (pending.length === 1) {
                onChain(guildId, () => settleJoins(guild)).then(() => {
                    // A failed step must not leave joins waiting forever.
                    for (const join of pending) join.resolve(null);
                });
            }
        });
    } catch (error) {
        log.warn(`origin not recorded: ${error.message}`);
        return Promise.resolve(null);
    }
}

/** The members signed up (any status but absence) for a raid of `guildId`. */
function signedUpOn(guildId) {
    const users = new Set();
    for (const event of eventStore.listEvents(guildId)) {
        for (const signup of signupStore.listSignups(event.id)) {
            if (signup.status !== "absence") users.add(String(signup.userId));
        }
    }
    return users;
}

/**
 * The settings page's view: every link with its invite (deleted = vanished on
 * Discord), the error (a missing bot right first), how many joined through it
 * and how many of them signed up for a raid of the source server; plus every
 * server's general invite and invite channel.
 */
function inviteOverview() {
    const links = guildRoles.links();
    const signedUpCache = new Map();
    const liveError = (guildId) => {
        const guild = discord.getGuild(guildId);
        if (!guild) return "";
        const missing = missingInvitePermissions(guild);
        return missing.length ? missingText(missing) : "";
    };
    const linkRows = links.map((link) => {
        const key = `${link.from}:${link.to}`;
        const record = inviteStore.getLinkInvite(key);
        if (!signedUpCache.has(link.from)) signedUpCache.set(link.from, signedUpOn(link.from));
        const signed = signedUpCache.get(link.from);
        const origins = originStore.originsOfLink(key);
        return {
            key,
            from: link.from,
            to: link.to,
            code: record.code,
            url: urlOf(record),
            channelId: record.channelId,
            createdAt: record.createdAt,
            deleted: record.deleted,
            error: liveError(link.from) || record.error,
            joined: origins.length,
            signedUp: origins.filter((o) => signed.has(o.userId)).length,
        };
    });
    const sources = new Set(links.map((l) => l.from));
    const servers = guildRoles.serverIds().map((guildId) => {
        const record = inviteStore.getGeneralInvite(guildId);
        const source = sources.has(guildId);
        return {
            guildId,
            source,
            code: record.code,
            url: urlOf(record),
            channelId: record.channelId,
            deleted: record.deleted,
            inviteChannelId: inviteStore.getInviteChannel(guildId),
            // Only a source server needs the invite rights: elsewhere a missing one is no fault.
            error: source ? liveError(guildId) || record.error : "",
        };
    });
    return { links: linkRows, servers };
}

/** Tests: forget the counters, queues and timer. */
function resetForTests() {
    stopInviteCheck();
    usesByGuild.clear();
    chains.clear();
    pendingByGuild.clear();
    inflight.clear();
    reconcileRunning = null;
}

module.exports = {
    inviteUrlForLink, generalInviteUrl,
    ensureLinkInvite, regenerateLinkInvite, ensureGeneralInvite, regenerateGeneralInvite,
    reconcileInvites, startInviteCheck, stopInviteCheck,
    onInviteCreate, onInviteDelete, onMemberAdd, warmUses, inviteOverview, inviteChannelOf,
    missingInvitePermissions, INVITE_PERMISSIONS, resetForTests,
};
