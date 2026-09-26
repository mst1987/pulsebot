import { Fragment, useCallback, useEffect, useState } from "react";
import { getRaiderCharacters, type Category, type EventSource, type Role } from "../../api";
import { usePersistedState } from "../../lib/persistedState";
import {
    categoryRows, splitCategoryRows, summarizeRaiderChars, signupNoteMode, noteChannelPick, signupNoteLabel, messageLook, titleSizeLabel,
    lootSystemLabel, lootToolLabel, TITLE_SIZES,
    type CategoryRow, type RaiderCharSummary,
} from "../../lib/settingsLogic";
import { t as translate, useT } from "../../i18n";
import { Button } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import Chip from "../../components/ui/Chip";
import Expand from "../../components/ui/Expand";
import PartHead from "../../components/ui/PartHead";
import Segment from "../../components/ui/Segment";
import WowIcon from "../../components/ui/WowIcon";
import RaiderCharactersModal from "./RaiderCharactersModal";
import { CheckMark, WarnIcon } from "../../components/settings/settingsUi";
import { FieldLabel } from "../../components/ui/Field";

// Everything that is configured *per raid category*, as one list instead of a
// card per Discord category: active switch, raider roles, where new events are
// created (Raid-Helper / EventHelper), loot addon, fixed sheet and the raider →
// character assignment, which used to be a section of
// its own with a second category picker. One row opens at a time.
//
// The guild's Discord holds far more categories than raid ones (typically 13 of
// 17 are not), so the inactive ones fold away under one line; the part head's
// segment shows them all. A configured id Discord no longer knows stays visible
// with a `bad` badge — dropping it would delete its settings on the next save.

export type CategorySheet = { url: string; name: string };

export type CategoryRaidTemplates = {
    options: { id: string; name: string }[];
    value: Record<string, string>;
    onChange: (categoryId: string, templateId: string) => void;
};

// The segments' options are built while rendering, so their labels follow the
// active language.

// How large the title tiles of the signup message are (src/web/embedLook.js).
const titleSizes = () => TITLE_SIZES.map((value) => ({ value, label: titleSizeLabel(value) }));

const lootTools = () => ["gargul", "rclc", ""].map((value) => ({ value, label: lootToolLabel(value) }));

// Which loot system a category's raids run on (src/web/lootSystem.js). "" =
// automatic: RCLootcouncil as the addon means Loot-Council, anything else Softres.
const lootSystems = () => ["", "softres", "lootcouncil", "gdkp", "other"].map((value) => ({ value, label: lootSystemLabel(value) }));

// "Beim Anlegen ankündigen" (#306) as one control: off, or where the ping goes.
const announceModes = () => [
    { value: "", label: translate("settings.categories.announceMode.off") },
    { value: "event", label: translate("settings.categories.announceMode.event") },
    { value: "talk", label: translate("settings.categories.announceMode.talk") },
    { value: "both", label: translate("settings.categories.announceMode.both") },
];

// The message with "Vielleicht" / "Absagen" (src/web/signupNotes.js).
const noteModes = () => ["required", "optional", "none"].map((value) => ({ value, label: signupNoteLabel(value) }));

// Where NEW events of the category are created. Raid-Helper events stay in use either way.
const SIGNUP_SOURCES = [
    { value: "raidhelper", label: "Raid-Helper" },
    { value: "eventhelper", label: "EventHelper" },
];

export default function CategoryMatrix({
    categories, roles, categoryIds, categoryRoles, categoryLootTool, categorySignupSource = {}, signupSourceDefault = "raidhelper", categorySetupDms = {}, categoryAnnounce = {}, categorySheets, savedCategoryRoles,
    categoryDiscordEvent = {}, categoryVoiceChannel = {}, voiceChannels = [], categoryLootSystem = {}, onLootSystem,
    categoryMessageLook = {}, onMessageLook,
    categorySignupNotes = {}, onSignupNotes, categorySignupNoteChannel = {}, noteChannels, onSignupNoteChannel,
    onToggleCategory, onToggleRole, onLootTool, onSignupSource, onSetupDms, onAnnounce, onDiscordEvent, onVoiceChannel, onSheet, icon, crumb, raidTemplates,
}: {
    /** The message with "Vielleicht" / "Absagen"; missing = "optional". */
    categorySignupNotes?: Record<string, string>;
    onSignupNotes?: (categoryId: string, mode: string) => void;
    /** Where those messages go (#335); missing = the default channel. */
    categorySignupNoteChannel?: Record<string, string>;
    /** The text channels of both servers and the default channel's id; missing = no picker. */
    noteChannels?: { defaultId: string; channels: { id: string; name: string; category?: string }[] };
    onSignupNoteChannel?: (categoryId: string, channelId: string) => void;
    /** The default raid template per category (#266): the choices, the draft map and its setter. */
    raidTemplates?: CategoryRaidTemplates;
    categories: Category[];
    roles: Role[];
    categoryIds: string[];
    categoryRoles: Record<string, string[]>;
    categoryLootTool: Record<string, string>;
    /** The loot system per category; missing/"" = automatic from the loot addon. */
    categoryLootSystem?: Record<string, string>;
    onLootSystem?: (categoryId: string, system: string) => void;
    /** Missing = signupSourceDefault. */
    categorySignupSource?: Record<string, EventSource>;
    /** The source of a category without an entry (#291): EventHelper for a new one. */
    signupSourceDefault?: EventSource;
    /** Setup-DMs per category (#290); missing = off. */
    categorySetupDms?: Record<string, boolean>;
    /** A Discord event per raid (#305); missing = off. */
    categoryDiscordEvent?: Record<string, boolean>;
    /** The voice channel a category's raids meet in (#305); missing = none. */
    categoryVoiceChannel?: Record<string, string>;
    /** The server's voice channels; empty while the bot is offline. */
    voiceChannels?: { id: string; name: string; category?: string }[];
    /** The look of the signup message; missing = raid picture on, title "large". */
    categoryMessageLook?: Record<string, { raidArt?: boolean; titleSize?: string }>;
    onMessageLook?: (categoryId: string, look: { raidArt: boolean; titleSize: string }) => void;
    /** "Beim Anlegen ankündigen" per category (#306); missing = off. */
    categoryAnnounce?: Record<string, { enabled: boolean; target: string }>;
    categorySheets: Record<string, CategorySheet>;
    /** The saved roles — the assignment modal works on those, not on the draft. */
    savedCategoryRoles: Record<string, string[]>;
    onToggleCategory: (id: string) => void;
    onToggleRole: (categoryId: string, roleId: string) => void;
    onLootTool: (categoryId: string, tool: string) => void;
    onSignupSource: (categoryId: string, source: EventSource) => void;
    onSetupDms?: (categoryId: string, on: boolean) => void;
    onDiscordEvent?: (categoryId: string, on: boolean) => void;
    onVoiceChannel?: (categoryId: string, channelId: string) => void;
    onAnnounce?: (categoryId: string, mode: string) => void;
    onSheet: (categoryId: string, sheet: CategorySheet) => void;
    icon: string;
    crumb: string;
}) {
    const t = useT();
    const [showAll, setShowAll] = usePersistedState("settings-categories-all", false);
    const [openId, setOpenId] = useState("");
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
                        {t("settings.categories.stillRh", { count: stillRaidhelper.length })}
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

    const row = (cat: CategoryRow) => {
        const active = categoryIds.includes(cat.id);
        const assigned = categoryRoles[cat.id] || [];
        const tool = categoryLootTool[cat.id] || "";
        const signupSource: EventSource = categorySignupSource[cat.id] || signupSourceDefault;
        const sheet = categorySheets[cat.id] || { url: "", name: "" };
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
                            <div>{assigned.length
                                ? <Badge tone="accent">{t("settings.categories.roleCount", { count: assigned.length })}</Badge>
                                : <Badge tone="bad" icon={<WarnIcon />}>{t("settings.categories.noRoles")}</Badge>}
                            </div>
                            <div>{tool
                                ? <Badge icon="inv_misc_bag_10">{tool === "gargul" ? "Gargul" : "RCLootcouncil"}</Badge>
                                : <Badge tone="mid" icon={<WarnIcon />}>{t("settings.categories.missing")}</Badge>}
                            </div>
                            <div>{sheet.url
                                ? <Badge tone="ok" icon="inv_scroll_03" tip={sheet.name || t("settings.categories.fixedSheet")} tipSub={sheet.url}>{sheet.name || t("settings.categories.sheet")}</Badge>
                                : <Badge>{t("settings.categories.noSheet")}</Badge>}
                            </div>
                            <div>{summary && summary.members
                                ? <Badge tone={openCount ? "mid" : "ok"} tip={t("settings.categories.chars")} tipSub={t("settings.categories.charsSub", { assigned: summary.assigned, members: summary.members })}>{summary.assigned} / {summary.members}</Badge>
                                : <Badge>–</Badge>}
                            </div>
                            <Expand open={isOpen} onToggle={() => setOpenId(isOpen ? "" : cat.id)} showLabel={!isOpen} />
                        </>
                    ) : <div className="cat-off note">{t("settings.categories.noRaidEvents")}</div>}
                </div>
                {isOpen && (
                    <div className="cat-detail">
                        <div className="cat-detail-col">
                            <div>
                                <FieldLabel tip={t("settings.categories.raiderRoles")} tipSub={t("settings.categories.raiderRolesSub")}>{t("settings.categories.raiderRoles")}</FieldLabel>
                                <div className="chip-row">
                                    {roleOptions(cat.id).length ? roleOptions(cat.id).map((r) => {
                                        const on = assigned.includes(r.id);
                                        return (
                                            <Chip key={r.id} tone={on ? "accent" : undefined} pressed={on} icon={on ? <CheckMark /> : undefined} onClick={() => onToggleRole(cat.id, r.id)}>
                                                @{r.name}
                                            </Chip>
                                        );
                                    }) : <span className="note">{t("settings.categories.noRaidRole")}</span>}
                                </div>
                            </div>
                            <div>
                                <FieldLabel tip={t("settings.categories.chars")} tipSub={t("settings.categories.charsDetailSub")}>{t("settings.categories.chars")}</FieldLabel>
                                <div className="rch-summary">
                                    {summary && summary.members ? (
                                        <>
                                            <span><b>{summary.assigned}</b> <span className="note">{t("settings.categories.charsOf", { members: summary.members })}</span></span>
                                            {openCount > 0 ? <Badge tone="mid">{t("settings.raiderChars.open", { count: openCount })}</Badge> : <Badge tone="ok">{t("settings.raiderChars.allFixed")}</Badge>}
                                        </>
                                    ) : (
                                        <span className="note">{(savedCategoryRoles[cat.id] || []).length ? t("settings.categories.noRaiders") : t("settings.categories.saveRolesFirst")}</span>
                                    )}
                                    <span className="grow" />
                                    <Button variant="ghost" size="sm" icon="ability_rogue_disguise" onClick={() => setAssigning(cat)}
                                        disabled={!(savedCategoryRoles[cat.id] || []).length}>
                                        {t("settings.categories.assign")}
                                    </Button>
                                </div>
                            </div>
                        </div>
                        <div className="cat-detail-col">
                            <div>
                                <FieldLabel tip={t("settings.categories.newEvents")} tipSub={t("settings.categories.newEventsSub")}>{t("settings.categories.newEvents")}</FieldLabel>
                                <Segment ariaLabel={t("settings.categories.newEventsAria", { name: cat.name })} value={signupSource} onChange={(v) => onSignupSource(cat.id, v as EventSource)} options={SIGNUP_SOURCES} />
                            </div>
                            {onSetupDms && (
                                <div className="cat-switch-row">
                                    <FieldLabel tip={t("settings.categories.setupDms")} tipSub={t("settings.categories.setupDmsSub")}>{t("settings.categories.setupDms")}</FieldLabel>
                                    <label className="switch">
                                        <input type="checkbox" checked={categorySetupDms[cat.id] === true} onChange={() => onSetupDms(cat.id, categorySetupDms[cat.id] !== true)} aria-label={t("settings.categories.setupDmsAria", { name: cat.name })} />
                                        <span className="switch-track"><span className="switch-thumb" /></span>
                                    </label>
                                </div>
                            )}
                            {onAnnounce && (
                                <div>
                                    <FieldLabel tip={t("settings.categories.announceTip")} tipSub={t("settings.categories.announceSub")}>{t("settings.categories.announce")}</FieldLabel>
                                    <Segment ariaLabel={t("settings.categories.announceAria", { name: cat.name })}
                                        value={categoryAnnounce[cat.id] && categoryAnnounce[cat.id].enabled ? (categoryAnnounce[cat.id].target || "event") : ""}
                                        onChange={(v) => onAnnounce(cat.id, v)} options={announceModes()} />
                                </div>
                            )}
                            {onSignupNotes && (
                                <div>
                                    <FieldLabel tip={t("settings.categories.notes")} tipSub={t("settings.categories.notesSub")}>{t("settings.categories.notes")}</FieldLabel>
                                    <Segment ariaLabel={t("settings.categories.notesAria", { name: cat.name })}
                                        value={signupNoteMode(categorySignupNotes, cat.id)}
                                        onChange={(v) => onSignupNotes(cat.id, v)} options={noteModes()} />
                                    {onSignupNoteChannel && noteChannels && noteChannels.channels.length > 0 && signupNoteMode(categorySignupNotes, cat.id) !== "none" && (() => {
                                        // #335: the category's own channel, else the default one.
                                        const own = categorySignupNoteChannel[cat.id] || "";
                                        const pick = noteChannelPick(noteChannels.channels, noteChannels.defaultId, own);
                                        return (
                                            <div className="cat-note-channel">
                                                <select id={`catnote-${cat.id}`} value={own} aria-label={t("settings.categories.noteChannelAria", { name: cat.name })}
                                                    data-tip={t("settings.categories.noteChannelTip")} data-tip-sub={t("settings.categories.noteChannelSub")}
                                                    onChange={(e) => onSignupNoteChannel(cat.id, e.target.value)}>
                                                    <option value="">{pick.defaultLabel}</option>
                                                    {pick.unreachable && <option value={own}>{t("settings.categories.unreachableOption", { id: own })}</option>}
                                                    {noteChannels.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}{c.category ? ` · ${c.category}` : ""}</option>)}
                                                </select>
                                                {pick.unreachable && <Badge tone="bad" tip={t("settings.categories.unreachableTip")} tipSub={t("settings.categories.unreachableSub")}>{t("settings.categories.unreachable")}</Badge>}
                                            </div>
                                        );
                                    })()}
                                </div>
                            )}
                            {onDiscordEvent && (
                                <div className="cat-switch-row">
                                    <FieldLabel tip={t("settings.categories.discordEvent")} tipSub={t("settings.categories.discordEventSub")}>{t("settings.categories.discordEvent")}</FieldLabel>
                                    <label className="switch">
                                        <input type="checkbox" checked={categoryDiscordEvent[cat.id] === true} onChange={() => onDiscordEvent(cat.id, categoryDiscordEvent[cat.id] !== true)} aria-label={t("settings.categories.discordEventAria", { name: cat.name })} />
                                        <span className="switch-track"><span className="switch-thumb" /></span>
                                    </label>
                                </div>
                            )}
                            {onMessageLook && (() => {
                                const look = messageLook(categoryMessageLook, cat.id);
                                return (
                                    <>
                                        <div className="cat-switch-row">
                                            <FieldLabel tip={t("settings.categories.raidArt")} tipSub={t("settings.categories.raidArtSub")}>{t("settings.categories.raidArt")}</FieldLabel>
                                            <label className="switch">
                                                <input type="checkbox" checked={look.raidArt} onChange={() => onMessageLook(cat.id, { ...look, raidArt: !look.raidArt })} aria-label={t("settings.categories.raidArtAria", { name: cat.name })} />
                                                <span className="switch-track"><span className="switch-thumb" /></span>
                                            </label>
                                        </div>
                                        <div>
                                            <FieldLabel tip={t("settings.categories.titleSize")} tipSub={t("settings.categories.titleSizeSub")}>{t("settings.categories.titleSize")}</FieldLabel>
                                            <Segment ariaLabel={t("settings.categories.titleSizeAria", { name: cat.name })} value={look.titleSize} onChange={(v) => onMessageLook(cat.id, { ...look, titleSize: v })} options={titleSizes()} />
                                        </div>
                                    </>
                                );
                            })()}
                            {onVoiceChannel && (
                                <div>
                                    <FieldLabel htmlFor={`catvoice-${cat.id}`} tip={t("settings.categories.voice")} tipSub={t("settings.categories.voiceSub")}>{t("settings.categories.voice")}</FieldLabel>
                                    {voiceChannels.length ? (
                                        <select id={`catvoice-${cat.id}`} value={categoryVoiceChannel[cat.id] || ""} onChange={(e) => onVoiceChannel(cat.id, e.target.value)}>
                                            <option value="">{t("settings.categories.noVoiceOption")}</option>
                                            {voiceChannels.map((c) => <option key={c.id} value={c.id}>{c.name}{c.category ? ` · ${c.category}` : ""}</option>)}
                                        </select>
                                    ) : <span className="note">{t("settings.categories.noVoice")}</span>}
                                </div>
                            )}
                            <div>
                                <FieldLabel tip={t("settings.categories.lootAddon")} tipSub={t("settings.categories.lootAddonSub")}>{t("settings.categories.lootAddon")}</FieldLabel>
                                <Segment ariaLabel={t("settings.categories.lootAddonAria", { name: cat.name })} value={tool} onChange={(v) => onLootTool(cat.id, v)} options={lootTools()} />
                            </div>
                            {onLootSystem && (
                                <div>
                                    <FieldLabel tip={t("settings.categories.lootSystem")} tipSub={t("settings.categories.lootSystemSub", { auto: tool === "rclc" ? t("settings.categories.lootSystemAutoRclc") : "Softres" })}>{t("settings.categories.lootSystem")}</FieldLabel>
                                    <Segment ariaLabel={t("settings.categories.lootSystemAria", { name: cat.name })} value={categoryLootSystem[cat.id] || ""} onChange={(v) => onLootSystem(cat.id, v)} options={lootSystems()} />
                                </div>
                            )}
                            {raidTemplates && (
                                <div>
                                    <FieldLabel htmlFor={`cattpl-${cat.id}`} tip={t("settings.categories.template")} tipSub={t("settings.categories.templateSub")}>{t("settings.categories.template")}</FieldLabel>
                                    <select id={`cattpl-${cat.id}`} value={raidTemplates.value[cat.id] || ""} onChange={(e) => raidTemplates.onChange(cat.id, e.target.value)}>
                                        <option value="">{t("settings.categories.noTemplate")}</option>
                                        {raidTemplates.options.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name || t("settings.noName")}</option>)}
                                    </select>
                                </div>
                            )}
                            <div>
                                <FieldLabel htmlFor={`catsheet-name-${cat.id}`} tip={t("settings.categories.fixedSheet")} tipSub={t("settings.categories.fixedSheetSub")}>{t("settings.categories.fixedSheet")}</FieldLabel>
                                <div className="sheet-field">
                                    <WowIcon name="inv_scroll_03" size={20} />
                                    <div className="sheet-inputs">
                                        <input id={`catsheet-name-${cat.id}`} type="text" value={sheet.name} placeholder={t("settings.categories.sheetNamePlaceholder")}
                                            onChange={(e) => onSheet(cat.id, { ...sheet, name: e.target.value })} />
                                        <input type="url" className="mono" aria-label={t("settings.categories.sheetLinkAria")} value={sheet.url} placeholder={t("settings.categories.sheetUrlPlaceholder")}
                                            onChange={(e) => onSheet(cat.id, { ...sheet, url: e.target.value })} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
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
                        <span>{t("settings.categories.colActive")}</span><span>{t("settings.categories.colCategory")}</span><span>{t("settings.categories.raiderRoles")}</span><span>{t("settings.categories.lootAddon")}</span><span>{t("settings.categories.colRaidsheet")}</span><span>{t("settings.categories.colChars")}</span><span />
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
