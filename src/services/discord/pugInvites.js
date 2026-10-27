// The bot's own invites and where a member came from (#905, PuG server).
//
// Every link `from → to` gets a permanent invite on its source server `from`
// (maxAge 0, maxUses 0, unique): the partner server `to` hands it out, so a
// member who joins through it came from that partner. Every source server also
// gets one general invite (the web hands it to non-members, #907). The codes
// live in discordInviteStore; `inviteUrlForLink` / `generalInviteUrl` read
// them synchronously, creating and replacing are the async functions below.
//
// Origin: the bot keeps the use counters of each tracked server's invites in
// memory. On guildMemberAdd it fetches them again — exactly one counter that
// rose names the invite, none or several leave the origin unknown, and so do
// invites it cannot read (no error). The result goes to memberOriginStore.
//
// Rights (docs/discord-servers.md): "Einladung erstellen" to create the
// invites, "Server verwalten" to read their use counters (Discord hands the
// counters only with Manage Guild) and to delete an old invite. The gateway
// intent GuildInvites (not privileged) brings inviteCreate / inviteDelete.
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

const urlOf = (code) => (code ? `https://discord.gg/${code}` : "");

/** The invite URL of a link ("from:to"), "" when it has none. Synchronous, reads the store only. */
function inviteUrlForLink(linkKey) {
    return urlOf(inviteStore.getLinkInvite(linkKey).code);
}

/** The general invite URL of a server, "" when it has none. Synchronous, reads the store only. */
function generalInviteUrl(guildId) {
    return urlOf(inviteStore.getGeneralInvite(guildId).code);
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
// Joins of one guild are attributed one after another: two joins at once must
// not both compare against the same old counters.
const chains = new Map();

/** The guild's invites as Map(code -> uses), null when they cannot be read. */
async function readUses(guild) {
    try {
        const invites = await guild.invites.fetch();
        const out = new Map();
        for (const invite of invites.values()) out.set(invite.code, Number(invite.uses) || 0);
        return out;
    } catch (error) {
        log.debug(`invites of ${guild && guild.id} unreadable: ${error.message}`);
        return null;
    }
}

/** The servers whose joins are attributed: the source of every link. */
function trackedGuildIds() {
    return [...new Set(guildRoles.links().map((l) => l.from))];
}

/** Read the counters of every tracked server (bot start, after a new invite). */
async function warmUses() {
    for (const guildId of trackedGuildIds()) {
        const guild = discord.getGuild(guildId);
        if (!guild) continue;
        const uses = await readUses(guild);
        if (uses) usesByGuild.set(guildId, uses);
        else usesByGuild.delete(guildId);
    }
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
    let existing;
    try {
        const invites = await guild.invites.fetch();
        existing = stored.code ? invites.get(stored.code) || null : null;
    } catch (error) {
        return set({ error: `Einladungen nicht lesbar: ${error.message}` });
    }
    if (existing && !regenerate) return stored.error ? set({ error: "" }) : stored;

    const channel = inviteChannelOf(guild);
    if (!channel) return set({ error: "Kein Textkanal für die Einladung gefunden." });
    let created;
    try {
        created = await channel.createInvite({ maxAge: 0, maxUses: 0, unique: true, reason: REASON });
    } catch (error) {
        return set({ error: `Einladung nicht erstellt: ${error.message}` });
    }
    // Stored before the old one goes: its inviteDelete then no longer matches a stored code.
    const record = set({ code: created.code, channelId: channel.id, createdAt: Date.now(), error: "" });
    const uses = usesByGuild.get(guild.id);
    if (uses) uses.set(created.code, Number(created.uses) || 0);
    if (existing) {
        try {
            await existing.delete(REASON);
        } catch (error) {
            log.warn(`old invite ${existing.code} not deleted: ${error.message}`);
        }
    }
    return record;
}

function linkGuildId(linkKey) {
    return String(linkKey || "").split(":")[0];
}

function linkTarget(linkKey) {
    return guildRoles.links().find((l) => `${l.from}:${l.to}` === String(linkKey || "")) || null;
}

function linkInviteArgs(linkKey, regenerate) {
    return {
        guildId: linkGuildId(linkKey),
        get: () => inviteStore.getLinkInvite(linkKey),
        set: (patch) => inviteStore.setLinkInvite(linkKey, patch),
        regenerate,
    };
}

function generalInviteArgs(guildId, regenerate) {
    return {
        guildId: String(guildId || ""),
        get: () => inviteStore.getGeneralInvite(guildId),
        set: (patch) => inviteStore.setGeneralInvite(guildId, patch),
        regenerate,
    };
}

/** Create the invite of a link unless it has one that still exists. Returns the store record, null for an unknown link. */
async function ensureLinkInvite(linkKey) {
    if (!linkTarget(linkKey)) return null;
    return ensureInvite(linkInviteArgs(linkKey, false));
}

/** Replace the invite of a link with a new one; the old one is deleted. */
async function regenerateLinkInvite(linkKey) {
    if (!linkTarget(linkKey)) return null;
    return ensureInvite(linkInviteArgs(linkKey, true));
}

/** Create the general invite of a server unless it has one that still exists. */
async function ensureGeneralInvite(guildId) {
    if (!guildId) return null;
    return ensureInvite(generalInviteArgs(guildId, false));
}

/** Replace the general invite of a server; the old one is deleted. */
async function regenerateGeneralInvite(guildId) {
    if (!guildId) return null;
    return ensureInvite(generalInviteArgs(guildId, true));
}

/**
 * Bot start: every link and every source server gets its invite (missing or
 * deleted ones are created again), then the counters are read.
 */
async function ensureAllInvites() {
    for (const link of guildRoles.links()) {
        await ensureLinkInvite(`${link.from}:${link.to}`);
    }
    for (const guildId of trackedGuildIds()) {
        await ensureGeneralInvite(guildId);
    }
    await warmUses();
}

/** inviteCreate: a counter starts at its uses (usually 0). */
function onInviteCreate(invite) {
    const guildId = invite && invite.guild && invite.guild.id;
    const uses = guildId ? usesByGuild.get(guildId) : null;
    if (uses && invite.code) uses.set(invite.code, Number(invite.uses) || 0);
}

/**
 * inviteDelete: the counter goes. An invite of ours that somebody deleted by
 * hand is created again (the partner's link must keep working).
 */
function onInviteDelete(invite) {
    const guildId = invite && invite.guild && invite.guild.id;
    const code = invite && invite.code;
    if (!guildId || !code) return;
    const uses = usesByGuild.get(guildId);
    if (uses) uses.delete(code);
    const known = inviteStore.knownCodes().find((k) => k.code === code && k.guildId === guildId);
    if (!known) return;
    const redo = known.linkKey ? ensureLinkInvite(known.linkKey) : ensureGeneralInvite(guildId);
    Promise.resolve(redo).catch((error) => log.warn(`invite ${code} not created again: ${error.message}`));
}

/** The invite (`{ inviteCode, linkKey }`) a join came through; empty fields when unknown. */
async function attribute(member) {
    const guild = member.guild;
    const before = usesByGuild.get(guild.id) || null;
    const after = await readUses(guild);
    if (!after) return { inviteCode: "", linkKey: "" };
    usesByGuild.set(guild.id, after);
    if (!before) return { inviteCode: "", linkKey: "" };
    const risen = [...after.entries()].filter(([code, uses]) => uses > (before.get(code) || 0)).map(([code]) => code);
    if (risen.length !== 1) return { inviteCode: "", linkKey: "" };
    const known = inviteStore.knownCodes().find((k) => k.code === risen[0] && k.guildId === guild.id);
    return { inviteCode: risen[0], linkKey: known ? known.linkKey : "" };
}

/**
 * guildMemberAdd: note through which invite the member came (tracked servers
 * only, bots never). Never throws; resolves with the stored origin or null.
 */
function onMemberAdd(member) {
    try {
        const guildId = member && member.guild && member.guild.id;
        if (!guildId || !member.user || member.user.bot) return Promise.resolve(null);
        if (!trackedGuildIds().includes(guildId)) return Promise.resolve(null);
        const next = (chains.get(guildId) || Promise.resolve())
            .then(() => attribute(member))
            .then((origin) => originStore.recordOrigin({ guildId, userId: member.id, ...origin }))
            .catch((error) => {
                log.warn(`origin of ${member.id} not recorded: ${error.message}`);
                return null;
            });
        chains.set(guildId, next);
        return next;
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
 * The settings page's view: every link with its invite, the error (a missing
 * bot right first), how many joined through it and how many of them signed
 * up for a raid of the source server; plus every source server's general
 * invite and invite channel.
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
            url: urlOf(record.code),
            channelId: record.channelId,
            createdAt: record.createdAt,
            error: liveError(link.from) || record.error,
            joined: origins.length,
            signedUp: origins.filter((o) => signed.has(o.userId)).length,
        };
    });
    const sources = trackedGuildIds();
    const servers = guildRoles.serverIds().map((guildId) => {
        const record = inviteStore.getGeneralInvite(guildId);
        const source = sources.includes(guildId);
        return {
            guildId,
            source,
            code: record.code,
            url: urlOf(record.code),
            channelId: record.channelId,
            inviteChannelId: inviteStore.getInviteChannel(guildId),
            // Only a source server needs the invite rights: elsewhere a missing one is no fault.
            error: source ? liveError(guildId) || record.error : "",
        };
    });
    return { links: linkRows, servers };
}

/** Tests: forget the counters and queues. */
function resetForTests() {
    usesByGuild.clear();
    chains.clear();
}

module.exports = {
    inviteUrlForLink, generalInviteUrl,
    ensureLinkInvite, regenerateLinkInvite, ensureGeneralInvite, regenerateGeneralInvite, ensureAllInvites,
    onInviteCreate, onInviteDelete, onMemberAdd, warmUses, inviteOverview, inviteChannelOf,
    missingInvitePermissions, INVITE_PERMISSIONS, resetForTests,
};
