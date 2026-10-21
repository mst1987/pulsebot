// The takeover of a Kader into Discord (docs/kaderplaner.md "Übernahme"): the
// orga confirms one dialog, the bot creates a role, a category (or uses one)
// and channels only the new role and the orga see, makes the role the main
// role of the roster linked to the Kader, takes every player from provisional
// upwards into that roster (as core) and hands them the role - one by one in
// the background, the server has one vCPU and Discord rate-limits role writes.
//
// After that the two sides stay in step:
//   - Kader → Discord: a player of a taken-over Kader who falls below
//     provisional or leaves the Kader loses the roster and its roles
//     (kaderRoster.takeoverDrops computes it on every planner write of the orga,
//     `dropPlayers` carries it out). The roster is written first, so the role
//     event Discord sends back finds no member any more - no loop.
//   - Discord → Kader: a member who lost every role of the roster in Discord is
//     removed by rosterRoleSync (gateway event or the 10-minute reconcile),
//     which calls `onRoleLost`: the player goes back to provisional in the
//     Kader. Provisional is still a takeover state, so that write drops nobody.
// A player who comes into the Kader later does not get the role on his own; he
// is "nachzuziehen" (`kaderRoster.pendingOf`) until the orga presses
// "Rolle nachziehen" (`pullRole`).
//
// Only the Kader's own server, and every read or write of the planner goes
// through services/kader/kaderRoster.js (test/stores/kaderStore.test.js).
const { ChannelType, PermissionsBitField } = require("discord.js");
const logger = require("../../logger");
const discord = require("../discord/discord");
const memberRoles = require("../discord/memberRoles");
const { canManageRoles } = require("../discord/roleSync");
const { botCanManageChannels, discordErrorText } = require("../discord/discordChannels");
const { normalizeChannelName } = require("../../utils/channelNames");
const rosterStore = require("../../stores/rosterStore");
const { getConfig } = require("../../stores/settingsStore");
const { adminRoleIds: envAdminRoleIds } = require("../../config/variables");
const { AppError } = require("../../web/http/apiResult");
const kaderRoster = require("../kader/kaderRoster");
const rosterMembers = require("./rosterMembers");
const rosterRoleSync = require("./rosterRoleSync");
const { kaderCharacter } = require("./rosterCreate");

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

/** The categories of a server, in Discord's order: `[{ id, name }]`. */
function categoriesOf(guild) {
    if (!guild || !guild.channels || !guild.channels.cache) return [];
    return [...guild.channels.cache.values()]
        .filter((c) => c && c.type === ChannelType.GuildCategory)
        .sort((a, b) => (a.rawPosition ?? a.position ?? 0) - (b.rawPosition ?? b.position ?? 0))
        .map((c) => ({ id: String(c.id), name: String(c.name || "") }));
}

/** The orga's roles on this server: admin and orga roles of the settings plus the roster's manager roles. */
function orgaRoleIdsOf(guild, roster) {
    const config = getConfig() || {};
    const ids = [
        ...(config.adminRoleIds || []), ...(envAdminRoleIds || []), ...(config.orgaRoleIds || []),
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
 * GET side: what a takeover would do or did. `blockers` keep the start
 * refused, `notes` only inform ("icon_not_possible"). The players carry
 * whether they are on the server and hold the role - null when unknown.
 */
async function precheck(guildId, kaderId, opts = {}) {
    const gid = str(guildId);
    const kader = kaderRoster.takeoverPlayers(gid, kaderId);
    if (!kader) throw refuse("kader_not_found", 404, "Kader nicht gefunden.");
    const roster = rosterOf(gid, kader);
    const guild = discord.isOnline() ? discord.getGuild(gid) : null;
    const manageRoles = !!guild && canManageRoles(gid);
    const manageChannels = guild ? botCanManageChannels(gid) : null;
    const blockers = [];
    if (!roster) blockers.push("no_roster");
    else if (roster.closedAt) blockers.push("roster_closed");
    if (!guild) blockers.push("offline");
    else {
        if (!manageRoles) blockers.push("no_manage_roles");
        if (manageChannels === false) blockers.push("no_manage_channels");
    }
    if (!kader.players.length) blockers.push("no_players");
    if (kader.takeover) blockers.push("already_taken");
    const notes = guild && !iconPossible(guild) ? ["icon_not_possible"] : [];
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
        takeover: kader.takeover,
        running: running.has(keyOf(gid, kader.id)),
        pending: kader.pending,
        pendingCount: kader.pending.length,
        players,
        categories: categoriesOf(guild),
    };
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
 * The checked body of a start: `{ role: { name, color, unicodeEmoji },
 * category: { id } | { name }, channels: [{ name, orgaOnlyWrite }] }`.
 */
function planOf(body, guild) {
    const role = (body && body.role) || {};
    const roleName = str(role.name).slice(0, NAME_MAX);
    if (!roleName) throw refuse("invalid_role", 400, "Die Rolle braucht einen Namen.");
    const plan = { role: { name: roleName, color: colorOf(role.color), unicodeEmoji: emojiOf(role.unicodeEmoji) } };
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
 * Hands the role to `userIds` one by one: a player who is no roster member
 * yet joins as core (with the Kader's character) and gets the roster's main
 * role that way, a member gets the role alone. Never throws.
 * @returns {Promise<Object<string, "ok"|"missing"|"failed">>}
 */
async function handOut(rosterId, roleId, players, { actor = "", gapMs = ROLE_GAP_MS } = {}) {
    const results = {};
    for (const [i, player] of players.entries()) {
        const uid = player.userId;
        try {
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
                results[uid] = resultOf(await rosterRoleSync.applyRoleChange(roster, uid, roleId, true, { actor }));
            }
        } catch (e) {
            logger.warn(`takeover: role for ${uid} failed:`, e && (e.code || e.message));
            results[uid] = "failed";
        }
        if (gapMs && i < players.length - 1) await sleep(gapMs);
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

/** The common refusals of start and pullRole: lock, roster, server, rights. */
function assertCanWrite(gid, kader, roster) {
    if (running.has(keyOf(gid, kader.id))) throw refuse("running", 409, "Die Übernahme läuft gerade.");
    if (!roster) throw refuse("no_roster", 409, "Der Kader hat kein verknüpftes Roster.");
    if (roster.closedAt) throw refuse("roster_closed", 409, "Das Roster ist geschlossen.");
    const guild = discord.isOnline() ? discord.getGuild(gid) : null;
    if (!guild) throw refuse("offline", 503, "Der Bot ist gerade nicht mit Discord verbunden.");
    if (!canManageRoles(gid)) throw refuse("no_manage_roles", 409, "Dem Bot fehlt das Recht „Rollen verwalten“.");
    return guild;
}

/** Step 1: the role, below the bot's role. Refuses (and cleans up) otherwise. */
async function makeRole(guild, plan, kader) {
    const icon = plan.role.unicodeEmoji && iconPossible(guild) ? plan.role.unicodeEmoji : "";
    let role;
    try {
        role = await guild.roles.create({
            name: plan.role.name,
            ...(plan.role.color !== null ? { colors: { primaryColor: plan.role.color } } : {}),
            ...(icon ? { unicodeEmoji: icon } : {}),
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
    const iconState = icon ? "set" : (plan.role.unicodeEmoji ? "not_possible" : "none");
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
 * name, color?: "#rrggbb", unicodeEmoji? }, category: { id } | { name, emoji? },
 * channels: [{ name, emoji?, orgaOnlyWrite? }] }`. Creates role, category and
 * channels right away (each step reports on its own), records the takeover
 * and hands out the role in the background.
 * @returns {Promise<{ takeover, steps: object[], assigning: number }>}
 */
async function start(guildId, kaderId, body = {}, { actor = "", gapMs = ROLE_GAP_MS } = {}) {
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
    const roster = rosterOf(gid, kader);
    const guild = assertCanWrite(gid, kader, roster);
    const plan = planOf(body, guild);
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

        // 2. the roster's main role
        try {
            rosterStore.updateRoster(roster.id, { roleIds: [roleId, ...roster.roleIds.filter((r) => r !== roleId)] }, { actor });
            steps.push({ step: "roster", ok: true, id: roster.id });
        } catch (e) {
            await Promise.resolve(role.delete && role.delete("EventHelper: Roster nicht beschreibbar")).catch(() => {});
            throw refuse((e && e.code) || "roster_failed", 409, `Roster nicht beschreibbar: ${(e && e.message) || "?"}`);
        }

        // 3. category and channels, only the new role and the orga see them
        const orgaIds = orgaRoleIdsOf(guild, rosterStore.getRoster(roster.id));
        const { categoryId, channelIds } = await makeChannels(guild, plan, kader, roleId, orgaIds, steps);

        // 4. the record, then the roles in the background
        const saved = kaderRoster.saveTakeover(gid, kader.id, {
            rosterId: roster.id, roleId, roleName: role.name, categoryId, channelIds,
        }, { actor });
        running.delete(key);
        locked(gid, kader.id, async () => {
            const results = await handOut(roster.id, roleId, kader.players, { actor, gapMs });
            kaderRoster.finishTakeover(gid, kader.id, results, { actor });
            logger.info(`takeover ${key}: ${Object.values(results).filter((r) => r === "ok").length}/${kader.players.length} roles given`);
        });
        return { takeover: saved ? saved.takeover : null, steps, assigning: kader.players.length };
    } catch (e) {
        // every throw lies before the background job took the lock over
        running.delete(key);
        throw e;
    }
}

/**
 * "Rolle nachziehen": the role for every player still waiting for it
 * (kaderRoster.pendingOf), in the background like the takeover.
 * @returns {{ count: number }}
 */
function pullRole(guildId, kaderId, { actor = "", gapMs = ROLE_GAP_MS } = {}) {
    const gid = str(guildId);
    const kader = kaderRoster.takeoverPlayers(gid, kaderId);
    if (!kader) throw refuse("kader_not_found", 404, "Kader nicht gefunden.");
    if (!kader.takeover) throw refuse("not_taken", 409, "Dieser Kader wurde noch nicht übernommen.");
    const roster = rosterOf(gid, kader);
    const guild = assertCanWrite(gid, kader, roster);
    const roleId = kader.takeover.roleId;
    if (guild.roles && guild.roles.cache && !guild.roles.cache.has(roleId)) throw refuse("role_gone", 409, "Die Rolle der Übernahme gibt es nicht mehr.");
    const pending = new Set(kader.pending);
    const players = kader.players.filter((p) => pending.has(p.userId));
    if (!players.length) return { count: 0 };
    locked(gid, kader.id, async () => {
        const results = await handOut(roster.id, roleId, players, { actor, gapMs });
        kaderRoster.markRoleGiven(gid, kader.id, results, { actor });
    });
    return { count: players.length };
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

// Discord -> Kader: rosterRoleSync calls this when a member loses the role
// (registered, not required back - that would be a require cycle). Loaded at
// start through web/apiRoutes/kader.js.
rosterRoleSync.setRoleLostHandler(onRoleLost);

/** Test-only: forget the locks. */
function _resetForTests() {
    running.clear();
}

module.exports = {
    precheck, start, pullRole, dropPlayers, onRoleLost, whenIdle,
    planOf, overwritesOf, resultOf, handOut, membersOf,
    MEMBER_FETCH_MS, ROLE_GAP_MS, MAX_CHANNELS, _resetForTests,
};
