import { Fragment, useState, type MouseEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { PastRaid, RaidListBase, UpcomingRaid } from "../../api";
import { useTableSort, type Dir } from "../../lib/ui/tableSort";
import { eventPostUrl, raidplanUrl } from "../../lib/discord/discordLinks";
import { relativeDayLabel } from "../../lib/format";
import { eventDay, monthBands, weekBands, type TimeBand } from "../../lib/raids/raidTime";
import { withRaidGroups } from "../../lib/raids/raidGroups";
import RaidIcon from "../../components/raid/RaidIcon";
import WowIcon from "../../components/ui/WowIcon";
import Badge from "../../components/ui/Badge";
import Bar from "../../components/ui/Bar";
import Expand from "../../components/ui/Expand";
import { IconButton } from "../../components/ui/Button";
import { ChevronDownIcon, ChevronRightIcon } from "../../components/ui/icons";
import { useT } from "../../i18n";

// The Raid-Events list: one grid list (.glist), grouped by time — coming raids
// by week, past raids by month — sorted by date, the one column worth ordering.
// Signals instead of text: signups as a bar against the raid size, logs and loot
// as badges whose tooltips carry the names, links as icon buttons. The whole row
// opens the event's detail page.
// A raid group (#811): the further raids of an evening stand indented under the
// first raid ("Zul'Aman · 2 Raids"), whose bar counts every place of the group.

type SortKey = "time";
const SORT_DEFAULTS: Record<SortKey, Dir> = { time: "asc" };

const detailHref = (id: string, tab?: string) => `/raids/detail?event=${encodeURIComponent(id)}${tab ? `&tab=${tab}` : ""}`;

/** An external link styled as a square icon button. */
function IconLink({ href, icon, tip, tipSub }: { href: string; icon: string; tip: string; tipSub?: string }) {
    return (
        <a className="ibtn sm" href={href} target="_blank" rel="noopener noreferrer" aria-label={tip} data-tip={tip} data-tip-sub={tipSub}>
            <WowIcon name={icon} size={20} />
        </a>
    );
}

/** The chevron into the detail page — a link, so it opens in a new tab on a middle click too. */
function DetailLink({ id }: { id: string }) {
    const t = useT();
    return (
        <Link className="ibtn sm re-go" to={detailHref(id)} aria-label={t("raids.list.openEvent")} data-tip={t("raids.list.openEvent")} data-tip-sub={t("raids.list.openEventSub")}>
            <ChevronRightIcon />
        </Link>
    );
}

/** Row click → detail page, unless the click landed on one of the row's own controls. */
function useRowOpen() {
    const navigate = useNavigate();
    return (id: string) => (e: MouseEvent<HTMLDivElement>) => {
        if ((e.target as HTMLElement).closest("a, button")) return;
        navigate(detailHref(id));
    };
}

function SortHead({ dir, onSort }: { dir: Dir; onSort: () => void }) {
    const t = useT();
    return (
        <button type="button" className={`re-sort${dir === "asc" ? " up" : ""}`} onClick={onSort} aria-label={t("raids.list.sortByTime", { dir: dir === "asc" ? t("raids.list.asc") : t("raids.list.desc") })}>
            {t("raids.list.time")} <ChevronDownIcon />
        </button>
    );
}

function EventTitle({ ev, raids = 0 }: { ev: { id: string; title: string; channelName: string; categoryName: string }; raids?: number }) {
    const t = useT();
    return (
        <div className="re-ev">
            <span className="re-title-line">
                <Link className="re-title" to={detailHref(ev.id)}>{ev.title || t("raids.list.untitled")}</Link>
                {/* a raid group (#811): "Zul'Aman · 2 Raids" */}
                {raids > 1 && <Badge tone="accent" size="sm" tip={t("raids.list.groupRaidsTip", { count: raids })} tipSub={t("raids.list.groupRaidsSub")}>{t("raids.list.groupRaids", { count: raids })}</Badge>}
            </span>
            <div className="re-sub">
                {ev.channelName && <span className="re-chan">#{ev.channelName}</span>}
                {ev.channelName && ev.categoryName && <span aria-hidden="true">·</span>}
                {ev.categoryName && <span>{ev.categoryName}</span>}
            </div>
        </div>
    );
}

function Band({ band, extra }: { band: TimeBand<unknown>; extra?: ReactNode }) {
    return (
        <div className="re-band">
            <b>{band.label}</b>
            {band.range && <span>{band.range}</span>}
            <Badge count className="re-band-n">{band.rows.length}</Badge>
            {extra}
        </div>
    );
}

// ---------------------------------------------------------------- coming

function signupTone(n: number, size: number): "ok" | "mid" | undefined {
    const pct = size > 0 ? n / size : 0;
    if (pct >= 0.9) return "ok";
    if (pct >= 0.5) return undefined;
    return "mid";
}

export function UpcomingRaidList({ events, guildId, canWrite, onRepeat, emptyMessage }: {
    events: UpcomingRaid[];
    guildId: string;
    canWrite: boolean;
    onRepeat: (id: string) => void;
    emptyMessage: string;
}) {
    const t = useT();
    const { dir, onSort, apply } = useTableSort<SortKey>("raid-list-upcoming-sort", SORT_DEFAULTS, "time", "asc");
    const open = useRowOpen();
    if (!events.length) return <div className="glist re-glist"><div className="re-empty">{emptyMessage}</div></div>;
    const bands = weekBands(apply(withRaidGroups(events), (ev) => ev.startTime || 0));

    return (
        <div className="glist re-glist re-up" role="table" aria-label={t("raids.list.upcomingAria")}>
            <div className="re-head" role="row">
                <span />
                <span>{t("raids.list.event")}</span>
                <SortHead dir={dir} onSort={() => onSort("time")} />
                <span className="tipped" data-tip={t("raids.list.signups")} data-tip-sub={t("raids.list.signupsSub")}>{t("raids.list.signups")}</span>
                <span className="re-right">{t("raids.list.actions")}</span>
            </div>
            {bands.map((band) => (
                <div key={band.key} role="rowgroup">
                    <Band band={band} />
                    {band.rows.map((ev) => {
                        const { day, time } = eventDay(ev.startTime);
                        const further = ev.groupRaids || [];
                        // a raid group (#811): one signup for every raid — the bar measures against all their places
                        const places = ev.raidSize + further.reduce((n, r) => n + (r.raidSize || 0), 0);
                        return (
                            <Fragment key={ev.id}>
                            <div className="re-row" role="row" onClick={open(ev.id)}>
                                <RaidIcon contentIds={ev.contentIds} sources={ev.contentSources} />
                                <EventTitle ev={ev} raids={further.length ? further.length + 1 : 0} />
                                <div className="re-when"><b>{day}</b><span>{time} · {relativeDayLabel(ev.startTime)}</span></div>
                                <span
                                    className="re-bar"
                                    data-tip={t("raids.list.seatsOf", { count: ev.signupCount, size: places })}
                                    data-tip-sub={ev.raidSizeKnown ? t("raids.list.sizeKnown") : t("raids.list.sizeDefault")}
                                >
                                    <Bar value={ev.signupCount} max={places} tone={signupTone(ev.signupCount, places)} label={`${ev.signupCount} / ${places}`} />
                                </span>
                                <div className="re-acts">
                                    {ev.channelState === "missing" && <Badge tone="bad" tip={t("raids.list.channelMissing")} tipSub={t("raids.list.channelMissingSub")}>{t("raids.list.channelMissing")}</Badge>}
                                    {eventPostUrl(guildId, ev.channelId, ev.id, ev.channelState) && (
                                        <IconLink href={eventPostUrl(guildId, ev.channelId, ev.id, ev.channelState)} icon="inv_letter_15" tip={t("raids.list.discordPost")} tipSub={ev.channelName ? t("raids.list.discordPostSubIn", { channel: ev.channelName }) : t("raids.list.discordPostSub")} />
                                    )}
                                    {raidplanUrl(ev.id) && <IconLink href={raidplanUrl(ev.id)} icon="inv_misc_groupneedmore" tip={t("raids.list.setup")} tipSub={t("raids.list.setupSub")} />}
                                    {ev.softres?.url && <IconLink href={ev.softres.url} icon="inv_scroll_11" tip="Softres" tipSub={t("raids.list.softresSub")} />}
                                    {canWrite && (
                                        <IconButton icon="spell_holy_borrowedtime" size="sm" tip={t("raids.list.repeat")} tipSub={t("raids.list.repeatSub")} onClick={() => onRepeat(ev.id)} />
                                    )}
                                    <DetailLink id={ev.id} />
                                </div>
                            </div>
                            {further.map((r) => <FurtherRaidRow key={r.id} raid={r} head={ev.title} onOpen={open(r.id)} />)}
                            </Fragment>
                        );
                    })}
                </div>
            ))}
        </div>
    );
}

/** A further raid of a group (#811) under its first raid: "Raid 2 · Zul'Aman 2", the signup is the first raid's. */
function FurtherRaidRow({ raid, head, onOpen, children }: { raid: RaidListBase; head: string; onOpen: (e: MouseEvent<HTMLDivElement>) => void; children?: ReactNode }) {
    const t = useT();
    return (
        <div className="re-row re-subrow" role="row" onClick={onOpen}>
            <span className="re-subrow-mark" aria-hidden="true">↳</span>
            <div className="re-ev">
                <span className="re-title-line">
                    <Badge size="sm">{t("raids.list.groupRaid", { index: raid.raidGroupIndex || 2 })}</Badge>
                    <Link className="re-title" to={detailHref(raid.id)}>{raid.title || t("raids.list.untitled")}</Link>
                </span>
            </div>
            <div className="re-when" />
            {children || <span className="re-subrow-note">{t("raids.list.groupShared", { title: head })}</span>}
            <div className="re-acts"><DetailLink id={raid.id} /></div>
        </div>
    );
}

// ---------------------------------------------------------------- past

function LogBadges({ ev }: { ev: PastRaid }) {
    const t = useT();
    const done = ev.logs.filter((l) => l.status === "done");
    const assigned = ev.logs.filter((l) => l.status !== "done");
    const pending = ev.pendingLogs || [];
    const names = (logs: { title?: string; reportId?: string }[]) => logs.map((l) => t("raids.list.logName", { title: l.title || l.reportId || t("raids.list.logFallback") })).join("\n");
    const badges: ReactNode[] = [];
    if (done.length) {
        badges.push(
            <Link key="done" className="re-blink" to={detailHref(ev.id, "logs")}>
                <Badge tone="ok" icon="inv_misc_pocketwatch_01" tip={t("raids.list.analysed", { count: done.length })} tipSub={`${names(done)}\n${t("raids.list.analysedSub")}`}>{t("raids.list.analysed", { count: done.length })}</Badge>
            </Link>,
        );
    }
    if (assigned.length) {
        badges.push(
            <Link key="assigned" className="re-blink" to={detailHref(ev.id, "logs")}>
                <Badge icon="inv_misc_pocketwatch_01" tip={t("raids.list.assignedTip", { count: assigned.length })} tipSub={`${names(assigned)}\n${t("raids.list.assignedSub")}`}>{t("raids.list.assigned", { count: assigned.length })}</Badge>
            </Link>,
        );
    }
    if (pending.length) {
        const lines = pending.map((l) => (l.alsoFits.length
            ? t("raids.list.pendingAlsoFits", { title: l.title || t("raids.list.logFallback"), others: l.alsoFits.join(", ") })
            : t("raids.list.pendingFits", { title: l.title || t("raids.list.logFallback") })));
        badges.push(
            <Link key="pending" className="re-blink" to={detailHref(ev.id, "logs")}>
                <Badge tone="mid" icon="inv_misc_pocketwatch_01" tip={t("raids.list.pendingTip", { count: pending.length })} tipSub={`${lines.join("\n")}\n${t("raids.list.pendingSub")}`}>{t("raids.list.pending", { count: pending.length })}</Badge>
            </Link>,
        );
    }
    if (!badges.length) return <Badge tip={t("raids.list.noLogs")} tipSub={t("raids.list.noLogsSub")}>{t("raids.list.noLogsBadge")}</Badge>;
    return <>{badges}</>;
}

function LootBadge({ ev }: { ev: PastRaid }) {
    const t = useT();
    if (ev.lootCount) {
        return (
            <Link className="re-blink" to={`/history/event?event=${encodeURIComponent(ev.id)}`}>
                <Badge tone="accent" icon="inv_misc_bag_10" tip={t("raids.list.lootTip", { count: ev.lootCount })} tipSub={t("raids.list.lootSub")}>{t("raids.list.lootBadge", { count: ev.lootCount })}</Badge>
            </Link>
        );
    }
    return (
        <Link className="re-blink" to="/history?tab=import">
            <Badge tone="mid" icon="inv_misc_bag_10" tip={t("raids.list.noLoot")} tipSub={t("raids.list.noLootSub")}>{t("raids.list.noLootBadge")}</Badge>
        </Link>
    );
}

export function PastRaidList({ events, emptyMessage }: { events: PastRaid[]; emptyMessage: string }) {
    const t = useT();
    const { dir, onSort, apply } = useTableSort<SortKey>("raid-list-past-sort", SORT_DEFAULTS, "time", "desc");
    const open = useRowOpen();
    // Which month bands the admin folded open or shut, against the default: the
    // newest month open, every older one closed.
    const [toggled, setToggled] = useState<Record<string, boolean>>({});
    if (!events.length) return <div className="glist re-glist"><div className="re-empty">{emptyMessage}</div></div>;
    const bands = monthBands(apply(withRaidGroups(events), (ev) => ev.startTime || 0));
    const newest = bands.reduce((best, b) => (b.key > best ? b.key : best), "");

    return (
        <div className="glist re-glist re-past" role="table" aria-label={t("raids.list.pastAria")}>
            <div className="re-head" role="row">
                <span />
                <span>{t("raids.list.event")}</span>
                <SortHead dir={dir} onSort={() => onSort("time")} />
                <span className="tipped" data-tip={t("raids.list.logs")} data-tip-sub={t("raids.list.logsSub")}>{t("raids.list.logs")}</span>
                <span className="tipped" data-tip={t("raids.list.loot")} data-tip-sub={t("raids.list.lootColSub")}>{t("raids.list.loot")}</span>
                <span className="re-right">{t("raids.list.actions")}</span>
            </div>
            {bands.map((band) => {
                const isOpen = toggled[band.key] ?? band.key === newest;
                return (
                    <div key={band.key} role="rowgroup">
                        <Band
                            band={band}
                            extra={<Expand open={isOpen} onToggle={() => setToggled((prev) => ({ ...prev, [band.key]: !isOpen }))} />}
                        />
                        {isOpen && band.rows.map((ev) => {
                            const { day, time } = eventDay(ev.startTime);
                            const further = ev.groupRaids || [];
                            return (
                                <Fragment key={ev.id}>
                                <div className="re-row" role="row" onClick={open(ev.id)}>
                                    <RaidIcon contentIds={ev.contentIds} sources={ev.contentSources} />
                                    <EventTitle ev={ev} raids={further.length ? further.length + 1 : 0} />
                                    <div className="re-when"><b>{day}</b><span>{time}</span></div>
                                    <div className="re-badges"><LogBadges ev={ev} /></div>
                                    <div className="re-badges"><LootBadge ev={ev} /></div>
                                    <div className="re-acts">
                                        {ev.softres?.url && <IconLink href={ev.softres.url} icon="inv_scroll_11" tip="Softres" tipSub={t("raids.list.softresSub")} />}
                                        <DetailLink id={ev.id} />
                                    </div>
                                </div>
                                {further.map((r) => (
                                    <div key={r.id} className="re-row re-subrow re-subrow-past" role="row" onClick={open(r.id)}>
                                        <span className="re-subrow-mark" aria-hidden="true">↳</span>
                                        <div className="re-ev">
                                            <span className="re-title-line">
                                                <Badge size="sm">{t("raids.list.groupRaid", { index: r.raidGroupIndex || 2 })}</Badge>
                                                <Link className="re-title" to={detailHref(r.id)}>{r.title || t("raids.list.untitled")}</Link>
                                            </span>
                                        </div>
                                        <div className="re-when" />
                                        <div className="re-badges"><LogBadges ev={r} /></div>
                                        <div className="re-badges"><LootBadge ev={r} /></div>
                                        <div className="re-acts"><DetailLink id={r.id} /></div>
                                    </div>
                                ))}
                                </Fragment>
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
}
