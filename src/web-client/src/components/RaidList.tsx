import { useState, type MouseEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { PastRaid, UpcomingRaid } from "../api";
import { useTableSort, type Dir } from "../lib/tableSort";
import { eventPostUrl, raidplanUrl } from "../lib/discordLinks";
import { relativeDayLabel } from "../lib/format";
import { eventDay, monthBands, weekBands, type TimeBand } from "../lib/raidTime";
import RaidIcon from "./RaidIcon";
import WowIcon from "./ui/WowIcon";
import Badge from "./ui/Badge";
import Bar from "./ui/Bar";
import Expand from "./ui/Expand";
import { IconButton } from "./ui/Button";
import { ChevronDownIcon, ChevronRightIcon } from "./icons";

// The Raid-Events list: one grid list (.glist), grouped by time — coming raids
// by week, past raids by month — sorted by date, the one column worth ordering.
// Signals instead of text: signups as a bar against the raid size, logs and loot
// as badges whose tooltips carry the names, links as icon buttons. The whole row
// opens the event's detail page.

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
    return (
        <Link className="ibtn sm re-go" to={detailHref(id)} aria-label="Event öffnen" data-tip="Event öffnen" data-tip-sub="Anmeldungen, Raidsheet, Logs und Loot dieses Raids.">
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
    return (
        <button type="button" className={`re-sort${dir === "asc" ? " up" : ""}`} onClick={onSort} aria-label={`Nach Termin sortieren (${dir === "asc" ? "aufsteigend" : "absteigend"})`}>
            Termin <ChevronDownIcon />
        </button>
    );
}

function EventTitle({ ev }: { ev: { id: string; title: string; channelName: string; categoryName: string } }) {
    return (
        <div className="re-ev">
            <Link className="re-title" to={detailHref(ev.id)}>{ev.title || "(ohne Titel)"}</Link>
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
    const { dir, onSort, apply } = useTableSort<SortKey>("raid-list-upcoming-sort", SORT_DEFAULTS, "time", "asc");
    const open = useRowOpen();
    if (!events.length) return <div className="glist re-glist"><div className="re-empty">{emptyMessage}</div></div>;
    const bands = weekBands(apply(events, (ev) => ev.startTime || 0));

    return (
        <div className="glist re-glist re-up" role="table" aria-label="Kommende Raids">
            <div className="re-head" role="row">
                <span />
                <span>Event</span>
                <SortHead dir={dir} onSort={() => onSort("time")} />
                <span className="tipped" data-tip="Anmeldungen" data-tip-sub="Zusagen ohne Abmeldungen, gemessen an der Raidgröße des Inhalts: Karazhan und Zul'Aman 10 Plätze, alle anderen Raids 25.">Anmeldungen</span>
                <span className="re-right">Aktionen</span>
            </div>
            {bands.map((band) => (
                <div key={band.key} role="rowgroup">
                    <Band band={band} />
                    {band.rows.map((ev) => {
                        const { day, time } = eventDay(ev.startTime);
                        return (
                            <div key={ev.id} className="re-row" role="row" onClick={open(ev.id)}>
                                <RaidIcon contentIds={ev.contentIds} sources={ev.contentSources} />
                                <EventTitle ev={ev} />
                                <div className="re-when"><b>{day}</b><span>{time} · {relativeDayLabel(ev.startTime)}</span></div>
                                <span
                                    className="re-bar"
                                    data-tip={`${ev.signupCount} von ${ev.raidSize} Plätzen`}
                                    data-tip-sub={ev.raidSizeKnown ? "Raidgröße aus dem erkannten Inhalt." : "Inhalt nicht erkannt – gemessen an der Standardgröße 25."}
                                >
                                    <Bar value={ev.signupCount} max={ev.raidSize} tone={signupTone(ev.signupCount, ev.raidSize)} label={`${ev.signupCount} / ${ev.raidSize}`} />
                                </span>
                                <div className="re-acts">
                                    {guildId && ev.channelId && (
                                        <IconLink href={eventPostUrl(guildId, ev.channelId, ev.id)} icon="inv_letter_15" tip="Discord-Post öffnen" tipSub={`Springt zur Anmelde-Nachricht${ev.channelName ? ` in #${ev.channelName}` : ""}.`} />
                                    )}
                                    <IconLink href={raidplanUrl(ev.id)} icon="inv_misc_groupneedmore" tip="Setup/Comp" tipSub="Die Aufstellung dieses Events im Raid-Helper." />
                                    {ev.softres?.url && <IconLink href={ev.softres.url} icon="inv_scroll_11" tip="Softres" tipSub="Die Soft-Reserve-Liste des Raids auf softres.it." />}
                                    {canWrite && (
                                        <IconButton icon="spell_holy_borrowedtime" size="sm" tip="Wiederholen" tipSub="Neues Event mit diesem als Vorlage anlegen: Titel, Template und Beschreibung übernommen, Kanal geklont." onClick={() => onRepeat(ev.id)} />
                                    )}
                                    <DetailLink id={ev.id} />
                                </div>
                            </div>
                        );
                    })}
                </div>
            ))}
        </div>
    );
}

// ---------------------------------------------------------------- past

function LogBadges({ ev }: { ev: PastRaid }) {
    const done = ev.logs.filter((l) => l.status === "done");
    const assigned = ev.logs.filter((l) => l.status !== "done");
    const pending = ev.pendingLogs || [];
    const names = (logs: { title?: string; reportId?: string }[]) => logs.map((l) => `„${l.title || l.reportId || "Log"}“`).join("\n");
    const badges: ReactNode[] = [];
    if (done.length) {
        badges.push(
            <Link key="done" className="re-blink" to={detailHref(ev.id, "logs")}>
                <Badge tone="ok" icon="inv_misc_pocketwatch_01" tip={`${done.length} ausgewertet`} tipSub={`${names(done)}\nKlick öffnet die Logs des Events mit den Auswertungen.`}>{done.length} ausgewertet</Badge>
            </Link>,
        );
    }
    if (assigned.length) {
        badges.push(
            <Link key="assigned" className="re-blink" to={detailHref(ev.id, "logs")}>
                <Badge icon="inv_misc_pocketwatch_01" tip={`${assigned.length} zugeordnet, nicht ausgewertet`} tipSub={`${names(assigned)}\nKlick öffnet die Logs des Events, dort auswerten.`}>{assigned.length} zugeordnet</Badge>
            </Link>,
        );
    }
    if (pending.length) {
        const lines = pending.map((l) => (l.alsoFits.length
            ? `„${l.title || "Log"}“ passt zeitlich auch zu ${l.alsoFits.join(", ")}.`
            : `„${l.title || "Log"}“ passt zeitlich, ist aber nicht zugeordnet.`));
        badges.push(
            <Link key="pending" className="re-blink" to={detailHref(ev.id, "logs")}>
                <Badge tone="mid" icon="inv_misc_pocketwatch_01" tip={`${pending.length} Log${pending.length === 1 ? "" : "s"} nicht zugeordnet`} tipSub={`${lines.join("\n")}\nKlick öffnet das Event im Reiter Logs, dort entscheiden.`}>{pending.length} offen</Badge>
            </Link>,
        );
    }
    if (!badges.length) return <Badge tip="Keine Logs" tipSub="Diesem Raid ist kein Warcraft-Log zugeordnet, und keiner passt zeitlich.">keine Logs</Badge>;
    return <>{badges}</>;
}

function LootBadge({ ev }: { ev: PastRaid }) {
    if (ev.lootCount) {
        return (
            <Link className="re-blink" to={`/history/event?event=${encodeURIComponent(ev.id)}`}>
                <Badge tone="accent" icon="inv_misc_bag_10" tip={`${ev.lootCount} Items vergeben`} tipSub="Klick öffnet den Loot dieses Raids.">{ev.lootCount} Items</Badge>
            </Link>
        );
    }
    return (
        <Link className="re-blink" to="/history?tab=import">
            <Badge tone="mid" icon="inv_misc_bag_10" tip="Kein Loot importiert" tipSub="Klick öffnet den Loot-Import in Historie & Loot.">fehlt</Badge>
        </Link>
    );
}

export function PastRaidList({ events, emptyMessage }: { events: PastRaid[]; emptyMessage: string }) {
    const { dir, onSort, apply } = useTableSort<SortKey>("raid-list-past-sort", SORT_DEFAULTS, "time", "desc");
    const open = useRowOpen();
    // Which month bands the admin folded open or shut, against the default: the
    // newest month open, every older one closed.
    const [toggled, setToggled] = useState<Record<string, boolean>>({});
    if (!events.length) return <div className="glist re-glist"><div className="re-empty">{emptyMessage}</div></div>;
    const bands = monthBands(apply(events, (ev) => ev.startTime || 0));
    const newest = bands.reduce((best, b) => (b.key > best ? b.key : best), "");

    return (
        <div className="glist re-glist re-past" role="table" aria-label="Vergangene Raids">
            <div className="re-head" role="row">
                <span />
                <span>Event</span>
                <SortHead dir={dir} onSort={() => onSort("time")} />
                <span className="tipped" data-tip="Logs" data-tip-sub="Zugeordnete Warcraft-Logs (ausgewertet oder nicht) und offene: Logs, die zeitlich passen, aber noch keinem Raid zugeordnet sind.">Logs</span>
                <span className="tipped" data-tip="Loot" data-tip-sub="Importierter Loot dieses Raids. „fehlt“: noch nichts importiert.">Loot</span>
                <span className="re-right">Aktionen</span>
            </div>
            {bands.map((band) => {
                const isOpen = toggled[band.key] ?? band.key === newest;
                return (
                    <div key={band.key} role="rowgroup">
                        <Band
                            band={band}
                            extra={<Expand open={isOpen} onToggle={() => setToggled((t) => ({ ...t, [band.key]: !isOpen }))} />}
                        />
                        {isOpen && band.rows.map((ev) => {
                            const { day, time } = eventDay(ev.startTime);
                            return (
                                <div key={ev.id} className="re-row" role="row" onClick={open(ev.id)}>
                                    <RaidIcon contentIds={ev.contentIds} sources={ev.contentSources} />
                                    <EventTitle ev={ev} />
                                    <div className="re-when"><b>{day}</b><span>{time}</span></div>
                                    <div className="re-badges"><LogBadges ev={ev} /></div>
                                    <div className="re-badges"><LootBadge ev={ev} /></div>
                                    <div className="re-acts">
                                        {ev.softres?.url && <IconLink href={ev.softres.url} icon="inv_scroll_11" tip="Softres" tipSub="Die Soft-Reserve-Liste des Raids auf softres.it." />}
                                        <DetailLink id={ev.id} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
}
