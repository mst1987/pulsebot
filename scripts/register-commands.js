// Registers the slash commands with Discord.
//
//   npm run register               every configured server (event + talk, #251)
//   node scripts/register-commands.js --guild <id>   exactly that server
//   npm run register:global        globally (takes ~1 hour to show up)
//   npm run register:clear         remove the commands (same targets as above)
//   --dev                          read .env.dev instead of .env
//
// The server ids come from the settings store (Einstellungen → Verbindungen →
// Discord-Server) with GUILD_ID from the env file as the fallback. Requiring
// this file does nothing; only running it talks to Discord.
const { REST, Routes } = require("discord.js");

/** The command line as flags: `{ dev, global, clear, guild }` (guild "" = not given). */
function parseArgs(argv) {
    const idx = argv.indexOf("--guild");
    const next = idx > -1 ? String(argv[idx + 1] || "") : "";
    return {
        dev: argv.includes("--dev"),
        global: argv.includes("--global"),
        clear: argv.includes("--clear"),
        guild: next.startsWith("--") ? "" : next.trim(),
    };
}

/**
 * The servers to register for: the one named by `--guild`, otherwise every
 * configured server (event first, then talk), otherwise the env's GUILD_ID.
 */
function targetGuildIds({ guildArg = "", configuredIds = [], envGuildId = "" } = {}) {
    if (guildArg) return [guildArg];
    const ids = [...new Set(configuredIds.map((id) => String(id || "").trim()).filter(Boolean))];
    if (ids.length) return ids;
    return envGuildId ? [String(envGuildId).trim()] : [];
}

/**
 * Put the command list (or an empty one with `clear`) on every target. One
 * server failing does not stop the others; the failures come back as
 * `[{ target, error }]`, so the caller can exit non-zero.
 */
async function registerCommands({ rest, routes = Routes, clientId, guildIds = [], global = false, clear = false, body = commands, log = console.log }) {
    const targets = global
        ? [{ label: "global", route: routes.applicationCommands(clientId) }]
        : guildIds.map((id) => ({ label: `guild ${id}`, route: routes.applicationGuildCommands(clientId, id) }));
    const failures = [];
    for (const target of targets) {
        try {
            await rest.put(target.route, { body: clear ? [] : body });
            log(clear ? `Cleared all commands (${target.label}).` : `Registered ${body.length} slash commands (${target.label}).`);
        } catch (error) {
            failures.push({ target: target.label, error });
        }
    }
    return failures;
}

const commands = [
    {
        name: "createapplication",
        description: "Postet eine Nachricht mit Bewerben-Button in einen Channel",
        options: [
            {
                name: "message_id",
                description: "Message-ID (aus diesem Channel) oder voller Nachrichten-Link",
                type: 3,
                required: true,
            },
            {
                name: "channel",
                description: "Ziel-Channel für die Bewerbungs-Nachricht",
                type: 7,
                required: true,
            },
        ],
    },
    {
        name: "recruitment",
        description: "Postet eine im Admin-Menü gepflegte Recruitment-Vorlage in einen Channel",
        options: [
            {
                name: "vorlage",
                description: "Name der Recruitment-Vorlage (im Admin-Menü angelegt)",
                type: 3,
                required: true,
            },
            {
                name: "channel",
                description: "Ziel-Channel für die Recruitment-Nachricht",
                type: 7,
                required: true,
            },
        ],
    },
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
    {
        name: "logcheck",
        description: "Prüft einen Warcraft-Logs-Report auf Gear-Probleme (Verzauberungen, Edelsteine)",
        options: [{
            name: "link",
            description: "Warcraft-Logs-Report-Link oder Report-ID",
            type: 3,
            required: true,
        }],
    },
    {
        name: "fillsetup",
        description: "Befüllt das Setup-Sheet aus einem Raidhelper-Raidplan",
        options: [
            { name: "setup_id", description: "Raidhelper Setup-ID (Nummer am Ende des Raidplan-Links)", type: 3, required: true },
            { name: "tank3", description: "3. Tank (Charaktername fuer B13, optional)", type: 3, required: false },
        ],
    },
    // Lookups with a link into the web menu (#265) — src/commands/lookup/.
    {
        name: "loot",
        description: "Loot nachschlagen",
        options: [
            { name: "ich", description: "Dein Loot (über deine zugeordneten Charaktere)", type: 1 },
            {
                name: "item", description: "Wer ein Item wann bekommen hat", type: 1,
                options: [{ name: "item", description: "Item", type: 3, required: true, autocomplete: true }],
            },
            {
                name: "raider", description: "Was ein Raider bekommen hat", type: 1,
                options: [{ name: "name", description: "Charaktername", type: 3, required: true, autocomplete: true }],
            },
        ],
    },
    { name: "raids", description: "Deine nächsten Raids und dein Anmeldestatus" },
    {
        name: "raid",
        description: "Ein Raid im Überblick: Termin, Anmeldestand, dein Status",
        options: [{ name: "event", description: "Raid", type: 3, required: true, autocomplete: true }],
    },
    { name: "anwesenheit", description: "Deine Anwesenheit in den letzten Raids" },
    {
        name: "anwesenheit-raider",
        description: "Anwesenheit eines Raiders in den letzten Raids",
        options: [{ name: "raider", description: "Charaktername", type: 3, required: true, autocomplete: true }],
    },
    { name: "report", description: "Die letzten Log-Auswertungen mit Link" },
    {
        name: "council",
        description: "Loot-Council: Drop-Check für ein Item öffnen",
        options: [{ name: "item", description: "Item", type: 3, required: true, autocomplete: true }],
    },
    // Channel work from Discord (#259); deleting stays in the web menu.
    {
        name: "kanal",
        description: "Kanal umbenennen, archivieren oder anlegen",
        options: [
            {
                name: "umbenennen", description: "Kanal umbenennen", type: 1,
                options: [
                    { name: "kanal", description: "Kanal", type: 7, required: true, channel_types: [0, 2, 5, 13, 15] },
                    { name: "name", description: "Neuer Name", type: 3, required: true, max_length: 100 },
                ],
            },
            {
                name: "archivieren", description: "Kanal ins Archiv verschieben und Schreibrechte entziehen", type: 1,
                options: [
                    { name: "kanal", description: "Kanal", type: 7, required: true, channel_types: [0, 2, 5, 13, 15] },
                ],
            },
            {
                name: "anlegen", description: "Kanal in einer Kategorie anlegen (Name oder Schema)", type: 1,
                options: [
                    { name: "kategorie", description: "Kategorie", type: 7, required: true, channel_types: [4] },
                    { name: "name", description: "Name oder Schema wie {tag}-{dd}-{mm}-{raid}; leer = Schema der Kategorie", type: 3, required: false, max_length: 100 },
                    { name: "datum", description: "Datum für das Schema, z. B. 24.09.", type: 3, required: false },
                    { name: "raid", description: "Raid-Kürzel für {raid}, z. B. ssc-tk", type: 3, required: false },
                ],
            },
        ],
    },
];

async function main(argv) {
    const flags = parseArgs(argv);
    const envFile = flags.dev ? ".env.dev" : ".env";
    require("dotenv").config({ path: envFile });
    // Loaded after dotenv: config/variables reads the env at require time.
    const { getConfig } = require("../src/web/settingsStore");
    const { configuredGuildIds } = require("../src/web/guildRoles");

    const token = process.env.DISCORDJS_BOT_TOKEN;
    const clientId = process.env.CLIENT_ID;
    const guildIds = targetGuildIds({
        guildArg: flags.guild,
        configuredIds: configuredGuildIds(getConfig()),
        envGuildId: process.env.GUILD_ID,
    });
    if (!token || !clientId || (!flags.global && !guildIds.length)) {
        console.error(`ERROR: DISCORDJS_BOT_TOKEN and CLIENT_ID must be set in ${envFile}, and a server configured (Einstellungen, GUILD_ID or --guild <id>).`);
        process.exit(1);
    }

    const rest = new REST({ version: "10" }).setToken(token);
    const failures = await registerCommands({ rest, clientId, guildIds, global: flags.global, clear: flags.clear });
    for (const f of failures) console.error(`Failed to register commands (${f.target}):`, f.error);
    if (failures.length) process.exit(1);
}

if (require.main === module) {
    main(process.argv.slice(2));
}

module.exports = { commands, parseArgs, targetGuildIds, registerCommands };
