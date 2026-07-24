const fs = require("fs");
const path = require("path");
const envDev = path.join(__dirname, "../.env.dev");
const envFile = fs.existsSync(envDev) ? envDev : path.join(__dirname, "../.env");
require("dotenv").config({ path: envFile });
const messages = require("./config/messages.js");
const { startWebServer } = require("./web/server.js");
const { handleLogMessage } = require("./web/logChannel.js");

const { Client, GatewayIntentBits, Collection } = require("discord.js");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        // keeps guild.emojis.cache fresh when emojis change (for the admin emoji picker)
        GatewayIntentBits.GuildEmojisAndStickers,
    ],
    partials: ["MESSAGE", "REACTION"],
});

client.commands = new Collection();

function loadCommands(dir) {
    const commandFolders = fs.readdirSync(dir);
    for (const folder of commandFolders) {
        const commandFiles = fs
            .readdirSync(path.join(dir, folder))
            .filter((file) => file.endsWith(".js"));
        for (const file of commandFiles) {
            const command = require(path.join(dir, folder, file));
            client.commands.set(command.name, command);
        }
    }
}

client.on("ready", () => {
    console.log(messages.common.pulseBotReady);
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

// Resolve the command/handler key: slash commands use commandName; component
// customIds may carry an argument after ":" (e.g. "logcheck-eval:<id>"), so the
// handler is looked up by the prefix before the colon.
function lookupKey(interaction) {
    if (interaction.commandName) return interaction.commandName;
    const customId = interaction.customId || "";
    const idx = customId.indexOf(":");
    return idx > -1 ? customId.slice(0, idx) : customId;
}

client.on("interactionCreate", async(interaction) => {
    if (!interaction.isCommand() && !interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return;

    const command = client.commands.get(lookupKey(interaction));

    if (!command) {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: "Command not found",
                ephemeral: true,
            });
        }
        return;
    }

    console.log(`Command: ${command.name}`);

    try {
        await command.execute(interaction, client);
    } catch (error) {
        console.error(`Error executing ${command.name}:`, error);

        try {
            const errorMessage = "There was an error executing this command!";
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            } else if (interaction.deferred) {
                await interaction.followUp({ content: errorMessage, ephemeral: true });
            }
        } catch (replyError) {
            console.error("Failed to send error response:", replyError.message);
        }
    }
});

// Boot the bot: load commands and bring the web server up FIRST, independent of
// the Discord gateway, then log in best-effort. This way the admin menu / report
// pages are always reachable locally (e.g. per-feature test instances) even when
// the token is missing/invalid or Discord is unreachable — a failed login only
// disables the Discord-backed features, it never takes the process down.
function start() {
    loadCommands(path.join(__dirname, "commands"));
    startWebServer(client);

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

module.exports = { client, start, loadCommands };