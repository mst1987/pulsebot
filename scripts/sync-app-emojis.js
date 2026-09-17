// Uploads the bot's application emojis (#287) — spec, class, role and status
// icons for the event message and its selects (src/web/appEmojis.js).
//
//   node scripts/sync-app-emojis.js --dry-run     only list what is missing
//   node scripts/sync-app-emojis.js               create the missing emojis
//   --dev                                         read .env.dev instead of .env
//
// The bot runs the same sync itself on start (src/web/appEmojiSync.js), so this
// is only needed to check or fill an application without starting the bot.
// Idempotent: only names that do not exist yet are created. Requiring this file
// does nothing; only running it talks to Discord.
const { REST } = require("discord.js");
const { existingNames, downloadIcon, syncAppEmojis } = require("../src/web/appEmojiSync");

function parseArgs(argv) {
    return { dev: argv.includes("--dev"), dryRun: argv.includes("--dry-run") };
}

async function main(argv) {
    const flags = parseArgs(argv);
    const envFile = flags.dev ? ".env.dev" : ".env";
    require("dotenv").config({ path: envFile });
    const token = process.env.DISCORDJS_BOT_TOKEN;
    const clientId = process.env.CLIENT_ID;
    if (!token || !clientId) {
        console.error(`ERROR: DISCORDJS_BOT_TOKEN und CLIENT_ID müssen in ${envFile} stehen.`);
        process.exit(1);
    }
    const rest = new REST({ version: "10" }).setToken(token);
    const result = await syncAppEmojis({ rest, clientId, dryRun: flags.dryRun });
    if (result.failed.length) process.exit(1);
}

if (require.main === module) {
    main(process.argv.slice(2)).catch((e) => {
        console.error(e);
        process.exit(1);
    });
}

module.exports = { parseArgs, existingNames, downloadIcon, syncAppEmojis };
