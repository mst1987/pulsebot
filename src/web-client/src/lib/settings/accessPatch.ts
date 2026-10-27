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
};

export const ACCESS_FIELDS: (keyof AccessFields)[] = ["adminRoleIds", "rolePermissions", "baseAccess", "userPermissions", "orgaRoleIds"];

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
