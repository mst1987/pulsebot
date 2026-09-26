import { get, send } from "./client";
import type { SignupStatus } from "./raidDetail";
import type { GameRole } from "./raidTemplates";

// ---- Event verwalten (#288): GET/POST /api/raids/manage* ----

export type ManageLogEntry = { at: number; action: string; label: string; by: string; byName: string; detail: string };
export type ManageInfo = {
    event: {
        id: string; title: string; startTime: number; when: string; signupDeadline: number;
        status: "active" | "cancelled"; signupsClosed: boolean; cancel: { reason: string; at: number; by: string; byName: string; archived: boolean } | null;
        channelId: string; channelName: string; categoryId: string;
    };
    started: boolean;
    counts: { attending: number; size: number; tentative: number; bench: number; absence: number };
    recipients: { userId: string; name: string; character: string; status: SignupStatus }[];
    archive: { configured: boolean };
    log: ManageLogEntry[];
    /** What deleting the event takes along and what stays. */
    deletion: ManageDeletion;
};
export type ManageDeletion = {
    started: boolean; cancelled: boolean; signups: number; recipients: number; messages: number;
    logs: number; loot: number; canNotify: boolean;
};
export type MovePlan = {
    eventId: string;
    title: string;
    from: { startTime: number; label: string };
    to: { startTime: number; label: string };
    signupDeadline: number;
    deadlineLabel: string;
    channel: { id: string; current: string; next: string; rename: boolean; label: string; detail: string; reason: string };
    recipients: number;
};
export type ManageResult = { message: string; warnings?: string[] };
export type ManageSpec = { key: string; label: string; role: GameRole; icon: string };
export type ManageRaider = {
    userId: string;
    name: string;
    characters: { key: string; name: string; className: string; main: boolean; specs: ManageSpec[] }[];
    signup: { character: string; spec: string; status: SignupStatus } | null;
};
export type ManageCandidates = {
    raiders: ManageRaider[];
    classes: { id: string; label: string; color: string; icon: string; specs: ManageSpec[] }[];
};

export function getManageInfo(eventId: string): Promise<ManageInfo> {
    return get<ManageInfo>(`/api/raids/manage?event=${encodeURIComponent(eventId)}`);
}

export function getMovePreview(eventId: string, date: string, time: string): Promise<MovePlan> {
    const q = new URLSearchParams({ event: eventId, date, time });
    return get<MovePlan>(`/api/raids/manage/move?${q.toString()}`);
}

export function moveRaid(csrfToken: string | null, input: { event: string; date: string; time: string; renameChannel: boolean; notify: boolean }): Promise<ManageResult> {
    return send("POST", "/api/raids/manage/move", csrfToken, input);
}

export function setRaidSignupsOpen(csrfToken: string | null, input: { event: string; open: boolean }): Promise<ManageResult> {
    return send("POST", "/api/raids/manage/signups", csrfToken, input);
}

export function getRaiderCandidates(eventId: string): Promise<ManageCandidates> {
    return get<ManageCandidates>(`/api/raids/manage/raider?event=${encodeURIComponent(eventId)}`);
}

export function addRaiderToRaid(
    csrfToken: string | null,
    input: { event: string; userId: string; character: string; spec: string; status: SignupStatus },
): Promise<ManageResult & { profileChanged?: boolean }> {
    return send("POST", "/api/raids/manage/raider", csrfToken, input);
}

export function removeRaiderFromRaid(csrfToken: string | null, input: { event: string; userId: string }): Promise<ManageResult> {
    return send("POST", "/api/raids/manage/raider/remove", csrfToken, input);
}

export function cancelRaid(csrfToken: string | null, input: { event: string; reason: string; archiveChannel: boolean; notify: boolean }): Promise<ManageResult> {
    return send("POST", "/api/raids/manage/cancel", csrfToken, input);
}

export function reopenRaid(csrfToken: string | null, input: { event: string }): Promise<ManageResult> {
    return send("POST", "/api/raids/manage/reopen", csrfToken, input);
}

export function deleteRaid(
    csrfToken: string | null,
    input: { event: string; archiveChannel: boolean; notify: boolean; confirmStarted: boolean },
): Promise<ManageResult> {
    return send("POST", "/api/raids/manage/delete", csrfToken, input);
}
