// The pure rules behind the Einstellungen page, kept apart from the components so
// test/web-client/settingsLogic.test.js can run them in plain Node.
//
// Written so that stripping the signature's annotations leaves valid JavaScript:
// every function is `export function name(params): Result {` on one line, and
// no body uses type syntax (no `as`, no generics, no annotated locals). The test
// relies on exactly that; keep it when adding a function here.
import type { AreaAccess } from "../api";

export type Level = "none" | "read" | "write";
export type Grants = Record<string, AreaAccess | undefined>;
export type GrantMap = Record<string, Grants>;
export type NameOf = (id: string) => string;

export const LEVEL_LABEL: Record<Level, string> = { none: "aus", read: "Lesen", write: "Schreiben" };

// ---- permission matrix: one tri-state cell per owner × area ----

/** The level a stored grant stands for; write always implies read. */
export function levelOf(grant: AreaAccess | undefined): Level {
    if (grant && grant.write) return "write";
    if (grant && grant.read) return "read";
    return "none";
}

/** The stored shape of a level. */
export function grantOf(level: Level): AreaAccess {
    return { read: level !== "none", write: level === "write" };
}

/** One click on a cell: aus › Lesen › Schreiben › aus. */
export function nextLevel(level: Level): Level {
    if (level === "none") return "read";
    if (level === "read") return "write";
    return "none";
}

/** The grants with one area set to a level; "aus" removes the entry instead of storing two falses. */
export function withLevel(grants: Grants | undefined, areaId: string, level: Level): Grants {
    const out = { ...(grants || {}) };
    if (level === "none") delete out[areaId];
    else out[areaId] = grantOf(level);
    return out;
}

/** How many owners of a map hold at least read resp. write on an area (the column head's tooltip). */
export function areaCounts(maps: Grants[], areaId: string): { read: number; write: number } {
    let read = 0;
    let write = 0;
    for (const grants of maps) {
        const level = levelOf(grants && grants[areaId]);
        if (level === "read") read += 1;
        if (level === "write") write += 1;
    }
    return { read, write };
}

/** Discord ids are 17–20 digit snowflakes; anything else is a typo that could never log in. */
export function isDiscordId(value: string): boolean {
    return /^\d{17,20}$/.test(String(value || "").trim());
}

/** Every owner × area whose level differs, as "@Raidlead · Historie → Schreiben". */
export function permissionChanges(before: GrantMap, after: GrantMap, ownerName: NameOf, areaLabel: NameOf): string[] {
    const out = [];
    const owners = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
    for (const owner of owners) {
        const a = (before || {})[owner] || {};
        const b = (after || {})[owner] || {};
        const areas = [...new Set([...Object.keys(a), ...Object.keys(b)])];
        for (const area of areas) {
            const from = levelOf(a[area]);
            const to = levelOf(b[area]);
            if (from !== to) out.push(`${ownerName(owner)} · ${areaLabel(area)} → ${LEVEL_LABEL[to]}`);
        }
        const added = !(before || {})[owner] && (after || {})[owner];
        const removed = (before || {})[owner] && !(after || {})[owner];
        if (added && !areas.length) out.push(`${ownerName(owner)} hinzugefügt`);
        if (removed && !areas.length) out.push(`${ownerName(owner)} entfernt`);
    }
    return out;
}

// ---- the save bar: what differs between the saved config and the draft ----

export type DraftShape = {
    adminRoleIds: string[];
    rolePermissions: GrantMap;
    baseAccess: Grants;
    userPermissions: GrantMap;
    officerRoleId: string;
    applicationChannelId: string;
    highestBidsChannelId: string;
    highestBidsMessageId: string;
    categoryIds: string[];
    categoryRoles: Record<string, string[]>;
    logChannelIds: string[];
    raidTemplateId: string;
    raidChannelId: string;
    categoryLootTool: Record<string, string>;
    categorySheets: Record<string, { url: string; name: string }>;
    topItems: { id: number }[];
};

export type ChangeNames = { role: NameOf; user: NameOf; area: NameOf; category: NameOf };

const SIMPLE_FIELDS: [string, string][] = [
    ["officerRoleId", "Offizier-Rolle"],
    ["applicationChannelId", "Bewerbungs-Kanal"],
    ["highestBidsChannelId", "Höchstgebote-Kanal"],
    ["highestBidsMessageId", "Höchstgebote-Nachricht"],
    ["raidTemplateId", "Standard-Template"],
    ["raidChannelId", "Standard-Kanal"],
];

const LOOT_TOOL_LABEL: Record<string, string> = { gargul: "Gargul", rclc: "RCLootcouncil", "": "keins" };

function sameList(a: string[] | undefined, b: string[] | undefined): boolean {
    const x = [...(a || [])].sort();
    const y = [...(b || [])].sort();
    return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * The unsaved changes, one line each — the save bar counts them and shows the
 * first few. An empty list means the draft equals the saved state and the bar
 * stays away.
 */
export function draftChanges(saved: DraftShape, draft: DraftShape, names: ChangeNames): string[] {
    const out = [];
    const admins = [...new Set([...(saved.adminRoleIds || []), ...(draft.adminRoleIds || [])])];
    for (const id of admins) {
        const was = (saved.adminRoleIds || []).includes(id);
        const is = (draft.adminRoleIds || []).includes(id);
        if (was !== is) out.push(`Admin-Rolle ${names.role(id)} ${is ? "hinzugefügt" : "entfernt"}`);
    }
    out.push(...permissionChanges(saved.rolePermissions, draft.rolePermissions, names.role, names.area));
    out.push(...permissionChanges({ base: saved.baseAccess || {} }, { base: draft.baseAccess || {} }, () => "Basiszugang", names.area));
    out.push(...permissionChanges(saved.userPermissions, draft.userPermissions, names.user, names.area));

    const categories = [...new Set([
        ...(saved.categoryIds || []), ...(draft.categoryIds || []),
        ...Object.keys(saved.categoryRoles || {}), ...Object.keys(draft.categoryRoles || {}),
        ...Object.keys(saved.categoryLootTool || {}), ...Object.keys(draft.categoryLootTool || {}),
        ...Object.keys(saved.categorySheets || {}), ...Object.keys(draft.categorySheets || {}),
    ])];
    for (const id of categories) {
        const name = names.category(id);
        const was = (saved.categoryIds || []).includes(id);
        const is = (draft.categoryIds || []).includes(id);
        if (was !== is) out.push(`${name} ${is ? "aktiviert" : "deaktiviert"}`);
        if (!sameList((saved.categoryRoles || {})[id], (draft.categoryRoles || {})[id])) out.push(`${name} · Raider-Rollen`);
        const toolWas = (saved.categoryLootTool || {})[id] || "";
        const toolIs = (draft.categoryLootTool || {})[id] || "";
        if (toolWas !== toolIs) out.push(`${name} · Loot-Addon → ${LOOT_TOOL_LABEL[toolIs] || toolIs}`);
        const sheetWas = (saved.categorySheets || {})[id] || { url: "", name: "" };
        const sheetIs = (draft.categorySheets || {})[id] || { url: "", name: "" };
        if ((sheetWas.url || "").trim() !== (sheetIs.url || "").trim() || (sheetWas.name || "").trim() !== (sheetIs.name || "").trim()) {
            out.push(`${name} · Raidsheet`);
        }
    }

    for (const [key, label] of SIMPLE_FIELDS) {
        if (String(saved[key] || "").trim() !== String(draft[key] || "").trim()) out.push(label);
    }
    if (!sameList(saved.logChannelIds, draft.logChannelIds)) out.push("Log-Kanäle");
    const itemsWas = (saved.topItems || []).map((i) => String(i.id));
    const itemsIs = (draft.topItems || []).map((i) => String(i.id));
    if (itemsWas.join(",") !== itemsIs.join(",")) out.push("Top-Items");
    return out;
}

// ---- connections: one status card and one self-saving modal each ----

export type ConnectionId = "discord" | "battlenet" | "wcl" | "anthropic" | "lootsync";
export type ConnectionState = { tone: "ok" | "mid" | "accent" | ""; label: string; missing: boolean };

export type ConnectionInputs = {
    blizzard?: { clientId?: string; hasClientSecret?: boolean };
    anthropic?: { hasApiKey?: boolean };
    warcraftlogsV2?: { clientId?: string; hasClientSecret?: boolean };
    botOnline?: boolean;
    /** null = not known (not loaded, or not a full admin). */
    tokenCount?: number | null;
};

/** The badge of one connection card, and whether it counts as "nicht eingerichtet". */
export function connectionState(id: ConnectionId, input: ConnectionInputs): ConnectionState {
    if (id === "discord") {
        return input.botOnline ? { tone: "ok", label: "Verbunden", missing: false } : { tone: "mid", label: "Bot offline", missing: false };
    }
    if (id === "battlenet" || id === "wcl") {
        const block = id === "battlenet" ? input.blizzard : input.warcraftlogsV2;
        const hasId = !!(block && String(block.clientId || "").trim());
        const hasSecret = !!(block && block.hasClientSecret);
        if (hasId && hasSecret) return { tone: "ok", label: "Verbunden", missing: false };
        if (hasId || hasSecret) return { tone: "mid", label: hasId ? "Secret fehlt" : "Client-ID fehlt", missing: true };
        return { tone: "mid", label: "Nicht eingerichtet", missing: true };
    }
    if (id === "anthropic") {
        return input.anthropic && input.anthropic.hasApiKey
            ? { tone: "ok", label: "Key hinterlegt", missing: false }
            : { tone: "mid", label: "Key fehlt", missing: true };
    }
    if (input.tokenCount === null || input.tokenCount === undefined) return { tone: "", label: "Tokens", missing: false };
    if (input.tokenCount === 0) return { tone: "mid", label: "Kein Token", missing: true };
    return { tone: "accent", label: `${input.tokenCount} ${input.tokenCount === 1 ? "Token" : "Tokens"}`, missing: false };
}

/**
 * The PATCH body of one connection modal — only that connection's block, so
 * saving Battle.net can never overwrite a half-edited category in the page's
 * draft. `secret` follows the server's contract: undefined = keep the stored
 * one, "" = clear it, anything else = replace it.
 */
export function connectionPatch(id: ConnectionId, fields: Record<string, string>, secret: string | undefined): Record<string, unknown> {
    const v = (key) => String(fields[key] || "").trim();
    // The server itself is picked under Discord-Server (discordServersPatch below).
    if (id === "discord") return { raidhelperServerId: v("raidhelperServerId") };
    if (id === "battlenet") {
        return {
            blizzard: {
                clientId: v("clientId"),
                region: v("region") || "eu",
                realmSlug: v("realmSlug").toLowerCase() || "thunderstrike",
                namespace: v("namespace").toLowerCase(),
                ...(secret !== undefined ? { clientSecret: secret } : {}),
            },
        };
    }
    if (id === "anthropic") {
        return { anthropic: { model: v("model"), ...(secret !== undefined ? { apiKey: secret } : {}) } };
    }
    if (id === "wcl") {
        return { warcraftlogsV2: { clientId: v("clientId"), ...(secret !== undefined ? { clientSecret: secret } : {}) } };
    }
    return {};
}

export type SettingsLike = {
    config: { blizzard?: ConnectionInputs["blizzard"]; anthropic?: ConnectionInputs["anthropic"]; warcraftlogsV2?: ConnectionInputs["warcraftlogsV2"] };
    bot?: { online: boolean };
};

/** What the status of the cards is computed from; `tokens` null = not loaded or not a full admin. */
export function connectionInputs(data: SettingsLike, tokens: unknown[] | null): ConnectionInputs {
    return {
        blizzard: data.config.blizzard,
        anthropic: data.config.anthropic,
        warcraftlogsV2: data.config.warcraftlogsV2,
        botOnline: !!(data.bot && data.bot.online),
        tokenCount: tokens ? tokens.length : null,
    };
}

/** The connections a user sees — a limited settings user only gets Battle.net (the rest are FULL_ADMIN_KEYS or admin-only ids). */
export function visibleConnections(canManageAccess: boolean): ConnectionId[] {
    return canManageAccess ? ["discord", "battlenet", "wcl", "anthropic", "lootsync"] : ["battlenet"];
}

/** The sidebar badge of "Verbindungen": how many visible connections are not set up. */
export function missingConnections(data: SettingsLike, tokens: unknown[] | null, canManageAccess: boolean): number {
    const inputs = connectionInputs(data, tokens);
    return visibleConnections(canManageAccess).filter((id) => connectionState(id, inputs).missing).length;
}

// ---- Discord-Server: the event and the talk server (#251) ----

export type ServerCardLike = { connected: boolean; permissions: { label: string; ok: boolean }[] | null; missing: string[] };
export type ServerFields = { eventGuildId: string; talkGuildId: string; talkOverviewChannelId: string; talkPingChannelId: string };
export type OverlapLike = { eventCount: number | null; talkCount: number | null; both: number | null; error: string | null };

/**
 * The badge of one server card. `optional` is the talk server: not having one
 * is the one-server setup, not a gap. Rights that cannot be known (bot offline)
 * are said as such, never counted as missing.
 */
export function serverCardState(card: ServerCardLike | null, optional: boolean): ConnectionState {
    if (!card) return optional ? { tone: "", label: "Kein zweiter Server", missing: false } : { tone: "mid", label: "Kein Server gewählt", missing: true };
    if (!card.connected) return { tone: "mid", label: "Bot nicht auf dem Server", missing: true };
    if (!card.permissions) return { tone: "", label: "Rechte unbekannt", missing: false };
    const n = card.missing.length;
    if (n) return { tone: "mid", label: n === 1 ? "1 Recht fehlt" : `${n} Rechte fehlen`, missing: true };
    return { tone: "ok", label: "Verbunden", missing: false };
}

/** The sidebar badge of "Discord-Server": how many of the two cards need attention. */
export function serverIssues(servers: { event: ServerCardLike | null; talk: ServerCardLike | null } | null | undefined): number {
    if (!servers) return 0;
    return [serverCardState(servers.event, false), serverCardState(servers.talk, true)].filter((s) => s.missing).length;
}

/**
 * The PATCH body of the edit dialog. A talk server equal to the event server is
 * no second server, and without a talk server its channels mean nothing — both
 * are cleared, the same rule the server's normaliser applies.
 */
export function discordServersPatch(fields: ServerFields): { discordServers: ServerFields } {
    const v = (key) => String(fields[key] || "").trim();
    const eventGuildId = v("eventGuildId");
    const talkGuildId = v("talkGuildId") === eventGuildId ? "" : v("talkGuildId");
    return {
        discordServers: {
            eventGuildId,
            talkGuildId,
            talkOverviewChannelId: talkGuildId ? v("talkOverviewChannelId") : "",
            talkPingChannelId: talkGuildId ? v("talkPingChannelId") : "",
        },
    };
}

/** "198 von 212" plus its tone: how many event members are on the talk server too. */
export function overlapBadge(overlap: OverlapLike | null): { label: string; tone: "ok" | "mid" | ""; tip: string } | null {
    if (!overlap) return null;
    if (overlap.error || overlap.both === null || overlap.eventCount === null) {
        return { label: "Überschneidung unbekannt", tone: "", tip: overlap.error || "Mitglieder konnten nicht geladen werden." };
    }
    const share = overlap.eventCount ? overlap.both / overlap.eventCount : 1;
    return {
        label: `${overlap.both} von ${overlap.eventCount}`,
        tone: share >= 0.9 ? "ok" : "mid",
        tip: `${overlap.both} von ${overlap.eventCount} Mitgliedern des Event-Discords sind auch auf dem Kommunikations-Discord. Wer fehlt, bekommt Pings später als DM.`,
    };
}

// ---- categories: the raid ones as a list, the rest folded away ----

export type RaiderCharSummary = { members: number; assigned: number; error: string | null };

/** The row's "22 / 25": members holding the category's roles, and how many have a fixed character. */
export function summarizeRaiderChars(info: { members: { id: string }[]; assignments: Record<string, string>; membersError: string | null }): RaiderCharSummary {
    const assigned = info.members.filter((m) => String(info.assignments[m.id] || "").trim()).length;
    return { members: info.members.length, assigned, error: info.membersError };
}

export type CategoryRow = { id: string; name: string; unknown: boolean };

/**
 * The guild's live categories plus every configured id Discord no longer knows
 * (a deleted category). Dropping those silently would delete their settings on
 * the next save without anyone seeing it happen.
 */
export function categoryRows(categories: { id: string; name: string }[], configured: string[]): CategoryRow[] {
    const known = new Set(categories.map((c) => c.id));
    const extra = [];
    for (const id of configured) {
        if (known.has(id)) continue;
        known.add(id);
        extra.push({ id, name: id, unknown: true });
    }
    return [...categories.map((c) => ({ id: c.id, name: c.name, unknown: false })), ...extra];
}

/**
 * Which rows the list shows and which fold into "n weitere Discord-Kategorien":
 * the active categories and every unknown id always show; the rest only with
 * "Alle Discord-Kategorien".
 */
export function splitCategoryRows(rows: CategoryRow[], activeIds: string[], showAll: boolean): { shown: CategoryRow[]; folded: CategoryRow[] } {
    const shown = [];
    const folded = [];
    for (const row of rows) {
        if (showAll || row.unknown || activeIds.includes(row.id)) shown.push(row);
        else folded.push(row);
    }
    return { shown, folded };
}
