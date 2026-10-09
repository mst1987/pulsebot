// The roster overview (#654, epic "Roster je Kategorie", design canvas artboard 1):
// one card per raid roster — its version and raids, the main Discord role, how
// many places are taken, tanks/healers/damage against the plan, the attendance
// and what is still open (without role, without character, on trial). A raid
// category without a roster is a dashed card; creating one comes with #657.
// The character list that used to live here is "Alle Charaktere" (/roster/chars).
import { Link } from "react-router-dom";
import { getRosters, type RosterHead, type RosterOverview } from "../../api";
import { useApi } from "../../hooks/useApi";
import { tParts, useT } from "../../i18n";
import { Badge, IconTile, PageHead, WowIcon, buttonClass } from "../../components/ui";
import RaidLoader from "../../components/ui/RaidLoader";
import { rolePluralLabel } from "../../lib/wow/wowNames";
import { ROLE_ICONS, dpsTarget } from "../../lib/roster/rosters";
import { attendanceTone } from "../../lib/roster/rosterView";
import { RoleChip, VersionLine } from "./RosterParts";
import "../../styles/rosters.css";

/** Tanks, healers or damage of the places against the roster's plan. */
function RoleFigure({ role, count, target }: { role: "tank" | "healer" | "dps"; count: number; target: number }) {
    const t = useT();
    const short = target > 0 && count < target;
    return (
        <div
            className={`rn-fig${short ? " rn-short" : ""}`}
            data-tip={rolePluralLabel(role)}
            data-tip-sub={target > 0 ? t("roster.overview.figureTip", { count, target }) : t("roster.overview.figureNoTarget")}
        >
            <span className="rn-fig-row"><WowIcon name={ROLE_ICONS[role]} size={20} /><span className="rn-kick">{rolePluralLabel(role)}</span></span>
            <b>{count}{target > 0 && <small> {t("roster.overview.of", { target })}</small>}</b>
        </div>
    );
}

/** What is still to do in a roster, as badges; one calm "Nichts offen" when nothing is. */
function TodoBadges({ roster }: { roster: RosterHead }) {
    const t = useT();
    const free = roster.slots.total > 0 ? roster.slots.total - roster.places : 0;
    const badges = [];
    if (free > 0) badges.push(<Badge key="free" tone="bad">{t("roster.overview.freeSlots", { count: free })}</Badge>);
    if (roster.todo.withoutRole) {
        badges.push(<Badge key="role" tone="mid" tipSub={t("roster.overview.withoutRoleSub")} tip={t("roster.overview.withoutRole", { count: roster.todo.withoutRole })}>{t("roster.overview.withoutRole", { count: roster.todo.withoutRole })}</Badge>);
    }
    if (roster.todo.withoutChar) {
        badges.push(<Badge key="char" tone="mid" tipSub={t("roster.overview.withoutCharSub")} tip={t("roster.overview.withoutChar", { count: roster.todo.withoutChar })}>{t("roster.overview.withoutChar", { count: roster.todo.withoutChar })}</Badge>);
    }
    if (roster.todo.trial) badges.push(<Badge key="trial" tone="accent">{t("roster.overview.trial", { count: roster.todo.trial })}</Badge>);
    return <div className="rn-todo">{badges.length ? badges : <Badge tone="ok">{t("roster.overview.allDone")}</Badge>}</div>;
}

function RosterCard({ roster }: { roster: RosterHead }) {
    const t = useT();
    const tone = attendanceTone(roster.attendance);
    const total = roster.slots.total;
    return (
        <li>
            <Link className="rn-panel rn-card" to={`/roster/r/${encodeURIComponent(roster.id)}`}>
                <div className="rn-card-top">
                    <IconTile icon={roster.icon} tone="roster" size="lg" />
                    <div className="rn-card-title">
                        <b>{roster.name}</b>
                        <VersionLine versionId={roster.versionId} parts={[roster.versionLabel, ...(roster.categoryId ? roster.contents : [t("roster.overview.noCategory")])]} />
                    </div>
                </div>
                <div className="rn-card-nums">
                    <div data-tip={t("roster.overview.placesTip")} data-tip-sub={t("roster.overview.placesSub")}>
                        <div className="rn-kick">{t("roster.overview.inRoster")}</div>
                        <div className="rn-big">
                            {roster.places}
                            <small>{total > 0 ? t("roster.overview.ofPlaces", { total }) : t("roster.overview.persons", { count: roster.places })}</small>
                        </div>
                    </div>
                    <div className="rn-card-att">
                        <div className="rn-kick">{t("roster.overview.attendance")}</div>
                        {roster.attendance === null
                            ? <><div className="rn-big rn-tone-none">–</div><div className="rn-sub">{t("roster.overview.noRaids")}</div></>
                            : (
                                <div className={`rn-big${tone ? ` rn-tone-${tone}` : ""}`} data-tip={t("roster.overview.attendance")} data-tip-sub={t("roster.overview.attendanceSub", { count: roster.attendanceCounted })}>
                                    {roster.attendance}<small>%</small>
                                </div>
                            )}
                    </div>
                </div>
                <div className="rn-figs">
                    <RoleFigure role="tank" count={roster.roleCounts.tank} target={roster.slots.tank} />
                    <RoleFigure role="healer" count={roster.roleCounts.healer} target={roster.slots.healer} />
                    <RoleFigure role="dps" count={roster.roleCounts.dps} target={dpsTarget(roster.slots)} />
                </div>
                <TodoBadges roster={roster} />
                <div className="rn-card-foot">
                    <RoleChip role={roster.mainRole} />
                    <span className={buttonClass("ghost", "sm", false, "rn-open")}>{t("roster.overview.open")}</span>
                </div>
            </Link>
        </li>
    );
}

/** A raid category without a roster: a dashed card. Creating the roster comes with #657. */
function EmptyCategoryCard({ category }: { category: RosterOverview["categoriesWithoutRoster"][number] }) {
    const t = useT();
    return (
        <li className="rn-card rn-card-empty">
            <div className="rn-card-top">
                <IconTile icon="inv_misc_note_02" tone="none" size="lg" />
                <div className="rn-card-title">
                    <b>{category.name}</b>
                    <VersionLine versionId={category.versionId} parts={[category.versionLabel]} />
                </div>
            </div>
            <p className="rn-sub">{t("roster.overview.emptyCategory")}</p>
        </li>
    );
}

export default function RostersPage() {
    const t = useT();
    const state = useApi(() => getRosters(), []);
    if (state.error) return <div className="empty">{tParts("roster.overview.loadError", { message: state.error.message })}</div>;
    const data = state.data;
    if (!data) return <RaidLoader text={t("roster.overview.loading")} />;

    const kicker = [t("roster.overview.kicker", { count: data.rosters.length })];
    if (data.categoriesWithoutRoster.length) kicker.push(t("roster.overview.kickerWithout", { count: data.categoriesWithoutRoster.length }));

    return (
        <div className="rn-page">
            <PageHead
                icon="achievement_guildperk_everybodysfriend"
                tone="roster"
                kicker={kicker.join(" · ")}
                title={t("roster.overview.title")}
                action={(
                    <Link className={buttonClass("ghost")} to="/roster/chars" data-tip={t("roster.overview.allCharsTip")} data-tip-sub={t("roster.overview.allCharsSub")}>
                        {t("roster.overview.allChars")}
                    </Link>
                )}
            />
            {!data.rosters.length && !data.categoriesWithoutRoster.length
                ? <p className="rn-empty">{t("roster.overview.empty")}</p>
                : (
                    <ul className="rn-cards" aria-label={t("roster.overview.cardsAria")}>
                        {data.rosters.map((r) => <RosterCard key={r.id} roster={r} />)}
                        {data.categoriesWithoutRoster.map((c) => <EmptyCategoryCard key={c.id} category={c} />)}
                    </ul>
                )}
        </div>
    );
}
