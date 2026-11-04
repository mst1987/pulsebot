// The words of the Twitch section: status, filter, results, errors, the form's limits.
import { describe, expect, it } from "vitest";
import { inLang } from "../../../test/i18n";
import type { ApiError, TwitchStreamerStatus } from "../../../api";
import {
    addTwitchGame, twitchCheckText, twitchErrorText, twitchFilterText, twitchLastRunText, twitchRoleWontPing, twitchStatusRank, twitchStatusWords, twitchUrl,
} from "../twitch";

describe("twitchRoleWontPing", () => {
    const mention = (botCanMentionAll: boolean | null, unmentionableRoleIds: string[] = ["r1"]) => ({ botCanMentionAll, unmentionableRoleIds });

    it("warns only when the role is listed and the bot certainly lacks the right", () => {
        expect(twitchRoleWontPing(mention(false), "r1")).toBe(true);
        expect(twitchRoleWontPing(mention(true), "r1")).toBe(false);
        expect(twitchRoleWontPing(mention(false), "r2")).toBe(false);
    });

    it("stays quiet when nothing is known or no role is chosen", () => {
        expect(twitchRoleWontPing(mention(null), "r1")).toBe(false);
        expect(twitchRoleWontPing(mention(false), "")).toBe(false);
    });
});

const LIMITS = { streamers: 25, textLength: 500, games: 5, gameNameLength: 60 };
const NOW = new Date("2026-11-03T21:00:00").getTime();

const status = (over: Partial<TwitchStreamerStatus> = {}): TwitchStreamerStatus => ({
    state: "offline", since: "", endedAt: 0, title: "", game: "", viewers: 0, messageGone: false, error: "", postedChannelId: "", ...over,
});
const apiError = (code: string, message = "Server sagt nein") => Object.assign(new Error(message), { code }) as ApiError;

describe("twitchStatusWords", () => {
    it("says since when a stream runs and keeps title, game and viewers for the tooltip", () => {
        const words = twitchStatusWords(status({
            state: "live", since: "2026-11-03T20:14:00", title: "Karazhan", game: "World of Warcraft", viewers: 1,
        }), NOW);
        expect(words.tone).toBe("live");
        expect(words.text).toContain("20:14");
        expect(words.text).toMatch(/^Live/);
        expect(words.details).toHaveLength(3);
        expect(words.details.join(" ")).toContain("Karazhan");
        expect(words.details.join(" ")).toContain("World of Warcraft");
        expect(words.details[2]).toMatch(/1 /);
    });

    it("carries the date once the stream started on another day", () => {
        const words = twitchStatusWords(status({ state: "live", since: "2026-11-02T20:14:00" }), NOW);
        expect(words.text).toContain("02.11");
    });

    it("words a live stream without a usable start and one outside the filter", () => {
        expect(twitchStatusWords(status({ state: "live" }), NOW).text).toBe("Live");
        const filtered = twitchStatusWords(status({ state: "filtered", game: "Chess" }), NOW);
        expect(filtered.tone).toBe("muted");
        expect(filtered.text).toContain("Filter");
    });

    it("shows offline with the end of the last stream only in the details", () => {
        expect(twitchStatusWords(status(), NOW)).toEqual({ tone: "muted", text: "Offline", details: [] });
        const ended = twitchStatusWords(status({ endedAt: new Date("2026-11-03T19:00:00").getTime() }), NOW);
        expect(ended.text).toBe("Offline");
        expect(ended.details[0]).toContain("19:00");
    });

    it.each(["channel_gone", "no_permission", "wrong_guild", "post_failed", "end_gave_up"])("words the error %s, and it wins over the state", (code) => {
        const words = twitchStatusWords(status({ state: "live", since: "2026-11-03T20:14:00", error: code }), NOW);
        expect(words.tone).toBe("bad");
        expect(words.text).not.toContain(code);
        expect(words.text).not.toBe("");
    });

    it("never hides an error code it does not know", () => {
        expect(twitchStatusWords(status({ error: "brand_new" }), NOW).text).toContain("brand_new");
    });
});

describe("twitchStatusRank", () => {
    it("puts errors first, then what runs, then what is filtered, then offline", () => {
        expect(twitchStatusRank(status({ state: "live", error: "post_failed" }))).toBeLessThan(twitchStatusRank(status({ state: "live" })));
        expect(twitchStatusRank(status({ state: "live" }))).toBeLessThan(twitchStatusRank(status({ state: "filtered" })));
        expect(twitchStatusRank(status({ state: "filtered" }))).toBeLessThan(twitchStatusRank(status()));
    });
});

describe("twitchFilterText", () => {
    it("names no filter, one game, or the first game plus a count in words", () => {
        expect(twitchFilterText(["World of Warcraft"])).toBe("World of Warcraft");
        expect(twitchFilterText([])).not.toBe("");
        const two = twitchFilterText(["World of Warcraft", "Chess"]);
        expect(two).toContain("World of Warcraft");
        expect(two).toMatch(/1 \S+/);
        expect(twitchFilterText(["A", "B", "C"])).toMatch(/2 \S+/);
    });
});

describe("twitchCheckText", () => {
    it("reports the count with a word", () => {
        const done = twitchCheckText({ checked: 3, live: 1 });
        expect(done.ok).toBe(true);
        expect(done.text).toMatch(/3 \S+/);
        expect(done.text).toMatch(/1 \S+/);
    });

    it.each(["no_credentials", "bot_offline", "rate_limited", "twitch_unavailable", "failed"] as const)("words the skipped run %s", (skipped) => {
        const words = twitchCheckText({ skipped });
        expect(words.ok).toBe(false);
        expect(words.text).not.toContain(skipped);
        expect(words.text).not.toBe("");
    });
});

describe("twitchLastRunText", () => {
    it("stays empty before the first run of this process", () => {
        expect(twitchLastRunText({ at: 0, error: "" }, NOW)).toBe("");
    });

    it("gives the time, with the reason when the run got no answer", () => {
        const at = new Date("2026-11-03T20:14:00").getTime();
        expect(twitchLastRunText({ at, error: "" }, NOW)).toContain("20:14");
        const failed = twitchLastRunText({ at, error: "rate_limited" }, NOW);
        expect(failed).toContain("20:14");
        expect(failed).not.toContain("rate_limited");
        expect(twitchLastRunText({ at, error: "brand_new" }, NOW)).not.toContain("brand_new");
    });
});

describe("twitchErrorText", () => {
    it.each(["invalid_login", "duplicate_streamer", "missing_channel", "invalid_role", "text_too_long", "too_many", "too_many_games", "invalid_list", "not_found", "other_server", "no_active_server", "server_switched", "unknown_server"])("has its own words for %s", (code) => {
        const words = twitchErrorText(apiError(code));
        expect(words).not.toContain(code);
        expect(words).not.toBe("Server sagt nein");
    });

    it("has them in English too, the server's own messages are German only", async () => {
        const german = twitchErrorText(apiError("invalid_login"));
        const english = await inLang("en", () => twitchErrorText(apiError("invalid_login")));
        expect(english).not.toBe(german);
        expect(english).toMatch(/Twitch|name|link/i);
    });

    it("falls back to the server's message for anything else", () => {
        expect(twitchErrorText(apiError("no_idea"))).toBe("Server sagt nein");
    });
});

describe("addTwitchGame", () => {
    it("adds a trimmed name and ignores an empty input", () => {
        expect(addTwitchGame([], "  World of Warcraft ", LIMITS)).toEqual({ games: ["World of Warcraft"], error: "" });
        expect(addTwitchGame(["A"], "   ", LIMITS)).toEqual({ games: ["A"], error: "" });
    });

    it("refuses a name that is too long instead of letting the server cut it", () => {
        const refused = addTwitchGame([], "x".repeat(61), LIMITS);
        expect(refused.games).toEqual([]);
        expect(refused.error).toContain("60");
        expect(addTwitchGame([], "x".repeat(60), LIMITS).error).toBe("");
    });

    it("refuses a duplicate regardless of case, and a sixth name", () => {
        expect(addTwitchGame(["World of Warcraft"], "world of warcraft", LIMITS).error).not.toBe("");
        const full = ["a", "b", "c", "d", "e"];
        const refused = addTwitchGame(full, "f", LIMITS);
        expect(refused.games).toEqual(full);
        expect(refused.error).toContain("5");
    });
});

describe("twitchUrl", () => {
    it("links the channel", () => {
        expect(twitchUrl("somebody")).toBe("https://www.twitch.tv/somebody");
    });
});
