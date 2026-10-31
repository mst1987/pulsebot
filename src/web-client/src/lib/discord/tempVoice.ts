// The voice channel per raid (docs/channels.md "Sprachkanal je Raid") on the client:
// the settings' shape and defaults, and the name preview of the category card and
// the KanalStep. renderVoiceName is the twin of renderVoiceName() in
// src/services/voice/tempVoicePlan.js - the server names the real channel, this
// only shows what it will be.
import { normalizeForType } from "./channelNames";
import { DISPLAY_TZ } from "../format";

export type TempVoiceMode = "none" | "existing" | "temp";

/** One category's settings, defaults filled in (tempVoiceSettings.js). */
export type TempVoiceSettings = {
    mode: TempVoiceMode;
    fromRaid2: boolean;
    parentId: string;
    nameTemplate: string;
    leadMinutes: number;
    closeAfterMinutes: number;
    onlyAssigned: boolean;
};

/** An event's own plan (KanalStep "Für dieses Event ändern"); null = the category's. */
export type VoicePlan = { mode: TempVoiceMode; nameTemplate: string; leadMinutes: number };

export const DEFAULT_NAME_TEMPLATE = "{raid} {nr} · {datum}";
export const NAME_TEMPLATE_MAX = 100;
export const LEAD_MAX = 240;
export const CLOSE_AFTER_MAX = 360;
export const EMPTY_CLOSE_MINUTES = 5;
export const PLACEHOLDERS = ["raid", "nr", "datum", "zeit", "leader"] as const;

export const TEMP_VOICE_DEFAULTS: Omit<TempVoiceSettings, "mode"> = {
    fromRaid2: false,
    parentId: "",
    nameTemplate: DEFAULT_NAME_TEMPLATE,
    leadMinutes: 30,
    closeAfterMinutes: 60,
    onlyAssigned: false,
};

/**
 * A category's settings out of what the server stored (only what differs) and its
 * fixed channel: without a stored mode it follows the channel, as the server does.
 */
export function tempVoiceFor(stored: Partial<TempVoiceSettings> | undefined, fixedChannelId: string): TempVoiceSettings {
    const s = { ...TEMP_VOICE_DEFAULTS, ...(stored || {}) };
    const mode = (["none", "existing", "temp"] as string[]).includes(String(stored && stored.mode)) ? (stored!.mode as TempVoiceMode) : fixedChannelId ? "existing" : "none";
    return { ...s, mode };
}

/** Whether raid `index` (1 = the first) gets a temporary channel. */
export function isTemporary(s: Pick<TempVoiceSettings, "mode" | "fromRaid2">, index: number): boolean {
    return s.mode === "temp" || (s.mode === "existing" && s.fromRaid2 && index >= 2);
}

// Characters that only separate placeholders; dropped with an empty placeholder next to them.
const SEPARATORS = "·\\-|/,:";
const EDGE_RE = new RegExp(`^[\\s${SEPARATORS}]+|[\\s${SEPARATORS}]+$`, "g");
const DOUBLE_RE = new RegExp(`([${SEPARATORS}])(\\s*[${SEPARATORS}])+`, "g");
const VOICE_TYPE = 2;
const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

/** A name template filled in; an empty placeholder goes with the separator next to it. */
export function renderVoiceName(template: string, values: Record<string, string>): string {
    let text = String(template || "").replace(/\{(\w+)\}/g, (all, key: string) => (Object.prototype.hasOwnProperty.call(values, key) ? String(values[key] ?? "") : all));
    text = text.replace(/\s+/g, " ").replace(DOUBLE_RE, "$1").replace(EDGE_RE, "").replace(/\s+/g, " ");
    return normalizeForType(text, VOICE_TYPE);
}

function berlinParts(seconds: number): Record<string, string> {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: DISPLAY_TZ, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(seconds * 1000));
    return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

const EN_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Sa 31.10." in Berlin time - German, like the channel the server creates. */
export function voiceDayLabel(seconds: number): string {
    if (!seconds) return "";
    const p = berlinParts(seconds);
    return `${WEEKDAYS[Math.max(0, EN_WEEKDAYS.indexOf(p.weekday))]} ${p.day}.${p.month}.`;
}

/** "20:00" in Berlin time. */
export function voiceTimeLabel(seconds: number): string {
    if (!seconds) return "";
    const p = berlinParts(seconds);
    return `${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
}

/** The name of raid `index` of `total`: what the server will call the channel. */
export function voiceNameFor(template: string, { raid, start, index, total, leader = "" }: { raid: string; start: number; index: number; total: number; leader?: string }): string {
    const name = renderVoiceName(template, { raid, nr: total > 1 ? String(index) : "", datum: voiceDayLabel(start), zeit: voiceTimeLabel(start), leader });
    return name || raid || "Raid";
}

/** A start time as "HH:MM" minus `minutes` - "bei Start 20:00 um 19:30". */
export function clockMinus(clock: string, minutes: number): string {
    const m = /^(\d{1,2}):(\d{2})$/.exec(clock);
    if (!m) return "";
    const total = (((Number(m[1]) * 60 + Number(m[2]) - minutes) % 1440) + 1440) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
