// Thin fetch wrapper for the /api/* JSON layer (src/web/apiRouter.js). No React
// Query — the app is small enough that useEffect + useState covers it (see the
// migration plan discussed for this project).

export type ApiError = { code: string; message: string };

export type SessionUser = { id: string; name: string; isAdmin: boolean };
export type Session = { user: SessionUser | null; csrfToken: string | null };

export type EventSheet = { filledAt: string; playerCount?: number } | null;

export type UpcomingEvent = {
    id: string;
    title: string;
    startTime: number;
    channelId: string;
    channelName: string;
    signupCount: number;
    playerCount: number;
    sheet: EventSheet;
};

export type EventLog = {
    title?: string;
    reportId?: string;
    status?: string;
    reportUrl?: string;
    reportRefId?: string;
};

export type RecentEvent = {
    id: string;
    title: string;
    startTime: number;
    channelId: string;
    channelName: string;
    categoryName: string;
    logs: EventLog[];
    lootCount: number;
    softres: { url?: string } | null;
};

export type RecentReport = {
    id: string;
    title: string;
    zone: string;
    generatedAt: number;
    issueCount: number;
};

export type DashboardData = {
    stats: {
        reportsTotal: number;
        reportsWithIssues: number;
        templates: number;
        posts: number;
        categories: number;
        adminRoles: number;
    };
    recentReports: RecentReport[];
    upcoming: { events: UpcomingEvent[]; error: string | null };
    recentEvents: { events: RecentEvent[]; error: string | null };
    activeGuildId: string;
};

export type Category = { id: string; name: string };
export type Channel = {
    id: string;
    name: string;
    type: number;
    typeLabel: string;
    category: string;
    parentId: string;
};
export type ChannelsData = { categories: Category[]; channels: Channel[]; activeGuildId: string };

async function get<T>(path: string): Promise<T> {
    const res = await fetch(path, { credentials: "include" });
    const body = await res.json();
    if (!res.ok) {
        const err: ApiError = body?.error || { code: "unknown", message: `HTTP ${res.status}` };
        throw err;
    }
    return body.data as T;
}

// Mutating requests carry the CSRF token from GET /api/session as a header
// (the SSR forms use a hidden _csrf field instead — see src/web/auth.js).
async function send<T>(method: string, path: string, csrfToken: string | null, jsonBody?: unknown): Promise<T> {
    const res = await fetch(path, {
        method,
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        },
        body: JSON.stringify(jsonBody ?? {}),
    });
    const body = await res.json();
    if (!res.ok) {
        const err: ApiError = body?.error || { code: "unknown", message: `HTTP ${res.status}` };
        throw err;
    }
    return body.data as T;
}

export function getSession(): Promise<Session> {
    return get<Session>("/api/session");
}

export function getDashboard(): Promise<DashboardData> {
    return get<DashboardData>("/api/dashboard");
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

export type Role = { id: string; name: string };

export type BlizzardConfig = {
    clientId: string;
    clientSecret?: string;
    region: string;
    realmSlug: string;
    namespace: string;
};

export type AdminConfig = {
    adminRoleIds: string[];
    officerRoleId: string;
    applicationChannelId: string;
    highestBidsChannelId: string;
    highestBidsMessageId: string;
    categoryIds: string[];
    categoryRoles: Record<string, string[]>;
    logChannelIds: string[];
    raidDefaults: { templateId: string; channelId: string };
    blizzard: BlizzardConfig;
};

export type Raidsheet = {
    id: string;
    name: string;
    spreadsheetId: string;
    sheetName: string;
    gid: string;
    keywords: string[];
};

export type SettingsData = {
    config: AdminConfig;
    raidsheets: Raidsheet[];
    roles: Role[];
    categories: Category[];
    activeGuildId: string;
};

export function getSettings(): Promise<SettingsData> {
    return get<SettingsData>("/api/settings");
}

export function updateSettings(csrfToken: string | null, partial: Partial<AdminConfig>): Promise<{ config: AdminConfig }> {
    return send("PATCH", "/api/settings", csrfToken, partial);
}

export function saveRaidsheet(csrfToken: string | null, input: Partial<Raidsheet>): Promise<Raidsheet> {
    return send("POST", "/api/settings/raidsheets", csrfToken, input);
}

export function deleteRaidsheet(csrfToken: string | null, id: string): Promise<{ id: string }> {
    return send("POST", "/api/settings/raidsheets/delete", csrfToken, { id });
}
