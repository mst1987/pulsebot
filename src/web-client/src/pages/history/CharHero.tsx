import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import type { HistoryCharData, RosterCharData } from "../../api";
import { fmtMs } from "../../lib/format";
import { classColorProps } from "../../components/ClassSpec";
import { IconLink, RoleBadge } from "../../components/roster/RosterCommon";
import { attendanceTone, combineAttendance, nightLabel } from "../../lib/rosterView";
import { Badge, Button, WowIcon, buttonClass } from "../../components/ui";
import { useT } from "../../i18n";

function averageItemLevel(data: HistoryCharData): number {
    if (data.charSummary?.itemLevel) return data.charSummary.itemLevel;
    const levels = (data.gear || []).map((g) => g.level || 0).filter((n) => n > 0);
    if (!levels.length) return 0;
    return Math.round(levels.reduce((a, b) => a + b, 0) / levels.length);
}

function HeroStat({ label, tip, tipSub, tone, children }: { label: string; tip: string; tipSub?: string; tone?: "total" | "ok" | "mid" | "warn"; children: ReactNode }) {
    return (
        <div className={`ros-hstat${tone ? ` is-${tone}` : ""}`}>
            <span className="ros-hstat-label" data-tip={tip} data-tip-sub={tipSub}>{label}</span>
            <span className="ros-hstat-value">{children}</span>
        </div>
    );
}

export function CharHero({ data, roster, loading, onReload }: { data: HistoryCharData; roster: RosterCharData | null; loading: boolean; onReload: () => void }) {
    const info = data.info;
    const summary = data.charSummary;
    const gear = data.gearIssues;
    const avgIlvl = averageItemLevel(data);
    const realm = data.realm || summary?.realm || "";
    const colored = classColorProps(info?.classColor);
    const att = roster ? combineAttendance(Object.values(roster.attendance)) : null;
    const high = gear ? gear.issues.filter((i) => i.severity === "high").length : 0;
    const when = gear?.generatedAt ? fmtMs(gear.generatedAt, false) : "";
    const t = useT();
    const reportName = gear ? (gear.reportTitle || gear.zone || "") : "";
    const evalSub = !gear
        ? t("history.hero.evalNone")
        : reportName && when
            ? t("history.hero.evalSubDated", { report: reportName, date: when })
            : t("history.hero.evalSub", { report: reportName || when });

    return (
        <header className="dash-card ros-hero" style={{ "--class-color": info?.classColor || undefined } as CSSProperties}>
            <div className="ros-hero-main">
                <div className="ros-portrait">
                    {info?.className
                        ? <WowIcon name={`classicon_${info.className.toLowerCase()}`} size={46} />
                        : <span className="ros-portrait-ph">{(data.character || "?").slice(0, 1).toUpperCase()}</span>}
                    {!!summary?.level && <span className="ros-lvl" data-tip={t("history.hero.level")} data-tip-sub={t("history.hero.perProfile")}>{summary.level}</span>}
                </div>
                <div className="ros-hero-ident">
                    <div className="kicker">{t("history.hero.kicker")}</div>
                    <h1 className="ros-hero-title">{data.character}</h1>
                    <div className="ros-hero-sub">
                        {info?.className
                            ? (
                                <span className={`ros-hero-class ${colored.className || ""}`} style={colored.style}>
                                    {!!info.iconUrl && <img src={info.iconUrl} alt="" />}
                                    {info.spec ? `${info.spec} ${info.className}` : info.className}
                                </span>
                            )
                            : <span>{t("history.hero.classUnknown")}</span>}
                        {!!realm && <><span aria-hidden="true">·</span><span>{realm}</span></>}
                        {!!roster?.role && <RoleBadge role={roster.role} />}
                        {roster?.categories.map((c) => (
                            <Badge key={c.id} icon={c.icon || "achievement_guildperk_everybodysfriend"} tip={c.name} tipSub={c.contents.join(" · ") || undefined}>
                                {c.name}
                            </Badge>
                        ))}
                    </div>
                </div>
                <div className="ros-hero-actions">
                    <IconLink href={data.wclUrl} icon="inv_misc_pocketwatch_01" tip="Warcraft Logs" size="md" />
                    <IconLink href={data.armoryUrl} icon="inv_shirt_guildtabard_01" tip="Armory" size="md" />
                    {data.gearConfigured
                        ? <Button variant="run" icon="trade_engineering" running={loading} onClick={onReload}>{t("history.hero.reloadGear")}</Button>
                        : <Link className={buttonClass("ghost", "md", true)} to="/settings?section=battlenet"><WowIcon name="trade_engineering" size={22} />{t("history.hero.setupBnet")}</Link>}
                </div>
            </div>
            <div className="ros-hero-foot">
                <HeroStat
                    label={t("history.hero.avgLabel")}
                    tone="total"
                    tip={t("history.hero.avgTip")}
                    tipSub={data.charSummary?.itemLevel ? t("history.hero.perProfile") : t("history.hero.avgSubMean")}
                >
                    {avgIlvl || "–"}
                </HeroStat>
                {att && (
                    <HeroStat
                        label={t("history.char.attendance")}
                        tone={att.pct === null ? undefined : ({ ok: "ok", mid: "mid", bad: "warn" } as const)[attendanceTone(att.pct) || "ok"]}
                        tip={att.total ? t("history.hero.attTip", { attended: att.attended, total: att.total }) : t("history.hero.attNone")}
                        tipSub={t("history.hero.attSub")}
                    >
                        {att.pct === null ? "–" : <>{att.pct}<small>% · {att.attended}/{att.total}</small></>}
                    </HeroStat>
                )}
                <HeroStat
                    label={t("history.hero.issues")}
                    tone={gear ? (gear.issueCount ? "warn" : "ok") : undefined}
                    tip={gear ? t("history.hero.findings", { count: gear.issueCount }) : t("history.shared.notEvaluated")}
                    tipSub={evalSub}
                >
                    {gear ? <>{gear.issueCount}{!!high && <small>{t("history.shared.high", { count: high })}</small>}</> : "–"}
                </HeroStat>
                <HeroStat label={t("history.hero.loot")} tip={t("history.hero.lootTip")} tipSub={t("history.hero.lootSub")}>
                    {data.items.length}<small>{t("history.hero.itemsUnit")}</small>
                </HeroStat>
                {!!summary?.lastLogin && <span className="ros-hero-seen">{t("history.hero.lastOnline", { date: nightLabel(summary.lastLogin) })}</span>}
            </div>
        </header>
    );
}
