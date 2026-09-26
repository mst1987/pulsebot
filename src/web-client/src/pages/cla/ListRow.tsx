import type { ReactNode } from "react";
import type { ClaRow, ClaRaid, LogSection } from "../../api";
import { formatEventTime } from "../../lib/format";
import { raidCount, raidIcon, raidTip } from "../../lib/logRaids";
import { CheckIcon, ExternalIcon, TrashIcon } from "../../components/icons";
import { Button, buttonClass } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import WowIcon from "../../components/ui/WowIcon";
import { ANALYSES, discordUrl, fmtEventDay, fmtPosted, formatMatchOffset } from "./shared";
import { type MenuItem, RowMenu } from "./RowMenu";
import { UndoIcon } from "./ClaIcons";

// ---- one list row ----

function RaidBadges({ row }: { row: ClaRow }) {
    if (!row.raids.length) {
        return row.zone
            ? <Badge className="plain" tip={row.zone} tipSub="Die Bosse dieses Logs sind noch nicht gelesen.">{row.zone}</Badge>
            : <Badge className="plain" tip="Inhalt unbekannt" tipSub="Warcraft Logs hat die Kampfliste noch nicht geliefert – sie wird beim nächsten Laden erneut abgefragt.">–</Badge>;
    }
    return (
        <>
            {row.raids.map((r: ClaRaid) => {
                const tip = raidTip(r);
                return (
                    <Badge key={r.contentId} tone={r.finalKilled ? "ok" : "mid"} icon={raidIcon(r.contentId)} tip={tip.head} tipSub={tip.sub}>
                        {raidCount(r)}
                    </Badge>
                );
            })}
        </>
    );
}

function EvalBadges({ row, running }: { row: ClaRow; running: LogSection[] }) {
    const r = row.report;
    const stats = r && r.generatedAt
        ? `${fmtPosted(r.generatedAt)} · ${r.playerCount} Spieler · ${r.issueCount} Probleme`
        : "";
    const anyDone = row.sections.length > 0;
    const badges = ANALYSES.flatMap((a) => {
        if (running.includes(a.key)) {
            return [<Badge key={a.key} tone="accent" icon={<span className="btn-spin" aria-hidden="true" />} tip={`${a.label} läuft`} tipSub="Fortschritt im Hinweis unten in der Mitte.">{a.label} läuft</Badge>];
        }
        if (row.sections.includes(a.key)) {
            return [<Badge key={a.key} tone="ok" icon={<CheckIcon />} tip={`${a.label} ausgewertet`} tipSub={stats || a.sub}>{a.label}</Badge>];
        }
        // the missing half of a log that is half done; a link report cannot be completed
        if (anyDone && row.kind === "log") {
            return [<Badge key={a.key} tip={`${a.label} offen`} tipSub={a.sub}>{a.label} offen</Badge>];
        }
        return [];
    });
    if (!badges.length) {
        return <Badge tip="Noch nicht ausgewertet" tipSub="„Auswerten“ startet CLA und RPB nacheinander, beide landen auf einer Report-Seite.">offen</Badge>;
    }
    return <>{badges}</>;
}

function EventCell({ row, eventsError, onAssign }: { row: ClaRow; eventsError: string | null; onAssign: () => void }) {
    if (row.eventId) {
        const when = row.eventStartTime ? formatEventTime(row.eventStartTime) : "";
        return (
            <Badge
                tone="accent" icon="inv_misc_note_02" className="plain la-event"
                tip={row.eventLabel || "Raid-Event"}
                tipSub={`${when ? `Start ${when} · ` : ""}${row.eventLinkSource === "auto" ? "automatisch zugeordnet" : "manuell zugeordnet"}. Ändern über das Zeilenmenü.`}
            >
                {row.eventLabel || row.eventId}{row.eventStartTime ? ` · ${fmtEventDay(row.eventStartTime)}` : ""}
            </Badge>
        );
    }
    if (row.kind === "report") {
        return <Badge className="plain" tip="Ohne Log nicht zuordenbar" tipSub="Dieser Report wurde per Link erstellt. Zugeordnet wird ein Log – postet den Link im Log-Channel, dann erscheint er als Log.">ohne Log</Badge>;
    }
    if (eventsError) {
        return <Badge tone="bad" className="plain" tip="Raid-Events nicht geladen" tipSub={eventsError}>Events fehlen</Badge>;
    }
    const cands = row.candidates || [];
    if (!cands.length) {
        return <Badge className="plain" tip="Kein passendes Event" tipSub="Kein Raid-Event hat eine Startzeit, die zur Post-Zeit dieses Logs passt.">kein passendes Event</Badge>;
    }
    return (
        <Button
            variant="ghost" size="sm" icon="inv_misc_note_02" onClick={onAssign}
            data-tip={row.matchAmbiguous ? "Mehrere Events passen" : "Passendes Event gefunden"}
            data-tip-sub={row.matchAmbiguous ? "Die Startzeiten liegen nah beieinander – bitte prüfen." : `${cands[0].title} · ${formatMatchOffset(cands[0].diffMs)}`}
        >
            Zuordnen <Badge count tone={row.matchAmbiguous ? "mid" : undefined}>{cands.length}</Badge>
        </Button>
    );
}

export function ListRow({ row, running, eventsError, onEvaluate, onAssign, onReset, onDeleteLog, onDeleteReport }: {
    row: ClaRow;
    running: LogSection[];
    eventsError: string | null;
    onEvaluate: (section: LogSection | "both") => void;
    onAssign: () => void;
    onReset: (section: LogSection) => void;
    onDeleteLog: () => void;
    onDeleteReport: () => void;
}) {
    const icon = raidIcon(row.raids[0]?.contentId);
    const missing = ANALYSES.filter((a) => !row.sections.includes(a.key));
    const discord = discordUrl(row);
    const where = [row.categoryName, row.channelName ? `#${row.channelName}` : ""].filter(Boolean).join(" · ");

    let action: ReactNode;
    if (running.length) {
        action = <Button variant="run" size="sm" running>läuft</Button>;
    } else if (row.kind === "log" && !row.sections.length) {
        action = (
            <Button variant="run" size="sm" icon="inv_misc_pocketwatch_01" data-tip="CLA + RPB auswerten" data-tip-sub="Beide Hälften nacheinander, eine Report-Seite." onClick={() => onEvaluate("both")}>
                Auswerten
            </Button>
        );
    } else if (row.kind === "log" && missing.length) {
        const a = missing[0];
        action = (
            <Button variant="run" size="sm" icon={a.icon} data-tip={`${a.label} auswerten`} data-tip-sub={a.sub} onClick={() => onEvaluate(a.key)}>
                {a.label}
            </Button>
        );
    } else if (row.report) {
        action = <a className={buttonClass("ghost", "sm", true)} href={row.report.url}><WowIcon name="inv_scroll_03" size={18} />Report</a>;
    }

    const items: MenuItem[] = [
        ...(row.report ? [{ id: "report", label: "Report öffnen", icon: <WowIcon name="inv_scroll_03" size={20} />, href: row.report.url }] : []),
        ...(row.wclUrl ? [{ id: "wcl", label: "Log bei Warcraft Logs", icon: <ExternalIcon />, href: row.wclUrl, external: true }] : []),
        ...(discord ? [{ id: "msg", label: "Nachricht im Log-Channel", icon: <WowIcon name="inv_letter_15" size={20} />, href: discord, external: true }] : []),
        "sep",
        ...(row.kind === "log"
            ? [{ id: "assign", label: row.eventId ? "Zuordnung ändern" : "Raid-Event zuordnen", icon: <WowIcon name="inv_misc_note_02" size={20} />, onSelect: onAssign }]
            : []),
        ...(row.kind === "log"
            ? ANALYSES.filter((a) => row.sections.includes(a.key)).map((a) => ({ id: `reset-${a.key}`, label: `${a.label}-Auswertung verwerfen`, icon: <UndoIcon />, onSelect: () => onReset(a.key) }))
            : []),
        "sep",
        row.kind === "log"
            ? { id: "delete", label: "Aus der Liste löschen", icon: <TrashIcon />, onSelect: onDeleteLog, danger: true }
            : { id: "delete", label: "Auswertung löschen", icon: <TrashIcon />, onSelect: onDeleteReport, danger: true },
    ];

    return (
        <div className={`la-row${running.length ? " running" : ""}`} role="row">
            <WowIcon name={icon} size={36} className="la-zicon" />
            <div className="la-cell-main" role="cell">
                <span className="la-title" data-tip={row.title} data-tip-sub={where || (row.source === "link" ? "Per Link ausgewertet" : undefined)}>{row.title || row.reportId}</span>
                <span className="la-meta">
                    {fmtPosted(row.postedAt)}
                    {row.source === "channel"
                        ? <>{" · "}<WowIcon name="inv_letter_15" size={14} />{row.channelName ? `#${row.channelName}` : "Log-Channel"}</>
                        : <>{" · "}<ExternalIcon />Link</>}
                </span>
            </div>
            <div className="la-badges" role="cell" data-label="Inhalt"><RaidBadges row={row} /></div>
            <div className="la-badges" role="cell" data-label="Auswertung"><EvalBadges row={row} running={running} /></div>
            <div className="la-badges" role="cell" data-label="Raid-Event"><EventCell row={row} eventsError={eventsError} onAssign={onAssign} /></div>
            <div className="la-actions" role="cell">
                {action}
                <RowMenu items={items} label={`Weitere Aktionen für „${row.title || row.reportId}“`} />
            </div>
        </div>
    );
}
