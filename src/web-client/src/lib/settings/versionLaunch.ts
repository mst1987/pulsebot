import type { LaunchChecklist, LaunchItem } from "../../api";
import { t } from "../../i18n";
import { formatDayDate } from "../format";

// The rules behind the card "Neue Version starten" (#745, Einstellungen →
// Spielversion): how an item of the server's checklist reads (badge, value,
// tooltip) and where it is fixed. The server computes the state
// (services/versions/versionLaunch.js); this only words it. Kept free of React,
// so lib/settings/__tests__/versionLaunch.test.ts runs it for real.

const K = "settings.versionLaunch";

export type LaunchLook = { tone: "ok" | "mid" | ""; label: string };
/** Where an item is fixed: another page, a card further up this page, or a download. */
export type LaunchLink =
    | { kind: "route"; to: string; label: string }
    | { kind: "jump"; target: string }
    | { kind: "download"; href: string; label: string };

/** The badge of an item: done, open, or (open and optional) neutral. */
export function statusLook(item: LaunchItem): LaunchLook {
    if (item.status === "done") return { tone: "ok", label: t(`${K}.status.done`) };
    return item.optional ? { tone: "", label: t(`${K}.optional`) } : { tone: "mid", label: t(`${K}.status.open`) };
}

/** The head badge: how many of the counted items are done. */
export function headLook(list: LaunchChecklist): LaunchLook {
    return { tone: list.total > 0 && list.done === list.total ? "ok" : "mid", label: t(`${K}.doneOf`, { done: list.done, total: list.total }) };
}

export function itemLabel(item: LaunchItem): string {
    return t(`${K}.items.${item.id}.label`);
}

const nameOf = (c: { id: string; name: string }) => c.name || c.id;
const dateOf = (ms: number) => (ms ? formatDayDate(ms) : t(`${K}.detail.never`));

/** The short value at the end of an item's line ("2 / 3", "1 fehlt", "von Hand"). */
export function itemValue(item: LaunchItem, list: LaunchChecklist, versionNames: Record<string, string> = {}): string {
    switch (item.id) {
        case "backup":
            if (item.kind === "manual") return item.mark ? formatDayDate(item.mark.at) : t(`${K}.value.manual`);
            if (item.status === "done") return t(`${K}.value.backupAt`, { date: formatDayDate(item.snapshotAt) });
            return item.snapshotAt ? t(`${K}.value.backupStale`) : t(`${K}.value.none`);
        case "export":
        case "lootAddon":
        case "talk":
            return item.mark ? formatDayDate(item.mark.at) : t(`${K}.value.manual`);
        case "categories":
            return item.total ? t(`${K}.value.categories`, { done: item.total - item.missing.length, total: item.total }) : t(`${K}.value.noCategory`);
        case "versionSettings": {
            const missing = item.fields.filter((f) => f.state === "missing").length;
            return missing ? t(`${K}.value.fieldsMissing`, { count: missing }) : t(`${K}.value.fieldsOk`);
        }
        case "templates":
            return item.count ? t(`${K}.value.templates`, { count: item.count }) : t(`${K}.value.none`);
        case "series":
            if (item.problems.length) return t(`${K}.value.seriesBad`, { count: item.problems.length });
            return item.categories ? t(`${K}.value.seriesOk`) : t(`${K}.value.seriesNothing`);
        case "rosters":
            return item.categories
                ? t(`${K}.value.rosters`, { done: item.categories - item.problems.length, total: item.categories })
                : t(`${K}.value.noTargetCategory`, { version: list.short });
        case "guildBank":
            if (item.banks.some((b) => b.assigned)) return t(`${K}.value.bankOk`);
            return item.banks.length ? t(`${K}.value.bankWaiting`) : t(`${K}.value.bankNone`);
        case "mainVersion":
            if (!item.isMain) return t(`${K}.value.mainOther`, { version: versionNames[item.mainVersion] || item.mainVersion });
            return item.hidden ? t(`${K}.value.isMain`) : t(`${K}.value.mainNotHidden`);
        default:
            return "";
    }
}

/** What exactly is open (or done by whom): the lines under the item's "why" in its tooltip. */
export function itemDetails(item: LaunchItem, list: LaunchChecklist): string[] {
    const out: string[] = [];
    const fieldName = (f: string) => t(`${K}.fields.${f}`);
    switch (item.id) {
        case "backup":
            if (item.kind === "manual") out.push(t(`${K}.detail.backupManual`));
            else out.push(t(`${K}.detail.backupParts`, { snapshot: dateOf(item.snapshotAt), offsite: dateOf(item.offsiteAt) }));
            break;
        case "categories":
            if (item.missing.length) out.push(t(`${K}.detail.categoriesMissing`, { names: item.missing.map(nameOf).join(", ") }));
            if (item.target.length) out.push(t(`${K}.detail.categoriesTarget`, { version: list.short, names: item.target.map(nameOf).join(", ") }));
            break;
        case "versionSettings": {
            const missing = item.fields.filter((f) => f.state === "missing");
            const notNeeded = item.fields.filter((f) => f.state === "notNeeded");
            if (missing.length) out.push(t(`${K}.detail.fieldMissing`, { fields: missing.map((f) => fieldName(f.field)).join(", ") }));
            if (notNeeded.length) {
                const why = (reason: string) => t(`${K}.notNeeded.${reason === "disabled" ? "disabled" : "other"}`);
                out.push(t(`${K}.detail.fieldNotNeeded`, { fields: notNeeded.map((f) => `${fieldName(f.field)} (${why(f.reason)})`).join(", ") }));
            }
            break;
        }
        case "templates":
            if (item.names.length) out.push(t(`${K}.detail.templateNames`, { names: item.names.join(", ") }));
            if (item.incomplete.length) out.push(t(`${K}.detail.incomplete`, { raids: item.incomplete.join(", ") }));
            break;
        case "series":
            for (const p of item.problems) {
                out.push(t(`${K}.detail.${p.kind === "default" ? "defaultItem" : "seriesItem"}`, { name: p.name || p.categoryId, template: p.template }));
            }
            break;
        case "rosters":
            if (!item.categories) out.push(t(`${K}.detail.noTarget`, { version: list.label }));
            for (const p of item.problems) {
                out.push(t(`${K}.detail.rosterItem`, { name: p.name || p.categoryId, problems: p.problems.map((x) => t(`${K}.roster.${x}`)).join(", ") }));
            }
            break;
        case "guildBank":
            for (const b of item.banks) {
                out.push(t(`${K}.detail.bankItem`, { guild: b.guild, realm: b.realm, state: t(`${K}.value.${b.assigned ? "bankOk" : "bankWaiting"}`) }));
            }
            break;
        default:
            break;
    }
    if (item.kind === "manual" && item.mark) {
        out.push(item.mark.byName
            ? t(`${K}.markedBy`, { date: formatDayDate(item.mark.at), name: item.mark.byName })
            : t(`${K}.markedAt`, { date: formatDayDate(item.mark.at) }));
    }
    return out;
}

/** The tooltip under an item's label: why it matters, what is open, how it is ticked off. */
export function itemTip(item: LaunchItem, list: LaunchChecklist): string {
    const parts = [t(`${K}.items.${item.id}.why`), ...itemDetails(item, list)];
    if (item.kind === "manual") parts.push(t(`${K}.manualTip`));
    if (item.optional) parts.push(t(`${K}.optionalTip`));
    return parts.join("\n\n");
}

/**
 * Where an item is fixed. `canExport`: the reader may download the archive
 * (full admins). A card on this page is a jump to its id: `gv-main` (main
 * version), `gv-links` (links per version); the categories are the server's
 * section "kategorieversion" (#957 review).
 */
export function itemLink(item: LaunchItem, { canExport = false }: { canExport?: boolean } = {}): LaunchLink | null {
    const route = (to: string): LaunchLink => ({ kind: "route", to, label: t(`${K}.links.${item.id}`) });
    switch (item.id) {
        case "backup": return item.kind === "auto" ? route("/system") : null;
        case "export": return canExport ? { kind: "download", href: "/api/settings/archive-export?format=csv", label: t(`${K}.links.export`) } : null;
        case "categories": return route("/settings?section=kategorieversion");
        case "mainVersion": return { kind: "jump", target: "gv-main" };
        case "versionSettings": return { kind: "jump", target: "gv-links" };
        case "templates": return route("/raids/raid-templates");
        case "series": return route("/raids/series");
        case "rosters": return route("/roster");
        case "guildBank": return route("/settings/all?section=verbindungen");
        case "talk": return route("/settings/all?section=discordserver&tab=links");
        default: return null;
    }
}
