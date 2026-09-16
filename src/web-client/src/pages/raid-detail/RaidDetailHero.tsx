// The page head: date block, kicker + category, title, time and the relative
// day, two icon buttons (event post, raidplan), the one primary action — and
// under it the progress bar, where every step is figure, status and entry at once.
import type { ReactNode } from "react";
import type { RaidDetailData, RaidPrimaryAction, RaidStep } from "../../api";
import { eventTimeParts, relativeDayLabel } from "../../lib/format";
import { eventPostUrl, raidplanUrl } from "../../lib/discordLinks";
import { Button, buttonClass } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import IconTile from "../../components/ui/IconTile";
import WowIcon from "../../components/ui/WowIcon";

function StepCell({ step, onOpen }: { step: RaidStep; onOpen: (step: RaidStep) => void }) {
    return (
        <button
            type="button"
            className={`rd-step${step.next ? " next" : ""}`}
            data-tip={step.tip.head}
            data-tip-sub={step.tip.sub || undefined}
            aria-label={`${step.label}: ${step.value} ${step.unit}`.trim()}
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
                <Badge tone={step.next ? "mid" : step.badge.tone}>{step.next && !step.badge.tone ? "nächster Schritt" : step.badge.label}</Badge>
            </span>
        </button>
    );
}

export default function RaidDetailHero({ data, onStep, onPrimary, primaryRunning, manage }: {
    data: RaidDetailData;
    onStep: (step: RaidStep) => void;
    onPrimary: (action: RaidPrimaryAction) => void;
    primaryRunning: boolean;
    /** only for an own event and write access: the "Verwalten" menu (#288) — editing (#261) is its first entry */
    manage?: ReactNode;
}) {
    const ev = data.event;
    const when = eventTimeParts(ev.startTime);
    const relDay = relativeDayLabel(ev.startTime);
    const channel = ev.channelName || ev.channelId;
    const cancelled = ev.status === "cancelled";
    // A cancelled raid has no next step to push.
    const primary = cancelled ? null : data.progress?.primary || null;

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
                        <span className="kicker">Raid-Event</span>
                        {data.categoryName && <span className="cat-badge">{data.categoryName}</span>}
                    </div>
                    <h1 className="hero-title">{ev.title || "(ohne Titel)"}</h1>
                    <div className="hero-when">
                        <span className="hero-time">{when?.time || "—"}</span>
                        <span className="hero-time-unit">Uhr</span>
                        {relDay && <Badge tone={ev.isPast ? undefined : "accent"}>{relDay}</Badge>}
                        {cancelled && (
                            <Badge tone="bad" className="em-state" tip="Abgesagt" tipSub={[ev.cancelReason, ev.cancelArchived ? "Kanal im Archiv" : ""].filter(Boolean).join(" · ") || undefined}>
                                abgesagt
                            </Badge>
                        )}
                        {!cancelled && ev.signupsClosed && (
                            <Badge tone="mid" className="em-state" tip="Anmeldung geschlossen" tipSub="Raider können sich nur noch abmelden. Die Orga trägt weiter ein.">
                                Anmeldung geschlossen
                            </Badge>
                        )}
                    </div>
                </div>
                <div className="rd-hero-actions">
                    {manage}
                    <a
                        className="ibtn" href={eventPostUrl(data.guildId, ev.channelId, ev.id)} target="_blank" rel="noopener noreferrer"
                        data-tip="Event-Post in Discord" data-tip-sub={channel ? `#${channel}` : undefined} aria-label="Event-Post in Discord öffnen"
                    >
                        <WowIcon name="inv_letter_15" size={24} />
                    </a>
                    {raidplanUrl(ev.id) && (
                        <a
                            className="ibtn" href={raidplanUrl(ev.id)} target="_blank" rel="noopener noreferrer"
                            data-tip="Raidplan im Raid-Helper" data-tip-sub="Setup und Gruppen bearbeiten" aria-label="Raidplan im Raid-Helper öffnen"
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
                                data-tip="Nächster offener Schritt"
                                onClick={() => onPrimary(primary)}
                            >
                                {primary.label}
                            </Button>
                        ))}
                </div>
            </div>
            {!!data.progress?.steps?.length && (
                <div className="rd-steps">
                    {data.progress.steps.map((s) => <StepCell key={s.key} step={s} onOpen={onStep} />)}
                </div>
            )}
        </header>
    );
}
