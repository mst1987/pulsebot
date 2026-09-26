import type { SetupEditorData, StoredSetup } from "../../../api";
import { dpsCheck, roleTarget } from "../../../lib/setupEditor";
import { rolePluralLabel } from "../../../lib/wowNames";
import { useT } from "../../../i18n";
import Badge from "../../../components/ui/Badge";

function Stat({ label, value, target, ok, tip }: { label: string; value: number; target: string; ok: boolean; tip: string }) {
    const t = useT();
    return (
        <div className={`se-stat${ok ? "" : " se-off"}`} data-tip={target ? t("setup.summary.statTipTarget", { label, value, target }) : t("setup.summary.statTip", { label, value })} data-tip-sub={tip}>
            <span className="se-stat-v">{value}{target && <small>/{target}</small>}</span>
            <span className="kicker">{label}</span>
        </div>
    );
}

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
    const roles = checks.roles || {};
    const tank = roles.tank || { count: 0, min: 0, max: 0, ok: true };
    const healer = roles.healer || { count: 0, min: 0, max: 0, ok: true };
    const dps = dpsCheck(roles);
    // the places the plan leaves for damage dealers: size minus the planned tanks and healers
    const dpsTarget = checks.size.size ? Math.max(0, checks.size.size - (tank.max ?? tank.min) - (healer.max ?? healer.min)) : 0;
    const missingRequired = checks.buffs.required.filter((b) => !b.present);
    const missingRaid = checks.buffs.raid.filter((b) => !b.present);
    const fairness = typeof setup.options?.fairness === "boolean" ? setup.options.fairness : data.event.fairness;
    const wishesOn = typeof setup.options?.wishes === "boolean" ? setup.options.wishes : data.event.wishes;
    // "nicht zusammen": only when there are such pairs among the signups; counts, never names
    const avoidOn = setup.options?.avoid === true;
    const avoidTotal = Math.max(data.avoidPairs || 0, setup.checks.avoid?.total || 0);
    const buffTip = [
        checks.buffs.required.length
            ? t("setup.summary.required", { list: checks.buffs.required.map((b) => `${b.present ? "✓" : "–"} ${b.label}`).join(", ") })
            : t("setup.summary.noRequired"),
        missingRaid.length ? t("setup.summary.missingRaid", { list: missingRaid.map((b) => b.label).join(", ") }) : t("setup.summary.allRaid"),
    ].join("\n");
    return (
        <aside className="se-side" aria-label={t("setup.summary.aria")}>
            <div className="se-stats">
                <Stat label={rolePluralLabel("tank")} value={tank.count} target={roleTarget(tank)} ok={tank.ok} tip={t("setup.summary.planTip")} />
                <Stat label={rolePluralLabel("healer")} value={healer.count} target={roleTarget(healer)} ok={healer.ok} tip={t("setup.summary.planTip")} />
                <Stat
                    label={t("setup.summary.dps")} value={dps.count} target={dpsTarget ? String(dpsTarget) : ""} ok={dps.ok && dps.count >= dpsTarget}
                    tip={t("setup.summary.dpsTip", { melee: roles.melee?.count || 0, ranged: roles.ranged?.count || 0 })}
                />
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
