import { get, send } from "../client";
import type { TextChannel } from "../system/recruitment";

// ===== Raid rosters: the roster as a picture ("Roster als Bild") =====
// The routes of src/web/apiRoutes/roster/rosterImage.js. The PNG itself is a plain
// GET the dialog shows as <img> and offers as a download; posting needs the right to
// manage that roster. A refusal arrives as { code, message }; the dialog translates the
// code (roster.image.err.*), never shows the server's text.

/** The two switches of the picture: bench and pause, the further characters. */
export type RosterImageOptions = { reserve: boolean; chars: boolean };

/** What the dialog may offer: posting, the channel of the last post, the roster server's text channels. */
export type RosterImageInfo = { canPost: boolean; channelId: string | null; channels: TextChannel[] };

/** A posted picture: the message's link and the channel. */
export type RosterImagePosted = { url: string; channelId: string };

/** The PNG's address for <img src> and the download link; the switches change it, so the preview reloads. */
export function rosterImageUrl(id: string, { reserve, chars }: RosterImageOptions): string {
    const params = new URLSearchParams({ id });
    if (reserve) params.set("reserve", "1");
    if (chars) params.set("chars", "1");
    return `/api/rosters/image?${params.toString()}`;
}

export function getRosterImageInfo(id: string): Promise<RosterImageInfo> {
    return get(`/api/rosters/image/info?id=${encodeURIComponent(id)}`);
}

/** Post the picture with the given switches into a channel of the roster's server (no ping). */
export function postRosterImage(id: string, channelId: string, { reserve, chars }: RosterImageOptions): Promise<RosterImagePosted> {
    return send("POST", "/api/rosters/image", { id, channelId, reserve, chars });
}
