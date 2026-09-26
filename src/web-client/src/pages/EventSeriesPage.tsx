import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
    deleteEventSeries, getEventSeries, previewEventSeries, runEventSeries, saveEventSeries,
    type ApiError, type EventSeriesData, type EventSeriesInput, type SeriesCategory, type SeriesDate, type SeriesPreview } from "../api";
import { useApi } from "../hooks/useApi";
import AsyncView from "../components/ui/AsyncView";
import { useCollectionEditor } from "../lib/collectionEditor";
import {
    WEEKDAYS, channelOf, dateLine, dayLabel, draftOf, lastCreatedLine, nextDate, previewQuery, stateBadge, toggleSkip, toggleWeekday } from "../lib/eventSeries";
import { useToast } from "../components/Jobs";
import { Modal, useConfirm } from "../components/ui/Modal";
import { Button, IconButton } from "../components/ui/Button";
import PageHead from "../components/ui/PageHead";
import Badge from "../components/ui/Badge";
import RaidLoader from "../components/ui/RaidLoader";
import NamingBadge from "../components/channels/NamingBadge";
import { SwitchRow } from "../components/RaidPlanFields";
import { RefreshIcon } from "../components/icons";
import { PenIcon, WarnIcon } from "../components/settings/settingsUi";
import "../styles/serien.css";

// Wiederkehrende Events (#289): one compact line per event category —
// "Mi 19:30 · SSC + TK 25er · 6 Tage vorher" and, on the right, the next date
// with what will happen to it ("wird am Do 17.09. um 19:30 angelegt" or
// "angelegt am … als #…"). Everything else sits in the modal (?edit=<category>),
// which previews the next four dates with the channel each would get, so the
// logic is visible before anything is saved. The scheduler is src/web/eventSeries.js.

const ICON = "spell_holy_borrowedtime";

function DateRow({ o, draft, canWrite, onSkip, onRetry }: {
    o: SeriesDate;
    draft: EventSeriesInput | null;
    canWrite: boolean;
    onSkip?: (date: string) => void;
    onRetry?: (date: string) => void;
}) {
    const badge = stateBadge(o.state);
    const channel = channelOf(o);
    // Only a date that has not happened yet can be skipped (or un-skipped).
    const skippable = !!draft && ["planned", "due", "skipped", "off"].includes(o.state);
    const retry = canWrite && onRetry && (o.state === "failed" || o.state === "interrupted");
    return (
        <li className={`sr-date sr-st-${o.state}`}>
            <div className="sr-when">
                <span className="sr-day">{dayLabel(o.date)}</span>
                <Badge tone={badge.tone || undefined}>{badge.label}</Badge>
            </div>
            <div className="sr-what">
                {channel && (
                    <div className="sr-channel">
                        <span className="mono">#{channel}</span>
                        {o.naming && <NamingBadge naming={o.naming} short />}
                    </div>
                )}
                <div className="sr-line">{dateLine(o)}</div>
            </div>
            {retry && <Button size="sm" variant="ghost" onClick={() => onRetry(o.date)}>Erneut versuchen</Button>}
            {skippable && onSkip && (
                <label className="sr-skip" data-tip="Termin überspringen" data-tip-sub="Für diesen Tag wird kein Event angelegt, z. B. an einem Feiertag. Wirkt nach dem Speichern.">
                    <input type="checkbox" checked={draft.skipDates.includes(o.date)} onChange={() => onSkip(o.date)} disabled={!canWrite} />
                    überspringen
                </label>
            )}
        </li>
    );
}

function SeriesModal({ category, data, canWrite, onChanged, onClose }: {
    category: SeriesCategory;
    data: EventSeriesData;
    canWrite: boolean;
    onChanged: (msg: string, close: boolean) => void;
    onClose: () => void;
}) {
    const toast = useToast();
    const ask = useConfirm();
    const [draft, setDraft] = useState<EventSeriesInput>(() => draftOf(category.series, category.id));
    const [preview, setPreview] = useState<SeriesPreview | null>(null);
    const [saving, setSaving] = useState(false);
    const [reload, setReload] = useState(0);
    const query = previewQuery(draft);

    useEffect(() => {
        let alive = true;
        const timer = setTimeout(() => {
            previewEventSeries(query)
                .then((p) => { if (alive) setPreview(p); })
                .catch((err: ApiError) => { if (alive) setPreview({ error: err.message, summary: "", upcoming: [], template: null }); });
        }, 250);
        return () => { alive = false; clearTimeout(timer); };
    }, [query, reload]);

    const patch = (fields: Partial<EventSeriesInput>) => setDraft((d) => ({ ...d, ...fields }));
    const defaultTemplate = category.template && (!category.series || !category.series.raidTemplateId) ? category.template : null;
    const raidHelper = category.source !== "eventhelper";

    const save = async () => {
        setSaving(true);
        try {
            const r = await saveEventSeries(draft);
            onChanged(r.message, true);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        if (!(await ask({ title: "Serie löschen?", text: "Es werden keine weiteren Events angelegt. Bereits angelegte Events und Kanäle bleiben.", action: "Löschen" }))) return;
        try {
            const r = await deleteEventSeries(category.id);
            onChanged(r.message, true);
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    const retry = async (date: string) => {
        try {
            const r = await runEventSeries(category.id, date);
            onChanged(r.message, false);
            setPreview(null);
            setReload((n) => n + 1);
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    const problem = preview ? preview.error : "";

    return (
        <Modal
            open
            onClose={onClose}
            icon={ICON}
            tone="raids"
            kicker="Serie"
            title={category.name || "Unbekannte Kategorie"}
            width={720}
            hint={category.series && canWrite ? <Button variant="danger" size="sm" onClick={remove}>Löschen</Button> : undefined}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                    {canWrite && <Button running={saving} disabled={!!problem || !preview} onClick={save} data-tip={problem || undefined}>Speichern</Button>}
                </>
            )}
        >
            {raidHelper && (
                <div className="sr-warn" role="note"><WarnIcon /> Neue Events dieser Kategorie laufen über Raid-Helper — die Serie ruht, bis die Kategorie unter <Link to="/settings?section=kategorien">Einstellungen → Kategorien</Link> auf EventHelper steht.</div>
            )}
            <div className="sr-top">
                <SwitchRow label="Serie aktiv" tip="Aus = es werden keine Events angelegt; die Einstellungen bleiben." checked={draft.enabled} onChange={(enabled) => patch({ enabled })} />
                <div className="sr-summary" data-tip="So liest sich die Serie in der Liste">{preview && preview.summary ? preview.summary : "…"}</div>
            </div>

            <div className="sr-field">
                <span className="sr-label">Wochentage</span>
                <div className="sr-days" role="group" aria-label="Wochentage">
                    {WEEKDAYS.map((d) => {
                        const on = draft.weekdays.includes(d.value);
                        return (
                            <button key={d.value} type="button" className={`sr-daychip${on ? " on" : ""}`} aria-pressed={on} data-tip={d.long}
                                onClick={() => setDraft((x) => toggleWeekday(x, d.value))} disabled={!canWrite}>
                                {d.short}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="sr-grid">
                <div className="sr-field">
                    <label className="sr-label" htmlFor="sr-time">Uhrzeit</label>
                    <input id="sr-time" type="time" value={draft.time} onChange={(e) => patch({ time: e.target.value })} disabled={!canWrite} />
                </div>
                <div className="sr-field">
                    <label className="sr-label" htmlFor="sr-before" data-tip="Tage vorher anlegen" data-tip-sub="So viele Kalendertage vor dem Raid legt der Bot Kanal, Event und Anmelder-Nachricht an — zur selben Uhrzeit.">Tage vorher anlegen</label>
                    <input id="sr-before" type="number" min={data.limits.minDaysBefore} max={data.limits.maxDaysBefore} value={draft.daysBefore}
                        onChange={(e) => patch({ daysBefore: Number(e.target.value) })} disabled={!canWrite} />
                </div>
                <div className="sr-field">
                    <label className="sr-label" htmlFor="sr-template">Raid-Vorlage</label>
                    <select id="sr-template" value={draft.raidTemplateId} onChange={(e) => patch({ raidTemplateId: e.target.value })} disabled={!canWrite}>
                        <option value="">{defaultTemplate ? `Standard der Kategorie (${defaultTemplate.name})` : "— bitte wählen —"}</option>
                        {data.templates.map((t) => <option key={t.id} value={t.id}>{t.name || "(ohne Name)"}</option>)}
                    </select>
                </div>
            </div>
            <div className="sr-field">
                <label className="sr-label" htmlFor="sr-title" data-tip="Titel" data-tip-sub="Leer = Name der Raid-Vorlage.">Titel</label>
                <input id="sr-title" type="text" value={draft.title} placeholder={(preview && preview.template && preview.template.name) || "Name der Vorlage"}
                    onChange={(e) => patch({ title: e.target.value })} disabled={!canWrite} />
            </div>

            <div className="sr-part">
                <div className="sr-part-head">
                    <span className="sr-label">Nächste 4 Termine</span>
                    <span className="sr-muted">Kanal, Anmelder-Nachricht und Eintrag in der Talk-Übersicht entstehen zum genannten Zeitpunkt.</span>
                </div>
                {problem && <div className="sr-problem" role="alert">{problem}</div>}
                {!preview && <RaidLoader compact text="Termine werden berechnet" />}
                {preview && !problem && (
                    <ul className="sr-dates">
                        {preview.upcoming.map((o) => (
                            <DateRow key={o.date} o={o} draft={draft} canWrite={canWrite}
                                onSkip={(date) => setDraft((x) => toggleSkip(x, date))} onRetry={retry} />
                        ))}
                    </ul>
                )}
            </div>
        </Modal>
    );
}

function SeriesRow({ c, canWrite, onOpen }: { c: SeriesCategory; canWrite: boolean; onOpen: () => void }) {
    const next = nextDate(c.upcoming);
    const raidHelper = c.source !== "eventhelper";
    const failed = c.upcoming.filter((o) => o.state === "failed" || o.state === "interrupted").length;
    const name = c.name || "Unbekannte Kategorie";

    if (!c.series) {
        return (
            <li className="sr-row sr-empty" data-category={c.id}>
                <div className="sr-main">
                    <div className="sr-name">{name}</div>
                    <div className="sr-sub">
                        {raidHelper
                            ? <span className="sr-muted">Neue Events über Raid-Helper — Serien nur mit „Neue Events: EventHelper“ (<Link to="/settings?section=kategorien">Kategorien</Link>)</span>
                            : <span className="sr-muted">keine Serie</span>}
                    </div>
                </div>
                {!raidHelper && canWrite && <Button size="sm" variant="ghost" icon={ICON} onClick={onOpen}>Serie einrichten</Button>}
            </li>
        );
    }

    return (
        <li className={`sr-row${c.series.enabled && !raidHelper ? "" : " sr-off"}`} data-category={c.id}>
            <button type="button" className="sr-open" onClick={onOpen} aria-label={`Serie ${name} öffnen`} />
            <div className="sr-main">
                <div className="sr-name">
                    {name}
                    {!c.series.enabled && <Badge>aus</Badge>}
                    {raidHelper && <Badge tone="mid" icon={<WarnIcon />} tip="Serie ruht" tipSub="Neue Events dieser Kategorie laufen über Raid-Helper. Unter Einstellungen → Kategorien auf EventHelper stellen.">Raid-Helper</Badge>}
                    {failed > 0 && <Badge tone="bad" icon={<WarnIcon />}>{failed === 1 ? "1 Fehler" : `${failed} Fehler`}</Badge>}
                </div>
                <div className="sr-sub mono">{c.summary}</div>
            </div>
            <div className="sr-next">
                {next ? (
                    <>
                        <div className="sr-next-head">
                            <span className="sr-label">Nächster Termin</span>
                            <span className="sr-day">{dayLabel(next.date)}</span>
                            {channelOf(next) && <span className="mono sr-chan">#{channelOf(next)}</span>}
                        </div>
                        <div className="sr-line">{dateLine(next)}</div>
                    </>
                ) : <div className="sr-line">kein Termin in Sicht</div>}
                {c.lastCreated && next && next.date !== c.lastCreated.date && (
                    <div className="sr-line sr-muted">{lastCreatedLine(c.lastCreated)}</div>
                )}
            </div>
            <IconButton size="sm" icon={<PenIcon />} tip="Serie bearbeiten" onClick={onOpen} />
        </li>
    );
}

export default function EventSeriesPage() {
    const editor = useCollectionEditor("edit");
    const toast = useToast();
    const series = useApi(() => getEventSeries(), []);
    const [running, setRunning] = useState(false);

    return (
        <AsyncView state={series} loading={<RaidLoader text="Serien werden geladen" />} error={(err) => <div className="empty">Fehler beim Laden: {err.message}</div>}>
            {(data) => {
                const canWrite = data.canWrite;
                const editing = editor.editId ? data.categories.find((c) => c.id === editor.editId) || null : null;

                const runNow = async () => {
                    setRunning(true);
                    try {
                        const r = await runEventSeries();
                        toast(r.message, r.failed ? "err" : undefined);
                        series.reload();
                    } catch (err) {
                        toast((err as ApiError).message, "err");
                    } finally {
                        setRunning(false);
                    }
                };

                return (
                    <div className="sr-page">
                        <PageHead
                            icon={ICON}
                            tone="raids"
                            kicker="Raid-Events"
                            title="Serien"
                            action={canWrite ? (
                                <IconButton icon={<RefreshIcon />} tip="Jetzt prüfen" tipSub="Legt alle fälligen Termine sofort an, statt auf den nächsten Durchlauf zu warten (alle 5 Minuten)." disabled={running} onClick={runNow} />
                            ) : undefined}
                        />

                        {data.categories.length === 0
                            ? <div className="empty">Noch keine Raid-Kategorien — sie werden unter Einstellungen → Kategorien eingeschaltet.</div>
                            : (
                                <ul className="sr-list">
                                    {data.categories.map((c) => (
                                        <SeriesRow key={c.id} c={c} canWrite={canWrite} onOpen={() => editor.startEdit(c.id)} />
                                    ))}
                                </ul>
                            )}

                        {editing && (
                            <SeriesModal
                                key={editing.id}
                                category={editing}
                                data={data}
                                canWrite={canWrite}
                                onClose={editor.close}
                                onChanged={(msg, close) => {
                                    toast(msg);
                                    if (close) editor.close();
                                    series.reload();
                                }}
                            />
                        )}
                    </div>
                );
            }}
        </AsyncView>
    );
}
