import { useEffect, useRef, useState } from "react";
import { searchRaiders, type AvailabilityKind, type AvailabilityRaid, type AvailabilityResult, type RaiderRef } from "../../api";
import { Badge, Button, IconButton } from "../ui";
import { RosterIcon, SearchIcon, XIcon } from "../icons";
import { formatDayDate, formatTime } from "../../lib/format";
import { SIGNUP_STATUS, statusBadgeLabel } from "../../lib/signups";
import { skipReason, staysAsIs } from "../../lib/availability";
import { useT } from "../../i18n";

// The parts of the absence/attendance dialog (AvailabilityDialog.tsx): the raids
// of the period with a checkbox each, the orga's "für Raider" picker, and the
// answer of a save, raid by raid.

/** When a raid starts, short: "Fr 09.10. 19:45". */
function when(startTime: number): string {
    const ms = startTime * 1000;
    return `${formatDayDate(ms)} ${formatTime(ms)}`;
}

/**
 * The raids the period covers — all picked at first; a click leaves one out. A
 * raid the save would leave alone anyway (staysAsIs) stays unpicked and greyed out.
 */
export function RaidChecklist({ kind, raids, off, onToggle }: {
    kind: AvailabilityKind;
    raids: AvailabilityRaid[];
    /** The ids left out. */
    off: Set<string>;
    onToggle: (id: string) => void;
}) {
    const t = useT();
    return (
        <ul className="an-av-raids">
            {raids.map((r) => {
                const fixed = staysAsIs(kind, r.status);
                const picked = !fixed && !off.has(r.id);
                return (
                    <li key={r.id}>
                        <label className={`an-av-raid${picked ? "" : " an-av-off"}`}>
                            <input type="checkbox" checked={picked} disabled={fixed} onChange={() => onToggle(r.id)} aria-label={t("signups.availability.dialog.raidAria", { title: r.title })} />
                            <span className="an-av-text">
                                <span className="an-av-title">{r.title}</span>
                                <span className="an-av-when">{[when(r.startTime), r.categoryName].filter(Boolean).join(" · ")}</span>
                            </span>
                            {r.status && <Badge size="sm" tone={SIGNUP_STATUS[r.status].tone}>{statusBadgeLabel(r.status)}</Badge>}
                        </label>
                    </li>
                );
            })}
        </ul>
    );
}

/**
 * The orga's way to enter for somebody else: a quiet button that opens a raider
 * search (the wish picker's GET /api/profile/raiders), then the chosen raider as
 * a removable badge.
 */
export function RaiderPick({ target, onPick }: { target: RaiderRef | null; onPick: (raider: RaiderRef | null) => void }) {
    const t = useT();
    const [searching, setSearching] = useState(false);
    const [q, setQ] = useState("");
    const [hits, setHits] = useState<RaiderRef[]>([]);
    const timer = useRef<number | undefined>(undefined);
    const input = useRef<HTMLInputElement>(null);

    // the search was opened on purpose, so it takes the focus
    useEffect(() => { if (searching) input.current?.focus(); }, [searching]);

    useEffect(() => {
        window.clearTimeout(timer.current);
        if (!q.trim()) { setHits([]); return undefined; }
        timer.current = window.setTimeout(() => {
            // a failed search just shows no hits — the field stays usable
            searchRaiders(q).then((r) => setHits(r.raiders)).catch(() => setHits([]));
        }, 250);
        return () => window.clearTimeout(timer.current);
    }, [q]);

    if (target) {
        const name = target.name || target.character;
        return (
            <div className="an-av-who">
                <Badge tone="accent" icon={<RosterIcon />} onRemove={() => onPick(null)} removeTip={t("signups.availability.dialog.backToMe")}>
                    {t("signups.availability.dialog.forName", { name })}
                </Badge>
            </div>
        );
    }
    if (!searching) {
        return (
            <div className="an-av-who">
                <Button variant="ghost" size="sm" icon={<RosterIcon />} onClick={() => setSearching(true)}
                    data-tip={t("signups.availability.dialog.forRaider")} data-tip-sub={t("signups.availability.dialog.forRaiderSub")}>
                    {t("signups.availability.dialog.forRaider")}
                </Button>
            </div>
        );
    }
    return (
        <div className="an-av-who an-av-search">
            <div className="an-av-q">
                <SearchIcon />
                <input ref={input} className="inp-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("signups.availability.dialog.searchRaider")} aria-label={t("signups.availability.dialog.searchRaiderAria")} />
                <IconButton size="sm" icon={<XIcon />} tip={t("signups.availability.dialog.backToMe")} onClick={() => { setQ(""); setSearching(false); }} />
            </div>
            {hits.slice(0, 6).map((h) => (
                <button key={h.userId} type="button" className="an-av-hit" onClick={() => { onPick(h); setQ(""); setSearching(false); }}>
                    <b>{h.character || h.name}</b>
                    {h.character && h.name && <span>{h.name}</span>}
                </button>
            ))}
        </div>
    );
}

/** The answer of a save, raid by raid: done, skipped (already so) or not changed, with why. */
export function ResultList({ results }: { results: AvailabilityResult[] }) {
    const t = useT();
    return (
        <ul className="an-results">
            {results.map((r) => (
                <li key={r.eventId} className="an-result">
                    <Badge tone={r.ok ? "ok" : r.skipped ? undefined : "bad"}>
                        {r.ok ? t("signups.availability.result.done") : r.skipped ? t("signups.availability.result.skippedBadge") : t("signups.availability.result.failedBadge")}
                    </Badge>
                    <span className="an-result-title">{r.title}</span>
                    <span className="an-result-text">
                        {when(r.startTime)}
                        {!r.ok && <span className="an-result-skip">{skipReason(r)}</span>}
                    </span>
                </li>
            ))}
        </ul>
    );
}
