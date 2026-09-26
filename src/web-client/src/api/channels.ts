import { get, send } from "./client";
import type { AdminConfig } from "./settings";

export type Category = { id: string; name: string };
export type Channel = {
    id: string;
    name: string;
    type: number;
    typeLabel: string;
    category: string;
    parentId: string;
    // A thread's parentId names the text channel it hangs off, not a category (#361).
    isThread: boolean;
    // Whether the bot may see / post in the channel (true while unknown).
    botCanView?: boolean;
    botCanSend?: boolean;
};

export type PurposeStatus = { tone: "ok" | "mid" | "bad" | ""; label: string; tip: string };

// What the bot uses which channel for (src/web/channelPurposes.js). Stored in
// the admin config like before; `key` is the config key a change is saved under.
export type ChannelPurpose = {
    id: string;
    label: string;
    icon: string;
    key: string;
    kind: "channel" | "category";
    multiple: boolean;
    need: "send" | "read" | null;
    section: string;
    hint: string;
    ids: string[];
    items: { id: string; name: string; found: boolean; status: PurposeStatus }[];
    status: PurposeStatus;
};

export type ChannelsData = {
    categories: Category[];
    channels: Channel[];
    activeGuildId: string;
    guildName: string;
    connected: boolean;
    purposes: ChannelPurpose[];
    purposeSummary: { set: number; missing: number; warnings: number };
    /** Tracked recruitment posts per channel id. */
    recruitmentPosts: Record<string, number>;
    /** Topic, slowmode and permission sync per channel id (issue #259). */
    details: Record<string, ChannelDetails>;
    /** Whether the bot may manage channels on this server; null while unknown. */
    canManage: boolean | null;
    /** The raid event a channel belongs to: upcoming ("event") or over ("past"). */
    events: Record<string, ChannelEvent>;
    archive: ChannelArchive;
    /** Stored quick-create schema per category id. */
    schemas: Record<string, ChannelSchema>;
    /** Whether the viewer may use "gleich Event anlegen" (raids write). */
    canCreateEvents?: boolean;
    /** Per category: its default raid template and the source of new events. */
    eventDefaults?: Record<string, ChannelEventDefaults>;
    defaultSchema: string;
    placeholders: { key: string; hint: string }[];
};

export type ChannelDetails = { topic: string; rateLimitPerUser: number; permissionsLocked: boolean | null };
export type ChannelEvent = { status: "event" | "past"; title: string; startTime: number; eventId: string };
/** `time` = the start time "gleich Event anlegen" last used in the category. */
export type ChannelSchema = { schema: string; raid: string; templateChannelId: string; time?: string };
export type ChannelEventDefaults = { templateId: string; templateName: string; source: "raidhelper" | "eventhelper" };
export type ChannelArchiveRow = {
    id: string;
    name: string;
    /** When it was archived (epoch ms), 0 when moved there by hand. */
    at: number;
    by: string;
    fromCategory: string;
    waitingDays: number | null;
    overdue: boolean;
};
export type ChannelArchive = {
    categoryId: string;
    count: number;
    overdue: number;
    hintDays: number;
    rows: ChannelArchiveRow[];
};

/** One channel's outcome of a bulk action. */
export type ChannelResult = {
    id: string;
    ok: boolean;
    error?: string;
    name?: string;
    /** Quick-create with "gleich Event anlegen": the event made in this channel, or why none. */
    eventId?: string;
    eventError?: string;
};
export type ChannelBulkResult = { results: ChannelResult[]; done: number; failed: number; message: string };
export type ChannelChanges = { name?: string; topic?: string; parentId?: string; rateLimitPerUser?: number };

/** Change channels; only the fields present in `changes` are applied. */
export function patchChannels(csrfToken: string | null, ids: string[], changes: ChannelChanges): Promise<ChannelBulkResult> {
    return send("PATCH", "/api/channels", csrfToken, { ids, changes });
}

export function archiveChannels(csrfToken: string | null, ids: string[]): Promise<ChannelBulkResult> {
    return send("POST", "/api/channels/archive", csrfToken, { ids });
}

/**
 * Delete channels; `confirm` is the channel's name, or LÖSCHEN for several.
 * Without `anywhere` only from the archive; with it (the channel list) any channel, never a category.
 */
export function deleteChannels(csrfToken: string | null, ids: string[], confirm: string, anywhere = false): Promise<ChannelBulkResult> {
    return send("POST", "/api/channels/delete", csrfToken, anywhere ? { ids, confirm, anywhere: true } : { ids, confirm });
}

/**
 * Where a channel name comes from (#285): like the previous event channel of the
 * category ("previous"), its stored schema ("schema"), the default schema
 * ("default") or a schema typed into the dialog ("typed"). `label` is the badge,
 * `detail` and `design` its tooltip.
 */
export type ChannelNaming = {
    source: "previous" | "schema" | "default" | "typed";
    label: string;
    detail: string;
    design: string;
    fromChannel: string;
    templateChannelId: string;
    templateChannelName: string;
};
export type ChannelNameSuggestion = ChannelNaming & { name: string; replaced: { part: string; from: string; to: string }[] };

export type RenamePreviewRow = { id: string; from: string; to: string; hasDate: boolean; conflict: boolean; naming?: ChannelNaming | null };

export function renamePreview(csrfToken: string | null, input: { ids: string[]; schema: string; raid: string }): Promise<{ rows: RenamePreviewRow[] }> {
    return send("POST", "/api/channels/rename-preview", csrfToken, input);
}

export type QuickCreateInput = {
    categoryId: string;
    schema: string;
    raid: string;
    from: string;
    count: number;
    interval: "once" | "weekly";
    templateChannelId: string;
    saveSchema?: boolean;
    dryRun?: boolean;
    /** Preview an empty schema as derived from the channels, not by the category's stored one. */
    ignoreStoredSchema?: boolean;
    /** "gleich Event anlegen": an event per created channel at `time` ("19:30"). */
    withEvent?: boolean;
    time?: string;
};
export type QuickCreatePlanRow = { date: string; name: string; exists: boolean };

export function quickCreateChannels(csrfToken: string | null, input: QuickCreateInput): Promise<{ plan: QuickCreatePlanRow[]; naming?: ChannelNaming | null } & Partial<ChannelBulkResult> & { skipped?: number }> {
    return send("POST", "/api/channels/batch", csrfToken, input);
}

/** A category's naming schema on its own; an empty schema = like the latest event channel again. */
export function saveChannelSchema(
    csrfToken: string | null,
    input: { categoryId: string; schema: string; raid: string; templateChannelId: string },
): Promise<{ schema: ChannelSchema }> {
    return send("POST", "/api/channels/schema", csrfToken, input);
}

export function saveChannelConfig(
    csrfToken: string | null,
    input: { archiveCategoryId?: string; archiveDeleteHintDays?: number; createArchiveCategory?: string },
): Promise<{ config: { archiveCategoryId: string; archiveDeleteHintDays: number } }> {
    return send("POST", "/api/channels/config", csrfToken, input);
}

/**
 * Store a purpose's channels (or categories). The assignment is a setting, so
 * it goes through PATCH /api/settings and needs write access to Einstellungen.
 */
export function saveChannelPurpose(csrfToken: string | null, purpose: ChannelPurpose, ids: string[]): Promise<{ config: AdminConfig }> {
    const clean = [...new Set(ids.filter(Boolean))];
    const partial: Record<string, unknown> = purpose.key === "raidDefaults.channelId"
        ? { raidDefaults: { channelId: clean[0] || "" } }
        : { [purpose.key]: purpose.multiple ? clean : (clean[0] || "") };
    return send("PATCH", "/api/settings", csrfToken, partial);
}

export function getChannels(): Promise<ChannelsData> {
    return get<ChannelsData>("/api/channels");
}

export function createChannel(
    csrfToken: string | null,
    input: { name: string; type: string; parentId: string },
): Promise<{ id: string; name: string }> {
    return send("POST", "/api/channels", csrfToken, input);
}

export function duplicateChannel(
    csrfToken: string | null,
    input: { channelId: string; name: string },
): Promise<{ id: string; name: string }> {
    return send("POST", "/api/channels/duplicate", csrfToken, input);
}
