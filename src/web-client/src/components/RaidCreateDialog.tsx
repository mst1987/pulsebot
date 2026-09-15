import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
    getRaidCreateContext, createRaid,
    type ApiError, type RaidCreateContext, type ReusableEvent,
} from "../api";
import { relativeDayLabel } from "../lib/format";
import { eventDay } from "../lib/raidTime";
import { useToast } from "./Jobs";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import Badge from "./ui/Badge";
import Expand from "./ui/Expand";
import WowIcon from "./ui/WowIcon";
import RaidIcon from "./RaidIcon";
import RaidTemplatesDialog from "./RaidTemplatesDialog";
import { CheckIcon, ChevronRightIcon } from "./icons";
import RaidLoader from "./ui/RaidLoader";

// "Neues Event" as a guided dialog in three steps instead of a long page:
//   1 Vorlage        — repeat the latest event of a category, or start empty,
//   2 Termin & Kanal — the few fields that change from one raid to the next,
//                      leader and description folded away under "Weitere Angaben",
//   3 Prüfen         — the event as the list will show it, then "Event anlegen".
// ?source=<id> (the list's "Wiederholen") opens it straight at step 2.

type Step = 1 | 2 | 3;
/** The chosen template event's id, "" for "Leer beginnen", null while nothing is picked. */
type Choice = string | null;

const STEPS: { n: Step; label: string }[] = [
    { n: 1, label: "Vorlage" },
    { n: 2, label: "Termin & Kanal" },
    { n: 3, label: "Prüfen" },
];

/** A label with its explanation in the tooltip instead of a hint paragraph under the field. */
function Label({ text, tip, htmlFor }: { text: string; tip?: string; htmlFor?: string }) {
    return (
        <label htmlFor={htmlFor} className="re-label">
            {text}
            {tip && <span className="re-info" tabIndex={0} data-tip={text} data-tip-sub={tip}>i</span>}
        </label>
    );
}

function Stepper({ step }: { step: Step }) {
    return (
        <ol className="re-steps" aria-label="Fortschritt">
            {STEPS.map((s, i) => (
                <li key={s.n} className={`re-step${s.n === step ? " on" : ""}${s.n < step ? " done" : ""}`} aria-current={s.n === step ? "step" : undefined}>
                    {i > 0 && <span className="re-step-line" aria-hidden="true" />}
                    <span className="n">{s.n < step ? <CheckIcon /> : s.n}</span>
                    {s.label}
                </li>
            ))}
        </ol>
    );
}

/** YYYY-MM-DD of a Date in local time. */
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * The next date on the template's weekday, at least a day from now and after the
 * template itself — repeating Thursday's raid means next Thursday.
 */
function nextSameWeekday(startTime: number, now = Date.now()): string {
    if (!startTime) return "";
    const src = new Date(startTime * 1000);
    const d = new Date(Math.max(now, startTime * 1000) + 86400000);
    while (d.getDay() !== src.getDay()) d.setDate(d.getDate() + 1);
    return isoDay(d);
}

const clockOf = (startTime: number) => (startTime ? eventDay(startTime).time : "");

/** "t6-do-17-09" → "t6-do-24-09" for a new date; a name without a trailing date stays as it is. */
function channelNameForDate(name: string, date: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!m || !/\d{2}-\d{2}$/.test(name)) return name;
    return name.replace(/\d{2}-\d{2}$/, `${m[3]}-${m[2]}`);
}

/** The latest event of every category, newest first — the templates step 1 offers. */
function latestPerCategory(events: ReusableEvent[]): ReusableEvent[] {
    const best = new Map<string, ReusableEvent>();
    for (const ev of events) {
        const key = ev.categoryId || "__none__";
        const cur = best.get(key);
        if (!cur || (ev.startTime || 0) > (cur.startTime || 0)) best.set(key, ev);
    }
    return [...best.values()].sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
}

function OptionCard({ selected, onSelect, icon, title, sub }: {
    selected: boolean; onSelect: () => void; icon: ReactNode; title: string; sub: ReactNode;
}) {
    return (
        <button type="button" role="radio" aria-checked={selected} className={`re-opt${selected ? " on" : ""}`} onClick={onSelect}>
            {icon}
            <span className="re-opt-text"><span className="re-title">{title}</span><span className="re-sub">{sub}</span></span>
            <span className="re-radio" aria-hidden="true" />
        </button>
    );
}

function EventSub({ ev }: { ev: { channelName?: string; categoryName?: string } }) {
    return (
        <>
            {ev.channelName && <span className="re-chan">#{ev.channelName}</span>}
            {ev.channelName && ev.categoryName && <span aria-hidden="true">·</span>}
            {ev.categoryName && <span>{ev.categoryName}</span>}
        </>
    );
}

export default function RaidCreateDialog({ open, sourceId, csrfToken, userId, onClose, onCreated }: {
    open: boolean;
    sourceId: string;
    csrfToken: string | null;
    userId: string;
    onClose: () => void;
    onCreated: () => void;
}) {
    const toast = useToast();
    const [ctx, setCtx] = useState<RaidCreateContext | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [step, setStep] = useState<Step>(1);
    const [choice, setChoice] = useState<Choice>(null);
    const [saving, setSaving] = useState(false);
    const [moreOpen, setMoreOpen] = useState(false);
    const [templatesOpen, setTemplatesOpen] = useState(false);
    const [channelTouched, setChannelTouched] = useState(false);

    const [title, setTitle] = useState("");
    const [date, setDate] = useState("");
    const [time, setTime] = useState("");
    const [templateId, setTemplateId] = useState("");
    const [channelId, setChannelId] = useState("");
    const [channelName, setChannelName] = useState("");
    const [leaderId, setLeaderId] = useState("");
    const [description, setDescription] = useState("");

    const source = ctx && choice ? ctx.reusableEvents.find((e) => e.id === choice) || null : null;

    const applyChoice = (data: RaidCreateContext, id: string) => {
        setChoice(id);
        setChannelTouched(false);
        const ev = id ? data.reusableEvents.find((e) => e.id === id) : null;
        if (ev) {
            const nextDate = nextSameWeekday(ev.startTime);
            setTitle(ev.title || "");
            setTemplateId(ev.templateId || data.defaults.templateId || "");
            setDescription(ev.description || "");
            setDate(nextDate);
            setTime(clockOf(ev.startTime));
            setChannelName(channelNameForDate(ev.channelName || "", nextDate));
            setChannelId("");
        } else {
            setTitle("");
            setTemplateId(data.defaults.templateId || "");
            setDescription("");
            setDate("");
            setTime("");
            setChannelName("");
            setChannelId(data.defaults.channelId || "");
        }
    };

    useEffect(() => {
        if (!open) return;
        setStep(1);
        setChoice(null);
        setMoreOpen(false);
        setLoadError(null);
        getRaidCreateContext()
            .then((data) => {
                setCtx(data);
                setLeaderId(data.leaderId);
                // ?source=<id>: the list's "Wiederholen" — straight to the dates.
                if (sourceId && data.reusableEvents.some((e) => e.id === sourceId)) {
                    applyChoice(data, sourceId);
                    setStep(2);
                }
            })
            .catch((err: ApiError) => setLoadError(err.message));
    }, [open, sourceId]);

    const options = useMemo(() => {
        if (!ctx) return [];
        const latest = latestPerCategory(ctx.reusableEvents);
        // An explicitly requested source that is not its category's latest still gets a card.
        const extra = sourceId ? ctx.reusableEvents.find((e) => e.id === sourceId && !latest.includes(e)) : null;
        return extra ? [extra, ...latest] : latest;
    }, [ctx, sourceId]);

    const reusing = !!source;
    const changeDate = (value: string) => {
        setDate(value);
        if (reusing && !channelTouched) setChannelName(channelNameForDate(source?.channelName || "", value));
    };

    const step2Ready = !!(title.trim() && date && time && templateId.trim() && leaderId.trim()
        && (reusing ? channelName.trim() : channelId.trim()));

    const submit = async () => {
        setSaving(true);
        try {
            await createRaid(csrfToken, {
                title, date, time, templateId,
                ...(source ? { sourceEventId: source.id, channelName } : { channelId }),
                leaderId, description,
            });
            toast("Event angelegt.");
            onCreated();
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setSaving(false);
        }
    };

    const template = ctx?.templates.find((t) => t.id === templateId) || null;
    const channel = ctx?.channels.find((c) => c.id === channelId) || null;
    const startPreview = date && time ? Math.floor(new Date(`${date}T${time}:00`).getTime() / 1000) : 0;
    const leaderText = leaderId === userId ? "Leitung: du" : leaderId ? `Leitung: ${leaderId}` : "Keine Leitung";
    const descText = description.trim() ? (reusing && description === source?.description ? "Beschreibung übernommen" : "Beschreibung gesetzt") : "ohne Beschreibung";

    let body: ReactNode;
    if (loadError) {
        body = <div className="re-empty">Fehler beim Laden: {loadError}</div>;
    } else if (!ctx) {
        body = <RaidLoader compact text="Vorlagen werden geladen" />;
    } else if (step === 1) {
        body = (
            <>
                <Label text="Wovon ausgehen?" tip="Letztes Event wiederholen: übernimmt Titel, Raid-Helper-Template und Beschreibung. Der Kanal wird fürs neue Datum geklont (Rechte, Thema)." />
                <div className="re-opts" role="radiogroup" aria-label="Vorlage">
                    {options.map((ev) => (
                        <OptionCard
                            key={ev.id}
                            selected={choice === ev.id}
                            onSelect={() => applyChoice(ctx, ev.id)}
                            icon={<RaidIcon contentIds={ev.contentIds} sources={["title"]} />}
                            title={ev.title || "(ohne Titel)"}
                            sub={<EventSub ev={ev} />}
                        />
                    ))}
                    {options.length > 0 && <span className="re-opts-sep" aria-hidden="true" />}
                    <OptionCard
                        selected={choice === ""}
                        onSelect={() => applyChoice(ctx, "")}
                        icon={<span className="raid-ic"><WowIcon name="inv_misc_note_02" size={36} className="a" /></span>}
                        title="Leer beginnen"
                        sub="Kanal wählen statt klonen, Template von Hand"
                    />
                </div>
            </>
        );
    } else if (step === 2) {
        body = (
            <>
                <div className="re-summary">
                    {source
                        ? <RaidIcon contentIds={source.contentIds} sources={["title"]} />
                        : <span className="raid-ic"><WowIcon name="inv_misc_note_02" size={36} className="a" /></span>}
                    <div className="re-opt-text">
                        <span className="kicker">Vorlage</span>
                        <strong>{source ? `${source.title || "(ohne Titel)"}${source.categoryName ? ` · ${source.categoryName}` : ""}` : "Leer beginnen"}</strong>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setStep(1)}>Ändern</Button>
                </div>
                <div className="field">
                    <Label text="Titel" htmlFor="re-title" />
                    <input id="re-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Hyjal + Black Temple" required />
                </div>
                <div className="re-grid2">
                    <div className="field">
                        <Label text="Datum" htmlFor="re-date" />
                        <input id="re-date" type="date" value={date} onChange={(e) => changeDate(e.target.value)} required />
                    </div>
                    <div className="field">
                        <Label text="Uhrzeit" htmlFor="re-time" />
                        <input id="re-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
                    </div>
                    <div className="field">
                        <div className="re-label-row">
                            <Label text="Raid-Helper-Template" htmlFor="re-template" tip="Welche Rollen, Klassen und Plätze das Event hat. Die Liste pflegst du über „Verwalten“." />
                            <button type="button" className="re-link" onClick={() => setTemplatesOpen(true)}>Verwalten</button>
                        </div>
                        <select id="re-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)} required>
                            <option value="">— Template wählen —</option>
                            {templateId && !template && <option value={templateId}>ID {templateId} (nicht in der Liste)</option>}
                            {ctx.templates.map((t) => <option key={t.id} value={t.id}>{t.name || "(ohne Name)"} · ID {t.id}</option>)}
                        </select>
                    </div>
                    {reusing
                        ? (
                            <div className="field">
                                <Label text="Kanalname (Klon)" htmlFor="re-channel" tip={`Der Kanal #${source?.channelName || ""} wird mit Rechten und Thema geklont und bekommt diesen Namen; das Event wird darin gepostet.`} />
                                <input id="re-channel" className="re-mono" type="text" value={channelName} onChange={(e) => { setChannelName(e.target.value); setChannelTouched(true); }} required />
                            </div>
                        )
                        : (
                            <div className="field">
                                <Label text="Kanal" htmlFor="re-channel" tip="Text-Kanäle des oben gewählten Servers. Das Event wird direkt dort gepostet." />
                                {ctx.channels.length
                                    ? (
                                        <select id="re-channel" value={channelId} onChange={(e) => setChannelId(e.target.value)} required>
                                            <option value="">— Kanal wählen —</option>
                                            {ctx.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}{c.category ? ` · ${c.category}` : ""}</option>)}
                                        </select>
                                    )
                                    : <input id="re-channel" type="text" value={channelId} onChange={(e) => setChannelId(e.target.value)} placeholder="Kanal-ID (kein Server gewählt)" required />}
                            </div>
                        )}
                </div>
                <div className={`re-more${moreOpen ? " open" : ""}`}>
                    <div className="re-more-head">
                        <WowIcon name="inv_misc_book_09" size={22} />
                        <div className="re-opt-text">
                            <strong>Weitere Angaben</strong>
                            <span className="re-sub">{leaderText} · {descText}</span>
                        </div>
                        <Expand open={moreOpen} onToggle={() => setMoreOpen((o) => !o)} />
                    </div>
                    {moreOpen && (
                        <div className="re-more-body">
                            <div className="field">
                                <Label text="Event-Leiter (Discord-User-ID)" htmlFor="re-leader" tip="Vorbelegt mit deiner ID." />
                                <input id="re-leader" className="re-mono" type="text" value={leaderId} onChange={(e) => setLeaderId(e.target.value)} required />
                            </div>
                            <div className="field">
                                <Label text="Beschreibung" htmlFor="re-desc" tip="Optional. Steht im Raid-Helper-Post unter dem Titel." />
                                <textarea id="re-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Weitere Infos zum Raid …" />
                            </div>
                        </div>
                    )}
                </div>
            </>
        );
    } else {
        const when = eventDay(startPreview);
        body = (
            <>
                <div className="re-review">
                    {source
                        ? <RaidIcon contentIds={source.contentIds} sources={["title"]} />
                        : <span className="raid-ic"><WowIcon name="inv_misc_note_02" size={36} className="a" /></span>}
                    <div className="re-ev">
                        <span className="re-title">{title}</span>
                        <span className="re-sub">
                            <EventSub ev={{ channelName: reusing ? channelName : channel?.name, categoryName: source?.categoryName || channel?.category }} />
                        </span>
                    </div>
                    <div className="re-when"><b>{when.day}</b><span>{when.time}{startPreview ? ` · ${relativeDayLabel(startPreview)}` : ""}</span></div>
                </div>
                <dl className="re-facts">
                    <dt>Template</dt>
                    <dd>{template ? template.name || "(ohne Name)" : "eigene ID"} <Badge>ID {templateId}</Badge></dd>
                    <dt>Kanal</dt>
                    <dd>{reusing ? <>neu: <code>#{channelName}</code>, geklont aus <code>#{source?.channelName}</code></> : <code>#{channel?.name || channelId}</code>}</dd>
                    <dt>Leitung</dt>
                    <dd>{leaderId === userId ? "du" : <code>{leaderId}</code>}</dd>
                    <dt>Beschreibung</dt>
                    <dd className="re-desc-preview">{description.trim() || "—"}</dd>
                </dl>
            </>
        );
    }

    const cancel = <Button variant="ghost" onClick={onClose}>Abbrechen</Button>;
    const back = step > 1 ? <Button variant="ghost" onClick={() => setStep((s) => (s - 1) as Step)}>Zurück</Button> : undefined;
    let footer: ReactNode;
    if (step === 1) {
        footer = <>{cancel}<Button disabled={choice === null} onClick={() => setStep(2)}>Weiter <ChevronRightIcon /></Button></>;
    } else if (step === 2) {
        footer = <>{cancel}<Button disabled={!step2Ready} onClick={() => setStep(3)}>Weiter: Prüfen <ChevronRightIcon /></Button></>;
    } else {
        footer = <>{cancel}<Button icon="inv_misc_note_05" running={saving} onClick={submit}>Event anlegen</Button></>;
    }

    return (
        <>
            <Modal
                open={open}
                onClose={onClose}
                icon="inv_misc_note_05"

                kicker={`Schritt ${step} von 3`}
                title="Neues Raid-Event"
                width={640}
                hint={back}
                footer={footer}
            >
                <Stepper step={step} />
                <div className="re-dlg-body">{body}</div>
            </Modal>
            {ctx && (
                <RaidTemplatesDialog
                    open={templatesOpen}
                    onClose={() => setTemplatesOpen(false)}
                    templates={ctx.templates}
                    csrfToken={csrfToken}
                    onChanged={(templates) => setCtx({ ...ctx, templates })}
                />
            )}
        </>
    );
}
