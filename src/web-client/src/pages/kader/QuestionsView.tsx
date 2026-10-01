// Fragen (/kader/<id>/fragen): the questions of this Kader's interviews. The
// wishes and the note belong to every interview (the fixed block on top); the
// Kader's own questions follow in their order (drag, or the arrows) and are
// edited on the right: the text, the kind (one answer / several / free text), the
// options, required or not, with a preview. A new question shows as open for
// everybody; deleting one takes its answers along (the dialog says how many);
// renaming an option keeps its answers. "Fragen aus anderem Kader übernehmen"
// copies another Kader's set. Every option of a choice has a colour (a swatch
// beside it; weekdays keep their day colours), saved with the question.
// ?frage=<id> is the question in the editor.
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
    addKaderQuestion, copyKaderQuestions, deleteKaderQuestion, isStale, orderKaderQuestions, updateKaderQuestion,
    type KaderData, type KaderQuestion, type KaderQuestionType, type KaderStaleError,
} from "../../api";
import { Button, IconButton, Modal, Segment } from "../../components/ui";
import Popover from "../../components/ui/Popover";
import { useConfirm } from "../../components/ui/Modal";
import { CheckIcon, ChevronDownIcon, CopyIcon, LockIcon, PlusIcon, SaveIcon, TrashIcon, XIcon } from "../../components/icons";
import { useToast } from "../../components/Jobs";
import { useT } from "../../i18n";
import { dayShort, isWeekdays } from "../../lib/kader/interview";
import { DAY_KEYS, OPTION_COLORS, optionColors, toneAttrs, type OptionColor } from "../../lib/kader/colors";
import { belowStartPlacement } from "../../lib/popoverPosition";
import { changedSince, personName } from "../../lib/kader/live";
import { Grip, SubHead } from "./parts";
import { useKader } from "./kaderContext";
import { ConflictBanner } from "./Presence";

const NEW = "new";
const TYPES: KaderQuestionType[] = ["single", "multi", "text"];
const MAX_QUESTIONS = 30;
const MAX_OPTIONS = 20;

/** An option in the editor; its colour is always resolved, so moving it keeps it (saved with the question). */
type DraftOption = { key: string; id?: string; label: string; color: OptionColor };
type Draft = { text: string; type: KaderQuestionType; options: DraftOption[]; required: boolean };

let keySeq = 0;
const newKey = () => `o${++keySeq}`;

function draftOf(q: KaderQuestion | null): Draft {
    if (!q) {
        const [a, b] = optionColors([{}, {}]);
        return { text: "", type: "single", options: [{ key: newKey(), label: "", color: a }, { key: newKey(), label: "", color: b }], required: false };
    }
    const colors = optionColors(q.options);
    return { text: q.text, type: q.type, options: q.options.map((o, i) => ({ key: o.id, id: o.id, label: o.label, color: colors[i] })), required: q.required };
}

/** How many interviews answered a question. */
function answeredCount(kader: KaderData, questionId: string): number {
    return Object.values(kader.players).filter((e) => e.interview.answers[questionId] !== undefined).length;
}

/** How many answers a save would change: all on a switch to or from free text, else those using a removed option (or several picks turned into one). */
function affectedBy(kader: KaderData, q: KaderQuestion, draft: Draft): number {
    if ((q.type === "text") !== (draft.type === "text")) return answeredCount(kader, q.id);
    const kept = new Set(draft.options.filter((o) => o.id && o.label.trim()).map((o) => o.id));
    return Object.values(kader.players).filter((e) => {
        const v = e.interview.answers[q.id];
        if (v === undefined) return false;
        const ids = Array.isArray(v) ? v : [v];
        return ids.some((id) => !kept.has(id)) || (draft.type === "single" && ids.length > 1);
    }).length;
}

/** Whether the draft's options are the seven weekdays (then they carry the day colours, no swatches). */
function draftIsWeekdays(draft: Draft): boolean {
    const labels = draft.options.map((o) => o.label.trim()).filter(Boolean);
    return draft.type !== "text" && isWeekdays({ id: "", text: "", type: draft.type, options: labels.map((label, i) => ({ id: String(i), label })), required: false });
}

/** The question as the interview will show it: every option in its colour, as if picked. */
function Preview({ draft }: { draft: Draft }) {
    const t = useT();
    const options = draft.options.filter((o) => o.label.trim());
    const days = draftIsWeekdays(draft);
    return (
        <div className="kp-preview">
            <span className="kicker">{t("kader.questions.preview")}</span>
            <span className="kp-strong">{draft.text.trim() || t("kader.questions.untitled")}</span>
            {draft.type === "text" ? <span className="kp-preview-text">{t("kader.questions.previewText")}</span> : (
                <div className={days ? "kp-days" : "kp-pills"}>
                    {options.map((o, i) => (
                        <span key={o.key} className="kp-pill kp-on" {...toneAttrs(days ? { day: DAY_KEYS[i] } : { opt: o.color })}>
                            {!days && <span className={draft.type === "single" ? "kp-radio" : "kp-box"} aria-hidden="true" />}{days ? dayShort(o.label) : o.label.trim()}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

const belowStart = belowStartPlacement();

/** The colour of one option: a dot that opens the palette as a row of swatches (radio buttons, each named). */
function ColorPick({ value, label, onChange }: { value: OptionColor; label: string; onChange: (color: OptionColor) => void }) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const anchor = useRef<HTMLButtonElement>(null);
    const name = t(`kader.color.${value}`);
    return (
        <>
            <button ref={anchor} type="button" className="kp-swatchbtn" aria-haspopup="true" aria-expanded={open}
                aria-label={t("kader.questions.optionColor", { label, color: name })} data-tip={t("kader.questions.optionColor", { label, color: name })}
                onClick={() => setOpen(!open)}>
                <span className="kp-tonedot" aria-hidden="true" {...toneAttrs({ opt: value })} />
            </button>
            {open && (
                <Popover anchor={anchor} place={belowStart} follow="reposition" onClose={() => setOpen(false)} className="kp-wmenu kp-swatches">
                    <div role="radiogroup" aria-label={t("kader.questions.optionColor", { label, color: name })} className="kp-swatchrow">
                        {OPTION_COLORS.map((c) => (
                            <button key={c} type="button" role="radio" aria-checked={c === value} aria-label={t(`kader.color.${c}`)} data-tip={t(`kader.color.${c}`)}
                                className={`kp-swatch${c === value ? " kp-on" : ""}`} {...toneAttrs({ opt: c })}
                                onClick={() => { onChange(c); setOpen(false); anchor.current?.focus(); }}>
                                {c === value && <CheckIcon />}
                            </button>
                        ))}
                    </div>
                </Popover>
            )}
        </>
    );
}

function Editor({ question, onSaved, onDeleted }: { question: KaderQuestion | null; onSaved: (questionId: string) => void; onDeleted: () => void }) {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const { view, kader, canWrite, run, refresh, me } = useKader();
    // the question as the draft started from it; its revision goes with the save
    const [base, setBase] = useState<KaderQuestion | null>(question);
    const [draft, setDraft] = useState<Draft>(() => draftOf(question));
    const [from, setFrom] = useState<number | null>(null);
    const [conflict, setConflict] = useState<{ by: string } | null>(null);
    const saving = useRef(false);
    const dirty = base ? JSON.stringify(draft) !== JSON.stringify(draftOf(base)) : true;

    /** Starts the draft again from the question as it is now ("Neu laden", or nothing typed yet). */
    const takeCurrent = (q: KaderQuestion) => {
        setBase(q);
        setDraft(draftOf(q));
        setConflict(null);
    };
    // somebody else changed the question while it is open: an untouched draft follows, a touched one asks
    const questionRev = question ? question.rev || 0 : 0;
    useEffect(() => {
        if (saving.current || !question || !base || questionRev === (base.rev || 0)) return;
        if (!dirty) takeCurrent(question);
        else if (!conflict) {
            const line = changedSince(kader, base.rev || 0, me, ["questions"]);
            setConflict({ by: line ? line.by : "" });
        }
        // only a new revision of the question matters here
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [questionRev]);
    const options = draft.options.filter((o) => o.label.trim());
    const ready = !!draft.text.trim() && (draft.type === "text" || options.length >= 2);
    const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
    const setOption = (i: number, label: string) => set({ options: draft.options.map((o, j) => (j === i ? { ...o, label } : o)) });
    const setColor = (i: number, color: OptionColor) => set({ options: draft.options.map((o, j) => (j === i ? { ...o, color } : o)) });
    // a new option takes the first colour no option holds yet
    const addOption = () => set({ options: [...draft.options, { key: newKey(), label: "", color: optionColors([...draft.options, {}])[draft.options.length] }] });
    const days = draftIsWeekdays(draft);
    const moveOption = (a: number, b: number) => {
        if (a === b || b < 0 || b >= draft.options.length) return;
        const next = [...draft.options];
        const [moved] = next.splice(a, 1);
        next.splice(b, 0, moved);
        set({ options: next });
    };
    const fillWeekdays = () => {
        const colors = optionColors(DAY_KEYS.map(() => ({})));
        set({ type: "multi", options: DAY_KEYS.map((d, i) => ({ key: newKey(), label: t(`kader.dayLong.${d}`), color: colors[i] })) });
    };

    /** Saves the draft; `force` overwrites a version somebody else saved meanwhile ("Trotzdem speichern"). */
    const save = async (force = false) => {
        if (!ready) return;
        const input = {
            text: draft.text.trim(),
            type: draft.type,
            required: draft.required,
            // every option with its colour: moving one later keeps it
            options: draft.type === "text" ? [] : options.map((o) => (o.id ? { id: o.id, label: o.label.trim(), color: o.color } : { label: o.label.trim(), color: o.color })),
        };
        if (question) {
            const lost = affectedBy(kader, question, draft);
            if (lost && !(await ask({ title: t("kader.questions.loseTitle", { n: lost }), text: t("kader.questions.loseText"), action: t("common.save"), tone: "danger" }))) return;
            const caught: { stale?: KaderStaleError } = {};
            saving.current = true;
            const result = await run(updateKaderQuestion(kader.id, question.id, input, force ? { force: true } : { baseRev: base ? base.rev || 0 : 0 }), {
                onError: (e) => {
                    if (!isStale(e)) return false;
                    caught.stale = e;
                    return true;
                },
            });
            saving.current = false;
            if (caught.stale) {
                setConflict({ by: caught.stale.by || "" });
                void refresh();
                return;
            }
            const saved = result && result.kader ? result.kader.questions.find((q) => q.id === question.id) : undefined;
            if (saved) takeCurrent(saved);
            if (result) toast(t("kader.questions.saved"));
            return;
        }
        const result = await run(addKaderQuestion(kader.id, input));
        if (result && result.questionId) {
            toast(t("kader.questions.added"));
            onSaved(result.questionId);
        }
    };
    const remove = async () => {
        if (!question) return;
        const n = answeredCount(kader, question.id);
        const text = n ? t("kader.questions.deleteText", { n }) : t("kader.questions.deleteTextNone");
        if (!(await ask({ title: t("kader.questions.deleteTitle", { text: question.text }), text, action: t("common.delete"), tone: "danger" }))) return;
        if (await run(deleteKaderQuestion(kader.id, question.id))) onDeleted();
    };

    return (
        <section className="kp-panel kp-qeditor" aria-label={t("kader.questions.editor")}>
            {conflict && question && (
                <ConflictBanner text={t("kader.live.conflict.question", { name: personName(view, conflict.by) })}
                    onReload={() => takeCurrent(question)} onOverwrite={() => void save(true)} />
            )}
            <fieldset disabled={!canWrite}>
                <label className="field">
                    <span className="kicker">{t("kader.questions.text")}</span>
                    <input className="kp-qtext" value={draft.text} maxLength={200} placeholder={t("kader.questions.textPlaceholder")} onChange={(e) => set({ text: e.target.value })} />
                </label>
                <div className="field">
                    <span className="kicker">{t("kader.questions.type")}</span>
                    <Segment<KaderQuestionType> ariaLabel={t("kader.questions.type")} value={draft.type} onChange={(type) => set({ type })}
                        options={TYPES.map((type) => ({ value: type, label: t(`kader.qtype.${type}`) }))} />
                </div>
                {draft.type !== "text" && (
                    <div className="field">
                        <div className="kp-between">
                            <span className="kicker">{t("kader.questions.options")}</span>
                            {canWrite && <button type="button" className="kp-link" onClick={fillWeekdays}>{t("kader.questions.weekdays")}</button>}
                        </div>
                        <ol className="kp-optgrid">
                            {draft.options.map((o, i) => (
                                <li key={o.key} className={`kp-opt${from === i ? " kp-dragging" : ""}`} draggable={canWrite}
                                    onDragStart={(e) => { e.dataTransfer.setData("text/plain", String(i)); setFrom(i); }}
                                    onDragOver={(e) => { if (from !== null) e.preventDefault(); }}
                                    onDrop={(e) => { e.preventDefault(); if (from !== null) moveOption(from, i); setFrom(null); }}
                                    onDragEnd={() => setFrom(null)}>
                                    <Grip />
                                    {days
                                        ? <span className="kp-tonedot kp-tonedot-fixed" aria-hidden="true" {...toneAttrs({ day: DAY_KEYS[i] || "mo" })} />
                                        : <ColorPick value={o.color} label={o.label.trim() || t("kader.questions.optionN", { n: i + 1 })} onChange={(c) => setColor(i, c)} />}
                                    <input className="kp-optinput" aria-label={t("kader.questions.optionN", { n: i + 1 })} value={o.label} maxLength={60} onChange={(e) => setOption(i, e.target.value)} />
                                    <IconButton icon={<ChevronDownIcon />} className="kp-flip" size="sm" tip={t("kader.interview.up")} disabled={i === 0} onClick={() => moveOption(i, i - 1)} />
                                    <IconButton icon={<XIcon />} size="sm" tip={t("kader.questions.removeOption")} onClick={() => set({ options: draft.options.filter((_, j) => j !== i) })} />
                                </li>
                            ))}
                            {canWrite && (
                                <li>
                                    <button type="button" className="kp-dashed" disabled={draft.options.length >= MAX_OPTIONS} onClick={addOption}>
                                        <PlusIcon />{t("kader.questions.addOption")}
                                    </button>
                                </li>
                            )}
                        </ol>
                        <span className="kp-hint">{days ? t("kader.questions.colorHintDays") : t("kader.questions.colorHint")}</span>
                        {question && <span className="kp-hint">{t("kader.questions.renameHint")}</span>}
                    </div>
                )}
                <label className="kp-checkline">
                    <input type="checkbox" checked={draft.required} onChange={(e) => set({ required: e.target.checked })} />
                    {t("kader.questions.required")}
                </label>
            </fieldset>
            <Preview draft={draft} />
            {canWrite && (
                <div className="kp-qeditor-foot">
                    {question ? <Button variant="danger" icon={<TrashIcon />} onClick={() => void remove()}>{t("kader.questions.delete")}</Button> : <span />}
                    <Button icon={question ? <SaveIcon /> : <PlusIcon />} disabled={!ready || !!conflict} onClick={() => void save()}>{question ? t("common.save") : t("kader.questions.create")}</Button>
                </div>
            )}
        </section>
    );
}

function CopyModal({ onClose, onCopied }: { onClose: () => void; onCopied: () => void }) {
    const t = useT();
    const toast = useToast();
    const { view, kader, run } = useKader();
    const others = view.kaders.filter((k) => k.id !== kader.id && k.questions > 0);
    const [fromId, setFromId] = useState(others[0] ? others[0].id : "");
    const from = others.find((k) => k.id === fromId);
    const tooMany = !!from && kader.questions.length + from.questions > MAX_QUESTIONS;
    const copy = async () => {
        if (!from) return;
        const result = await run(copyKaderQuestions(kader.id, from.id));
        if (result) {
            toast(t("kader.questions.copied", { n: result.copied || 0, name: from.name }));
            onCopied();
        }
    };
    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_misc_groupneedmore"
            tone="kader"
            title={t("kader.questions.copyTitle")}
            width={480}
            className="kp-dialog"
            hint={t("kader.questions.copyHint")}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button icon={<CopyIcon />} disabled={!from || tooMany} onClick={() => void copy()}>{t("kader.questions.copy")}</Button>
                </>
            )}
        >
            {others.length === 0 ? <p className="kp-hint">{t("kader.questions.copyNone")}</p> : (
                <div className="kp-radiolist" role="radiogroup" aria-label={t("kader.questions.copyFrom")}>
                    {others.map((k) => (
                        <label key={k.id} className={`kp-radioline${k.id === fromId ? " kp-on" : ""}`}>
                            <input type="radio" name="kp-copy-from" checked={k.id === fromId} onChange={() => setFromId(k.id)} />
                            <span className="kp-grow">{k.name}</span>
                            <span className="kp-sub">{t("kader.questions.countN", { n: k.questions })}</span>
                        </label>
                    ))}
                </div>
            )}
            {tooMany && <p className="kp-warntext">{t("kader.questions.tooMany", { max: MAX_QUESTIONS })}</p>}
        </Modal>
    );
}

export default function QuestionsView() {
    const t = useT();
    const { kader, canWrite, run } = useKader();
    const [params, setParams] = useSearchParams();
    const [copying, setCopying] = useState(false);
    const [from, setFrom] = useState<number | null>(null);
    const wanted = params.get("frage") || "";
    const questions = kader.questions;
    const selected = wanted === NEW ? null : questions.find((q) => q.id === wanted) || questions[0] || null;
    const editing = wanted === NEW || !questions.length ? NEW : selected ? selected.id : NEW;
    const pick = (id: string) => setParams({ frage: id }, { replace: true });
    const inSelection = Object.values(kader.players).filter((e) => e.state === "selected").length;

    const reorder = (a: number, b: number) => {
        if (a === b || b < 0 || b >= questions.length) return;
        const order = questions.map((q) => q.id);
        const [moved] = order.splice(a, 1);
        order.splice(b, 0, moved);
        void run(orderKaderQuestions(kader.id, order));
    };

    return (
        <div className="kp-view">
            <SubHead back="vorauswahl" backLabel={t("kader.questions.back")} kicker={t("kader.questions.kicker", { name: kader.name })} title={t("kader.questions.title")} />
            <div className="kp-qgrid">
                <section className="kp-qlist" aria-label={t("kader.questions.list")}>
                    <div className="kp-fixed">
                        <LockIcon />
                        <span className="kp-col kp-grow">
                            <span className="kp-strong">{t("kader.questions.fixedTitle")}</span>
                            <span className="kp-sub kp-wrap">{t("kader.questions.fixedText")}</span>
                        </span>
                    </div>
                    <div className="kp-between">
                        <h2>{t("kader.questions.own", { n: questions.length })}</h2>
                        {questions.length > 1 && <span className="kp-sub">{t("kader.questions.dragHint")}</span>}
                    </div>
                    <ol className="kp-qitems">
                        {questions.map((q, i) => (
                            <li key={q.id} className={`kp-qitem${editing === q.id ? " kp-current" : ""}${from === i ? " kp-dragging" : ""}`} draggable={canWrite}
                                onDragStart={(e) => { e.dataTransfer.setData("text/plain", String(i)); setFrom(i); }}
                                onDragOver={(e) => { if (from !== null) e.preventDefault(); }}
                                onDrop={(e) => { e.preventDefault(); if (from !== null) reorder(from, i); setFrom(null); }}
                                onDragEnd={() => setFrom(null)}>
                                {canWrite && <Grip />}
                                <button type="button" className="kp-qitem-main" aria-current={editing === q.id ? "true" : undefined} onClick={() => pick(q.id)}>
                                    <span className="kp-strong">{q.text}{q.required && <span className="kp-req" aria-label={t("kader.questions.requiredShort")}> *</span>}</span>
                                    <span className="kp-sub">{q.type === "text" ? t("kader.qtype.textHint") : q.options.map((o) => o.label).join(" · ")}</span>
                                </button>
                                <span className={`kp-qtype kp-qtype-${q.type}`}>{t(`kader.qtype.${q.type}Short`)}</span>
                                {canWrite && (
                                    <span className="kp-qitem-act">
                                        <IconButton icon={<ChevronDownIcon />} className="kp-flip" size="sm" tip={t("kader.interview.up")} disabled={i === 0} onClick={() => reorder(i, i - 1)} />
                                        <IconButton icon={<ChevronDownIcon />} size="sm" tip={t("kader.interview.down")} disabled={i === questions.length - 1} onClick={() => reorder(i, i + 1)} />
                                    </span>
                                )}
                            </li>
                        ))}
                    </ol>
                    {canWrite && (
                        <>
                            <button type="button" className={`kp-dashed kp-dashed-lg${editing === NEW && questions.length ? " kp-current" : ""}`} disabled={questions.length >= MAX_QUESTIONS} onClick={() => pick(NEW)}>
                                <PlusIcon />{t("kader.questions.add")}
                            </button>
                            <button type="button" className="kp-link kp-center kp-withicon" onClick={() => setCopying(true)}><CopyIcon />{t("kader.questions.copyFromOther")}</button>
                        </>
                    )}
                    <p className="kp-note">{t("kader.questions.note", { n: inSelection })}</p>
                </section>
                {/* keyed by the question alone: a change seen live never throws away what is typed (the editor decides) */}
                <Editor key={editing} question={editing === NEW ? null : selected}
                    onSaved={(id) => pick(id)} onDeleted={() => setParams({}, { replace: true })} />
            </div>
            {copying && <CopyModal onClose={() => setCopying(false)} onCopied={() => { setCopying(false); setParams({}, { replace: true }); }} />}
        </div>
    );
}
