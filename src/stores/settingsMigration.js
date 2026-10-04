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
//   - config.json, categoryPlanning (Raidplan ODER Sheet): every raid category
//     (config.categoryIds) without a stored mode gets the one it really used,
//     written down so the settings card shows it: "sheet" with a fixed sheet
//     (categorySheets), else whichever its raids used last — a filled sheet
//     copy (event-sheets.json, filledAt) or a raid plan with boards
//     (raidplans.json, updatedAt) — else "raidplan". A mode somebody picked is
//     never touched.
//
// migrateSettings() is idempotent: it writes only when something changed, so
// the second start finds nothing to do and writes nothing.
const path = require("path");
const { isSnowflake } = require("../utils/ids");
const { CONFIG_DEFAULTS } = require("./configSchema");
const { versionSettingsOf, versionsWithDefaults, fillDefaults } = require("./versionSettingsSchema");
const { LEGACY_VERSION } = require("../config/gameVersions");
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
        changes.push(...migrateConfig());
        const plans = raidplanStore.migrateEventDefaults({ instanceIdsOf: (plan) => (eventStore.getEvent(plan.eventId) || {}).instanceIds || [] });
        if (plans) changes.push(raidplanDefaultsLine(plans));
        changes.push(...migrateRaidplanVersions());
        changes.push(...migrateCharacterVersions());
        changes.push(...migrateRecruitmentVersions());
        changes.push(...migrateKaderPlanner());
        changes.push(...migrateCategoryPlanning());
    } catch (error) {
        warn(`[settings] Migration fehlgeschlagen: ${error.message}`);
        return { changes, error };
    }
    for (const change of changes) log(`[settings] Migration: ${change}`);
    return { changes };
}

module.exports = {
    migrateSettings, migrateRaidplanVersions, migrateCharacterVersions, migrateRecruitmentVersions, migrateKaderPlanner, migrateCategoryPlanning, raidplanDefaultsLine,
    legacyEventGuilds, migrateDiscordServers, migrateCategoryRaidTemplate, migrateVersionSettings, migrateVersionDefaults,
};
