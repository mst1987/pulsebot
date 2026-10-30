import { get, send } from "../client";
import type { SpecCatalogEntry } from "../../lib/discord/recruitmentSpecs";

export type RecruitmentTemplate = {
    id: string;
    name: string;
    content: string;
    title: string;
    body: string;
    buttonLabel: string;
    /** The game version its applications are for (#553); one from before reads as "tbc". */
    versionId: string;
    createdAt?: number;
    updatedAt?: number;
};

export type RecruitmentPost = {
    id: string;
    guildId: string;
    channelId: string;
    messageId: string;
    channelName: string;
    content: string;
    title: string;
    body: string;
    buttonLabel: string;
    source: "web" | "scan";
    /** The template it was posted from; "" for a message the scan found. */
    templateId?: string;
    /** The version its apply button names (#553). */
    versionId: string;
    /** "link": a link button (an invite) instead of the apply button; a post from before is "apply". */
    buttonKind?: "apply" | "link";
    linkUrl?: string;
    /** The forum a forum post was opened in ("" for a text channel post); channelId is then the post (thread) itself. */
    parentChannelId?: string;
    /** The forum post's title. */
    forumTitle?: string;
    postedAt?: number;
    updatedAt?: number;
};

export type Application = {
    threadId: string;
    name: string;
    url: string;
    createdAt: number;
    archived: boolean;
    applicantId: string;
    displayName: string;
    character: string;
    classSpec: string;
    armory: string;
    wcl: string;
    description: string;
    discordName: string;
    date: string;
    /** The embed's "Version" field (#553); an application from before is "tbc". */
    versionId: string;
    // Added by src/web/recruitmentApplications.js.
    className: string;
    spec: string;
    classColor: string;
    classIcon: string;
    specIcon: string;
    status: "neu" | "offen" | "archiviert";
};

export type TextChannel = { id: string; name: string; category: string };
/** A channel a recruitment can be posted to: a text channel or a forum (a forum post with a title). */
export type RecruitmentTarget = { id: string; name: string; category: string; parentId: string; kind: "text" | "forum" };
/** A server the bot may create an invite on for a link button, with the suggested channel (#recruitment-forum). */
export type InviteServer = {
    id: string;
    name: string;
    channels: { id: string; name: string; category: string; canInvite: boolean }[];
    suggestedChannelId: string;
};
export type Emoji = { id: string; name: string; animated: boolean; code: string; url: string };

export type RecruitmentView = "templates" | "posts" | "applications";

export type RecruitmentData = {
    view: RecruitmentView | "";
    /** The active Discord server's name, "" without one. */
    guildName: string;
    templates: RecruitmentTemplate[];
    editing: RecruitmentTemplate | null;
    editingPost: RecruitmentPost | null;
    posts: RecruitmentPost[];
    channels: TextChannel[];
    /** Where a recruitment can be posted: text channels and forums (the bot may post there). */
    targets?: RecruitmentTarget[];
    /** The servers a link button's invite can be created on. */
    inviteServers?: InviteServer[];
    emojis: Emoji[];
    specCatalog: SpecCatalogEntry[];
    applications: Application[] | null;
    applicationsError: string | null;
    applicationChannelId: string;
    activeGuildId: string;
    /** The versions to filter by and pick for a template (#553). */
    gameVersions: { id: string; label: string; short: string }[];
    /** What an unfiltered page shows and a new template starts with. */
    mainVersion: string;
    /** The link button label a new post starts with, in the active server's language. */
    defaultLinkLabel?: string;
};

/** `version`: the lists of that game version only (the menu's content version, #741); an opened editor's entry stays. */
export function getRecruitmentData(params: { view?: string; edit?: string; editpost?: string; version?: string } = {}): Promise<RecruitmentData> {
    const qs = new URLSearchParams();
    if (params.version) qs.set("version", params.version);
    if (params.view) qs.set("view", params.view);
    if (params.edit) qs.set("edit", params.edit);
    if (params.editpost) qs.set("editpost", params.editpost);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return get<RecruitmentData>(`/api/recruitment${suffix}`);
}

export function saveRecruitmentTemplate(
    input: { id?: string; name: string; content: string; buttonLabel: string; versionId?: string },
): Promise<RecruitmentTemplate> {
    return send("POST", "/api/recruitment", input);
}

export function deleteRecruitmentTemplate(id: string): Promise<{ id: string }> {
    return send("POST", "/api/recruitment/delete", { id });
}

export function postRecruitmentTemplate(
    input: { templateId: string; channelId: string; buttonKind?: "apply" | "link"; linkUrl?: string; buttonLabel?: string; forumTitle?: string },
): Promise<RecruitmentPost> {
    return send("POST", "/api/recruitment/post", input);
}

/** A permanent invite into a channel of a server the caller may act on, for a link button. */
export function createRecruitmentInvite(input: { guildId: string; channelId: string; fresh?: boolean }): Promise<{ code: string; url: string; reused?: boolean }> {
    return send("POST", "/api/recruitment/invite", input);
}

export function updateRecruitmentPost(
    input: { id: string; content: string; buttonLabel: string; linkUrl?: string; forumTitle?: string },
): Promise<RecruitmentPost & { notice?: "" | "title_rate_limited" | "title_failed" }> {
    return send("POST", "/api/recruitment/post-update", input);
}

export function deleteRecruitmentPost(id: string): Promise<{ id: string }> {
    return send("POST", "/api/recruitment/post-delete", { id });
}

export function scanRecruitmentPosts(): Promise<{ count: number }> {
    return send("POST", "/api/recruitment/scan", {});
}
