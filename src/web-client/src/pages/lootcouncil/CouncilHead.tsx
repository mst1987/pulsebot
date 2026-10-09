// Who the council works for (#676): ONE picker - the rosters with loot system
// Loot-Council first, the raid categories without roster as the fallback,
// "Alle Raid-Kategorien" on top - and next to it what that pick means: its
// Loot-Council profile (weighting and view) and, for a roster, the linked
// Kader, with "Zum Roster" / "Zum Kader" for whoever may open them.
import { Link } from "react-router-dom";
import type { CouncilHead as Head } from "../../api";
import { Badge, buttonClass } from "../../components/ui";
import { useT } from "../../i18n";
import { pickFields } from "./profiles";

export function CouncilHead({ head, value, onPick, onProfiles }: {
    head: Head;
    /** The current pick (pickValue). */
    value: string;
    onPick: (fields: { roster: string; category: string }) => void;
    /** Open the profile tab on this council's profile. */
    onProfiles: () => void;
}) {
    const t = useT();
    const roster = head.roster;
    const known = value === "" || head.rosters.some((r) => `roster:${r.id}` === value) || head.categories.some((c) => `category:${c.id}` === value);
    const profileTip = head.profile.source === "roster"
        ? t("lootcouncil.head.profileFromRoster")
        : head.profile.source === "category" ? t("lootcouncil.head.profileFromCategory") : t("lootcouncil.head.profileDefault");
    return (
        <section className="lc-head" aria-label={t("lootcouncil.head.label")}>
            <div className="lc-head-pick">
                <label className="kicker" htmlFor="lc-head-pick">{t("lootcouncil.head.pick")}</label>
                <select id="lc-head-pick" className="lc-sel lc-head-sel" value={value} onChange={(e) => onPick(pickFields(e.target.value))}>
                    <option value="">{t("lootcouncil.filter.allCategories")}</option>
                    {!known ? <option value={value}>{t("lootcouncil.head.unknownPick")}</option> : null}
                    {head.rosters.length ? (
                        <optgroup label={t("lootcouncil.head.rosters")}>
                            {head.rosters.map((r) => (
                                <option key={r.id} value={`roster:${r.id}`}>
                                    {r.categoryName ? t("lootcouncil.head.rosterOption", { name: r.name, category: r.categoryName }) : r.name}
                                </option>
                            ))}
                        </optgroup>
                    ) : null}
                    {head.categories.length ? (
                        <optgroup label={t("lootcouncil.head.categories")}>
                            {head.categories.map((c) => <option key={c.id} value={`category:${c.id}`}>{c.name}</option>)}
                        </optgroup>
                    ) : null}
                </select>
            </div>
            <div className="lc-head-facts">
                {roster ? (
                    <div className="lc-head-fact">
                        <span className="kicker">{t("lootcouncil.head.roster")}</span>
                        <b>{roster.name}</b>
                        {roster.categoryName ? <span className="lc-muted">{roster.categoryName}</span> : null}
                    </div>
                ) : null}
                <div className="lc-head-fact">
                    <span className="kicker">{t("lootcouncil.head.profile")}</span>
                    <button type="button" className="lc-head-profile" data-tip={t("lootcouncil.head.profileTip", { name: head.profile.name })} data-tip-sub={profileTip} onClick={onProfiles}>
                        <b>{head.profile.name}</b>
                    </button>
                    {head.profile.isDefault ? <Badge size="sm">{t("lootcouncil.profiles.default")}</Badge> : null}
                </div>
                {roster && roster.kaderId && head.canOpenKader ? (
                    <div className="lc-head-fact">
                        <span className="kicker">{t("lootcouncil.head.kader")}</span>
                        <b>{roster.kaderName || t("lootcouncil.head.kaderUnnamed")}</b>
                    </div>
                ) : null}
            </div>
            {roster ? (
                <div className="lc-head-links">
                    {head.canOpenRoster ? (
                        <Link className={buttonClass("ghost", "sm")} to={`/roster/r/${encodeURIComponent(roster.id)}`}>{t("lootcouncil.head.toRoster")}</Link>
                    ) : null}
                    {roster.kaderId && head.canOpenKader ? (
                        <Link className={buttonClass("ghost", "sm")} to={`/kader/${encodeURIComponent(roster.kaderId)}/roster`}>{t("lootcouncil.head.toKader")}</Link>
                    ) : null}
                </div>
            ) : null}
        </section>
    );
}
