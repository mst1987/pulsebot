const fs = require("fs");
const path = require("path");
const envDev = path.join(__dirname, "../.env.dev");
const envFile = fs.existsSync(envDev) ? envDev : path.join(__dirname, "../.env");
require("dotenv").config({ path: envFile, quiet: true });
// Which file this process runs on: a test instance always has `.env.dev`, the
// server `.env` — the sign that holds even without NODE_ENV (config/runMode.js).
process.env.EVENTHELPER_ENV_FILE = path.basename(envFile);
require("./config/env.js").validateEnv();
const messages = require("./config/messages.js");
const { card } = require("./utils/discord/card.js");
const { tr } = require("./utils/i18n/botText.js");
const userPrefs = require("./stores/settings/userPrefsStore.js");
const { langOfInteraction } = require("./services/discord/botLanguage.js");
const { startWebServer } = require("./web/http/server.js");
const { handleLogMessage } = require("./services/logcheck/logChannel.js");
const { autoLinkAllGuilds } = require("./services/logcheck/logAutoLink.js");
const { runLogChannelMigration } = require("./services/logcheck/logChannelMigration.js");
const { cleanForeignRoles } = require("./services/discord/roles/foreignRoleCleanup.js");
const { runAvailabilityMigration } = require("./services/signups/availabilityMigration.js");
const softresDetect = require("./services/loot/softresDetect.js");
const { handleMemberUpdate, handleMemberAdd } = require("./services/discord/roles/roleSync.js");
const rosterRoleSync = require("./services/roster/rosterRoleSync.js");
const memberActivity = require("./services/discord/members/memberActivity.js");
const pugInvites = require("./services/discord/pug/pugInvites.js");
const tempVoiceJob = require("./services/voice/tempVoiceJob.js");
const { guardInteraction } = require("./services/discord/botAccess.js");
const { trackAck } = require("./services/discord/ackTiming.js");
const { runMode } = require("./config/runMode.js");
const { ensureAppEmojis } = require("./services/discord/appEmojiSync.js");
const { queueItemEmojiSync } = require("./services/guildbank/itemEmojis.js");
const { redrawPendingCards } = require("./services/signups/guildBank");
const linkWatch = require("./services/discord/linkWatch.js");
const discord = require("./services/discord/discord.js");
const { configuredGuildIds } = require("./services/discord/roles/guildRoles.js");
const { handleReaction, handleReactionsCleared } = require("./services/discord/roles/roleMessages.js");
const { loadCommandModules, kindOf } = require("./commands/loader.js");
const { startJobs } = require("./web/http/jobs.js");
const logger = require("./logger.js").child("bot");

const { Events, Client, GatewayIntentBits, Partials, Collection } = require("discord.js");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        // keeps guild.emojis.cache fresh when emojis change (for the admin emoji picker)
        GatewayIntentBits.GuildEmojisAndStickers,
        // privileged: lets the admin menu resolve who holds a raid role, to compare
        // against event signups (attendance / ping missing raiders). Requires the
        // "Server Members Intent" to be enabled in the Discord Developer Portal.
        GatewayIntentBits.GuildMembers,
        // the reactions on the role messages (services/discord/roles/roleMessages.js): a reaction
        // gives its role, taking it back takes the role
        GatewayIntentBits.GuildMessageReactions,
        // not privileged: inviteCreate / inviteDelete speed up the invite check (they only come
        // with "Kanäle verwalten"; services/discord/pug/pugInvites.js does not rely on them, #905)
        GatewayIntentBits.GuildInvites,
        // not privileged: who sits in which voice channel, so a raid's temporary channel
        // closes once it is empty (services/voice/tempVoiceJob.js)
        GatewayIntentBits.GuildVoiceStates,
    ],
    // The role messages' reactions must work on messages from before a restart too, which
    // are not in the cache: without these partials discord.js drops such reaction events
    // (#430 had removed the old v13 string form because nothing read partials then).
    // roleMessages.handleReaction fetches what is partial; every other listener reads
    // whole messages (messageCreate) or the raw gateway packets (linkWatch).
    partials: [Partials.Message, Partials.Reaction, Partials.User],
});

client.commands = new Collection();

// Slash commands, context menus and components (buttons, selects, modals) in one
// map by name. A name used twice throws (commands/loader.js), so a customId
// prefix can never shadow a command; `kindOf` tells the two apart for the router.
function loadCommands(dir) {
    client.commands = loadCommandModules(dir);
}

client.on(Events.ClientReady, () => {
    console.log(messages.common.pulseBotReady);
    // The spec/class/role icons of the event message (#287): create the missing ones, then
    // read them; text icons until then.
    ensureAppEmojis(client).catch((error) => logger.warn("ensureAppEmojis failed:", error.message));
    // The guild bank items' icons (#633): whatever changed while the bot was offline.
    queueItemEmojiSync({ delay: 30 * 1000 });
    // The guild bank's open cards (#809): drawn again with today's buttons, so a card from an older
    // version never keeps a disabled "Bestätigen" after a deploy.
    setTimeout(() => { redrawPendingCards().catch(() => {}); }, 20 * 1000).unref();
    // Logs waiting for their raid: the job's first sweep runs at web start, before the
    // login, when there are no guilds yet — without this the next try is 10 min away.
    autoLinkAllGuilds().catch((error) => logger.warn("log auto-link after login failed:", error.message));
    // The old global log-channel list goes to the servers the channels lie on (#921) - only
    // Discord knows that, so it runs here and not with the start migrations.
    runLogChannelMigration(client, { log: (line) => logger.info(line), warn: (line) => logger.warn(line) }).catch(() => {});
    // Absences/attendances that held everywhere get their raider's first server, once - only
    // Discord knows the membership (services/signups/availabilityMigration.js).
    runAvailabilityMigration(client, { log: (line) => logger.info(line), warn: (line) => logger.warn(line) }).catch(() => {});
    // The rights per server (#925): the roles of other servers the migration copied into each
    // server's rights leave again - only where Discord shows for sure that they belong elsewhere.
    cleanForeignRoles(client, { log: (line) => logger.info(line), warn: (line) => logger.warn(line) });
    // The member lists of the configured servers, in the background: the first raid detail,
    // roster or dashboard after a restart then finds them cached (services/discord/discord.js).
    try {
        discord.warmGuildMembers(configuredGuildIds());
    } catch (error) {
        logger.warn("member list warm-up failed:", error.message);
    }
    // The bot's invites (#905), now and every 10 minutes: vanished ones are marked deleted (never
    // made again on their own), those of removed links/servers deleted, the use counters read.
    try {
        pugInvites.startInviteCheck();
    } catch (error) {
        logger.warn("invite check not started:", error.message);
    }
});

// Watch the configured log channels for Warcraft-Logs links and offer to evaluate them.
client.on("messageCreate", async(message) => {
    try {
        if (!message.guild) return;
        // A softres.it link a raid lead posts into a raid channel is tied to that raid; never breaks the log detection.
        try {
            softresDetect.onMessage(message);
        } catch (error) {
            console.error("softresDetect error:", error.message);
        }
        await handleLogMessage(message);
    } catch (error) {
        console.error("messageCreate handler error:", error.message);
    }
});

// Role sync between paired servers (#264, #896): a member whose roles
// changed, or who just joined one of them, gets the mapped roles on the
// other server of the pair. Only adds — see src/services/discord/roles/roleSync.js.
// Rosters (#656): gaining a roster role takes the member into that roster,
// losing its last role drops them out — see src/services/roster/rosterRoleSync.js.
client.on("guildMemberUpdate", (oldMember, newMember) => {
    rosterRoleSync.onGuildMemberUpdate(oldMember, newMember);
    Promise.resolve(handleMemberUpdate(oldMember, newMember))
        .catch((error) => console.error("guildMemberUpdate handler error:", error.message));
});
// Joins and leaves are noted for the Discord overview (services/discord/members/memberActivity.js).
client.on("guildMemberAdd", (member) => {
    memberActivity.onMemberAdd(member);
    // through which invite the member came (#905); never throws
    pugInvites.onMemberAdd(member);
    rosterRoleSync.onGuildMemberAdd(member);
    Promise.resolve(handleMemberAdd(member))
        .catch((error) => console.error("guildMemberAdd handler error:", error.message));
});
client.on("guildMemberRemove", (member) => memberActivity.onMemberRemove(member));
// The invite counters (#905): a new invite starts at its uses, a deleted one of ours is only
// marked deleted (never made again on its own, only by a click in the settings).
client.on(Events.InviteCreate, (invite) => pugInvites.onInviteCreate(invite));
client.on(Events.InviteDelete, (invite) => pugInvites.onInviteDelete(invite));
// Temporary raid voice channels: somebody joining or leaving starts or stops the empty clock.
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    try {
        tempVoiceJob.onVoiceStateUpdate(oldState, newState);
    } catch (error) {
        logger.warn("temp voice state update failed:", error.message);
    }
});

// Role messages: a reaction on one gives its role, removing it takes the role back
// (services/discord/roles/roleMessages.js; bots are ignored, nothing is answered; the Bot-Befehle
// rule of `rolemsg` counts as for its button). Cleared reactions: the bot sets its own again.
client.on(Events.MessageReactionAdd, (reaction, user) => {
    handleReaction(reaction, user, true, { commands: client.commands }).catch((error) => logger.warn("role message reaction failed:", error.message));
});
client.on(Events.MessageReactionRemove, (reaction, user) => {
    handleReaction(reaction, user, false, { commands: client.commands }).catch((error) => logger.warn("role message reaction failed:", error.message));
});
client.on(Events.MessageReactionRemoveAll, (message) => {
    handleReactionsCleared(message).catch((error) => logger.warn("role message re-react failed:", error.message));
});
client.on(Events.MessageReactionRemoveEmoji, (reaction) => {
    handleReactionsCleared(reaction && reaction.message).catch((error) => logger.warn("role message re-react failed:", error.message));
});

// A deleted channel or tracked message (#537): links to it go at once, the
// overviews redraw, a deleted signup message is posted anew (linkWatch.js).
linkWatch.attach(client);

// Resolve the command/handler key: slash commands use commandName; component
// customIds may carry an argument after ":" (e.g. "logcheck-eval:<id>"), so the
// handler is looked up by the prefix before the colon.
function lookupKey(interaction) {
    if (interaction.commandName) return interaction.commandName;
    const customId = interaction.customId || "";
    const idx = customId.indexOf(":");
    return idx > -1 ? customId.slice(0, idx) : customId;
}

// The component kinds the router hands to a command: buttons, modals and every
// select menu (string, user, role, channel, mentionable). The type guards
// differ between discord.js versions and test doubles, so a missing one reads as false.
const COMPONENT_GUARDS = [
    "isButton", "isStringSelectMenu", "isUserSelectMenu", "isRoleSelectMenu",
    "isChannelSelectMenu", "isMentionableSelectMenu", "isModalSubmit",
];
const is = (interaction, guard) => typeof interaction[guard] === "function" && interaction[guard]();

/**
 * The module that handles the interaction. A slash command, context menu or
 * autocomplete (it carries a commandName) only ever reaches a command; a button,
 * select or modal reaches a component or a command (the overview buttons).
 */
function findHandler(interaction) {
    const handler = client.commands.get(lookupKey(interaction));
    if (handler && interaction.commandName && kindOf(handler) !== "command") return undefined;
    return handler;
}

/**
 * Autocomplete: the command's own `autocomplete(interaction)` answers the
 * suggestions. Discord allows no other reply to it, so a command without one
 * (or one that throws) gets an empty list instead of "Command not found".
 * The suggestions pass the same access gate as the command: a command someone
 * may not run does not list its items, raiders or events to them either (the
 * gate answers an empty list).
 */
async function handleAutocomplete(interaction) {
    const command = findHandler(interaction);
    try {
        if (command && typeof command.autocomplete === "function") {
            if (!(await guardInteraction(interaction, command, client.commands))) return;
            return await command.autocomplete(interaction);
        }
        if (!interaction.responded) await interaction.respond([]);
    } catch (error) {
        console.error(`Autocomplete error for ${lookupKey(interaction)}:`, error.message);
        try {
            if (!interaction.responded) await interaction.respond([]);
        } catch {
            // The interaction has expired — nothing left to answer.
        }
    }
}

client.on("interactionCreate", (interaction) => handleInteraction(interaction));

/** Remembers the raider's Discord client language so DMs and reminders follow it (best-effort, never throws). */
function noteLocale(interaction) {
    try {
        if (interaction && interaction.user) userPrefs.noteClientLang(interaction.user.id, interaction.locale);
    } catch (error) {
        logger.debug(`Could not note the client language: ${error.message}`);
    }
}

async function handleInteraction(interaction) {
    noteLocale(interaction);
    if (is(interaction, "isAutocomplete")) return handleAutocomplete(interaction);
    if (!is(interaction, "isCommand") && !COMPONENT_GUARDS.some((guard) => is(interaction, guard))) return;

    const command = findHandler(interaction);

    if (!command) {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply(card({ kind: "error", title: tr(langOfInteraction(interaction), "Command not found."), ephemeral: true }));
        }
        return;
    }

    logger.debug(`Command: ${command.name}`);

    // Times the way to the acknowledgement and warns when it was slow (services/discord/ackTiming.js).
    const ack = trackAck(interaction, { name: command.name });
    try {
        // Who may run it is decided here, once, for every command, button and modal (services/discord/botAccess.js).
        const allowed = await guardInteraction(interaction, command, client.commands);
        ack.guardDone();
        if (!allowed) return;
        await command.execute(interaction, client);
    } catch (error) {
        console.error(`Error executing ${command.name}:`, error);

        try {
            const errorCard = card({
                kind: "error", title: tr(langOfInteraction(interaction), "There was an error executing this command!"), ephemeral: true,
            });
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply(errorCard);
            } else if (interaction.deferred) {
                await interaction.followUp(errorCard);
            }
        } catch (replyError) {
            console.error("Failed to send error response:", replyError.message);
        }
    } finally {
        ack.finish();
    }
}

// Boot the bot: load commands and bring the web server up FIRST, independent of
// the Discord gateway, then log in best-effort. This way the admin menu / report
// pages are always reachable locally (e.g. per-feature test instances) even when
// the token is missing/invalid or Discord is unreachable — a failed login only
// disables the Discord-backed features, it never takes the process down.
function start() {
    // PM2 spawns the app with the Node binary of its own daemon, not with
    // whatever `node --version` says on the shell — so this line is the only
    // reliable way to see which version the bot actually runs on after an
    // upgrade. Keep it first, before anything can fail.
    console.log(`PulseBot starting on Node ${process.version} (${runMode()}, ${process.env.EVENTHELPER_ENV_FILE}, NODE_ENV=${process.env.NODE_ENV || "-"})`);
    require("./stores/settings/settingsMigration").migrateSettings();
    // a category switched to another game version closes its roster (#739)
    require("./services/roster/rosterVersionSwitch").registerRosterVersionSwitch();
    loadCommands(path.join(__dirname, "commands"));
    startWebServer(client);
    startJobs(client);

    const token = process.env.DISCORDJS_BOT_TOKEN;
    if (!token) {
        console.warn("DISCORDJS_BOT_TOKEN not set — web UI only, Discord features disabled.");
        return;
    }
    Promise.resolve()
        .then(() => client.login(token))
        .catch((err) => {
            console.error("Discord login failed (web UI still running):", err.message);
        });
}

// Auto-start only when run directly (`node src/bot.js` / `npm start`); requiring
// the module (e.g. in tests) does not boot anything.
if (require.main === module) {
    start();
}

module.exports = { client, start, loadCommands, handleInteraction, lookupKey };