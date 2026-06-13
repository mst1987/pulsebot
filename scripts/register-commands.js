#!/usr/bin/env node
const args = process.argv.slice(2);
const isDev = args.includes("--dev");
const envFile = isDev ? ".env.dev" : ".env";
require("dotenv").config({ path: envFile });

const { REST, Routes } = require("discord.js");

const token = process.env.DISCORDJS_BOT_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId || !guildId) {
    console.error(`ERROR: DISCORDJS_BOT_TOKEN, CLIENT_ID, and GUILD_ID must be set in ${envFile}`);
    process.exit(1);
}

const isGlobal = args.includes("--global");
const isClear = args.includes("--clear");

const rest = new REST({ version: "10" }).setToken(token);

const commands = [
    { name: "createapplication", description: "Erstellt eine Bewerbungsnachricht mit Apply-Button" },
    { name: "show-mysetups", description: "Show the events where I am in the setup" },
    { name: "createoverview", description: "Creates an event overview for the current category" },
    { name: "show-allsetups", description: "Show all setups for the current category" },
    { name: "show-signups", description: "Show all signups for the current category" },
    { name: "update-events", description: "Update event overview for the current category" },
    {
        name: "signup",
        description: "Sign up to the raid in this channel",
        options: [{
            name: "specs",
            description: "Specs to sign up with, comma-separated (e.g. Combat,Fire,RestoDruid)",
            type: 3,
            required: true,
        }],
    },
];

(async () => {
    try {
        const route = isGlobal
            ? Routes.applicationCommands(clientId)
            : Routes.applicationGuildCommands(clientId, guildId);

        if (isClear) {
            await rest.put(route, { body: [] });
            console.log(`Cleared all ${isGlobal ? "global" : "guild"} commands.`);
            return;
        }

        await rest.put(route, { body: commands });
        console.log(`Registered ${commands.length} ${isGlobal ? "global" : "guild"} slash commands.`);
    } catch (error) {
        console.error("Failed to register commands:", error);
        process.exit(1);
    }
})();
