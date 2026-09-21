// "Übersicht" — the start page (design issue #220). It answers one question:
// what is coming up, and what is open? Everything else is one click away.
//
//   row 1: the next raid (role fill, sheet/setup/softres, the raid after it)
//          beside the open tasks — one row per task, only when there is one;
//   row 2: one compact tile per area (last evaluation, new loot, recruitment,
//          roster), each a link, the details in its tooltip;
//   row 3: the newest top-item awards beside the last raids.
//
// The modal "Raid-Details" (components/RaidDetailsModal.tsx) loads its own data
// when it opens.
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { getDashboard, type ApiError, type DashboardData, type DashboardRaid, type DashboardTask } from "../api";
import PageHead from "../components/ui/PageHead";
import { PartHead } from "../components/ui/PartHead";
import { Button, buttonClass } from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import IconTile, { type TileTone } from "../components/ui/IconTile";
import WowIcon from "../components/ui/WowIcon";
import { ChevronRightIcon } from "../components/icons";
import TopLootList from "../components/TopLootList";
import RaidDetailsModal from "../components/RaidDetailsModal";
import { RoleBar, IconLink } from "../components/OverviewParts";
import { eventPostUrl, raidplanUrl } from "../lib/discordLinks";
import { relativeDayLabel } from "../lib/format";
import { longDay, shortDate, dayDate, clock, raidWhen } from "../lib/overviewDates";
import "../styles/uebersicht.css";
import RaidLoader from "../components/ui/RaidLoader";
import { useT } from "../i18n";
import { roleLabel } from "../lib/wowNames";

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

function SheetBadge({ raid }: { raid: DashboardRaid }) {
    const t = useT();
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
                                {guildId && raid.channelId && <IconLink icon="inv_letter_15" href={eventPostUrl(guildId, raid.channelId, raid.id)} tip={t("dashboard.next.discordTip")} tipSub={t("dashboard.next.discordSub")} />}
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
                                <span className="ov-push"><SheetBadge raid={following} /></span>
                            </div>
                        )}
                    </div>
                )}
        </section>
    );
}

const TASK_TILE: Record<DashboardTask["tone"], TileTone> = { ok: "ok", mid: "mid", bad: "bad", accent: "home" };

function taskRef(task: DashboardTask): string {
    if (task.ref.text) return task.ref.text;
    return [task.ref.title, task.ref.at ? dayDate(task.ref.at) : ""].filter(Boolean).join(" · ");
}

/** The open tasks: one row per task that exists, each leading straight to where it is done. */
export function TaskList({ tasks }: { tasks: DashboardTask[] }) {
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
                        {/* `t` here is the task (it shadows the translator; the row shows server texts only) */}
                        {tasks.map((t) => (
                            <RowLink key={t.id} href={t.href} className="ov-row ov-task" tip={t.tip} tipSub={t.tipSub}>
                                <IconTile icon={t.icon} tone={(t.tile as TileTone) || TASK_TILE[t.tone]} />
                                <span className="grow">
                                    <span className="t1">{t.title}</span>
                                    <span className="t2">{taskRef(t)}</span>
                                </span>
                                {t.count > 0 && <Badge tone={t.tone} count>{t.count}</Badge>}
                                <span className="ov-go" aria-hidden="true"><ChevronRightIcon /></span>
                            </RowLink>
                        ))}
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

function AreaTiles({ areas }: { areas: DashboardData["areas"] }) {
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
            <AreaTile area="recruitment" icon="inv_misc_grouplooking" label={t("dashboard.areas.recruitment")} href="/recruitment" tip={t("dashboard.areas.recruitmentTip")} tipSub={t("dashboard.areas.recruitmentSub")}>
                <span className="ov-area-big">{areas.recruitment.posts}</span>
                <span className="ov-badges">
                    {areas.recruitment.posts
                        ? <Badge tone="ok">{t("dashboard.areas.postsActive")}</Badge>
                        : <Badge>{t("dashboard.areas.noPosts")}</Badge>}
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
        <section className="dash-card ov-card">
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
                                        <span className="t2">{dayDate(ev.startTime * 1000)}{ev.channelName ? ` · #${ev.channelName}` : ""}</span>
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

export default function DashboardPage() {
    const t = useT();
    const [data, setData] = useState<DashboardData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [detailsOpen, setDetailsOpen] = useState(false);

    useEffect(() => {
        getDashboard()
            .then(setData)
            .catch((err: ApiError) => setError(err));
    }, []);

    if (error) {
        return <div className="empty">{t("dashboard.page.loadError", { message: error.message })}</div>;
    }
    if (!data) {
        return <RaidLoader text={t("dashboard.page.loading")} />;
    }

    const kicker = [data.kicker.guild, data.kicker.realm, longDay(Date.now())].filter(Boolean).join(" · ");

    return (
        <div className="ov-page">
            <PageHead
                icon="inv_misc_map_01" tone="home" kicker={kicker} title={t("dashboard.page.title")}
                action={<Link className={buttonClass("primary", "md", true)} to="/raids/new"><WowIcon name="inv_misc_note_02" size={22} />{t("dashboard.page.newRaid")}</Link>}
            />

            <div className="ov-grid ov-grid-top">
                <NextRaidCard
                    raid={data.nextRaid} following={data.followingRaid} error={data.nextRaidError}
                    guildId={data.activeGuildId} onDetails={() => setDetailsOpen(true)}
                />
                <TaskList tasks={data.tasks} />
            </div>

            <AreaTiles areas={data.areas} />

            <div className="ov-grid ov-grid-bottom">
                <LootCard topLoot={data.topLoot} />
                <RecentRaidList recent={data.recentEvents} />
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
}
