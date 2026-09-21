// The page head: date block, kicker + category, title, time and the relative
// day, two icon buttons (event post, raidplan), the one primary action — and
// under it the progress bar, where every step is figure, status and entry at once.
//
// An own event (#319) hands in its five-step cockpit as `cockpit` instead; it
// carries the one prominent deed itself, so the head's primary button stays out
// of the way — the same action twice in one head is exactly the doubling the
// cockpit exists to end. A Raid-Helper event keeps the bar of #219 unchanged.
import type { CSSProperties, ReactNode } from "react";
import type { RaidDetailData, RaidPrimaryAction, RaidStep } from "../../api";
import { eventTimeParts, relativeDayLabel } from "../../lib/format";
import { eventPostUrl, raidplanUrl } from "../../lib/discordLinks";
import { Button, buttonClass } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import IconTile from "../../components/ui/IconTile";
import WowIcon from "../../components/ui/WowIcon";
import { useT } from "../../i18n";

function StepCell({ step, onOpen }: { step: RaidStep; onOpen: (step: RaidStep) => void }) {
    const t = useT();
    return (
        <button
            type="button"
            className={`rd-step${step.next ? " next" : ""}`}
            data-tip={step.tip.head}
            data-tip-sub={step.tip.sub || undefined}
            aria-label={t("raidDetail.hero.stepAria", { label: step.label, value: step.value, unit: step.unit }).trim()}
            onClick={() => onOpen(step)}
        >
            <span className="rd-step-top">
                <IconTile icon={step.icon} tone={step.tone} />
                <span className="kicker">{step.label}</span>
            </span>
            <span className="rd-step-v">
                {step.value}
                {step.unit && <small>{step.unit}</small>}
            </span>
            {typeof step.fill === "number" && (
                <span className="rd-step-bar"><i style={{ width: `${Math.round(step.fill * 100)}%` }} /></span>
            )}
            <span className="rd-step-badge">
                {/* A neutral badge on the next step says nothing; "nächster
                    Schritt" does. A badge with its own finding ("RPB offen") stays. */}
                <Badge tone={step.next ? "mid" : step.badge.tone}>{step.next && !step.badge.tone ? t("raidDetail.hero.nextStep") : step.badge.label}</Badge>
            </span>
        </button>
    );
}

/**
 * The raid's loot system beside its category — a button that opens the
 * Lootsystem dialog where the user may change it, else plain text.
 */
function LootSystemChip({ data, onOpen }: { data: RaidDetailData; onOpen?: () => void }) {
    const t = useT();
    const ls = data.lootSystem;
    if (!ls) return null;
    const label = `${ls.label}${ls.softresExtra ? " + Softres" : ""}`;
    const origin = ls.source === "event" ? t("raidDetail.hero.lootOriginEvent") : t("raidDetail.hero.lootOriginCategory", { category: ls.categoryLabel });
    const sub = `${origin}${onOpen ? ` ${t("raidDetail.hero.lootClickHint")}` : ""}`;
    const tip = t("raidDetail.hero.lootTip", { label });
    return onOpen
        ? <button type="button" className="cat-badge rd-loot-chip" data-tip={tip} data-tip-sub={sub} onClick={onOpen}>{label}</button>
        : <span className="cat-badge rd-loot-chip" data-tip={tip} data-tip-sub={sub}>{label}</span>;
}

export default function RaidDetailHero({ data, onStep, onPrimary, primaryRunning, manage, cockpit, onLootSystem }: {
    data: RaidDetailData;
    onStep: (step: RaidStep) => void;
    onPrimary: (action: RaidPrimaryAction) => void;
    primaryRunning: boolean;
    /** with raids write: opens the Lootsystem dialog */
    onLootSystem?: () => void;
    /** only for an own event and write access: the "Verwalten" menu (#288) — editing (#261) is its first entry */
    manage?: ReactNode;
    /** an own event's step bar (#319); it replaces the progress bar and the primary button */
    cockpit?: ReactNode;
}) {
    const t = useT();
    const ev = data.event;
    const when = eventTimeParts(ev.startTime);
    const relDay = relativeDayLabel(ev.startTime);
    const channel = ev.channelName || ev.channelId;
    const cancelled = ev.status === "cancelled";
    // A cancelled raid has no next step to push, and the cockpit brings its own.
    const primary = cancelled || cockpit ? null : data.progress?.primary || null;

    return (
        <header className="page-hero rd-hero">
            <div className="rd-hero-main">
                <div className="hero-date" data-tip={when?.full || undefined}>
                    <span className="hero-date-dow">{when?.weekday || "—"}</span>
                    <span className="hero-date-day">{when?.day || "··"}</span>
                    <span className="hero-date-mon">{when ? `${when.month} ${when.year}` : ""}</span>
                </div>
                <div className="hero-ident">
                    <div className="hero-eyebrow">
                        <span className="kicker">{t("raidDetail.hero.kicker")}</span>
                        {data.categoryName && <span className="cat-badge">{data.categoryName}</span>}
                        <LootSystemChip data={data} onOpen={onLootSystem} />
                    </div>
                    <h1 className="hero-title">{ev.title || t("raidDetail.hero.noTitle")}</h1>
                    <div className="hero-when">
                        <span className="hero-time">{when?.time || "—"}</span>
                        <span className="hero-time-unit">{t("raidDetail.hero.timeUnit")}</span>
                        {relDay && <Badge tone={ev.isPast ? undefined : "accent"}>{relDay}</Badge>}
                        {cancelled && (
                            <Badge tone="bad" className="em-state" tip={t("raidDetail.hero.cancelledTip")} tipSub={[ev.cancelReason, ev.cancelArchived ? t("raidDetail.hero.channelArchived") : ""].filter(Boolean).join(" · ") || undefined}>
                                {t("raidDetail.hero.cancelled")}
                            </Badge>
                        )}
                        {!cancelled && ev.signupsClosed && (
                            <Badge tone="mid" className="em-state" tip={t("raidDetail.hero.signupsClosed")} tipSub={t("raidDetail.hero.signupsClosedSub")}>
                                {t("raidDetail.hero.signupsClosed")}
                            </Badge>
                        )}
                    </div>
                </div>
                <div className="rd-hero-actions">
                    {manage}
                    <a
                        className="ibtn" href={eventPostUrl(data.guildId, ev.channelId, ev.id)} target="_blank" rel="noopener noreferrer"
                        data-tip={t("raidDetail.hero.eventPost")} data-tip-sub={channel ? `#${channel}` : undefined} aria-label={t("raidDetail.hero.eventPostAria")}
                    >
                        <WowIcon name="inv_letter_15" size={24} />
                    </a>
                    {raidplanUrl(ev.id) && (
                        <a
                            className="ibtn" href={raidplanUrl(ev.id)} target="_blank" rel="noopener noreferrer"
                            data-tip={t("raidDetail.hero.raidplan")} data-tip-sub={t("raidDetail.hero.raidplanSub")} aria-label={t("raidDetail.hero.raidplanAria")}
                        >
                            <WowIcon name="inv_misc_map_01" size={24} />
                        </a>
                    )}
                    {primary && (primary.href
                        ? (
                            <a className={buttonClass("primary", "md", true)} href={primary.href} target="_blank" rel="noopener noreferrer">
                                <WowIcon name={primary.icon} size={22} />{primary.label}
                            </a>
                        )
                        : (
                            <Button
                                icon={primary.icon}
                                running={primaryRunning}
                                data-tip={t("raidDetail.hero.nextOpenStep")}
                                onClick={() => onPrimary(primary)}
                            >
                                {primary.label}
                            </Button>
                        ))}
                </div>
            </div>
            {cockpit || (!!data.progress?.steps?.length && (
                <div className="rd-steps" style={{ "--rd-steps": data.progress.steps.length } as CSSProperties}>
                    {data.progress.steps.map((s) => <StepCell key={s.key} step={s} onOpen={onStep} />)}
                </div>
            ))}
        </header>
    );
}
