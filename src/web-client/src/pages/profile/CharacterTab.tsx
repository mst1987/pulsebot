import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ProfileDungeons, ProfileLoot, ProfileRosterMembership } from "../../api";
import { Badge, buttonClass, WowIcon } from "../../components/ui";
import { reasonToneClass } from "../../components/loot/LootBadges";
import { formatDayDate } from "../../lib/format";
import { itemQualityColor, itemQualityProps } from "../../lib/wow/itemQuality";
import { locale, useT } from "../../i18n";
import { formatSeconds } from "../dungeons/dungeonView";
import { type Fold, FoldPart } from "./ProfileParts";

// The parts under a character's card on its tab of "Mein Profil": the roster,
// the loot and - only where the LevelHelper addon reported the character (WoW
// Forever) - the dungeon runs. Each a calm fold with a one-line summary; the
// data comes from GET /api/profile/raiding (services/characters/profileRaiding.js),
// read only. No gear, no item level: the card's "Armory" button is the way there.

/** "loading" while the request runs, "failed" when it did not come back, else the data. */
export type Loaded<T> = T | "loading" | "failed";

const isReady = <T,>(v: Loaded<T>): v is T => v !== "loading" && v !== "failed";

/** 1240 -> "1.240" / "1,240". */
const num = (n: number) => n.toLocaleString(locale());

const dateOf =(iso: string | null) => (iso ? formatDayDate(Date.parse(iso)) : "");

function useStateLine() {
    const t = useT();
    return (v: Loaded<unknown>) => (v === "loading" ? t("profile.fold.loading") : t("profile.fold.loadError"));
}

/** "Im Roster": the status per roster of the version, this character's or another of the raider's. */
export function RosterPart({ charKey, rosters, fold, onFold }: { charKey: string; rosters: Loaded<ProfileRosterMembership[]>; fold: Fold; onFold: (f: Fold) => void }) {
    const t = useT();
    const stateLine = useStateLine();
    const list = isReady(rosters) ? rosters : [];
    const own = list.filter((r) => r.chars.includes(charKey));
    const others = list.filter((r) => !r.chars.includes(charKey));
    const summary = !isReady(rosters) ? stateLine(rosters)
        : own.length ? own.map((r) => `${t(`roster.status.${r.status}`)} · ${r.name}`).join(", ")
            : others.length ? t("profile.roster.sumOther") : t("profile.roster.none");
    return (
        <FoldPart id="roster" open={fold} onOpen={onFold} title={t("profile.fold.roster")} summary={summary}>
            {!isReady(rosters) ? <p className="pf-muted">{stateLine(rosters)}</p> : list.length === 0 ? <p className="pf-muted">{t("profile.roster.none")}</p> : (
                <>
                    {[...own, ...others].map((r) => {
                        const mine = r.chars.includes(charKey);
                        const names = r.chars.map((k) => r.charNames[k] || k).join(", ");
                        const meta = [
                            r.since ? t("profile.roster.since", { date: dateOf(r.since) }) : "",
                            r.status === "trial" && r.trialUntil ? t("profile.roster.trialUntil", { date: dateOf(r.trialUntil) }) : "",
                            mine ? t("profile.roster.thisChar") : names ? t("profile.roster.otherChar", { names }) : "",
                        ].filter(Boolean).join(" · ");
                        return (
                            <div key={r.id} className={`pf-roster${mine ? "" : " is-other"}`}>
                                <span className="kicker">{r.name}</span>
                                <div className="pf-roster-line">
                                    <b className="pf-roster-status tipped" tabIndex={0} data-tip={t(`roster.status.${r.status}`)} data-tip-sub={t(`roster.statusSub.${r.status}`)}>
                                        {t(`roster.status.${r.status}`)}
                                    </b>
                                    {mine && r.spec && (
                                        <span className="pf-roster-spec">
                                            <WowIcon name={r.spec.icon || "inv_misc_questionmark"} size={20} />
                                            {t("profile.roster.spec", { spec: r.spec.label })}
                                        </span>
                                    )}
                                </div>
                                {meta && <span className="pf-muted">{meta}</span>}
                            </div>
                        );
                    })}
                    <p className="pf-muted pf-roster-note">{t("profile.roster.readOnly")}</p>
                </>
            )}
        </FoldPart>
    );
}

/** "Loot": what this character received in raids of the version, the newest few, the rest in the history. */
export function LootPart({ name, loot, fold, onFold, historyLink }: {
    name: string;
    loot: Loaded<ProfileLoot>;
    fold: Fold;
    onFold: (f: Fold) => void;
    /** Whether the caller may open the loot history (areas history or loot). */
    historyLink: boolean;
}) {
    const t = useT();
    const stateLine = useStateLine();
    const summary = !isReady(loot) ? stateLine(loot)
        : loot.count ? t("profile.loot.sum", { count: loot.count, date: formatDayDate(loot.lastAt) }) : t("profile.loot.none");
    return (
        <FoldPart id="loot" open={fold} onOpen={onFold} title={t("profile.fold.loot")} summary={summary}>
            {!isReady(loot) ? <p className="pf-muted">{stateLine(loot)}</p> : !loot.count ? <p className="pf-muted">{t("profile.loot.none")}</p> : (
                <>
                    <ul className="pf-loot">
                        {loot.items.map((it, i) => {
                            const label = it.itemName || t("profile.loot.itemFallback", { id: it.itemId });
                            const where = [it.boss, it.eventLabel, it.awardedAt ? formatDayDate(it.awardedAt) : ""].filter(Boolean).join(" · ");
                            // the award reason as the history writes it: the loot tool's word, coloured by its bucket
                            const reason = it.response || it.reasonLabel || (it.offspec ? "Off Spec" : "Main Spec");
                            const frame = itemQualityColor(it.itemQuality);
                            const icoStyle = frame ? ({ "--iqb": frame } as CSSProperties) : undefined;
                            return (
                                <li key={`${it.itemId}-${it.awardedAt}-${i}`} className="pf-loot-row">
                                    {it.itemIconUrl
                                        ? <img className="pf-loot-ico" src={it.itemIconUrl} alt="" loading="lazy" style={icoStyle} />
                                        : <span className="pf-loot-ico" style={icoStyle} />}
                                    <span className="pf-loot-main">
                                        {it.itemLink
                                            ? <a {...itemQualityProps(it.itemQuality, "pf-loot-name")} href={it.itemLink} target="_blank" rel="noopener noreferrer">{label}</a>
                                            : <span {...itemQualityProps(it.itemQuality, "pf-loot-name")}>{label}</span>}
                                        {where && <span className="pf-muted">{where}</span>}
                                    </span>
                                    <span className={reasonToneClass(it.reasonTone)} data-tip={it.reasonLabel && it.reasonLabel !== reason ? it.reasonLabel : undefined}>{reason}</span>
                                </li>
                            );
                        })}
                    </ul>
                    {historyLink && (
                        <Link className={buttonClass("ghost", "sm", false, "pf-fold-link")} to={`/history/char?name=${encodeURIComponent(name)}`}>
                            {t("profile.loot.history", { count: loot.count })}
                        </Link>
                    )}
                </>
            )}
        </FoldPart>
    );
}

/** A medal as a small square in its colour plus the word. */
function MedalMark({ medal }: { medal: "gold" | "silver" | "bronze" }) {
    const t = useT();
    return <span className="pf-medal" data-medal={medal}><i aria-hidden="true" />{t(`dungeons.medal.${medal}`)}</span>;
}

function Tile({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="pf-tile">
            <span className="kicker">{label}</span>
            {children}
        </div>
    );
}

/**
 * "Dungeon-Bestzeiten": the LevelHelper data of this character - points with
 * their place, medals, the fastest run per dungeon. The caller renders it only
 * when there is data (`dungeons` not null): no empty state, no block in TBC.
 */
export function DungeonPart({ dungeons, fold, onFold }: { dungeons: ProfileDungeons; fold: Fold; onFold: (f: Fold) => void }) {
    const t = useT();
    const summary = [
        dungeons.points !== null ? t("profile.dungeons.pointsSum", { points: num(dungeons.points) }) : "",
        t("profile.dungeons.runs", { count: dungeons.runs }),
        dungeons.medals.gold ? t("profile.dungeons.medal", { count: dungeons.medals.gold, medal: t("dungeons.medal.gold") }) : "",
    ].filter(Boolean).join(" · ");
    return (
        <FoldPart
            id="dungeons" open={fold} onOpen={onFold} title={t("profile.fold.dungeons")} summary={summary}
            badge={<Badge tip={t("profile.dungeons.badgeTip")} tipSub={t("profile.dungeons.badgeSub")}>{t("profile.dungeons.badge")}</Badge>}
        >
            <div className="pf-tiles">
                <Tile label={t("profile.dungeons.points")}>
                    <b className="pf-big">{dungeons.points !== null ? num(dungeons.points) : "–"}</b>
                    <span className="pf-muted">
                        {dungeons.pointsRank !== null ? t("profile.dungeons.pointsRank", { rank: dungeons.pointsRank, count: dungeons.characters }) : t("profile.dungeons.pointsNone")}
                    </span>
                </Tile>
                <Tile label={t("profile.dungeons.medals")}>
                    <span className="pf-medals">
                        {(["gold", "silver", "bronze"] as const).map((m) => (
                            <span key={m} className="pf-medal-count"><MedalMark medal={m} /><b>{dungeons.medals[m]}</b></span>
                        ))}
                    </span>
                    <span className="pf-muted">{t("profile.dungeons.fromRuns", { count: dungeons.runs })}</span>
                </Tile>
            </div>
            {dungeons.best.length > 0 && (
                <div className="pf-runs">
                    <span className="kicker">{t("profile.dungeons.fastest")}</span>
                    {dungeons.best.map((r) => {
                        const meta = [
                            r.place === 1 ? t("profile.dungeons.record") : t("profile.dungeons.place", { place: r.place }),
                            r.others ? t("profile.dungeons.withOthers", { count: r.others }) : t("profile.dungeons.solo"),
                            r.finishedAt ? formatDayDate(r.finishedAt) : "",
                        ].filter(Boolean).join(" · ");
                        return (
                            <div key={r.dungeon} className="pf-run">
                                {r.medal ? <MedalMark medal={r.medal} /> : <span className="pf-medal pf-medal-none" data-tip={t("dungeons.medal.noneTip")}>{t("dungeons.medal.none")}</span>}
                                <span className="pf-run-main"><b>{r.dungeon}</b><span className="pf-muted">{meta}</span></span>
                                <b className="pf-run-time">{formatSeconds(r.seconds)}</b>
                            </div>
                        );
                    })}
                </div>
            )}
            <Link className={buttonClass("ghost", "sm", false, "pf-fold-link")} to="/roster/dungeons">{t("profile.dungeons.open")}</Link>
        </FoldPart>
    );
}
