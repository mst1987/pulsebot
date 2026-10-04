import { Fragment, useCallback, useEffect, useState } from "react";
import { getRaiderCharacters, type Category, type Role } from "../../api";
import { usePersistedState } from "../../lib/persistedState";
import {
    categoryRows, splitCategoryRows, summarizeRaiderChars, signupNoteMode, planningOf,
    type CategoryRow, type RaiderCharSummary,
} from "../../lib/settingsLogic";
import { tParts, useT } from "../../i18n";
import Badge from "../../components/ui/Badge";
import Expand from "../../components/ui/Expand";
import PartHead from "../../components/ui/PartHead";
import Segment from "../../components/ui/Segment";
import RaiderCharactersModal from "./RaiderCharactersModal";
import CategoryDetail, { type CategorySettings, type CategoryTab } from "./CategoryDetail";
import { WarnIcon } from "../../components/settings/settingsUi";

// Everything that is configured *per raid category*, as one list instead of a
// card per Discord category: active switch, raider roles, where new events are
// created (Raid-Helper / EventHelper), loot addon, how the raids are planned
// (raid plan or sheet) and the raider → character assignment, which used to be
// a section of its own with a second category picker. One row opens at a time;
// its settings sit in four tabs (CategoryDetail.tsx).
//
// The guild's Discord holds far more categories than raid ones (typically 13 of
// 17 are not), so the inactive ones fold away under one line; the part head's
// segment shows them all. A configured id Discord no longer knows stays visible
// with a `bad` badge — dropping it would delete its settings on the next save.

export type { CategorySheet, CategoryRaidTemplates } from "./CategoryDetail";

export default function CategoryMatrix(props: CategorySettings & {
    categories: Category[];
    roles: Role[];
    categoryIds: string[];
    onToggleCategory: (id: string) => void;
    icon: string;
    crumb: string;
}) {
    const {
        categories, roles, categoryIds, categoryRoles, categoryLootTool, categorySignupSource = {}, signupSourceDefault = "raidhelper",
        categorySetupDms = {}, categoryAnnounce = {}, categorySheets, categoryPlanning = {}, savedCategoryRoles,
        categoryDiscordEvent = {}, categoryVoiceChannel = {}, categoryLootSystem = {}, categorySignupNotes = {}, categorySignupNoteChannel = {},
        onToggleCategory, icon, crumb,
    } = props;
    const t = useT();
    const [showAll, setShowAll] = usePersistedState("settings-categories-all", false);
    const [openId, setOpenId] = useState("");
    // The open tab of each category's card; the first one until another is picked.
    // Remembered like every tab of the menu, so reopening a card lands where one worked last.
    const [tabs, setTabs] = usePersistedState<Record<string, CategoryTab>>("settings-category-tabs", {});
    const [foldOpen, setFoldOpen] = useState(false);
    const [assigning, setAssigning] = useState<CategoryRow | null>(null);
    const [chars, setChars] = useState<Record<string, RaiderCharSummary>>({});

    const configured = [
        ...categoryIds,
        ...Object.keys(categoryRoles),
        ...Object.keys(categoryLootTool),
        ...Object.keys(categoryLootSystem).filter((id) => categoryLootSystem[id]),
        ...Object.keys(categorySignupSource),
        ...Object.keys(categorySetupDms).filter((id) => categorySetupDms[id]),
        ...Object.keys(categoryDiscordEvent).filter((id) => categoryDiscordEvent[id]),
        ...Object.keys(categoryVoiceChannel).filter((id) => categoryVoiceChannel[id]),
        ...Object.keys(categoryAnnounce).filter((id) => categoryAnnounce[id] && categoryAnnounce[id].enabled),
        ...Object.keys(categorySignupNotes).filter((id) => signupNoteMode(categorySignupNotes, id) !== "optional"),
        ...Object.keys(categorySignupNoteChannel).filter((id) => categorySignupNoteChannel[id]),
        ...Object.keys(categorySheets),
        ...Object.keys(categoryPlanning),
    ];
    const rows = categoryRows(categories, configured);
    const { shown, folded } = splitCategoryRows(rows, categoryIds, showAll);
    // Only roles whose name says "raid" are offered — plus any already assigned —
    // to keep a guild's dozens of cosmetic roles out of the picker.
    const roleOptions = (catId: string) => {
        const assigned = new Set(categoryRoles[catId] || []);
        return roles.filter((r) => /raid/i.test(r.name || "") || assigned.has(r.id));
    };

    // The "22 / 25" of every category that has saved raider roles. One request
    // per category, best-effort: a failure leaves the cell at "–".
    const savedKey = JSON.stringify(savedCategoryRoles);
    const loadChars = useCallback((ids: string[]) => {
        for (const id of ids) {
            getRaiderCharacters(id)
                .then((info) => setChars((prev) => ({ ...prev, [id]: summarizeRaiderChars(info) })))
                .catch(() => undefined);
        }
    }, []);
    useEffect(() => {
        const withRoles = Object.entries(JSON.parse(savedKey) as Record<string, string[]>)
            .filter(([, ids]) => ids && ids.length)
            .map(([id]) => id);
        loadChars(withRoles);
    }, [savedKey, loadChars]);

    const activeCount = categoryIds.filter((id) => rows.some((r) => r.id === id)).length;
    // #291: the raid categories whose new events still go to Raid-Helper — one
    // badge in the head, the names in its tooltip, the way out in Verbindungen.
    const stillRaidhelper = rows.filter((r) => categoryIds.includes(r.id) && (categorySignupSource[r.id] || signupSourceDefault) === "raidhelper");

    const partHead = (
        <PartHead
            icon={icon}
            tone="settings"
            title={t("settings.sections.kategorien.label")}
            crumb={stillRaidhelper.length ? (
                <>
                    {`${t("settings.crumb", { crumb })} `}
                    <Badge
                        tone="mid"
                        icon={<WarnIcon />}
                        tip={t("settings.categories.stillRhTip", { count: stillRaidhelper.length })}
                        tipSub={t("settings.categories.stillRhSub", { names: stillRaidhelper.map((r) => r.name).join(", ") })}
                    >
                        {tParts("settings.categories.stillRh", { count: stillRaidhelper.length })}
                    </Badge>
                </>
            ) : t("settings.crumb", { crumb })}
            action={(
                <Segment
                    size="sm"
                    ariaLabel={t("settings.categories.whichAria")}
                    value={showAll ? "all" : "raid"}
                    onChange={(v) => setShowAll(v === "all")}
                    options={[
                        { value: "raid", label: t("settings.categories.raidOnes", { count: activeCount }) },
                        { value: "all", label: t("settings.categories.allOnes", { count: rows.length }) },
                    ]}
                />
            )}
        />
    );

    if (!rows.length) {
        return (
            <>
                {partHead}
                <div className="empty">{t("settings.categories.empty")}</div>
            </>
        );
    }

    /** The head's planning pill: the raid plan, or the sheet (its name and link in the tooltip). */
    const planningBadge = (catId: string) => {
        if (planningOf(catId, categoryPlanning, categorySheets) === "raidplan") {
            return <Badge tone="accent" icon="inv_misc_map02" tip={t("settings.categories.planningRaidplanTip")} tipSub={t("settings.categories.planningRaidplanSub")}>{t("settings.planning.raidplan")}</Badge>;
        }
        const sheet = categorySheets[catId] || { url: "", name: "" };
        return sheet.url
            ? <Badge tone="ok" icon="inv_scroll_03" tip={sheet.name || t("settings.categories.fixedSheet")} tipSub={sheet.url}>{t("settings.planning.sheet")}</Badge>
            : <Badge tone="ok" icon="inv_scroll_03" tip={t("settings.categories.planningCopiesTip")} tipSub={t("settings.categories.planningCopiesSub")}>{t("settings.planning.sheet")}</Badge>;
    };

    const row = (cat: CategoryRow) => {
        const active = categoryIds.includes(cat.id);
        const assigned = categoryRoles[cat.id] || [];
        const tool = categoryLootTool[cat.id] || "";
        const summary = chars[cat.id];
        const isOpen = openId === cat.id && active;
        const openCount = summary ? summary.members - summary.assigned : 0;
        return (
            <Fragment key={cat.id}>
                <div className={`cat-row${active ? " is-on" : ""}${isOpen ? " is-open" : ""}`} data-category={cat.id}>
                    <label className="switch" data-tip={active ? t("settings.categories.isRaid") : t("settings.categories.notRaid")} data-tip-sub={t("settings.categories.switchSub")}>
                        <input type="checkbox" checked={active} onChange={() => onToggleCategory(cat.id)} aria-label={t("settings.categories.switchAria", { name: cat.name })} />
                        <span className="switch-track"><span className="switch-thumb" /></span>
                    </label>
                    <div className="cat-name">
                        <span>{cat.name}</span>
                        {cat.unknown && (
                            <Badge tone="bad" icon={<WarnIcon />} tip={t("settings.categories.unknownTip")} tipSub={t("settings.categories.unknownSub")}>
                                {t("settings.categories.unknown")}
                            </Badge>
                        )}
                    </div>
                    {active ? (
                        <>
                            <div className="cat-cell">{assigned.length
                                ? <Badge tone="accent">{t("settings.categories.roleCount", { count: assigned.length })}</Badge>
                                : <Badge tone="bad" icon={<WarnIcon />}>{t("settings.categories.noRoles")}</Badge>}
                            </div>
                            <div className="cat-cell">{tool
                                ? <Badge icon="inv_misc_bag_10">{tool === "gargul" ? "Gargul" : "RCLootcouncil"}</Badge>
                                : <Badge tone="mid" icon={<WarnIcon />}>{t("settings.categories.missing")}</Badge>}
                            </div>
                            <div className="cat-cell">{planningBadge(cat.id)}</div>
                            <div className="cat-cell">{summary && summary.members
                                ? <Badge tone={openCount ? "mid" : "ok"} tip={t("settings.categories.chars")} tipSub={t("settings.categories.charsSub", { assigned: summary.assigned, members: summary.members })}>{summary.assigned} / {summary.members}</Badge>
                                : <Badge>–</Badge>}
                            </div>
                            <Expand open={isOpen} onToggle={() => setOpenId(isOpen ? "" : cat.id)} showLabel={!isOpen} />
                        </>
                    ) : <div className="cat-off note">{t("settings.categories.noRaidEvents")}</div>}
                </div>
                {isOpen && (
                    <CategoryDetail
                        cat={cat} s={props} roles={roleOptions(cat.id)} summary={summary}
                        tab={tabs[cat.id] || "signup"} onTab={(tab) => setTabs((prev) => ({ ...prev, [cat.id]: tab }))}
                        onAssign={() => setAssigning(cat)}
                    />
                )}
            </Fragment>
        );
    };

    return (
        <>
            {partHead}
            <div className="cat-list table-scroll">
                <div className="cat-inner">
                    <div className="cat-row cat-head" aria-hidden="true">
                        <span>{t("settings.categories.colActive")}</span><span>{t("settings.categories.colCategory")}</span><span>{t("settings.categories.raiderRoles")}</span><span>{t("settings.categories.lootAddon")}</span><span>{t("settings.categories.colPlanning")}</span><span>{t("settings.categories.colChars")}</span><span />
                    </div>
                    {shown.map(row)}
                    {!shown.length && <div className="empty">{t("settings.categories.noneShown")}</div>}
                    {folded.length > 0 && (
                        <>
                            <div className="cat-fold">
                                <span className="note">{t("settings.categories.folded", { count: folded.length })}</span>
                                <span className="cat-fold-names mono">{folded.slice(0, 4).map((c) => c.name).join(", ")}{folded.length > 4 ? " …" : ""}</span>
                                <Expand open={foldOpen} onToggle={() => setFoldOpen(!foldOpen)} />
                            </div>
                            {foldOpen && folded.map(row)}
                        </>
                    )}
                </div>
            </div>

            {assigning && (
                <RaiderCharactersModal
                    categoryId={assigning.id}
                    categoryName={assigning.name}
                    onClose={() => setAssigning(null)}
                    onSaved={(info) => {
                        setChars((prev) => ({ ...prev, [assigning.id]: summarizeRaiderChars(info) }));
                        setAssigning(null);
                    }}
                />
            )}
        </>
    );
}
