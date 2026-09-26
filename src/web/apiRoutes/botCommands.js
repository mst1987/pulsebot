const path = require("path");
const fs = require("fs");
const { ok } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { getConfig } = require("../../stores/settingsStore");
const discord = require("../../services/discord/discord");
const { eventGuildId, ruleFor } = require("../../services/discord/botAccess");
const { BOT_COMMAND_GROUPS, normalizeRule, normalizeBotCommandAccess } = require("../../config/botCommands");

const COMMANDS_DIR = path.join(__dirname, "..", "..", "commands");

// The files under src/commands/ do not change while the process runs: scanned
// once on the first call instead of on every request (#419).
let scannedCommands = null;

/**
 * The command modules: the ones the bot loaded, or — when the web server runs
 * without them (tests, a bare web start) — read from src/commands/ directly.
 */
function loadedCommands() {
    const client = discord.getClient();
    if (client && client.commands && client.commands.size) return [...client.commands.values()];
    if (!scannedCommands) scannedCommands = scanCommandsDir();
    return [...scannedCommands];
}

function scanCommandsDir() {
    const out = [];
    for (const folder of fs.readdirSync(COMMANDS_DIR)) {
        const dir = path.join(COMMANDS_DIR, folder);
        if (!fs.statSync(dir).isDirectory()) continue;
        for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".js"))) {
            out.push(require(path.join(dir, file)));
        }
    }
    return out;
}

/**
 * The roles of the event guild with their member counts (for the badge
 * tooltips). The counts come from the guild's member list (cached, see
 * discord.fetchGuildMembersCached) — the role's own member cache only knows who
 * happened to be seen. Best-effort: offline bot = no roles, no member list =
 * counts unknown (null), never a misleading 0.
 */
async function eventRoles(guildId) {
    const roles = typeof discord.listRoles === "function" ? discord.listRoles(guildId) : [];
    const guild = typeof discord.getGuild === "function" ? discord.getGuild(guildId) : null;
    let counts = null;
    if (guild && roles.length) {
        try {
            const members = await discord.fetchGuildMembersCached(guildId, guild);
            counts = new Map();
            for (const m of members) {
                const cache = m && m.roles && m.roles.cache;
                if (!cache || typeof cache.keys !== "function") continue;
                for (const id of cache.keys()) counts.set(id, (counts.get(id) || 0) + 1);
            }
        } catch (e) {
            console.warn("bot-commands: member list unavailable:", e.message);
        }
    }
    return roles.map((r) => ({ ...r, memberCount: counts ? counts.get(r.id) || 0 : null }));
}

/**
 * The Bot-Befehle view's data: every command that carries its own access rule,
 * with the rule the code proposes (`defaultAccess`), the stored setting and the
 * buttons/selects/modals that inherit it. Full admins only — like the other
 * access settings, it shows who may do what.
 */
function buildBotCommandList(commands, config) {
    const stored = normalizeBotCommandAccess(config.botCommandAccess);
    const inherits = {};
    for (const c of commands) {
        if (!c || !c.accessOf) continue;
        const owner = ruleFor(c.name, { commands, config }).owner;
        if (owner) (inherits[owner] = inherits[owner] || []).push(c.name);
    }
    return commands
        .filter((c) => c && c.name && !c.accessOf && c.group)
        .map((c) => {
            const effective = ruleFor(c.name, { commands, config });
            return {
                name: c.name,
                description: String(c.description || ""),
                group: c.group,
                kind: c.kind === "button" ? "button" : "slash",
                defaultAccess: normalizeRule(c.defaultAccess) || { mode: "admins", roleIds: [] },
                access: stored[c.name] || null,
                effective: { mode: effective.mode, roleIds: effective.roleIds },
                inherits: (inherits[c.name] || []).sort(),
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
}

/** GET /api/bot-commands */
const getBotCommands = withUser({ full: true }, async ({ res }) => {
    const config = getConfig();
    const guildId = eventGuildId(config);
    const guild = typeof discord.getGuild === "function" ? discord.getGuild(guildId) : null;
    const commands = buildBotCommandList(loadedCommands(), config);
    const used = new Set(commands.map((c) => c.group));
    ok(res, {
        groups: BOT_COMMAND_GROUPS.filter((g) => used.has(g.id)),
        commands,
        roles: await eventRoles(guildId),
        guildId,
        guildName: guild ? guild.name : "",
    });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/bot-commands", handler: getBotCommands, area: "settings" },
];

module.exports = { getBotCommands, buildBotCommandList, loadedCommands, routes };
