const fs = require("fs");
const path = require("path");
const envDev = path.join(__dirname, "../.env.dev");
const envFile = fs.existsSync(envDev) ? envDev : path.join(__dirname, "../.env");
require("dotenv").config({ path: envFile });
require("./config/env.js").validateEnv();
const messages = require("./config/messages.js");
const { startWebServer } = require("./web/http/server.js");
const { handleLogMessage } = require("./services/logcheck/logChannel.js");
const { handleMemberUpdate, handleMemberAdd } = require("./services/discord/roleSync.js");
const { guardInteraction } = require("./services/discord/botAccess.js");
const { ensureAppEmojis } = require("./services/discord/appEmojiSync.js");
const { loadCommandModules, kindOf } = require("./commands/loader.js");
const { startJobs } = require("./web/http/jobs.js");
const logger = require("./logger.js").child("bot");

const { MessageFlags, Events, Client, GatewayIntentBits, Collection } = require("discord.js");

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
    ],
    // No listener reads a partial MESSAGE/REACTION (no messageReactionAdd
    // handler, no `.partial` check anywhere) — the v13 string form here was a
    // no-op, so it is dropped instead of migrated to Partials.Message /
    // Partials.Reaction (#430). Re-add with the v14 enum if such a handler
    // is introduced later.
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
});

// Watch the configured log channels for Warcraft-Logs links and offer to evaluate them.
client.on("messageCreate", async(message) => {
    try {
        if (!message.guild) return;
        await handleLogMessage(message);
    } catch (error) {
        console.error("messageCreate handler error:", error.message);
    }
});

// Role sync between the event and the talk server (#264): a member whose roles
// changed, or who just joined one of the two, gets the mapped roles on the
// other one. Only adds — see src/services/discord/roleSync.js.
client.on("guildMemberUpdate", (oldMember, newMember) => {
    Promise.resolve(handleMemberUpdate(oldMember, newMember))
        .catch((error) => console.error("guildMemberUpdate handler error:", error.message));
});
client.on("guildMemberAdd", (member) => {
    Promise.resolve(handleMemberAdd(member))
        .catch((error) => console.error("guildMemberAdd handler error:", error.message));
});

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

async function handleInteraction(interaction) {
    if (is(interaction, "isAutocomplete")) return handleAutocomplete(interaction);
    if (!is(interaction, "isCommand") && !COMPONENT_GUARDS.some((guard) => is(interaction, guard))) return;

    const command = findHandler(interaction);

    if (!command) {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: messages.common.commandNotFound,
                flags: MessageFlags.Ephemeral,
            });
        }
        return;
    }

    logger.debug(`Command: ${command.name}`);

    try {
        // Who may run it is decided here, once, for every command, button and modal (services/discord/botAccess.js).
        if (!(await guardInteraction(interaction, command, client.commands))) return;
        await command.execute(interaction, client);
    } catch (error) {
        console.error(`Error executing ${command.name}:`, error);

        try {
            const errorMessage = messages.common.commandExecutionError;
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral });
            } else if (interaction.deferred) {
                await interaction.followUp({ content: errorMessage, flags: MessageFlags.Ephemeral });
            }
        } catch (replyError) {
            console.error("Failed to send error response:", replyError.message);
        }
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
    console.log(`PulseBot starting on Node ${process.version} (${process.env.NODE_ENV || "development"})`);
    require("./stores/settingsMigration").migrateSettings();
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