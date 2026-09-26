// A small Discord server for the Kanäle page tests (ChannelsPage.*.test.tsx):
// three categories (Raids, Allgemein and the archive), a loose channel, an
// upcoming and a past event channel, a channel with a thread, a voice channel
// and one archived channel (with a thread of its own). `channelsData(over)`
// returns a fresh copy, so a test can change it freely.
import type { Channel, ChannelPurpose, ChannelsData } from "../api";

export const RAIDS = "cat-raids";
export const TALK = "cat-talk";
export const ARCHIVE = "cat-arch";

/** 17.09.2026 19:30 Berlin, in seconds. */
export const EVENT_START = Math.floor(Date.UTC(2026, 8, 17, 17, 30) / 1000);

export function channel(id: string, name: string, over: Partial<Channel> = {}): Channel {
    return { id, name, type: 0, typeLabel: "Text", category: "", parentId: "", isThread: false, botCanView: true, botCanSend: true, ...over };
}

export function purpose(over: Partial<ChannelPurpose> & Pick<ChannelPurpose, "id" | "label" | "key">): ChannelPurpose {
    return {
        icon: "inv_misc_note_02",
        kind: "channel",
        multiple: false,
        need: "send",
        section: "raids",
        hint: `Wofür ${over.label} gut ist.`,
        ids: [],
        items: [],
        status: { tone: "bad", label: "fehlt", tip: "Kein Kanal gesetzt." },
        ...over,
    };
}

export function channelsData(over: Partial<ChannelsData> = {}): ChannelsData {
    return {
        activeGuildId: "g1",
        guildName: "Pulse",
        connected: true,
        canManage: true,
        categories: [
            { id: RAIDS, name: "Raids" },
            { id: TALK, name: "Allgemein" },
            { id: ARCHIVE, name: "Archiv" },
        ],
        channels: [
            channel("c-loose", "regeln"),
            channel("c-mi", "mi-17-09-ssc", { category: "Raids", parentId: RAIDS }),
            channel("c-old", "mi-10-09-ssc", { category: "Raids", parentId: RAIDS }),
            channel("c-app", "bewerbungen", { category: "Allgemein", parentId: TALK }),
            channel("t-1", "Bewerbung Fatigatus", { type: 11, typeLabel: "Thread", category: "bewerbungen", parentId: "c-app", isThread: true }),
            channel("c-voice", "raid-voice", { type: 2, typeLabel: "Voice", category: "Allgemein", parentId: TALK }),
            channel("c-arch", "alt-raid", { category: "Archiv", parentId: ARCHIVE }),
            channel("t-arch", "alter thread", { type: 11, typeLabel: "Thread", category: "alt-raid", parentId: "c-arch", isThread: true }),
        ],
        purposes: [
            purpose({
                id: "signup", label: "Raid-Anmeldung", key: "raidDefaults.channelId", section: "raids", ids: ["c-mi"],
                items: [{ id: "c-mi", name: "mi-17-09-ssc", found: true, status: { tone: "ok", label: "Bot schreibt", tip: "" } }],
                status: { tone: "ok", label: "Bot schreibt", tip: "" },
            }),
            purpose({
                id: "applications", label: "Bewerbungen", key: "applicationChannelId", icon: "inv_misc_grouplooking", section: "recruitment", ids: ["c-app"],
                items: [{ id: "c-app", name: "bewerbungen", found: true, status: { tone: "ok", label: "Bot schreibt", tip: "" } }],
                status: { tone: "ok", label: "Bot schreibt", tip: "" },
            }),
            purpose({ id: "bids", label: "Höchstgebote", key: "highestBidsChannelId", icon: "inv_misc_coin_01", section: "auction" }),
            purpose({
                id: "categories", label: "Event-Kategorien", key: "categoryIds", icon: "achievement_boss_illidan", kind: "category", multiple: true, need: null,
                section: "raids", ids: [RAIDS], items: [{ id: RAIDS, name: "Raids", found: true, status: { tone: "ok", label: "Event-Kategorie", tip: "" } }],
                status: { tone: "ok", label: "1 Kategorie", tip: "" },
            }),
        ],
        purposeSummary: { set: 3, missing: 1, warnings: 0 },
        recruitmentPosts: {},
        details: {
            "c-app": { topic: "Hier landen die Bewerbungen", rateLimitPerUser: 30, permissionsLocked: true },
        },
        events: {
            "c-mi": { status: "event", title: "SSC Mittwoch", startTime: EVENT_START, eventId: "e1" },
            "c-old": { status: "past", title: "SSC letzte Woche", startTime: EVENT_START - 7 * 86400, eventId: "e0" },
        },
        archive: {
            categoryId: ARCHIVE,
            count: 1,
            overdue: 0,
            hintDays: 14,
            rows: [{ id: "c-arch", name: "alt-raid", at: Date.UTC(2026, 8, 3, 10), by: "Nerathil", fromCategory: "Raids", waitingDays: 3, overdue: false }],
        },
        schemas: {},
        canCreateEvents: false,
        eventDefaults: {},
        defaultSchema: "{tag}-{dd}-{mm}-{raid}",
        placeholders: [{ key: "tag", hint: "Wochentag, z.B. mi" }, { key: "raid", hint: "Kürzel des Raids" }],
        ...over,
    };
}
