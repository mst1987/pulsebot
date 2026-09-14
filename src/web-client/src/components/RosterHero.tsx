// The Roster page's KPI row (design issue #218): four tiles, each with a WoW
// icon tile, one figure and — where a share is the point — a meter. It replaced
// the hero band with its big figure, the class strip and the legend: the class
// filter moved into the list's filter row, and the explanations into tooltips.
//
// The "Gear-Probleme" tile *is* the filter switch that used to be a checkbox
// plus a reset button. Every number is folded server-side (web/rosterStats.js)
// over the same rows the list renders, so header and list cannot disagree, and
// it stays on the whole roster: a headline that shrinks while you type would
// answer a different question than the one it asks.
import type { ReactNode } from "react";
import type { RosterStats } from "../api";
import { IconTile, type TileTone } from "./ui";
import { attendanceTone, share } from "../lib/rosterView";

type KpiTone = "accent" | "ok" | "mid" | "warn" | "none";

function Kpi({ icon, tone, label, tip, tipSub, value, of, meter, onClick, active }: {
    icon: string;
    tone: KpiTone;
    label: string;
    tip: string;
    tipSub?: string;
    value: ReactNode;
    of?: ReactNode;
    /** Meter fill in percent; no meter when undefined. */
    meter?: number;
    /** Makes the tile a filter toggle instead of a read-only figure. */
    onClick?: () => void;
    active?: boolean;
}) {
    const tileTone: TileTone = tone === "warn" ? "bad" : tone === "accent" ? "roster" : tone;
    const body = (
        <>
            <IconTile icon={icon} tone={tileTone} />
            <span className="rc-kpi-body">
                <span className="rc-kpi-label" data-tip={tip} data-tip-sub={tipSub}>{label}</span>
                <span className="rc-kpi-value">{value}{of !== undefined && <span className="rc-kpi-of">{of}</span>}</span>
                {meter !== undefined && <span className="rc-meter" aria-hidden="true"><i style={{ width: `${meter}%` }} /></span>}
            </span>
        </>
    );
    const cls = `rc-kpi is-${tone}${onClick ? " is-toggle" : ""}${active ? " is-active" : ""}`;
    if (!onClick) return <div className={cls}>{body}</div>;
    return <button type="button" className={cls} aria-pressed={active} onClick={onClick}>{body}</button>;
}

export function RosterKpis({ stats, onlyIssues, onToggleIssues }: {
    stats: RosterStats;
    onlyIssues: boolean;
    onToggleIssues: () => void;
}) {
    const { total, loot, evaluated, withIssues, issues, highIssues, assigned, fromLootOnly, avgAttendance, attendanceCounted } = stats;
    const avgLoot = total ? Math.round((loot / total) * 10) / 10 : 0;
    const attTone = attendanceTone(avgAttendance);
    return (
        <div className="rc-kpis">
            <Kpi
                icon="achievement_guildperk_everybodysfriend"
                tone="accent"
                label="Charaktere"
                tip={`${total} Charakter${total === 1 ? "" : "e"}`}
                tipSub={`${evaluated} ausgewertet · ${assigned} zugeordnet · ${fromLootOnly} nur aus Loot`}
                value={total}
            />
            <Kpi
                icon="ability_warrior_rallyingcry"
                tone={attTone === "bad" ? "warn" : attTone || "none"}
                label="Ø Anwesenheit"
                tip={avgAttendance === null ? "Noch keine Anwesenheit gezählt" : `Ø ${avgAttendance} % Anwesenheit`}
                tipSub={avgAttendance === null
                    ? "Gezählt wird aus Raid-Helper-Anmeldungen und den Logs, die einem Raid-Event zugeordnet sind."
                    : `Mittel über ${attendanceCounted} Charakter${attendanceCounted === 1 ? "" : "e"} mit gezählten Raids, je Kategorie die letzten 11 Raids.`}
                value={avgAttendance === null ? "–" : avgAttendance}
                of={avgAttendance === null ? undefined : "%"}
                meter={avgAttendance === null ? undefined : avgAttendance}
            />
            <Kpi
                icon="inv_misc_gem_variety_02"
                tone={withIssues ? "warn" : "ok"}
                label="Gear-Probleme"
                tip={onlyIssues ? "Filter aufheben" : "Nur Charaktere mit Gear-Problemen zeigen"}
                tipSub={issues
                    ? `${withIssues} von ${evaluated} ausgewerteten Charakteren · ${issues} Befund${issues === 1 ? "" : "e"}${highIssues ? `, ${highIssues} schwer` : ""}`
                    : "Keine Befunde in den letzten Auswertungen."}
                value={withIssues}
                of={`/ ${evaluated}`}
                meter={share(withIssues, evaluated)}
                onClick={onToggleIssues}
                active={onlyIssues}
            />
            <Kpi
                icon="inv_misc_bag_10"
                tone="none"
                label="Loot-Items"
                tip={`${loot} importierte Items`}
                tipSub={`Ø ${avgLoot} je Charakter`}
                value={loot}
            />
        </div>
    );
}
