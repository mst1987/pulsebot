import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import type { HistoryCharData, RosterCharData } from "../../api";
import { fmtMs } from "../../lib/format";
import { classColorProps } from "../../components/ClassSpec";
import { IconLink, RoleBadge } from "../../components/RosterCommon";
import { attendanceTone, combineAttendance, nightLabel } from "../../lib/rosterView";
import { Badge, Button, WowIcon, buttonClass } from "../../components/ui";

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

    return (
        <header className="dash-card ros-hero" style={{ "--class-color": info?.classColor || undefined } as CSSProperties}>
            <div className="ros-hero-main">
                <div className="ros-portrait">
                    {info?.className
                        ? <WowIcon name={`classicon_${info.className.toLowerCase()}`} size={46} />
                        : <span className="ros-portrait-ph">{(data.character || "?").slice(0, 1).toUpperCase()}</span>}
                    {!!summary?.level && <span className="ros-lvl" data-tip="Level" data-tip-sub="Laut Battle.net-Profil.">{summary.level}</span>}
                </div>
                <div className="ros-hero-ident">
                    <div className="kicker">Charakter</div>
                    <h1 className="ros-hero-title">{data.character}</h1>
                    <div className="ros-hero-sub">
                        {info?.className
                            ? (
                                <span className={`ros-hero-class ${colored.className || ""}`} style={colored.style}>
                                    {!!info.iconUrl && <img src={info.iconUrl} alt="" />}
                                    {info.spec ? `${info.spec} ${info.className}` : info.className}
                                </span>
                            )
                            : <span>Klasse noch nicht aufgelöst</span>}
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
                        ? <Button variant="run" icon="trade_engineering" running={loading} onClick={onReload}>Gear neu laden</Button>
                        : <Link className={buttonClass("ghost", "md", true)} to="/settings?section=battlenet"><WowIcon name="trade_engineering" size={22} />Battle.net einrichten</Link>}
                </div>
            </div>
            <div className="ros-hero-foot">
                <HeroStat
                    label="Ø iLvl"
                    tone="total"
                    tip="Ø Item-Level"
                    tipSub={data.charSummary?.itemLevel ? "Laut Battle.net-Profil." : "Mittel über das Gear, das die Battle.net-API zurückgegeben hat."}
                >
                    {avgIlvl || "–"}
                </HeroStat>
                {att && (
                    <HeroStat
                        label="Anwesenheit"
                        tone={att.pct === null ? undefined : ({ ok: "ok", mid: "mid", bad: "warn" } as const)[attendanceTone(att.pct) || "ok"]}
                        tip={att.total ? `${att.attended} von ${att.total} Raids` : "Keine Raids gezählt"}
                        tipSub="Über alle Raid-Kategorien des Charakters, je Kategorie die letzten 11 Raids."
                    >
                        {att.pct === null ? "–" : <>{att.pct}<small>% · {att.attended}/{att.total}</small></>}
                    </HeroStat>
                )}
                <HeroStat
                    label="Gear-Probleme"
                    tone={gear ? (gear.issueCount ? "warn" : "ok") : undefined}
                    tip={gear ? `${gear.issueCount} Befund${gear.issueCount === 1 ? "" : "e"}` : "nicht ausgewertet"}
                    tipSub={gear ? `Auswertung ${[gear.reportTitle || gear.zone, when].filter(Boolean).join(" vom ")}.` : "In keiner der gespeicherten Auswertungen enthalten."}
                >
                    {gear ? <>{gear.issueCount}{!!high && <small>{high} schwer</small>}</> : "–"}
                </HeroStat>
                <HeroStat label="Loot" tip="Importierte Items" tipSub="Aus den Gargul-/RCLootcouncil-Importen.">
                    {data.items.length}<small>Items</small>
                </HeroStat>
                {!!summary?.lastLogin && <span className="ros-hero-seen">zuletzt online {nightLabel(summary.lastLogin)}</span>}
            </div>
        </header>
    );
}
