// Fragen (/kader/<id>/fragen): the questions of this Kader's interviews. The
// wishes and the note belong to every interview (the fixed block on top); the
// Kader's own questions follow in their order (drag, or the arrows) and are
// edited on the right: the text, the kind (one answer / several / free text), the
// options, required or not, with a preview. A new question shows as open for
// everybody; deleting one takes its answers along (the dialog says how many);
// renaming an option keeps its answers. "Fragen aus anderem Kader übernehmen"
// copies another Kader's set. ?frage=<id> is the question in the editor.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
    addKaderQuestion, copyKaderQuestions, deleteKaderQuestion, orderKaderQuestions, updateKaderQuestion,
    type KaderData, type KaderQuestion, type KaderQuestionType,
} from "../../api";
import { Button, IconButton, Modal, Segment } from "../../components/ui";
import { useConfirm } from "../../components/ui/Modal";
import { ChevronDownIcon, CopyIcon, LockIcon, PlusIcon, SaveIcon, TrashIcon, XIcon } from "../../components/icons";
import { useToast } from "../../components/Jobs";
import { useT } from "../../i18n";
import { dayShort, isWeekdays } from "../../lib/kader/interview";
import { Grip, SubHead } from "./parts";
import { useKader } from "./kaderContext";

const NEW = "new";
const TYPES: KaderQuestionType[] = ["single", "multi", "text"];
const MAX_QUESTIONS = 30;
const MAX_OPTIONS = 20;
const WEEKDAY_KEYS = ["mo", "di", "mi", "do", "fr", "sa", "so"];

type DraftOption = { key: string; id?: string; label: string };
type Draft = { text: string; type: KaderQuestionType; options: DraftOption[]; required: boolean };

let keySeq = 0;
const newKey = () => `o${++keySeq}`;

function draftOf(q: KaderQuestion | null): Draft {
    if (!q) return { text: "", type: "single", options: [{ key: newKey(), label: "" }, { key: newKey(), label: "" }], required: false };
    return { text: q.text, type: q.type, options: q.options.map((o) => ({ key: o.id, id: o.id, label: o.label })), required: q.required };
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

function Preview({ draft }: { draft: Draft }) {
    const t = useT();
    const labels = draft.options.map((o) => o.label.trim()).filter(Boolean);
    const days = draft.type !== "text" && isWeekdays({ id: "", text: "", type: draft.type, options: labels.map((label, i) => ({ id: String(i), label })), required: false });
    return (
        <div className="kp-preview">
            <span className="kicker">{t("kader.questions.preview")}</span>
            <span className="kp-strong">{draft.text.trim() || t("kader.questions.untitled")}</span>
            {draft.type === "text" ? <span className="kp-preview-text">{t("kader.questions.previewText")}</span> : (
                <div className={days ? "kp-days" : "kp-pills"}>
                    {labels.map((label, i) => (
                        <span key={`${label}-${i}`} className="kp-pill">
                            {!days && <span className={draft.type === "single" ? "kp-radio" : "kp-box"} aria-hidden="true" />}{days ? dayShort(label) : label}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

function Editor({ question, onSaved, onDeleted }: { question: KaderQuestion | null; onSaved: (questionId: string) => void; onDeleted: () => void }) {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const { kader, canWrite, run } = useKader();
    const [draft, setDraft] = useState<Draft>(() => draftOf(question));
    const [from, setFrom] = useState<number | null>(null);
    const options = draft.options.filter((o) => o.label.trim());
    const ready = !!draft.text.trim() && (draft.type === "text" || options.length >= 2);
    const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
    const setOption = (i: number, label: string) => set({ options: draft.options.map((o, j) => (j === i ? { ...o, label } : o)) });
    const moveOption = (a: number, b: number) => {
        if (a === b || b < 0 || b >= draft.options.length) return;
        const next = [...draft.options];
        const [moved] = next.splice(a, 1);
        next.splice(b, 0, moved);
        set({ options: next });
    };
    const fillWeekdays = () => set({ type: "multi", options: WEEKDAY_KEYS.map((d) => ({ key: newKey(), label: t(`kader.dayLong.${d}`) })) });

    const save = async () => {
        if (!ready) return;
        const input = {
            text: draft.text.trim(),
            type: draft.type,
            required: draft.required,
            options: draft.type === "text" ? [] : options.map((o) => (o.id ? { id: o.id, label: o.label.trim() } : { label: o.label.trim() })),
        };
        if (question) {
            const lost = affectedBy(kader, question, draft);
            if (lost && !(await ask({ title: t("kader.questions.loseTitle", { n: lost }), text: t("kader.questions.loseText"), action: t("common.save"), tone: "danger" }))) return;
            if (await run(updateKaderQuestion(kader.id, question.id, input))) toast(t("kader.questions.saved"));
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
                                    <input className="kp-optinput" aria-label={t("kader.questions.optionN", { n: i + 1 })} value={o.label} maxLength={60} onChange={(e) => setOption(i, e.target.value)} />
                                    <IconButton icon={<ChevronDownIcon />} className="kp-flip" size="sm" tip={t("kader.interview.up")} disabled={i === 0} onClick={() => moveOption(i, i - 1)} />
                                    <IconButton icon={<XIcon />} size="sm" tip={t("kader.questions.removeOption")} onClick={() => set({ options: draft.options.filter((_, j) => j !== i) })} />
                                </li>
                            ))}
                            {canWrite && (
                                <li>
                                    <button type="button" className="kp-dashed" disabled={draft.options.length >= MAX_OPTIONS} onClick={() => set({ options: [...draft.options, { key: newKey(), label: "" }] })}>
                                        <PlusIcon />{t("kader.questions.addOption")}
                                    </button>
                                </li>
                            )}
                        </ol>
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
                    <Button icon={question ? <SaveIcon /> : <PlusIcon />} disabled={!ready} onClick={() => void save()}>{question ? t("common.save") : t("kader.questions.create")}</Button>
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
                <Editor key={editing === NEW ? `new-${questions.length}` : `${editing}-${JSON.stringify(selected)}`} question={editing === NEW ? null : selected}
                    onSaved={(id) => pick(id)} onDeleted={() => setParams({}, { replace: true })} />
            </div>
            {copying && <CopyModal onClose={() => setCopying(false)} onCopied={() => { setCopying(false); setParams({}, { replace: true }); }} />}
        </div>
    );
}
