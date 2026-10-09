import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { explainRaidSetup, getRaidSetupExplain, type SetupEditorData, type StoredSetup } from "../../../api";
import { useT } from "../../../i18n";
import { Button } from "../../../components/ui/Button";
import Badge from "../../../components/ui/Badge";
import { Modal } from "../../../components/ui/Modal";
import { useJobs } from "../../../components/shell/Jobs";
import type { RaidCtx } from "../meta";
import { dateTime, weightLabels } from "./setupText";

export function WeightsModal({ open, onClose, data, setup, onApply }: {
    open: boolean;
    onClose: () => void;
    data: SetupEditorData;
    setup: StoredSetup;
    onApply: (weights: Record<string, number>) => void;
}) {
    const t = useT();
    const defaults = data.defaults?.weights || {};
    const max = data.defaults?.maxWeight || 500;
    const [values, setValues] = useState<Record<string, number>>({});
    useEffect(() => {
        if (open) setValues({ ...defaults, ...(setup.options?.weights || {}) });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);
    const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => defaults[k] !== v));
    return (
        <Modal
            open={open} onClose={onClose} icon="inv_misc_gear_01" tone="raids" kicker={t("setup.weightsModal.kicker")} title={t("setup.weightsModal.title")} width={520}
            hint={t("setup.weightsModal.hint")}
            footer={(
                <>
                    <Button variant="ghost" onClick={() => setValues({ ...defaults })}>{t("setup.weightsModal.defaults")}</Button>
                    <Button icon="spell_holy_borrowedtime" onClick={() => onApply(changed)}>{t("setup.weightsModal.repropose")}</Button>
                </>
            )}
        >
            <div className="se-weights">
                {weightLabels().map((w) => (
                    <label key={w.key} className="se-weight">
                        <span className="se-weight-label" data-tip={w.label} data-tip-sub={w.tip}>{w.label}</span>
                        <input
                            type="range" min={0} max={max} step={10} value={values[w.key] ?? 0}
                            onChange={(e) => setValues((v) => ({ ...v, [w.key]: Number(e.target.value) }))}
                            aria-label={w.label}
                        />
                        <span className={`se-weight-v${defaults[w.key] !== values[w.key] ? " se-changed" : ""}`}>{values[w.key] ?? 0}</span>
                    </label>
                ))}
            </div>
        </Modal>
    );
}

/**
 * "Freie Plätze füllen" once somebody stands in a group: only the free places
 * (the default — what the orga placed stays exactly there), or everything anew
 * (fixed places kept). With nobody placed yet the editor fills at once, no question.
 */
export function FillModal({ open, onClose, placed, free, onFill }: {
    open: boolean;
    onClose: () => void;
    placed: number;
    free: number;
    onFill: (keepPlaced: boolean) => void;
}) {
    const t = useT();
    const [keep, setKeep] = useState(true);
    useEffect(() => {
        if (open) setKeep(true);
    }, [open]);
    return (
        <Modal
            open={open} onClose={onClose} icon="spell_holy_borrowedtime" tone="raids" kicker={t("setup.fill.kicker")} title={t("setup.fill.free")} width={500}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button icon="spell_holy_borrowedtime" onClick={() => onFill(keep)}>{t("setup.fill.go")}</Button>
                </>
            )}
        >
            <p className="se-note">{t("setup.fill.question", { count: placed })}</p>
            <div className="se-fill" role="radiogroup" aria-label={t("setup.fill.free")}>
                <button type="button" role="radio" aria-checked={keep} className={`se-fill-opt${keep ? " is-on" : ""}`} onClick={() => setKeep(true)}>
                    <b>{t("setup.fill.keepTitle")}</b>
                    <span>{t("setup.fill.keepText", { count: free })}</span>
                </button>
                <button type="button" role="radio" aria-checked={!keep} className={`se-fill-opt${!keep ? " is-on" : ""}`} onClick={() => setKeep(false)}>
                    <b>{t("setup.fill.anewTitle")}</b>
                    <span>{t("setup.fill.anewText")}</span>
                </button>
            </div>
        </Modal>
    );
}

export function ExplainModal({ open, onClose, ctx, data, setup, onDone }: {
    open: boolean;
    onClose: () => void;
    ctx: RaidCtx;
    data: SetupEditorData;
    setup: StoredSetup;
    onDone: () => void;
}) {
    const t = useT();
    const jobs = useJobs();
    const [running, setRunning] = useState(false);
    const explanation = setup.explanation;
    const outdated = !!explanation && explanation.version !== setup.version;
    const start = async () => {
        setRunning(true);
        await jobs.run({ label: t("setup.explain.title"), detail: data.event.title, icon: "inv_scroll_03", expectedSeconds: 30 }, async () => {
            await explainRaidSetup(ctx.eventId);
            for (;;) {
                await new Promise((r) => setTimeout(r, 2000));
                const state = await getRaidSetupExplain(ctx.eventId);
                if (!state.job || state.job.status === "done") return state;
                if (state.job.status === "error") throw new Error(state.job.error || t("setup.explain.failed"));
            }
        });
        setRunning(false);
        onDone();
    };
    return (
        <Modal
            open={open} onClose={onClose} icon="inv_scroll_03" tone="raids" kicker={t("setup.explain.kicker")} title={t("setup.explain.title")} width={640}
            hint={t("setup.explain.hint")}
            footer={data.hasApiKey
                ? <Button variant="run" icon="spell_holy_borrowedtime" running={running} onClick={start}>{explanation ? t("setup.explain.recreate") : t("setup.explain.create")}</Button>
                : <Link className="btn btn-ghost" to="/settings?section=verbindungen">{t("setup.explain.addKey")}</Link>}
        >
            {!data.hasApiKey && <p className="se-note">{t("setup.explain.noKey")}</p>}
            {explanation
                ? (
                    <div className="se-explain">
                        <div className="se-explain-meta">
                            <Badge tone={outdated ? "mid" : "ok"}>{outdated ? t("setup.explain.outdated", { version: explanation.version }) : t("setup.explain.version", { version: explanation.version })}</Badge>
                            <span className="kicker">{dateTime(explanation.at)}</span>
                        </div>
                        <div className="se-explain-text">{explanation.text}</div>
                    </div>
                )
                : data.hasApiKey && <p className="se-note">{t("setup.explain.none")}</p>}
        </Modal>
    );
}

/**
 * The small dialogs behind "Mehr ▾" (the group count, the ping text) and behind
 * the summary line's "Details" (tiles and switches): what used to stand open in
 * the bar and the boxes above the groups. The controls inside keep their own
 * rules (commit on blur or Enter); "Fertig" only closes.
 */
export function EditorDialog({ open, onClose, icon, title, kicker, width = 520, children }: {
    open: boolean;
    onClose: () => void;
    icon: string;
    title: string;
    kicker?: string;
    width?: number;
    children: ReactNode;
}) {
    const t = useT();
    return (
        <Modal
            open={open} onClose={onClose} icon={icon} tone="raids" kicker={kicker || t("setup.dialog.kicker")} title={title} width={width}
            footer={<Button variant="ghost" onClick={onClose}>{t("setup.dialog.done")}</Button>}
        >
            {children}
        </Modal>
    );
}
