import type { Role } from "../../api";

// The roles a picker offers (#745): a role a bot or an integration owns
// (`managed`, e.g. @MEE6 or the booster role) can be given to nobody, so it is
// no raider role, no roster role and no ping target worth picking. A role that
// is already chosen stays, so a stored choice is never hidden from the reader.

/** The roles a picker may offer: every role that is not bot-managed, plus those in `keep`. */
export function assignableRoles<R extends Role>(roles: R[], keep: string[] = []): R[] {
    const kept = new Set(keep);
    return roles.filter((r) => !r.managed || kept.has(r.id));
}
