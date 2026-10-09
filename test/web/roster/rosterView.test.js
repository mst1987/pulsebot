// The roster pages' views (src/web/roster/rosterView.js, #654): cards with the
// figures, the members with characters from the profile, the Discord role and
// the attendance per person, everything best-effort without Discord.
jest.mock("../../../src/services/discord/discord", () => ({
    listHumanMembers: jest.fn(async () => ({ members: [], error: null })),
    listRoles: jest.fn(() => []),
    memberRoleIds: jest.fn(async () => []),
}));
jest.mock("../../../src/services/discord/categoryNames", () => ({
    listKnownCategories: jest.fn(() => [{ id: "cat1", name: "Raid Mo / Do" }, { id: "cat2", name: "PuG Karazhan" }]),
}));
jest.mock("../../../src/services/events/eventSources", () => ({ listStoredEvents: jest.fn(() => []) }));
jest.mock("../../../src/stores/logStore", () => ({ listLogs: jest.fn(() => []) }));
jest.mock("../../../src/stores/reportStore", () => ({ listReports: jest.fn(() => []), getReport: jest.fn(() => null) }));

const discord = require("../../../src/services/discord/discord");
const { listKnownCategories } = require("../../../src/services/discord/categoryNames");
const { listStoredEvents } = require("../../../src/services/events/eventSources");
const rosterStore = require("../../../src/stores/rosterStore");
const profiles = require("../../../src/stores/raiderProfileStore");
const characterStore = require("../../../src/stores/characterStore");
const { tempStoreFile } = require("../../helpers/tempStore");
const { buildRosterOverview, buildRosterDetail, rosterFigures } = require("../../../src/web/roster/rosterView");

const G = "g1";
const ANNA = "200000000000000001";
const BERT = "200000000000000002";
const CARL = "200000000000000003";
const DORA = "200000000000000004";
const ADMIN = { id: "1", name: "Admin", isAdmin: true };
const READER = { id: "9", name: "Leser", isAdmin: false };
const CONFIG = { categoryIds: ["cat1", "cat2"] };

/** A raid night of cat1 with signups (seconds, like every stored event). */
const night = (id, startTime, signUps) => ({ id, categoryId: "cat1", guildId: G, title: "Raid", startTime, signUps });

let count = 0;
beforeEach(() => {
    jest.clearAllMocks();
    count += 1;
    rosterStore.useFile(tempStoreFile(`rosters-${count}.json`));
    profiles.useFile(tempStoreFile(`profiles-${count}.json`));
    characterStore.useFile(tempStoreFile(`characters-${count}.json`));
    profiles.addCharacter(ANNA, { name: "Thorgrim", className: "Warrior", specs: [{ key: "Warrior-Protection", gear: "ready" }] }, { name: "Anna" });
    profiles.addCharacter(BERT, { name: "Lunaria", className: "Paladin", specs: [{ key: "Paladin-Holy", gear: "ready" }] }, { name: "Bert" });
    characterStore.saveCharacter("Shadowfang", { className: "Rogue", spec: "Combat", source: "export" });
    const r = rosterStore.createRoster({ guildId: G, name: "Raid Mo / Do", categoryId: "cat1", roleIds: ["role-main"], slots: { total: 25, tank: 3, healer: 7 } });
    rosterStore.upsertMember(r.id, ANNA, { chars: ["Thorgrim"] }, { now: "2026-05-12T18:00:00.000Z" });
    rosterStore.upsertMember(r.id, BERT, { chars: ["Lunaria"], status: "trial" });
    rosterStore.upsertMember(r.id, CARL, { chars: ["Shadowfang"], status: "bench" });
    rosterStore.upsertMember(r.id, DORA, { status: "pause" });
    discord.listRoles.mockReturnValue([{ id: "role-main", name: "Raider Mo/Do", color: "#e67e22" }]);
    discord.listHumanMembers.mockResolvedValue({
        error: null,
        members: [
            { id: ANNA, displayName: "Anna Discord", avatarUrl: "https://cdn/a.png", roleIds: ["role-main"] },
            { id: BERT, displayName: "Bert", avatarUrl: null, roleIds: [] },
            { id: CARL, displayName: "Carl", avatarUrl: null, roleIds: ["role-main"] },
        ],
    });
    listStoredEvents.mockReturnValue([
        night("e1", 1900000000, [{ userId: ANNA, status: "signed", character: "Thorgrim" }, { userId: BERT, status: "absence" }]),
        night("e2", 1900600000, [{ userId: ANNA, status: "signed", character: "Thorgrim" }, { userId: BERT, status: "signed" }]),
    ]);
});
afterAll(() => {
    rosterStore.useFile(null);
    profiles.useFile(null);
    characterStore.useFile(null);
});

const rosterId = () => rosterStore.listRosters(G)[0].id;

describe("buildRosterOverview", () => {
    it("answers one card per roster with places, roles, attendance and the open tasks", async () => {
        const view = await buildRosterOverview({ guildId: G, user: ADMIN, config: CONFIG });
        expect(view.canCreate).toBe(true);
        expect(view.rosters).toHaveLength(1);
        const card = view.rosters[0];
        expect(card).toMatchObject({
            name: "Raid Mo / Do", categoryId: "cat1", categoryName: "Raid Mo / Do", versionId: "tbc", versionLabel: "TBC",
            mainRole: { id: "role-main", name: "Raider Mo/Do", color: "#e67e22" },
            slots: { total: 25, tank: 3, healer: 7, bench: 0 },
            counts: { core: 1, trial: 1, bench: 1, pause: 1 },
            members: 4,
            places: 2,
            roleCounts: { tank: 1, healer: 1, dps: 0, unknown: 0 },
            // Anna 2/2, Bert 1/2 (signed off once); Carl has no signup and no log -> "keine Anmeldung" 0/2
            attendance: 50,
            attendanceCounted: 3,
            // Bert and Dora lack the role (Dora is not on the server), Dora has no character, Bert is on trial
            todo: { withoutRole: 2, withoutChar: 1, trial: 1 },
        });
        expect(card.raids).toBe(2);
        expect(card.icon).toBeTruthy();
    });

    it("names the trials ending within a week or overdue on the card (#658)", async () => {
        expect((await buildRosterOverview({ guildId: G, user: ADMIN, config: CONFIG })).rosters[0].trialEnding).toEqual([]);
        const until = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
        rosterStore.upsertMember(rosterId(), BERT, { trialUntil: until });
        const view = await buildRosterOverview({ guildId: G, user: ADMIN, config: CONFIG });
        expect(view.rosters[0].trialEnding).toEqual([{ userId: BERT, displayName: "Bert", trialUntil: until, overdue: false }]);
    });

    it("lists the categories without a roster and leaves another server's out", async () => {
        const view = await buildRosterOverview({ guildId: G, user: READER, config: { categoryIds: ["cat1", "cat2", "other-guild"] } });
        expect(view.canCreate).toBe(false);
        expect(view.categoriesWithoutRoster).toEqual([{ id: "cat2", name: "PuG Karazhan", versionId: "tbc", versionLabel: "TBC" }]);
    });

    it("keeps working without Discord: role unknown, names from the profile", async () => {
        discord.listHumanMembers.mockResolvedValue({ members: [], error: "offline" });
        discord.listRoles.mockReturnValue([]);
        listKnownCategories.mockReturnValue([]);
        const view = await buildRosterOverview({ guildId: G, user: ADMIN, config: CONFIG });
        expect(view.rosters[0].todo.withoutRole).toBeNull();
        expect(view.rosters[0].mainRole).toEqual({ id: "role-main", name: "", color: "" });
        const detail = await buildRosterDetail({ guildId: G, id: rosterId(), user: ADMIN, config: CONFIG });
        expect(detail.membersKnown).toBe(false);
        expect(detail.members.find((m) => m.userId === ANNA)).toMatchObject({ displayName: "Anna", hasRole: null, onServer: null });
    });
});

describe("buildRosterDetail", () => {
    it("resolves every member: identity, characters from the profile or the cache, role, Discord role, attendance", async () => {
        const view = await buildRosterDetail({ guildId: G, id: rosterId(), user: ADMIN, config: CONFIG });
        expect(view.canManage).toBe(true);
        expect(view.window).toBe(11);
        const anna = view.members.find((m) => m.userId === ANNA);
        expect(anna).toMatchObject({
            displayName: "Anna Discord", avatarUrl: "https://cdn/a.png", onServer: true, status: "core",
            since: "2026-05-12T18:00:00.000Z", role: "tank", hasRole: true,
            attendance: { attended: 2, total: 2, pct: 100 },
        });
        expect(anna.chars).toEqual([{
            key: "thorgrim", name: "Thorgrim", className: "Warrior", classColor: "#C79C6E",
            spec: "Warrior-Protection", specId: "Protection", specLabel: "Schutz", specIcon: "ability_warrior_defensivestance", iconUrl: "", role: "tank",
        }]);
        expect(anna.attendance.present.map((n) => n.eventId)).toEqual(["e2", "e1"]);
        // #677: every night with its status code; the grid's columns and who may edit them
        expect(anna.attendance.present[0]).toMatchObject({ status: "present" });
        expect(anna.attendance.present[0]).not.toHaveProperty("attended");
        expect(view.nights.map((n) => n.eventId)).toEqual(["e2", "e1"]);
        expect(view.canEditAttendance).toBe(true);

        const bert = view.members.find((m) => m.userId === BERT);
        expect(bert).toMatchObject({ status: "trial", role: "healer", hasRole: false, attendance: { attended: 1, total: 2, pct: 50 } });
        expect(bert.attendance.missed[0]).toMatchObject({ eventId: "e1", status: "absence", reason: "abgemeldet" });

        // no profile: class and spec from the logs (character cache), as the Komposition counts him
        const carl = view.members.find((m) => m.userId === CARL);
        expect(carl.chars[0]).toMatchObject({ name: "Shadowfang", className: "Rogue", spec: "Rogue-Combat", specLabel: "Kampf", specIcon: "ability_backstab", iconUrl: "", role: "dps" });
        expect(carl.resolved).toMatchObject({ className: "Rogue", spec: "Rogue-Combat", source: "logs", reason: "", role: "dps" });
        expect(anna.resolved).toMatchObject({ spec: "Warrior-Protection", source: "profile", override: "" });

        const dora = view.members.find((m) => m.userId === DORA);
        expect(dora).toMatchObject({ displayName: DORA, onServer: false, hasRole: false, chars: [], role: "", attendance: null });
    });

    it("sorts the members by name and says who may manage", async () => {
        const view = await buildRosterDetail({ guildId: G, id: rosterId(), user: READER, config: CONFIG });
        expect(view.canManage).toBe(false);
        expect(view.canEditAttendance).toBe(false);
        expect(view.members.map((m) => m.displayName)).toEqual(["200000000000000004", "Anna Discord", "Bert", "Carl"].sort((a, b) => a.localeCompare(b)));
    });

    it("adds for a manager the notes, the further profile characters, the held roles and the settings", async () => {
        const id = rosterId();
        rosterStore.updateRoster(id, { trialRoleId: "role-trial", managers: { userIds: [ANNA, "300000000000000009"], roleIds: ["role-lead"] }, signupOnly: true });
        rosterStore.upsertMember(id, ANNA, { note: "Kann Hexer" });
        profiles.addCharacter(ANNA, { name: "Grimbrew", className: "Druid", specs: [{ key: "Druid-Feral", gear: "usable" }] });
        discord.listHumanMembers.mockResolvedValue({
            error: null,
            members: [{ id: ANNA, displayName: "Anna Discord", roleIds: ["role-main", "role-trial", "other"] }, { id: BERT, displayName: "Bert", roleIds: ["role-trial"] }],
        });
        discord.listRoles.mockReturnValue([{ id: "role-main", name: "Raider Mo/Do", color: "#e67e22" }, { id: "role-trial", name: "Probe", color: "" }]);
        const view = await buildRosterDetail({ guildId: G, id, user: ADMIN, config: CONFIG });
        expect(view.isAdmin).toBe(true);
        expect(view.roster.trialRole).toEqual({ id: "role-trial", name: "Probe", color: "" });
        const anna = view.members.find((m) => m.userId === ANNA);
        expect(anna).toMatchObject({ note: "Kann Hexer", heldRoles: ["role-main", "role-trial"] });
        expect(anna.otherChars.map((c) => [c.name, c.className, c.specId])).toEqual([["Grimbrew", "Druid", "Feral"]]);
        expect(view.members.find((m) => m.userId === BERT).heldRoles).toEqual(["role-trial"]);
        expect(view.members.find((m) => m.userId === DORA)).toMatchObject({ heldRoles: [], otherChars: [], note: "" });
        expect(view.settings).toEqual({
            categoryId: "cat1", versionId: "tbc", roleIds: ["role-main"], trialRoleId: "role-trial",
            managers: { roleIds: ["role-lead"], userIds: [ANNA, "300000000000000009"], users: [{ userId: ANNA, displayName: "Anna Discord" }, { userId: "300000000000000009", displayName: "300000000000000009" }] },
            signupOnly: true, allowMultipleChars: false, slots: { total: 25, tank: 3, healer: 7, bench: 0 }, kaderId: null,
        });
        // the drawer's spec picker: the specs of the first character's class
        expect(anna.specChoices.map((s) => s.key)).toEqual(["Warrior-Arms", "Warrior-Fury", "Warrior-Protection"]);
        expect(view.roster.kader).toBeNull();
    });

    it("uses the orga's spec for the first character in the table, the role and the cards (#roster-comp)", async () => {
        const id = rosterId();
        profiles.addCharacter(BERT, { name: "Lunaria", className: "Paladin", specs: [{ key: "Paladin-Holy" }, { key: "Paladin-Retribution" }] });
        rosterStore.upsertMember(id, BERT, { spec: "Paladin-Retribution" });
        const view = await buildRosterDetail({ guildId: G, id, user: ADMIN, config: CONFIG });
        const bert = view.members.find((m) => m.userId === BERT);
        expect(bert.role).toBe("dps");
        expect(bert.chars[0]).toMatchObject({ spec: "Paladin-Retribution", role: "dps" });
        expect(bert.resolved).toMatchObject({ source: "override", override: "Paladin-Retribution", auto: { spec: "Paladin-Holy", source: "profile" } });
        expect(view.roster.roleCounts).toEqual({ tank: 1, healer: 0, dps: 1, unknown: 0 });
    });

    it("keeps notes, further characters and settings from a reader; held roles unknown without the member list", async () => {
        rosterStore.upsertMember(rosterId(), ANNA, { note: "geheim" });
        let view = await buildRosterDetail({ guildId: G, id: rosterId(), user: READER, config: CONFIG });
        expect(view.settings).toBeNull();
        expect(view.isAdmin).toBe(false);
        const anna = view.members.find((m) => m.userId === ANNA);
        expect(anna.note).toBeUndefined();
        expect(anna.otherChars).toBeUndefined();
        expect(JSON.stringify(view)).not.toContain("geheim");
        discord.listHumanMembers.mockResolvedValue({ members: [], error: "offline" });
        view = await buildRosterDetail({ guildId: G, id: rosterId(), user: READER, config: CONFIG });
        expect(view.members.find((m) => m.userId === ANNA).heldRoles).toBeNull();
    });

    it("lets a manager of the roster manage it", async () => {
        rosterStore.updateRoster(rosterId(), { managers: { userIds: [READER.id] } });
        const view = await buildRosterDetail({ guildId: G, id: rosterId(), user: READER, config: CONFIG });
        expect(view.canManage).toBe(true);
    });

    it("counts attendance over the category's own window", async () => {
        const view = await buildRosterDetail({ guildId: G, id: rosterId(), user: ADMIN, config: { ...CONFIG, categoryAttendance: { cat1: { window: 4 } } } });
        expect(view.window).toBe(4);
    });

    it("is null for an unknown roster or one of another server", async () => {
        expect(await buildRosterDetail({ guildId: G, id: "nope", user: ADMIN, config: CONFIG })).toBeNull();
        expect(await buildRosterDetail({ guildId: "g2", id: rosterId(), user: ADMIN, config: CONFIG })).toBeNull();
    });

    it("gives a roster without category no attendance", async () => {
        const r = rosterStore.createRoster({ guildId: G, name: "PuG-Pool" });
        rosterStore.upsertMember(r.id, ANNA, { chars: ["Thorgrim"] });
        const view = await buildRosterDetail({ guildId: G, id: r.id, user: ADMIN, config: CONFIG });
        expect(view.window).toBeNull();
        expect(view).toMatchObject({ nights: [], canEditAttendance: false });
        expect(view.roster).toMatchObject({ categoryId: null, categoryName: "", contents: [], raids: 0 });
        expect(view.members[0].attendance).toBeNull();
    });
});

describe("rosterFigures", () => {
    it("counts places, roles and tasks; the attendance average leaves paused members out", () => {
        const row = (status, role, pct, extra = {}) => ({ status, role, chars: role ? [{}] : [], hasRole: true, attendance: pct === null ? null : { pct }, ...extra });
        const f = rosterFigures([row("core", "tank", 100), row("core", "", 80), row("trial", "dps", 60), row("pause", "dps", 0), row("bench", "healer", null, { hasRole: false })]);
        expect(f).toMatchObject({
            counts: { core: 2, trial: 1, bench: 1, pause: 1 }, places: 3, members: 5,
            roleCounts: { tank: 1, healer: 0, dps: 1, unknown: 1 },
            attendance: 80, attendanceCounted: 3,
            todo: { withoutRole: 1, withoutChar: 1, trial: 1 },
        });
        expect(rosterFigures([]).attendance).toBeNull();
    });
});
