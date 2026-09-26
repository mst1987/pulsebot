// DEV ONLY: a Raid-Helper stand-in for local test instances (docs/raidplan.md, "Raid-Helper-Events" -> "Dev-Fixture").
//
// With EVENTHELPER_RH_FIXTURE set and NODE_ENV not "production", createRaidhelperClient() hands out this client instead of the real
// one: it knows exactly ONE made-up Raid-Helper event ("BT 25er Fixture", in two days, 25 raiders under nicknames, a raidplan with
// group numbers) and never opens a connection to raid-helper.xyz. Writes are refused like on a switched-off Raid-Helper. Values:
//   1 / on      the event with its Aufstellung (groupNumber set)
//   nogroups    the Aufstellung without group numbers (5er blocks in order)
//   signups     no Aufstellung: the line-up comes from the signups
//   gone        Schildwall (a tank) left: he is missing from the Aufstellung and the signups ("nicht mehr im Setup")
//   down        Raid-Helper "does not answer": every read rejects (the fallback of the raid plan is what is tested)
// The mode can change while the instance runs: a file data/rh-fixture-mode.txt holding one of these values wins over the variable
// (switch to "down" and back without a restart - the in-memory fallbacks are what an outage really hits). Delete it to go back.
// In production the variable does nothing: fixtureEnabled() checks NODE_ENV itself, so a stray variable on the server cannot switch
// the real Raid-Helper off.
const { logcheckAdminIds } = require("../../config/variables");
const { listEvents } = require("../../web/eventStore");
const discord = require("../../web/discord");

const FIXTURE_EVENT_ID = "1400000000000000001";
const MODES = ["on", "nogroups", "signups", "gone", "down"];
const MODE_FILE = require("../../config/paths").dataPath("rh-fixture-mode.txt");

/** The mode the file names, or "" (no file, or nothing it knows). */
function fileMode(file = MODE_FILE) {
    try {
        const v = require("fs").readFileSync(file, "utf8").trim().toLowerCase();
        return MODES.includes(v) ? v : "";
    } catch {
        return "";
    }
}

/** The fixture mode of an environment, or "" when the fixture is off (always off in production). */
function fixtureMode(env = process.env) {
    if (String(env.NODE_ENV || "") === "production") return "";
    const v = String(env.EVENTHELPER_RH_FIXTURE || "").trim().toLowerCase();
    if (!v || v === "0" || v === "off" || v === "false") return "";
    return ["nogroups", "signups", "gone", "down"].includes(v) ? v : "on";
}

const fixtureEnabled = (env = process.env) => fixtureMode(env) !== "";

// [nickname, className, specName] - Raid-Helper's own spelling ("Tank" for the tank specs); one death knight on purpose (unknown spec)
const RAIDERS = [
    ["Heilbert", "Priest", "HolyPriest"], ["Tanki", "Tank", "Protection"], ["Bärchen", "Tank", "Guardian"], ["Schildwall", "Tank", "Protection1"],
    ["Lichtblick", "Paladin", "Holy1"], ["Wellness", "Shaman", "Restoration1"], ["Blümchen", "Druid", "Restoration"], ["Disziplin", "Priest", "Discipline"],
    ["Totemtom", "Shaman", "Restoration1"], ["Heilgard", "Paladin", "Holy1"], ["Schatten", "Priest", "Shadow"],
    ["Messerjoe", "Rogue", "Combat"], ["Wutbürger", "Warrior", "Fury"], ["Kralle", "Druid", "Feral"], ["Sturmi", "Shaman", "Enhancement"],
    ["Klinge", "Rogue", "Combat"], ["Retri", "Paladin", "Retribution"], ["Axtmann", "Warrior", "Arms"],
    ["Feuerfuchs", "Mage", "Fire"], ["Eiszapfen", "Mage", "Frost"], ["Dotti", "Warlock", "Affliction"], ["Destro", "Warlock", "Destro"],
    ["Pfeil", "Hunter", "Beastmastery"], ["Mondkind", "Druid", "Balance"], ["Frostgrab", "DeathKnight", "Frost"],
];

/** The Discord id of fixture raider `i` (the first one is the dev login, so "Meine Aufgaben" has something to show). */
function userIdOf(i) {
    if (i === 0 && logcheckAdminIds[0]) return String(logcheckAdminIds[0]);
    return `9${String(i * 7919 + 1).padStart(17, "0")}`;
}

/** The fixture event in Raid-Helper's v4 shape (signUps with names) and its raidplan slots. */
function fixtureData(mode = "on", now = Date.now()) {
    const startTime = Math.floor(now / 1000 / 3600) * 3600 + 2 * 24 * 3600;
    const signUps = RAIDERS.map(([name, className, specName], i) => ({
        userId: userIdOf(i), name, className, specName, status: "primary", entryTime: startTime - 86400 + i,
    }));
    // one double reaction (the first counts) and one bench / one absence that never stand in the line-up
    signUps.push({ userId: userIdOf(3), name: "Schildwall", className: "Warrior", specName: "Fury", status: "primary", entryTime: startTime });
    signUps.push({ userId: "9555000000000000001", name: "Bankdrücker", className: "Mage", specName: "Frost", status: "bench", entryTime: startTime });
    signUps.push({ userId: "9555000000000000002", name: "Urlauber", className: "Absence", specName: "Absence", status: "primary", entryTime: startTime });
    const slots = mode === "signups" ? [] : RAIDERS.map(([name, className, specName], i) => ({
        id: userIdOf(i), name, className, specName, ...(mode === "nogroups" ? {} : { groupNumber: Math.floor(i / 5) + 1 }), slotNumber: (i % 5) + 1,
    }));
    if (mode === "gone") {
        const left = userIdOf(3);
        return fixtureDataWithout(left, { signUps, slots, startTime });
    }
    return {
        event: { id: FIXTURE_EVENT_ID, title: "BT 25er Fixture", startTime, channelId: "", leaderId: userIdOf(0), templateId: 1, description: "Dev-Fixture", signUps },
        slots,
    };
}

/** The fixture data with one raider gone from both lists. */
function fixtureDataWithout(userId, { signUps, slots, startTime }) {
    return {
        event: { id: FIXTURE_EVENT_ID, title: "BT 25er Fixture", startTime, channelId: "", leaderId: userIdOf(0), templateId: 1, description: "Dev-Fixture", signUps: signUps.filter((s) => s.userId !== userId) },
        slots: slots.filter((s) => s.id !== userId),
    };
}

function refuse() {
    const e = new Error("Dev-Fixture: an Raid-Helper wird nichts geschrieben.");
    e.code = "raidhelper_fixture";
    return Promise.reject(e);
}

/**
 * The fixture client. `channelIdOf()` names the Discord channel the event is shown in (the event list places a Raid-Helper event by
 * its channel's category) - by default the channel of the first own event of the store, so a local instance lists it next to them.
 */
function fixtureClient({ mode: baseMode = fixtureMode(), channelIdOf = defaultChannel, now = () => Date.now(), modeFile = MODE_FILE } = {}) {
    const current = () => fileMode(modeFile) || baseMode;
    const down = () => Promise.reject(new Error("Dev-Fixture: Raid-Helper antwortet nicht (EVENTHELPER_RH_FIXTURE=down)."));
    const data = () => {
        const d = fixtureData(current(), now());
        d.event.channelId = channelIdOf() || "";
        return d;
    };
    const events = async (since) => {
        if (current() === "down") return down();
        const d = data();
        return !since || d.event.startTime >= since ? [d.event] : [];
    };
    return {
        fixture: true,
        fetchEvents: events,
        getAllEvents: () => events(Math.floor(now() / 1000)),
        getPastEvents: async () => (current() === "down" ? down() : []),
        getTemplates: async () => [],
        getUserSignUps: async () => [],
        getMissingSignUps: async () => [],
        // like the real client: no Aufstellung (and, the real one, a network error) resolve undefined
        getSetup: async (id) => {
            if (current() === "down" || String(id) !== FIXTURE_EVENT_ID) return undefined;
            const d = data();
            return d.slots.length ? { raidid: id, setup: d.slots, startTime: d.event.startTime } : undefined;
        },
        getEvent: async (id) => {
            if (current() === "down") return down();
            return String(id) === FIXTURE_EVENT_ID ? data().event : { status: "failed", reason: "unknown event" };
        },
        createEvent: refuse,
        signUpToRaid: refuse,
        signUp: refuse,
    };
}

/**
 * The channel the fixture event is shown in: EVENTHELPER_RH_FIXTURE_CHANNEL, else the channel of the first own event when Discord knows
 * it, else the first channel with a category on that event's server (the dev server) - the event list only places a Raid-Helper event
 * whose channel it finds.
 */
function defaultChannel() {
    if (process.env.EVENTHELPER_RH_FIXTURE_CHANNEL) return String(process.env.EVENTHELPER_RH_FIXTURE_CHANNEL);
    try {
        const own = (listEvents() || []).find((e) => e && e.guildId) || null;
        const guildId = own ? own.guildId : String(process.env.GUILD_ID || "");
        const map = discord.getChannelCategoryMap(guildId) || {};
        if (own && own.channelId && map[own.channelId]) return String(own.channelId);
        return Object.keys(map).find((id) => map[id] && map[id].categoryId) || "";
    } catch {
        return "";
    }
}

module.exports = { fileMode, MODE_FILE, fixtureMode, fixtureEnabled, fixtureClient, fixtureData, FIXTURE_EVENT_ID, RAIDERS, userIdOf };
