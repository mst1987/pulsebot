import type { SetupEditorData, StoredSetup } from "../../../api";
import { useT } from "../../../i18n";
import Badge from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { CheckIcon } from "../../../components/ui/icons";
import { buffState, roleFigures, summaryOptions } from "./summaryFigures";

function Stat({ label, value, target, ok, tip }: { label: string; value: number; target: string; ok: boolean; tip: string }) {
    const t = useT();
    return (
        <div className={`se-stat${ok ? "" : " se-off"}`} data-tip={target ? t("setup.summary.statTipTarget", { label, value, target }) : t("setup.summary.statTip", { label, value })} data-tip-sub={tip}>
            <span className="se-stat-v">{value}{target && <small>/{target}</small>}</span>
            <span className="kicker">{label}</span>
        </div>
    );
}

/**
 * The one line under the bench: "Buffs vollständig ✓ · Fairness an · 2 von 3
 * Wünschen erfüllt" — and "Details", which opens the tiles and switches (`Summary`).
 */
export function SummaryLine({ data, setup, onDetails }: { data: SetupEditorData; setup: StoredSetup; onDetails: () => void }) {
    const t = useT();
    const buffs = buffState(setup);
    const opts = summaryOptions(data, setup);
    const { wishes } = setup.checks;
    const together = setup.checks.avoid?.together || 0;
    const buffText = buffs.missingRequired.length
        ? t("setup.summary.requiredMissing", { count: buffs.missingRequired.length })
        : buffs.missingRaid.length ? t("setup.summary.raidMissing", { count: buffs.missingRaid.length }) : t("setup.line.buffsComplete");
    const buffTone = buffs.missingRequired.length ? "bad" : buffs.missingRaid.length ? "mid" : "ok";
    return (
        <div className="se-sumline" aria-label={t("setup.line.aria")}>
            <span className={`se-sumline-buffs se-tone-${buffTone}`} data-tip={t("setup.summary.buffs")} data-tip-sub={buffs.tip}>
                <b>{buffText}</b>
                {buffTone === "ok" && <span className="se-sumline-ok" aria-hidden="true"><CheckIcon /></span>}
            </span>
            <span className="se-sumline-dot" aria-hidden="true">·</span>
            <span data-tip={t("setup.summary.fairness")} data-tip-sub={t("setup.summary.fairnessSub")}>
                {t("setup.summary.fairness")} <b>{opts.fairness ? t("setup.line.on") : t("setup.line.off")}</b>
            </span>
            <span className="se-sumline-dot" aria-hidden="true">·</span>
            <span data-tip={t("setup.summary.wishes")} data-tip-sub={t("setup.summary.wishesSub")}>
                {opts.wishes ? t("setup.line.wishesMet", { met: wishes.met, total: wishes.total }) : t("setup.line.wishesOff")}
            </span>
            {opts.avoidTotal > 0 && (
                <>
                    <span className="se-sumline-dot" aria-hidden="true">·</span>
                    <span data-tip={t("setup.summary.avoid")} data-tip-sub={t("setup.summary.avoidSub", { count: opts.avoidTotal })}>
                        {t("setup.summary.avoid")} <b>{opts.avoid ? t("setup.line.on") : t("setup.line.off")}</b>
                        {opts.avoid && together > 0 && <> ({t("setup.summary.avoidTogether", { count: together })})</>}
                    </span>
                </>
            )}
            {setup.warnings.length > 0 && (
                <>
                    <span className="se-sumline-dot" aria-hidden="true">·</span>
                    <Badge tone="mid" tip={t("setup.summary.hintsTip")} tipSub={setup.warnings.join("\n")}>{t("setup.summary.hints", { count: setup.warnings.length })}</Badge>
                </>
            )}
            <Button variant="ghost" size="sm" className="se-sumline-btn" onClick={onDetails}>{t("setup.line.details")}</Button>
        </div>
    );
}

/** "Details" of the summary line: the role tiles, buffs, and the switches for fairness, wishes and "nicht zusammen". */
export function Summary({ data, setup, busy, onFairness, onWishes, onAvoid }: {
    data: SetupEditorData;
    setup: StoredSetup;
    busy: boolean;
    onFairness: (on: boolean) => void;
    onWishes: (on: boolean) => void;
    onAvoid: (on: boolean) => void;
}) {
    const t = useT();
    const { checks } = setup;
    const [tank, healer, dps] = roleFigures(setup);
    const { missingRequired, missingRaid, tip: buffTip } = buffState(setup);
    const { fairness, wishes: wishesOn, avoid: avoidOn, avoidTotal } = summaryOptions(data, setup);
    return (
        <aside className="se-side" aria-label={t("setup.summary.aria")}>
            <div className="se-stats">
                {[tank, healer, dps].map((f) => <Stat key={f.key} label={f.label} value={f.value} target={f.target} ok={f.ok} tip={f.tip} />)}
            </div>
            <div className="se-side-row">
                <span className="kicker">{t("setup.summary.buffs")}</span>
                {missingRequired.length
                    ? <Badge tone="bad" tip={t("setup.summary.requiredMissingTip")} tipSub={buffTip}>{t("setup.summary.requiredMissing", { count: missingRequired.length })}</Badge>
                    : (
                        <Badge tone={missingRaid.length ? "mid" : "ok"} tip={t("setup.summary.buffs")} tipSub={buffTip}>
                            {missingRaid.length ? t("setup.summary.raidMissing", { count: missingRaid.length }) : t("setup.summary.complete")}
                        </Badge>
                    )}
            </div>
            <div className="se-side-row">
                <span className="kicker" data-tip={t("setup.summary.fairness")} data-tip-sub={t("setup.summary.fairnessSub")}>{t("setup.summary.fairness")}</span>
                <label className="switch">
                    <input type="checkbox" checked={fairness} disabled={busy} onChange={() => onFairness(!fairness)} aria-label={t("setup.summary.fairnessAria")} />
                    <span className="switch-track"><span className="switch-thumb" /></span>
                </label>
                <span className="se-side-cap">{t("setup.summary.fairnessCap")}</span>
            </div>
            {/* wishes are a switch of their own: the raiders' "gerne zusammen mit" from their profiles, considered only while it is on */}
            <div className="se-side-row">
                <span className="kicker" data-tip={t("setup.summary.wishes")} data-tip-sub={t("setup.summary.wishesSub")}>{t("setup.summary.wishes")}</span>
                <label className="switch">
                    <input type="checkbox" checked={wishesOn} disabled={busy} onChange={() => onWishes(!wishesOn)} aria-label={t("setup.summary.wishesAria")} />
                    <span className="switch-track"><span className="switch-thumb" /></span>
                </label>
                <span className="se-side-cap">
                    {wishesOn ? t("setup.summary.wishesCapOn", { met: checks.wishes.met, total: checks.wishes.total }) : t("setup.summary.wishesCapOff")}
                </span>
            </div>
            {avoidTotal > 0 && (
                <div className="se-side-row">
                    <span className="kicker" data-tip={t("setup.summary.avoid")} data-tip-sub={t("setup.summary.avoidSub", { count: avoidTotal })}>{t("setup.summary.avoid")}</span>
                    {avoidOn && !!setup.checks.avoid?.together && (
                        <Badge tone="mid" tip={t("setup.summary.avoidTogetherTip")} tipSub={t("setup.summary.avoidTogetherSub")}>
                            {t("setup.summary.avoidTogether", { count: setup.checks.avoid.together })}
                        </Badge>
                    )}
                    <label className="switch">
                        <input type="checkbox" checked={avoidOn} disabled={busy} onChange={() => onAvoid(!avoidOn)} aria-label={t("setup.summary.avoidAria")} />
                        <span className="switch-track"><span className="switch-thumb" /></span>
                    </label>
                </div>
            )}
            {!!setup.warnings.length && (
                <Badge tone="mid" tip={t("setup.summary.hintsTip")} tipSub={setup.warnings.join("\n")}>{t("setup.summary.hints", { count: setup.warnings.length })}</Badge>
            )}
        </aside>
    );
}
