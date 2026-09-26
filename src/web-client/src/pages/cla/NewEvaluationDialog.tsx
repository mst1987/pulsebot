import { createReport } from "../../api";
import { withIncompleteConfirm } from "../../lib/confirmIncomplete";
import { useDraftState } from "../../lib/persistedState";
import { useJobs } from "../../components/Jobs";
import { useConfirm, Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import Tip from "../../components/ui/Tip";
import WowIcon from "../../components/ui/WowIcon";
import { useT } from "../../i18n";
import { SECTION_CHOICES, type SectionChoice } from "./shared";

// ---- Modal "Neue Auswertung" ----

/**
 * Paste a Warcraft-Logs link, pick CLA + RPB (or one half), go. The build runs
 * as a background job — the dialog closes at once and the toast at the bottom
 * reports progress and the finished report. The link stays a draft until then.
 */
export function NewEvaluationDialog({ open, onClose, onChanged }: {
    open: boolean;
    onClose: () => void;
    onChanged: () => void;
}) {
    const t = useT();
    const ask = useConfirm();
    const jobs = useJobs();
    const [draft, patchDraft, clearDraft] = useDraftState("cla-report-link", { link: "", sections: "both" as SectionChoice });
    const link = draft.link;
    const choice = SECTION_CHOICES.find((c) => c.key === draft.sections) || SECTION_CHOICES[0];

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        const target = link.trim();
        if (!target) return;
        clearDraft();
        onClose();
        jobs.run({
            label: t("cla.jobs.evalLabel", { label: choice.key === "both" ? "CLA + RPB" : choice.key.toUpperCase() }),
            detail: target,
            expectedSeconds: choice.seconds,
            describe: (r) => ({
                message: t("cla.jobs.reportCreated"),
                link: { href: r.url, label: t("cla.jobs.viewReport"), external: true },
            }),
        }, () => withIncompleteConfirm(ask, (force) => createReport(target, { force, sections: choice.sections }))).then(onChanged);
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            icon="inv_misc_spyglass_02"
            tone="cla"
            kicker={t("cla.newEval.kicker")}
            title={t("cla.page.newEvaluation")}
            width={700}
            initialFocus="#la-link"
            hint={t("cla.newEval.hint")}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="submit" form="la-new-eval" icon="inv_misc_pocketwatch_01" disabled={!link.trim()}>{t("cla.newEval.submit")}</Button>
                </>
            )}
        >
            <form id="la-new-eval" className="la-form" onSubmit={submit}>
                <div>
                    <label className="la-lbl" htmlFor="la-link">
                        {t("cla.newEval.linkLabel")}
                        <Tip
                            className="la-qm"
                            head={t("cla.newEval.linkTip")}
                            sub={t("cla.newEval.linkTipSub")}
                        >?</Tip>
                    </label>
                    <input
                        id="la-link" className="la-input" type="text" value={link}
                        onChange={(e) => patchDraft({ link: e.target.value })}
                        placeholder="https://classic.warcraftlogs.com/reports/abc123…" required
                    />
                </div>
                <div>
                    <div className="la-lbl" id="la-opts-lbl">{t("cla.newEval.which")}</div>
                    <div className="la-opts" role="radiogroup" aria-labelledby="la-opts-lbl">
                        {SECTION_CHOICES.map((c) => {
                            const on = choice.key === c.key;
                            return (
                                <button
                                    key={c.key} type="button" role="radio" aria-checked={on}
                                    className={`la-opt${on ? " on" : ""}`}
                                    onClick={() => patchDraft({ sections: c.key })}
                                >
                                    <span className="la-opt-top">
                                        <WowIcon name={c.icon} size={36} />
                                        <b>{c.label}</b>
                                        <span className={`la-radio${on ? " on" : ""}`} aria-hidden="true" />
                                    </span>
                                    <span className="la-opt-sub">{c.sub}</span>
                                    <span><Badge>≈ {c.seconds} s</Badge></span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </form>
        </Modal>
    );
}
