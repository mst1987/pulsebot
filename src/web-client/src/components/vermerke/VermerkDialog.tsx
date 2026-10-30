import { useEffect, useId, useState } from "react";
import {
    createVermerk, getVermerkRaids, searchVermerkPeople, updateVermerk,
    MAX_NOTE_TEXT, MAX_NOTES, NOTE_LEVELS, NOTE_REASONS,
    type NoteLevel, type NoteReason, type PersonHit, type RecentRaid, type VermerkEntry,
} from "../../api/vermerke";
import type { ApiError } from "../../api/client";
import { Button, Chip, Field, Modal, Segment, Switch } from "../ui";
import { SearchIcon } from "../ui/icons";
import LevelMark from "./LevelMark";
import ReasonIcon from "./ReasonIcon";
import { formatDayMonth, isoDay } from "../../lib/format";
import "../../styles/vermerke.css";
import { useT } from "../../i18n";

// The one window to add or change a note (Dialog A, #980): the person (members
// and who left, found over earlier signups), the level, the reason, the expiry
// (default "Nie"), the text, the raids of the last four weeks as toggle chips and
// "Auf allen Servern zeigen". Changing an entry keeps the person fixed. The
// store keeps 50 notes per person and server, the archive included: the refusal
// `too_many` is said in plain words.

export type VermerkDialogPerson = { userId: string; name: string };
export type VermerkDialogPreset = {
    person?: VermerkDialogPerson;
    /** an entry to change (else a new one) */
    entry?: VermerkEntry;
    /** prefill of a new one (a hint from the data) */
    level?: NoteLevel;
    reason?: NoteReason;
    eventIds?: string[];
};

type Expiry = "never" | "d30" | "d90" | "date";
const DAY = 86_400_000;
/** Letters before the person search asks the server. */
const MIN_QUERY = 2;

function expiryOf(choice: Expiry, date: string): number | null {
    if (choice === "d30") return Date.now() + 30 * DAY;
    if (choice === "d90") return Date.now() + 90 * DAY;
    if (choice === "date" && date) return new Date(`${date}T23:59:59`).getTime();
    return null;
}

export default function VermerkDialog({ preset, onClose, onSaved }: {
    preset: VermerkDialogPreset;
    onClose: () => void;
    /** after a save, with the person's id */
    onSaved: (userId: string) => void;
}) {
    const t = useT();
    const id = useId();
    const entry = preset.entry;
    const [person, setPerson] = useState<VermerkDialogPerson | null>(preset.person || null);
    const [level, setLevel] = useState<NoteLevel>(entry ? entry.level : preset.level || "hint");
    const [reason, setReason] = useState<NoteReason | null>(entry ? entry.reason : preset.reason || null);
    const [expiry, setExpiry] = useState<Expiry>(entry && entry.expiresAt ? "date" : "never");
    const [date, setDate] = useState(entry && entry.expiresAt ? isoDay(entry.expiresAt) : "");
    const [text, setText] = useState(entry ? entry.text : "");
    const [eventIds, setEventIds] = useState<string[]>(entry ? entry.eventIds : preset.eventIds || []);
    const [shared, setShared] = useState(entry ? entry.shared : false);
    const [saving, setSaving] = useState(false);
    const [failed, setFailed] = useState("");

    const tooLong = text.length > MAX_NOTE_TEXT;
    const ready = !!person && !!reason && !tooLong && !(expiry === "date" && !date);

    const save = async () => {
        if (!person || !reason || !ready) return;
        setSaving(true);
        setFailed("");
        const fields = { level, reason, text: text.trim(), eventIds, expiresAt: expiryOf(expiry, date), shared };
        try {
            if (entry) await updateVermerk(person.userId, entry.id, fields);
            else await createVermerk(person.userId, person.name, fields);
            onSaved(person.userId);
        } catch (err) {
            const e = err as ApiError;
            setFailed(e && e.code === "too_many" ? t("vermerke.dialog.tooMany", { max: MAX_NOTES }) : t("vermerke.dialog.failed", { message: (e && e.message) || String(err) }));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            open onClose={onClose} icon="vermerke" tone="vermerke" className="vmk-dlg" width={600}
            kicker={entry ? t("vermerke.dialog.kickerEdit") : t("vermerke.dialog.kickerNew")}
            title={person ? t("vermerke.dialog.titleFor", { name: person.name }) : t("vermerke.dialog.titleNew")}
            initialFocus={person ? undefined : `#${CSS.escape(`${id}-q`)}`}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button variant="go" onClick={save} running={saving} disabled={!ready || saving}>
                        {entry ? t("vermerke.dialog.save") : t("vermerke.dialog.create")}
                    </Button>
                </>
            )}
        >
            {failed && <p className="vmk-error" role="alert">{failed}</p>}
            <Field label={t("vermerke.dialog.person")} tip={t("vermerke.dialog.personTip")} htmlFor={`${id}-q`}>
                {person ? (
                    <div className="vmk-person">
                        <span className="vmk-person-name">{person.name}</span>
                        {!entry && !preset.person && (
                            <Button variant="ghost" size="sm" onClick={() => { setPerson(null); setEventIds([]); }}>{t("vermerke.dialog.personChange")}</Button>
                        )}
                    </div>
                ) : (
                    <PersonSearch inputId={`${id}-q`} onPick={(hit) => { setPerson({ userId: hit.userId, name: hit.name }); setEventIds([]); }} />
                )}
            </Field>
            <Field label={t("vermerke.dialog.level")}>
                <Segment<NoteLevel>
                    ariaLabel={t("vermerke.dialog.level")} value={level} onChange={setLevel}
                    options={NOTE_LEVELS.map((l) => ({ value: l, label: t(`vermerke.level.${l}`), icon: <LevelMark level={l} iconOnly />, tip: t(`vermerke.levelTip.${l}`) }))}
                />
            </Field>
            <Field label={t("vermerke.dialog.reason")}>
                <div className="chip-row">
                    {NOTE_REASONS.map((r) => (
                        <Chip key={r} pressed={reason === r} onClick={() => setReason(r)} icon={<ReasonIcon reason={r} size={15} decorative />}>
                            {t(`vermerke.reason.${r}`)}
                        </Chip>
                    ))}
                </div>
            </Field>
            <Field label={t("vermerke.dialog.expiry")} htmlFor={expiry === "date" ? `${id}-date` : undefined}>
                <div className="vmk-expiry">
                    <Segment<Expiry>
                        ariaLabel={t("vermerke.dialog.expiry")} value={expiry} onChange={setExpiry} size="sm"
                        options={[
                            { value: "never", label: t("vermerke.dialog.expiryNever") },
                            { value: "d30", label: t("vermerke.dialog.expiry30") },
                            { value: "d90", label: t("vermerke.dialog.expiry90") },
                            { value: "date", label: t("vermerke.dialog.expiryDate") },
                        ]}
                    />
                    {expiry === "date" && (
                        <input
                            id={`${id}-date`} type="date" value={date} min={isoDay(Date.now() + DAY)}
                            aria-label={t("vermerke.dialog.expiryDateLabel")} onChange={(e) => setDate(e.target.value)}
                        />
                    )}
                </div>
            </Field>
            <Field label={t("vermerke.dialog.text")} htmlFor={`${id}-text`}>
                <textarea
                    id={`${id}-text`} rows={3} value={text} placeholder={t("vermerke.dialog.textPlaceholder")}
                    onChange={(e) => setText(e.target.value)} aria-invalid={tooLong || undefined}
                />
                <div className={`vmk-count${tooLong ? " vmk-count-over" : ""}`}>{t("vermerke.dialog.textCount", { count: text.length, max: MAX_NOTE_TEXT })}</div>
            </Field>
            <Field label={t("vermerke.dialog.raids")} tip={t("vermerke.dialog.raidsTip")}>
                {person ? <RaidChips userId={person.userId} picked={eventIds} onChange={setEventIds} /> : <p className="vmk-muted">{t("vermerke.dialog.raidsPick")}</p>}
            </Field>
            <Switch checked={shared} onChange={setShared} label={t("vermerke.dialog.shared")} tip={t("vermerke.dialog.sharedTip")} />
        </Modal>
    );
}

function PersonSearch({ inputId, onPick }: { inputId: string; onPick: (hit: PersonHit) => void }) {
    const t = useT();
    const [query, setQuery] = useState("");
    const [hits, setHits] = useState<PersonHit[] | null>(null);

    useEffect(() => {
        const q = query.trim();
        if (q.length < MIN_QUERY) {
            setHits(null);
            return undefined;
        }
        let live = true;
        const timer = window.setTimeout(() => {
            searchVermerkPeople(q)
                .then((res) => { if (live) setHits(res.results || []); })
                .catch(() => { if (live) setHits([]); });
        }, 250);
        return () => { live = false; window.clearTimeout(timer); };
    }, [query]);

    return (
        <>
            <label className="vmk-search">
                <SearchIcon />
                <input
                    id={inputId} type="search" value={query} autoComplete="off"
                    placeholder={t("vermerke.dialog.personSearch")} onChange={(e) => setQuery(e.target.value)}
                />
            </label>
            {query.trim().length < MIN_QUERY && <p className="vmk-muted vmk-note">{t("vermerke.dialog.personHint")}</p>}
            {hits && hits.length === 0 && <p className="vmk-muted vmk-note">{t("vermerke.dialog.personNone")}</p>}
            {hits && hits.length > 0 && (
                <ul className="vmk-hits">
                    {hits.map((h) => (
                        <li key={h.userId}>
                            <button type="button" className="vmk-hit" onClick={() => onPick(h)}>
                                <span>{h.name}</span>
                                {h.gone && <span className="vmk-muted">{t("vermerke.dialog.personGone")}</span>}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </>
    );
}

function RaidChips({ userId, picked, onChange }: { userId: string; picked: string[]; onChange: (ids: string[]) => void }) {
    const t = useT();
    const [raids, setRaids] = useState<RecentRaid[] | null>(null);

    useEffect(() => {
        let live = true;
        setRaids(null);
        getVermerkRaids(userId)
            .then((res) => { if (live) setRaids(res.raids || []); })
            .catch(() => { if (live) setRaids([]); });
        return () => { live = false; };
    }, [userId]);

    if (!raids) return null;
    if (raids.length === 0) return <p className="vmk-muted">{t("vermerke.dialog.raidsNone")}</p>;
    const toggle = (id: string) => onChange(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
    // signed-up raids first, then the newest
    const sorted = [...raids].sort((a, b) => Number(b.signed) - Number(a.signed) || b.startTime - a.startTime);
    return (
        <div className="chip-row">
            {sorted.map((r) => (
                <Chip
                    key={r.eventId} pressed={picked.includes(r.eventId)} onClick={() => toggle(r.eventId)}
                    tip={r.title} tipSub={r.signed ? t("vermerke.dialog.raidSigned") : t("vermerke.dialog.raidNotSigned")}
                >
                    <span className="vmk-raid-date">{formatDayMonth(r.startTime * 1000)}</span> {r.title}
                </Chip>
            ))}
        </div>
    );
}
