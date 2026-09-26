import type { ReactNode } from "react";
import type { ClaRow, ClaRaid, LogSection } from "../../api";
import { formatEventTime } from "../../lib/format";
import { raidCount, raidIcon, raidTip } from "../../lib/logRaids";
import { CheckIcon, ExternalIcon, TrashIcon } from "../../components/icons";
import { Button, buttonClass } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import WowIcon from "../../components/ui/WowIcon";
import { tParts, useT } from "../../i18n";
import { ANALYSES, discordUrl, fmtEventDay, fmtPosted, formatMatchOffset } from "./shared";
import { type MenuItem, RowMenu } from "./RowMenu";
import { UndoIcon } from "./ClaIcons";

// ---- one list row ----

function RaidBadges({ row }: { row: ClaRow }) {
    const t = useT();
    if (!row.raids.length) {
        return row.zone
            ? <Badge className="plain" tip={row.zone} tipSub={t("cla.raids.zoneSub")}>{row.zone}</Badge>
            : <Badge className="plain" tip={t("cla.raids.unknown")} tipSub={t("cla.raids.unknownSub")}>–</Badge>;
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
    const t = useT();
    const r = row.report;
    const stats = r && r.generatedAt
        ? `${fmtPosted(r.generatedAt)} · ${t("cla.badges.players", { count: r.playerCount })} · ${t("cla.badges.issues", { count: r.issueCount })}`
        : "";
    const anyDone = row.sections.length > 0;
    const badges = ANALYSES.flatMap((a) => {
        if (running.includes(a.key)) {
            return [<Badge key={a.key} tone="accent" icon={<span className="btn-spin" aria-hidden="true" />} tip={t("cla.badges.running", { label: a.label })} tipSub={t("cla.badges.runningSub")}>{tParts("cla.badges.running", { label: a.label })}</Badge>];
        }
        if (row.sections.includes(a.key)) {
            return [<Badge key={a.key} tone="ok" icon={<CheckIcon />} tip={t("cla.badges.done", { label: a.label })} tipSub={stats || a.sub}>{a.label}</Badge>];
        }
        // the missing half of a log that is half done; a link report cannot be completed
        if (anyDone && row.kind === "log") {
            return [<Badge key={a.key} tip={t("cla.badges.open", { label: a.label })} tipSub={a.sub}>{tParts("cla.badges.open", { label: a.label })}</Badge>];
        }
        return [];
    });
    if (!badges.length) {
        return <Badge tip={t("cla.badges.noneTip")} tipSub={t("cla.badges.noneSub")}>{t("cla.badges.none")}</Badge>;
    }
    return <>{badges}</>;
}

function EventCell({ row, eventsError, onAssign }: { row: ClaRow; eventsError: string | null; onAssign: () => void }) {
    const t = useT();
    if (row.eventId) {
        const when = row.eventStartTime ? formatEventTime(row.eventStartTime) : "";
        return (
            <Badge
                tone="accent" icon="inv_misc_note_02" className="plain la-event"
                tip={row.eventLabel || t("cla.event.fallback")}
                tipSub={t("cla.event.sub", { start: when ? t("cla.event.start", { when }) : "", source: row.eventLinkSource === "auto" ? t("cla.event.auto") : t("cla.event.manual") })}
            >
                {row.eventLabel || row.eventId}{row.eventStartTime ? ` · ${fmtEventDay(row.eventStartTime)}` : ""}
            </Badge>
        );
    }
    if (row.kind === "report") {
        return <Badge className="plain" tip={t("cla.event.reportTip")} tipSub={t("cla.event.reportSub")}>{t("cla.event.report")}</Badge>;
    }
    if (eventsError) {
        return <Badge tone="bad" className="plain" tip={t("cla.event.errorTip")} tipSub={eventsError}>{t("cla.event.error")}</Badge>;
    }
    const cands = row.candidates || [];
    if (!cands.length) {
        return <Badge className="plain" tip={t("cla.event.noneTip")} tipSub={t("cla.event.noneSub")}>{t("cla.event.none")}</Badge>;
    }
    return (
        <Button
            variant="ghost" size="sm" icon="inv_misc_note_02" onClick={onAssign}
            data-tip={row.matchAmbiguous ? t("cla.event.ambiguous") : t("cla.event.found")}
            data-tip-sub={row.matchAmbiguous ? t("cla.event.ambiguousSub") : `${cands[0].title} · ${formatMatchOffset(cands[0].diffMs)}`}
        >
            {t("cla.event.assign")} <Badge count tone={row.matchAmbiguous ? "mid" : undefined}>{cands.length}</Badge>
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
    const t = useT();
    const icon = raidIcon(row.raids[0]?.contentId);
    const missing = ANALYSES.filter((a) => !row.sections.includes(a.key));
    const discord = discordUrl(row);
    const where = [row.categoryName, row.channelName ? `#${row.channelName}` : ""].filter(Boolean).join(" · ");

    let action: ReactNode;
    if (running.length) {
        action = <Button variant="run" size="sm" running>{t("cla.row.running")}</Button>;
    } else if (row.kind === "log" && !row.sections.length) {
        action = (
            <Button variant="run" size="sm" icon="inv_misc_pocketwatch_01" data-tip={t("cla.row.evaluateBoth")} data-tip-sub={t("cla.row.evaluateBothSub")} onClick={() => onEvaluate("both")}>
                {t("cla.row.evaluate")}
            </Button>
        );
    } else if (row.kind === "log" && missing.length) {
        const a = missing[0];
        action = (
            <Button variant="run" size="sm" icon={a.icon} data-tip={t("cla.row.evaluateOne", { label: a.label })} data-tip-sub={a.sub} onClick={() => onEvaluate(a.key)}>
                {a.label}
            </Button>
        );
    } else if (row.report) {
        action = <a className={buttonClass("ghost", "sm", true)} href={row.report.url}><WowIcon name="inv_scroll_03" size={18} />{t("cla.row.report")}</a>;
    }

    const items: MenuItem[] = [
        ...(row.report ? [{ id: "report", label: t("cla.menu.openReport"), icon: <WowIcon name="inv_scroll_03" size={20} />, href: row.report.url }] : []),
        ...(row.wclUrl ? [{ id: "wcl", label: t("cla.menu.wcl"), icon: <ExternalIcon />, href: row.wclUrl, external: true }] : []),
        ...(discord ? [{ id: "msg", label: t("cla.menu.message"), icon: <WowIcon name="inv_letter_15" size={20} />, href: discord, external: true }] : []),
        "sep",
        ...(row.kind === "log"
            ? [{ id: "assign", label: row.eventId ? t("cla.menu.changeAssign") : t("cla.menu.assign"), icon: <WowIcon name="inv_misc_note_02" size={20} />, onSelect: onAssign }]
            : []),
        ...(row.kind === "log"
            ? ANALYSES.filter((a) => row.sections.includes(a.key)).map((a) => ({ id: `reset-${a.key}`, label: t("cla.menu.reset", { label: a.label }), icon: <UndoIcon />, onSelect: () => onReset(a.key) }))
            : []),
        "sep",
        row.kind === "log"
            ? { id: "delete", label: t("cla.menu.deleteLog"), icon: <TrashIcon />, onSelect: onDeleteLog, danger: true }
            : { id: "delete", label: t("cla.menu.deleteReport"), icon: <TrashIcon />, onSelect: onDeleteReport, danger: true },
    ];

    return (
        <div className={`la-row${running.length ? " running" : ""}`} role="row">
            <WowIcon name={icon} size={36} className="la-zicon" />
            <div className="la-cell-main" role="cell">
                <span className="la-title" data-tip={row.title} data-tip-sub={where || (row.source === "link" ? t("cla.row.viaLink") : undefined)}>{row.title || row.reportId}</span>
                <span className="la-meta">
                    {fmtPosted(row.postedAt)}
                    {row.source === "channel"
                        ? <>{" · "}<WowIcon name="inv_letter_15" size={14} />{row.channelName ? `#${row.channelName}` : t("cla.row.logChannel")}</>
                        : <>{" · "}<ExternalIcon />{t("cla.row.link")}</>}
                </span>
            </div>
            <div className="la-badges" role="cell" data-label={t("cla.columns.content")}><RaidBadges row={row} /></div>
            <div className="la-badges" role="cell" data-label={t("cla.columns.evaluation")}><EvalBadges row={row} running={running} /></div>
            <div className="la-badges" role="cell" data-label={t("cla.columns.event")}><EventCell row={row} eventsError={eventsError} onAssign={onAssign} /></div>
            <div className="la-actions" role="cell">
                {action}
                <RowMenu items={items} label={t("cla.row.moreActions", { title: row.title || row.reportId })} />
            </div>
        </div>
    );
}
