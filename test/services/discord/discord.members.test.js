// The member list behind the raid detail, roster, dashboard and settings pages
// (discord.fetchGuildMembersCached): stale-while-revalidate per guild, fetches
// shared between parallel callers, a hard limit for how old a served list may
// be, `{ fresh: true }` for the role-sync jobs, and the warm-up at bot start.
const discord = require("../../../src/services/discord/discord.js");
const dc = require("../../helpers/discordClient");

const { MEMBERS_CACHE_TTL_MS: TTL, MEMBERS_STALE_MAX_MS: STALE_MAX } = discord;

/** A promise with its resolve/reject outside, to answer a fetch when the test says so. */
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/** What guild.members.fetch() resolves with: a Collection-like map of members. */
const listOf = (...ids) => new Map(ids.map((id) => [id, dc.makeMember({ id, displayName: `M${id}` })]));
const idsOf = (members) => members.map((m) => m.id);

/** A guild whose every members.fetch() hands out the next deferred answer. */
function guildWithAnswers() {
    const answers = [];
    const guild = dc.makeGuild({ id: "g1" });
    guild.members.fetch = jest.fn(() => {
        const d = deferred();
        answers.push(d);
        return d.promise;
    });
    return { guild, answers };
}

/** A guild whose members.fetch() resolves at once with the given ids, call by call. */
function guildAnswering(...lists) {
    const guild = dc.makeGuild({ id: "g1" });
    guild.members.fetch = jest.fn();
    for (const ids of lists) guild.members.fetch.mockResolvedValueOnce(listOf(...ids));
    return guild;
}

let warn;
beforeEach(() => {
    discord._resetMembersCacheForTests();
    jest.useFakeTimers({ now: 1_000_000_000 });
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
    jest.useRealTimers();
    warn.mockRestore();
});

describe("fetchGuildMembersCached: stale-while-revalidate", () => {
    it("serves a fresh list without asking Discord again", async () => {
        const guild = guildAnswering(["1"]);
        await discord.fetchGuildMembersCached("g1", guild);
        jest.advanceTimersByTime(TTL - 1);
        expect(idsOf(await discord.fetchGuildMembersCached("g1", guild))).toEqual(["1"]);
        expect(guild.members.fetch).toHaveBeenCalledTimes(1);
    });

    it("serves a stale list at once and refreshes it once in the background", async () => {
        const { guild, answers } = guildWithAnswers();
        const first = discord.fetchGuildMembersCached("g1", guild);
        answers[0].resolve(listOf("1"));
        await first;

        jest.advanceTimersByTime(TTL);
        // the refresh is still out — the caller does not wait for it
        expect(idsOf(await discord.fetchGuildMembersCached("g1", guild))).toEqual(["1"]);
        expect(idsOf(await discord.fetchGuildMembersCached("g1", guild))).toEqual(["1"]);
        expect(guild.members.fetch).toHaveBeenCalledTimes(2); // one refresh for both reads

        answers[1].resolve(listOf("1", "2"));
        await Promise.resolve();
        await Promise.resolve();
        expect(idsOf(await discord.fetchGuildMembersCached("g1", guild))).toEqual(["1", "2"]);
        expect(guild.members.fetch).toHaveBeenCalledTimes(2); // the refreshed list is fresh again
    });

    it("lets parallel callers share the first (cold) fetch", async () => {
        const { guild, answers } = guildWithAnswers();
        const reads = [1, 2, 3].map(() => discord.fetchGuildMembersCached("g1", guild));
        expect(guild.members.fetch).toHaveBeenCalledTimes(1);
        answers[0].resolve(listOf("1"));
        const lists = await Promise.all(reads);
        expect(lists.map(idsOf)).toEqual([["1"], ["1"], ["1"]]);
    });

    it("keeps the old list when the background refresh fails, logs it and tries again on the next read", async () => {
        const guild = guildAnswering(["1"]);
        await discord.fetchGuildMembersCached("g1", guild);
        jest.advanceTimersByTime(TTL);
        guild.members.fetch.mockRejectedValueOnce(new Error("Members didn't arrive in time."));

        expect(idsOf(await discord.fetchGuildMembersCached("g1", guild))).toEqual(["1"]);
        await jest.advanceTimersByTimeAsync(0);
        expect(warn).toHaveBeenCalledWith("[warn] [discord]", expect.stringContaining("member list refresh of g1 failed"), "Members didn't arrive in time.");

        guild.members.fetch.mockResolvedValueOnce(listOf("1", "3"));
        expect(idsOf(await discord.fetchGuildMembersCached("g1", guild))).toEqual(["1"]); // the failure was not cached
        await jest.advanceTimersByTimeAsync(0);
        expect(idsOf(await discord.fetchGuildMembersCached("g1", guild))).toEqual(["1", "3"]);
        expect(guild.members.fetch).toHaveBeenCalledTimes(3);
    });

    it("waits for a new list once the cached one is older than the hard limit", async () => {
        const { guild, answers } = guildWithAnswers();
        const first = discord.fetchGuildMembersCached("g1", guild);
        answers[0].resolve(listOf("1"));
        await first;

        jest.advanceTimersByTime(STALE_MAX);
        let done = false;
        const read = discord.fetchGuildMembersCached("g1", guild).then((m) => { done = true; return m; });
        await Promise.resolve();
        expect(done).toBe(false);
        answers[1].resolve(listOf("2"));
        expect(idsOf(await read)).toEqual(["2"]);
    });

    it("throws a failed fetch the caller has to wait for", async () => {
        const guild = dc.makeGuild({ id: "g1" });
        guild.members.fetch = jest.fn().mockRejectedValue(new Error("Used disallowed intents"));
        await expect(discord.fetchGuildMembersCached("g1", guild)).rejects.toThrow(/disallowed intents/);
        await expect(discord.fetchGuildMembersCached("g1", guild)).rejects.toThrow(/disallowed intents/);
        expect(guild.members.fetch).toHaveBeenCalledTimes(2);
    });

    it("{ fresh: true } waits for a list fetched now, even when a fresh one is cached", async () => {
        const guild = guildAnswering(["1"], ["1", "2"]);
        await discord.fetchGuildMembersCached("g1", guild);
        const fresh = await discord.fetchGuildMembersCached("g1", guild, { fresh: true });
        expect(idsOf(fresh)).toEqual(["1", "2"]);
        expect(guild.members.fetch).toHaveBeenCalledTimes(2);
        // and the pages get that list from then on
        expect(idsOf(await discord.fetchGuildMembersCached("g1", guild))).toEqual(["1", "2"]);
    });

    it("{ fresh: true } joins a fetch that is already running instead of starting a second one", async () => {
        const { guild, answers } = guildWithAnswers();
        const page = discord.fetchGuildMembersCached("g1", guild);
        const job = discord.fetchGuildMembersCached("g1", guild, { fresh: true });
        expect(guild.members.fetch).toHaveBeenCalledTimes(1);
        answers[0].resolve(listOf("1"));
        expect((await Promise.all([page, job])).map(idsOf)).toEqual([["1"], ["1"]]);
    });

    it("keeps guilds apart and caps every fetch at 25 s", async () => {
        const a = guildAnswering(["1"]);
        const b = guildAnswering(["9"]);
        expect(idsOf(await discord.fetchGuildMembersCached("g1", a))).toEqual(["1"]);
        expect(idsOf(await discord.fetchGuildMembersCached("g2", b))).toEqual(["9"]);
        expect(a.members.fetch).toHaveBeenCalledWith({ time: 25000 });
    });
});

describe("warmGuildMembers", () => {
    it("fetches the given guilds in the background, so the first page finds them cached", async () => {
        const guild = guildAnswering(["1"]);
        discord.setClient(dc.makeClient({ guilds: [["g1", guild]] }));
        await discord.warmGuildMembers(["g1", "g1", "", "unknown"]);
        expect(guild.members.fetch).toHaveBeenCalledTimes(1);
        expect(idsOf(await discord.fetchGuildMembersCached("g1", guild))).toEqual(["1"]);
        expect(guild.members.fetch).toHaveBeenCalledTimes(1);
    });

    it("never rejects: a failed warm-up is logged and the next read fetches", async () => {
        const guild = dc.makeGuild({ id: "g1" });
        guild.members.fetch = jest.fn().mockRejectedValueOnce(new Error("no intent")).mockResolvedValueOnce(listOf("1"));
        discord.setClient(dc.makeClient({ guilds: [["g1", guild]] }));
        await expect(discord.warmGuildMembers(["g1"])).resolves.toEqual([undefined]);
        expect(warn).toHaveBeenCalledWith("[warn] [discord]", expect.stringContaining("warm-up of g1 failed"), "no intent");
        expect(idsOf(await discord.fetchGuildMembersCached("g1", guild))).toEqual(["1"]);
    });

    it("does nothing without guilds", async () => {
        await expect(discord.warmGuildMembers()).resolves.toEqual([]);
    });
});
