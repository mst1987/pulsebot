// One-off upgrades of old settings files (#420), run once at start by bot.js.
//
// These used to run inside every getConfig() / listRaidTemplates() - hundreds
// of times per minute, for files that were upgraded long ago. Now the start
// writes the new shape down once, and the read path only knows the current one.
//
//   - raid-templates.json: a pre-#266 entry (a bare Raid-Helper `{ id, name }`)
//     becomes a template without size (raidTemplateStore.migrateLegacyTemplates).
//   - config.json, discordServers: an old single-server block (`eventGuildId` /
//     `talkOverviewChannelId`, no `eventGuilds` list) becomes one list entry.
//   - config.json, raidDefaults.templateId: the old global default (a Raid-Helper
//     template id) is handed to every raid category as `categoryRaidTemplate`.
//
// migrateSettings() is idempotent: it writes only when something changed, so
// the second start finds nothing to do and writes nothing.
const { isSnowflake } = require("../utils/ids");
const { CONFIG_DEFAULTS } = require("./configSchema");
const configStore = require("./configStore");
const raidTemplateStore = require("./raidTemplateStore");

/**
 * The event-server list an old single-server block stands for: its
 * `eventGuildId` with the talk server's overview channel as the target, so the
 * overview keeps posting where it did. No event server configured -> [].
 */
function legacyEventGuilds(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const guildId = String(src.eventGuildId || "").trim();
    if (!isSnowflake(guildId)) return [];
    return [{
        guildId,
        label: "",
        overviewGuildId: String(src.talkGuildId || "").trim(),
        overviewChannelId: String(src.talkOverviewChannelId || "").trim(),
    }];
}

/** A servers block with its legacy event server as `eventGuilds`, or null when there is nothing to upgrade. */
function migrateDiscordServers(servers) {
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) return null;
    if (Array.isArray(servers.eventGuilds)) return null;
    const eventGuilds = legacyEventGuilds(servers);
    return eventGuilds.length ? { ...servers, eventGuilds } : null;
}

/**
 * The per-category default template for a config from before #266 (it has no
 * `categoryRaidTemplate` yet): the template that links the old global
 * raidDefaults.templateId, for every raid category. null = nothing to upgrade,
 * also when no template links that Raid-Helper id.
 */
function migrateCategoryRaidTemplate(stored, templates) {
    if (stored.categoryRaidTemplate !== undefined) return null;
    const legacy = String((stored.raidDefaults || {}).templateId || "").trim();
    if (!legacy) return null;
    const template = templates.find((t) => t.raidhelperTemplateId === legacy);
    if (!template) return null;
    const categories = Array.isArray(stored.categoryIds) ? stored.categoryIds : CONFIG_DEFAULTS.categoryIds;
    return Object.fromEntries(categories.map((id) => [String(id), template.id]));
}

/**
 * Upgrade config.json. Returns what changed (empty = nothing written).
 * Runs after the templates, so a legacy default finds its migrated template.
 */
function migrateConfig() {
    const stored = configStore.readStored();
    const next = { ...stored };
    const changes = [];
    const servers = migrateDiscordServers(stored.discordServers);
    if (servers) {
        next.discordServers = servers;
        changes.push("config.json: discordServers.eventGuildId -> eventGuilds");
    }
    const categoryRaidTemplate = migrateCategoryRaidTemplate(stored, raidTemplateStore.listRaidTemplates());
    if (categoryRaidTemplate) {
        next.categoryRaidTemplate = categoryRaidTemplate;
        changes.push("config.json: raidDefaults.templateId -> categoryRaidTemplate");
    }
    if (changes.length) configStore.writeStored(next);
    return changes;
}

/**
 * Run every upgrade once. Never throws - a start must not fail over an old
 * file; the error is logged and the bot comes up with what it can read.
 * @returns {{ changes: string[], error?: Error }}
 */
function migrateSettings({ log = console.log, warn = console.error } = {}) {
    const changes = [];
    try {
        const templates = raidTemplateStore.migrateLegacyTemplates();
        if (templates) changes.push(`raid-templates.json: ${templates} alte Raid-Helper-Vorlage(n) umgestellt`);
        changes.push(...migrateConfig());
    } catch (error) {
        warn(`[settings] Migration fehlgeschlagen: ${error.message}`);
        return { changes, error };
    }
    for (const change of changes) log(`[settings] Migration: ${change}`);
    return { changes };
}

module.exports = { migrateSettings, legacyEventGuilds, migrateDiscordServers, migrateCategoryRaidTemplate };
