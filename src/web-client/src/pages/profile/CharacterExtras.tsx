import { useCallback } from "react";
import { searchProfileItems, type ItemSearchResult, type ProfessionList, type ProfileProfession, type ProfileWishItem } from "../../api";
import { Badge, Chip, IconButton, NumberStepper, WowIcon } from "../../components/ui";
import ItemSearchPicker from "../../components/loot/ItemSearchPicker";
import { ItemIcon } from "../../components/loot/LootBadges";
import { EyeOffIcon, SearchIcon, XIcon } from "../../components/ui/icons/icons";
import { itemQualityProps } from "../../lib/wow/itemQuality";
import { useLang, useT, type Lang } from "../../i18n";
import { type Fold, FoldPart } from "./ProfileParts";

// The freely given parts of a character's tab (Mein Profil, part 2;
// docs/roster-profile.md): "Berufe" in the left column under the roster,
// "Wunsch-Items" in the right one under the loot. Nothing here is asked of the
// raider - both say so when empty - and every change saves itself through the
// page's `patch` (PUT /api/profile, `characters[].professions` / `.wishItems`).

/** Skill steps of − and +: five points (a profession's skill rises in single points, five keep the clicks few). */
const SKILL_STEP = 5;

/** The name of a profession in the page's language (`useLang()`, so a switch of the language draws it again). */
const professionName = (p: ProfessionList["professions"][number], lang: Lang) => (lang === "de" ? p.label : p.labelEn);

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
    const lang = useLang();
    const byId = new Map(list.professions.map((p) => [p.id, p]));
    const label = (id: string) => (byId.has(id) ? professionName(byId.get(id)!, lang) : id);
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
            {chosen.length > 0 && (
                <ul className="pf-prof-list">
                    {chosen.map((p) => {
                        const skillMax = list.skillMax;
                        const info = byId.get(p.id);
                        return (
                            // one row per profession: its icon, its name, the skill as one − value + control (also typed), × quiet beside it
                            <li key={p.id} className="pf-prof">
                                <WowIcon name={info?.icon || "inv_misc_questionmark"} size={30} />
                                <b className="pf-prof-name">{label(p.id)}</b>
                                {skillMax && (
                                    <span className="pf-prof-skill">
                                        <NumberStepper
                                            value={p.skill ?? skillMax} min={0} max={skillMax} step={SKILL_STEP} editable commit="blur"
                                            ariaLabel={t("profile.prof.skillAria", { name: label(p.id) })}
                                            lessLabel={t("profile.prof.less")} moreLabel={t("profile.prof.more")}
                                            onChange={(n) => setSkill(p.id, n)}
                                        />
                                        <span className="pf-prof-max">{t("profile.prof.ofMax", { max: skillMax })}</span>
                                    </span>
                                )}
                                <IconButton tone="ghost" icon={<XIcon />} tip={t("profile.prof.remove", { name: label(p.id) })} onClick={() => onChange(chosen.filter((x) => x.id !== p.id))} />
                            </li>
                        );
                    })}
                </ul>
            )}
            {chosen.length < max && (
                <div className="chip-row pf-prof-pick" role="group" aria-label={t("profile.prof.pickAria", { name })}>
                    {list.professions.filter((p) => !chosen.some((c) => c.id === p.id)).map((p) => (
                        // a new profession starts at the version's highest skill - most raiders have theirs maxed
                        <Chip key={p.id} pressed={false} icon={<WowIcon name={p.icon || "inv_misc_questionmark"} size={20} />}
                            onClick={() => onChange([...chosen, { id: p.id, skill: list.skillMax }])}>
                            {professionName(p, lang)}
                        </Chip>
                    ))}
                </div>
            )}
        </FoldPart>
    );
}

/** A found item as a wish item to show at once - the server's answer replaces it (looked up on the version's Wowhead). */
function wishItemFromHit(hit: ItemSearchResult): ProfileWishItem {
    return { itemId: hit.id, name: hit.name, icon: "", iconUrl: hit.iconUrl || "", quality: hit.quality ?? null, link: "" };
}

/**
 * "Wunsch-Items": up to `max` items of the version, found through its Wowhead
 * suggestions. Only the raider and the orga read them ("nur Orga"). Shown for a
 * character of a Loot-Council roster (`canAdd`) - and for one that left it but
 * still has items, then only to read and take out, with a calm word why.
 */
export function WishItemsPart({ versionId, items, max, canAdd, rosterKnown, fold, onFold, onChange }: {
    versionId: string;
    items: ProfileWishItem[];
    max: number;
    /** The character is in a Loot-Council roster of its version: new items may be added. */
    canAdd: boolean;
    /** The roster answer is in - only then may the page say the character is in no Loot-Council roster. */
    rosterKnown: boolean;
    fold: Fold[];
    onFold: (id: Fold) => void;
    /** The whole new list - a found item is in it at once, the page saves and takes the server's answer. */
    onChange: (next: ProfileWishItem[]) => void;
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
            {items.length === 0 && canAdd && <p className="pf-muted">{t("profile.wishItems.invite", { max })}</p>}
            {items.length > 0 && (
                <ul className="pf-wish-items">
                    {items.map((w) => (
                        // one row per item: its icon framed in its quality, the name in its quality colour (Wowhead tooltip), × quiet beside it
                        <li key={w.itemId} className="pf-wish-row">
                            <ItemIcon url={w.iconUrl} quality={w.quality} size="md" />
                            <span className="pf-wish-main">
                                {w.link
                                    ? <a {...itemQualityProps(w.quality, "pf-wish-name")} href={w.link} target="_blank" rel="noopener noreferrer">{w.name}</a>
                                    : <span {...itemQualityProps(w.quality, "pf-wish-name")}>{w.name}</span>}
                            </span>
                            <IconButton tone="ghost" icon={<XIcon />} tip={t("profile.wishItems.remove", { name: w.name })}
                                onClick={() => onChange(items.filter((x) => x.itemId !== w.itemId))} />
                        </li>
                    ))}
                </ul>
            )}
            {!canAdd
                ? rosterKnown && <p className="pf-muted">{t("profile.wishItems.readOnly")}</p>
                : items.length < max
                    ? (
                        // a search field that looks like one: the magnifier inside its frame
                        <div className="pf-wish-search">
                            <SearchIcon />
                            <ItemSearchPicker search={search} placeholder={t("profile.wishItems.search")}
                                onPick={(it: ItemSearchResult) => { if (!ids.includes(it.id)) onChange([...items, wishItemFromHit(it)]); }} />
                        </div>
                    )
                    : <p className="pf-muted">{t("profile.wishItems.full", { max })}</p>}
            {canAdd && <p className="hint">{t("profile.wishItems.hint")}</p>}
        </FoldPart>
    );
}
