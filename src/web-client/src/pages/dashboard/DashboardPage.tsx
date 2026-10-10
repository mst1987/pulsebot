// "Übersicht" — the start page (design issue #220). It answers one question:
// what is coming up, and what is open? Everything else is one click away.
//
// Two parts (design canvas Oct 2026, direction A): "Für dich" (PersonalParts.tsx)
// for everyone with a signup of their own — the next raid with their signup,
// setup group, softres and raid plan, the raids after it, attendance, profile
// and their last raids — and, for whoever reads the raids, the orga block below:
//
//   row 1: the next raid (its category, role fill, setup/softres — the sheet
//          only where the category plans with one — and the raid after it)
//          beside the open tasks — one row per task, only when there is one;
//   row 2: one compact tile per area (last evaluation, new loot, roster),
//          each a link, the details in its tooltip;
//   row 3: the newest top-item awards beside the last raids, rows of one height.
//
// The modal "Raid-Details" (pages/dashboard/RaidDetailsModal.tsx) loads its own data
// when it opens.
import { useState, type ReactNode } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
    canAccess, decideTrial, getDashboard, recreateChannel,
    type ApiError, type DashboardData, type DashboardPersonal, type DashboardRaid, type DashboardTask, type DashboardTaskAction,
} from "../../api";
import type { ShellContext } from "../../components/shell/Shell";
import { useToast } from "../../components/shell/Jobs";
import { useApi } from "../../hooks/useApi";
import AsyncView from "../../components/ui/AsyncView";
import PageHead from "../../components/ui/PageHead";
import { PartHead } from "../../components/ui/PartHead";
import { Button, buttonClass } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import IconTile, { type TileTone } from "../../components/ui/IconTile";
import WowIcon from "../../components/ui/WowIcon";
import { useContentVersion } from "../../hooks/useContentVersion";
import { ChevronRightIcon } from "../../components/ui/icons";
import TopLootList from "../../components/loot/TopLootList";
import RaidDetailsModal from "./RaidDetailsModal";
import { RoleBar, IconLink } from "./OverviewParts";
import { usesSheet } from "./raidPlanning";
import { taskText } from "../../lib/dashboard/taskText";
import { OrgaZone } from "../../components/ui/OrgaZone";
import { AttendanceDots, MyNextRaid, MyRaids, MyRecentRaids } from "./PersonalParts";
import { eventPostUrl, raidplanUrl } from "../../lib/discord/discordLinks";
import { relativeDayLabel } from "../../lib/format";
import { longDay, shortDate, dayDate, clock, raidWhen } from "../../lib/raids/overviewDates";
import "../../styles/dashboard.css";
import RaidLoader from "../../components/ui/RaidLoader";
import { useT } from "../../i18n";
import { roleLabel } from "../../lib/wow/wowNames";

/**
 * A link inside the SPA, or a plain anchor for the server-rendered report pages
 * (/r/…) and for an address outside the menu — the deploy task (#314) leads to
 * the written instructions in the repository, which no route here can render.
 */
function RowLink({ href, className, tip, tipSub, children }: {
    href: string; className: string; tip?: string; tipSub?: string; children: ReactNode;
}) {
    const props = { className, "data-tip": tip, "data-tip-sub": tipSub };
    const external = /^https?:\/\//.test(href);
    if (external) return <a href={href} target="_blank" rel="noreferrer" {...props}>{children}</a>;
    return href.startsWith("/r/")
        ? <a href={href} {...props}>{children}</a>
        : <Link to={href} {...props}>{children}</Link>;
}

/** The sheet badge — only for a category that plans with a Google Sheet; a raid-plan category has none to miss. */
function SheetBadge({ raid }: { raid: DashboardRaid }) {
    const t = useT();
    if (!usesSheet(raid)) return null;
    return raid.sheet
        ? <Badge tone="ok" icon="inv_misc_note_02" tip={t("dashboard.sheet.doneTip")} tipSub={raid.sheet.playerCount ? t("dashboard.sheet.doneSubCount", { count: raid.sheet.playerCount }) : t("dashboard.sheet.doneSubFixed")}>{t("dashboard.sheet.done")}</Badge>
        : <Badge tone="bad" icon="inv_misc_note_02" tip={t("dashboard.sheet.missingTip")} tipSub={t("dashboard.sheet.missingSub")}>{t("dashboard.sheet.missing")}</Badge>;
}

/**
 * The softres badge — or, for a raid whose loot system has no softres list
 * (Loot-Council, GDKP, …), one quiet badge naming that system instead of a
 * "Softres fehlt" nobody needs to act on.
 */
export function LootBadge({ raid }: { raid: DashboardRaid }) {
    const t = useT();
    const ls = raid.lootSystem;
    if (ls && !ls.softres) {
        return <Badge icon="inv_misc_bag_10" tip={t("dashboard.lootBadge.systemTip", { label: ls.label })} tipSub={t("dashboard.lootBadge.systemSub")}>{ls.label}</Badge>;
    }
    return raid.softres
        ? <Badge tone="ok" icon="inv_scroll_11" tip={t("dashboard.lootBadge.softresDoneTip")}>{t("dashboard.lootBadge.softres")}</Badge>
        : <Badge tone="mid" icon="inv_scroll_11" tip={t("dashboard.lootBadge.softresMissingTip")} tipSub={t("dashboard.lootBadge.softresMissingSub")}>{t("dashboard.lootBadge.softresMissing")}</Badge>;
}

/** The raid's own page in the menu. */
function raidDetailHref(eventId: string): string {
    return `/raids/detail?event=${encodeURIComponent(eventId)}`;
}

function NextRaidCard({ raid, following, error, guildId, onDetails }: {
    raid: DashboardRaid | null;
    following: DashboardRaid | null;
    error: string | null;
    guildId: string;
    onDetails: () => void;
}) {
    const t = useT();
    return (
        <section className="dash-card ov-card">
            <PartHead
                icon={raid?.icon || "inv_misc_head_dragon_01"} title={t("dashboard.next.title")} crumb={t("dashboard.next.crumb")}
                action={raid && (
                    <span className="ov-head-actions">
                        <Button variant="ghost" size="sm" onClick={onDetails}>{t("dashboard.next.details")}</Button>
                        <Link className={buttonClass("ghost", "sm")} to={raidDetailHref(raid.id)} data-tip={t("dashboard.next.openTip")} data-tip-sub={t("dashboard.next.openSub")}>{t("dashboard.next.open")}</Link>
                    </span>
                )}
            />
            {!raid
                ? <div className="ov-empty-text">{error || t("dashboard.next.empty")}</div>
                : (
                    <div className="ov-next">
                        <div className="ov-next-top">
                            <WowIcon name={raid.icon} size={56} className="ov-boss56" />
                            <div className="ov-next-text">
                                {raid.categoryName && <span className="ov-cat" data-tip={t("dashboard.next.categoryTip")}>{raid.categoryName}</span>}
                                <Link className="ov-next-title" to={raidDetailHref(raid.id)}>{raid.title}</Link>
                                <div className="ov-next-when">{raidWhen(raid.startTime)}{raid.channelName ? ` · #${raid.channelName}` : ""}</div>
                            </div>
                            <Badge tone="accent" className="ov-next-rel">{relativeDayLabel(raid.startTime)}</Badge>
                        </div>
                        <div className="ov-roles">
                            {raid.roles.map((r) => (
                                <div className="ov-role" key={r.key} data-tip={roleLabel(r.key, r.label)} data-tip-sub={t(raid.setupCount ? "dashboard.next.roleSubSetup" : "dashboard.next.roleSubSignups", { filled: r.filled, target: r.target, size: raid.size })}>
                                    <WowIcon name={r.icon} size={22} />
                                    <RoleBar role={r} />
                                </div>
                            ))}
                        </div>
                        <div className="ov-next-foot">
                            <SheetBadge raid={raid} />
                            {raid.setupCount
                                ? <Badge tone="ok" icon="inv_misc_groupneedmore" tip={t("dashboard.next.setupDoneTip")} tipSub={t("dashboard.next.setupDoneSub", { count: raid.setupCount })}>{t("dashboard.next.setupDone")}</Badge>
                                : <Badge tone="mid" icon="inv_misc_groupneedmore" tip={t("dashboard.next.setupOpenTip")} tipSub={t("dashboard.next.setupOpenSub")}>{t("dashboard.next.setupOpen")}</Badge>}
                            <LootBadge raid={raid} />
                            <span className="ov-links">
                                {eventPostUrl(guildId, raid.channelId, raid.id, raid.channelState) && <IconLink icon="inv_letter_15" href={eventPostUrl(guildId, raid.channelId, raid.id, raid.channelState)} tip={t("dashboard.next.discordTip")} tipSub={t("dashboard.next.discordSub")} />}
                                {raidplanUrl(raid.id) && <IconLink icon="inv_misc_groupneedmore" href={raidplanUrl(raid.id)} tip={t("dashboard.next.setupTip")} tipSub={t("dashboard.next.setupSub")} />}
                                {raid.softres && <IconLink icon="inv_scroll_11" href={raid.softres.url} tip={t("dashboard.next.softresTip")} tipSub={t("dashboard.next.softresSub")} />}
                            </span>
                        </div>
                        {following && (
                            <div className="ov-following">
                                <WowIcon name={following.icon} size={20} />
                                <span>{t("dashboard.next.after")}</span>
                                <Link className="ov-following-t" to={raidDetailHref(following.id)}>
                                    {following.title} – {dayDate(following.startTime * 1000)} {clock(following.startTime * 1000)}
                                </Link>
                                {following.categoryName && <span className="ov-cat-s">{following.categoryName}</span>}
                                <span className="ov-push"><SheetBadge raid={following} /></span>
                            </div>
                        )}
                    </div>
                )}
        </section>
    );
}

const TASK_TILE: Record<DashboardTask["tone"], TileTone> = { ok: "ok", mid: "mid", bad: "bad", accent: "home" };

/** The task's second line: its words from the server (`texts.ref`), a ready text, else the raid/report with its date. */
function taskRef(task: DashboardTask): string {
    const fallback = task.ref.text || [task.ref.title, task.ref.at ? dayDate(task.ref.at) : ""].filter(Boolean).join(" · ");
    if (task.texts && task.texts.ref) return taskText(task, "ref", fallback);
    if (task.ref.text) return task.ref.text;
    return [task.ref.title, task.ref.at ? dayDate(task.ref.at) : ""].filter(Boolean).join(" · ");
}

/**
 * A task's own button (#537: "Kanal neu anlegen") — beside the row, not inside
 * its link. Runs the action, says what happened and reloads the dashboard.
 */
function TaskAction({ task, onDone }: { task: DashboardTask; onDone?: () => void }) {
    const toast = useToast();
    const [busy, setBusy] = useState(false);
    const action = task.action;
    if (action && action.kind === "rosterTrial") return <TrialActions action={action} onDone={onDone} />;
    if (!action || action.kind !== "recreateChannel") return null;
    const run = () => {
        setBusy(true);
        recreateChannel(action.eventId)
            .then((r) => {
                toast(r.warnings && r.warnings.length ? `${r.message}\n${r.warnings.join("\n")}` : r.message, r.warnings && r.warnings.length ? "err" : undefined);
                if (onDone) onDone();
            })
            .catch((err: ApiError) => toast(err.message, "err"))
            .finally(() => setBusy(false));
    };
    return <Button size="sm" variant="ghost" running={busy} onClick={run}>{taskText(task, "action", action.label)}</Button>;
}

/**
 * The two buttons of a trial ending soon (#658): "Übernehmen" makes the member core, "Verlängern" moves the
 * end 14 days on (the server's `extendTo`). Says what happened and reloads the dashboard.
 */
function TrialActions({ action, onDone }: { action: Extract<DashboardTaskAction, { kind: "rosterTrial" }>; onDone?: () => void }) {
    const t = useT();
    const toast = useToast();
    const [busy, setBusy] = useState<"" | "adopt" | "extend">("");
    const run = (decision: "adopt" | "extend") => {
        setBusy(decision);
        decideTrial(action, decision)
            .then(() => {
                toast(decision === "adopt" ? t("dashboard.tasks.trial.adopted") : t("dashboard.tasks.trial.extended", { date: dayDate(new Date(action.extendTo).getTime()) }));
                if (onDone) onDone();
            })
            .catch((err: ApiError) => toast(err.message, "err"))
            .finally(() => setBusy(""));
    };
    return (
        <span className="ov-task-btns">
            <Button size="sm" variant="ghost" running={busy === "adopt"} disabled={!!busy} onClick={() => run("adopt")}>{t("dashboard.tasks.trial.adopt")}</Button>
            <Button size="sm" variant="ghost" running={busy === "extend"} disabled={!!busy} onClick={() => run("extend")}>{t("dashboard.tasks.trial.extend")}</Button>
        </span>
    );
}

/** The open tasks: one row per task that exists, each leading straight to where it is done. */
export function TaskList({ tasks, onChanged }: { tasks: DashboardTask[]; onChanged?: () => void }) {
    // The head says "something is open", not how bad the worst row is — the rows carry their own tone.
    const t = useT();
    const tone = tasks.length ? "mid" : "ok";
    return (
        <section className="dash-card ov-card">
            <PartHead
                icon="inv_misc_note_01" tone={tone} title={t("dashboard.tasks.title")}
                action={<Badge tone={tone} count>{tasks.length}</Badge>}
            />
            {tasks.length === 0
                ? (
                    <div className="ov-alldone">
                        <IconTile icon="spell_holy_borrowedtime" tone="ok" size="lg" />
                        <div className="ov-alldone-t">{t("dashboard.tasks.allDone")}</div>
                        <div className="ov-note">{t("dashboard.tasks.allDoneNote")}</div>
                    </div>
                )
                : (
                    <div className="ov-rows">
                        {/* `t` here is the task (it shadows the translator; the row words its texts through taskText) */}
                        {tasks.map((t) => {
                            const row = (
                                <RowLink key={t.id} href={t.href} className="ov-row ov-task" tip={taskText(t, "tip", t.tip)} tipSub={taskText(t, "tipSub", t.tipSub)}>
                                    <IconTile icon={t.icon} tone={(t.tile as TileTone) || TASK_TILE[t.tone]} />
                                    <span className="grow">
                                        <span className="t1">{taskText(t, "title", t.title)}</span>
                                        <span className="t2">{taskRef(t)}</span>
                                    </span>
                                    {t.count > 0 && <Badge tone={t.tone} count>{t.count}</Badge>}
                                    <span className="ov-go" aria-hidden="true"><ChevronRightIcon /></span>
                                </RowLink>
                            );
                            // A task with its own button: the button sits beside the link, never inside it.
                            return t.action
                                ? <div key={t.id} className={`ov-task-act${t.action.kind === "rosterTrial" ? " ov-task-act-two" : ""}`}>{row}<TaskAction task={t} onDone={onChanged} /></div>
                                : row;
                        })}
                    </div>
                )}
        </section>
    );
}

function AreaTile({ area, icon, label, href, tip, tipSub, children }: {
    area: TileTone; icon: string; label: string; href: string; tip: string; tipSub?: string; children: ReactNode;
}) {
    return (
        <RowLink href={href} className={`dash-card ov-area ov-area-${area}`} tip={tip} tipSub={tipSub}>
            <span className="ov-area-hd"><IconTile icon={icon} tone={area} /><span className="ov-area-lbl">{label}</span></span>
            {children}
        </RowLink>
    );
}

function AreaTiles({ areas }: { areas: NonNullable<DashboardData["areas"]> }) {
    const t = useT();
    const r = areas.lastReport;
    const reportSub = r
        ? [
            `${t("dashboard.areas.bosses", { count: r.bosses })}, ${t("dashboard.areas.kills", { count: r.kills })}${r.avoidableDeaths !== null ? ` · ${t("dashboard.areas.avoidableDeaths", { count: r.avoidableDeaths })}` : ""}`,
            t("dashboard.areas.gear", { count: r.gear }),
            t("dashboard.areas.consumables", { count: r.consumables }),
            t("dashboard.areas.buffs", { count: r.buffs }),
            t("dashboard.areas.clickReport"),
        ].join("\n")
        : "";
    return (
        <div className="ov-grid ov-grid-areas">
            {r
                ? (
                    <AreaTile area="cla" icon="inv_misc_pocketwatch_01" label={t("dashboard.areas.lastReport")} href={`/r/${encodeURIComponent(r.id)}`} tip={`${r.zone || r.title} · ${dayDate(r.generatedAt)}`} tipSub={reportSub}>
                        <span className="ov-area-val">{r.zone || r.title}</span>
                        <span className="ov-badges">
                            <Badge>{shortDate(r.generatedAt)}</Badge>
                            <Badge tone={r.problems ? "bad" : "ok"}>{r.problems ? t("dashboard.areas.problems", { count: r.problems }) : t("dashboard.areas.noProblems")}</Badge>
                        </span>
                    </AreaTile>
                )
                : (
                    <AreaTile area="cla" icon="inv_misc_pocketwatch_01" label={t("dashboard.areas.lastReport")} href="/cla" tip={t("dashboard.areas.noReportTip")} tipSub={t("dashboard.areas.noReportSub")}>
                        <span className="ov-area-val">{t("dashboard.areas.none")}</span>
                        <span className="ov-badges"><Badge tone="accent">{t("dashboard.areas.evaluate")}</Badge></span>
                    </AreaTile>
                )}
            <AreaTile area="history" icon="inv_misc_bag_10" label={t("dashboard.areas.newLoot")} href="/history?tab=awards" tip={t("dashboard.areas.newLootTip")} tipSub={areas.newLoot.since ? t("dashboard.areas.newLootSub", { date: dayDate(areas.newLoot.since) }) : t("dashboard.areas.newLootNone")}>
                <span className="ov-area-big">{areas.newLoot.count}</span>
                <span className="ov-badges">
                    <Badge tone="accent">{t("dashboard.areas.topItems")}</Badge>
                    {areas.newLoot.since > 0 && <Badge>{t("dashboard.areas.since", { date: dayDate(areas.newLoot.since).split(" ")[0] })}</Badge>}
                </span>
            </AreaTile>
            <AreaTile area="roster" icon="achievement_guildperk_everybodysfriend" label={t("dashboard.areas.roster")} href="/roster" tip={t("dashboard.areas.rosterTip")} tipSub={areas.roster ? t("dashboard.areas.rosterSub", { count: areas.roster.withoutDiscord }) : t("dashboard.areas.rosterError")}>
                <span className="ov-area-big">{areas.roster ? areas.roster.total : "–"}</span>
                <span className="ov-badges">
                    <Badge>{t("dashboard.areas.raider")}</Badge>
                    {areas.roster && areas.roster.withoutDiscord > 0 && <Badge tone="mid">{t("dashboard.areas.withoutDiscord", { count: areas.roster.withoutDiscord })}</Badge>}
                </span>
            </AreaTile>
        </div>
    );
}

function LootCard({ topLoot }: { topLoot: DashboardData["topLoot"] }) {
    const t = useT();
    return (
        <section className="dash-card ov-card ov-loot">
            <PartHead
                icon="inv_misc_bag_10" tone="history" title={t("dashboard.loot.title")} crumb={t("dashboard.loot.crumb")}
                action={<Link className={buttonClass("ghost", "sm")} to="/history?tab=awards">{t("dashboard.loot.historyLink")}</Link>}
            />
            {topLoot.items.length
                ? <TopLootList items={topLoot.items} />
                : (
                    <div className="ov-empty-text">
                        {topLoot.configured
                            ? t("dashboard.loot.noneAwarded", { count: topLoot.configured })
                            : <>{t("dashboard.loot.noneConfigured")} <Link to="/settings?section=loot">{t("dashboard.loot.settingsLink")}</Link>.</>}
                    </div>
                )}
        </section>
    );
}

function RecentRaidList({ recent }: { recent: DashboardData["recentEvents"] }) {
    const t = useT();
    return (
        <section className="dash-card ov-card">
            <PartHead
                icon="inv_misc_note_02" title={t("dashboard.recent.title")}
                action={<Link className={buttonClass("ghost", "sm")} to="/history?tab=raids">{t("dashboard.recent.all")}</Link>}
            />
            {!recent.events.length
                ? <div className="ov-empty-text">{recent.error || t("dashboard.recent.empty")}</div>
                : (
                    <div className="ov-rows">
                        {recent.events.map((ev) => {
                            const evaluated = ev.logs.some((l) => l.status === "done");
                            const pending = ev.pendingLogCount || 0;
                            return (
                                <Link key={ev.id} className="ov-row" to={`/raids/detail?event=${encodeURIComponent(ev.id)}`}>
                                    <WowIcon name={ev.icon} size={36} className="ov-ico36" />
                                    <span className="grow">
                                        <span className="t1">{ev.title}</span>
                                        <span className="t2">{[ev.categoryName, dayDate(ev.startTime * 1000), ev.channelName ? `#${ev.channelName}` : ""].filter(Boolean).join(" · ")}</span>
                                    </span>
                                    {pending > 0
                                        ? <Badge tone="mid" icon="inv_misc_pocketwatch_01" tip={t("dashboard.recent.pendingTip")} tipSub={t("dashboard.recent.pendingSub")}>{t("dashboard.recent.pendingLogs", { count: pending })}</Badge>
                                        : evaluated
                                            ? <Badge tone="ok" icon="inv_misc_pocketwatch_01">{t("dashboard.recent.evaluated")}</Badge>
                                            : <Badge icon="inv_misc_pocketwatch_01" tip={ev.logs.length ? t("dashboard.recent.notEvaluatedTip") : t("dashboard.recent.noLogTip")}>{ev.logs.length ? t("dashboard.recent.notEvaluated") : t("dashboard.recent.noLog")}</Badge>}
                                    {ev.lootCount
                                        ? <Badge icon="inv_misc_bag_10" tip={t("dashboard.recent.lootTip", { count: ev.lootCount })}>{ev.lootCount}</Badge>
                                        : <Badge tone="bad" icon="inv_misc_bag_10" tip={t("dashboard.recent.noLootTip")}>{t("dashboard.recent.noLoot")}</Badge>}
                                </Link>
                            );
                        })}
                    </div>
                )}
        </section>
    );
}

/** A thin heading between the page's two parts ("Für dich", "Orga"). */
function PartDivider({ label, tone }: { label: string; tone: "me" | "orga" }) {
    return (
        <div className={`ov-divider ov-divider-${tone}`}>
            <span className="ov-divider-l">{label}</span>
            <span className="ov-divider-line" aria-hidden="true" />
        </div>
    );
}

/** The raider's two figures: attendance over the last nights, and the profile. */
function PersonalTiles({ personal }: { personal: DashboardPersonal }) {
    const t = useT();
    const a = personal.attendance;
    const p = personal.profile;
    const hint = p.hints[0];
    return (
        <div className="ov-grid ov-grid-me-tiles">
            <AreaTile
                area="absences" icon="spell_nature_timestop" label={t("dashboard.personal.attendance.label")} href="/absences"
                tip={t("dashboard.personal.attendance.tip")} tipSub={a ? t("dashboard.personal.attendance.sub", { count: a.bench }) : t("dashboard.personal.attendance.none")}
            >
                <span className="ov-area-big">{a ? t("dashboard.personal.attendance.value", { attended: a.attended, total: a.total }) : "–"}</span>
                {a && a.last.length > 0 && <AttendanceDots nights={a.last} />}
            </AreaTile>
            <AreaTile
                area="profile" icon="achievement_character_human_male" label={t("dashboard.personal.profile.label")} href="/profile"
                tip={t("dashboard.personal.profile.tip")} tipSub={hint ? t(`dashboard.personal.profile.${hint.kind}`, { character: hint.character }) : t("dashboard.personal.profile.complete")}
            >
                <span className="ov-area-val">{hint ? t(`dashboard.personal.profile.${hint.kind}`, { character: hint.character }) : t("dashboard.personal.profile.characters", { count: p.characters })}</span>
                <span className="ov-badges">
                    {p.hints.length > 0
                        ? <Badge tone="mid">{t("dashboard.personal.profile.hints", { count: p.hints.length })}</Badge>
                        : <Badge tone="ok">{t("dashboard.personal.profile.ok")}</Badge>}
                    {p.characters > 0 && p.hints.length > 0 && <Badge>{t("dashboard.personal.profile.characters", { count: p.characters })}</Badge>}
                </span>
            </AreaTile>
        </div>
    );
}

export default function DashboardPage() {
    const t = useT();
    const { user } = useOutletContext<ShellContext>();
    // The game version of the raid/loot tiles (#563): the menu's content switch.
    const { version } = useContentVersion();
    const dashboard = useApi(() => getDashboard(version), [version]);
    const [detailsOpen, setDetailsOpen] = useState(false);

    return (
        <AsyncView state={dashboard} loading={<RaidLoader text={t("dashboard.page.loading")} />} error={(err) => <div className="empty">{t("dashboard.page.loadError", { message: err.message })}</div>}>
            {(data) => {
                const kicker = [data.kicker.guild, data.kicker.realm, longDay(Date.now())].filter(Boolean).join(" · ");
                const me = data.personal;
                // Two parts (design canvas Oct 2026, direction A): "Für dich" for everyone with a signup of their own —
                // in full for a raider, compact above the orga block — and the orga block for whoever reads the raids.
                const action = canAccess(user, "raids", "write")
                    ? <Link className={buttonClass("primary", "md", true)} to="/raids/new"><WowIcon name="inv_misc_note_02" size={22} />{t("dashboard.page.newRaid")}</Link>
                    : me
                        ? <Link className={buttonClass("primary", "md", true)} to="/signups"><WowIcon name="inv_misc_book_09" size={22} />{t("dashboard.personal.toSignups")}</Link>
                        : undefined;

                return (
                    <div className="ov-page">
                        <PageHead icon="inv_misc_map_01" tone="home" kicker={kicker} title={t("dashboard.page.title")} action={action} />

                        {me && (
                            <>
                                {data.orga && <PartDivider tone="me" label={t("dashboard.personal.divider")} />}
                                <div className="ov-grid ov-grid-top">
                                    <MyNextRaid raid={me.upcoming[0] || null} compact={data.orga} />
                                    <MyRaids raids={me.upcoming.slice(1, data.orga ? 3 : undefined)} />
                                </div>
                                {!data.orga && <PersonalTiles personal={me} />}
                            </>
                        )}

                        {data.orga && (
                            // the orga's block in its zone (design canvas Oct 2026, B): for the orga only
                            <OrgaZone user={user}>
                                <div className="ov-grid ov-grid-top">
                                    <NextRaidCard
                                        raid={data.nextRaid} following={data.followingRaid} error={data.nextRaidError}
                                        guildId={data.activeGuildId} onDetails={() => setDetailsOpen(true)}
                                    />
                                    <TaskList tasks={data.tasks} onChanged={() => void dashboard.reload()} />
                                </div>
                                {data.areas && <AreaTiles areas={data.areas} />}
                            </OrgaZone>
                        )}

                        {/* someone outside the raids with a task of their own (the server's state, the archive) */}
                        {!data.orga && data.tasks.length > 0 && <TaskList tasks={data.tasks} onChanged={() => void dashboard.reload()} />}

                        <div className="ov-grid ov-grid-bottom">
                            <LootCard topLoot={data.topLoot} />
                            {data.orga
                                ? <RecentRaidList recent={data.recentEvents} />
                                : me && <MyRecentRaids recent={me.recent} />}
                        </div>

                        {data.nextRaid && (
                            <RaidDetailsModal
                                eventId={detailsOpen ? data.nextRaid.id : ""}
                                guildId={data.activeGuildId}
                                title={data.nextRaid.title}
                                icon={data.nextRaid.icon}
                                onClose={() => setDetailsOpen(false)}
                            />
                        )}
                    </div>
                );
            }}
        </AsyncView>
    );
}