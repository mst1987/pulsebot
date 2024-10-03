require("dotenv").config({ path: "../.env" });
const messages = require("./config/messages.js");
const fs = require("fs");
const path = require("path");

const { Client, GatewayIntentBits, Collection } = require("discord.js");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: ["MESSAGE", "REACTION"],
});

const pendingBids = new Map();

client.commands = new Collection();

function loadCommands(dir) {
    const commandFolders = fs.readdirSync(dir);
    for (const folder of commandFolders) {
        const commandFiles = fs
            .readdirSync(path.join(dir, folder))
            .filter((file) => file.endsWith(".js"));
        for (const file of commandFiles) {
            const command = require(path.join(__dirname, dir, folder, file));
            client.commands.set(command.name, command);
        }
    }
}

client.on("ready", () => {
    console.log(messages.common.pulseBotReady);
    loadCommands("./commands");
});

client.on("interactionCreate", async(interaction) => {
    if (!interaction.isCommand() && !interaction.isButton()) return;

    const command = client.commands.get(
        interaction.customId || interaction.commandName
    );
    if (!command) return;
    console.log(`Command: ${command.name}`);
    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        await interaction.reply({
            content: "There was an error executing this command!",
            ephemeral: true,
        });
    }
});

client.login(process.env.DISCORDJS_BOT_TOKEN);