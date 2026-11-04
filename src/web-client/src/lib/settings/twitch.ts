// The words of the Twitch section (Einstellungen › Server › Twitch, docs/twitch.md): the
// server sends codes and raw values, what a reader sees is put together here in the
// active language. Also the form's own limits: the server cuts a too long game name
// silently, so the form refuses it first.
import { t, tOr } from "../../i18n";
import { formatDateTime, formatTime } from "../format";
import type { ApiError, TwitchCheckResult, TwitchLimits, TwitchMention, TwitchStreamerStatus } from "../../api";

export const TWITCH_PLACEHOLDERS = "{streamer} {title} {game} {url}";

export const twitchUrl = (login: string) => `https://www.twitch.tv/${login}`;

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** A clock time today, with the date from yesterday on. */
function moment(ms: number, now = Date.now()): string {
    return sameDay(new Date(ms), new Date(now)) ? formatTime(ms) : formatDateTime(ms);
}

export type TwitchStatusWords = {
    tone: "live" | "bad" | "muted";
    text: string;
    /** Title, game and viewers, or when the last stream ended. */
    details: string[];
};

/** A status in words; an error always wins, it is what the orga has to act on. */
export function twitchStatusWords(status: TwitchStreamerStatus, now = Date.now()): TwitchStatusWords {
    const details = [
        status.title ? t("settings.twitch.status.title", { value: status.title }) : "",
        status.game ? t("settings.twitch.status.game", { value: status.game }) : "",
        status.state !== "offline" ? t("settings.twitch.status.viewers", { count: status.viewers || 0 }) : "",
        status.state === "offline" && status.endedAt ? t("settings.twitch.status.endedAt", { time: moment(status.endedAt, now) }) : "",
    ].filter(Boolean);
    if (status.error) {
        return { tone: "bad", text: tOr(`settings.twitch.statusError.${status.error}`, t("settings.twitch.statusError.unknown", { code: status.error })), details };
    }
    if (status.state === "live") {
        const since = Date.parse(status.since);
        return { tone: "live", text: Number.isNaN(since) ? t("settings.twitch.status.live") : t("settings.twitch.status.liveSince", { time: moment(since, now) }), details };
    }
    if (status.state === "filtered") return { tone: "muted", text: t("settings.twitch.status.filtered"), details };
    return { tone: "muted", text: t("settings.twitch.status.offline"), details };
}

/** Sort rank of a status: what needs attention first, then what runs, then the rest. */
export function twitchStatusRank(status: TwitchStreamerStatus): number {
    if (status.error) return 0;
    if (status.state === "live") return 1;
    if (status.state === "filtered") return 2;
    return 3;
}

/**
 * Whether a ping of this role would silently reach nobody: Discord shows the name but
 * notifies no one and reports no error. Unknown (null) warns about nothing.
 */
export function twitchRoleWontPing(mention: TwitchMention, roleId: string): boolean {
    return !!roleId && mention.botCanMentionAll === false && mention.unmentionableRoleIds.includes(roleId);
}

/** The filter in short form; the full list goes into the tooltip. */
export function twitchFilterText(games: string[]): string {
    if (!games.length) return t("settings.twitch.filterAny");
    if (games.length === 1) return games[0];
    return t("settings.twitch.filterMore", { first: games[0], count: games.length - 1 });
}

/** The result of "Jetzt prüfen" in words, and whether it went through. */
export function twitchCheckText(result: TwitchCheckResult): { ok: boolean; text: string } {
    if (result.skipped) return { ok: false, text: tOr(`settings.twitch.result.${result.skipped}`, t("settings.twitch.result.failed")) };
    return { ok: true, text: t("settings.twitch.result.checked", { count: result.checked, live: result.live }) };
}

/** The line about the job's last run, "" before the first one of this process. */
export function twitchLastRunText(lastRun: { at: number; error: string }, now = Date.now()): string {
    if (!lastRun.at) return "";
    const time = moment(lastRun.at, now);
    if (!lastRun.error) return t("settings.twitch.lastRun", { time });
    const reason = tOr(`settings.twitch.lastRunError.${lastRun.error}`, t("settings.twitch.lastRunError.other"));
    return t("settings.twitch.lastRunFailed", { time, reason });
}

/** An API error in words of the active language; the server's own messages are German only. */
export function twitchErrorText(err: ApiError): string {
    switch (err.code) {
        case "server_switched": return t("settings.serverSwitched");
        case "no_active_server": return t("settings.noActiveServer");
        case "unknown_server": return t("settings.unknownServer");
        default: return tOr(`settings.twitch.error.${err.code}`, err.message);
    }
}

/**
 * What adding a game name to the filter would do: the new list, or why not. Compared
 * without case like the server does, so a refused name never disappears silently.
 */
export function addTwitchGame(games: string[], raw: string, limits: TwitchLimits): { games: string[]; error: string } {
    const name = raw.trim();
    if (!name) return { games, error: "" };
    if (name.length > limits.gameNameLength) return { games, error: t("settings.twitch.modal.gameTooLong", { max: limits.gameNameLength }) };
    if (games.some((g) => g.toLowerCase() === name.toLowerCase())) return { games, error: t("settings.twitch.modal.gameDuplicate") };
    if (games.length >= limits.games) return { games, error: t("settings.twitch.modal.gameTooMany", { max: limits.games }) };
    return { games: [...games, name], error: "" };
}
