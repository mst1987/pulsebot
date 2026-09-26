import { get, send } from "./client";
import type { EventLog } from "./dashboard";
import type { Channel, ChannelNameSuggestion } from "./channels";
import type { EventSource } from "./raidDetail";
import type { RoleRange, EmbedImage, EmojiStyle, RaidTemplate, GameVersion } from "./raidTemplates";

// A row of the Raid-Events list — mirrors src/web/raidListing.js. `contentIds`
// are the raid(s) the event is (for the boss icon), [] when nothing was
// recognised; `contentSources` says where that came from.
export type RaidListBase = {
    id: string;
    source?: EventSource;
    title: string;
    startTime: number;
    channelId: string;
    channelName: string;
    categoryId: string;
    categoryName: string;
    contentIds: string[];
    contentSources: string[];
    softres: { url: string } | null;
};
export type UpcomingRaid = RaidListBase & {
    signupCount: number;
    /** 10 for a ten-player night, else 25; `raidSizeKnown` false = only the default. */
    raidSize: number;
    raidSizeKnown: boolean;
};
export type PendingRaidLog = { title: string; alsoFits: string[] };
export type PastRaid = RaidListBase & {
    logs: EventLog[];
    pendingLogs: PendingRaidLog[];
    pendingLogCount: number;
    lootCount: number;
};
export type RaidsData = { events: UpcomingRaid[]; error: string | null; activeGuildId: string; guildName: string };
export type PastRaidsData = { events: PastRaid[]; error: string | null; activeGuildId: string };

export function getRaids(): Promise<RaidsData> {
    return get<RaidsData>("/api/raids");
}

export function getPastRaids(): Promise<PastRaidsData> {
    return get<PastRaidsData>("/api/raids/past");
}

export type ReusableEvent = {
    id: string;
    title: string;
    templateId: string;
    description: string;
    channelId: string;
    channelName: string;
    categoryId: string;
    categoryName: string;
    startTime: number;
    contentIds: string[];
};

/** An EventHelper event as src/web/eventStore.js hands it out (the fields the dialog reads). */
export type OwnEvent = {
    id: string;
    source: "eventhelper";
    guildId: string;
    categoryId: string;
    categoryName: string;
    channelId: string;
    channelName: string;
    /** the voice channel the raid meets in (#305); "" = none */
    voiceChannelId: string;
    title: string;
    description: string;
    leaderId: string;
    /** unix seconds */
    startTime: number;
    /** how long the raid takes, in minutes (#305) */
    durationMinutes: number;
    versionId: string;
    instanceIds: string[];
    size: number;
    /** melee/ranged: the minimum (0 = no target) */
    composition: { tank: number; healer: number; melee: number; ranged: number };
    /** the optional maxima of melee/ranged, null = open */
    compositionMax: { melee: number | null; ranged: number | null };
    requiredBuffs: string[];
    raidTemplateId: string;
    /** unix seconds, 0 = none */
    signupDeadline: number;
    fairness: boolean;
    wishes: boolean;
    autoSuggest: boolean;
    /** #306: "bench" = a full raid's new "Dabei" becomes the waiting list, "off" = refused */
    overflow?: "bench" | "off";
    lockAtLimit?: boolean;
    /** #307: the event's own colour bar, "" = the rule set of its instances */
    color?: string;
    /** #307: the event's own picture, an empty url = the instance's boss icon */
    image?: EmbedImage;
    /** the letter tiles and role icons of the event message */
    emojiStyle?: EmojiStyle;
    /** when the "Beim Anlegen ankündigen" ping went out, 0 = never */
    announcedAt?: number;
};

export type RaidCreateContext = {
    /** templateId: the Raid-Helper template of the default channel's category */
    defaults: { templateId: string; channelId: string };
    /** category id → Raid-Helper template id of its default raid template */
    categoryTemplates: Record<string, string>;
    leaderId: string;
    /** who can lead: the creator first, then the signed-up people (name may be empty) */
    leaderCandidates: { id: string; name: string }[];
    channels: Channel[];
    /** the server's voice channels, for the raid's voice channel (#305) */
    voiceChannels?: Channel[];
    /** category id → the voice channel its raids meet in (#305) */
    categoryVoiceChannel?: Record<string, string>;
    templates: RaidTemplate[];
    reusableEvents: ReusableEvent[];
    /** category id → "eventhelper" for categories whose new events live in the EventHelper */
    signupSources?: Record<string, EventSource>;
    /** category id → "Beim Anlegen ankündigen" (#306); only switched-on categories are listed */
    categoryAnnounce?: Record<string, { enabled: boolean; target: string }>;
    // The planning step (#261).
    categories?: { id: string; name: string }[];
    /** category id → raid template id of its default */
    categoryRaidTemplates?: Record<string, string>;
    /** the raid templates with their badges (needsSize, incomplete, defaultFor) */
    raidTemplates?: RaidTemplate[];
    versions?: GameVersion[];
    defaultVersion?: string;
    /** category id → its channel naming schema (Kanäle) */
    channelSchemas?: Record<string, { schema: string; raid: string }>;
    defaultSchema?: string;
    /** the own event ?event= names, for the edit mode */
    editEvent?: OwnEvent | null;
};

/**
 * The name a new event channel gets and where it comes from (#285) — the create
 * dialog's suggestion. `sourceEventId` names the event whose channel is cloned.
 */
export function getChannelNameSuggestion(input: { categoryId: string; date: string; instanceIds: string[]; sourceEventId?: string }): Promise<ChannelNameSuggestion> {
    const q = new URLSearchParams({ categoryId: input.categoryId, date: input.date, instanceIds: input.instanceIds.join(",") });
    if (input.sourceEventId) q.set("sourceEventId", input.sourceEventId);
    return get<ChannelNameSuggestion>(`/api/raids/channel-name?${q.toString()}`);
}

/** The create dialog's material; with an own event id also that event, for editing it. */
export function getRaidCreateContext(eventId = ""): Promise<RaidCreateContext> {
    return get<RaidCreateContext>(eventId ? `/api/raids/new?event=${encodeURIComponent(eventId)}` : "/api/raids/new");
}

/** The planning fields of an EventHelper event, as POST and PATCH /api/raids take them. */
export type EventPlanInput = {
    raidTemplateId: string;
    versionId: string;
    instanceIds: string[];
    size: number;
    composition: { tank: number; healer: number; melee: RoleRange | null; ranged: RoleRange | null };
    requiredBuffs: string[];
    /** how long the raid takes, in minutes (#305); 30–600 */
    durationMinutes: number;
    /** hours before the start, 0 = no deadline — counted in Berlin time on the server */
    signupDeadlineHours: number;
    fairness: boolean;
    wishes: boolean;
    autoSuggest: boolean;
    overflow: "bench" | "off";
    lockAtLimit: boolean;
    /** #307: "" = the rule set's colour for the chosen instances */
    color: string;
    /** #307: an empty url = the instance's boss icon as the thumbnail */
    image: EmbedImage;
    emojiStyle: EmojiStyle;
};

export type CreateRaidInput = Partial<EventPlanInput> & {
    title: string;
    date: string;
    time: string;
    templateId: string;
    channelId?: string;
    channelName?: string;
    sourceEventId?: string;
    /** a new channel in the category; an empty name is filled from the category's schema (same shape as /event anlegen) */
    newChannel?: { name: string; categoryId: string; templateChannelId?: string };
    /** overrides the category's default source */
    signupSource?: EventSource;
    /** the voice channel the raid meets in (#305); "" = none */
    voiceChannelId?: string;
    /** "Beim Anlegen ankündigen" (#306); omitted = as the category has it */
    announce?: boolean;
    leaderId: string;
    description: string;
};

export function createRaid(input: CreateRaidInput): Promise<{ id?: string; messageError?: string | null; announced?: boolean; announceError?: string | null }> {
    return send("POST", "/api/raids", input);
}

export type UpdateRaidInput = Partial<EventPlanInput> & {
    id: string;
    title: string;
    date: string;
    time: string;
    leaderId: string;
    description: string;
    /** the voice channel the raid meets in (#305); "" = none */
    voiceChannelId?: string;
};

/** Edit an own (EventHelper) event with the same dialog (#261). */
export function updateRaid(input: UpdateRaidInput): Promise<{ id: string; messageError?: string | null }> {
    return send("PATCH", "/api/raids", input);
}

/**
 * Change only an own event's raid size (#354, the Setup Editor's live resize)
 * — the same PATCH /api/raids `updateEvent` already takes as a partial edit,
 * just without the rest of UpdateRaidInput's fields.
 */
export function updateRaidSize(eventId: string, size: number): Promise<{ id: string; messageError?: string | null }> {
    return send("PATCH", "/api/raids", { id: eventId, size });
}
