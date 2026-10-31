import { useEffect } from "react";
import { Link } from "react-router-dom";
import { deleteAvailability, getAbsenceRaider, type AbsenceRaiderDetail, type ApiError, type AvailabilityKind } from "../../api";
import { useApi } from "../../hooks/useApi";
import { useContentVersion } from "../../hooks/useContentVersion";
import { Badge, Button, IconButton, useConfirm } from "../../components/ui";
import RaidLoader from "../../components/ui/layout/RaidLoader";
import { EditIcon, ListChecksIcon, PlusIcon, TrashIcon, XIcon } from "../../components/ui/icons/icons";
import { useToast } from "../../components/shell/Jobs";
import { currentAbsence, displayName, playsLine } from "../../lib/roster/absences";
import { dayMs, entryCharacters, periodLabel, scopeLabel } from "../../lib/signups/availability";
import { formatDayDate } from "../../lib/format";
import { useT } from "../../i18n";
import { AbSpec, ClassName } from "./parts";

// One raider in a drawer at the right edge (like the setup editor's): what they
// play, the absence running or coming, every entry with its state, what the
// entries already did, and their last ten raids as dots. Esc or the X closes it.

type Entry = AbsenceRaiderDetail["entries"][number];

const STATE_TONE = { planned: "accent", running: "mid", past: undefined } as const;

export default function RaiderDrawer({ userId, onClose, onEnter, onEdit, onChanged, onAttendance }: {
    userId: string;
    onClose: () => void;
    /** "Ab- & Anwesenheit für … eintragen": the dialog with this raider picked. */
    onEnter: (raider: AbsenceRaiderDetail) => void;
    /** The pencil at an entry: the same dialog, filled with that entry. */
    onEdit: (raider: AbsenceRaiderDetail, kind: AvailabilityKind, entryId: string) => void;
    /** An entry was deleted: the overview reloads. */
    onChanged: () => void;
    /** "Anwesenheit ansehen": the page's attendance view for this raider (the orga only). */
    onAttendance?: (userId: string) => void;
}) {
    const t = useT();
    // the raider's last raids of the menu's content version (#740); the entries are the same in every version
    const { version } = useContentVersion();
    const state = useApi(() => getAbsenceRaider(userId, version), [userId, version]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            // a dialog over the drawer takes its own Esc
            if (e.key !== "Escape" || document.querySelector("dialog[open]")) return;
            onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const data = state.data;
    return (
        <aside className="ab-drawer" aria-label={t("absences.drawer.aria")}>
            <div className="ab-drawer-head">
                <span className="kicker">{t("absences.drawer.kicker")}</span>
                <IconButton icon={<XIcon />} tip={t("common.close")} size="sm" onClick={onClose} />
            </div>
            <div className="ab-drawer-body">
                {state.error && !data && <p className="ab-empty">{t("absences.loadError", { message: state.error.message })}</p>}
                {!data && !state.error && <RaidLoader compact text={t("absences.drawer.loading")} />}
                {data && <Detail data={data} onEdit={(e) => onEdit(data, e.kind, e.id)} onRemoved={() => { void state.reload(); onChanged(); }} />}
            </div>
            {data && (
                <div className="ab-drawer-foot">
                    {data.canEdit && (
                        // neutral (ghost, no meaning colour): absence and attendance alike, the kind is picked in the dialog
                        <Button variant="ghost" icon={<PlusIcon />} onClick={() => onEnter(data)} data-tip={t("absences.enterTip")}>
                            {t("absences.drawer.enterFor", { name: displayName(data) })}
                        </Button>
                    )}
                    {data.canEdit && onAttendance && (
                        <Button variant="ghost" icon={<ListChecksIcon />} onClick={() => onAttendance(data.userId)}>{t("absences.drawer.attendance")}</Button>
                    )}
                    {data.character && (
                        <Link className="mlink" to={`/roster/char?name=${encodeURIComponent(data.character)}`}>{t("absences.drawer.toCharacter")}</Link>
                    )}
                </div>
            )}
        </aside>
    );
}

function Detail({ data, onEdit, onRemoved }: { data: AbsenceRaiderDetail; onEdit: (entry: Entry) => void; onRemoved: () => void }) {
    const t = useT();
    const now = currentAbsence(data.entries);
    const done = data.entries.reduce((n, e) => n + (e.kind === "absence" ? e.done : 0), 0);
    return (
        <>
            <div className="ab-who-big">
                <AbSpec who={data} size="lg" />
                <div>
                    <ClassName who={data} className="ab-who-bigname" />
                    <div className="ab-who-sub">{[playsLine(data), data.character && data.name !== data.character ? data.name : ""].filter(Boolean).join(" · ")}</div>
                </div>
            </div>

            {now && (
                <div className={`ab-now${now.state === "running" ? " is-running" : ""}`}>
                    <div className="ab-now-num"><b>{now.days}</b> {t("absences.daysWord", { count: now.days })}</div>
                    <div className="ab-now-text">
                        <span className="ab-now-state">{now.state === "running" ? t("absences.drawer.nowRunning") : t("absences.drawer.nowPlanned")}</span>
                        {now.comment && <b>{now.comment}</b>}
                        <span>{periodLabel(now.from, now.to)}</span>
                    </div>
                </div>
            )}

            <section className="ab-sec">
                <h3>{t("absences.drawer.entries")}</h3>
                {data.entries.length ? (
                    <ul className="ab-entries">
                        {data.entries.map((e) => <EntryRow key={e.id} entry={e} canEdit={data.canEdit} onEdit={() => onEdit(e)} onRemoved={onRemoved} />)}
                    </ul>
                ) : <p className="ab-note">{t("absences.drawer.noEntries")}</p>}
            </section>

            <section className="ab-sec">
                <h3>{t("absences.drawer.effect")}</h3>
                <p className="ab-note">
                    {done ? t("absences.drawer.done", { count: done }) : t("absences.drawer.doneNone")}
                    {" "}{t("absences.drawer.later")}
                </p>
            </section>

            <section className="ab-sec">
                <h3>{t("absences.drawer.history", { count: data.history.length })}</h3>
                {data.history.length ? (
                    <>
                        <div className="ab-hist" role="list">
                            {data.history.map((h) => (
                                <span
                                    key={h.eventId}
                                    role="listitem"
                                    className={`ab-hist-dot ab-h-${h.status}`}
                                    aria-label={`${formatDayDate(dayMs(h.day))} · ${t(`absences.history.${h.status}`)}`}
                                    data-tip={formatDayDate(dayMs(h.day))}
                                    data-tip-sub={[h.title, t(`absences.history.${h.status}`)].filter(Boolean).join(" · ")}
                                />
                            ))}
                        </div>
                        <p className="ab-note">{t("absences.drawer.counts", { in: data.counts.in, off: data.counts.off, none: data.counts.none })}</p>
                    </>
                ) : <p className="ab-note">{t("absences.drawer.noHistory")}</p>}
            </section>
        </>
    );
}

function EntryRow({ entry, canEdit, onEdit, onRemoved }: { entry: Entry; canEdit: boolean; onEdit: () => void; onRemoved: () => void }) {
    const t = useT();
    const ask = useConfirm();
    const toast = useToast();
    const chars = entry.kind === "presence" ? entryCharacters(entry) : [];
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
        <li className={`ab-entry is-${entry.kind}${entry.state === "past" ? " is-past" : ""}`}>
            <div className="ab-entry-main">
                <div className="ab-entry-period">
                    <Badge size="sm" tone={STATE_TONE[entry.state]}>{t(`absences.state.${entry.state}`)}</Badge>
                    <b>{periodLabel(entry.from, entry.to)}</b>
                    <span className="ab-entry-days">{t("absences.days", { count: entry.days })}</span>
                </div>
                <div className="ab-entry-sub">
                    <span>{t(`absences.kind.${entry.kind}`)}</span>
                    {entry.comment && <span>{t("common.quoted", { text: entry.comment })}</span>}
                    <span className="ab-entry-scope">{scopeLabel(entry)}</span>
                    {entry.byOrga && <span>{t("absences.drawer.byOrga")}</span>}
                </div>
                {chars.length > 0 && <div className="ab-entry-sub ab-entry-chars">{chars.map((c) => <span key={c}>{c}</span>)}</div>}
            </div>
            {canEdit && entry.state !== "past" && (
                <div className="ab-entry-acts">
                    <IconButton size="sm" icon={<EditIcon />} tip={t("signups.availability.edit")} onClick={onEdit} />
                    <IconButton size="sm" tone="danger" icon={<TrashIcon />} tip={t("absences.drawer.remove")} onClick={() => void remove()} />
                </div>
            )}
        </li>
    );
}
