const fs = require("fs");
const path = require("path");
const envDev = path.join(__dirname, "../.env.dev");
const envFile = fs.existsSync(envDev) ? envDev : path.join(__dirname, "../.env");
require("dotenv").config({ path: envFile });
const messages = require("./config/messages.js");
const { startWebServer } = require("./web/server.js");

const { Client, GatewayIntentBits, Collection } = require("discord.js");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
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
    loadCommands(path.join(__dirname, "commands"));
    startWebServer(client);
});

client.on("interactionCreate", async(interaction) => {
    if (!interaction.isCommand() && !interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return;

    const command = client.commands.get(
        interaction.customId || interaction.commandName
    );

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

client.login(process.env.DISCORDJS_BOT_TOKEN);