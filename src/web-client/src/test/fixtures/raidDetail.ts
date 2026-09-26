// Small, readable raid-detail payloads (GET /api/raids/detail) for the render
// tests of RaidDetailPage and its parts: an own event with its step bar, and a
// Raid-Helper event with the progress bar of #219. Every builder takes overrides.
import type { RaidDetailData, RaidDetailEvent, RaidEventStep, RaidEventSteps, RaidStep } from "../../api";

export const OWN_ID = "own1";
export const RH_ID = "1234567890";

export function detailEvent(over: Partial<RaidDetailEvent> = {}): RaidDetailEvent {
    return {
        id: OWN_ID, source: "eventhelper", title: "Karazhan Donnerstag", startTime: Math.floor(Date.UTC(2026, 9, 1, 17, 45) / 1000),
        channelId: "ch1", channelName: "kara-do-01-10", signupCount: 8, isPast: false, status: "active", signupsClosed: false,
        logCount: 0, ...over,
    };
}

export function eventStep(id: RaidEventStep["id"], over: Partial<RaidEventStep> = {}): RaidEventStep {
    return { id, label: id, icon: "inv_misc_note_02", state: "todo", value: "", unit: "", note: "", hint: "", action: null, ...over };
}

/** The five steps of an own event, the signup open with "Fehlende pingen" as its deed. */
export function ownSteps(over: Partial<RaidEventSteps> = {}): RaidEventSteps {
    const ping = { id: "ping", label: "Fehlende pingen", icon: "spell_holy_borrowedtime", modal: "ping" as const };
    return {
        steps: [
            eventStep("created", { label: "Angelegt", state: "done", value: "Do 01.10.", action: { id: "edit", label: "Bearbeiten", icon: "inv_misc_note_05", manage: "edit" } }),
            eventStep("signup", { label: "Anmeldung", state: "current", value: "8", unit: "/ 10", note: "2 fehlen", hint: "Anmeldung läuft.", action: ping }),
            eventStep("setup", { label: "Setup", state: "todo", action: { id: "setup", label: "Setup öffnen", icon: "inv_misc_map_01", tab: "setup" } }),
            eventStep("approval", { label: "Freigabe", state: "skipped", hint: "Ohne Setup keine Freigabe." }),
            eventStep("after", { label: "Nachbereitung", state: "todo" }),
        ],
        current: "signup",
        action: ping,
        cancelled: false,
        note: "",
        ...over,
    };
}

/** A step of the Raid-Helper progress bar (#219). */
export function progressStep(key: RaidStep["key"], over: Partial<RaidStep> = {}): RaidStep {
    return {
        key, label: key, icon: "inv_misc_note_02", tone: "none", value: "", unit: "", badge: { label: "" },
        tip: { head: key, sub: "" }, open: {}, done: false, next: false, ...over,
    };
}

export function raidDetail(over: Partial<RaidDetailData> = {}, event: Partial<RaidDetailEvent> = {}): RaidDetailData {
    return {
        event: detailEvent(event),
        categoryName: "T4",
        guildId: "g1",
        eventsWarning: null,
        notifyTemplates: [],
        roles: [],
        raidsheets: [],
        matchedSheetId: "",
        setup: null,
        setupError: null,
        tankCandidates: [],
        eventSheet: null,
        sheetLink: null,
        eventSoftres: null,
        softresCatalogue: [],
        softresEdition: "",
        softresSuggested: [],
        attendance: { responded: [], missing: [] },
        ownSignups: [],
        ownSetup: null,
        ownSetupPost: null,
        attendanceRoleIds: [],
        membersError: null,
        signupTarget: 10,
        lootItems: [],
        lootTool: "",
        eventLogs: [],
        unlinkedLogs: [],
        progress: { steps: [], next: "", primary: null },
        steps: ownSteps(),
        playerSummaries: {},
        ...over,
    };
}

/** A Raid-Helper event: no own signups, no step bar — the progress bar with its primary action instead. */
export function raidhelperDetail(over: Partial<RaidDetailData> = {}, event: Partial<RaidDetailEvent> = {}): RaidDetailData {
    return raidDetail({
        ownSignups: null,
        steps: null,
        progress: {
            steps: [progressStep("signup", { label: "Anmeldung", value: "20", next: true, open: { modal: "notify" } })],
            next: "signup",
            primary: { label: "Anmelde-Aufruf posten", icon: "inv_letter_15", modal: "notify" },
        },
        ...over,
    }, { id: RH_ID, source: "raidhelper", status: undefined, ...event });
}
