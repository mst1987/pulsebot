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
    return raid.sheet
        ? <Badge tone="ok" icon="inv_misc_note_02" tip="Raidsheet fertig" tipSub={raid.sheet.playerCount ? `${raid.sheet.playerCount} Spieler eingetragen.` : "Das feste Sheet der Kategorie."}>Sheet fertig</Badge>
        : <Badge tone="bad" icon="inv_misc_note_02" tip="Raidsheet fehlt" tipSub="Wird auf der Seite des Raid-Events aus dem Setup gefüllt.">Sheet fehlt</Badge>;
}

function NextRaidCard({ raid, following, error, guildId, onDetails }: {
    raid: DashboardRaid | null;
    following: DashboardRaid | null;
    error: string | null;
    guildId: string;
    onDetails: () => void;
}) {
    return (
        <section className="dash-card ov-card">
            <PartHead
                icon={raid?.icon || "inv_misc_head_dragon_01"} title="Nächster Raid" crumb="Raid-Events"
                action={raid && <Button variant="ghost" size="sm" onClick={onDetails}>Details</Button>}
            />
            {!raid
                ? <div className="ov-empty-text">{error || "Kein anstehender Raid bei Raid-Helper."}</div>
                : (
                    <div className="ov-next">
                        <div className="ov-next-top">
                            <WowIcon name={raid.icon} size={56} className="ov-boss56" />
                            <div className="ov-next-text">
                                <div className="ov-next-title">{raid.title}</div>
                                <div className="ov-next-when">{raidWhen(raid.startTime)}{raid.channelName ? ` · #${raid.channelName}` : ""}</div>
                            </div>
                            <Badge tone="accent" className="ov-next-rel">{relativeDayLabel(raid.startTime)}</Badge>
                        </div>
                        <div className="ov-roles">
                            {raid.roles.map((r) => (
                                <div className="ov-role" key={r.key} data-tip={r.label} data-tip-sub={`${r.filled} von ${r.target} besetzt${raid.setupCount ? " laut Setup" : " laut Anmeldungen"}. Soll aus der Raidgröße (${raid.size}).`}>
                                    <WowIcon name={r.icon} size={22} />
                                    <RoleBar role={r} />
                                </div>
                            ))}
                        </div>
                        <div className="ov-next-foot">
                            <SheetBadge raid={raid} />
                            {raid.setupCount
                                ? <Badge tone="ok" icon="inv_misc_groupneedmore" tip="Setup fertig" tipSub={`${raid.setupCount} Spieler im Raidplan gesetzt.`}>Setup fertig</Badge>
                                : <Badge tone="mid" icon="inv_misc_groupneedmore" tip="Setup offen" tipSub="Bei Raid-Helper ist noch kein Raidplan gebaut.">Setup offen</Badge>}
                            {raid.softres
                                ? <Badge tone="ok" icon="inv_scroll_11" tip="Softres-Liste erstellt">Softres</Badge>
                                : <Badge tone="mid" icon="inv_scroll_11" tip="Softres-Liste fehlt" tipSub="Wird auf der Seite des Raid-Events erstellt.">Softres fehlt</Badge>}
                            <span className="ov-links">
                                {guildId && raid.channelId && <IconLink icon="inv_letter_15" href={eventPostUrl(guildId, raid.channelId, raid.id)} tip="Discord-Post" tipSub="Die Anmeldung in Discord öffnen" />}
                                {raidplanUrl(raid.id) && <IconLink icon="inv_misc_groupneedmore" href={raidplanUrl(raid.id)} tip="Setup / Comp" tipSub="Raidplan bei Raid-Helper öffnen" />}
                                {raid.softres && <IconLink icon="inv_scroll_11" href={raid.softres.url} tip="Softres" tipSub="Softres-Liste öffnen" />}
                            </span>
                        </div>
                        {following && (
                            <div className="ov-following">
                                <WowIcon name={following.icon} size={20} />
                                <span>Danach:</span>
                                <Link className="ov-following-t" to={`/raids/detail?event=${encodeURIComponent(following.id)}`}>
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
    const tone = tasks.length ? "mid" : "ok";
    return (
        <section className="dash-card ov-card">
            <PartHead
                icon="inv_misc_note_01" tone={tone} title="Offene Aufgaben"
                action={<Badge tone={tone} count>{tasks.length}</Badge>}
            />
            {tasks.length === 0
                ? (
                    <div className="ov-alldone">
                        <IconTile icon="spell_holy_borrowedtime" tone="ok" size="lg" />
                        <div className="ov-alldone-t">Alles erledigt</div>
                        <div className="ov-note">Sheets gefüllt, Logs zugeordnet, Empfehlungen geprüft.</div>
                    </div>
                )
                : (
                    <div className="ov-rows">
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
    const r = areas.lastReport;
    const reportSub = r
        ? [
            `${r.bosses} ${r.bosses === 1 ? "Boss" : "Bosse"}, ${r.kills} ${r.kills === 1 ? "Kill" : "Kills"}${r.avoidableDeaths !== null ? ` · ${r.avoidableDeaths} vermeidbare Tode` : ""}`,
            `Gear-Probleme: ${r.gear}`,
            `Consumables: ${r.consumables}`,
            `Fehlende Buffs: ${r.buffs}`,
            "Klick öffnet den Report.",
        ].join("\n")
        : "";
    return (
        <div className="ov-grid ov-grid-areas">
            {r
                ? (
                    <AreaTile area="cla" icon="inv_misc_pocketwatch_01" label="Letzte Auswertung" href={`/r/${encodeURIComponent(r.id)}`} tip={`${r.zone || r.title} · ${dayDate(r.generatedAt)}`} tipSub={reportSub}>
                        <span className="ov-area-val">{r.zone || r.title}</span>
                        <span className="ov-badges">
                            <Badge>{shortDate(r.generatedAt)}</Badge>
                            <Badge tone={r.problems ? "bad" : "ok"}>{r.problems ? `${r.problems} Probleme` : "keine Probleme"}</Badge>
                        </span>
                    </AreaTile>
                )
                : (
                    <AreaTile area="cla" icon="inv_misc_pocketwatch_01" label="Letzte Auswertung" href="/cla" tip="Noch keine Auswertung" tipSub="Klick öffnet die Log-Auswertung.">
                        <span className="ov-area-val">Keine</span>
                        <span className="ov-badges"><Badge tone="accent">Log auswerten</Badge></span>
                    </AreaTile>
                )}
            <AreaTile area="history" icon="inv_misc_bag_10" label="Neuer Loot" href="/history?tab=awards" tip="Top-Items seit dem letzten Raid" tipSub={areas.newLoot.since ? `Vergeben seit ${dayDate(areas.newLoot.since)}. Klick öffnet Latest Loot.` : "Noch kein vergangener Raid bekannt."}>
                <span className="ov-area-big">{areas.newLoot.count}</span>
                <span className="ov-badges">
                    <Badge tone="accent">Top-Items</Badge>
                    {areas.newLoot.since > 0 && <Badge>seit {dayDate(areas.newLoot.since).split(" ")[0]}</Badge>}
                </span>
            </AreaTile>
            <AreaTile area="recruitment" icon="inv_misc_grouplooking" label="Recruitment" href="/recruitment" tip="Gepostete Recruitment-Nachrichten" tipSub="Klick öffnet Recruitment.">
                <span className="ov-area-big">{areas.recruitment.posts}</span>
                <span className="ov-badges">
                    {areas.recruitment.posts
                        ? <Badge tone="ok">Posts aktiv</Badge>
                        : <Badge>keine Posts</Badge>}
                </span>
            </AreaTile>
            <AreaTile area="roster" icon="achievement_guildperk_everybodysfriend" label="Roster" href="/roster" tip="Charaktere im Roster" tipSub={areas.roster ? `${areas.roster.withoutDiscord} nur aus dem Loot bekannt, keinem Discord-Konto zugeordnet. Klick öffnet das Roster.` : "Das Roster konnte nicht geladen werden."}>
                <span className="ov-area-big">{areas.roster ? areas.roster.total : "–"}</span>
                <span className="ov-badges">
                    <Badge>Raider</Badge>
                    {areas.roster && areas.roster.withoutDiscord > 0 && <Badge tone="mid">{areas.roster.withoutDiscord} ohne Discord</Badge>}
                </span>
            </AreaTile>
        </div>
    );
}

function LootCard({ topLoot }: { topLoot: DashboardData["topLoot"] }) {
    return (
        <section className="dash-card ov-card">
            <PartHead
                icon="inv_misc_bag_10" tone="history" title="Latest Loot" crumb="Top-Items"
                action={<Link className={buttonClass("ghost", "sm")} to="/history?tab=awards">Historie &amp; Loot</Link>}
            />
            {topLoot.items.length
                ? <TopLootList items={topLoot.items} />
                : (
                    <div className="ov-empty-text">
                        {topLoot.configured
                            ? `Noch keins der ${topLoot.configured} Top-Items vergeben.`
                            : <>Noch keine Top-Items festgelegt – <Link to="/settings?section=loot">Einstellungen → Loot</Link>.</>}
                    </div>
                )}
        </section>
    );
}

function RecentRaidList({ recent }: { recent: DashboardData["recentEvents"] }) {
    return (
        <section className="dash-card ov-card">
            <PartHead
                icon="inv_misc_note_02" title="Letzte Raids"
                action={<Link className={buttonClass("ghost", "sm")} to="/history?tab=raids">Alle Raids</Link>}
            />
            {!recent.events.length
                ? <div className="ov-empty-text">{recent.error || "Noch keine vergangenen Raids."}</div>
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
                                        ? <Badge tone="mid" icon="inv_misc_pocketwatch_01" tip="Log-Zuordnung offen" tipSub="Die Logs passen zu mehreren Raids; auf der Seite des Raids zuordnen.">{pending} {pending === 1 ? "Log" : "Logs"} offen</Badge>
                                        : evaluated
                                            ? <Badge tone="ok" icon="inv_misc_pocketwatch_01">Auswertung</Badge>
                                            : <Badge icon="inv_misc_pocketwatch_01" tip={ev.logs.length ? "Log zugeordnet, noch nicht ausgewertet" : "Kein Log zugeordnet"}>{ev.logs.length ? "nicht ausgewertet" : "kein Log"}</Badge>}
                                    {ev.lootCount
                                        ? <Badge icon="inv_misc_bag_10" tip={`${ev.lootCount} Items importiert`}>{ev.lootCount}</Badge>
                                        : <Badge tone="bad" icon="inv_misc_bag_10" tip="Kein Loot importiert">kein Loot</Badge>}
                                </Link>
                            );
                        })}
                    </div>
                )}
        </section>
    );
}

export default function DashboardPage() {
    const [data, setData] = useState<DashboardData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [detailsOpen, setDetailsOpen] = useState(false);

    useEffect(() => {
        getDashboard()
            .then(setData)
            .catch((err: ApiError) => setError(err));
    }, []);

    if (error) {
        return <div className="empty">Fehler beim Laden der Übersicht: {error.message}</div>;
    }
    if (!data) {
        return <RaidLoader text="Übersicht wird geladen" />;
    }

    const kicker = [data.kicker.guild, data.kicker.realm, longDay(Date.now())].filter(Boolean).join(" · ");

    return (
        <div className="ov-page">
            <PageHead
                icon="inv_misc_map_01" tone="home" kicker={kicker} title="Übersicht"
                action={<Link className={buttonClass("primary", "md", true)} to="/raids/new"><WowIcon name="inv_misc_note_02" size={22} />Raid-Event anlegen</Link>}
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
