import { useState } from "react";
import Chip from "../../components/ui/Chip";
import { usePersistedState } from "../../lib/ui/persistedState";
import {
    deleteAvailability, getAvailability, getRaiderAttendance,
    type ApiError, type AttendanceCategory, type AvailabilityEntry, type SignupStatus,
} from "../../api";
import { useApi } from "../../hooks/useApi";
import { Badge, BackButton, Button, IconButton, useConfirm, type Tone } from "../../components/ui";
import RaidLoader from "../../components/ui/RaidLoader";
import { AbsenceIcon, CheckMark, TrashIcon } from "../../components/ui/icons";
import { useToast } from "../../components/shell/Jobs";
import AvailabilityDialog from "../../components/signup/AvailabilityDialog";
import { entryDays, entryState, nightsInOrder } from "../../lib/roster/absences";
import { countsAsPresent, countsForQuota, statusOf, verdictText } from "../../lib/roster/attendanceStatus";
import AttendanceCell from "../../components/roster/AttendanceCell";
import { periodLabel } from "../../lib/signups/availability";
import { formatDayDate, formatTime } from "../../lib/format";
import { useT } from "../../i18n";

// "Meine Anwesenheit": a raider's own view of the Abwesenheiten page — their
// absence entries (enter, delete), and per raid category the quota as one big
// number, the counted raids as dots and a short list, and the coming raids with
// their own status. The orga opens the same view for one raider from the
// drawer (`userId`), with a way back. Built by GET /api/availability/attendance
// (src/web/availability/raiderAttendance.js).

const STATUS_TONE: Record<SignupStatus, Tone | undefined> = { signed: "ok", late: "mid", tentative: "mid", bench: undefined, absence: "bad" };

export default function MyAttendance({ userId = "", onBack }: {
    /** "" = the caller's own; else a raider the orga looks at. */
    userId?: string;
    onBack?: () => void;
}) {
    const t = useT();
    const attendance = useApi(() => getRaiderAttendance(userId), [userId]);
    // the entries of whoever is shown; the caller's own data feeds the dialog when that is somebody else
    const entries = useApi(() => getAvailability(userId), [userId]);
    const caller = useApi(() => getAvailability(), [], { enabled: !!userId });
    const [dialog, setDialog] = useState(false);
    // one category or all of them; remembered, and ignored once that category is no longer offered
    const [picked, setPicked] = usePersistedState("absences-mine-category", "");

    const data = attendance.data;
    if (attendance.error && !data) return <p className="ab-empty">{t("absences.loadError", { message: attendance.error.message })}</p>;
    if (!data) return <RaidLoader text={t("absences.mine.loading")} />;

    const other = !!userId && !data.own;
    const name = data.name || data.character || userId;
    const own = other ? caller.data : entries.data;
    const pick = data.categories.some((c) => c.id === picked) ? picked : "";
    const shown = pick ? data.categories.filter((c) => c.id === pick) : data.categories;

    return (
        <div className="ab-mine">
            {onBack && (
                <div className="ab-mine-back">
                    <BackButton label={t("absences.mine.back")} onClick={onBack} />
                    {other && <h2>{t("absences.mine.of", { name })}</h2>}
                </div>
            )}

            <section className="ab-own" aria-label={other ? t("absences.mine.entriesOf", { name }) : t("absences.mine.entries")}>
                <div className="ab-own-head">
                    <h3>{other ? t("absences.mine.entriesOf", { name }) : t("absences.mine.entries")}</h3>
                    {own && (
                        <Button size="sm" variant="ghost" icon={<AbsenceIcon />} onClick={() => setDialog(true)}>
                            {other ? t("absences.drawer.enterFor", { name }) : t("absences.enter")}
                        </Button>
                    )}
                </div>
                {entries.data && <EntryList entries={entries.data.entries} today={entries.data.today} onRemoved={() => { void entries.reload(); }} />}
            </section>

            {data.categories.length > 1 && (
                <div className="chip-row ab-att-filter" role="group" aria-label={t("absences.mine.filterAria")}>
                    <Chip pressed={!pick} tone={!pick ? "accent" : undefined} icon={!pick ? <CheckMark /> : undefined} onClick={() => setPicked("")}>
                        {t("absences.mine.allCategories")}
                    </Chip>
                    {data.categories.map((c) => (
                        <Chip key={c.id} pressed={pick === c.id} tone={pick === c.id ? "accent" : undefined} icon={pick === c.id ? <CheckMark /> : undefined} onClick={() => setPicked(c.id)}>
                            {c.name || c.id}
                        </Chip>
                    ))}
                </div>
            )}

            {data.categories.length ? (
                <div className="ab-atts">
                    {shown.map((c) => (
                        <CategoryCard
                            key={c.id} cat={c} userId={data.userId} name={name} canEdit={!!data.canEdit}
                            onSaved={() => { void attendance.reload(); }}
                        />
                    ))}
                </div>
            ) : <p className="ab-empty">{other ? t("absences.mine.noCategoriesOf", { name }) : t("absences.mine.noCategories")}</p>}

            {own && (
                <AvailabilityDialog
                    kind={dialog ? "absence" : null}
                    own={own}
                    target={other ? { userId, name, character: "", className: "" } : null}
                    onClose={() => setDialog(false)}
                    onSaved={() => { void entries.reload(); void attendance.reload(); }}
                />
            )}
        </div>
    );
}

function EntryList({ entries, today, onRemoved }: { entries: AvailabilityEntry[]; today: string; onRemoved: () => void }) {
    const t = useT();
    const shown = entries.filter((e) => entryState(e, today) !== "past");
    if (!shown.length) return <p className="ab-note">{t("absences.mine.noEntries")}</p>;
    return (
        <ul className="ab-entries">
            {shown.map((e) => <OwnEntry key={e.id} entry={e} today={today} onRemoved={onRemoved} />)}
        </ul>
    );
}

function OwnEntry({ entry, today, onRemoved }: { entry: AvailabilityEntry; today: string; onRemoved: () => void }) {
    const t = useT();
    const ask = useConfirm();
    const toast = useToast();
    const state = entryState(entry, today);
    const remove = async () => {
        if (!(await ask({ title: t("absences.drawer.removeTitle"), text: t("absences.drawer.removeText", { period: periodLabel(entry.from, entry.to) }), action: t("common.delete") }))) return;
        try {
            await deleteAvailability(entry.id);
            toast(t("absences.drawer.removed"));
            onRemoved();
        } catch (e) {
            toast((e as ApiError).message, "err");
        }
    };
    return (
        <li className={`ab-entry is-${entry.kind}`}>
            <div className="ab-entry-main">
                <div className="ab-entry-period">
                    <Badge size="sm" tone={state === "running" ? "mid" : "accent"}>{t(`absences.state.${state}`)}</Badge>
                    <b>{periodLabel(entry.from, entry.to)}</b>
                    <span className="ab-entry-days">{t("absences.days", { count: entryDays(entry) })}</span>
                </div>
                <div className="ab-entry-sub">
                    <span>{t(`absences.kind.${entry.kind}`)}</span>
                    {entry.comment && <span>{t("common.quoted", { text: entry.comment })}</span>}
                    {entry.categoryName && <span>{t("absences.onlyCategory", { name: entry.categoryName })}</span>}
                    {entry.byOrga && <span>{t("absences.drawer.byOrga")}</span>}
                </div>
            </div>
            <IconButton size="sm" tone="danger" icon={<TrashIcon />} tip={t("absences.drawer.remove")} onClick={() => void remove()} />
        </li>
    );
}

/** One category: the quota, every counted night as a status field (#677; the orga may correct one) and as a list, the coming raids. */
function CategoryCard({ cat, userId, name, canEdit, onSaved }: { cat: AttendanceCategory; userId: string; name: string; canEdit: boolean; onSaved: () => void }) {
    const t = useT();
    const nights = nightsInOrder(cat.raids);
    return (
        <section className="ab-att" aria-label={cat.name || cat.id}>
            <div className="ab-att-head">
                <h3>{cat.name || cat.id}</h3>
                {cat.link === "auto" && <Badge size="sm" tip={t("absences.mine.autoTip")}>{t("absences.mine.auto")}</Badge>}
            </div>
            {cat.pct === null || !cat.total ? (
                <p className="ab-note">{t("absences.mine.noRaids")}</p>
            ) : (
                <>
                    <div className="ab-att-figure">
                        <b>{t("absences.mine.pct", { pct: cat.pct })}</b>
                        <span>{t("absences.mine.ofRaids", { attended: cat.attended, count: cat.total })}</span>
                        <span className="ab-att-window">{t("absences.mine.window", { count: cat.window })}</span>
                    </div>
                    <div className="ab-hist" role="list" aria-label={t("absences.mine.nightsAria")}>
                        {nights.map((r) => (
                            <span key={r.eventId} role="listitem" className="ab-hist-cell">
                                <AttendanceCell night={r} userId={userId} name={name} canEdit={canEdit} onSaved={onSaved} />
                            </span>
                        ))}
                    </div>
                    <ul className="ab-att-list">
                        {[...nights].reverse().map((r) => (
                            <li key={r.eventId} className={countsAsPresent(statusOf(r)) ? "ab-att-in" : countsForQuota(statusOf(r)) ? "ab-att-out" : "ab-att-neutral"} data-att={statusOf(r)}>
                                <span className="ab-att-date">{formatDayDate(r.startTime * 1000)}</span>
                                <span className="ab-att-title">{r.title}</span>
                                <span className="ab-att-verdict">{verdictText(r)}</span>
                            </li>
                        ))}
                    </ul>
                </>
            )}
            {cat.upcoming.length > 0 && (
                <div className="ab-att-next">
                    <h4>{t("absences.mine.next")}</h4>
                    <ul className="ab-att-list">
                        {cat.upcoming.map((u) => (
                            <li key={u.eventId}>
                                <span className="ab-att-date">{`${formatDayDate(u.startTime * 1000)} ${formatTime(u.startTime * 1000)}`}</span>
                                <span className="ab-att-title">{u.title}</span>
                                <StatusPill status={u.status} url={u.url} />
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </section>
    );
}

function StatusPill({ status, url }: { status: SignupStatus | ""; url: string }) {
    const t = useT();
    const badge = <Badge size="sm" tone={status ? STATUS_TONE[status] : undefined}>{t(`absences.mine.status.${status || "none"}`)}</Badge>;
    if (!url) return badge;
    return <a className="ab-att-pill" href={url} target="_blank" rel="noreferrer">{badge}</a>;
}
