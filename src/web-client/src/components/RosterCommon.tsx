// Pieces the roster and the character page share (design issue #218): the role
// badge, the attendance bar with its tooltip, the gear-state badge, the loot
// badge and the icon link. Built on the shared building blocks in ./ui; the plain
// helpers behind them live in lib/rosterView.ts.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { CharGearReport, CharLootPreview, RosterAttendance, RosterRole } from "../api";
import { fmtMs } from "../lib/format";
import { ROLE_META, attendanceTone, nightLabel } from "../lib/rosterView";
import { Badge, WowIcon } from "./ui";

export function RoleBadge({ role }: { role: RosterRole }) {
    if (!role) return <Badge tip="Rolle unbekannt" tipSub="Weder ein Log noch die Spec sagen, was der Charakter spielt.">–</Badge>;
    const meta = ROLE_META[role];
    return (
        <Badge
            icon={meta.icon}
            tip={meta.label}
            tipSub="Die Rolle aus dem neuesten Log, in dem der Charakter vorkommt; ohne Log aus der Spec."
        >
            {meta.label}
        </Badge>
    );
}

/** The attendance of one category as a fixed-width WCL bar with the missed nights in its tooltip. */
export function AttendanceBar({ attendance, categoryName }: { attendance: RosterAttendance | undefined; categoryName: string }) {
    if (!attendance || !attendance.total) {
        return (
            <span
                className="bar rc-bar is-empty"
                data-tip="Keine Raids gezählt"
                data-tip-sub={`${categoryName || "Diese Kategorie"}: kein zugeordnetes Log, in dem der Charakter vorkommen könnte, und keine Raider-Zuordnung, deren Anmeldungen zählen.`}
            >
                <span>–</span>
            </span>
        );
    }
    const { attended, total, pct, missed } = attendance;
    const lines = [`${categoryName || "Kategorie"}, gezählt aus Anmeldungen und Logs der letzten ${total} Raids.`];
    if (missed.length) lines.push(`Gefehlt: ${missed.map((m) => `${nightLabel(m.startTime)} (${m.reason})`).join(", ")}.`);
    else lines.push("Keinen gezählten Raid verpasst.");
    return (
        <span className={`bar rc-bar ${attendanceTone(pct) || ""}`} data-tip={`${attended} von ${total} Raids · ${pct} %`} data-tip-sub={lines.join("\n")}>
            <i style={{ width: `${pct}%` }} />
            <span>{pct} %<small>{attended}/{total}</small></span>
        </span>
    );
}

function plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
}

/** Gear state of the newest evaluation: clean, n findings, or never evaluated. */
export function GearStateBadge({ gear }: { gear: CharGearReport | null }) {
    if (!gear) {
        return (
            <Badge icon="inv_misc_pocketwatch_01" tip="nicht ausgewertet" tipSub="Der Charakter kommt in keiner der gespeicherten Log-Auswertungen vor.">
                nicht ausgewertet
            </Badge>
        );
    }
    const when = gear.generatedAt ? fmtMs(gear.generatedAt, false) : "";
    const source = [gear.reportTitle || gear.zone, when].filter(Boolean).join(" · ");
    if (!gear.issueCount) {
        return <Badge tone="ok" icon="trade_engraving" tip="Sauber" tipSub={`Keine Gear-Probleme in der Auswertung ${source}.`}>Sauber</Badge>;
    }
    const high = gear.issues.filter((i) => i.severity === "high").length;
    const summary = gear.issues.slice(0, 4).map((i) => `${i.slotName || i.itemName || "Gear"}: ${i.label}`);
    if (gear.issues.length > 4) summary.push(`… und ${gear.issues.length - 4} weitere auf der Charakter-Seite`);
    return (
        <Badge
            tone={high ? "bad" : "mid"}
            icon="inv_misc_gem_variety_02"
            tip={`${plural(gear.issueCount, "Gear-Problem", "Gear-Probleme")}${high ? ` · ${high} schwer` : ""}`}
            tipSub={`${summary.join("\n")}\nAus der Auswertung ${source}.`}
        >
            {plural(gear.issueCount, "Problem", "Probleme")}
        </Badge>
    );
}

/** Loot count linking to the character's loot history, the newest items in its tooltip. */
export function LootBadge({ count, items, to }: { count: number; items: CharLootPreview[]; to: string }) {
    const shown = items.slice(0, 6).map((it) => {
        const meta = [it.reasonLabel, it.awardedAt ? nightLabel(it.awardedAt) : ""].filter(Boolean).join(" · ");
        return `${it.itemName || `Item ${it.itemId}`}${meta ? ` — ${meta}` : ""}`;
    });
    if (count > shown.length && shown.length) shown.push(`… und ${count - shown.length} weitere`);
    const sub = count ? `${shown.join("\n")}\nKlick öffnet die ganze Loot-Historie.` : "Noch kein Loot importiert.";
    return (
        <Link className="rc-badge-link" to={to} data-tip={count ? `${plural(count, "Item", "Items")} erhalten` : "Kein Loot"} data-tip-sub={sub}>
            <Badge icon="inv_misc_bag_10">{count}</Badge>
        </Link>
    );
}

/** A square icon link (WCL, Armory) — IconButton's look on an <a>, since these leave the page. */
export function IconLink({ href, icon, tip, size = "sm" }: { href: string; icon: string; tip: string; size?: "sm" | "md" }) {
    if (!href) return null;
    return (
        <a
            className={`ibtn${size === "sm" ? " sm" : ""}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={tip}
            data-tip={tip}
        >
            <WowIcon name={icon} size={size === "sm" ? 20 : 24} />
        </a>
    );
}

/** A dotted-underlined label that explains itself (table heads, KPI labels). */
export function TipLabel({ tip, sub, className = "", children }: { tip: string; sub?: string; className?: string; children: ReactNode }) {
    return <span className={`tipped ${className}`.trim()} data-tip={tip} data-tip-sub={sub} tabIndex={0}>{children}</span>;
}
