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
            const command = require(path.join(dir, folder, file));
            client.commands.set(command.name, command);
        }
    }
}

client.on("ready", () => {
    console.log(messages.common.pulseBotReady);
    loadCommands("./commands");
});

client.on("messageCreate", (message) => {
    if (!message.content.startsWith(process.env.PREFIX) || message.author.bot)
        return;

    const args = message.content
        .slice(process.env.PREFIX.length)
        .trim()
        .split(/ +/);
    const commandName = args.shift().toLowerCase();

    const command = client.commands.get(commandName);

    if (!command) return;

    try {
        command.execute(message, args, client, pendingBids);
    } catch (error) {
        console.error(error);
        message.reply("There was an error executing that command!");
    }
});

client.login(process.env.DISCORDJS_BOT_TOKEN);