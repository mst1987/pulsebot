import type { LeadInstance, LeadVersion } from "../../api/roster/leaders";
import { t } from "../../i18n";
import { instanceName } from "../wow/wowNames";

// Leader flags (#1034) as text: the list a crown's tooltip and the roster drawer
// show, and the folded line of "Mein Profil › Raids leiten".

/** The instances' short names in the version's order, "Kara, Gruul". */
export function leadList(instances: LeadInstance[], ids: string[]): string {
    const on = new Set(ids);
    return instances.filter((i) => on.has(i.id)).map((i) => i.short || instanceName(i.id, i.name)).join(", ");
}

/** The folded line: how many instances in which versions, "2 Instanzen · TBC" — or "keine". */
export function leadsSummary(versions: LeadVersion[]): string {
    const flagged = versions.filter((v) => v.leads.length > 0);
    if (!flagged.length) return t("profile.leads.none");
    const count = flagged.reduce((n, v) => n + v.leads.length, 0);
    return t("profile.leads.sum", { count, versions: flagged.map((v) => v.short || v.label).join(", ") });
}
