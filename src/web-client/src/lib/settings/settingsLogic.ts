// The pure rules behind the Einstellungen page, kept apart from the components so
// src/web-client/src/lib/settings/settingsLogic.test.ts can run them in plain Node.
//
// Written so that stripping the signature's annotations leaves valid JavaScript:
// every function is `export function name(params): Result {` on one line, and
// no body uses type syntax (no `as`, no generics, no annotated locals). The test
// relies on exactly that; keep it when adding a function here.
import type { AreaAccess, ReminderRule, RoleSyncRule, TalkOverviewStatus } from "../../api";
import { t, tOr } from "../../i18n";
import { changedFeatureVersions } from "./versionFeatures";

export type Level = "none" | "read" | "write";
export type Grants = Record<string, AreaAccess | undefined>;
export type GrantMap = Record<string, Grants>;
export type NameOf = (id: string) => string;

/** "aus" · "Lesen" · "Schreiben", in the active language. */
export function levelLabel(level: Level): string {
    return t(`settings.level.${level}`);
}

/** An area's name and description: the translation for its id, else what the server sent. */
export function areaLabel(area: { id: string; label: string }): string {
    return tOr(`settings.areas.${area.id}.label`, area.label);
}

export function areaDescription(area: { id: string; description: string }): string {
    return tOr(`settings.areas.${area.id}.description`, area.description);
}

// ---- permission matrix: one tri-state cell per owner × area ----

/** The level a stored grant stands for; write always implies read. */
export function levelOf(grant: AreaAccess | undefined): Level {
    if (grant && grant.write) return "write";
    if (grant && grant.read) return "read";
    return "none";
}

/** The stored shape of a level. */
export function grantOf(level: Level): AreaAccess {
    return { read: level !== "none", write: level === "write" };
}

/** One click on a cell: aus › Lesen › Schreiben › aus. */
export function nextLevel(level: Level): Level {
    if (level === "none") return "read";
    if (level === "read") return "write";
    return "none";
}

/** The grants with one area set to a level; "aus" removes the entry instead of storing two falses. */
export function withLevel(grants: Grants | undefined, areaId: string, level: Level): Grants {
    const out = { ...(grants || {}) };
    if (level === "none") delete out[areaId];
    else out[areaId] = grantOf(level);
    return out;
}

/** How many owners of a map hold at least read resp. write on an area (the column head's tooltip). */
export function areaCounts(maps: Grants[], areaId: string): { read: number; write: number } {
    let read = 0;
    let write = 0;
    for (const grants of maps) {
        const level = levelOf(grants && grants[areaId]);
        if (level === "read") read += 1;
        if (level === "write") write += 1;
    }
    return { read, write };
}

/** Discord ids are 17–20 digit snowflakes; anything else is a typo that could never log in. */
export function isDiscordId(value: string): boolean {
    return /^\d{17,20}$/.test(String(value || "").trim());
}

/** Every owner × area whose level differs, as "@Raidlead · Historie → Schreiben". */
export function permissionChanges(before: GrantMap, after: GrantMap, ownerName: NameOf, areaName: NameOf): string[] {
    const out: string[] = [];
    const owners = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
    for (const owner of owners) {
        const a = (before || {})[owner] || {};
        const b = (after || {})[owner] || {};
        const areas = [...new Set([...Object.keys(a), ...Object.keys(b)])];
        for (const area of areas) {
            const from = levelOf(a[area]);
            const to = levelOf(b[area]);
            if (from !== to) out.push(t("settings.changes.perm", { owner: ownerName(owner), area: areaName(area), level: levelLabel(to) }));
        }
        const added = !(before || {})[owner] && (after || {})[owner];
        const removed = (before || {})[owner] && !(after || {})[owner];
        if (added && !areas.length) out.push(t("settings.changes.added", { name: ownerName(owner) }));
        if (removed && !areas.length) out.push(t("settings.changes.removed", { name: ownerName(owner) }));
    }
    return out;
}

// ---- the save bar: what differs between the saved config and the draft ----

/** The drawn pictures in bot messages, in the order the settings show them. */
export const DISCORD_VISUAL_KEYS = ["overviewWeekStrip", "setupImage", "eventCover"] as const;
export type DiscordVisualKey = (typeof DISCORD_VISUAL_KEYS)[number];

/** Every switch as a boolean: missing = on (the server's default). */
export function discordVisualsOf(raw: Partial<Record<DiscordVisualKey, boolean>> | undefined): Record<DiscordVisualKey, boolean> {
    return Object.fromEntries(DISCORD_VISUAL_KEYS.map((key) => [key, (raw || {})[key] !== false])) as Record<DiscordVisualKey, boolean>;
}

export type DraftShape = {
    adminRoleIds: string[];
    rolePermissions: GrantMap;
    baseAccess: Grants;
    userPermissions: GrantMap;
    orgaRoleIds?: string[];
    officerRoleId: string;
    applicationChannelId: string;
    categoryIds: string[];
    categoryRoles: Record<string, string[]>;
    logChannels: { channelId: string; versionId?: string }[];
    raidChannelId: string;
    categoryLootTool: Record<string, string>;
    /** The loot system per category; missing/"" = automatic from the loot addon. */
    categoryLootSystem?: Record<string, string>;
    categorySignupSource?: Record<string, string>;
    /** The source of a category without an entry (#291); missing = "raidhelper". */
    signupSourceDefault?: string;
    categorySetupDms?: Record<string, boolean>;
    categoryLanguage?: Record<string, string>;
    /** Attendance per category; missing = shown, over the last 11 raids, in the absence overview. */
    categoryAttendance?: Record<string, Partial<CategoryAttendance>>;
    /** A Discord event per raid (#305); missing = off. */
    categoryDiscordEvent?: Record<string, boolean>;
    /** The voice channel a category's raids meet in (#305); missing = none. */
    categoryVoiceChannel?: Record<string, string>;
    /** The look of the signup message; missing = raid picture on, title "large". */
    categoryMessageLook?: Record<string, { raidArt?: boolean; titleSize?: string }>;
    categoryAnnounce?: Record<string, { enabled: boolean }>;
    /** The message with "Vielleicht" / "Absagen"; missing = "optional". */
    categorySignupNotes?: Record<string, string>;
    /** Where those messages go (#335); missing = the default channel. */
    categorySignupNoteChannel?: Record<string, string>;
    /** Characters per signup (1..8); missing = 8. */
    categorySignupCharacters?: Record<string, number>;
    categorySheets: Record<string, { url: string; name: string }>;
    /** Raid plan or sheet per category; only picked modes. */
    categoryPlanning?: Record<string, string>;
    categoryRaidTemplate?: Record<string, string>;
    /** The main game version (#541); missing = "tbc". */
    mainVersion?: string;
    /** Category id → version; missing/"" = the main version. */
    categoryVersion?: Record<string, string>;
    /** "Andere Versionen ausblenden" (#563): only the main version everywhere. */
    hideOtherVersions?: boolean;
    botLanguage?: "de" | "en";
    /** Whether the active server keeps its own bot language (#924). */
    botLanguageOwn?: boolean;
    /** The drawn pictures in bot messages (a test); missing switch = on. */
    discordVisuals?: Partial<Record<DiscordVisualKey, boolean>>;
    /** "Neue Gildenrekorde posten" (Dungeon-Bestzeiten); missing = off. */
    dungeonRecords?: { post?: boolean; channelId?: string };
    /** Settings per version (#542): version id → { field → value }. */
    versionSettings?: Record<string, Record<string, string>>;
    /** The features switched off per version (#761). */
    versionDisabled?: Record<string, string[]>;
    topItems: { id: number }[];
};

export type ChangeNames = { role: NameOf; user: NameOf; area: NameOf; category: NameOf; version?: NameOf };

// The draft field and the key of its label (translated when the line is built).
const SIMPLE_FIELDS: ["officerRoleId" | "applicationChannelId" | "raidChannelId", string][] = [
    ["officerRoleId", "settings.page.officerRole"],
    ["applicationChannelId", "settings.page.appChannel"],
    ["raidChannelId", "settings.page.raidChannel"],
];

/** The loot addon's name; "" = none. The addons themselves are proper names. */
export function lootToolLabel(tool: string): string {
    if (tool === "gargul") return "Gargul";
    if (tool === "rclc") return "RCLootcouncil";
    return tool ? tool : t("settings.lootTool.none");
}

/** The loot system's name; "" = automatic from the loot addon. */
export function lootSystemLabel(system: string): string {
    if (system === "softres") return "Softres";
    if (system === "gdkp") return "GDKP";
    if (system === "lootcouncil") return t("settings.lootSystem.lootcouncil");
    if (system === "other") return t("settings.lootSystem.otherSystem");
    return system ? system : t("settings.lootSystem.auto");
}

/** "Beim Anlegen ankündigen" (#306) as one value: "" = off, "event" = in the event channel (#894: no other target). */
export function announceLabel(mode: string): string {
    return mode ? t("settings.announce.event") : t("settings.announce.off");
}

export function announceMode(entry: { enabled: boolean } | undefined): string {
    return entry && entry.enabled ? "event" : "";
}

/** The message with "Vielleicht" / "Absagen" per category: required, optional (the default) or not asked. */
export function signupNoteLabel(mode: string): string {
    return t(`settings.signupNote.${mode === "required" || mode === "none" ? mode : "optional"}`);
}

export function signupNoteMode(map: Record<string, string> | undefined, categoryId: string): string {
    const mode = (map || {})[categoryId];
    return mode === "required" || mode === "none" ? mode : "optional";
}

/**
 * The channel select of "Nachricht bei Vielleicht/Absage" per category (#335):
 * the label of the default choice and whether the category's own channel is
 * out of the bot's reach (the server then posts to the default instead). With
 * no channel list (bot offline) nothing is judged unreachable.
 */
export function noteChannelPick(channels: { id: string; name: string }[], defaultId: string, value: string): { defaultLabel: string; unreachable: boolean } {
    const standard = defaultId ? channels.find((c) => c.id === defaultId) : undefined;
    let defaultLabel = t("settings.noteChannel.default");
    if (!defaultId) defaultLabel = t("settings.noteChannel.notSet");
    else if (standard) defaultLabel = t("settings.noteChannel.channel", { name: standard.name });
    else if (channels.length) defaultLabel = t("settings.noteChannel.unreachable");
    return { defaultLabel, unreachable: !!value && channels.length > 0 && !channels.some((c) => c.id === value) };
}

/** The tabs of a category's open card (Einstellungen → Kategorien), in their order. */
export const CATEGORY_TABS = ["raider", "events", "message", "hubs", "plan", "loot"] as const;
export type CategoryTab = (typeof CATEGORY_TABS)[number];

/**
 * How a category plans its raids - the client's copy of planningOf() in
 * src/services/events/planning.js: the picked mode, else "sheet" when a fixed
 * sheet is assigned to the category, else "raidplan".
 */
export function planningOf(categoryId: string, planning: Record<string, string> | undefined, sheets: Record<string, { url: string }> | undefined): "raidplan" | "sheet" {
    const picked = (planning || {})[categoryId];
    if (picked === "raidplan" || picked === "sheet") return picked;
    const sheet = (sheets || {})[categoryId];
    return sheet && String(sheet.url || "").trim() ? "sheet" : "raidplan";
}

export function planningLabel(mode: string): string {
    return t(mode === "sheet" ? "settings.planning.sheet" : "settings.planning.raidplan");
}

/** How many own characters one signup may name per category (src/services/signups/signupCharacters.js): 1 to 8, default 8. */
export const SIGNUP_CHARACTERS = { min: 1, max: 8, default: 8 };

/** Whether `n` is a number of characters per signup the server keeps. */
export function validSignupCharacters(n: number): boolean {
    return Number.isInteger(n) && n >= SIGNUP_CHARACTERS.min && n <= SIGNUP_CHARACTERS.max;
}

/** A category's characters per signup: its own setting, else the default 8 (signupCharacters.maxCharactersFor). */
export function signupCharactersOf(map: Record<string, number> | undefined, categoryId: string): number {
    const n = Math.round(Number((map || {})[categoryId]));
    if (!Number.isFinite(n) || (map || {})[categoryId] === undefined) return SIGNUP_CHARACTERS.default;
    return Math.min(SIGNUP_CHARACTERS.max, Math.max(SIGNUP_CHARACTERS.min, n));
}

/** How many last raids a category's attendance quota may count: any whole number in this range (src/stores/configSchema.js, ATTENDANCE_WINDOW_MIN/MAX). */
export const ATTENDANCE_WINDOW = { min: 1, max: 50, default: 11 };
export type CategoryAttendance = { show: boolean; window: number; absences: boolean };

/** Whether `n` is a quota window the server keeps. */
export function validAttendanceWindow(n: number): boolean {
    return Number.isInteger(n) && n >= ATTENDANCE_WINDOW.min && n <= ATTENDANCE_WINDOW.max;
}

/** One category's attendance settings with the defaults filled in: shown, over the last 11 raids, in the overview. */
export function attendanceOf(map: Record<string, Partial<CategoryAttendance>> | undefined, id: string): CategoryAttendance {
    const entry = (map || {})[id] || {};
    const window = Number(entry.window);
    return {
        show: entry.show !== false,
        window: validAttendanceWindow(window) ? window : ATTENDANCE_WINDOW.default,
        absences: entry.absences !== false,
    };
}

/** The change lines of one category's attendance settings. */
function attendanceChanges(saved: DraftShape, draft: DraftShape, id: string, name: string): string[] {
    const was = attendanceOf(saved.categoryAttendance, id);
    const is = attendanceOf(draft.categoryAttendance, id);
    const out: string[] = [];
    if (was.show !== is.show) out.push(t(is.show ? "settings.changes.attendanceOn" : "settings.changes.attendanceOff", { name }));
    if (was.window !== is.window) out.push(t("settings.changes.attendanceWindow", { name, count: is.window }));
    if (was.absences !== is.absences) out.push(t(is.absences ? "settings.changes.absencesOn" : "settings.changes.absencesOff", { name }));
    return out;
}

/** The title sizes of the signup message (src/web/embedLook.js, TITLE_SIZES). */
export const TITLE_SIZES: string[] = ["normal", "large", "huge"];

export function titleSizeLabel(size: string): string {
    return TITLE_SIZES.includes(size) ? t(`settings.titleSize.${size}`) : size;
}

/** One category's message look with the defaults filled in: raid picture on, title "large". */
export function messageLook(map: Record<string, { raidArt?: boolean; titleSize?: string }> | undefined, id: string): { raidArt: boolean; titleSize: string } {
    const entry = (map || {})[id] || {};
    return { raidArt: entry.raidArt !== false, titleSize: TITLE_SIZES.includes(entry.titleSize || "") ? String(entry.titleSize) : "large" };
}

function sameList(a: string[] | undefined, b: string[] | undefined): boolean {
    const x = [...(a || [])].sort();
    const y = [...(b || [])].sort();
    return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * Whether the log-channel list of the draft differs from the saved one (#921).
 * Only a changed list is sent: it belongs to one Discord server, so a save of
 * another field must not write it at all.
 */
export function logChannelsChanged(saved: Pick<DraftShape, "logChannels">, draft: Pick<DraftShape, "logChannels">): boolean {
    const keys = (list: DraftShape["logChannels"] | undefined) => (list || []).map((c) => `${c.channelId}:${c.versionId ?? "*"}`);
    return !sameList(keys(saved.logChannels), keys(draft.logChannels));
}

/**
 * The unsaved changes, one line each — the save bar counts them and shows the
 * first few. An empty list means the draft equals the saved state and the bar
 * stays away.
 */
export function draftChanges(saved: DraftShape, draft: DraftShape, names: ChangeNames): string[] {
    const out: string[] = [];
    const admins = [...new Set([...(saved.adminRoleIds || []), ...(draft.adminRoleIds || [])])];
    for (const id of admins) {
        const was = (saved.adminRoleIds || []).includes(id);
        const is = (draft.adminRoleIds || []).includes(id);
        if (was !== is) out.push(t(is ? "settings.changes.adminAdded" : "settings.changes.adminRemoved", { name: names.role(id) }));
    }
    out.push(...permissionChanges(saved.rolePermissions, draft.rolePermissions, names.role, names.area));
    out.push(...permissionChanges({ base: saved.baseAccess || {} }, { base: draft.baseAccess || {} }, () => t("settings.permissions.base"), names.area));
    out.push(...permissionChanges(saved.userPermissions, draft.userPermissions, names.user, names.area));
    const orga = [...new Set([...(saved.orgaRoleIds || []), ...(draft.orgaRoleIds || [])])];
    for (const id of orga) {
        const was = (saved.orgaRoleIds || []).includes(id);
        const is = (draft.orgaRoleIds || []).includes(id);
        if (was !== is) out.push(t(is ? "settings.changes.orgaAdded" : "settings.changes.orgaRemoved", { name: names.role(id) }));
    }

    const categories = [...new Set([
        ...(saved.categoryIds || []), ...(draft.categoryIds || []),
        ...Object.keys(saved.categoryRoles || {}), ...Object.keys(draft.categoryRoles || {}),
        ...Object.keys(saved.categoryLootTool || {}), ...Object.keys(draft.categoryLootTool || {}),
        ...Object.keys(saved.categoryLootSystem || {}), ...Object.keys(draft.categoryLootSystem || {}),
        ...Object.keys(saved.categorySignupSource || {}), ...Object.keys(draft.categorySignupSource || {}),
        ...Object.keys(saved.categorySetupDms || {}), ...Object.keys(draft.categorySetupDms || {}),
        ...Object.keys(saved.categoryLanguage || {}), ...Object.keys(draft.categoryLanguage || {}),
        ...Object.keys(saved.categoryAttendance || {}), ...Object.keys(draft.categoryAttendance || {}),
        ...Object.keys(saved.categoryDiscordEvent || {}), ...Object.keys(draft.categoryDiscordEvent || {}),
        ...Object.keys(saved.categoryVoiceChannel || {}), ...Object.keys(draft.categoryVoiceChannel || {}),
        ...Object.keys(saved.categoryMessageLook || {}), ...Object.keys(draft.categoryMessageLook || {}),
        ...Object.keys(saved.categoryAnnounce || {}), ...Object.keys(draft.categoryAnnounce || {}),
        ...Object.keys(saved.categorySignupNotes || {}), ...Object.keys(draft.categorySignupNotes || {}),
        ...Object.keys(saved.categorySignupNoteChannel || {}), ...Object.keys(draft.categorySignupNoteChannel || {}),
        ...Object.keys(saved.categorySignupCharacters || {}), ...Object.keys(draft.categorySignupCharacters || {}),
        ...Object.keys(saved.categorySheets || {}), ...Object.keys(draft.categorySheets || {}),
        ...Object.keys(saved.categoryPlanning || {}), ...Object.keys(draft.categoryPlanning || {}),
    ])];
    for (const id of categories) {
        const name = names.category(id);
        const was = (saved.categoryIds || []).includes(id);
        const is = (draft.categoryIds || []).includes(id);
        if (was !== is) out.push(t(is ? "settings.changes.activated" : "settings.changes.deactivated", { name }));
        if (!sameList((saved.categoryRoles || {})[id], (draft.categoryRoles || {})[id])) out.push(t("settings.changes.raiderRoles", { name }));
        const toolWas = (saved.categoryLootTool || {})[id] || "";
        const toolIs = (draft.categoryLootTool || {})[id] || "";
        if (toolWas !== toolIs) out.push(t("settings.changes.lootTool", { name, value: lootToolLabel(toolIs) }));
        const systemWas = (saved.categoryLootSystem || {})[id] || "";
        const systemIs = (draft.categoryLootSystem || {})[id] || "";
        if (systemWas !== systemIs) out.push(t("settings.changes.lootSystem", { name, value: lootSystemLabel(systemIs) }));
        const sourceWas = (saved.categorySignupSource || {})[id] || saved.signupSourceDefault || "raidhelper";
        const sourceIs = (draft.categorySignupSource || {})[id] || draft.signupSourceDefault || saved.signupSourceDefault || "raidhelper";
        if (sourceWas !== sourceIs) out.push(t("settings.changes.newEvents", { name, value: sourceIs === "eventhelper" ? "EventHelper" : "Raid-Helper" }));
        const dmsWas = (saved.categorySetupDms || {})[id] === true;
        const dmsIs = (draft.categorySetupDms || {})[id] === true;
        if (dmsWas !== dmsIs) out.push(t(dmsIs ? "settings.changes.setupDmsOn" : "settings.changes.setupDmsOff", { name }));
        const langWas = (saved.categoryLanguage || {})[id] || "";
        const langIs = (draft.categoryLanguage || {})[id] || "";
        if (langWas !== langIs) out.push(t("settings.changes.language", { name, value: langIs === "en" ? "English" : langIs === "de" ? "Deutsch" : t("settings.categories.languageServer") }));
        out.push(...attendanceChanges(saved, draft, id, name));
        // #305: the Discord event per raid and the voice channel the raids meet in.
        const deWas = (saved.categoryDiscordEvent || {})[id] === true;
        const deIs = (draft.categoryDiscordEvent || {})[id] === true;
        if (deWas !== deIs) out.push(t(deIs ? "settings.changes.discordEventOn" : "settings.changes.discordEventOff", { name }));
        const voiceWas = (saved.categoryVoiceChannel || {})[id] || "";
        const voiceIs = (draft.categoryVoiceChannel || {})[id] || "";
        if (voiceWas !== voiceIs) out.push(t(voiceIs ? "settings.changes.voiceSet" : "settings.changes.voiceRemoved", { name }));
        const lookWas = messageLook(saved.categoryMessageLook, id);
        const lookIs = messageLook(draft.categoryMessageLook, id);
        if (lookWas.raidArt !== lookIs.raidArt) out.push(t(lookIs.raidArt ? "settings.changes.raidArtOn" : "settings.changes.raidArtOff", { name }));
        if (lookWas.titleSize !== lookIs.titleSize) out.push(t("settings.changes.titleSize", { name, value: titleSizeLabel(lookIs.titleSize) }));
        const annWas = announceMode((saved.categoryAnnounce || {})[id]);
        const annIs = announceMode((draft.categoryAnnounce || {})[id]);
        if (annWas !== annIs) out.push(t("settings.changes.announce", { name, value: announceLabel(annIs) }));
        const noteWas = signupNoteMode(saved.categorySignupNotes, id);
        const noteIs = signupNoteMode(draft.categorySignupNotes, id);
        if (noteWas !== noteIs) out.push(t("settings.changes.signupNote", { name, value: signupNoteLabel(noteIs) }));
        const noteChWas = (saved.categorySignupNoteChannel || {})[id] || "";
        const noteChIs = (draft.categorySignupNoteChannel || {})[id] || "";
        if (noteChWas !== noteChIs) out.push(t(noteChIs ? "settings.changes.noteChannelSet" : "settings.changes.noteChannelDefault", { name }));
        const charsWas = signupCharactersOf(saved.categorySignupCharacters, id);
        const charsIs = signupCharactersOf(draft.categorySignupCharacters, id);
        if (charsWas !== charsIs) out.push(t("settings.changes.signupCharacters", { name, count: charsIs }));
        const planWas = planningOf(id, saved.categoryPlanning, saved.categorySheets);
        const planIs = planningOf(id, draft.categoryPlanning, draft.categorySheets);
        if (planWas !== planIs) out.push(t("settings.changes.planning", { name, value: planningLabel(planIs) }));
        const sheetWas = (saved.categorySheets || {})[id] || { url: "", name: "" };
        const sheetIs = (draft.categorySheets || {})[id] || { url: "", name: "" };
        if ((sheetWas.url || "").trim() !== (sheetIs.url || "").trim() || (sheetWas.name || "").trim() !== (sheetIs.name || "").trim()) {
            out.push(t("settings.changes.raidsheet", { name }));
        }
    }

    // The default raid template per category (#266).
    const tplWas = saved.categoryRaidTemplate || {};
    const tplIs = draft.categoryRaidTemplate || {};
    for (const id of [...new Set([...Object.keys(tplWas), ...Object.keys(tplIs)])]) {
        if ((tplWas[id] || "") !== (tplIs[id] || "")) out.push(t("settings.changes.template", { name: names.category(id) }));
    }

    // The game version (#541): the main one, and each category that differs.
    const versionName = (id: string) => (id ? (names.version ? names.version(id) : id) : t("settings.changes.followMain"));
    if ((saved.mainVersion || "tbc") !== (draft.mainVersion || "tbc")) {
        out.push(t("settings.changes.mainVersion", { value: versionName(draft.mainVersion || "tbc") }));
    }
    if (!!saved.hideOtherVersions !== !!draft.hideOtherVersions) {
        out.push(t(draft.hideOtherVersions ? "settings.changes.hideOtherOn" : "settings.changes.hideOtherOff"));
    }
    // The drawn pictures in bot messages (a test): one line per switch that changed.
    for (const key of DISCORD_VISUAL_KEYS) {
        const was = (saved.discordVisuals || {})[key] !== false;
        const is = (draft.discordVisuals || {})[key] !== false;
        if (was !== is) {
            out.push(t("settings.changes.discordVisuals", { name: t(`settings.discordVisuals.${key}`), state: t(is ? "settings.changes.on" : "settings.changes.off") }));
        }
    }
    // The dungeon record post: the switch, and the channel while it is on.
    const recWas = saved.dungeonRecords || {};
    const recIs = draft.dungeonRecords || {};
    if (!!recWas.post !== !!recIs.post) out.push(t(recIs.post ? "settings.changes.dungeonRecordsOn" : "settings.changes.dungeonRecordsOff"));
    if (recIs.post && (recWas.channelId || "") !== (recIs.channelId || "")) out.push(t("settings.changes.dungeonRecordsChannel"));
    const langLabel = t(draft.botLanguage === "en" ? "settings.botLanguage.en" : "settings.botLanguage.de");
    if (saved.botLanguageOwn && !draft.botLanguageOwn) {
        // #924: the server drops its own value and follows the default again
        out.push(t("settings.changes.botLanguageUseDefault", { value: langLabel }));
    } else if ((saved.botLanguage || "de") !== (draft.botLanguage || "de") || (!saved.botLanguageOwn && draft.botLanguageOwn)) {
        out.push(t("settings.changes.botLanguage", { value: langLabel }));
    }
    const verWas = saved.categoryVersion || {};
    const verIs = draft.categoryVersion || {};
    for (const id of [...new Set([...Object.keys(verWas), ...Object.keys(verIs)])]) {
        if ((verWas[id] || "") !== (verIs[id] || "")) out.push(t("settings.changes.categoryVersion", { name: names.category(id), value: versionName(verIs[id] || "") }));
    }
    // Settings per version (#542): one line per version whose block changed.
    const vsWas = saved.versionSettings || {};
    const vsIs = draft.versionSettings || {};
    for (const id of [...new Set([...Object.keys(vsWas), ...Object.keys(vsIs)])]) {
        const was = vsWas[id] || {};
        const is = vsIs[id] || {};
        const changed = [...new Set([...Object.keys(was), ...Object.keys(is)])].some((k) => String(was[k] || "").trim() !== String(is[k] || "").trim());
        if (changed) out.push(t("settings.changes.versionSettings", { value: versionName(id) }));
    }
    // "Funktionen je Version" (#761): one line per version whose switches changed.
    for (const id of changedFeatureVersions(saved.versionDisabled, draft.versionDisabled)) {
        out.push(t("settings.changes.versionFeatures", { value: versionName(id) }));
    }

    for (const [key, labelKey] of SIMPLE_FIELDS) {
        if (String(saved[key] || "").trim() !== String(draft[key] || "").trim()) out.push(t(labelKey));
    }
    // #921: a channel and its version; "*" = not picked yet (the category decides on save).
    if (logChannelsChanged(saved, draft)) out.push(t("settings.page.logChannels"));
    const itemsWas = (saved.topItems || []).map((i) => String(i.id));
    const itemsIs = (draft.topItems || []).map((i) => String(i.id));
    if (itemsWas.join(",") !== itemsIs.join(",")) out.push(t("settings.changes.topItems"));
    return out;
}

// ---- connections: one status card and one self-saving modal each ----

export type ConnectionId = "discord" | "battlenet" | "wcl" | "anthropic" | "github" | "lootsync";
export type ConnectionState = { tone: "ok" | "mid" | "accent" | ""; label: string; missing: boolean };

export type ConnectionInputs = {
    blizzard?: { clientId?: string; hasClientSecret?: boolean };
    anthropic?: { hasApiKey?: boolean };
    warcraftlogsV2?: { clientId?: string; hasClientSecret?: boolean };
    github?: { hasToken?: boolean };
    botOnline?: boolean;
    /** null = not known (not loaded, or not a full admin). */
    tokenCount?: number | null;
};

/** The badge of one connection card, and whether it counts as "nicht eingerichtet". */
export function connectionState(id: ConnectionId, input: ConnectionInputs): ConnectionState {
    if (id === "discord") {
        return input.botOnline ? { tone: "ok", label: t("settings.state.connected"), missing: false } : { tone: "mid", label: t("settings.state.botOffline"), missing: false };
    }
    if (id === "battlenet" || id === "wcl") {
        const block = id === "battlenet" ? input.blizzard : input.warcraftlogsV2;
        const hasId = !!(block && String(block.clientId || "").trim());
        const hasSecret = !!(block && block.hasClientSecret);
        if (hasId && hasSecret) return { tone: "ok", label: t("settings.state.connected"), missing: false };
        if (hasId || hasSecret) return { tone: "mid", label: t(hasId ? "settings.state.secretMissing" : "settings.state.clientIdMissing"), missing: true };
        return { tone: "mid", label: t("settings.state.notSetUp"), missing: true };
    }
    if (id === "anthropic") {
        return input.anthropic && input.anthropic.hasApiKey
            ? { tone: "ok", label: t("settings.state.keyStored"), missing: false }
            : { tone: "mid", label: t("settings.state.keyMissing"), missing: true };
    }
    if (id === "github") {
        return input.github && input.github.hasToken
            ? { tone: "ok", label: t("settings.state.tokenStored"), missing: false }
            : { tone: "mid", label: t("settings.state.tokenMissing"), missing: true };
    }
    if (input.tokenCount === null || input.tokenCount === undefined) return { tone: "", label: t("settings.state.tokens"), missing: false };
    if (input.tokenCount === 0) return { tone: "mid", label: t("settings.state.noToken"), missing: true };
    return { tone: "accent", label: t("settings.state.tokenCount", { count: input.tokenCount }), missing: false };
}

/**
 * The PATCH body of one connection modal — only that connection's block, so
 * saving Battle.net can never overwrite a half-edited category in the page's
 * draft. `secret` follows the server's contract: undefined = keep the stored
 * one, "" = clear it, anything else = replace it.
 */
export function connectionPatch(id: ConnectionId, fields: Record<string, string>, secret: string | undefined): Record<string, unknown> {
    const v = (key: string) => String(fields[key] || "").trim();
    // The server itself is picked under Discord-Server (settings page "Discord-Server").
    if (id === "discord") return { raidhelperServerId: v("raidhelperServerId") };
    if (id === "battlenet") {
        // Only the credentials: the realm is per game version (#542, Einstellungen → Spielversion).
        return { blizzard: { clientId: v("clientId"), ...(secret !== undefined ? { clientSecret: secret } : {}) } };
    }
    if (id === "anthropic") {
        return { anthropic: { model: v("model"), ...(secret !== undefined ? { apiKey: secret } : {}) } };
    }
    if (id === "wcl") {
        return { warcraftlogsV2: { clientId: v("clientId"), ...(secret !== undefined ? { clientSecret: secret } : {}) } };
    }
    // #818: only the token; nothing to send when it stays as it is.
    if (id === "github") return secret !== undefined ? { github: { token: secret } } : {};
    return {};
}

export type SettingsLike = {
    config: { blizzard?: ConnectionInputs["blizzard"]; anthropic?: ConnectionInputs["anthropic"]; warcraftlogsV2?: ConnectionInputs["warcraftlogsV2"]; github?: ConnectionInputs["github"] };
    bot?: { online: boolean };
};

/** What the status of the cards is computed from; `tokens` null = not loaded or not a full admin. */
export function connectionInputs(data: SettingsLike, tokens: unknown[] | null): ConnectionInputs {
    return {
        blizzard: data.config.blizzard,
        anthropic: data.config.anthropic,
        warcraftlogsV2: data.config.warcraftlogsV2,
        github: data.config.github,
        botOnline: !!(data.bot && data.bot.online),
        tokenCount: tokens ? tokens.length : null,
    };
}

/** The connections a user sees — a limited settings user only gets Battle.net (the rest are FULL_ADMIN_KEYS or admin-only ids). */
export function visibleConnections(canManageAccess: boolean): ConnectionId[] {
    return canManageAccess ? ["discord", "battlenet", "wcl", "anthropic", "github", "lootsync"] : ["battlenet"];
}

/** The sidebar badge of "Verbindungen": how many visible connections are not set up. */
export function missingConnections(data: SettingsLike, tokens: unknown[] | null, canManageAccess: boolean): number {
    const inputs = connectionInputs(data, tokens);
    return visibleConnections(canManageAccess).filter((id) => connectionState(id, inputs).missing).length;
}

// ---- Discord-Server: equal servers plus links that post a source's raid list to a target channel (#890, #891) ----

export type ServerCardLike = { connected: boolean; permissions: { label: string; ok: boolean }[] | null; missing: string[] };

/**
 * The status of one server row. `optional`: a missing card is no gap. Rights
 * that cannot be known (bot offline) are said as such, never counted as missing.
 */
export function serverCardState(card: ServerCardLike | null, optional: boolean): ConnectionState {
    if (!card) return optional ? { tone: "", label: t("settings.state.noSecondServer"), missing: false } : { tone: "mid", label: t("settings.state.noServer"), missing: true };
    if (!card.connected) return { tone: "mid", label: t("settings.state.botNotThere"), missing: true };
    if (!card.permissions) return { tone: "", label: t("settings.state.rightsUnknown"), missing: false };
    const n = card.missing.length;
    if (n) return { tone: "mid", label: t("settings.state.rightsMissing", { count: n }), missing: true };
    return { tone: "ok", label: t("settings.state.connected"), missing: false };
}

/**
 * The sidebar badge of "Discord-Server": how many servers need attention. An
 * empty list is not itself an issue (nothing configured yet is not the same as
 * a broken connection) — only entries that exist are scored.
 */
export function serverIssues(servers: { events: ServerCardLike[] } | null | undefined): number {
    if (!servers) return 0;
    return servers.events.filter((card) => serverCardState(card, false).missing).length;
}

export type LinkLike = { from: string; to: string; channelId: string; lang: string; versions: string[] };

/** "Englisch · nur TBC" · "Serversprache · alle Versionen": a link's language and versions in one short line. */
export function linkSummary(link: LinkLike, versions: { id: string; short: string }[]): string {
    const lang = link.lang === "de" || link.lang === "en" ? t(`settings.discordServers.lang.${link.lang}`) : t("settings.discordServers.lang.server");
    const names = link.versions.map((id) => {
        const hit = versions.find((v) => v.id === id);
        return hit ? hit.short : id;
    });
    const which = names.length ? t("settings.discordServers.onlyVersions", { list: names.join(", ") }) : t("settings.discordServers.allVersions");
    return `${lang} · ${which}`;
}

/** A link's raid-list key, as the talk-overview store and API use it (#892). */
export function linkKey(link: LinkLike): string {
    return `${link.from}:${link.to}`;
}

/** The raid-list status that belongs to a link, matched by its key — no fallback to the source alone. */
export function linkStatusOf(link: LinkLike, statuses: TalkOverviewStatus[]): TalkOverviewStatus | null {
    const key = linkKey(link);
    return statuses.find((s) => s.key === key) || null;
}

/**
 * The status column of a link as words: "Aktuell", "Fehler: …" or "noch nicht
 * gepostet"; the times sit in the tooltip (talkOverviewBadge below).
 */
export function linkStatusBadge(status: TalkOverviewStatus | null, now: number): { label: string; tone: "ok" | "mid" | ""; tip: string; tipSub: string } {
    if (!status || !status.configured || (!status.messageId && !status.error)) {
        return { label: t("settings.overviewBadge.notPosted"), tone: "", tip: t("settings.overviewBadge.title"), tipSub: t("settings.overviewBadge.notPostedSub") };
    }
    const badge = talkOverviewBadge(status, now);
    // The error text can be a long sentence: one word in the cell, the text in the tooltip.
    if (status.error) return { ...badge, label: t("settings.discordServers.statusError"), tipSub: status.error };
    return { ...badge, label: t("settings.discordServers.statusCurrent") };
}

/** "keine" · "1 Raid-Kategorie" · "3 Raid-Kategorien" — none is a normal state, a server may only show lists. */
export function raidCategoriesText(count: number): string {
    return count ? t("settings.discordServers.raidCategoryCount", { count }) : t("settings.discordServers.noRaidCategory");
}

// ---- categories: the raid ones as a list, the rest folded away ----

export type RaiderCharSummary = { members: number; assigned: number; error: string | null };

/** The row's "22 / 25": members holding the category's roles, and how many have a fixed character. */
export function summarizeRaiderChars(info: { members: { id: string }[]; assignments: Record<string, string>; membersError: string | null }): RaiderCharSummary {
    const assigned = info.members.filter((m) => String(info.assignments[m.id] || "").trim()).length;
    return { members: info.members.length, assigned, error: info.membersError };
}

export type CategoryRow = { id: string; name: string; unknown: boolean };

/**
 * The guild's live categories plus every configured id Discord no longer knows
 * (a deleted category). Dropping those silently would delete their settings on
 * the next save without anyone seeing it happen.
 */
export function categoryRows(categories: { id: string; name: string }[], configured: string[]): CategoryRow[] {
    const known = new Set(categories.map((c) => c.id));
    const extra: CategoryRow[] = [];
    for (const id of configured) {
        if (known.has(id)) continue;
        known.add(id);
        extra.push({ id, name: id, unknown: true });
    }
    return [...categories.map((c) => ({ id: c.id, name: c.name, unknown: false })), ...extra];
}

/**
 * Which rows the list shows and which fold into "n weitere Discord-Kategorien":
 * the active categories and every unknown id always show; the rest only with
 * "Alle Discord-Kategorien".
 */
export function splitCategoryRows(rows: CategoryRow[], activeIds: string[], showAll: boolean): { shown: CategoryRow[]; folded: CategoryRow[] } {
    const shown: CategoryRow[] = [];
    const folded: CategoryRow[] = [];
    for (const row of rows) {
        if (showAll || row.unknown || activeIds.includes(row.id)) shown.push(row);
        else folded.push(row);
    }
    return { shown, folded };
}

// ---- pings, reminders and role sync between servers (#264, pairs of servers since #896) ----

export type RoleSyncDirection = RoleSyncRule["direction"];

export const DIRECTION_LABEL: Record<RoleSyncDirection, string> = { toTarget: "→", toSource: "←", both: "↔" };
export function directionText(direction: RoleSyncDirection): string {
    return t(`settings.direction.${direction}`);
}

/** The modal hint of ping and sign-up call: both always go to the raid's own channel (#894). */
export function channelHint(eventChannel: string): string | undefined {
    return eventChannel ? t("raidModals.shared.inChannel", { channel: eventChannel }) : undefined;
}

/** The PATCH body of the role mapping: complete pairs only, one per pair, the list replaces the stored one. */
export function roleSyncPatch(rules: RoleSyncRule[]): { roleSync: RoleSyncRule[] } {
    const seen: Set<string> = new Set();
    const out: RoleSyncRule[] = [];
    for (const r of rules) {
        const fromGuildId = String(r.fromGuildId || "").trim();
        const fromRoleId = String(r.fromRoleId || "").trim();
        const toGuildId = String(r.toGuildId || "").trim();
        const toRoleId = String(r.toRoleId || "").trim();
        const key = [fromGuildId, fromRoleId, toGuildId, toRoleId].join(":");
        // #896: two different servers, one role on each; the server drops the rest as well
        if (!fromGuildId || !toGuildId || fromGuildId === toGuildId || !fromRoleId || !toRoleId || seen.has(key)) continue;
        seen.add(key);
        out.push({ fromGuildId, fromRoleId, toGuildId, toRoleId, direction: r.direction || "toTarget" });
    }
    return { roleSync: out };
}

/** Whether a pair is complete enough to save: two different servers and a role on each. */
export function roleRuleReady(rule: RoleSyncRule): boolean {
    return !!(rule.fromGuildId && rule.toGuildId && rule.fromGuildId !== rule.toGuildId && rule.fromRoleId && rule.toRoleId);
}

/** The member overlap of a pair's two servers (the server sorts each pair). */
export function overlapOf<T extends { fromGuildId: string; toGuildId: string }>(overlaps: T[], rule: RoleSyncRule): T | null {
    const [a, b] = [rule.fromGuildId, rule.toGuildId].sort();
    return overlaps.find((o) => o.fromGuildId === a && o.toGuildId === b) || null;
}

/** The servers a pair writes to: toTarget the second, toSource the first, both both. */
export function writtenGuilds(rule: RoleSyncRule): string[] {
    if (rule.direction === "both") return [rule.fromGuildId, rule.toGuildId];
    return [rule.direction === "toSource" ? rule.fromGuildId : rule.toGuildId];
}

/** The mapping with one entry replaced (index) or appended (index -1). */
export function withRoleRule(rules: RoleSyncRule[], index: number, rule: RoleSyncRule): RoleSyncRule[] {
    if (index < 0 || index >= rules.length) return [...rules, rule];
    return rules.map((r, i) => (i === index ? rule : r));
}

/**
 * The small badge of the role sync head: how many members kept a synced role the source lost.
 * `errors`: servers that could not be read while others could; the count stands, the tip names them.
 */
export function driftBadge(total: number, error: string | null, errors: string[] = []): { label: string; tone: "ok" | "mid" | ""; tip: string } {
    if (error) return { label: t("settings.drift.unknown"), tone: "", tip: error };
    const partial = errors.length ? ` ${errors.join(" ")}` : "";
    if (!total) return { label: t("settings.drift.none"), tone: "ok", tip: t("settings.drift.noneTip") + partial };
    return {
        label: t("settings.drift.count", { count: total }),
        tone: "mid",
        tip: t("settings.drift.tip") + partial,
    };
}

/** Whether a category sends no reminder at all. */
export function reminderOff(rule: ReminderRule | null | undefined): boolean {
    return !rule || !(rule.missingHours > 0 || rule.signedHours > 0);
}

/** "24 h vor Schluss · 1 h vor Raid", or "aus". */
export function reminderSummary(rule: ReminderRule | null | undefined): string {
    if (!rule || reminderOff(rule)) return t("settings.reminderSummary.off");
    const parts: string[] = [];
    if (rule.missingHours > 0) parts.push(t("settings.reminderSummary.missing", { hours: rule.missingHours }));
    if (rule.signedHours > 0) parts.push(t("settings.reminderSummary.signed", { hours: rule.signedHours }));
    return parts.join(" · ");
}

/** Hours from an input: whole numbers 1–168, anything else 0 (= off) — the server's rule. */
export function reminderHours(value: unknown): number {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(n, 168);
}

/** The PATCH body with one category's rule set; both hours 0 removes the category. */
export function remindersPatch(current: Record<string, ReminderRule>, categoryId: string, rule: ReminderRule): { categoryReminders: Record<string, ReminderRule> } {
    const next = { ...current };
    const missingHours = reminderHours(rule.missingHours);
    const signedHours = reminderHours(rule.signedHours);
    if (!missingHours && !signedHours) delete next[categoryId];
    else next[categoryId] = { missingHours, signedHours };
    return { categoryReminders: next };
}

// ---- raid list of a link (#257, #892) ----

/** "gerade eben", "vor 5 Min.", "vor 3 Std.", "vor 2 T"; "" for never. */
export function agoText(ms: number, now: number): string {
    if (!ms) return "";
    const minutes = Math.max(0, Math.round((now - ms) / 60000));
    if (minutes < 1) return t("settings.ago.now");
    if (minutes < 60) return t("settings.ago.minutes", { count: minutes });
    const hours = Math.round(minutes / 60);
    if (hours < 48) return t("settings.ago.hours", { count: hours });
    return t("settings.ago.days", { count: Math.round(hours / 24) });
}

/** The overview's one badge: state as label, the times and any error in the tooltip. */
export function talkOverviewBadge(status: TalkOverviewStatus | null, now: number): { label: string; tone: "ok" | "mid" | ""; tip: string; tipSub: string } {
    if (!status || !status.configured) {
        return { label: t("settings.overviewBadge.notSet"), tone: "", tip: t("settings.overviewBadge.title"), tipSub: t("settings.overviewBadge.notSetSub") };
    }
    const times = [
        status.postedAt ? t("settings.overviewBadge.posted", { ago: agoText(status.postedAt, now) }) : "",
        status.editedAt ? t("settings.overviewBadge.edited", { ago: agoText(status.editedAt, now) }) : "",
        status.checkedAt ? t("settings.overviewBadge.checked", { ago: agoText(status.checkedAt, now) }) : "",
    ].filter(Boolean);
    if (status.error) {
        return { label: t("common.error"), tone: "mid", tip: t("settings.overviewBadge.errorTip"), tipSub: [status.error, ...times].join("\n") };
    }
    if (!status.messageId) {
        return { label: t("settings.overviewBadge.notPosted"), tone: "", tip: t("settings.overviewBadge.title"), tipSub: t("settings.overviewBadge.notPostedSub") };
    }
    const label = status.editedAt
        ? t("settings.overviewBadge.editedLabel", { ago: agoText(status.editedAt, now) })
        : t("settings.overviewBadge.postedLabel", { ago: agoText(status.postedAt, now) });
    return {
        label,
        tone: "ok",
        tip: t("settings.overviewBadge.current"),
        tipSub: [...times, t("settings.overviewBadge.currentSub")].join("\n"),
    };
}
