import { useCallback } from "react";
import { searchProfileItems, type ItemSearchResult, type ProfessionList, type ProfileProfession, type ProfileWishItem } from "../../api";
import { Badge, IconButton, WowIcon } from "../../components/ui";
import ItemSearchPicker from "../../components/loot/ItemSearchPicker";
import { ItemIcon } from "../../components/loot/LootBadges";
import { EyeOffIcon, XIcon } from "../../components/ui/icons";
import { itemQualityProps } from "../../lib/wow/itemQuality";
import { getLang, useT } from "../../i18n";
import { type Fold, FoldPart, Stepper } from "./ProfileParts";

// The freely given parts of a character's tab (Mein Profil, part 2;
// docs/roster-profile.md): "Berufe" in the left column under the roster,
// "Wunsch-Items" in the right one under the loot. Nothing here is asked of the
// raider - both say so when empty - and every change saves itself through the
// page's `patch` (PUT /api/profile, `characters[].professions` / `.wishItems`).

/** Skill steps of − and +: five points (a profession's skill rises in single points, five keep the clicks few). */
const SKILL_STEP = 5;

/** The name of a profession in the page's language. */
const professionName = (p: ProfessionList["professions"][number]) => (getLang() === "de" ? p.label : p.labelEn);

/**
 * "Berufe": at most `max` main professions of the version's list, each with its
 * skill as − / + where the rule set names a highest skill. Rendered only for a
 * version with a list.
 */
export function ProfessionsPart({ name, list, chosen, max, fold, onFold, onChange }: {
    name: string;
    list: ProfessionList;
    chosen: ProfileProfession[];
    max: number;
    fold: Fold[];
    onFold: (id: Fold) => void;
    onChange: (next: ProfileProfession[]) => void;
}) {
    const t = useT();
    const byId = new Map(list.professions.map((p) => [p.id, p]));
    const label = (id: string) => (byId.has(id) ? professionName(byId.get(id)!) : id);
    const summary = chosen.length
        ? chosen.map((p) => (p.skill !== null && list.skillMax ? t("profile.prof.withSkill", { name: label(p.id), skill: p.skill }) : label(p.id))).join(" · ")
        : t("profile.prof.none");
    const setSkill = (id: string, skill: number) => onChange(chosen.map((p) => (p.id === id ? { ...p, skill } : p)));
    return (
        <FoldPart
            id="professions" open={fold} onToggle={onFold} title={t("profile.fold.professions")} summary={summary}
            badge={<Badge tip={t("profile.prof.freeTip")} tipSub={t("profile.prof.freeSub")}>{t("profile.prof.free")}</Badge>}
        >
            {chosen.length === 0 && <p className="pf-muted">{t("profile.prof.invite", { max })}</p>}
            {chosen.map((p) => {
                const skill = p.skill ?? 0;
                const skillMax = list.skillMax;
                const info = byId.get(p.id);
                return (
                    <div key={p.id} className="pf-prof">
                        {info?.icon && <WowIcon name={info.icon} size={26} />}
                        <b className="pf-prof-name">{label(p.id)}</b>
                        {skillMax && (
                            <Stepper
                                label={t("profile.prof.skillAria", { name: label(p.id) })}
                                value={t("profile.prof.skill", { skill, max: skillMax })}
                                lessTip={t("profile.prof.less")}
                                moreTip={t("profile.prof.more")}
                                onLess={skill > 0 ? () => setSkill(p.id, Math.max(0, skill - SKILL_STEP)) : undefined}
                                onMore={skill < skillMax ? () => setSkill(p.id, Math.min(skillMax, skill + SKILL_STEP)) : undefined}
                            />
                        )}
                        <IconButton size="sm" icon={<XIcon />} tip={t("profile.prof.remove", { name: label(p.id) })} onClick={() => onChange(chosen.filter((x) => x.id !== p.id))} />
                    </div>
                );
            })}
            {chosen.length < max && (
                <div className="pf-prof-pick" role="group" aria-label={t("profile.prof.pickAria", { name })}>
                    {list.professions.filter((p) => !chosen.some((c) => c.id === p.id)).map((p) => (
                        <button key={p.id} type="button" className="pf-raid" aria-pressed={false}
                            onClick={() => onChange([...chosen, { id: p.id, skill: list.skillMax ? 0 : null }])}>
                            {p.icon && <WowIcon name={p.icon} size={20} />}
                            {professionName(p)}
                        </button>
                    ))}
                </div>
            )}
        </FoldPart>
    );
}

/**
 * "Wunsch-Items": up to `max` items of the version, found through its Wowhead
 * suggestions. Only the raider and the orga read them ("nur Orga"); shown only
 * for a character of a Loot-Council roster.
 */
export function WishItemsPart({ versionId, items, max, fold, onFold, onChange }: {
    versionId: string;
    items: ProfileWishItem[];
    max: number;
    fold: Fold[];
    onFold: (id: Fold) => void;
    /** The item ids in their order - the server looks new ones up on the version's Wowhead. */
    onChange: (ids: number[]) => void;
}) {
    const t = useT();
    const search = useCallback((q: string) => searchProfileItems(q, versionId), [versionId]);
    const ids = items.map((w) => w.itemId);
    const summary = items.length
        ? `${t("profile.wishItems.count", { count: items.length, max })} · ${items.map((w) => w.name).join(", ")}`
        : t("profile.wishItems.none");
    return (
        <FoldPart
            id="wishItems" open={fold} onToggle={onFold} title={t("profile.fold.wishItems")} summary={summary}
            badge={<Badge icon={<EyeOffIcon />} tip={t("profile.fold.orgaOnlyTip")} tipSub={t("profile.wishItems.orgaOnlySub")}>{t("profile.fold.orgaOnly")}</Badge>}
        >
            {items.length === 0 && <p className="pf-muted">{t("profile.wishItems.invite", { max })}</p>}
            {items.length > 0 && (
                <ul className="pf-loot">
                    {items.map((w) => (
                        <li key={w.itemId} className="pf-loot-row">
                            <ItemIcon url={w.iconUrl} quality={w.quality} />
                            <span className="pf-loot-main">
                                {w.link
                                    ? <a {...itemQualityProps(w.quality, "pf-loot-name")} href={w.link} target="_blank" rel="noopener noreferrer">{w.name}</a>
                                    : <span {...itemQualityProps(w.quality, "pf-loot-name")}>{w.name}</span>}
                            </span>
                            <IconButton size="sm" icon={<XIcon />} tip={t("profile.wishItems.remove", { name: w.name })}
                                onClick={() => onChange(ids.filter((id) => id !== w.itemId))} />
                        </li>
                    ))}
                </ul>
            )}
            {items.length < max
                ? <ItemSearchPicker search={search} placeholder={t("profile.wishItems.search")}
                    onPick={(it: ItemSearchResult) => { if (!ids.includes(it.id)) onChange([...ids, it.id]); }} />
                : <p className="pf-muted">{t("profile.wishItems.full", { max })}</p>}
            <p className="hint">{t("profile.wishItems.hint")}</p>
        </FoldPart>
    );
}
