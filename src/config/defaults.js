// Bootstrap values: what a fresh install starts with before anyone has opened
// the admin menu. They seed the settings store (stores/settingsStore.js) and fill
// in where the environment names nothing; every one of them can be overridden
// in the admin menu, which is where they are meant to be changed — not here and
// not in .env.
//
// Nothing in this file is a secret, and nothing here is read from the environment —
// that is config/env.js. Fixed facts of the domain live in config/constants.js.

// Bootstrap: the admin who can always log in to configure the rest
// (ADMIN_USER_ID overrides it).
const adminUserId = "233598324022837249";

// Bootstrap: the guild this bot is installed in — what the admin-role check runs
// against and what the admin menu's server switcher preselects when the session
// hasn't picked one (see web/http/activeGuild.js). GUILD_ID overrides it, so a dev
// instance points its own .env(.dev) at the test server instead.
const guildId = "1354128137792917555";

// Bootstrap: the raid categories whose channels count as event channels.
const categoryIds = [
    "1115368280245420042",
    "1143858079289577502",
    "1157813724741128293",
];

// Bootstrap: tab and sheet id of the default "Tier 4/5" raidsheet; further
// raidsheets are added in the admin menu.
const googleSheetName = "Setup";
const googleSheetGid = 34139428;

// Bootstrap: realm of the optional Battle.net character lookup.
const blizzardRegion = "eu";
const blizzardRealmSlug = "thunderstrike";

// Bootstrap: URL templates with a {char} placeholder, used to auto-fill links
// when an applicant didn't provide one. They target Thunderstrike (EU,
// fresh/anniversary).
const applyArmoryUrlTemplate = "https://classic-armory.org/character/eu/tbc-anniversary/thunderstrike/{char}";
const applyWclUrlTemplate = "https://fresh.warcraftlogs.com/character/eu/thunderstrike/{char}";

// Bootstrap: port of the web server (menu, API, report pages) when WEB_PORT is unset.
const webPort = 3005;

module.exports = {
    adminUserId,
    guildId,
    categoryIds,
    googleSheetName,
    googleSheetGid,
    blizzardRegion,
    blizzardRealmSlug,
    applyArmoryUrlTemplate,
    applyWclUrlTemplate,
    webPort,
};
