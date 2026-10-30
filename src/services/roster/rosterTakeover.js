// The takeover of a Kader into Discord (docs/kaderplaner.md "Übernahme"): the
// orga confirms one dialog, the bot creates a role, a category (or uses one)
// and channels only the new role and the orga see, makes the role the main
// role of the roster linked to the Kader, takes every player from provisional
// upwards into that roster (as core) and hands them the role - one by one in
// the background, the server has one vCPU and Discord rate-limits role writes.
// Players already in the roster are set to core as well.
//
// The new role replaces the roster's roles (`roleIds = [new]`): the old roles
// stay in Discord, but the sync no longer follows them. A changed role set
// never removes anybody (rosterRoleSync only removes against a snapshot of the
// same set), so roster members outside the Kader simply stay in the roster -
// the precheck counts them ("roster_members_outside"). Should one of them get
// the new role later (the roster's role sync, by hand), "Discord → Kader"
// below takes him into the Kader as provisional.
//
// After that the two sides stay in step:
//   - Kader → Discord: a player of a taken-over Kader who falls below
//     provisional or leaves the Kader loses the roster and its roles
//     (kaderRoster.takeoverDrops computes it on every planner write of the orga,
//     `dropPlayers` carries it out). The roster is written first, so the role
//     update Discord sends back finds no member any more - no loop.
//   - Discord → Kader: a member who lost every role of the roster in Discord is
//     removed by rosterRoleSync (gateway event or the 10-minute reconcile),
//     which calls `onRoleLost`: the player goes back to provisional in the
//     Kader. Provisional is still a takeover state, so that write drops nobody.
//     A member who gains the role (by hand in Discord) and is not planned in
//     the Kader comes in as provisional (`onRoleGained`); one already planned
//     stays as he is. The gateway echo of the tool's own role writes is skipped
//     (memberRoles.recentWrite), and handOut checks each player again after
//     the write, so a player the orga moves meanwhile is not taken back in.
// A deleted Kader leaves roster, role and channels as they are; nothing
// follows it any more.
// A player who comes into the Kader later does not get the role on his own; he
// is "nachzuziehen" (`kaderRoster.pendingOf`) until the orga presses
// "Rolle nachziehen" (`pullRole`).
//
// A Kader without a linked roster gets one (only full admins, the route checks
// that): the takeover creates it with the new role as its main role, the Kader's
// name (the orga may change it), the Kader's version, the Kader's leads as
// managers and optionally a raid category of that version without a roster.
// The role is made first: should the roster then fail (category_taken ...),
// the role is deleted again - nothing is left half made.
//
// Only the Kader's own server, and every read or write of the planner goes
// through services/kader/kaderRoster.js (test/stores/kaderStore.test.js).
const { ChannelType, PermissionsBitField } = require("discord.js");
const logger = require("../../logger");
const discord = require("../discord/discord");
const memberRoles = require("../discord/roles/memberRoles");
const { canManageRoles } = require("../discord/roles/roleSync");
const { botCanManageChannels, discordErrorText } = require("../discord/discordChannels");
const { normalizeChannelName } = require("../../utils/channelNames");
const rosterStore = require("../../stores/rosterStore");
const { getConfig } = require("../../stores/settingsStore");
const { accessSettings, fullAdminRoleIds } = require("../discord/servers/serverAccess");
const { AppError } = require("../../web/http/apiResult");
const kaderRoster = require("../kader/kaderRoster");
const rosterMembers = require("./rosterMembers");
const rosterRoleSync = require("./rosterRoleSync");
const { kaderCharacter } = require("./rosterCreate");
const { rosterCategories } = require("./rosterOptions");
const { mirrorCategoryRoles } = require("./categoryRoles");
const { isVersionVisible } = require("../versions/mainVersion");

const Flags = PermissionsBitField.Flags;

/** How long the precheck waits for the member list (without the GuildMembers intent it never comes). */
const MEMBER_FETCH_MS = 10 * 1000;
/** The pause between two role writes. */
const ROLE_GAP_MS = 300;
/** At most this many channels in one takeover. */
const MAX_CHANNELS = 10;
const NAME_MAX = 100;
const SEPARATOR = "・";

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const refuse = (code, status, message) => new AppError(code, status, message);

// "guildId:kaderId" -> the promise of a running takeover or "Rolle nachziehen"
const running = new Map();
const keyOf = (guildId, kaderId) => `${str(guildId)}:${str(kaderId)}`;

/** The member list of a server as a Map id -> member, or null when it cannot be known in time. */
async function membersOf(guildId, guild, { timeoutMs = MEMBER_FETCH_MS } = {}) {
    if (!guild) return null;
    let timer;
    try {
        const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
        const list = await Promise.race([discord.fetchGuildMembersCached(guildId, guild), timeout]);
        if (!Array.isArray(list) || !list.length) return null;
        return new Map(list.filter((m) => m && m.id).map((m) => [String(m.id), m]));
    } catch (e) {
        logger.warn(`takeover: member list of ${guildId} unavailable:`, e && e.message);
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/** Whether the server may carry role icons (boost level 2, Discord's ROLE_ICONS feature). */
function iconPossible(guild) {
    return !!(guild && Array.isArray(guild.features) && guild.features.includes("ROLE_ICONS"));
}

/**
 * The image of a server emoji as a role icon takes it: always the static PNG.
 * A role icon cannot move, so an animated emoji gives its first frame - the
 * picker shows that same PNG, the orga sees what the role will carry.
 */
function emojiImageUrl(id, size = 64) {
    return `https://cdn.discordapp.com/emojis/${id}.png?size=${size}`;
}

/** The server's own emojis for the role icon: `[{ id, name, animated, url }]` by name, the PNG as `url`. */
function serverEmojisOf(guild) {
    if (!guild || !guild.emojis || !guild.emojis.cache) return [];
    return [...guild.emojis.cache.values()]
        .filter((e) => e && e.id && e.available !== false)
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
        .map((e) => ({ id: String(e.id), name: String(e.name || ""), animated: !!e.animated, url: emojiImageUrl(String(e.id)) }));
}

/** The categories of a server, in Discord's order: `[{ id, name }]`. */
function categoriesOf(guild) {
    if (!guild || !guild.channels || !guild.channels.cache) return [];
    return [...guild.channels.cache.values()]
        .filter((c) => c && c.type === ChannelType.GuildCategory)
        .sort((a, b) => (a.rawPosition ?? a.position ?? 0) - (b.rawPosition ?? b.position ?? 0))
        .map((c) => ({ id: String(c.id), name: String(c.name || "") }));
}

/**
 * What a recorded takeover made, as Discord has it now: `role` { id, name,
 * color ("#rrggbb", "" for none), gone } and `category` { id, name, gone },
 * null when nothing was made or the bot is offline (the Kader head shows them).
 */
function madeOf(guild, takeover) {
    if (!guild || !takeover) return { role: null, category: null };
    const role = takeover.roleId && guild.roles && guild.roles.cache ? guild.roles.cache.get(takeover.roleId) : null;
    const cat = takeover.categoryId && guild.channels && guild.channels.cache ? guild.channels.cache.get(takeover.categoryId) : null;
    return {
        role: takeover.roleId
            ? { id: takeover.roleId, name: role ? String(role.name || "") : takeover.roleName, color: role && role.color ? String(role.hexColor || "") : "", gone: !role }
            : null,
        category: takeover.categoryId ? { id: takeover.categoryId, name: cat ? String(cat.name || "") : "", gone: !cat } : null,
    };
}

/** The orga's roles on this server: admin and orga roles of the settings plus the roster's manager roles. */
function orgaRoleIdsOf(guild, roster) {
    const config = getConfig() || {};
    const ids = [
        // the full-admin roles and the orga roles of THIS server (#925)
        ...fullAdminRoleIds(config), ...accessSettings(guild && guild.id, config).orgaRoleIds,
        ...((roster && roster.managers && roster.managers.roleIds) || []),
    ].map(str).filter(Boolean);
    const cache = guild && guild.roles && guild.roles.cache;
    return [...new Set(ids)].filter((id) => id !== String(guild.id) && (!cache || cache.has(id)));
}

/** The roster a Kader's takeover writes into: the one it recorded, else the one linked to the Kader. */
function rosterOf(guildId, kader) {
    if (kader.takeover && kader.takeover.rosterId) return rosterStore.getRoster(kader.takeover.rosterId);
    return rosterStore.rosterForKader(kader.id, str(guildId));
}

/**
 * The raid categories a new roster of `versionId` may take: active ones that
 * play that version and have no roster of it yet, in Discord's order -
 * `[{ id, name, suggested }]`, `suggested` for the Kader's attendance categories.
 */
function freeCategoriesOf(guildId, versionId, suggestedIds = []) {
    const suggested = new Set((suggestedIds || []).map(str));
    return rosterCategories(guildId, getConfig() || {})
        .filter((c) => c.active && c.versionId === versionId && !rosterStore.rosterForCategory(c.id, versionId))
        .map((c) => ({ id: c.id, name: c.name, suggested: suggested.has(c.id) }));
}

/**
 * The precheck's roster part: its blockers (no_roster for a recorded takeover
 * whose roster is gone, roster_closed, version_hidden for a roster to create)
 * and - without a roster - what the takeover would create.
 */
function rosterSideOf(gid, kader, roster, withCategories) {
    const blockers = [];
    const createsRoster = !roster && !kader.takeover;
    const versionId = kaderRoster.kaderVersion(kader.versionId);
    if (!roster && kader.takeover) blockers.push("no_roster");
    else if (roster && roster.closedAt) blockers.push("roster_closed");
    if (createsRoster && !isVersionVisible(versionId, getConfig() || {})) blockers.push("version_hidden");
    return {
        blockers,
        createsRoster,
        newRoster: createsRoster ? { name: str(kader.name).slice(0, rosterStore.LIMITS.name), versionId } : null,
        rosterCategories: createsRoster && withCategories ? freeCategoriesOf(gid, versionId, kader.attendanceCategories) : [],
    };
}

/**
 * GET side: what a takeover would do or did. `blockers` keep the start
 * refused, `notes` only inform ("icon_not_possible", "roster_members_outside"
 * with `outsideCount` roster members the Kader does not plan - they stay in the
 * roster). The players carry whether they are on the server and hold the role -
 * null when unknown. `aborted`: a takeover still "running" without a job in
 * this process - the bot restarted while handing out, the rest is
 * "nachzuziehen". `role` / `category`: what the takeover made, as Discord has
 * it now (madeOf). `categories` only with `opts.withCategories` (the caller
 * may start the takeover), `emojis` (serverEmojisOf, for the role icon) only
 * with it and a server that can show role icons. Without a roster (and no takeover yet) the
 * takeover creates one: `createsRoster`, the note "creates_roster",
 * `newRoster` { name (the Kader's), versionId } and - with
 * `opts.withCategories` - `rosterCategories` (freeCategoriesOf); a hidden
 * version blocks ("version_hidden").
 */
async function precheck(guildId, kaderId, opts = {}) {
    const gid = str(guildId);
    const kader = kaderRoster.takeoverPlayers(gid, kaderId);
    if (!kader) throw refuse("kader_not_found", 404, "Kader nicht gefunden.");
    const roster = rosterOf(gid, kader);
    const guild = discord.isOnline() ? discord.getGuild(gid) : null;
    const manageRoles = !!guild && canManageRoles(gid);
    const manageChannels = guild ? botCanManageChannels(gid) : null;
    const { blockers, ...rosterSide } = rosterSideOf(gid, kader, roster, opts.withCategories);
    if (!guild) blockers.push("offline");
    else {
        if (!manageRoles) blockers.push("no_manage_roles");
        if (manageChannels === false) blockers.push("no_manage_channels");
    }
    if (!kader.players.length) blockers.push("no_players");
    if (kader.takeover) blockers.push("already_taken");
    const notes = guild && !iconPossible(guild) ? ["icon_not_possible"] : [];
    if (rosterSide.createsRoster) notes.push("creates_roster");
    const planned = new Set(kader.players.map((p) => p.userId));
    const outsideCount = roster ? Object.keys(roster.members || {}).filter((uid) => !planned.has(uid)).length : 0;
    if (outsideCount) notes.push("roster_members_outside");
    const isRunning = running.has(keyOf(gid, kader.id));
    const members = await membersOf(gid, guild, opts);
    const roleId = kader.takeover ? kader.takeover.roleId : "";
    const results = kader.takeover ? kader.takeover.results : {};
    const players = kader.players.map((p) => {
        const member = members ? members.get(p.userId) : null;
        return {
            ...p,
            onServer: members ? !!member : null,
            hasRole: roleId && members ? !!(member && member.roles && member.roles.cache && member.roles.cache.has(roleId)) : null,
            inRoster: !!(roster && roster.members[p.userId]),
            result: results[p.userId] || null,
        };
    });
    return {
        kader: { id: kader.id, name: kader.name, versionId: kader.versionId, rev: kader.rev },
        roster: roster ? { id: roster.id, name: roster.name, closed: !!roster.closedAt, roleIds: [...roster.roleIds] } : null,
        online: !!guild,
        canManageRoles: manageRoles,
        canManageChannels: manageChannels,
        iconPossible: iconPossible(guild),
        premiumTier: guild ? Number(guild.premiumTier) || 0 : null,
        blockers,
        notes,
        outsideCount,
        takeover: kader.takeover,
        ...madeOf(guild, kader.takeover),
        running: isRunning,
        aborted: !!(kader.takeover && kader.takeover.status === "running" && !isRunning),
        pending: kader.pending,
        pendingCount: kader.pending.length,
        ...pullableOf(kader.pending, members),
        players,
        categories: opts.withCategories ? categoriesOf(guild) : [],
        emojis: opts.withCategories && iconPossible(guild) ? serverEmojisOf(guild) : [],
        ...rosterSide,
    };
}

/**
 * Who "Rolle nachziehen" can reach: `pullCount` pending players on the server
 * (all of them when the member list is unknown), `pendingAway` those not on it.
 * Joining the server later gives nobody the role by itself (rosterRoleSync only
 * reads roles from Discord), so they wait here until they join and the orga pulls.
 */
function pullableOf(pending, members) {
    if (!members) return { pullCount: pending.length, pendingAway: 0 };
    const away = pending.filter((uid) => !members.has(uid)).length;
    return { pullCount: pending.length - away, pendingAway: away };
}

/** "#rrggbb" as a number, null for none; anything else is refused. */
function colorOf(raw) {
    const s = str(raw);
    if (!s) return null;
    if (!/^#[0-9a-f]{6}$/i.test(s)) throw refuse("invalid_color", 400, "Farbe bitte als #rrggbb.");
    return parseInt(s.slice(1), 16);
}

/** A short emoji (no custom emoji, no text): what a role icon and a channel prefix take. */
function emojiOf(raw) {
    const s = str(raw);
    if (!s) return "";
    if (s.length > 16 || /[\w<>:#@]/.test(s)) throw refuse("invalid_emoji", 400, "Nur ein Unicode-Emoji.");
    return s;
}

/** `emoji・name`, as docs/channels.md names a channel. */
function prefixed(emoji, name) {
    return emoji ? `${emoji}${SEPARATOR}${name}` : name;
}

/**
 * The role icon from a server emoji: its id, checked against the server's
 * emojis - "" for none, 400 `invalid_emoji` for one the server does not have.
 */
function serverEmojiOf(raw, guild) {
    const id = str(raw);
    if (!id) return "";
    if (!serverEmojisOf(guild).some((e) => e.id === id)) throw refuse("invalid_emoji", 400, "Dieses Emoji gibt es auf dem Server nicht.");
    return id;
}

/**
 * The checked body of a start: `{ role: { name, color, unicodeEmoji, emojiId },
 * category: { id } | { name }, channels: [{ name, orgaOnlyWrite }] }`. The role
 * icon is a Unicode emoji or a server emoji, never both (400 `invalid_emoji`).
 */
function planOf(body, guild) {
    const role = (body && body.role) || {};
    const roleName = str(role.name).slice(0, NAME_MAX);
    if (!roleName) throw refuse("invalid_role", 400, "Die Rolle braucht einen Namen.");
    if (str(role.unicodeEmoji) && str(role.emojiId)) throw refuse("invalid_emoji", 400, "Entweder ein Unicode-Emoji oder ein Server-Emoji.");
    const plan = { role: { name: roleName, color: colorOf(role.color), unicodeEmoji: emojiOf(role.unicodeEmoji), emojiId: serverEmojiOf(role.emojiId, guild) } };
    const cat = (body && body.category) || {};
    if (str(cat.id)) {
        const found = categoriesOf(guild).find((c) => c.id === str(cat.id));
        if (!found) throw refuse("invalid_category", 400, "Diese Kategorie gibt es auf dem Server nicht.");
        plan.category = { id: found.id, name: found.name };
    } else {
        const name = prefixed(emojiOf(cat.emoji), str(cat.name)).slice(0, NAME_MAX);
        if (!str(cat.name)) throw refuse("invalid_category", 400, "Bitte eine Kategorie wählen oder benennen.");
        plan.category = { name };
    }
    const channels = Array.isArray(body && body.channels) ? body.channels : [];
    if (channels.length > MAX_CHANNELS) throw refuse("too_many_channels", 400, `Höchstens ${MAX_CHANNELS} Kanäle.`);
    plan.channels = channels.map((c) => {
        const name = normalizeChannelName(prefixed(emojiOf(c && c.emoji), str(c && c.name)));
        if (!str(c && c.name) || !name) throw refuse("invalid_channel", 400, "Jeder Kanal braucht einen Namen.");
        return { name, orgaOnlyWrite: !!(c && c.orgaOnlyWrite) };
    });
    return plan;
}

/** The permission overwrites of the takeover's category and channels. */
function overwritesOf(guild, roleId, orgaIds, { orgaOnlyWrite = false } = {}) {
    const list = [
        { id: String(guild.id), deny: [Flags.ViewChannel] },
        { id: roleId, allow: [Flags.ViewChannel], deny: orgaOnlyWrite ? [Flags.SendMessages] : [] },
        ...orgaIds.map((id) => ({ id, allow: [Flags.ViewChannel, Flags.SendMessages] })),
    ];
    const me = guild.members && guild.members.me;
    if (me && me.id) list.push({ id: String(me.id), allow: [Flags.ViewChannel, Flags.SendMessages, Flags.ManageChannels] });
    return list;
}

/** The result of one role write as the takeover keeps it: ok, missing (not on the server) or failed. */
function resultOf(change) {
    if (!change) return "failed";
    if (change.ok || change.code === "done" || change.code === "unchanged") return "ok";
    return change.code === "not_member" ? "missing" : "failed";
}

/**
 * Undoes one turn of handOut for a player the orga moved below provisional
 * meanwhile - what dropPlayers does: a roster member leaves the roster (and
 * loses its roles), anybody else just loses the role just given. Never throws.
 */
async function takeBack(rosterId, uid, roleId, { actor = "" } = {}) {
    try {
        const roster = rosterStore.getRoster(rosterId);
        if (!roster) return;
        if (roster.members[uid]) await rosterMembers.removeMember(rosterId, uid, { actor });
        else await rosterRoleSync.applyRoleChange(roster, uid, roleId, false, { actor });
        logger.info(`takeover: ${uid} was moved while getting the role of roster ${rosterId} - taken back`);
    } catch (e) {
        logger.warn(`takeover: could not take back the role of ${uid}:`, e && (e.code || e.message));
    }
}

/**
 * Hands the role to `players` one by one: a player who is no roster member
 * yet joins as core (with the Kader's character) and gets the roster's main
 * role that way; a member already in the roster is set to core and gets the
 * role. With `guildId`/`kaderId` each player is checked against the Kader
 * right before his turn - the orga can move players while the role is handed
 * out, and a player no longer planned is skipped (no result). The check runs
 * again after the role write: a player moved meanwhile has his turn taken back
 * (takeBack) and gets no result either. Never throws.
 * @returns {Promise<Object<string, "ok"|"missing"|"failed">>}
 */
async function handOut(rosterId, roleId, players, { actor = "", gapMs = ROLE_GAP_MS, guildId = "", kaderId = "" } = {}) {
    const results = {};
    for (const [i, player] of players.entries()) {
        const uid = player.userId;
        if (i > 0 && gapMs) await sleep(gapMs);
        try {
            if (guildId && kaderId && !kaderRoster.stillPlanned(guildId, kaderId, uid)) continue;
            const roster = rosterStore.getRoster(rosterId);
            if (!roster || roster.closedAt) {
                results[uid] = "failed";
                continue;
            }
            if (!roster.members[uid]) {
                const added = await rosterMembers.addMember(rosterId, uid, { status: "core", chars: kaderCharacter(player, roster.versionId) }, { actor });
                const change = added.ok ? ((added.roles && added.roles.results) || []).find((r) => r.roleId === roleId) : null;
                results[uid] = added.ok ? resultOf(change) : "failed";
            } else {
                if (roster.members[uid].status !== "core") await rosterMembers.setStatus(rosterId, uid, "core", { actor });
                results[uid] = resultOf(await rosterRoleSync.applyRoleChange(rosterStore.getRoster(rosterId), uid, roleId, true, { actor }));
            }
            // The orga may have moved the player while the role was written; its
            // drop (dropPlayers) then ran before the role was there - take it back.
            if (guildId && kaderId && !kaderRoster.stillPlanned(guildId, kaderId, uid)) {
                await takeBack(rosterId, uid, roleId, { actor });
                delete results[uid];
            }
        } catch (e) {
            logger.warn(`takeover: role for ${uid} failed:`, e && (e.code || e.message));
            results[uid] = "failed";
        }
    }
    return results;
}

/** Runs `job` under the Kader's lock; the lock goes with the job's end. */
function locked(guildId, kaderId, job) {
    const key = keyOf(guildId, kaderId);
    const promise = Promise.resolve()
        .then(job)
        .catch((e) => logger.error(`takeover ${key}:`, e && e.message))
        .finally(() => running.delete(key));
    running.set(key, promise);
    return promise;
}

/** Test and shutdown helper: the running job of a Kader, resolved when it is done. */
function whenIdle(guildId, kaderId) {
    return running.get(keyOf(guildId, kaderId)) || Promise.resolve();
}

/**
 * The common refusals of start and pullRole: lock, roster, server, rights.
 * `createsRoster`: the start creates the roster, none is needed yet.
 */
function assertCanWrite(gid, kader, roster, { createsRoster = false } = {}) {
    if (running.has(keyOf(gid, kader.id))) throw refuse("running", 409, "Die Übernahme läuft gerade.");
    if (!roster && !createsRoster) throw refuse("no_roster", 409, "Der Kader hat kein verknüpftes Roster.");
    if (roster && roster.closedAt) throw refuse("roster_closed", 409, "Das Roster ist geschlossen.");
    const guild = discord.isOnline() ? discord.getGuild(gid) : null;
    if (!guild) throw refuse("offline", 503, "Der Bot ist gerade nicht mit Discord verbunden.");
    if (!canManageRoles(gid)) throw refuse("no_manage_roles", 409, "Dem Bot fehlt das Recht „Rollen verwalten“.");
    return guild;
}

/**
 * The checked roster a start without one creates: `{ name, versionId,
 * categoryId }` from `body.roster` { name?, categoryId? } - the name falls back
 * to the Kader's, the version is the Kader's, the category (optional) must be a
 * free one of that version (freeCategoriesOf).
 */
function newRosterOf(gid, kader, body) {
    const input = (body && body.roster) || {};
    const name = (str(input.name) || str(kader.name)).slice(0, rosterStore.LIMITS.name);
    if (!name) throw refuse("invalid_name", 400, "Das Roster braucht einen Namen.");
    const versionId = kaderRoster.kaderVersion(kader.versionId);
    if (!isVersionVisible(versionId, getConfig() || {})) {
        throw refuse("version_hidden", 409, "Diese Spielversion ist ausgeblendet – ein Roster bekommt eine sichtbare Spielversion.");
    }
    const categoryId = str(input.categoryId) || null;
    if (categoryId && !freeCategoriesOf(gid, versionId).some((c) => c.id === categoryId)) {
        if (rosterStore.rosterForCategory(categoryId, versionId)) throw refuse("category_taken", 409, "Diese Kategorie hat schon ein Roster dieser Spielversion.");
        throw refuse("invalid_roster_category", 400, "Diese Raid-Kategorie steht für das neue Roster nicht zur Auswahl.");
    }
    return { name, versionId, categoryId };
}

/**
 * Step 2 without a linked roster: the new roster, linked to the Kader, the new
 * role its main role. The category roles are mirrored by the caller, after the
 * roster stands (a failed mirror must not delete the role of a made roster).
 */
function createRosterFor(gid, kader, newRoster, roleId, { actor = "" } = {}) {
    return rosterStore.createRoster({
        guildId: gid,
        name: newRoster.name,
        versionId: newRoster.versionId,
        categoryId: newRoster.categoryId,
        kaderId: kader.id,
        source: { kind: "kader", kaderId: kader.id },
        roleIds: [roleId],
        managers: { roleIds: [], userIds: [...(kader.leads || [])] },
    }, { actor });
}

/**
 * The category's raider roles follow the roster's new role, as when a roster is
 * created or its roles are saved by hand - else a later save of the category
 * roles (syncRosterRoleIds) would bring the old ones back. Only logs on failure:
 * the roster and the role already stand.
 */
function mirrorRolesOf(rosterId, key) {
    try {
        mirrorCategoryRoles(rosterStore.getRoster(rosterId));
    } catch (e) {
        logger.warn(`takeover ${key}: category roles not mirrored: ${(e && e.message) || e}`);
    }
}

/**
 * The start's path must be the one the route checked the rights for
 * (`createsRoster`): a roster linked or unlinked in between refuses, so neither
 * a manager creates a roster nor a chosen new roster is silently dropped.
 */
function assertRosterPath(linked, body, createsRoster) {
    if (!linked && !createsRoster) throw refuse("no_roster", 409, "Der Kader hat kein verknüpftes Roster.");
    if (linked && (createsRoster || (body && body.roster))) {
        throw refuse("roster_linked", 409, "Inzwischen ist ein Roster mit dem Kader verknüpft – bitte neu laden.");
    }
}

/** Step 1: the role, below the bot's role. Refuses (and cleans up) otherwise. */
async function makeRole(guild, plan, kader) {
    const able = iconPossible(guild);
    const icon = plan.role.unicodeEmoji && able ? plan.role.unicodeEmoji : "";
    const image = plan.role.emojiId && able ? emojiImageUrl(plan.role.emojiId, 128) : "";
    let role;
    try {
        role = await guild.roles.create({
            name: plan.role.name,
            ...(plan.role.color !== null ? { colors: { primaryColor: plan.role.color } } : {}),
            ...(icon ? { unicodeEmoji: icon } : {}),
            ...(image ? { icon: image } : {}),
            // its own group in the member list instead of "Online"
            hoist: true,
            permissions: [],
            reason: `EventHelper: Übernahme des Kaders ${kader.name}`,
        });
    } catch (e) {
        throw refuse("role_failed", 502, `Rolle nicht angelegt: ${discordErrorText(e)}`);
    }
    if (!memberRoles.roleBelowBot(guild, role)) {
        await Promise.resolve(role.delete && role.delete("EventHelper: Rolle über der Bot-Rolle")).catch(() => {});
        throw refuse("role_too_high", 409, "Die neue Rolle läge über der Bot-Rolle.");
    }
    const iconState = icon || image ? "set" : (plan.role.unicodeEmoji || plan.role.emojiId ? "not_possible" : "none");
    return { role, step: { step: "role", ok: true, id: String(role.id), name: role.name, icon: iconState } };
}

/** Step 3: category (existing or new) and channels; every failure is its own step. */
async function makeChannels(guild, plan, kader, roleId, orgaIds, steps) {
    const reason = `EventHelper: Übernahme des Kaders ${kader.name}`;
    let categoryId = plan.category.id || "";
    if (categoryId) {
        steps.push({ step: "category", ok: true, id: categoryId, name: plan.category.name, existing: true });
    } else {
        try {
            const cat = await guild.channels.create({
                name: plan.category.name, type: ChannelType.GuildCategory,
                permissionOverwrites: overwritesOf(guild, roleId, orgaIds), reason,
            });
            categoryId = String(cat.id);
            steps.push({ step: "category", ok: true, id: categoryId, name: cat.name, existing: false });
        } catch (e) {
            steps.push({ step: "category", ok: false, name: plan.category.name, error: discordErrorText(e) });
        }
    }
    const channelIds = [];
    for (const ch of plan.channels) {
        if (!categoryId) {
            steps.push({ step: "channel", ok: false, name: ch.name, error: "keine Kategorie" });
            continue;
        }
        try {
            const made = await guild.channels.create({
                name: ch.name, type: ChannelType.GuildText, parent: categoryId,
                permissionOverwrites: overwritesOf(guild, roleId, orgaIds, { orgaOnlyWrite: ch.orgaOnlyWrite }), reason,
            });
            channelIds.push(String(made.id));
            steps.push({ step: "channel", ok: true, id: String(made.id), name: made.name });
        } catch (e) {
            steps.push({ step: "channel", ok: false, name: ch.name, error: discordErrorText(e) });
        }
    }
    return { categoryId, channelIds };
}

/**
 * POST side: starts the takeover. `body`: `{ confirm: true, baseRev, role: {
 * name, color?: "#rrggbb", unicodeEmoji? | emojiId? }, category: { id } | { name, emoji? },
 * channels: [{ name, emoji?, orgaOnlyWrite? }], roster?: { name?, categoryId? } }`.
 * Creates role, category and channels right away (each step reports on its
 * own), records the takeover and hands out the role in the background.
 * `roster` only counts for a Kader without a linked roster: the roster the
 * takeover creates (newRosterOf). `createsRoster` is what the caller checked
 * the rights for (true: no roster linked, a new one is made); a linked roster
 * that differs from it refuses (assertRosterPath).
 * @returns {Promise<{ takeover, steps: object[], assigning: number }>}
 */
async function start(guildId, kaderId, body = {}, { actor = "", gapMs = ROLE_GAP_MS, createsRoster = false } = {}) {
    const gid = str(guildId);
    if (!body || body.confirm !== true) throw refuse("confirm_required", 400, "Bitte die Übernahme bestätigen.");
    if (body.baseRev === undefined || body.baseRev === null || body.baseRev === "") {
        throw refuse("base_rev_required", 400, "Die Übernahme braucht den Stand, von dem sie ausgeht (baseRev).");
    }
    const kader = kaderRoster.takeoverPlayers(gid, kaderId);
    if (!kader) throw refuse("kader_not_found", 404, "Kader nicht gefunden.");
    // a planner write since the dialog opened: the orga confirmed another list
    kaderRoster.assertTakeoverFresh(kader, body);
    if (kader.takeover) throw refuse("already_taken", 409, "Dieser Kader wurde schon übernommen.");
    if (!kader.players.length) throw refuse("no_players", 409, "Im Kader ist niemand ab vorläufig.");
    const linked = rosterOf(gid, kader);
    assertRosterPath(linked, body, createsRoster);
    const guild = assertCanWrite(gid, kader, linked, { createsRoster });
    const plan = planOf(body, guild);
    const newRoster = linked ? null : newRosterOf(gid, kader, body);
    if ((plan.category.name !== undefined && !plan.category.id) || plan.channels.length) {
        if (botCanManageChannels(gid) === false) throw refuse("no_manage_channels", 409, "Dem Bot fehlt das Recht „Kanäle verwalten“.");
    }
    const key = keyOf(gid, kader.id);
    running.set(key, Promise.resolve());
    const steps = [];
    let role;
    try {
        // 1. the role
        const made = await makeRole(guild, plan, kader);
        role = made.role;
        const roleId = String(role.id);
        steps.push(made.step);

        // 2. the roster's main role - or the new roster with it
        let roster = linked;
        try {
            if (roster) {
                // the new role replaces the old ones: they stay in Discord, the sync no
                // longer follows them (a changed role set never removes anybody)
                rosterStore.updateRoster(roster.id, { roleIds: [roleId] }, { actor });
                steps.push({ step: "roster", ok: true, id: roster.id, name: roster.name, created: false });
            } else {
                roster = createRosterFor(gid, kader, newRoster, roleId, { actor });
                steps.push({ step: "roster", ok: true, id: roster.id, name: roster.name, created: true });
            }
        } catch (e) {
            await Promise.resolve(role.delete && role.delete("EventHelper: Roster nicht beschreibbar")).catch(() => {});
            const what = linked ? "Roster nicht beschreibbar" : "Roster nicht angelegt";
            throw refuse((e && e.code) || "roster_failed", 409, `${what}: ${(e && e.message) || "?"}`);
        }
        mirrorRolesOf(roster.id, key);

        // 3. category and channels, only the new role and the orga see them
        const orgaIds = orgaRoleIdsOf(guild, rosterStore.getRoster(roster.id));
        const { categoryId, channelIds } = await makeChannels(guild, plan, kader, roleId, orgaIds, steps);

        // 4. the record, then the roles in the background
        const saved = kaderRoster.saveTakeover(gid, kader.id, {
            rosterId: roster.id, roleId, roleName: role.name, categoryId, channelIds,
        }, { actor });
        running.delete(key);
        if (!saved) {
            // the Kader is gone (or no longer writable): nothing to hand out
            logger.warn(`takeover ${key}: record not saved, no roles handed out`);
            return { takeover: null, steps, assigning: 0 };
        }
        locked(gid, kader.id, async () => {
            const results = await handOut(roster.id, roleId, kader.players, { actor, gapMs, guildId: gid, kaderId: kader.id });
            kaderRoster.finishTakeover(gid, kader.id, results, { actor });
            logger.info(`takeover ${key}: ${Object.values(results).filter((r) => r === "ok").length}/${kader.players.length} roles given`);
        });
        return { takeover: saved.takeover, steps, assigning: kader.players.length };
    } catch (e) {
        // every throw lies before the background job took the lock over
        running.delete(key);
        throw e;
    }
}

/**
 * "Rolle nachziehen": the role for every player still waiting for it
 * (kaderRoster.pendingOf) who is on the server, in the background like the
 * takeover. Players known to be away are skipped (`away`); with the member
 * list unknown everybody pending is tried.
 * @returns {Promise<{ count: number, away: number }>}
 */
async function pullRole(guildId, kaderId, { actor = "", gapMs = ROLE_GAP_MS, timeoutMs = MEMBER_FETCH_MS } = {}) {
    const gid = str(guildId);
    const kader = kaderRoster.takeoverPlayers(gid, kaderId);
    if (!kader) throw refuse("kader_not_found", 404, "Kader nicht gefunden.");
    if (!kader.takeover) throw refuse("not_taken", 409, "Dieser Kader wurde noch nicht übernommen.");
    const roster = rosterOf(gid, kader);
    const guild = assertCanWrite(gid, kader, roster);
    const roleId = kader.takeover.roleId;
    if (guild.roles && guild.roles.cache && !guild.roles.cache.has(roleId)) throw refuse("role_gone", 409, "Die Rolle der Übernahme gibt es nicht mehr.");
    const members = await membersOf(gid, guild, { timeoutMs });
    const pending = new Set(kader.pending);
    const waiting = kader.players.filter((p) => pending.has(p.userId));
    const players = members ? waiting.filter((p) => members.has(p.userId)) : waiting;
    const away = waiting.length - players.length;
    if (!players.length) return { count: 0, away };
    assertCanWrite(gid, kader, roster); // again: another pull may have started while the list loaded
    locked(gid, kader.id, async () => {
        const results = await handOut(roster.id, roleId, players, { actor, gapMs, guildId: gid, kaderId: kader.id });
        kaderRoster.markRoleGiven(gid, kader.id, results, { actor });
    });
    return { count: players.length, away };
}

/**
 * Carries out kaderRoster.takeoverDrops: each player leaves the roster and
 * loses its roles. The roster is written first (rosterMembers.removeMember),
 * so the role event coming back from Discord finds no member. Never throws.
 */
async function dropPlayers(drops, { actor = "" } = {}) {
    let removed = 0;
    for (const { rosterId, userId } of drops || []) {
        try {
            const roster = rosterStore.getRoster(rosterId);
            if (!roster || roster.closedAt || !roster.members[userId]) continue;
            const res = await rosterMembers.removeMember(rosterId, userId, { actor });
            if (res && res.ok) removed += 1;
        } catch (e) {
            logger.warn(`takeover: could not drop ${userId} from roster ${rosterId}:`, e && (e.code || e.message));
        }
    }
    return removed;
}

/**
 * rosterRoleSync removed a member who lost the roster's roles in Discord: in
 * the Kader taken over into this roster, the player goes back to provisional.
 * @returns {boolean} whether the Kader changed
 */
function onRoleLost(roster, userId) {
    if (!roster || !roster.kaderId || !roster.guildId) return false;
    const kader = kaderRoster.takeoverPlayers(roster.guildId, roster.kaderId);
    if (!kader || !kader.takeover || kader.takeover.rosterId !== roster.id) return false;
    const changed = kaderRoster.backToProvisional(roster.guildId, kader.id, userId, { actor: "" });
    if (changed) logger.info(`${userId} lost the role of roster ${roster.id} in Discord - back to provisional in Kader ${kader.id}`);
    return changed;
}

/**
 * rosterRoleSync saw a member gain a role of the roster in Discord by hand (the
 * echo of the tool's own writes is skipped there): in the Kader taken over into
 * this roster, a player who is not (or below provisional) in the Kader comes in
 * as provisional. A player already planned stays as he is - checked first, as
 * it is cheap and the reconcile after a restart calls this for every holder.
 * @returns {boolean} whether the Kader changed
 */
function onRoleGained(roster, userId, { name = "" } = {}) {
    if (!roster || !roster.kaderId || !roster.guildId) return false;
    if (kaderRoster.stillPlanned(roster.guildId, roster.kaderId, userId)) return false;
    const kader = kaderRoster.takeoverPlayers(roster.guildId, roster.kaderId);
    if (!kader || !kader.takeover || kader.takeover.rosterId !== roster.id) return false;
    const changed = kaderRoster.roleGainedFromDiscord(roster.guildId, kader.id, userId, { name, actor: "" });
    if (changed) logger.info(`${userId} got the role of roster ${roster.id} in Discord - provisional in Kader ${kader.id}`);
    return changed;
}

// Discord -> Kader: rosterRoleSync calls these when a member loses or gains
// the role (registered, not required back - that would be a require cycle).
// Loaded at start through web/apiRoutes/roster/kader.js.
rosterRoleSync.setRoleLostHandler(onRoleLost);
rosterRoleSync.setRoleGainedHandler(onRoleGained);

/** Test-only: forget the locks. */
function _resetForTests() {
    running.clear();
}

module.exports = {
    precheck, start, pullRole, dropPlayers, onRoleLost, onRoleGained, whenIdle,
    planOf, overwritesOf, resultOf, handOut, membersOf,
    MEMBER_FETCH_MS, ROLE_GAP_MS, MAX_CHANNELS, _resetForTests,
};
