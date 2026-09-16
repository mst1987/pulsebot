// Uploads the bot's application emojis (#287) — spec, class, role and status
// icons for the event message and its selects (src/web/appEmojis.js).
//
//   node scripts/sync-app-emojis.js --dry-run     only list what is missing
//   node scripts/sync-app-emojis.js               create the missing emojis
//   --dev                                         read .env.dev instead of .env
//
// Idempotent: it reads the application's emojis first and creates only the
// names that do not exist yet — an existing emoji is never replaced or deleted.
// The icons come from wow.zamimg.com (56 px JPEGs, far below Discord's 256 KB).
// Requiring this file does nothing; only running it talks to Discord.
const { REST, Routes } = require("discord.js");
const { emojiCatalog, validEmojiName } = require("../src/web/appEmojis");

const MAX_BYTES = 256 * 1024;

function parseArgs(argv) {
    return { dev: argv.includes("--dev"), dryRun: argv.includes("--dry-run") };
}

/** The names of the application's emojis (`GET /applications/{id}/emojis` answers `{ items }`). */
async function existingNames({ rest, routes = Routes, clientId }) {
    const res = await rest.get(routes.applicationEmojis(clientId));
    const items = Array.isArray(res) ? res : (res && res.items) || [];
    return new Set(items.map((e) => e && e.name).filter(Boolean));
}

/** An icon as a data URI, refused above Discord's size limit. */
async function downloadIcon(url, fetchImpl = fetch) {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error(`zu groß (${buf.length} Bytes)`);
    const type = (res.headers && res.headers.get && res.headers.get("content-type")) || "image/jpeg";
    return `data:${type.split(";")[0]};base64,${buf.toString("base64")}`;
}

/**
 * Create every catalogue emoji the application does not have yet.
 * @returns {Promise<{ existing: number, missing: string[], created: string[], failed: { name: string, error: string }[] }>}
 */
async function syncAppEmojis({
    rest, routes = Routes, clientId, catalog = emojiCatalog(), dryRun = false, fetchImpl = fetch, log = console.log,
}) {
    const have = await existingNames({ rest, routes, clientId });
    const wanted = catalog.filter((e) => validEmojiName(e.name));
    const missing = wanted.filter((e) => !have.has(e.name));
    const out = { existing: wanted.length - missing.length, missing: missing.map((e) => e.name), created: [], failed: [] };
    log(`${wanted.length} Emojis im Katalog, ${out.existing} vorhanden, ${missing.length} fehlen.`);
    if (dryRun) {
        for (const e of missing) log(`  fehlt: ${e.name} (${e.icon})`);
        return out;
    }
    for (const e of missing) {
        try {
            const image = await downloadIcon(e.url, fetchImpl);
            await rest.post(routes.applicationEmojis(clientId), { body: { name: e.name, image } });
            out.created.push(e.name);
            log(`  angelegt: ${e.name}`);
        } catch (err) {
            out.failed.push({ name: e.name, error: err.message });
            log(`  FEHLER ${e.name}: ${err.message}`);
        }
    }
    return out;
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
