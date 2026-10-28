// The page head (design pilot C, Oct 2026): typography only. A small line with the category,
// the raid's title big, one line "Fr 17 Okt · 19:30 Uhr · in 7 Tagen · Loot Council", and the
// links (Discord post, raid plan, softres list, raidsheet) as quiet underlined words. On the right
// the state of the channel (a badge — and beside it its own verb button, never a clickable badge),
// the one primary button and "Verwalten ▾". No date tile, no tiles, no gradient.
//
// Under it the steps: an own event's cockpit (#319, StepBar.tsx), a Raid-Helper event's progress
// bar (#219) — both a calm text row in which only the current step carries the accent.
//
// An own event (#319) hands in its six-step cockpit as `cockpit` instead; it carries the one
// prominent deed itself, so the head's primary button stays out of the way — the same action
// twice in one head is exactly the doubling the cockpit exists to end.
//
// The loot system used to be a chip beside the category; for whoever may change it, it is an
// entry of "Verwalten" now (`lootInMenu`) — a reader still reads it in the time line.
//
// The steps, the primary action and "Kanal fehlt" are the orga's (Oct 2026): for the orga the
// steps sit in an OrgaZone, a raider gets the head with the date, the category and the links.
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import type { RaidDetailData, RaidGroup, RaidPrimaryAction, RaidStep, SessionUser } from "../../api";
import { OrgaZone } from "../../components/ui/OrgaZone";
import { eventTimeParts, relativeDayLabel } from "../../lib/format";
import { eventPostUrl, raidplanUrl } from "../../lib/discord/discordLinks";
import { Button, buttonClass } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import WowIcon from "../../components/ui/WowIcon";
import { useT } from "../../i18n";
import PugBadge from "../../components/signup/PugBadge";

function StepCell({ step, onOpen }: { step: RaidStep; onOpen: (step: RaidStep) => void }) {
    const t = useT();
    // A badge with its own finding ("RPB offen") stays a word under the value; the next step says so.
    const note = step.next && !step.badge.tone ? t("raidDetail.hero.nextStep") : step.badge.label;
    return (
        <button
            type="button"
            className={`rd-step${step.next ? " next" : ""}${step.badge.tone ? ` tone-${step.badge.tone}` : ""}`}
            data-tip={step.tip.head}
            data-tip-sub={step.tip.sub || undefined}
            aria-label={t("raidDetail.hero.stepAria", { label: step.label, value: step.value, unit: step.unit }).trim()}
            onClick={() => onOpen(step)}
        >
            <span className="rd-step-l">{step.label}</span>
            <span className="rd-step-v">
                {step.value}
                {step.unit && <small>{step.unit}</small>}
            </span>
            {note && <span className="rd-step-badge">{note}</span>}
        </button>
    );
}

/** The loot system as plain text in the time line — for a reader, who cannot change it. */
function lootSystemText(data: RaidDetailData): string {
    const ls = data.lootSystem;
    return ls ? `${ls.label}${ls.softresExtra ? " + Softres" : ""}` : "";
}

/** "Raid 2 von 2 · Zul'Aman · Zul'Aman 2" — the other raids of the evening as links to their detail pages (#811). */
function RaidGroupLinks({ group, current }: { group: RaidGroup; current: string }) {
    const t = useT();
    const me = group.raids.find((r) => r.id === current);
    return (
        <span className="rd-hero-group" data-tip={t("setup.raidGroup.head", { index: me ? me.index : 1, count: group.count })} data-tip-sub={t("setup.raidGroup.headTip")}>
            <span className="rd-dot" aria-hidden="true">·</span>
            <span>{t("setup.raidGroup.head", { index: me ? me.index : 1, count: group.count })}</span>
            {group.raids.filter((r) => r.id !== current).map((r) => (
                <Link key={r.id} className="rd-hero-grouplink" to={`/raids/detail?event=${encodeURIComponent(r.id)}`}>{r.title}</Link>
            ))}
        </span>
    );
}

/** One of the head's links: a quiet underlined word, the full name in the tooltip. */
function HeroLink({ href, label, tip, tipSub, aria }: { href: string; label: string; tip: string; tipSub?: string; aria: string }) {
    return (
        <a className="rd-hero-link" href={href} target="_blank" rel="noopener noreferrer" data-tip={tip} data-tip-sub={tipSub} aria-label={aria}>
            {label}
        </a>
    );
}

export default function RaidDetailHero({ data, user, orga, canAct = orga, allows, onStep, onPrimary, primaryRunning, manage, cockpit, lootInMenu = false, onRecreateChannel, recreating = false }: {
    data: RaidDetailData;
    /** who is looking, for the OrgaZone around the steps */
    user?: SessionUser;
    /** the orga is looking (the server's `orga`: the global orga or the raid's category's): steps, primary action and "Kanal fehlt" */
    orga: boolean;
    /** the raid's actions are open to them (`viewer.canOrga`, #729): only then a primary that opens a dialog */
    canAct?: boolean;
    /** whether a primary's dialog is open to them beyond the raid (log/loot: `cla` / `history` write, #729) */
    allows?: (action: RaidPrimaryAction) => boolean;
    onStep: (step: RaidStep) => void;
    onPrimary: (action: RaidPrimaryAction) => void;
    primaryRunning: boolean;
    /** the "Verwalten" menu (#288) — editing (#261) is its first entry; absent for a reader */
    manage?: ReactNode;
    /** an own event's step bar (#319); it replaces the progress bar and the primary button */
    cockpit?: ReactNode;
    /** the loot system is an entry of `manage`: not repeated in the time line */
    lootInMenu?: boolean;
    /** an own event whose channel is gone, with raids write: "Kanal anlegen" (#537) */
    onRecreateChannel?: () => void;
    recreating?: boolean;
}) {
    const t = useT();
    const ev = data.event;
    const when = eventTimeParts(ev.startTime);
    const relDay = relativeDayLabel(ev.startTime);
    const channel = ev.channelName || ev.channelId;
    const cancelled = ev.status === "cancelled";
    // "Kanal fehlt" is a task for the orga; a raider simply gets no channel link
    const missing = orga && ev.channelState === "missing";
    // A cancelled raid has no next step to push, and the cockpit brings its own. A primary that opens a
    // dialog only for whom the raid's actions are open (#729); a plain link for the whole orga.
    const next = !orga || cancelled || cockpit ? null : data.progress?.primary || null;
    const primary = next && (next.href || (canAct && (!allows || allows(next)))) ? next : null;
    const steps = !orga ? null : cockpit || (data.progress?.steps?.length ? (
        <div className="rd-steps" style={{ "--rd-steps": data.progress.steps.length } as CSSProperties}>
            {data.progress.steps.map((s) => <StepCell key={s.key} step={s} onOpen={onStep} />)}
        </div>
    ) : null);
    // the softres list and the raidsheet: the orga reaches them through the steps, a raider through these links
    const softresUrl = !orga ? data.eventSoftres?.url || "" : "";
    const sheetUrl = !orga ? data.sheetLink?.url || "" : "";
    const postUrl = eventPostUrl(data.guildId, ev.channelId, ev.id, ev.channelState);
    const planUrl = raidplanUrl(ev.id);
    const loot = lootInMenu ? "" : lootSystemText(data);
    const ls = data.lootSystem;
    const hasLinks = !!(postUrl || planUrl || softresUrl || sheetUrl);

    return (
        <header className="page-hero rd-hero">
            <div className="rd-hero-main">
                <div className="hero-ident">
                    {(data.categoryName || data.raidGroup) && (
                        <p className="rd-hero-sup">
                            {data.categoryName && <span className="rd-hero-cat">{data.categoryName}<PugBadge open={data.openToAll} /></span>}
                            {/* a raid group (#811): which raid this is, the evening's other raids one click away */}
                            {data.raidGroup && <RaidGroupLinks group={data.raidGroup} current={ev.id} />}
                        </p>
                    )}
                    <h1 className="hero-title">{ev.title || t("raidDetail.hero.noTitle")}</h1>
                    <div className="hero-when">
                        <span className="rd-hero-date" data-tip={when?.full || undefined}>
                            {when ? `${when.weekday} ${when.day} ${when.month}` : "—"}
                        </span>
                        <span className="rd-dot" aria-hidden="true">·</span>
                        <span className="hero-time">{when?.time || "—"}</span>
                        <span className="hero-time-unit">{t("raidDetail.hero.timeUnit")}</span>
                        {relDay && <span className="rd-hero-cat"><span className="rd-dot" aria-hidden="true">·</span>{relDay}</span>}
                        {loot && ls && (
                            <span
                                className="rd-hero-cat" data-tip={t("raidDetail.hero.lootTip", { label: loot })}
                                data-tip-sub={ls.source === "event" ? t("raidDetail.hero.lootOriginEvent") : t("raidDetail.hero.lootOriginCategory", { category: ls.categoryLabel })}
                            >
                                <span className="rd-dot" aria-hidden="true">·</span>{loot}
                            </span>
                        )}
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
                    {hasLinks && (
                        <nav className="rd-hero-links" aria-label={t("raidDetail.hero.linksAria")}>
                            {postUrl && (
                                <HeroLink
                                    href={postUrl} label={t("raidDetail.hero.linkPost")} tip={t("raidDetail.hero.eventPost")}
                                    tipSub={channel ? `#${channel}` : undefined} aria={t("raidDetail.hero.eventPostAria")}
                                />
                            )}
                            {planUrl && (
                                <HeroLink
                                    href={planUrl} label={t("raidDetail.hero.linkRaidplan")} tip={t("raidDetail.hero.raidplan")}
                                    tipSub={t("raidDetail.hero.raidplanSub")} aria={t("raidDetail.hero.raidplanAria")}
                                />
                            )}
                            {softresUrl && (
                                <HeroLink
                                    href={softresUrl} label={t("raidDetail.hero.linkSoftres")} tip={t("raidDetail.hero.softres")}
                                    tipSub={t("raidDetail.hero.softresSub")} aria={t("raidDetail.hero.softresAria")}
                                />
                            )}
                            {sheetUrl && (
                                <HeroLink
                                    href={sheetUrl} label={t("raidDetail.hero.linkSheet")} tip={t("raidDetail.hero.sheet")}
                                    tipSub={t("raidDetail.hero.sheetSub")} aria={t("raidDetail.hero.sheetAria")}
                                />
                            )}
                        </nav>
                    )}
                </div>
                <div className="rd-hero-actions">
                    {missing && (
                        <Badge
                            tone="bad" icon="channels" tip={t("raidDetail.hero.channelMissing")}
                            tipSub={onRecreateChannel ? t("raidDetail.hero.channelMissingSub") : t("raidDetail.hero.channelMissingSubReader")}
                        >
                            {t("raidDetail.hero.channelMissing")}
                        </Badge>
                    )}
                    {missing && onRecreateChannel && (
                        <Button
                            variant="ghost" size="sm" running={recreating}
                            data-tip={t("raidDetail.hero.recreateChannel")} data-tip-sub={t("raidDetail.hero.recreateChannelSub")}
                            onClick={onRecreateChannel}
                        >
                            {t("raidDetail.hero.recreateChannel")}
                        </Button>
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
                {manage && <div className="rd-hero-manage">{manage}</div>}
            </div>
            {steps && (user ? <OrgaZone user={user}>{steps}</OrgaZone> : steps)}
        </header>
    );
}
