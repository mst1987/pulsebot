// One-off upgrades of old settings files (#420), run once at start by bot.js.
//
// These used to run inside every getConfig() / listRaidTemplates() - hundreds
// of times per minute, for files that were upgraded long ago. Now the start
// writes the new shape down once, and the read path only knows the current one.
//
//   - raid-templates.json: a pre-#266 entry (a bare Raid-Helper `{ id, name }`)
//     becomes a template without size (raidTemplateStore.migrateLegacyTemplates).
//   - role-messages.json (#895), then config.json, discordServers + roleSync
//     (#897) - in this order, see the last two entries below.
//   - config.json, rights (#925): the global role/base/account/orga/bot-command
//     rights are copied onto every server block, then dropped from the top level.
//   - config.json, raidDefaults.templateId: the old global default (a Raid-Helper
//     template id) is handed to every raid category as `categoryRaidTemplate`.
//
//   - events.json + raid-templates.json (#516): the full-raid rule from before
//     #516 (`overflow` "bench"/"off") becomes "none" (no limit, the setup picks
//     the 25) and `lockAtLimit` goes off on the same record. The new modes carry
//     new names ("waitlist"/"refuse"), so a later deliberate choice is never
//     switched back. Signups the old rule already put on the bench stay there.
//
//   - raidplans.json (#524): the copies of a template's Standard in every boss of
//     an event plan become the event's Standard again
//     (raidplanStore.migrateEventDefaults); the file is backed up first, every
//     plan is marked `defaultsMigrated`.
//
//   - raidplan-catalog.json, raidplan-templates.json, raidplan-profiles.json
//     (#544): the raid plan knows game versions. An own catalog entry or an
//     override without `versions` becomes `versions: ["tbc"]`; a raid plan
//     template or a tactic profile without `versionId` gets its instances' /
//     boss's version (TBC for all of them so far). Existing plans are not
//     touched (their event carries the version).
//
//   - config.json, versionSettings (#542): the single values of before (the
//     Battle.net realm block in `blizzard`, the armory/WCL templates of the env,
//     Wowhead "tbc", softres "tbc") become `versionSettings.tbc`; Forever and
//     Classic start empty. `blizzard` keeps only the credentials.
//
//   - raider-profiles.json, spec-history.json (#543): characters know their game
//     version. Every profile character and every imported spec without
//     `versionId` becomes a TBC one — that is what they were. Character keys
//     do not move (a TBC key is the bare name).
//
//   - config.json, versionDefaultsApplied (#553): the standard values of every
//     version (config/gameVersions settingsDefaults) fill its *empty* fields
//     once; the version is then listed, so a field cleared later stays empty.
//
//   - recruitment.json, recruitment-posts.json (#553): applications know their
//     game version. A recruitment template or a tracked post without
//     `versionId` becomes a TBC one — every application so far was TBC.
//
//   - kader.json (Kaderplaner-Ablauf): a planner of #566 (rosters with size,
//     role targets, members and bench) becomes Kader with player states: every
//     roster a Kader (same id and name), its members "roster" with a decision
//     from their character, its bench "bench", its setup variants example
//     setups (services/kader/kaderMigration.js). The characters come from the
//     planner's own data, else from the Forever characters of the profile.
//
//   - kader.json (stale decisions): a decision used to stay when a player left
//     the roster, and the composition counted it before the first wish. Every
//     planner without the mark `decisionsCleared` loses its decisions outside
//     the roster once and gets the mark, so a later "Planspiel übernehmen"
//     is never undone (kaderMigration.clearStaleDecisions).
//
//   - config.json, categoryPlanning (Raidplan ODER Sheet): every raid category
//     (config.categoryIds) without a stored mode gets the one it really used,
//     written down so the settings card shows it: "sheet" with a fixed sheet
//     (categorySheets), else whichever its raids used last — a filled sheet
//     copy (event-sheets.json, filledAt) or a raid plan with boards
//     (raidplans.json, updatedAt) — else "raidplan". A mode somebody picked is
//     never touched.
//
//   - rosters.json (#653): every raid category with expected raider roles
//     (config.categoryRoles) or character assignments (raider-characters.json)
//     gets a roster (source "migration"): its roles, its assigned raiders as
//     "core" members with that character. Once per category - an existing
//     roster is never touched, a deleted one never comes back
//     (rosterStore.migrateCategories, services/roster/rosterMigration.js).
//
//   - council-profiles.json (#676): the loot council weighs by profiles. The
//     server weighting (council-weights.json `global`) becomes the default
//     profile "Standard"; every category with its own weighting or a stored
//     view (council-views.json) becomes a profile named after the category,
//     assigned to the category's roster (`lootProfileId`) or, without one,
//     kept as the category's profile. Runs after the rosters, once
//     (councilProfilesStore.migrateLegacy, `migrated`); the old files stay
//     untouched on disk.
//
//   - raid-events.json, rosters.json (#737): every raid has a stored version.
//     A Raid-Helper snapshot without `versionId` gets the version its category
//     plays today (config.categoryVersion, else the main version — in practice
//     TBC), a roster without one the same for its category. From then on a
//     switch of the main or category version moves no stored raid, loot, log
//     or roster; the scan stamps new snapshots itself (raidEventScan.js). Has
//     to run before the main version is switched for the first time - it is
//     part of the first deploy of epic #736. One line per file and version.
//
//   - config.json, categoryVersion (#738): every active category gets the
//     version it plays today written down (the main version unless it already
//     had its own). From then on the main version is only the default for
//     something new; a category changes its version only by a deliberate
//     switch in Einstellungen → Spielversion, which starts a new section
//     (config.categoryEras, services/events/categoryEras.js). Runs after the
//     stored versions of #737, which read the same map.
//
//   - role-messages.json (#895): a role message saved before #895 names its
//     server only by its side ("event"/"talk"). Its server of today - the old
//     talk server resp. the first server of the list - is written down as
//     `guildId` once. Runs first, while the raw config.json still names the
//     talk server; a new order of the servers later moves nothing.
//
//   - config.json, discordServers + roleSync (#897): the talk server is an
//     ordinary server. A block still carrying `talkGuildId` (or the older
//     `eventGuilds` / `eventGuildId` / `talkOverviewChannelId` /
//     `talkPingChannelId`) or role-sync entries of before #896 is written down
//     once in the federation shape: the talk server in `servers`, the links,
//     every event/talk pair as a pair between two servers - and `talkGuildId`
//     is gone. Without it a later saveConfig() (which writes the normalised
//     config) would lose the talk server's pairs. Runs after the role messages.
//
//   - logs.json (#917): every log knows its server. `guildId` follows the rule
//     linked raid -> channel of the post -> first server
//     (services/discord/serverOf.js); `guildFrom` names the rule, `postGuildId`
//     keeps the server of the post (before #917 `guildId` was exactly that for
//     every log with a channel). Runs on every start after the federation step,
//     so a log linked or unlinked since is set right again; the server list
//     itself is only read, never written.
//
//   - config.json, serverSettings[guildId].raidhelper (#927): Raid-Helper is set
//     per server. The server it ran for (the one whose id is the old
//     `raidhelperServerId` / RAIDHELPER_SERVER_ID, else the first server) gets
//     `enabled` from the old switch (`raidhelperRetirement.disabled`) and the
//     marker `envKey`, so it keeps using RAIDHELPER_API_KEY from .env - the key
//     itself is never copied into config.json. Every other server starts off.
//     Once any server has a block, nothing more happens here. The synced list
//     (raidhelper-events.json) and the budget (raidhelper-budget.json) of
//     before #927 go to that server (moveLegacy, idempotent on every start).
//
// migrateSettings() is idempotent: it writes only when something changed, so
// the second start finds nothing to do and writes nothing.
const path = require("path");
const { isSnowflake } = require("../utils/ids");
const {
    CONFIG_DEFAULTS, normalizeCategoryVersion, normalizeDiscordServers, normalizeRoleSync, roleSyncContext, MAX_SERVERS: MAX_EVENT_GUILDS,
    normalizeConfig, serverSettingGuildIds,
} = require("./configSchema");
const { versionSettingsOf, versionsWithDefaults, fillDefaults } = require("./versionSettingsSchema");
const { LEGACY_VERSION } = require("../config/gameVersions");
const { mainVersionFor } = require("../services/events/mainVersion");
const configStore = require("./configStore");
const raidTemplateStore = require("./raidTemplateStore");
const eventStore = require("./eventStore");
const raidplanStore = require("./raidplanStore");
const eventSheetStore = require("./eventSheetStore");
const raidEventStore = require("./raidEventStore");
const raidhelperEventsStore = require("./raidhelperEventsStore");
const raidhelperBudgetStore = require("./raidhelperBudgetStore");
const raidplanCatalogStore = require("./raidplanCatalogStore");
const raidplanTemplateStore = require("./raidplanTemplateStore");
const raidplanProfileStore = require("./raidplanProfileStore");
const raiderProfileStore = require("./raiderProfileStore");
const specHistoryStore = require("./specHistoryStore");
const recruitmentStore = require("./recruitmentStore");
const kaderStore = require("./kaderStore");
const { charOfAssignments } = require("../services/kader/kaderMigration");
const rosterStore = require("./rosterStore");
const raiderCharactersStore = require("./raiderCharactersStore");
const { readJsonFile } = require("./jsonStore");
const { settingsPath } = require("../config/paths");
const { categoriesToMigrate, migrationLine } = require("../services/roster/rosterMigration");
const councilProfilesStore = require("./councilProfilesStore");
const councilWeightsStore = require("./councilWeightsStore");
const councilStore = require("./councilStore");
const roleMessageStore = require("./roleMessageStore");
const logStore = require("./logStore");
const reportStore = require("./reportStore");
const migrationMarkStore = require("./migrationMarkStore");
const { firstServerId, guildOfEvent, logGuild, categoryGuildIndex } = require("../services/discord/serverOf");

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

// Fields of a stored discordServers block from before the federation (#890-#897).
const LEGACY_SERVER_KEYS = ["talkGuildId", "eventGuilds", "eventGuildId", "talkOverviewChannelId", "talkPingChannelId"];

/** A role-sync entry of before #896 (event/talk role ids or an event/talk direction). */
function isLegacyRoleSyncEntry(entry) {
    if (!entry || typeof entry !== "object") return false;
    const oldIds = entry.fromRoleId === undefined && entry.toRoleId === undefined
        && (entry.eventRoleId !== undefined || entry.talkRoleId !== undefined);
    return oldIds || entry.direction === "toTalk" || entry.direction === "toEvent";
}

/**
 * The stored servers block in the federation shape plus the old talk server
 * it named (`talkGuildId`, "" when none) - read from the raw file, because
 * getConfig() no longer hands the talk server out (#897). An old single-server
 * block (`eventGuildId`, no list) becomes its list first.
 */
function storedFederation(stored) {
    const src = stored.discordServers && typeof stored.discordServers === "object" && !Array.isArray(stored.discordServers)
        ? stored.discordServers : {};
    const listed = Array.isArray(src.servers) || Array.isArray(src.eventGuilds);
    const input = listed ? src : { ...src, eventGuilds: legacyEventGuilds(src) };
    const fallbackGuildId = String(stored.guildId || "").trim() || CONFIG_DEFAULTS.guildId;
    const talk = String(src.talkGuildId || "").trim();
    return {
        src,
        block: normalizeDiscordServers(input, { fallbackGuildId }),
        talkGuildId: isSnowflake(talk) ? talk : "",
        fallbackGuildId,
    };
}

/**
 * config.json, discordServers + roleSync (#897): the talk server is an ordinary
 * server. A store still carrying `talkGuildId` (or another field of before the
 * federation) or role-sync entries of before #896 gets the federation shape
 * written down once: the talk server in `servers` (at the end, when there is
 * room), its links, and every old event/talk pair as a pair between two
 * servers. `talkGuildId` is gone afterwards. Must run after
 * migrateRoleMessageGuilds(), which still needs the talk server.
 *
 * With the full ten servers there is no room for a separate talk server: the
 * role pairs to it are lost (a warning line names how many, also on warn).
 * Links onto it stay - a link target need not be in the list; a link from it goes.
 * @returns {string[]}
 */
function migrateDiscordFederation() {
    const stored = configStore.readStored();
    const { src, block, talkGuildId } = storedFederation(stored);
    const rawSync = Array.isArray(stored.roleSync) ? stored.roleSync : [];
    const oldBlock = stored.discordServers !== undefined
        && (!Array.isArray(src.servers) || LEGACY_SERVER_KEYS.some((key) => src[key] !== undefined));
    const oldSync = rawSync.some(isLegacyRoleSyncEntry);
    if (!oldBlock && !oldSync) return [];
    const serverIds = block.servers.map((s) => s.guildId);
    const roleSync = normalizeRoleSync(rawSync, { serverIds, talkGuildId });
    configStore.writeStored({ ...stored, discordServers: block, roleSync });
    const out = [`config.json: Discord-Server ohne Talk-Server-Feld gespeichert (#897) - ${block.servers.length} Server, ${block.links.length} Verknüpfung(en), ${roleSync.length} Rollen-Paar(e)`];
    if (talkGuildId && !serverIds.includes(talkGuildId)) {
        const kept = normalizeRoleSync(rawSync, roleSyncContext(block, talkGuildId)).length;
        out.push(`config.json: WARNUNG - der bisherige Talk-Server ${talkGuildId} passt nicht mehr in die Serverliste (höchstens ${MAX_EVENT_GUILDS}); ${kept - roleSync.length} Rollen-Paar(e) zu ihm entfallen; Verknüpfungen auf ihn bleiben, nur solche von ihm aus entfallen (#897)`);
    }
    return out;
}

/** The rights that live per server since #925 (serverAccess.ACCESS_KEYS; listed here, that module would close a require cycle). */
const SERVER_ACCESS_KEYS = ["rolePermissions", "baseAccess", "userPermissions", "orgaRoleIds", "botCommandAccess"];

/**
 * config.json, rights per server (#925): the rights of before - role grants,
 * base access, account grants, orga roles, bot command rules, all global - are
 * copied onto every server (server list, link targets, home guild), so no role
 * gains or loses anything on any server. A server that already holds a key keeps
 * its value. The global fields are dropped only after the copies are written and
 * read back: a start that dies in between finds the copies and only drops then.
 * Nothing global left = nothing to do (idempotent, writes only on a change).
 * Must run after migrateDiscordFederation(), which settles the server list.
 * @returns {string[]}
 */
function migrateServerPermissions() {
    const stored = configStore.readStored();
    const present = SERVER_ACCESS_KEYS.filter((key) => stored[key] !== undefined);
    if (!present.length) return [];
    const cfg = normalizeConfig(stored);
    const guildIds = [...serverSettingGuildIds(cfg.discordServers, cfg.guildId)];
    if (!guildIds.length) {
        return ["config.json: WARNUNG - Rechte (#925) nicht je Server übernommen: kein Discord-Server eingetragen; die bisherigen Rechte bleiben gespeichert, bis ein Server eingetragen ist"];
    }
    const isMap = (value) => value && typeof value === "object" && !Array.isArray(value);
    const blocks = isMap(stored.serverSettings) ? { ...stored.serverSettings } : {};
    let copied = 0;
    for (const gid of guildIds) {
        const block = isMap(blocks[gid]) ? { ...blocks[gid] } : {};
        for (const key of present) {
            if (block[key] !== undefined) continue;
            block[key] = structuredClone(stored[key]);
            copied += 1;
        }
        blocks[gid] = block;
    }
    if (copied) configStore.writeStored({ ...stored, serverSettings: blocks });
    // drop the global fields only once every server holds its copy on disk
    const written = configStore.readStored();
    const writtenBlocks = isMap(written.serverSettings) ? written.serverSettings : {};
    const complete = guildIds.every((gid) => isMap(writtenBlocks[gid]) && present.every((key) => writtenBlocks[gid][key] !== undefined));
    if (!complete) {
        return ["config.json: WARNUNG - Rechte (#925) je Server nicht vollständig gespeichert; die bisherigen Rechte bleiben, der nächste Start versucht es erneut"];
    }
    const next = { ...written };
    for (const key of present) delete next[key];
    configStore.writeStored(next);
    return ["config.json: Rechte je Server (#925) - " + present.join(", ") + " auf " + guildIds.length + " Server übernommen, globale Felder entfernt (Voll-Admin-Rollen bleiben global)"];
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

const LEGACY_BLIZZARD_KEYS = ["region", "realmSlug", "namespace"];

/**
 * The per-version settings for a config from before #542 (it has no
 * `versionSettings` yet): the old values as the TBC block, the others empty,
 * and the Battle.net block without its realm fields. null = nothing to upgrade.
 */
function migrateVersionSettings(stored) {
    // A fresh install (no file) reads the defaults; writing one would make it
    // look like an old install to signupSourcesOf().
    if (!Object.keys(stored).length) return null;
    if (stored.versionSettings && typeof stored.versionSettings === "object") return null;
    const blizzard = { ...(stored.blizzard && typeof stored.blizzard === "object" ? stored.blizzard : {}) };
    for (const key of LEGACY_BLIZZARD_KEYS) delete blizzard[key];
    // versionSettingsOf already hands the other versions their standard values (#553).
    return { versionSettings: versionSettingsOf(stored), blizzard, versionDefaultsApplied: versionsWithDefaults() };
}

/**
 * The standard values per version (#553) for a config that has not had them:
 * every version with defaults that `versionDefaultsApplied` does not list gets
 * its *empty* fields filled (a value someone entered is never touched) and is
 * added to the list — so the next start finds nothing to do, and a field
 * cleared on purpose afterwards stays empty. A version whose defaults appear
 * only later (Forever) is filled on the first start that knows them.
 * null = nothing to upgrade (also a fresh install, which reads the defaults).
 * @returns {null | { versionSettings: object, versionDefaultsApplied: string[], filled: Record<string, string[]> }}
 */
function migrateVersionDefaults(stored) {
    if (!Object.keys(stored).length) return null;
    if (!stored.versionSettings || typeof stored.versionSettings !== "object" || Array.isArray(stored.versionSettings)) return null;
    const applied = Array.isArray(stored.versionDefaultsApplied) ? stored.versionDefaultsApplied.map(String) : [];
    const todo = versionsWithDefaults().filter((id) => !applied.includes(id));
    if (!todo.length) return null;
    const versionSettings = { ...stored.versionSettings };
    const filled = {};
    for (const id of todo) {
        const result = fillDefaults(versionSettings[id], id);
        versionSettings[id] = result.block;
        filled[id] = result.filled;
    }
    return { versionSettings, versionDefaultsApplied: [...applied, ...todo], filled };
}

/**
 * Upgrade config.json. Returns what changed (empty = nothing written).
 * Runs after the templates, so a legacy default finds its migrated template.
 */
function migrateConfig() {
    const stored = configStore.readStored();
    const next = { ...stored };
    const changes = [];
    const categoryRaidTemplate = migrateCategoryRaidTemplate(stored, raidTemplateStore.listRaidTemplates());
    if (categoryRaidTemplate) {
        next.categoryRaidTemplate = categoryRaidTemplate;
        changes.push("config.json: raidDefaults.templateId -> categoryRaidTemplate");
    }
    const versions = migrateVersionSettings(stored);
    if (versions) {
        Object.assign(next, versions);
        const tbc = versions.versionSettings[LEGACY_VERSION] || {};
        changes.push(`config.json: Einstellungen je Spielversion (#542) - bisherige Werte als ${LEGACY_VERSION} (Realm ${tbc.blizzardRealmSlug || "-"}, Namespace ${tbc.blizzardNamespace || "-"}, Wowhead ${tbc.wowheadPath || "-"}), andere Versionen mit Standardwerten`);
    }
    const defaults = migrateVersionDefaults(next);
    if (defaults) {
        next.versionSettings = defaults.versionSettings;
        next.versionDefaultsApplied = defaults.versionDefaultsApplied;
        const list = Object.entries(defaults.filled).map(([id, fields]) => `${id}: ${fields.length ? fields.join(", ") : "nichts leer"}`).join("; ");
        changes.push(`config.json: Standardwerte je Spielversion (#553) - nur leere Felder gefüllt (${list})`);
    }
    if (changes.length) configStore.writeStored(next);
    return changes;
}

/** The log line of the raid plan switch (#524): plans checked / switched, Standard rows made from how many copies, deviations, backup. */
function raidplanDefaultsLine(r) {
    const backup = r.backup ? `, Sicherung ${path.basename(r.backup)}` : "";
    return `raidplans.json: Standard-Abschnitt (#524) - ${r.plans} Plan/Pläne geprüft, ${r.migrated} umgestellt, ${r.rows} Standard-Zeile(n) aus ${r.copies} Kopie(n), ${r.deviations} Abweichung(en), ${r.kept} Abschnitt(e) unverändert behalten${backup}`;
}

/** The raid plan's game versions (#544): catalog entries, templates and tactic profiles without one become TBC ones. One line per file that changed. */
function migrateRaidplanVersions() {
    const out = [];
    const entries = raidplanCatalogStore.migrateVersions("tbc");
    if (entries) out.push(`raidplan-catalog.json: ${entries} Eintrag/Einträge ohne Spielversion auf versions ["tbc"] gesetzt (#544)`);
    const templates = raidplanTemplateStore.migrateVersions();
    if (templates) out.push(`raidplan-templates.json: ${templates} Vorlage(n) ohne Spielversion mit versionId versehen (#544)`);
    const profiles = raidplanProfileStore.migrateVersions();
    if (profiles) out.push(`raidplan-profiles.json: ${profiles} Taktik-Profil(e) ohne Spielversion mit versionId versehen (#544)`);
    return out;
}

/** Characters per game version (#543): profile characters and imported specs without one become TBC ones. */
function migrateCharacterVersions() {
    const out = [];
    const characters = raiderProfileStore.migrateCharacterVersions("tbc");
    if (characters) out.push(`raider-profiles.json: ${characters} Charakter(e) ohne Spielversion auf versionId "tbc" gesetzt (#543)`);
    const specs = specHistoryStore.migrateVersions("tbc");
    if (specs) out.push(`spec-history.json: ${specs} importierte Spec(s) ohne Spielversion auf versionId "tbc" gesetzt (#543)`);
    // no more mains, only the raider's order: each version's former main moves first, the flag goes
    const ordered = raiderProfileStore.migrateCharacterOrder();
    if (ordered) out.push(`raider-profiles.json: ${ordered} Profil(e) ohne Main-Markierung gespeichert – der bisherige Main steht je Spielversion vorn`);
    return out;
}

/** Applications per game version (#553): recruitment templates and tracked posts without one become TBC ones. */
function migrateRecruitmentVersions() {
    const out = [];
    const r = recruitmentStore.migrateVersions(LEGACY_VERSION);
    if (r.templates) out.push(`recruitment.json: ${r.templates} Vorlage(n) ohne Spielversion auf versionId "${LEGACY_VERSION}" gesetzt (#553)`);
    if (r.posts) out.push(`recruitment-posts.json: ${r.posts} Nachricht(en) ohne Spielversion auf versionId "${LEGACY_VERSION}" gesetzt (#553)`);
    return out;
}

/** `counts` ({ versionId: n }) as log lines `<file>: n <what> → "<versionId>" (#737)`. */
function versionStampLines(file, what, counts) {
    return Object.entries(counts || {}).map(([versionId, n]) => `${file}: ${n} ${what} → "${versionId}" (#737)`);
}

/**
 * Every raid has a stored version (#737): Raid-Helper snapshots and rosters
 * without one get the version their category plays today. One line per file
 * and version, or none.
 */
function migrateStoredVersions() {
    const config = configStore.getConfig();
    const raids = raidEventStore.migrateVersions((e) => mainVersionFor({ categoryId: e.categoryId || "", config }));
    return [
        ...versionStampLines("raid-events.json", "Raid(s)", raids),
        ...versionStampLines("rosters.json", "Roster", rosterStore.migrateVersions()),
    ];
}

/**
 * Every active category plays a fixed version (#738): an active category
 * (the stored `categoryIds`, like migrateCategoryPlanning) without one in
 * `categoryVersion` gets the version it plays today — the main version —
 * written down, so switching the main version later moves no category. A
 * fresh install (no file) or a file without categories has nothing to pin;
 * the settings page writes a version with the first save of its categories.
 * One line, or none.
 */
function migrateCategoryVersions() {
    const stored = configStore.readStored();
    if (!Object.keys(stored).length) return [];
    const config = configStore.getConfig();
    const map = normalizeCategoryVersion(stored.categoryVersion);
    const set = [];
    for (const id of (Array.isArray(stored.categoryIds) ? stored.categoryIds : []).map(String).filter(Boolean)) {
        if (map[id]) continue;
        map[id] = mainVersionFor({ categoryId: id, config });
        set.push(`${id} ${map[id]}`);
    }
    if (!set.length) return [];
    configStore.writeStored({ ...stored, categoryVersion: map });
    return [`config.json: Spielversion je aktiver Kategorie festgeschrieben (#738) - ${set.join(", ")}`];
}

/** The Forever character of a raider profile as the Kaderplaner's migration reads it: the raider's first one. */
function profileCharOf(userId) {
    const c = raiderProfileStore.firstCharacter(raiderProfileStore.getProfile(userId), "forever");
    if (!c || !c.className) return null;
    const specs = (Array.isArray(c.specs) ? c.specs : []).map((s) => String((s && s.key) || "")).filter(Boolean);
    return { className: c.className, specs, mainSpec: specs[0] || "" };
}

/** The Kaderplaner of #566 becomes Kader with player states. One line per server that changed. */
function migrateKaderPlanner({ now = new Date().toISOString() } = {}) {
    const done = kaderStore.migrateLegacy({
        now,
        charOfFor: (raw) => {
            const fromPlanner = charOfAssignments(raw);
            return (userId) => fromPlanner(userId) || profileCharOf(userId);
        },
    });
    return done.map((d) => `kader.json: Server ${d.guildId}: ${d.kaders} Kader aus dem alten Format übernommen (${d.roster} im Roster, ${d.bench} auf der Bench, ${d.variants} Beispiel-Setup(s))`);
}

/** Stale decisions outside the roster go, once per server (the mark `decisionsCleared`). One line per server that lost some. */
function migrateKaderDecisions() {
    return kaderStore.clearStaleDecisions()
        .filter((d) => d.cleared > 0)
        .map((d) => `kader.json: Server ${d.guildId}: ${d.cleared} veraltete Entscheidung(en) außerhalb des Rosters entfernt`);
}

/** The newest moment per category, from records that name an event: `{ [categoryId]: at }`. */
function lastUseByCategory(records, categoryOf) {
    const out = {};
    for (const { eventId, at } of records) {
        const cat = categoryOf(eventId);
        if (cat) out[cat] = Math.max(out[cat] || 0, Number(at) || 0);
    }
    return out;
}

/**
 * Raidplan ODER Sheet: every raid category without a stored planning mode gets
 * the one it used — fixed sheet → "sheet", else the newer of its last filled
 * sheet copy and its last raid plan with boards, else "raidplan". One line, or none.
 */
function migrateCategoryPlanning() {
    const stored = configStore.readStored();
    const planning = { ...(stored.categoryPlanning || {}) };
    const cats = (Array.isArray(stored.categoryIds) ? stored.categoryIds : []).map(String).filter((id) => id && !planning[id]);
    if (!cats.length) return [];
    const categoryOf = (eventId) => {
        const own = eventStore.getEvent(eventId);
        const rh = own ? null : raidEventStore.getRaidEvent(eventId);
        return String(((own || rh) || {}).categoryId || "");
    };
    const sheets = lastUseByCategory(eventSheetStore.listEventSheets()
        .filter((s) => s.url || s.spreadsheetId)
        .map((s) => ({ eventId: s.eventId, at: s.filledAt })), categoryOf);
    const plans = lastUseByCategory(raidplanStore.listPlans()
        .filter((p) => Object.keys(p.bosses || {}).length)
        .map((p) => ({ eventId: p.eventId, at: p.updatedAt })), categoryOf);
    const fixed = stored.categorySheets || {};
    const set = [];
    for (const cat of cats) {
        const usesSheet = !!(fixed[cat] && fixed[cat].url) || (sheets[cat] || 0) > (plans[cat] || 0);
        const mode = usesSheet ? "sheet" : "raidplan";
        planning[cat] = mode;
        set.push(`${cat} ${mode}`);
    }
    configStore.writeStored({ ...stored, categoryPlanning: planning });
    return [`config.json: Planung je Raid-Kategorie nach der bisherigen Nutzung festgelegt (Raidplan oder Sheet) - ${set.join(", ")}`];
}

/** The category name snapshot of services/discord/categoryNames.js (guildId -> { categoryId: name }), read here without Discord. */
function categoryNameSnapshot() {
    const data = readJsonFile(settingsPath("category-names.json"), {});
    return (data && typeof data.guilds === "object" && data.guilds) || {};
}

/** Rosters per raid category (#653): one per category with roles or assignments, once. One line, or none. */
function migrateCategoryRosters({ now = new Date().toISOString() } = {}) {
    const categories = categoriesToMigrate({
        config: configStore.getConfig(),
        assignments: raiderCharactersStore.readLegacyAssignments(),
        snapshot: categoryNameSnapshot(),
        events: [...raidEventStore.listRaidEvents(""), ...eventStore.listEvents("")],
    });
    const line = migrationLine(rosterStore.migrateCategories(categories, { now }));
    return line ? [line] : [];
}

/** A category's name for its migrated council profile: the name snapshot, else its newest event's, else "". */
function councilCategoryName(snapshot, events) {
    const names = new Map();
    for (const byCategory of Object.values(snapshot || {})) {
        for (const [id, name] of Object.entries(byCategory || {})) if (name && !names.has(id)) names.set(id, String(name));
    }
    return (categoryId) => {
        if (names.has(categoryId)) return names.get(categoryId);
        const newest = events
            .filter((e) => e && String(e.categoryId || "") === categoryId && e.categoryName)
            .sort((a, b) => Number(b.startTime || b.start || 0) - Number(a.startTime || a.start || 0))[0];
        return newest ? String(newest.categoryName) : "";
    };
}

/** Loot-Council profiles from #668's weighting and views (#676), once. One line, or none. */
function migrateCouncilProfiles({ now = Date.now() } = {}) {
    if (councilProfilesStore.isMigrated()) return [];
    const stored = councilWeightsStore.storedWeights();
    const views = councilStore.listViews();
    // Nothing set before (a fresh install): the virtual "Standard" already is the defaults - no file, no line.
    if (!stored.global && !Object.keys(stored.categories).length && !Object.keys(views).length) return [];
    const result = councilProfilesStore.migrateLegacy({
        global: stored.global,
        categories: stored.categories,
        views,
        nameOf: councilCategoryName(categoryNameSnapshot(), [...raidEventStore.listRaidEvents(""), ...eventStore.listEvents("")]),
        // a migration of the days with one roster per category (#739: the open one, the newest first)
        rosterFor: (categoryId) => rosterStore.rostersForCategory(categoryId)[0] || null,
        assign: (rosterId, profileId) => rosterStore.assignLootProfile(rosterId, profileId),
    }, { now });
    if (!result.ran) return [];
    const parts = result.created.map((c) => `"${c.name}" (${c.rosterId ? `Roster ${c.rosterId}` : `Kategorie ${c.categoryId}`})`);
    return [`council-profiles.json: Loot-Council-Profile angelegt (#676) - "Standard"${stored.global ? " aus der Server-Gewichtung" : " mit den Vorgaben"}${parts.length ? `, ${parts.join(", ")}` : ""}`];
}

/**
 * role-messages.json (#895): every old entry gets the server its side means
 * today - the old talk server for "talk" (read from the raw config.json, as
 * long as it still names one), else the first server of the list; "talk"
 * without a talk server meant the one server too. The same rule as
 * guildRoles.roleMessageGuild, computed here from configSchema (guildRoles
 * requires settingsStore, which requires this file: a cycle). Runs before
 * migrateDiscordFederation(), which drops `talkGuildId`.
 */
function migrateRoleMessageGuilds() {
    const stored = configStore.readStored();
    const { block, talkGuildId, fallbackGuildId } = storedFederation(stored);
    const firstId = (block.servers[0] && block.servers[0].guildId) || fallbackGuildId;
    const moved = roleMessageStore.migrateGuildSides((entry) => (entry.guildSide === "talk" && talkGuildId ? talkGuildId : firstId));
    return moved ? [`role-messages.json: ${moved} Rollen-Nachricht(en) ihrem Server fest zugeordnet (#895)`] : [];
}

// #924: config.json fields that are per server now. Channel and role values go
// to the server they live on (else to the first server); raidDefaults is the
// raid form's preset channel ({ channelId }) and goes like a channel. The bot
// language is not moved: the global value stays as the default every server
// without its own inherits.
const SERVER_CHANNEL_FIELDS_924 = ["applicationChannelId"];
const SERVER_ROLE_FIELDS_924 = ["officerRoleId"];
const SERVER_RAID_FIELDS_924 = ["raidDefaults"];
const DISCORD_SERVER_FIELDS_924 = ["signupNoteChannelId", "guildBankChannelId"];

/**
 * channelId -> guildId and roleId -> guildId from what the stores already know
 * (no Discord at start): own events and Raid-Helper snapshots, role messages,
 * link targets, role-sync pairs, category roles over the category snapshot.
 * The first source that names an id wins.
 */
function knownPlaces924(stored, block) {
    const channels = new Map();
    const roles = new Map();
    const put = (map, id, guildId) => {
        const key = String(id || "").trim();
        const guild = String(guildId || "").trim();
        if (isSnowflake(key) && isSnowflake(guild) && !map.has(key)) map.set(key, guild);
    };
    const categoryGuilds = categoryGuildIndex(categoryNameSnapshot());
    for (const e of eventStore.listEvents("", { siblings: true })) put(channels, e.channelId, e.guildId);
    for (const e of raidEventStore.listRaidEvents("")) put(channels, e.channelId, guildOfEvent(e, { categoryGuilds }));
    for (const m of roleMessageStore.listMessages()) {
        put(channels, m.channelId, m.guildId);
        for (const r of m.roles || []) put(roles, r.roleId, m.guildId);
    }
    for (const l of block.links) put(channels, l.channelId, l.to);
    for (const p of Array.isArray(stored.roleSync) ? stored.roleSync : []) {
        if (!p || typeof p !== "object") continue;
        put(roles, p.fromRoleId, p.fromGuildId);
        put(roles, p.toRoleId, p.toGuildId);
    }
    const categoryRoles = stored.categoryRoles && typeof stored.categoryRoles === "object" ? stored.categoryRoles : {};
    for (const [categoryId, ids] of Object.entries(categoryRoles)) {
        for (const id of Array.isArray(ids) ? ids : []) put(roles, id, categoryGuilds.get(categoryId));
    }
    return { channels, roles };
}

/** The stored config with the server blocks and without the global #924 fields. */
function withoutGlobals924(stored, serverSettings) {
    const out = { ...stored, serverSettings };
    for (const key of [...SERVER_CHANNEL_FIELDS_924, ...SERVER_ROLE_FIELDS_924, ...SERVER_RAID_FIELDS_924]) delete out[key];
    if (stored.discordServers && typeof stored.discordServers === "object" && !Array.isArray(stored.discordServers)) {
        const servers = { ...stored.discordServers };
        for (const key of DISCORD_SERVER_FIELDS_924) delete servers[key];
        out.discordServers = servers;
    }
    return out;
}

/**
 * config.json (#924): applicationChannelId, officerRoleId, raidDefaults and
 * discordServers.signupNoteChannelId / guildBankChannelId move into
 * serverSettings. A channel or role goes to the server it lives on (as far as
 * the stores tell, see knownPlaces924), else to the first server only (the
 * other servers stay empty and show "no channel"); the raid defaults' preset
 * channel the same way. The bot language stays global: it is the default every
 * server inherits, no server gets an own value (one a server already holds
 * stays). A field a server block already holds is left alone. The global fields are dropped in
 * the same write that stores the server blocks. Runs before
 * migrateDiscordFederation(), whose normalising drops the two channel fields,
 * and after migrateConfig(), which still reads raidDefaults.templateId.
 * A fresh install (no file) has nothing to move and gets no file written.
 * @returns {string[]}
 */
function migrateServerDefaults() {
    const stored = configStore.readStored();
    if (!Object.keys(stored).length) return [];
    const { src, block, fallbackGuildId } = storedFederation(stored);
    const known = [...serverSettingGuildIds(block, (block.servers[0] && block.servers[0].guildId) || fallbackGuildId)];
    if (!known.length) return [];
    const firstId = known[0];
    const blocks = stored.serverSettings && typeof stored.serverSettings === "object" && !Array.isArray(stored.serverSettings)
        ? stored.serverSettings : {};
    const has = (key) => Object.values(blocks).some((b) => b && typeof b === "object" && b[key] !== undefined);
    const legacy = (key) => stored[key];
    const todo = [...SERVER_CHANNEL_FIELDS_924, ...SERVER_ROLE_FIELDS_924, ...SERVER_RAID_FIELDS_924]
        .filter((key) => legacy(key) !== undefined && !has(key));
    const fromServers = DISCORD_SERVER_FIELDS_924.filter((key) => src[key] !== undefined && !has(key));
    const leftovers = [...SERVER_RAID_FIELDS_924, ...SERVER_CHANNEL_FIELDS_924, ...SERVER_ROLE_FIELDS_924].some((key) => stored[key] !== undefined)
        || DISCORD_SERVER_FIELDS_924.some((key) => src[key] !== undefined);
    if (!todo.length && !fromServers.length && !leftovers) return [];

    const next = {};
    for (const [guildId, b] of Object.entries(blocks)) next[guildId] = { ...(b && typeof b === "object" ? b : {}) };
    const set = (guildId, key, value) => { next[guildId] = { ...(next[guildId] || {}), [key]: value }; };
    const places = knownPlaces924(stored, block);
    const placeOf = (map, id) => {
        const guildId = map.get(id);
        return guildId && known.includes(guildId) ? guildId : firstId;
    };
    const lines = [];
    const placeOne = (key, value, map) => {
        const id = String(value || "").trim();
        if (!isSnowflake(id)) return;
        const guildId = placeOf(map, id);
        set(guildId, key, id);
        lines.push(`${key} -> ${guildId}${map.get(id) === guildId ? "" : " (erster Server)"}`);
    };
    // the preset channel to its server, as { channelId }; none = nothing to store
    const placeRaidDefaults = (value) => {
        const id = String(((value && typeof value === "object") ? value : {}).channelId || "").trim();
        if (!isSnowflake(id)) return;
        const guildId = placeOf(places.channels, id);
        set(guildId, "raidDefaults", { channelId: id });
        lines.push(`raidDefaults -> ${guildId}${places.channels.get(id) === guildId ? "" : " (erster Server)"}`);
    };
    for (const key of todo) {
        if (SERVER_CHANNEL_FIELDS_924.includes(key)) placeOne(key, legacy(key), places.channels);
        else if (SERVER_ROLE_FIELDS_924.includes(key)) placeOne(key, legacy(key), places.roles);
        else placeRaidDefaults(legacy(key));
    }
    for (const key of fromServers) placeOne(key, src[key], places.channels);
    configStore.writeStored(withoutGlobals924(stored, next));
    return [`config.json: Bewerbungen, Raid-Standardwerte und Kanäle je Server gespeichert (#924)${lines.length ? ` - ${lines.join(", ")}` : " - globale Altfelder entfernt"}`];
}

/**
 * The global #924 values as stored (channel and role ids, raid defaults - no
 * secrets), for the error log when moving them failed.
 */
function legacyValues924(stored) {
    const src = stored.discordServers && typeof stored.discordServers === "object" ? stored.discordServers : {};
    const values = {};
    for (const key of [...SERVER_CHANNEL_FIELDS_924, ...SERVER_ROLE_FIELDS_924, ...SERVER_RAID_FIELDS_924]) {
        if (stored[key] !== undefined) values[key] = stored[key];
    }
    for (const key of DISCORD_SERVER_FIELDS_924) if (src[key] !== undefined) values[`discordServers.${key}`] = src[key];
    return values;
}

/**
 * migrateServerDefaults(), and when it throws the old values go to the error log
 * first (by hand they can be set per server again), then the error goes on.
 */
function migrateServerDefaultsLogged(warn) {
    try {
        return migrateServerDefaults();
    } catch (error) {
        let values = {};
        try { values = legacyValues924(configStore.readStored()); } catch { /* the error below says enough */ }
        warn(`[settings] Migration #924 fehlgeschlagen, bisherige Werte: ${JSON.stringify(values)}`);
        throw error;
    }
}

/**
 * logs.json (#917): the server of every log by the rule raid -> post -> first
 * server, written down. Reads the server list, never writes it. One line, or none.
 */
function migrateLogGuilds() {
    const firstGuildId = firstServerId(configStore.getConfig());
    const categoryGuilds = categoryGuildIndex(categoryNameSnapshot());
    const eventGuildOf = (eventId) => {
        const id = String(eventId || "").trim();
        if (!id) return "";
        const event = eventStore.getEvent(id) || raidEventStore.getRaidEvent(id);
        return guildOfEvent(event, { categoryGuilds });
    };
    const changed = logStore.migrateGuilds((log) => logGuild(log, { eventGuildId: eventGuildOf(log.eventId), firstGuildId }));
    return changed ? [`logs.json: ${changed} Log(s) ihrem Discord-Server fest zugeordnet (#917)`] : [];
}

/** The server Raid-Helper ran for before #927: the one with the old id, else the first. */
function legacyRaidhelperOwner(config, legacyId) {
    const servers = (config.discordServers && Array.isArray(config.discordServers.servers)) ? config.discordServers.servers : [];
    const match = servers.find((s) => s && String(s.guildId || "") === legacyId);
    return match ? legacyId : firstServerId(config);
}

/**
 * config.json (#927): the server Raid-Helper ran for keeps it as it was (the old
 * switch, the .env key through `envKey`), every other server starts off. Then
 * the synced list and the budget of before #927 go to that server.
 */
function migrateRaidhelperServers({ env = process.env } = {}) {
    const lines = [];
    const config = configStore.getConfig();
    const stored = configStore.readStored();
    const blocks = stored.serverSettings && typeof stored.serverSettings === "object" ? stored.serverSettings : {};
    const migrated = Object.values(blocks).some((b) => b && typeof b === "object" && b.raidhelper);
    const legacyId = String(stored.raidhelperServerId || env.RAIDHELPER_SERVER_ID || "").trim();
    const owner = legacyRaidhelperOwner(config, legacyId);
    if (!owner) return lines;
    if (!migrated && legacyId && Object.keys(stored).length) {
        const retirement = stored.raidhelperRetirement && typeof stored.raidhelperRetirement === "object" ? stored.raidhelperRetirement : {};
        const block = {
            enabled: retirement.disabled !== true,
            serverId: owner === legacyId ? "" : legacyId,
            apiKey: "",
            envKey: true,
            at: Number(retirement.at) || 0,
            byName: String(retirement.byName || ""),
        };
        const own = blocks[owner] && typeof blocks[owner] === "object" ? blocks[owner] : {};
        configStore.writeStored({ ...stored, serverSettings: { ...blocks, [owner]: { ...own, raidhelper: block } } });
        lines.push(`config.json: Raid-Helper dem Server ${owner} zugeordnet (${block.enabled ? "an" : "aus"}, Schlüssel aus .env) (#927)`);
    }
    if (raidhelperEventsStore.moveLegacy(owner)) lines.push(`raidhelper-events.json: abgeglichene Events dem Server ${owner} zugeordnet (#927)`);
    if (raidhelperBudgetStore.moveLegacy(owner)) lines.push(`raidhelper-budget.json: Tageskontingent dem Server ${owner} zugeordnet (#927)`);
    return lines;
}

/**
 * reports (#920): every evaluation from before #920 gets a server of its own, once -
 * the server of its log (logs are stamped just before), or the first server for one
 * without a log (a link evaluated by hand). From then on a deleted log cannot take
 * the server of its report with it. Listing the reports reads every file, so the run
 * leaves a mark (migrationMarkStore) and later starts skip it. One line, or none.
 */
function migrateReportGuilds() {
    if (migrationMarkStore.isDone("reportGuilds")) return [];
    const firstGuildId = firstServerId(configStore.getConfig());
    if (!firstGuildId) return [];
    const logGuildOf = new Map();
    for (const l of logStore.listLogs()) {
        if (l && l.reportRefId && l.guildId) logGuildOf.set(String(l.reportRefId), String(l.guildId));
    }
    const changed = reportStore.assignGuilds((meta) => logGuildOf.get(String(meta.id)) || firstGuildId);
    // no reports folder yet (a fresh install): nothing to stamp, and nothing written either
    if (changed === null) return [];
    migrationMarkStore.markDone("reportGuilds");
    return changed ? [`reports: ${changed} Auswertung(en) ihrem Discord-Server fest zugeordnet (#920)`] : [];
}

/**
 * Run every upgrade once. Never throws - a start must not fail over an old
 * file; the error is logged and the bot comes up with what it can read.
 * @returns {{ changes: string[], error?: Error }}
 */

function migrateSettings({ log = console.log, warn = console.error } = {}) {
    const changes = [];
    try {
        const overflowTemplates = raidTemplateStore.migrateOverflowModes();
        if (overflowTemplates) changes.push(`raid-templates.json: ${overflowTemplates} Vorlage(n) auf "keine Grenze" umgestellt (overflow none, lockAtLimit aus)`);
        const overflowEvents = eventStore.migrateOverflowModes();
        if (overflowEvents) changes.push(`events.json: ${overflowEvents} Event(s) auf "keine Grenze" umgestellt (overflow none, lockAtLimit aus)`);
        const templates = raidTemplateStore.migrateLegacyTemplates();
        if (templates) changes.push(`raid-templates.json: ${templates} alte Raid-Helper-Vorlage(n) umgestellt`);
        // Order matters (#897): the role messages read the old talk server, the federation step drops it.
        changes.push(...migrateRoleMessageGuilds());
        // #924: after migrateConfig (reads raidDefaults.templateId), before the federation step (drops the channel fields).
        changes.push(...migrateConfig());
        changes.push(...migrateServerDefaultsLogged(warn));
        changes.push(...migrateDiscordFederation());
        // #925: after the federation step, which settles the server list the rights are copied onto.
        changes.push(...migrateServerPermissions());
        const plans = raidplanStore.migrateEventDefaults({ instanceIdsOf: (plan) => (eventStore.getEvent(plan.eventId) || {}).instanceIds || [] });
        if (plans) changes.push(raidplanDefaultsLine(plans));
        changes.push(...migrateRaidplanVersions());
        changes.push(...migrateCharacterVersions());
        changes.push(...migrateRecruitmentVersions());
        changes.push(...migrateKaderPlanner());
        changes.push(...migrateKaderDecisions());
        changes.push(...migrateCategoryPlanning());
        changes.push(...migrateCategoryRosters());
        changes.push(...migrateStoredVersions());
        changes.push(...migrateCategoryVersions());
        changes.push(...migrateCouncilProfiles());
        changes.push(...migrateLogGuilds());
        changes.push(...migrateReportGuilds());
        changes.push(...migrateRaidhelperServers());
    } catch (error) {
        warn(`[settings] Migration fehlgeschlagen: ${error.message}`);
        return { changes, error };
    }
    for (const change of changes) log(`[settings] Migration: ${change}`);
    // A warning line (data the upgrade could not keep) also goes to the error log.
    for (const change of changes) if (/: WARNUNG /.test(change)) warn(`[settings] Migration: ${change}`);
    return { changes };
}

module.exports = {
    migrateSettings, migrateRaidplanVersions, migrateCharacterVersions, migrateRecruitmentVersions, migrateKaderPlanner, migrateKaderDecisions, migrateCategoryPlanning, migrateCategoryRosters, migrateStoredVersions, migrateCategoryVersions, migrateCouncilProfiles, migrateRoleMessageGuilds, migrateLogGuilds, migrateReportGuilds, migrateDiscordFederation, migrateServerDefaults, migrateServerPermissions, raidplanDefaultsLine, migrateRaidhelperServers,
    migrateCategoryRaidTemplate, migrateVersionSettings, migrateVersionDefaults,
};
