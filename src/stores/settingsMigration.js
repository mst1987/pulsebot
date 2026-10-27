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
// migrateSettings() is idempotent: it writes only when something changed, so
// the second start finds nothing to do and writes nothing.
const path = require("path");
const { isSnowflake } = require("../utils/ids");
const {
    CONFIG_DEFAULTS, normalizeCategoryVersion, normalizeDiscordServers, normalizeRoleSync, roleSyncContext, MAX_SERVERS: MAX_EVENT_GUILDS,
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
        changes.push(...migrateDiscordFederation());
        changes.push(...migrateConfig());
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
    migrateSettings, migrateRaidplanVersions, migrateCharacterVersions, migrateRecruitmentVersions, migrateKaderPlanner, migrateKaderDecisions, migrateCategoryPlanning, migrateCategoryRosters, migrateStoredVersions, migrateCategoryVersions, migrateCouncilProfiles, migrateRoleMessageGuilds, migrateLogGuilds, migrateDiscordFederation, raidplanDefaultsLine,
    migrateCategoryRaidTemplate, migrateVersionSettings, migrateVersionDefaults,
};
