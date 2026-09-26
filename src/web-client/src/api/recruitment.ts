import { get, send } from "./client";
import type { SpecCatalogEntry } from "../lib/recruitmentSpecs";

export type RecruitmentTemplate = {
    id: string;
    name: string;
    content: string;
    title: string;
    body: string;
    buttonLabel: string;
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
    // Added by src/web/recruitmentApplications.js.
    className: string;
    spec: string;
    classColor: string;
    classIcon: string;
    specIcon: string;
    status: "neu" | "offen" | "archiviert";
};

export type TextChannel = { id: string; name: string; category: string };
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
    emojis: Emoji[];
    specCatalog: SpecCatalogEntry[];
    applications: Application[] | null;
    applicationsError: string | null;
    applicationChannelId: string;
    activeGuildId: string;
};

export function getRecruitmentData(params: { view?: string; edit?: string; editpost?: string } = {}): Promise<RecruitmentData> {
    const qs = new URLSearchParams();
    if (params.view) qs.set("view", params.view);
    if (params.edit) qs.set("edit", params.edit);
    if (params.editpost) qs.set("editpost", params.editpost);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return get<RecruitmentData>(`/api/recruitment${suffix}`);
}

export function saveRecruitmentTemplate(
    input: { id?: string; name: string; content: string; buttonLabel: string },
): Promise<RecruitmentTemplate> {
    return send("POST", "/api/recruitment", input);
}

export function deleteRecruitmentTemplate(id: string): Promise<{ id: string }> {
    return send("POST", "/api/recruitment/delete", { id });
}

export function postRecruitmentTemplate(
    input: { templateId: string; channelId: string },
): Promise<RecruitmentPost> {
    return send("POST", "/api/recruitment/post", input);
}

export function updateRecruitmentPost(
    input: { id: string; content: string; buttonLabel: string },
): Promise<RecruitmentPost> {
    return send("POST", "/api/recruitment/post-update", input);
}

export function deleteRecruitmentPost(id: string): Promise<{ id: string }> {
    return send("POST", "/api/recruitment/post-delete", { id });
}

export function scanRecruitmentPosts(): Promise<{ count: number }> {
    return send("POST", "/api/recruitment/scan", {});
}
