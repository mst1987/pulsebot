// The posted roster picture keeps itself current: the real stores and the real view on scratch
// files, Discord mocked. What matters is what must NOT happen - no edit without a change, none
// during an outage (the fallback names would overwrite the picture), no post after a delete.
const { tempStoreFile } = require("../../helpers/tempStore");

jest.mock("../../../src/services/discord/discord", () => ({
    isOnline: jest.fn(() => true),
    listHumanMembers: jest.fn(async () => ({ members: [], error: null })),
    listRoles: jest.fn(() => []),
    memberRoleIds: jest.fn(async () => []),
    editPayload: jest.fn(async () => ({})),
    postPayload: jest.fn(async () => ({})),
}));
jest.mock("../../../src/services/discord/discordImage", () => {
    const actual = jest.requireActual("../../../src/services/discord/discordImage");
    return { ...actual, renderPng: jest.fn(() => Buffer.from("png")) };
});
jest.mock("../../../src/services/categories/categoryNames", () => ({ listKnownCategories: jest.fn(() => [{ id: "cat1", name: "Raid Mo / Do" }]) }));
jest.mock("../../../src/services/events/eventSources", () => ({ listStoredEvents: jest.fn(() => []) }));
jest.mock("../../../src/stores/loot/logStore", () => ({ listLogs: jest.fn(() => []) }));
jest.mock("../../../src/stores/loot/reportStore", () => ({ listReports: jest.fn(() => []), getReport: jest.fn(() => null) }));
jest.mock("../../../src/stores/settings/settingsStore", () => ({
    ...jest.requireActual("../../../src/stores/settings/settingsStore"),
    getConfig: jest.fn(() => ({ categoryIds: ["cat1"] })),
}));

const discord = require("../../../src/services/discord/discord");
const discordImage = require("../../../src/services/discord/discordImage");
const rosterStore = require("../../../src/stores/roster/rosterStore");
const profiles = require("../../../src/stores/roster/raiderProfileStore");
const kaderStore = require("../../../src/stores/roster/kaderStore");
const { rosterImageModel, pictureHash } = require("../../../src/web/roster/rosterImageView");
const { buildRosterDetail } = require("../../../src/web/roster/rosterView");
const { refreshRosterImages, startRosterImageLive, stopRosterImageLive } = require("../../../src/web/roster/rosterImageLive");

const G = "g1";
const ANNA = "200000000000000001";
const BEN = "200000000000000002";
const DORA = "200000000000000003";
const CONFIG = { categoryIds: ["cat1"] };
const NOW = Date.parse("2026-11-03T12:00:00Z");
const NEXT_DAY = NOW + 86400000;

let roster;

/** The hash of the roster as it is now, as the route would have stored it. */
async function currentHash(id, { reserve = false, chars = false, text = "", now = NOW } = {}) {
    const built = await rosterImageModel({ guildId: G, id, config: CONFIG, now });
    return pictureHash(built.model, { reserve, chars, lang: built.lang, text });
}

async function postPicture(over = {}) {
    const hash = await currentHash(roster.id, over);
    rosterStore.setImagePost(roster.id, { guildId: G, channelId: "c1", messageId: "m1", reserve: false, chars: false, hash, ...over });
}

const refusal = (code) => Object.assign(new Error(`refused ${code}`), { code });

beforeAll(() => {
    rosterStore.useFile(tempStoreFile("img-live-rosters.json"));
    profiles.useFile(tempStoreFile("img-live-profiles.json"));
});
afterAll(() => {
    rosterStore.useFile(null);
    profiles.useFile(null);
});
beforeEach(() => {
    jest.clearAllMocks();
    discord.isOnline.mockReturnValue(true);
    discord.listHumanMembers.mockImplementation(async () => ({ members: [], error: null }));
    discord.editPayload.mockImplementation(async () => ({}));
    for (const r of rosterStore.listRosters("")) rosterStore.deleteRoster(r.id);
    profiles.reset();
    profiles.addCharacter(ANNA, { name: "Thorgrim", className: "Warrior", specs: [{ key: "Warrior-Protection", gear: "ready" }] }, { name: "Anna" });
    profiles.addCharacter(BEN, { name: "Devi", className: "Priest", specs: [{ key: "Priest-Holy", gear: "ready" }] }, { name: "Ben" });
    roster = rosterStore.createRoster({ guildId: G, name: "Kern", categoryId: "cat1", slots: { total: 10, tank: 2, healer: 3 } });
    rosterStore.upsertMember(roster.id, ANNA, { chars: ["Thorgrim"] });
});
afterEach(() => stopRosterImageLive());

describe("web/roster/rosterImageLive refreshRosterImages", () => {
    it("does nothing without a remembered picture, not even ask for members", async () => {
        expect(await refreshRosterImages({ now: NOW })).toEqual({ posts: 0, edited: 0, gone: 0, failed: 0 });
        expect(discord.listHumanMembers).not.toHaveBeenCalled();
        expect(discord.editPayload).not.toHaveBeenCalled();
    });

    it("leaves an unchanged roster alone and draws nothing", async () => {
        await postPicture();
        expect(await refreshRosterImages({ now: NOW })).toMatchObject({ posts: 1, edited: 0 });
        expect(discord.editPayload).not.toHaveBeenCalled();
        expect(discordImage.renderPng).not.toHaveBeenCalled();
    });

    it("reads the member list as a background job, so it never keeps a full fetch going", async () => {
        await postPicture();
        discord.listHumanMembers.mockClear();
        await refreshRosterImages({ now: NOW });
        expect(discord.listHumanMembers).toHaveBeenCalled();
        for (const call of discord.listHumanMembers.mock.calls) expect(call).toEqual([G, { background: true }]);
    });

    it("does not edit for a change the picture does not show", async () => {
        rosterStore.upsertMember(roster.id, BEN, { chars: ["Devi"], status: "pause" });
        await postPicture();
        rosterStore.upsertMember(roster.id, BEN, { status: "bench" });
        expect(await refreshRosterImages({ now: NOW })).toMatchObject({ posts: 1, edited: 0 });
        expect(discord.editPayload).not.toHaveBeenCalled();
    });

    it("does not edit because of the date alone", async () => {
        await postPicture();
        expect(await refreshRosterImages({ now: NEXT_DAY })).toMatchObject({ posts: 1, edited: 0 });
        expect(discord.editPayload).not.toHaveBeenCalled();
    });

    it("edits the same message on a change, replacing the attachment, and stores the hash", async () => {
        await postPicture();
        rosterStore.upsertMember(roster.id, BEN, { chars: ["Devi"] });
        expect(await refreshRosterImages({ now: NOW })).toMatchObject({ posts: 1, edited: 1 });
        expect(discord.editPayload).toHaveBeenCalledTimes(1);
        const [channelId, messageId, payload] = discord.editPayload.mock.calls[0];
        expect([channelId, messageId]).toEqual(["c1", "m1"]);
        expect(payload.content).toBe("Roster Kern, Stand 03.11.2026");
        expect(payload.attachments).toEqual([]);
        expect(payload.files).toHaveLength(1);
        expect(payload.files[0].name).toBe("roster.png");
        expect(discordImage.renderPng).toHaveBeenCalledTimes(1);
        expect(discord.postPayload).not.toHaveBeenCalled();
        expect(rosterStore.getRoster(roster.id).imagePost.hash).toBe(await currentHash(roster.id));
        // the next run finds nothing new
        await refreshRosterImages({ now: NOW });
        expect(discord.editPayload).toHaveBeenCalledTimes(1);
    });

    it("keeps the orga's text above the picture at every update", async () => {
        await postPicture({ text: "Heute 20 Uhr" });
        expect(await refreshRosterImages({ now: NOW })).toMatchObject({ edited: 0 });
        rosterStore.upsertMember(roster.id, BEN, { chars: ["Devi"] });
        expect(await refreshRosterImages({ now: NOW })).toMatchObject({ edited: 1 });
        expect(discord.editPayload.mock.calls[0][2].content).toBe("Heute 20 Uhr");
        expect(rosterStore.getRoster(roster.id).imagePost).toMatchObject({
            text: "Heute 20 Uhr",
            hash: await currentHash(roster.id, { text: "Heute 20 Uhr" }),
        });
    });

    it("corrects a text the hash does not know yet: a run drawing during an attachment stored the old one", async () => {
        const stale = await currentHash(roster.id);
        await postPicture({ text: "Neu", hash: stale });
        expect(await refreshRosterImages({ now: NOW })).toMatchObject({ edited: 1 });
        expect(discord.editPayload.mock.calls[0][2].content).toBe("Neu");
    });

    it("notices a change of the class the linked Kader plans for somebody without a character", async () => {
        const planner = (className, spec) => ({
            assignments: {},
            kaders: [{ id: "k1", players: { [DORA]: { state: "roster", decision: { className, spec } } } }],
        });
        const spy = jest.spyOn(kaderStore, "readPlanner").mockReturnValue(planner("Mage", "Mage-Frost"));
        try {
            rosterStore.updateRoster(roster.id, { kaderId: "k1" });
            rosterStore.upsertMember(roster.id, DORA, { status: "core" });
            await postPicture();
            expect(await refreshRosterImages({ now: NOW })).toMatchObject({ edited: 0 });
            spy.mockReturnValue(planner("Warlock", "Warlock-Destruction"));
            expect(await refreshRosterImages({ now: NOW })).toMatchObject({ edited: 1 });
        } finally {
            spy.mockRestore();
        }
    });

    it("draws with the switches of the post", async () => {
        await postPicture({ reserve: true, chars: true });
        rosterStore.upsertMember(roster.id, BEN, { chars: ["Devi"] });
        await refreshRosterImages({ now: NOW });
        expect(rosterStore.getRoster(roster.id).imagePost.hash).toBe(await currentHash(roster.id, { reserve: true, chars: true }));
        expect(rosterStore.getRoster(roster.id).imagePost).toMatchObject({ reserve: true, chars: true });
    });

    it("keeps the picture while the member list is disturbed: no fallback names in Discord", async () => {
        await postPicture();
        rosterStore.upsertMember(roster.id, BEN, { chars: ["Devi"] });
        const { hash } = rosterStore.getRoster(roster.id).imagePost;
        discord.listHumanMembers.mockImplementation(async () => ({ members: [], error: "guild not found" }));
        await refreshRosterImages({ now: NOW });
        discord.listHumanMembers.mockImplementation(async () => { throw new Error("boom"); });
        await refreshRosterImages({ now: NOW });
        expect(discord.editPayload).not.toHaveBeenCalled();
        expect(rosterStore.getRoster(roster.id).imagePost.hash).toBe(hash);
    });

    it("skips the whole run while the bot is offline", async () => {
        await postPicture();
        rosterStore.upsertMember(roster.id, BEN, { chars: ["Devi"] });
        discord.listHumanMembers.mockClear(); // postPicture asked for its hash
        discord.isOnline.mockReturnValue(false);
        expect(await refreshRosterImages({ now: NOW })).toMatchObject({ skipped: "offline", posts: 0 });
        expect(discord.listHumanMembers).not.toHaveBeenCalled();
        expect(discord.editPayload).not.toHaveBeenCalled();
    });

    it("leaves a closed roster's last picture, and goes on when it opens again", async () => {
        await postPicture();
        rosterStore.upsertMember(roster.id, BEN, { chars: ["Devi"] });
        rosterStore.closeRoster(roster.id);
        expect(await refreshRosterImages({ now: NOW })).toMatchObject({ posts: 0 });
        expect(discord.editPayload).not.toHaveBeenCalled();
        expect(rosterStore.getRoster(roster.id).imagePost).not.toBeNull();
        rosterStore.reopenRoster(roster.id);
        expect(await refreshRosterImages({ now: NOW })).toMatchObject({ posts: 1, edited: 1 });
    });

    it.each([[10008], [10003], ["channel_not_found"]])("forgets a picture Discord says is gone (%s), without posting it again", async (code) => {
        await postPicture();
        rosterStore.upsertMember(roster.id, BEN, { chars: ["Devi"] });
        discord.editPayload.mockRejectedValueOnce(refusal(code));
        expect(await refreshRosterImages({ now: NOW })).toMatchObject({ gone: 1 });
        expect(rosterStore.getRoster(roster.id).imagePost).toBeNull();
        expect(discord.postPayload).not.toHaveBeenCalled();
    });

    it.each([[50013], [50001]])("keeps a picture on a refusal of rights (%s), warns once, and tries again", async (code) => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        try {
            await postPicture();
            const { hash } = rosterStore.getRoster(roster.id).imagePost;
            rosterStore.upsertMember(roster.id, BEN, { chars: ["Devi"] });
            discord.editPayload.mockRejectedValue(refusal(code));
            expect(await refreshRosterImages({ now: NOW })).toMatchObject({ failed: 1 });
            expect(await refreshRosterImages({ now: NOW })).toMatchObject({ failed: 1 });
            expect(discord.editPayload).toHaveBeenCalledTimes(2);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(rosterStore.getRoster(roster.id).imagePost).toMatchObject({ messageId: "m1", hash });
            // back in order: drawn, and a later failure may warn again
            discord.editPayload.mockImplementation(async () => ({}));
            expect(await refreshRosterImages({ now: NOW })).toMatchObject({ edited: 1 });
            discord.editPayload.mockRejectedValue(refusal(code));
            rosterStore.upsertMember(roster.id, ANNA, { status: "trial" });
            expect(await refreshRosterImages({ now: NOW })).toMatchObject({ failed: 1 });
            expect(warn).toHaveBeenCalledTimes(2);
            // leaves no warning behind for the next test
            discord.editPayload.mockImplementation(async () => ({}));
            await refreshRosterImages({ now: NOW });
        } finally {
            warn.mockRestore();
        }
    });

    it("does not overwrite a post made while the run was at work", async () => {
        await postPicture();
        rosterStore.upsertMember(roster.id, BEN, { chars: ["Devi"] });
        discord.editPayload.mockImplementationOnce(async () => {
            rosterStore.setImagePost(roster.id, { guildId: G, channelId: "c2", messageId: "m2", hash: "fresh" });
            return {};
        });
        await refreshRosterImages({ now: NOW });
        expect(rosterStore.getRoster(roster.id).imagePost).toMatchObject({ channelId: "c2", messageId: "m2", hash: "fresh" });
    });

    it("keeps a post made meanwhile when the old message turns out gone", async () => {
        await postPicture();
        rosterStore.upsertMember(roster.id, BEN, { chars: ["Devi"] });
        discord.editPayload.mockImplementationOnce(async () => {
            rosterStore.setImagePost(roster.id, { guildId: G, channelId: "c2", messageId: "m2", hash: "fresh" });
            throw refusal(10008);
        });
        await refreshRosterImages({ now: NOW });
        expect(rosterStore.getRoster(roster.id).imagePost).toMatchObject({ messageId: "m2" });
    });

    it("never overlaps: a run during a run does nothing", async () => {
        await postPicture();
        rosterStore.upsertMember(roster.id, BEN, { chars: ["Devi"] });
        let release;
        discord.editPayload.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
        const first = refreshRosterImages({ now: NOW });
        await new Promise((resolve) => setImmediate(resolve));
        while (!release) await new Promise((resolve) => setImmediate(resolve));
        expect(await refreshRosterImages({ now: NOW })).toMatchObject({ skipped: "running" });
        release({});
        expect(await first).toMatchObject({ edited: 1 });
        expect(discord.editPayload).toHaveBeenCalledTimes(1);
    });

    it("never throws, and one roster's failure does not stop the next", async () => {
        await postPicture();
        const other = rosterStore.createRoster({ guildId: G, name: "Zwei", slots: { total: 10, tank: 2, healer: 3 } });
        rosterStore.setImagePost(other.id, { guildId: G, channelId: "c1", messageId: "m9", hash: "outdated" });
        rosterStore.setImagePost(roster.id, { guildId: G, channelId: "c1", messageId: "m1", hash: "outdated" });
        discord.editPayload.mockRejectedValueOnce(new Error("hiccup"));
        expect(await refreshRosterImages({ now: NOW })).toMatchObject({ posts: 2, failed: 1, edited: 1 });
        discord.isOnline.mockImplementation(() => { throw new Error("broken"); });
        await expect(refreshRosterImages({ now: NOW })).resolves.toMatchObject({ posts: 0 });
    });
});

describe("web/roster/rosterImageLive what readers get", () => {
    it("never hands out the remembered post in a roster's detail view", async () => {
        await postPicture();
        for (const user of [null, { id: "9", name: "Leser", isAdmin: false }, { id: "1", name: "Admin", isAdmin: true }]) {
            const text = JSON.stringify(await buildRosterDetail({ guildId: G, id: roster.id, user, config: CONFIG }));
            expect(text).not.toContain("imagePost");
            expect(text).not.toContain(rosterStore.getRoster(roster.id).imagePost.hash);
        }
    });
});

describe("web/roster/rosterImageLive timer", () => {
    it("runs first after the delay, then on the interval; a second start changes nothing, stop ends it", async () => {
        jest.useFakeTimers();
        try {
            const stop = startRosterImageLive({ firstDelayMs: 1000, intervalMs: 500 });
            expect(startRosterImageLive()).toBe(stop);
            expect(discord.isOnline).not.toHaveBeenCalled();
            await jest.advanceTimersByTimeAsync(1000);
            expect(discord.isOnline).toHaveBeenCalledTimes(1);
            await jest.advanceTimersByTimeAsync(500);
            expect(discord.isOnline).toHaveBeenCalledTimes(2);
            stopRosterImageLive();
            await jest.advanceTimersByTimeAsync(5000);
            expect(discord.isOnline).toHaveBeenCalledTimes(2);
            stopRosterImageLive();
        } finally {
            jest.useRealTimers();
        }
    });

    it("stops before the first run too", async () => {
        jest.useFakeTimers();
        try {
            startRosterImageLive({ firstDelayMs: 1000 });
            stopRosterImageLive();
            await jest.advanceTimersByTimeAsync(5000);
            expect(discord.isOnline).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });
});
