import type { InviteServer } from "../../api";
import { isDiscordInviteUrl } from "../../lib/discord/inviteLink";

// The draft behind a recruitment post's link button (LinkButtonFields): where the
// link comes from, the invite the bot created, the pasted link and the label.

/** Discord's limit for a forum post's title. */
export const FORUM_TITLE_MAX = 100;

export type LinkSource = "bot" | "paste";

export type LinkDraft = {
    linkSource: LinkSource;
    inviteGuildId: string;
    inviteChannelId: string;
    /** The invite the bot created for the picked channel ("" until "Einladung erzeugen"). */
    inviteUrl: string;
    /** The pasted link. */
    pastedUrl: string;
    linkLabel: string;
};

export const EMPTY_LINK: LinkDraft = { linkSource: "bot", inviteGuildId: "", inviteChannelId: "", inviteUrl: "", pastedUrl: "", linkLabel: "" };

/** The source that applies: the bot only when it is on a server the caller may act on. */
export function linkSourceOf(draft: LinkDraft, servers: InviteServer[]): LinkSource {
    return servers.length ? draft.linkSource : "paste";
}

/** The link the post's button gets, "" while there is none (or a pasted one is not a Discord link). */
export function linkOf(draft: LinkDraft, servers: InviteServer[]): string {
    const url = linkSourceOf(draft, servers) === "bot" ? draft.inviteUrl : draft.pastedUrl;
    return isDiscordInviteUrl(url) ? url.trim() : "";
}
