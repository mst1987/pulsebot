import type { SetupAttendance, SetupPerson } from "../../../api";
import { tipReasons } from "../../../lib/setupEditor";
import { wowIconUrl } from "../../../lib/wowIcon";
import { roleLabel, specLabel } from "../../../lib/wowNames";
import { useT } from "../../../i18n";
import WowIcon from "../../../components/ui/WowIcon";
import { BenchIcon, CheckIcon, SignedIcon } from "../../../components/icons";
import { classColorProps } from "../../../components/ClassSpec";
import SpecTile from "../SpecTile";
import { attendanceTone, benchText, specText, statusLabel } from "./setupText";

/** The header's attendance — the important number: big percentage, how sure the character link is (check = confirmed, "Auto" = guessed) and a bar. */
function AttendanceHead({ a }: { a: SetupAttendance | undefined }) {
    const t = useT();
    if (!a || a.pct === null) {
        return (
            <div className="se-tip-attn">
                <span className="se-tip-k">{t("setup.person.tip.attendance")}</span>
                <span className="se-tip-sub">{t("setup.person.tip.attendanceNone")}</span>
            </div>
        );
    }
    return (
        <div className="se-tip-attn">
            <span className="se-tip-k">{t("setup.person.tip.attendance")}</span>
            <span className="se-tip-att">
                <b className="se-num">{a.pct} %</b>
                {a.link === "manual"
                    ? <span className="se-tip-link se-tip-linked"><CheckIcon /></span>
                    : <span className="se-tip-link se-tip-auto">{t("setup.person.tip.autoBadge")}</span>}
            </span>
            <span className={`se-tip-bar se-tip-${attendanceTone(a.pct)}`}><i style={{ width: `${a.pct}%` }} /></span>
        </div>
    );
}

/** The attendance details: how many raids, how sure the character link is, when the raider last stood on the bench. */
function AttendanceDetails({ a }: { a: SetupAttendance | undefined }) {
    const t = useT();
    if (!a) return null;
    const bench = benchText(a);
    if (a.pct === null && !bench) return null;
    return (
        <div className="se-tip-body">
            <span className="se-tip-k">{t("setup.person.tip.attendanceDetails")}</span>
            {a.pct !== null && (
                <span className="se-tip-row" data-tip={t("setup.person.tip.attendanceCount", { attended: a.attended, total: a.total })}>
                    <SignedIcon />{a.attended}/{a.total}
                    {a.link === "manual"
                        ? <span className="se-tip-link se-tip-linked" data-tip={t("setup.person.tip.linkManual")}><CheckIcon /></span>
                        : <span className="se-tip-link se-tip-auto" data-tip={t("setup.person.tip.linkAuto")}>{t("setup.person.tip.autoBadge")}</span>}
                </span>
            )}
            {bench && (
                <span className="se-tip-row" data-tip={a.lastBench ? t("setup.person.tip.lastBench", { date: bench }) : t("setup.person.tip.benchNever", { count: a.benchNights })}>
                    <BenchIcon />{bench}
                </span>
            )}
        </div>
    );
}

/**
 * The raider panel, right of the ping message and the numbers (never over a
 * group, always complete). A header across the whole panel — the spec tile, the
 * name (never wrapped, it has the width), spec · role, Discord name and status,
 * and on the right the attendance as the number that matters — and under it
 * three columns: what the raider brings, why they stand here, the attendance in
 * detail. It shows the raider the pointer touched last.
 */
export function SlotTip({ p, attendance, extra, onSpec, onExtra }: { p: SetupPerson; attendance: SetupAttendance | undefined | null; extra: string[]; onSpec?: (specKey: string) => void; onExtra?: (role: "tank" | "healer", on: boolean) => void }) {
    const t = useT();
    // the roles this raider could take on besides the one in the setup: a tank or a healer spec of the class
    const extraOffers = ((["tank", "healer"] as const).filter((r) => r !== p.role && (p.classSpecs || []).some((sp) => sp.role === r)));
    const color = classColorProps(p.classColor);
    const status = statusLabel(p.status);
    const brings = p.brings || [];
    const reasons = [...new Set(tipReasons(p.reasons))].filter((r) => r !== status);
    return (
        <aside className="se-tip" aria-label={t("setup.person.tip.aria")} aria-live="polite">
            <header className="se-tip-top">
                <SpecTile iconUrl={p.specIcon ? wowIconUrl(p.specIcon, 36) : undefined} classColor={p.classColor} />
                <div className="se-tip-who">
                    <span className={`se-tip-name ${color.className || ""}`} style={color.style}>{p.character}</span>
                    <span className="se-tip-sub">
                        <span>{[specText(p), p.role ? roleLabel(p.role) : "", p.main === false ? t("setup.person.offSpec") : ""].filter(Boolean).join(" · ")}</span>
                        {p.name && <span>@{p.name}</span>}
                        {status && <span className={`se-tip-status se-st-${p.status}`}>{status}</span>}
                    </span>
                </div>
                {attendance !== null && <AttendanceHead a={attendance} />}
            </header>
            <div className="se-tip-col">
                {brings.length > 0 && (
                    <div className="se-tip-body">
                        <span className="se-tip-k">{t("setup.person.tip.brings")}</span>
                        <div className="se-tip-buffs">
                        {brings.map((b) => (
                            <span
                                key={`${b.scope}-${b.key}`} className="se-tip-buff"
                                data-tip={b.label}
                                data-tip-sub={b.scope === "party" ? t("setup.person.tip.bringsGroup", { count: b.count }) : t("setup.person.tip.bringsRaid")}
                            >
                                <WowIcon name={b.icon} size={22} />
                                <span>
                                    {b.label}
                                    {b.scope === "party" && <small>{t("setup.person.tip.bringsGroupShort", { count: b.count })}</small>}
                                </span>
                            </span>
                        ))}
                        </div>
                    </div>
                )}
            </div>
            <div className="se-tip-col">
                {reasons.length > 0 && (
                    <div className="se-tip-body">
                        <span className="se-tip-k">{t("setup.person.tip.why")}</span>
                        <ul className="se-tip-reasons">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                    </div>
                )}
            </div>
            <div className="se-tip-col">
                {onSpec && (p.classSpecs || []).length > 1 && (
                    <div className="se-tip-body">
                        <span className="se-tip-k" data-tip={t("setup.person.tip.playsAs")} data-tip-sub={t("setup.person.tip.playsAsSub")}>{t("setup.person.tip.playsAs")}</span>
                        <div className="se-tip-specs">
                            {(p.classSpecs || []).map((sp) => (
                                <button
                                    key={sp.key} type="button" className={`se-tip-spec${sp.key === p.spec ? " is-on" : ""}`} aria-pressed={sp.key === p.spec}
                                    aria-label={`${specLabel(sp.key, sp.label)} · ${roleLabel(sp.role)}`}
                                    data-tip={specLabel(sp.key, sp.label)} data-tip-sub={roleLabel(sp.role)} onClick={() => onSpec(sp.key)}
                                >
                                    <WowIcon name={sp.icon || "inv_misc_questionmark"} size={22} />
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                {onExtra && extraOffers.length > 0 && (
                    <div className="se-tip-body">
                        <span className="se-tip-k" data-tip={t("setup.person.tip.extra")} data-tip-sub={t("setup.person.tip.extraSub")}>{t("setup.person.tip.extra")}</span>
                        <div className="se-tip-specs">
                            {extraOffers.map((r) => {
                                const on = extra.includes(r);
                                const spec = (p.classSpecs || []).find((sp) => sp.role === r);
                                return (
                                    <button
                                        key={r} type="button" className={`se-tip-extra${on ? " is-on" : ""}`} aria-pressed={on}
                                        data-tip={t("setup.extra.tip", { role: roleLabel(r) })} onClick={() => onExtra(r, !on)}
                                    >
                                        <WowIcon name={(spec && spec.icon) || "inv_misc_questionmark"} size={20} />
                                        <span>{roleLabel(r)}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
                {attendance !== null && <AttendanceDetails a={attendance} />}
            </div>
        </aside>
    );
}

/** What the docked panel shows before any raider was touched. */
export function TipEmpty() {
    const t = useT();
    return <aside className="se-tip se-tip-empty" aria-label={t("setup.person.tip.aria")}>{t("setup.person.tip.empty")}</aside>;
}
