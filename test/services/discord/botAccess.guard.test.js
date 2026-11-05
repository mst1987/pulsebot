// Guard (#1073 B): the rank Server-Admin opens every bot command whose rule is
// "admins" - unless the command (or the one whose rule it follows) is marked
// `sharedData: true`. A command with a global account or target (SheetsClient /
// GOOGLE_SPREADSHEET_ID, createRaidhelperClient() without guildId, stores read over
// all categories, WCL/Softres/GitHub with the operator's key) must carry that mark,
// else a server admin reaches data of every server. This test runs over the real
// command registry: every effectively "admins" entry without sharedData must be on
// the reviewed list below. A new one fails here until it is reviewed - then either
// mark it `sharedData: true` or add it to the list with the reason.
const { loadCommandModules } = require("../../../src/commands/loader");
const { ruleFor, accessOwner } = require("../../../src/services/discord/botAccess");

// Reviewed: each stays on its own server (the interaction's guild) only.
const RANK_OPENS = {
    // posts the apply button into a channel of this server
    createapplication: "own server",
    // renames/archives channels of this server only (guildOf check in kanal.js)
    kanal: "own server",
    // the event family (/event, its forms, steps, pings, orga hub): raids of this server
    event: "own server",
    // loot of this server only (lootOfGuild with the interaction's server)
    council: "own server",
    // posts the raid overview of this server
    createoverview: "own server",
    // attendance of the categories of this server only (attendanceLookup, #1073)
    "anwesenheit-raider": "own server",
};

const modules = loadCommandModules();

/** The rule owner of every entry the rank opens: any rule but "everyone", no shared data. */
function rankOpenedOwners(commands) {
    const owners = new Map();
    for (const command of commands.values()) {
        // the rank passes every rule but "everyone" (role rules too), so all of them count here
        if (ruleFor(command.name, { commands, config: {} }).mode === "everyone") continue;
        const owner = accessOwner(command.name, commands) || command;
        if (command.sharedData === true || owner.sharedData === true) continue;
        const list = owners.get(owner.name) || [];
        list.push(command.name);
        owners.set(owner.name, list);
    }
    return owners;
}

describe("bot commands the rank Server-Admin opens (#1073)", () => {
    it("are all on the reviewed list - a new admins command needs sharedData or a review", () => {
        const unreviewed = [...rankOpenedOwners(modules).keys()].filter((name) => !(name in RANK_OPENS));
        expect(unreviewed).toEqual([]);
    });

    it("the list holds no stale entry: each still is an admins command without shared data", () => {
        const owners = rankOpenedOwners(modules);
        expect(Object.keys(RANK_OPENS).filter((name) => !owners.has(name))).toEqual([]);
    });

    it("the commands with a global target are marked sharedData", () => {
        for (const name of ["fillsetup", "recruitment"]) {
            expect(modules.get(name)).toBeDefined();
            expect(modules.get(name).sharedData).toBe(true);
        }
    });

    it("catches an unmarked admins command (the guard itself works)", () => {
        const withNew = new Map(modules);
        withNew.set("globalsheet", { name: "globalsheet", defaultAccess: "admins" });
        const followsIt = { name: "globalsheet-btn", accessOf: "globalsheet" };
        withNew.set(followsIt.name, followsIt);
        const owners = rankOpenedOwners(withNew);
        expect(owners.get("globalsheet")).toEqual(["globalsheet", "globalsheet-btn"]);
        withNew.set("globalsheet", { name: "globalsheet", defaultAccess: "admins", sharedData: true });
        expect(rankOpenedOwners(withNew).has("globalsheet")).toBe(false);
    });
});
