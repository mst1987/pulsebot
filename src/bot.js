require("dotenv").config({ path: "../.env" });
const messages = require("./config/messages.js");
const fs = require("fs");

const { Client, GatewayIntentBits, Collection } = require("discord.js");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: ["MESSAGE", "REACTION"],
});

// Globales Objekt zur Speicherung von Geboten
const pendingBids = new Map();

client.on("ready", () => {
    console.log(messages.common.pulseBotReady);
});

client.commands = new Collection();

function loadCommands(dir) {
    const commandFolders = fs.readdirSync(dir);
    for (const folder of commandFolders) {
        const commandFiles = fs
            .readdirSync(`${dir}/${folder}`)
            .filter((file) => file.endsWith(".js"));
        for (const file of commandFiles) {
            const command = require(`${dir}/${folder}/${file}`);
            client.commands.set(command.name, command);
        }
    }
}

loadCommands("./commands");

client.login(process.env.DISCORDJS_BOT_TOKEN);