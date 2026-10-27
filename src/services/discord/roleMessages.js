// Role messages ("Rollen-Nachrichten", reaction roles): a card the bot posts with a
// title, a text, a big picture and, per role, one button and one reaction. A click on
// the button toggles the role; adding the reaction gives it, removing the reaction
// takes it. Every change goes through selfRole.changeSelfRole, so a role with rights
// (privilegedReason) is never touched in either direction.
//
// - validate()          the orga's input → a clean entry, or an error with a code
// - createRoleMessage() validate, store, post, set the reactions
// - updateRoleMessage() validate, edit (or repost on a new channel/server), sync the reactions
// - deleteRoleMessage() delete the Discord message (best-effort) and the entry
// - roleMessageOptions() roles, channels, emojis and the bot's rights of one server
// - handleRoleButton()  the `rolemsg:<entryId>:<roleId>` button (ephemeral answer in the clicker's language)
// - handleReaction()    MessageReactionAdd/Remove (no answer; partials are fetched, so
//                       messages from before a restart work — the store maps messageId → entry)
// - handleReactionsCleared() MessageReactionRemoveAll/RemoveEmoji: the bot sets its own
//                       reactions again; nobody's role changes
//
// Button and reaction follow the same Bot-Befehle rule (command `rolemsg`, everyone by
// default) and share a short cooldown per member and role (COOLDOWN_MS, in memory).
//
// The store is stores/roleMessageStore.js, the API web/apiRoutes/roleMessages.js,
// docs/role-messages.md the overview.
const { ButtonBuilder, ButtonStyle, MessageFlags, PermissionsBitField, TextDisplayBuilder } = require("discord.js");
const discord = require("./discord");
const { serverIds, resolveServer, roleMessageGuild } = require("./guildRoles");
const { privilegedReason, roleProblem, changeSelfRole } = require("./selfRole");
const { ruleFor, resolveBotAccess, eventMemberRoles } = require("./botAccess");
const { langOfInteraction } = require("./botLanguage");
const store = require("../../stores/roleMessageStore");
const { getConfig } = require("../../stores/configStore");
const { card } = require("../../utils/discord/card");
const { parseButtonEmoji, buttonEmojiFor } = require("../../utils/discord/buttonEmoji");
const { tr } = require("../../utils/i18n/botText");
const log = require("../../logger").child("roleMessages");

/** Discord's limits: 25 buttons (5 rows of 5), 20 reactions per message; ours for the texts. */
const LIMITS = { roles: 25, reactions: 20, title: 200, body: 3000, label: 80 };
const BUTTON_PREFIX = "rolemsg";

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/** An error the API turns into `{ error: { code, message, roleId?, reason? } }` with the status. */
function fail(code, message, details = {}, status = 400) {
    return Object.assign(new Error(message), { code, status, details });
}

/** The server a stored entry belongs to (its guildId, else the first server). */
function guildIdOf(entry, config = getConfig()) {
    return roleMessageGuild(entry, config);
}

/** The key a reaction and a stored emoji share: a custom emoji's id, a Unicode emoji without its variation selector. */
function emojiKey(text) {
    const parsed = parseButtonEmoji(text);
    if (!parsed) return "";
    return parsed.id || parsed.name.replace(/️/g, "");
}

/** The key of a discord.js reaction (or its emoji). */
function reactionKey(emoji) {
    if (!emoji) return "";
    return str(emoji.id) || str(emoji.name).replace(/️/g, "");
}

/** The button's customId and its parts. */
const buttonId = (entryId, roleId) => `${BUTTON_PREFIX}:${entryId}:${roleId}`;
function parseButtonId(customId) {
    const [prefix, entryId = "", roleId = ""] = str(customId).split(":");
    return prefix === BUTTON_PREFIX ? { entryId, roleId } : { entryId: "", roleId: "" };
}

/** Why selfRole refuses a role, for the orga (German). */
function problemText(reason) {
    if (reason === "missing Manage Roles") return "Dem Bot fehlt auf diesem Server das Recht „Rollen verwalten“.";
    if (reason === "the role belongs to an integration") return "Die Rolle gehört zu einem Bot oder einer Integration.";
    if (reason === "the role is above the bot's highest role") return "Die Rolle steht nicht unter der höchsten Rolle des Bots – zieh die Bot-Rolle in den Server-Einstellungen darüber.";
    return reason;
}

async function roleOf(guild, roleId) {
    const cached = guild.roles && guild.roles.cache ? guild.roles.cache.get(roleId) : null;
    if (cached) return cached;
    try {
        return guild.roles && typeof guild.roles.fetch === "function" ? await guild.roles.fetch(roleId) : null;
    } catch {
        return null;
    }
}

/** One role of the input checked and normalised; throws the first problem. */
async function checkRole(r, { guild, config, serverEmojis, seenRoles, seenEmojis }) {
    const roleId = str(r.roleId);
    if (seenRoles.has(roleId)) throw fail("duplicate_role", "Eine Rolle steht zweimal in der Nachricht.", { roleId });
    seenRoles.add(roleId);
    const role = /^\d{5,25}$/.test(roleId) && roleId !== guild.id ? await roleOf(guild, roleId) : null;
    if (!role) throw fail("unknown_role", "Eine Rolle gibt es auf diesem Server nicht (mehr).", { roleId });

    const emoji = str(r.emoji);
    if (emoji) {
        const parsed = parseButtonEmoji(emoji);
        if (!parsed) throw fail("bad_emoji", `„${emoji}“ ist kein einzelnes Emoji.`, { roleId });
        if (parsed.id && !serverEmojis.has(parsed.id)) throw fail("unknown_emoji", `Das Emoji ${emoji} gibt es auf diesem Server nicht.`, { roleId });
        const key = emojiKey(emoji);
        if (seenEmojis.has(key)) throw fail("duplicate_emoji", `Das Emoji ${emoji} steht bei zwei Rollen.`, { roleId });
        seenEmojis.add(key);
    }

    const privileged = privilegedReason(config, roleId, role, guild);
    if (privileged) {
        throw fail("privileged_role", `Die Rolle @${role.name} trägt Rechte und darf nicht per Klick vergeben werden: ${privileged}.`, { roleId, reason: privileged });
    }
    const problem = await roleProblem(guild, role, config);
    if (problem) throw fail("role_unusable", `@${role.name}: ${problemText(problem)}`, { roleId, reason: problem });

    return { roleId, emoji, label: (str(r.label) || str(role.name)).slice(0, LIMITS.label) };
}

/**
 * Check the orga's input. Returns the clean entry (without id/messageId) plus its
 * guildId; throws `fail(code, …)` otherwise. Codes: unknown_guild, no_guild, bot_offline,
 * unknown_channel, missing_title, no_roles, too_many_roles, too_many_reactions,
 * duplicate_role, duplicate_emoji, bad_emoji, unknown_emoji, unknown_role,
 * privileged_role (details: roleId, reason), role_unusable (details: roleId, reason), bad_image.
 */
async function validate(input = {}, { config = getConfig() } = {}) {
    const guildId = resolveServer({ guildId: input.guildId }, config);
    if (guildId === null) throw fail("unknown_guild", "Diesen Server gibt es in der Serverliste nicht.");
    if (!guildId) throw fail("no_guild", "Es ist kein Discord-Server eingestellt.");
    const guild = discord.getGuild(guildId);
    if (!guild) throw fail("bot_offline", "Der Bot ist nicht verbunden oder nicht auf diesem Server.", {}, 503);

    const channelId = str(input.channelId);
    if (!discord.listTextChannels(guildId).some((c) => c.id === channelId)) {
        throw fail("unknown_channel", "Den Kanal gibt es auf diesem Server nicht, oder der Bot darf dort nicht schreiben.");
    }
    const title = str(input.title).slice(0, LIMITS.title);
    if (!title) throw fail("missing_title", "Ein Titel fehlt.");
    const body = String(input.body === undefined || input.body === null ? "" : input.body).trim().slice(0, LIMITS.body);
    const imageUrl = str(input.imageUrl);
    if (imageUrl && !/^https:\/\/\S+$/i.test(imageUrl)) throw fail("bad_image", "Das Bild muss ein https-Link sein.");
    const color = store.colorOf(input.color);

    const raw = Array.isArray(input.roles) ? input.roles.filter((r) => r && typeof r === "object") : [];
    if (!raw.length) throw fail("no_roles", "Mindestens eine Rolle ist nötig.");
    if (raw.length > LIMITS.roles) throw fail("too_many_roles", `Höchstens ${LIMITS.roles} Rollen je Nachricht (Discord erlaubt 25 Knöpfe).`);
    if (raw.filter((r) => str(r.emoji)).length > LIMITS.reactions) {
        throw fail("too_many_reactions", `Höchstens ${LIMITS.reactions} Rollen mit Emoji je Nachricht (Discord erlaubt 20 Reaktionen).`);
    }

    const serverEmojis = new Set(discord.listEmojis(guildId).map((e) => e.id));
    const seenRoles = new Set();
    const seenEmojis = new Set();
    const roles = [];
    for (const r of raw) roles.push(await checkRole(r, { guild, config, serverEmojis, seenRoles, seenEmojis }));

    return { guildId, entry: { guildId, channelId, title, body, imageUrl, color, roles } };
}

/** The message: a card with the picture and one button per role (5 per row). */
function rolePayload(entry) {
    const buttons = entry.roles.map((r) => {
        const b = new ButtonBuilder().setCustomId(buttonId(entry.id, r.roleId)).setLabel(r.label || "Rolle").setStyle(ButtonStyle.Secondary);
        const emoji = buttonEmojiFor(r.emoji);
        return emoji ? b.setEmoji(emoji) : b;
    });
    return card({
        color: entry.color === null || entry.color === undefined ? undefined : entry.color,
        title: entry.title,
        text: entry.body,
        image: entry.imageUrl,
        buttons,
    });
}

/**
 * The emoji keys whose meaning an edit changed: an emoji that now stands for another
 * role, or is gone. Members' old reactions of these would give the wrong role or none.
 */
function changedEmojiKeys(oldRoles, newRoles) {
    const now = new Map(newRoles.filter((r) => r.emoji).map((r) => [emojiKey(r.emoji), r.roleId]));
    const changed = new Set();
    for (const r of oldRoles) {
        const key = r.emoji ? emojiKey(r.emoji) : "";
        if (key && now.get(key) !== r.roleId) changed.add(key);
    }
    return changed;
}

/** Remove every reaction (members' too) of an emoji; Discord wants Manage Messages for it. */
async function clearReaction(reaction, warnings) {
    try {
        await reaction.remove();
        return true;
    } catch (e) {
        const name = reaction.emoji && (reaction.emoji.name || reaction.emoji.id);
        warnings.push(`Alte Reaktionen ${name} nicht geleert: ${str(e && e.message)} (der Bot braucht im Kanal „Nachrichten verwalten“; wer noch die alte Reaktion hat, sollte sie selbst abnehmen).`);
        return false;
    }
}

/**
 * Bring the bot's own reactions in line with the entry: add the missing ones in the
 * roles' order, take back its own of emojis no longer wanted. Members' reactions stay —
 * except those of `clear` (emoji keys an edit gave another meaning): they all go, the
 * bot then sets its own again where the emoji is still wanted.
 * @returns {Promise<string[]>} warnings (German), one per reaction that failed
 */
async function syncReactions(entry, { clear = new Set() } = {}) {
    const warnings = [];
    let message;
    try {
        const channel = await discord.fetchTextChannel(entry.channelId);
        message = await channel.messages.fetch(entry.messageId);
    } catch (e) {
        return [`Reaktionen nicht gesetzt: Nachricht nicht lesbar (${str(e && e.message)}).`];
    }
    const client = discord.getClient();
    const botId = client && client.user ? client.user.id : "";
    const wanted = entry.roles.filter((r) => r.emoji);
    const wantedKeys = new Set(wanted.map((r) => emojiKey(r.emoji)));
    const cache = message.reactions && message.reactions.cache ? [...message.reactions.cache.values()] : [];
    const cleared = new Set();
    for (const reaction of cache) {
        const key = reactionKey(reaction.emoji);
        if (clear.has(key) && (await clearReaction(reaction, warnings))) {
            cleared.add(key);
            continue;
        }
        if (!reaction.me || wantedKeys.has(key)) continue;
        try {
            await reaction.users.remove(botId);
        } catch (e) {
            warnings.push(`Reaktion ${reaction.emoji && reaction.emoji.name} nicht entfernt: ${str(e && e.message)}`);
        }
    }
    const mine = new Set(cache.filter((r) => r.me && !cleared.has(reactionKey(r.emoji))).map((r) => reactionKey(r.emoji)));
    for (const r of wanted) {
        if (mine.has(emojiKey(r.emoji))) continue;
        try {
            await message.react(r.emoji);
        } catch (e) {
            warnings.push(`Reaktion ${r.emoji} nicht gesetzt: ${str(e && e.message)} (der Bot braucht im Kanal „Reaktionen hinzufügen“ und „Nachrichtenverlauf lesen“).`);
        }
    }
    return warnings;
}

/** Post an entry's message and set its reactions; returns the stored entry with its messageId plus warnings. */
async function postEntry(entry) {
    const posted = await discord.postPayload(entry.channelId, rolePayload(entry));
    let saved;
    try {
        saved = store.saveMessage({ ...entry, messageId: posted.messageId });
    } catch (e) {
        // Not stored = nobody could ever edit or delete it in the editor: take it down again.
        await discord.deleteMessage(entry.channelId, posted.messageId);
        throw e;
    }
    const warnings = await syncReactions(saved);
    return { entry: saved, url: posted.url, warnings };
}

const isUnknownMessage = (e) => !!(e && (e.code === 10008 || /unknown message/i.test(str(e && e.message))));

/** Create and post a role message. @returns {Promise<{ entry, url, warnings }>} */
async function createRoleMessage(input, { userId = "", config = getConfig() } = {}) {
    const { entry } = await validate(input, { config });
    const draft = store.saveMessage({ ...entry, messageId: "", createdBy: str(userId) });
    try {
        const result = await postEntry(draft);
        log.info(`role message ${draft.id} posted in ${entry.channelId} by ${str(userId) || "?"}`);
        return result;
    } catch (e) {
        store.removeMessage(draft.id);
        throw fail("post_failed", `Posten hat nicht geklappt: ${str(e && e.message)}`, {}, 502);
    }
}

/**
 * Change a role message: edit it in place, or — on another channel or server, or when
 * the old message is gone — post it anew and delete the old one.
 * @returns {Promise<{ entry, url, warnings, reposted: boolean }>}
 */
async function updateRoleMessage(id, input, { config = getConfig() } = {}) {
    const old = store.getMessage(id);
    if (!old) throw fail("not_found", "Diese Rollen-Nachricht gibt es nicht.", {}, 404);
    const { entry } = await validate(input, { config });
    const next = { ...old, ...entry };
    delete next.guildSide; // legacy (before #895): the entry carries its guildId now
    const moved = !old.messageId || old.channelId !== next.channelId || guildIdOf(old, config) !== next.guildId;
    if (!moved) {
        try {
            const edited = await discord.editPayload(old.channelId, old.messageId, rolePayload(next));
            const saved = store.saveMessage(next);
            const clear = changedEmojiKeys(old.roles, saved.roles);
            return { entry: saved, url: edited.url, warnings: await syncReactions(saved, { clear }), reposted: false };
        } catch (e) {
            if (!isUnknownMessage(e)) throw fail("edit_failed", `Bearbeiten hat nicht geklappt: ${str(e && e.message)}`, {}, 502);
        }
    }
    let result;
    try {
        result = await postEntry({ ...next, messageId: "" });
    } catch (e) {
        throw fail("post_failed", `Posten hat nicht geklappt: ${str(e && e.message)}`, {}, 502);
    }
    if (old.messageId && old.messageId !== result.entry.messageId) await discord.deleteMessage(old.channelId, old.messageId);
    log.info(`role message ${old.id} reposted in ${next.channelId}`);
    return { ...result, reposted: true };
}

/** Delete a role message: the Discord message best-effort (it may be gone already), the entry always. */
async function deleteRoleMessage(id) {
    const old = store.getMessage(id);
    if (!old) throw fail("not_found", "Diese Rollen-Nachricht gibt es nicht.", {}, 404);
    const messageDeleted = old.messageId ? await discord.deleteMessage(old.channelId, old.messageId) : false;
    store.removeMessage(old.id);
    log.info(`role message ${old.id} deleted (Discord message ${messageDeleted ? "deleted" : "already gone"})`);
    return { id: old.id, messageDeleted };
}

/** Whether the bot holds a permission (null = cannot be known). */
function botHas(me, flag, channel = null) {
    if (!me || !me.permissions) return null;
    if (channel && typeof channel.permissionsFor === "function") {
        const perms = channel.permissionsFor(me);
        return !!perms && perms.has(flag);
    }
    return me.permissions.has(flag);
}

/**
 * What the editor offers for one server (a guildId of the server list): its roles (with why one must not be
 * handed out, and whether the bot can), its text channels (and whether the bot may
 * react there), its emojis, the bot's Manage Roles.
 */
function roleMessageOptions(guildId, { config = getConfig() } = {}) {
    const guild = guildId ? discord.getGuild(guildId) : null;
    if (!guild) return { guildId: guildId || "", online: false, manageRoles: null, roles: [], channels: [], emojis: [] };
    const me = guild.members ? guild.members.me : null;
    const roles = discord.listRoles(guildId).map((r) => {
        const role = guild.roles.cache.get(r.id) || null;
        const top = me && me.roles && me.roles.highest ? Number(me.roles.highest.position) : 0;
        const editable = role ? (typeof role.editable === "boolean" ? role.editable : Number(role.position) < top) && !role.managed : false;
        return { ...r, privileged: privilegedReason(config, r.id, role, guild), editable };
    });
    const channels = discord.listTextChannels(guildId).map((c) => {
        const channel = guild.channels.cache.get(c.id);
        const react = botHas(me, PermissionsBitField.Flags.AddReactions, channel);
        const history = botHas(me, PermissionsBitField.Flags.ReadMessageHistory, channel);
        return { ...c, canReact: react === null || history === null ? null : react && history };
    });
    return {
        guildId,
        online: true,
        manageRoles: botHas(me, PermissionsBitField.Flags.ManageRoles),
        roles,
        channels,
        emojis: discord.listEmojis(guildId),
    };
}

/** Who did it, for the log. */
function whoOf(user, member = null) {
    const u = user || {};
    const name = (member && member.displayName) || u.globalName || u.username || "?";
    return `${name} (${str(u.id) || "?"})`;
}

/** Log a failed change (never answers anybody). */
function warnFailure(result, entry, roleId, guildId, who, via) {
    const name = result.role ? `@${result.role.name} (${roleId})` : roleId;
    const where = `role message ${entry ? entry.id : "?"} (${via})`;
    if (result.code === "role_unreadable") log.warn(`${where}: role ${roleId} could not be read on ${guildId}: ${result.detail}`);
    else if (result.code === "role_missing") log.warn(`${where}: role ${roleId} is missing on ${guildId} (deleted?) - edit the message`);
    else if (result.code === "member_missing") log.warn(`${where}: member ${who} not found on ${guildId}: ${result.detail}`);
    else if (result.code === "refused") log.warn(`${where}: cannot hand out ${name}: ${result.detail}`);
    else log.warn(`${where}: ${name} not ${result.on ? "given to" : "taken from"} ${who}: ${result.detail}`);
}

/** A short ephemeral answer: an icon and a line (Components V2), nothing pings. */
function notice(emoji, line) {
    return {
        flags: MessageFlags.IsComponentsV2,
        components: [new TextDisplayBuilder().setContent(`${emoji} ${line}`).toJSON()],
        content: "",
        embeds: [],
        allowedMentions: { parse: [] },
    };
}

const REASONS = { add: "Rollen-Nachricht: selbst geholt", remove: "Rollen-Nachricht: selbst abgegeben" };

/** One change per member and role within this time; button and reaction share it. */
const COOLDOWN_MS = 2000;
const recent = new Map();

/** Whether the member changed this role a moment ago; otherwise notes now and says no. */
function onCooldown(userId, roleId, now = Date.now()) {
    const key = `${userId}:${roleId}`;
    const last = recent.get(key);
    if (last !== undefined && now - last < COOLDOWN_MS) return true;
    if (recent.size > 500) {
        for (const [k, at] of recent) if (now - at >= COOLDOWN_MS) recent.delete(k);
    }
    recent.set(key, now);
    return false;
}

/** Tests start without anybody on cooldown. */
function resetCooldowns() {
    recent.clear();
}

/**
 * Whether the user may use the role messages: the Bot-Befehle rule of `rolemsg`, the
 * same one bot.js checks before the button (botAccess.guardInteraction). "everyone"
 * needs no lookup; otherwise the roles on the first server count (as in botAccess).
 */
async function mayUse(user, guild, { commands, config }) {
    const rule = ruleFor(BUTTON_PREFIX, { commands, config });
    if (rule.mode === "everyone") return true;
    const member = guild.members && guild.members.cache ? guild.members.cache.get(str(user.id)) : null;
    const roleIds = await eventMemberRoles({ user, guild, member }, serverIds(config)[0] || "");
    return resolveBotAccess(BUTTON_PREFIX, { id: str(user.id), roleIds }, { commands, config }).allowed;
}

/** The `rolemsg:<entryId>:<roleId>` button: toggles the role, answers only the clicker. */
async function handleRoleButton(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const lang = langOfInteraction(interaction);
    const { entryId, roleId } = parseButtonId(interaction.customId);
    const entry = entryId ? store.getMessage(entryId) : null;
    const known = entry && entry.roles.some((r) => r.roleId === roleId);
    const stale = entry && entry.messageId && interaction.message && interaction.message.id && interaction.message.id !== entry.messageId;
    if (!known || stale || !interaction.guild) return interaction.editReply(notice("❌", tr(lang, "This button is no longer in use.")));
    if (onCooldown(str(interaction.user && interaction.user.id), roleId)) {
        return interaction.editReply(notice("⏳", tr(lang, "One moment, please …")));
    }

    const who = whoOf(interaction.user, interaction.member);
    const result = await changeSelfRole({
        guild: interaction.guild,
        roleId,
        member: interaction.member,
        userId: str(interaction.user && interaction.user.id),
        mode: "toggle",
        config: getConfig(),
        reasons: REASONS,
    });
    if (!result.ok) {
        warnFailure(result, entry, roleId, interaction.guild.id, who, "button");
        return interaction.editReply(notice("❌", tr(lang, "That did not work right now. Please tell the orga.")));
    }
    log.info(`role message ${entry.id}: ${roleId} ${result.on ? "given to" : "taken from"} ${who} (button)`);
    const role = `<@&${roleId}>`;
    return interaction.editReply(result.on
        ? notice("✅", tr(lang, "You now have the role {role}.", { role }))
        : notice("➖", tr(lang, "The role {role} was removed.", { role })));
}

/** Fetch a partial; null when Discord cannot give it (deleted meanwhile). */
async function full(thing) {
    if (!thing || !thing.partial) return thing;
    try {
        return await thing.fetch();
    } catch {
        return null;
    }
}

/**
 * A reaction was added (`added`) or removed: give or take the role of its emoji on a
 * role message. Bots (the bot's own reactions too) are ignored; no answer. Who the
 * `rolemsg` rule (Bot-Befehle) shuts out, or who changed the role a moment ago, is only
 * logged — the reaction itself stays (taking it would need Manage Messages).
 * `commands` = bot.js's client.commands (the rule's owner), else the client's.
 * @returns {Promise<string>} what happened, for the tests: "ignored", "cooldown", "denied", "given", "taken", "unchanged", "failed"
 */
async function handleReaction(reaction, user, added, opts = {}) {
    if (!reaction || !user || user.bot) return "ignored";
    const messageId = reaction.message ? reaction.message.id : "";
    const entry = messageId ? store.findByMessageId(messageId) : null;
    if (!entry) return "ignored";
    const r = await full(reaction);
    if (!r) return "ignored";
    const message = await full(r.message);
    const u = await full(user);
    if (!message || !u || u.bot) return "ignored";
    const key = reactionKey(r.emoji);
    const role = entry.roles.find((x) => x.emoji && emojiKey(x.emoji) === key);
    const guild = message.guild;
    if (!role || !guild) return "ignored";

    const who = whoOf(u);
    if (onCooldown(str(u.id), role.roleId)) {
        log.debug(`role message ${entry.id}: ${who} changed ${role.roleId} a moment ago, reaction ignored`);
        return "cooldown";
    }
    const config = getConfig();
    const commands = opts.commands || (discord.getClient() || {}).commands;
    if (!(await mayUse(u, guild, { commands, config }))) {
        log.info(`role message ${entry.id}: ${who} may not use role messages (Bot-Befehle), reaction ignored`);
        return "denied";
    }
    const result = await changeSelfRole({
        guild,
        roleId: role.roleId,
        userId: str(u.id),
        mode: added ? "add" : "remove",
        config,
        reasons: REASONS,
    });
    if (!result.ok) {
        warnFailure(result, entry, role.roleId, guild.id, who, "reaction");
        return "failed";
    }
    if (!result.changed) return "unchanged";
    log.info(`role message ${entry.id}: ${role.roleId} ${result.on ? "given to" : "taken from"} ${who} (reaction)`);
    return result.on ? "given" : "taken";
}

/**
 * Someone (with Manage Messages) removed all reactions or all of one emoji from a
 * message. On a role message the bot sets its own again; nobody's role changes —
 * Discord sends no per-member removals for this.
 * @returns {Promise<string>} "ignored" or "synced"
 */
async function handleReactionsCleared(message) {
    const entry = message && message.id ? store.findByMessageId(message.id) : null;
    if (!entry) return "ignored";
    const warnings = await syncReactions(entry);
    for (const w of warnings) log.warn(`role message ${entry.id}: ${w}`);
    log.info(`role message ${entry.id}: reactions were cleared, the bot's own set again`);
    return "synced";
}

module.exports = {
    validate, rolePayload, syncReactions, createRoleMessage, updateRoleMessage, deleteRoleMessage, roleMessageOptions, guildIdOf,
    handleRoleButton, handleReaction, handleReactionsCleared, resetCooldowns, changedEmojiKeys,
    parseButtonId, buttonId, emojiKey, reactionKey, LIMITS, BUTTON_PREFIX, COOLDOWN_MS,
};
