// Registers the slash commands with Discord. The definitions are not kept here:
// every module under src/commands/ carries its own (`data`, #413), and this
// script collects them with the loader the bot routes with.
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
async function registerCommands({ rest, routes = Routes, clientId, guildIds = [], global = false, clear = false, body = collectCommands(), log = console.log }) {
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

/**
 * The definitions of every command module, as Discord wants them. Collected on
 * call, not on require: the modules read the env when they load, so `main`
 * reads the env file first.
 */
function collectCommands() {
    return require("../src/commands/loader").commandDefinitions();
}

async function main(argv) {
    const flags = parseArgs(argv);
    const envFile = flags.dev ? ".env.dev" : ".env";
    require("dotenv").config({ path: envFile });
    // Loaded after dotenv: config/variables reads the env at require time.
    const { getConfig } = require("../src/stores/settingsStore");
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

    const body = collectCommands();
    if (!flags.clear) console.log(`Commands: ${body.map((c) => c.name).join(", ")}`);
    const rest = new REST({ version: "10" }).setToken(token);
    const failures = await registerCommands({ rest, clientId, guildIds, global: flags.global, clear: flags.clear, body });
    for (const f of failures) console.error(`Failed to register commands (${f.target}):`, f.error);
    // Exit explicitly: a loaded command module may keep a timer running.
    process.exit(failures.length ? 1 : 0);
}

if (require.main === module) {
    main(process.argv.slice(2));
}

module.exports = { collectCommands, parseArgs, targetGuildIds, registerCommands };
