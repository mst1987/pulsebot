import { useRef, type KeyboardEvent, type ReactNode } from "react";
import type { EventSource, PlanningMode, Role } from "../../../api";
import {
    signupNoteMode, noteChannelPick, signupNoteLabel, messageLook, titleSizeLabel, lootSystemLabel, lootToolLabel, planningOf, planningLabel, attendanceOf,
    validAttendanceWindow, signupCharactersOf, validSignupCharacters, TITLE_SIZES, CATEGORY_TABS, ATTENDANCE_WINDOW, SIGNUP_CHARACTERS, type CategoryAttendance, type CategoryRow, type CategoryTab, type RaiderCharSummary,
} from "../../../lib/settings/settingsLogic";
import { tParts, t as translate, useT } from "../../../i18n";
import { Button } from "../../../components/ui/Button";
import Badge from "../../../components/ui/Badge";
import Chip from "../../../components/ui/Chip";
import Segment from "../../../components/ui/Segment";
import WowIcon from "../../../components/ui/WowIcon";
import NumberStepper from "../../../components/ui/NumberStepper";
import CategoryField, { CategorySubField } from "./CategoryField";
import AvailabilityPanelRow, { type AvailabilityPanels } from "./AvailabilityPanelRow";
import OrgaHubRow, { type OrgaHubs } from "./OrgaHubRow";
import { ChannelsIcon, CheckMark, ClockIcon, CommentIcon, GiftIcon, RosterIcon, RowsIcon } from "../../../components/ui/icons";

// The expanded card of one raid category (Einstellungen → Kategorien), design
// "A · Sechs Tabs, jede Einstellung eine Karte": its ~18 settings sorted into six
// tabs of at most five — Raider, Neue Events, Anmelde-Nachricht, Discord-Zentralen,
// Setup & Planung, Loot. Each tab opens with one line on what it covers; each
// setting is a card of its own (CategoryField): name and a one-line summary, the
// control beside it, the full explanation behind the (i). The three attendance
// settings share one card. Which tab is open is the list's state (one per
// category, the first by default); a tab without a single field (a caller that
// leaves the callbacks out) is not offered.

export type CategorySheet = { url: string; name: string };

export type CategoryRaidTemplates = {
    options: { id: string; name: string }[];
    value: Record<string, string>;
    onChange: (categoryId: string, templateId: string) => void;
};

export type { CategoryTab };

/** Everything configured per category, as CategoryMatrix receives it (see there for each field). */
export type CategorySettings = {
    availabilityPanels?: AvailabilityPanels;
    /** The Orga-Zentrale per category; missing = no row (an older caller, or the list failed to load). */
    orgaHubs?: OrgaHubs;
    categorySignupNotes?: Record<string, string>;
    onSignupNotes?: (categoryId: string, mode: string) => void;
    categorySignupNoteChannel?: Record<string, string>;
    noteChannels?: { defaultId: string; channels: { id: string; name: string; category?: string }[] };
    onSignupNoteChannel?: (categoryId: string, channelId: string) => void;
    /** Characters per signup (1..8); missing = 8. */
    categorySignupCharacters?: Record<string, number>;
    /** Missing = no "Charaktere je Anmeldung" card (an older caller). */
    onSignupCharacters?: (categoryId: string, count: number) => void;
    raidTemplates?: CategoryRaidTemplates;
    categoryRoles: Record<string, string[]>;
    categoryLootTool: Record<string, string>;
    categoryLootSystem?: Record<string, string>;
    onLootSystem?: (categoryId: string, system: string) => void;
    categorySignupSource?: Record<string, EventSource>;
    signupSourceDefault?: EventSource;
    /** #927: false = the active server has Raid-Helper off, so new events can only go to EventHelper; missing = on. */
    raidhelperActive?: boolean;
    categorySetupDms?: Record<string, boolean>;
    /** The language of the category's posts: "de" / "en", missing or "" = the server language. */
    categoryLanguage?: Record<string, string>;
    onLanguage?: (categoryId: string, lang: string) => void;
    /** Attendance per category (Abwesenheiten page); missing = shown, over the last 11 raids, in the overview. */
    categoryAttendance?: Record<string, Partial<CategoryAttendance>>;
    /** Missing = no attendance fields (an older caller). The category's settings are handed over whole. */
    onAttendance?: (categoryId: string, value: CategoryAttendance) => void;
    categoryDiscordEvent?: Record<string, boolean>;
    categoryVoiceChannel?: Record<string, string>;
    voiceChannels?: { id: string; name: string; category?: string }[];
    categoryMessageLook?: Record<string, { raidArt?: boolean; titleSize?: string }>;
    onMessageLook?: (categoryId: string, look: { raidArt: boolean; titleSize: string }) => void;
    categoryAnnounce?: Record<string, { enabled: boolean }>;
    categorySheets: Record<string, CategorySheet>;
    /** Raid plan or sheet per category (picked modes only); missing = the default of planningOf(). */
    categoryPlanning?: Record<string, PlanningMode>;
    /** Missing = no Planung switch, the sheet fields always shown (an older caller). */
    onPlanning?: (categoryId: string, mode: PlanningMode) => void;
    savedCategoryRoles: Record<string, string[]>;
    onToggleRole: (categoryId: string, roleId: string) => void;
    onLootTool: (categoryId: string, tool: string) => void;
    onSignupSource: (categoryId: string, source: EventSource) => void;
    onSetupDms?: (categoryId: string, on: boolean) => void;
    onDiscordEvent?: (categoryId: string, on: boolean) => void;
    /** false = the category is left out of the server overview; missing or true = shown. */
    categoryServerOverview?: Record<string, boolean>;
    /** Missing = no "Server-Übersicht" card (an older caller). */
    onServerOverview?: (categoryId: string, on: boolean) => void;
    onVoiceChannel?: (categoryId: string, channelId: string) => void;
    onAnnounce?: (categoryId: string, mode: string) => void;
    onSheet: (categoryId: string, sheet: CategorySheet) => void;
};

// The segments' options are built while rendering, so their labels follow the
// active language.

// How large the title tiles of the signup message are (src/web/embedLook.js).
const titleSizes = () => TITLE_SIZES.map((value) => ({ value, label: titleSizeLabel(value) }));

const lootTools = () => ["gargul", "rclc", ""].map((value) => ({ value, label: lootToolLabel(value) }));

// Which loot system a category's raids run on (src/web/lootSystem.js). "" =
// automatic: RCLootcouncil as the addon means Loot-Council, anything else Softres.
const lootSystems = () => ["", "softres", "lootcouncil", "gdkp", "other"].map((value) => ({ value, label: lootSystemLabel(value) }));

// "Beim Anlegen ankündigen" (#306) as one control: off, or in the event channel (#894).
// The language of the category's posts in the channel: the server's, or its own (PuGs in English).
const languageModes = () => [
    { value: "", label: translate("settings.categories.languageServer") },
    { value: "de", label: "Deutsch" },
    { value: "en", label: "English" },
];

const announceModes = () => [
    { value: "", label: translate("settings.categories.announceMode.off") },
    { value: "event", label: translate("settings.categories.announceMode.event") },
];

// The message with "Vielleicht" / "Absagen" (src/web/signupNotes.js).
const noteModes = () => ["required", "optional", "none"].map((value) => ({ value, label: signupNoteLabel(value) }));

// Raid plan or Google Sheet (src/services/events/planning.js) - never both.
const planningModes = () => (["raidplan", "sheet"] as PlanningMode[]).map((value) => ({ value, label: planningLabel(value) }));

// Where NEW events of the category are created. Raid-Helper events stay in use either way.
const SIGNUP_SOURCES = [
    { value: "raidhelper", label: "Raid-Helper" },
    { value: "eventhelper", label: "EventHelper" },
];

// The icon of each tab, in front of its name.
const TAB_ICONS: Record<CategoryTab, ReactNode> = {
    raider: <RosterIcon />, events: <ClockIcon />, message: <CommentIcon />, hubs: <ChannelsIcon />, plan: <RowsIcon />, loot: <GiftIcon />,
};

type Field = { key: string; node: ReactNode };

/** A switch with its label hidden (the row names it). */
function Toggle({ checked, onChange, ariaLabel }: { checked: boolean; onChange: () => void; ariaLabel: string }) {
    return (
        <label className="switch">
            <input type="checkbox" checked={checked} onChange={onChange} aria-label={ariaLabel} />
            <span className="switch-track"><span className="switch-thumb" /></span>
        </label>
    );
}

/** What a stepper counts: its range, the check of a typed number and its labels (i18n keys). */
type StepperKind = { min: number; max: number; valid: (n: number) => boolean; less: string; more: string; unit: string };

// Over how many last raids the attendance quota counts (1..50).
const QUOTA_STEPS: StepperKind = {
    min: ATTENDANCE_WINDOW.min, max: ATTENDANCE_WINDOW.max, valid: validAttendanceWindow,
    less: "settings.categories.attendanceWindowLess", more: "settings.categories.attendanceWindowMore", unit: "settings.categories.attendanceWindowUnit",
};

// How many characters one signup may name (1..8).
const SIGNUP_CHAR_STEPS: StepperKind = {
    min: SIGNUP_CHARACTERS.min, max: SIGNUP_CHARACTERS.max, valid: validSignupCharacters,
    less: "settings.categories.signupCharsLess", more: "settings.categories.signupCharsMore", unit: "settings.categories.signupCharsUnit",
};

/**
 * A number with − / + beside it, typed freely within its range (`kind`: the
 * attendance quota by default, 1 to 50). A half-typed number ("" or "0" on the
 * way to "5") stays in the field and is only handed over once it is valid;
 * leaving the field shows the value that counts again.
 */
function QuotaStepper({ id, value, ariaLabel, onChange, kind = QUOTA_STEPS }: { id: string; value: number; ariaLabel: string; onChange: (n: number) => void; kind?: StepperKind }) {
    const t = useT();
    return (
        <div className="cat-quota">
            {/* the shared − value + (components/ui/NumberStepper): every valid keystroke goes to the draft */}
            <NumberStepper id={id} value={value} min={kind.min} max={kind.max} editable commit="input" ariaLabel={ariaLabel}
                lessLabel={t(kind.less)} moreLabel={t(kind.more)} onChange={(n) => { if (kind.valid(n)) onChange(n); }} />
            <span className="note">{t(kind.unit)}</span>
        </div>
    );
}

export default function CategoryDetail({ cat, s, roles, tab, onTab, summary, onAssign }: {
    cat: CategoryRow;
    s: CategorySettings;
    /** The raider roles offered for this category (see CategoryMatrix). */
    roles: Role[];
    tab: CategoryTab;
    onTab: (tab: CategoryTab) => void;
    summary?: RaiderCharSummary;
    onAssign: () => void;
}) {
    const t = useT();
    const list = useRef<HTMLDivElement>(null);
    const name = cat.name;
    const fields: Record<CategoryTab, Field[]> = {
        raider: raiderFields(), events: eventFields(), message: messageFields(), hubs: hubFields(), plan: planFields(), loot: lootFields(),
    };
    const offered = CATEGORY_TABS.filter((id) => fields[id].length > 0);
    const shown: CategoryTab = offered.includes(tab) ? tab : offered[0];
    const tabId = (id: CategoryTab) => `cat-${cat.id}-tab-${id}`;
    const panelId = (id: CategoryTab) => `cat-${cat.id}-panel-${id}`;

    // Arrow keys move between the tabs (and open them), Home/End jump to the ends.
    const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
        const i = offered.indexOf(shown);
        const n = offered.length;
        const to: Record<string, number> = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 };
        if (!(e.key in to)) return;
        e.preventDefault();
        onTab(offered[to[e.key]]);
        const buttons = list.current ? list.current.querySelectorAll<HTMLButtonElement>("[role=tab]") : null;
        if (buttons && buttons[to[e.key]]) buttons[to[e.key]].focus();
    };

    // Who belongs to the category, and how their attendance is counted.
    function raiderFields(): Field[] {
        const out: Field[] = [];
        const assigned = s.categoryRoles[cat.id] || [];
        out.push({ key: "roles", node: (
            <CategoryField label={t("settings.categories.raiderRoles")} sub={t("settings.categories.raiderRolesShort")} more={t("settings.categories.raiderRolesSub")}>
                <div className="chip-row">
                    {roles.length ? roles.map((r) => {
                        const on = assigned.includes(r.id);
                        return (
                            <Chip key={r.id} tone={on ? "accent" : undefined} pressed={on} icon={on ? <CheckMark /> : undefined} onClick={() => s.onToggleRole(cat.id, r.id)}>
                                @{r.name}
                            </Chip>
                        );
                    }) : <span className="note">{t("settings.categories.noRaidRole")}</span>}
                </div>
            </CategoryField>
        ) });
        const saved = (s.savedCategoryRoles[cat.id] || []).length > 0;
        const openCount = summary ? summary.members - summary.assigned : 0;
        out.push({ key: "chars", node: (
            <CategoryField label={t("settings.categories.chars")} sub={t("settings.categories.charsShort")} more={t("settings.categories.charsDetailSub")}>
                <div className="rch-summary">
                    {summary && summary.members ? (
                        <>
                            <span><b>{summary.assigned}</b> <span className="note">{tParts("settings.categories.charsOf", { members: summary.members })}</span></span>
                            {openCount > 0 ? <Badge tone="mid">{tParts("settings.raiderChars.open", { count: openCount })}</Badge> : <Badge tone="ok">{t("settings.raiderChars.allFixed")}</Badge>}
                        </>
                    ) : (
                        <span className="note">{saved ? t("settings.categories.noRaiders") : t("settings.categories.saveRolesFirst")}</span>
                    )}
                    <span className="grow" />
                    <Button variant="ghost" size="sm" icon="profile" onClick={onAssign} disabled={!saved}>
                        {t("settings.categories.assign")}
                    </Button>
                </div>
            </CategoryField>
        ) });
        if (s.onAttendance) out.push({ key: "attendance", node: attendanceField(s.onAttendance) });
        return out;
    }

    // Abwesenheiten per category in one card: whether its attendance is shown, over how many raids, and whether it is in the overview.
    function attendanceField(onAttendance: (categoryId: string, value: CategoryAttendance) => void) {
        const att = attendanceOf(s.categoryAttendance, cat.id);
        const set = (change: Partial<CategoryAttendance>) => onAttendance(cat.id, { ...att, ...change });
        return (
            <CategoryField label={t("settings.categories.attendanceBlock")} sub={t("settings.categories.attendanceBlockShort")}>
                <div className="cat-subfields">
                    <CategorySubField label={t("settings.categories.attendance")} sub={t("settings.categories.attendanceShort")} more={t("settings.categories.attendanceSub")}>
                        <Toggle checked={att.show} onChange={() => set({ show: !att.show })} ariaLabel={t("settings.categories.attendanceAria", { name })} />
                    </CategorySubField>
                    {att.show && (
                        <CategorySubField label={t("settings.categories.attendanceWindow")} htmlFor={`catquota-${cat.id}`}
                            sub={t("settings.categories.attendanceWindowShort")} more={t("settings.categories.attendanceWindowSub")}>
                            <QuotaStepper id={`catquota-${cat.id}`} value={att.window} ariaLabel={t("settings.categories.attendanceWindowAria", { name })}
                                onChange={(n) => set({ window: n })} />
                        </CategorySubField>
                    )}
                    <CategorySubField label={t("settings.categories.absences")} sub={t("settings.categories.absencesShort")} more={t("settings.categories.absencesSub")}>
                        <Toggle checked={att.absences} onChange={() => set({ absences: !att.absences })} ariaLabel={t("settings.categories.absencesAria", { name })} />
                    </CategorySubField>
                </div>
            </CategoryField>
        );
    }

    // What happens when a new event of the category is created.
    function eventFields(): Field[] {
        const out: Field[] = [];
        const { raidTemplates, onVoiceChannel, onAnnounce, onDiscordEvent } = s;
        // #927: a server without Raid-Helper creates every event in EventHelper, whatever the category says
        const noRaidhelper = s.raidhelperActive === false;
        const signupSource: EventSource = noRaidhelper ? "eventhelper" : (s.categorySignupSource || {})[cat.id] || s.signupSourceDefault || "raidhelper";
        out.push({ key: "source", node: noRaidhelper ? (
            <CategoryField label={t("settings.categories.newEvents")} sub={t("settings.categories.newEventsNoRh")} more={t("settings.categories.newEventsSub")}>
                <span className="cat-source-fixed" data-source="eventhelper">EventHelper</span>
            </CategoryField>
        ) : (
            <CategoryField label={t("settings.categories.newEvents")} sub={t("settings.categories.newEventsShort")} more={t("settings.categories.newEventsSub")}>
                <Segment ariaLabel={t("settings.categories.newEventsAria", { name })} value={signupSource} onChange={(v) => s.onSignupSource(cat.id, v as EventSource)} options={SIGNUP_SOURCES} />
            </CategoryField>
        ) });
        if (raidTemplates) {
            out.push({ key: "template", node: (
                <CategoryField label={t("settings.categories.template")} htmlFor={`cattpl-${cat.id}`} sub={t("settings.categories.templateShort")} more={t("settings.categories.templateSub")}>
                    <select id={`cattpl-${cat.id}`} value={raidTemplates.value[cat.id] || ""} onChange={(e) => raidTemplates.onChange(cat.id, e.target.value)}>
                        <option value="">{t("settings.categories.noTemplate")}</option>
                        {raidTemplates.options.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name || t("settings.noName")}</option>)}
                    </select>
                </CategoryField>
            ) });
        }
        if (onVoiceChannel) {
            const voiceChannels = s.voiceChannels || [];
            out.push({ key: "voice", node: (
                <CategoryField label={t("settings.categories.voice")} htmlFor={voiceChannels.length ? `catvoice-${cat.id}` : undefined}
                    sub={t("settings.categories.voiceShort")} more={t("settings.categories.voiceSub")}>
                    {voiceChannels.length ? (
                        <select id={`catvoice-${cat.id}`} value={(s.categoryVoiceChannel || {})[cat.id] || ""} onChange={(e) => onVoiceChannel(cat.id, e.target.value)}>
                            <option value="">{t("settings.categories.noVoiceOption")}</option>
                            {voiceChannels.map((c) => <option key={c.id} value={c.id}>{c.name}{c.category ? ` · ${c.category}` : ""}</option>)}
                        </select>
                    ) : <span className="note">{t("settings.categories.noVoice")}</span>}
                </CategoryField>
            ) });
        }
        if (onAnnounce) {
            const entry = (s.categoryAnnounce || {})[cat.id];
            out.push({ key: "announce", node: (
                <CategoryField label={t("settings.categories.announce")} sub={t("settings.categories.announceShort")} more={t("settings.categories.announceSub")}>
                    <Segment ariaLabel={t("settings.categories.announceAria", { name })}
                        value={entry && entry.enabled ? "event" : ""}
                        onChange={(v) => onAnnounce(cat.id, v)} options={announceModes()} />
                </CategoryField>
            ) });
        }
        if (onDiscordEvent) {
            const on = (s.categoryDiscordEvent || {})[cat.id] === true;
            out.push({ key: "discordEvent", node: (
                <CategoryField label={t("settings.categories.discordEvent")} sub={t("settings.categories.discordEventShort")} more={t("settings.categories.discordEventSub")}>
                    <Toggle checked={on} onChange={() => onDiscordEvent(cat.id, !on)} ariaLabel={t("settings.categories.discordEventAria", { name })} />
                </CategoryField>
            ) });
        }
        return out;
    }

    function notesField(onSignupNotes: (categoryId: string, mode: string) => void) {
        const mode = signupNoteMode(s.categorySignupNotes, cat.id);
        const onChannel = s.onSignupNoteChannel;
        const noteChannels = s.noteChannels;
        let channelPicker: ReactNode = null;
        if (onChannel && noteChannels && noteChannels.channels.length > 0 && mode !== "none") {
            // #335: the category's own channel, else the default one.
            const own = (s.categorySignupNoteChannel || {})[cat.id] || "";
            const pick = noteChannelPick(noteChannels.channels, noteChannels.defaultId, own);
            channelPicker = (
                <div className="cat-note-channel">
                    <select id={`catnote-${cat.id}`} value={own} aria-label={t("settings.categories.noteChannelAria", { name })}
                        data-tip={t("settings.categories.noteChannelTip")} data-tip-sub={t("settings.categories.noteChannelSub")}
                        onChange={(e) => onChannel(cat.id, e.target.value)}>
                        <option value="">{pick.defaultLabel}</option>
                        {pick.unreachable && <option value={own}>{tParts("settings.categories.unreachableOption", { id: own })}</option>}
                        {noteChannels.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}{c.category ? ` · ${c.category}` : ""}</option>)}
                    </select>
                    {pick.unreachable && <Badge tone="bad" tip={t("settings.categories.unreachableTip")} tipSub={t("settings.categories.unreachableSub")}>{t("settings.categories.unreachable")}</Badge>}
                </div>
            );
        }
        return (
            <CategoryField label={t("settings.categories.notes")} sub={t("settings.categories.notesShort")} more={t("settings.categories.notesSub")}>
                <Segment ariaLabel={t("settings.categories.notesAria", { name })} value={mode}
                    onChange={(v) => onSignupNotes(cat.id, v)} options={noteModes()} />
                {channelPicker}
            </CategoryField>
        );
    }

    // How the signup message in the channel looks, and what its buttons ask.
    function messageFields(): Field[] {
        const out: Field[] = [];
        const { onMessageLook, onLanguage, onSignupNotes, onSignupCharacters } = s;
        if (onLanguage) {
            out.push({ key: "language", node: (
                <CategoryField label={t("settings.categories.language")} sub={t("settings.categories.languageShort")} more={t("settings.categories.languageSub")}>
                    <Segment ariaLabel={t("settings.categories.languageAria", { name })} value={(s.categoryLanguage || {})[cat.id] || ""}
                        onChange={(v) => onLanguage(cat.id, v)} options={languageModes()} />
                </CategoryField>
            ) });
        }
        if (onMessageLook) {
            const look = messageLook(s.categoryMessageLook, cat.id);
            out.push({ key: "raidArt", node: (
                <CategoryField label={t("settings.categories.raidArt")} sub={t("settings.categories.raidArtShort")} more={t("settings.categories.raidArtSub")}>
                    <Toggle checked={look.raidArt} onChange={() => onMessageLook(cat.id, { ...look, raidArt: !look.raidArt })} ariaLabel={t("settings.categories.raidArtAria", { name })} />
                </CategoryField>
            ) });
            out.push({ key: "titleSize", node: (
                <CategoryField label={t("settings.categories.titleSize")} sub={t("settings.categories.titleSizeShort")} more={t("settings.categories.titleSizeSub")}>
                    <Segment ariaLabel={t("settings.categories.titleSizeAria", { name })} value={look.titleSize} onChange={(v) => onMessageLook(cat.id, { ...look, titleSize: v })} options={titleSizes()} />
                </CategoryField>
            ) });
        }
        if (onSignupCharacters) {
            // How many characters one signup may name — in the web, at the message and for "Mehrere Raids".
            out.push({ key: "signupChars", node: (
                <CategoryField label={t("settings.categories.signupChars")} htmlFor={`catchars-${cat.id}`}
                    sub={t("settings.categories.signupCharsShort")} more={t("settings.categories.signupCharsSub")}>
                    <QuotaStepper id={`catchars-${cat.id}`} kind={SIGNUP_CHAR_STEPS} value={signupCharactersOf(s.categorySignupCharacters, cat.id)}
                        ariaLabel={t("settings.categories.signupCharsAria", { name })} onChange={(n) => onSignupCharacters(cat.id, n)} />
                </CategoryField>
            ) });
        }
        if (onSignupNotes) out.push({ key: "notes", node: notesField(onSignupNotes) });
        return out;
    }

    // The category's standing Discord messages: one for the raiders, one for the orga.
    function hubFields(): Field[] {
        const out: Field[] = [];
        if (s.availabilityPanels) out.push({ key: "panel", node: <AvailabilityPanelRow categoryId={cat.id} categoryName={name} panels={s.availabilityPanels} /> });
        if (s.orgaHubs) out.push({ key: "orgaHub", node: <OrgaHubRow categoryId={cat.id} categoryName={name} hubs={s.orgaHubs} /> });
        const { onServerOverview } = s;
        if (onServerOverview) {
            // Missing or true = the category's raids are listed in the server overview (/createoverview scope:server).
            const on = (s.categoryServerOverview || {})[cat.id] !== false;
            out.push({ key: "serverOverview", node: (
                <CategoryField label={t("settings.categories.serverOverview")} sub={t("settings.categories.serverOverviewShort")} more={t("settings.categories.serverOverviewSub")}>
                    <Toggle checked={on} onChange={() => onServerOverview(cat.id, !on)} ariaLabel={t("settings.categories.serverOverviewAria", { name })} />
                </CategoryField>
            ) });
        }
        return out;
    }

    // What the raids are planned with, and who hears about it after the release.
    function planFields(): Field[] {
        const out: Field[] = [];
        const { onSetupDms, onPlanning } = s;
        const planning = planningOf(cat.id, s.categoryPlanning, s.categorySheets);
        if (onPlanning) {
            out.push({ key: "planning", node: (
                <CategoryField label={t("settings.categories.planning")} sub={t("settings.categories.planningShort")} more={t("settings.categories.planningSub")}>
                    <Segment ariaLabel={t("settings.categories.planningAria", { name })} value={planning}
                        onChange={(v) => onPlanning(cat.id, v)} options={planningModes()} />
                </CategoryField>
            ) });
        }
        // The fixed sheet only where the category plans with a sheet (never beside the raid plan).
        if (!onPlanning || planning === "sheet") {
            const sheet = s.categorySheets[cat.id] || { url: "", name: "" };
            out.push({ key: "sheet", node: (
                <CategoryField label={t("settings.categories.fixedSheet")} htmlFor={`catsheet-name-${cat.id}`} sub={t("settings.categories.fixedSheetShort")} more={t("settings.categories.fixedSheetSub")}>
                    <div className="sheet-field">
                        <WowIcon name="googleSheets" size={20} />
                        <div className="sheet-inputs">
                            <input id={`catsheet-name-${cat.id}`} type="text" value={sheet.name} placeholder={t("settings.categories.sheetNamePlaceholder")}
                                onChange={(e) => s.onSheet(cat.id, { ...sheet, name: e.target.value })} />
                            <input type="url" className="mono" aria-label={t("settings.categories.sheetLinkAria")} value={sheet.url} placeholder={t("settings.categories.sheetUrlPlaceholder")}
                                onChange={(e) => s.onSheet(cat.id, { ...sheet, url: e.target.value })} />
                        </div>
                    </div>
                </CategoryField>
            ) });
        }
        if (onSetupDms) {
            const on = (s.categorySetupDms || {})[cat.id] === true;
            out.push({ key: "setupDms", node: (
                <CategoryField label={t("settings.categories.setupDms")} sub={t("settings.categories.setupDmsShort")} more={t("settings.categories.setupDmsSub")}>
                    <Toggle checked={on} onChange={() => onSetupDms(cat.id, !on)} ariaLabel={t("settings.categories.setupDmsAria", { name })} />
                </CategoryField>
            ) });
        }
        return out;
    }

    function lootFields(): Field[] {
        const out: Field[] = [];
        const tool = s.categoryLootTool[cat.id] || "";
        const { onLootSystem } = s;
        if (onLootSystem) {
            out.push({ key: "lootSystem", node: (
                <CategoryField label={t("settings.categories.lootSystem")} sub={t("settings.categories.lootSystemShort")}
                    more={t("settings.categories.lootSystemSub", { auto: tool === "rclc" ? t("settings.categories.lootSystemAutoRclc") : "Softres" })}>
                    <Segment ariaLabel={t("settings.categories.lootSystemAria", { name })} value={(s.categoryLootSystem || {})[cat.id] || ""} onChange={(v) => onLootSystem(cat.id, v)} options={lootSystems()} />
                </CategoryField>
            ) });
        }
        out.push({ key: "lootTool", node: (
            <CategoryField label={t("settings.categories.lootAddon")} sub={t("settings.categories.lootAddonShort")} more={t("settings.categories.lootAddonSub")}>
                <Segment ariaLabel={t("settings.categories.lootAddonAria", { name })} value={tool} onChange={(v) => s.onLootTool(cat.id, v)} options={lootTools()} />
            </CategoryField>
        ) });
        return out;
    }

    return (
        <div className="cat-detail">
            <div className="cat-tabs" role="tablist" aria-label={t("settings.categories.tabsAria", { name })} ref={list} onKeyDown={onKey}>
                {offered.map((id) => {
                    const on = id === shown;
                    return (
                        <button key={id} type="button" role="tab" id={tabId(id)} aria-selected={on} aria-controls={panelId(id)} tabIndex={on ? 0 : -1}
                            className={`cat-tab${on ? " is-active" : ""}`} onClick={() => onTab(id)}>
                            <span className="cat-tab-icon" aria-hidden="true">{TAB_ICONS[id]}</span>
                            {t(`settings.categories.tabs.${id}`)}
                            <span className="cat-tab-count">{fields[id].length}</span>
                        </button>
                    );
                })}
            </div>
            <div className="cat-tabpanel" role="tabpanel" id={panelId(shown)} aria-labelledby={tabId(shown)}>
                <p className="cat-tab-intro">{t(`settings.categories.tabsIntro.${shown}`)}</p>
                {fields[shown].map((f) => <div key={f.key} className="cat-field-wrap" data-field={f.key}>{f.node}</div>)}
            </div>
        </div>
    );
}
