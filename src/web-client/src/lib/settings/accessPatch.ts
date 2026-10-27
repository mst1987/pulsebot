// The access fields of a settings save (#925): only the ones the draft changed.
//
// The active server is kept per session, not per tab. A tab opened before a
// server switch that sent every access field on save would silently write the
// old server's rights onto the new one - so an unchanged field stays out of the
// request and the server keeps what it has.

export type AccessFields = {
    adminRoleIds: string[];
    rolePermissions: unknown;
    baseAccess: unknown;
    userPermissions: unknown;
    orgaRoleIds: string[];
    botCommandAccess: unknown;
};

export const ACCESS_FIELDS: (keyof AccessFields)[] = ["adminRoleIds", "rolePermissions", "baseAccess", "userPermissions", "orgaRoleIds", "botCommandAccess"];

/** The access fields stored per Discord server; only adminRoleIds is global (#925). */
const SERVER_ACCESS_FIELDS: (keyof AccessFields)[] = ["rolePermissions", "baseAccess", "userPermissions", "orgaRoleIds", "botCommandAccess"];

/** Order-independent comparison of plain JSON values. */
function same(a: unknown, b: unknown): boolean {
    return stable(a) === stable(b);
}

function stable(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (value && typeof value === "object") {
        const obj = value as Record<string, unknown>;
        return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`).join(",")}}`;
    }
    return JSON.stringify(value ?? null);
}

/** The access fields that differ between the draft and what was loaded. */
export function changedAccessFields<T extends Partial<Record<keyof AccessFields, unknown>>>(draft: T, saved: T): Partial<T> {
    const out: Partial<T> = {};
    for (const key of ACCESS_FIELDS) {
        if (!same(draft[key], saved[key])) out[key] = draft[key];
    }
    return out;
}

/**
 * The changed access fields as a request part: a server's rights go with the
 * server the page loaded (`serverSettingsGuildId`), so a session switched since
 * (another tab) is refused with 409 instead of writing them onto that server.
 */
export function accessPatch<T extends Partial<Record<keyof AccessFields, unknown>>>(draft: T, saved: T, guildId: string): Partial<T> & { serverSettingsGuildId?: string } {
    const changed = changedAccessFields(draft, saved);
    const perServer = SERVER_ACCESS_FIELDS.some((k) => k in changed);
    return perServer ? { ...changed, serverSettingsGuildId: guildId } : changed;
}
