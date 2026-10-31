import { get, send } from "../client";

// ---- A raid's voice channel in the setup editor (docs/channels.md): GET/POST /api/raids/voice* ----

/**
 * The voice channel of one raid of the event's group (services/voice/tempVoiceJob.js voiceStatus):
 * `kind` none (no channel), fixed (the category's existing channel) or temp (one the bot creates);
 * times in Unix seconds, `members` null while the bot cannot see the channel.
 */
export type VoiceRaid = {
    eventId: string;
    index: number;
    total: number;
    mode: "none" | "existing" | "temp";
    kind: "none" | "fixed" | "temp";
    state: "none" | "fixed" | "planned" | "open" | "closed" | "failed";
    name?: string;
    channelId?: string;
    url?: string;
    members?: number | null;
    openAt?: number;
    endAt?: number;
    limitAt?: number;
    parentName?: string;
    error?: string;
    /** The rights the bot lacks under the channel's Discord category (their German labels). */
    missingRights?: string[];
    closeReason?: string;
    closedAt?: number;
};

export type VoiceStatus = { botOnline: boolean; raids: VoiceRaid[] };

/** The voice channel of every raid of the event's group. */
export function getVoice(eventId: string): Promise<VoiceStatus> {
    return get(`/api/raids/voice?event=${encodeURIComponent(eventId)}`);
}

/** "Jetzt anlegen": the raid's temporary channel now instead of at its time. */
export function openVoice(eventId: string): Promise<{ raids: VoiceRaid[] }> {
    return send("POST", "/api/raids/voice/open", { event: eventId });
}

/** "Schließen": the raid's temporary channel now; whoever is in it moves to the fixed one. */
export function closeVoice(eventId: string): Promise<{ raids: VoiceRaid[] }> {
    return send("POST", "/api/raids/voice/close", { event: eventId });
}
