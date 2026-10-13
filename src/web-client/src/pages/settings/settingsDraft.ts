import type { AdminConfig, RolePermissions, Access, TopItem, EventSource, PlanningMode } from "../../api";
import { type CategorySheet } from "./CategoryMatrix";
import { blockOf, type VersionSettingsBlock } from "../../lib/settings/versionLinks";
import { disabledFromConfig } from "../../lib/settings/versionFeatures";
import { discordVisualsOf, type CategoryAttendance, type DiscordVisualKey } from "../../lib/settings/settingsLogic";
import type { SwitchFix } from "../../lib/settings/categoryVersions";

export const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

// The page's shared draft: everything the save bar counts. The connections are
// not part of it — each connection modal saves its own block — and neither are
// the raidsheets and the raider → character assignment, which save themselves.
export type Draft = {
    adminRoleIds: string[];
    rolePermissions: RolePermissions;
    // What every logged-in account gets without a role (see RolePermissions.tsx).
    baseAccess: Access;
    // Rights handed to single Discord accounts rather than to a role.
    userPermissions: RolePermissions;
    // The roles that count as orga; every other role is a raider role.
    orgaRoleIds: string[];
    officerRoleId: string;
    applicationChannelId: string;
    categoryIds: string[];
    categoryRoles: Record<string, string[]>;
    logChannelIds: string[];
    raidChannelId: string;
    categoryLootTool: Record<string, string>;
    categoryLootSystem: Record<string, string>;
    categorySignupSource: Record<string, EventSource>;
    /** Not saved from here — read so an unset category shows the source it really gets. */
    signupSourceDefault: EventSource;
    categorySetupDms: Record<string, boolean>;
    categoryLanguage: Record<string, string>;
    /** Attendance per category (Abwesenheiten page); missing = the defaults (see settingsLogic's attendanceOf). */
    categoryAttendance: Record<string, Partial<CategoryAttendance>>;
    categoryDiscordEvent: Record<string, boolean>;
    categoryVoiceChannel: Record<string, string>;
    /** The look of the signup message; missing = raid picture on, title "large". */
    categoryMessageLook: Record<string, { raidArt?: boolean; titleSize?: string }>;
    /** "Beim Anlegen ankündigen" per category (#306); missing = off. */
    categoryAnnounce: Record<string, { enabled: boolean; target: string }>;
    /** The message with "Vielleicht" / "Absagen"; missing = "optional". */
    categorySignupNotes: Record<string, string>;
    /** Where those messages go (#335); missing = the default channel. */
    categorySignupNoteChannel: Record<string, string>;
    /** Characters per signup (1..8); missing = 8, a category set back to 8 is sent as 8 (the server drops it). */
    categorySignupCharacters: Record<string, number>;
    categorySheets: Record<string, CategorySheet>;
    /** Raid plan or sheet per category; only picked modes (see settingsLogic's planningOf). */
    categoryPlanning: Record<string, PlanningMode>;
    categoryRaidTemplate: Record<string, string>;
    /** Einstellungen → Spielversion (#541). */
    mainVersion: string;
    /** Category id → version (#738: fixed per category); missing = a category switched on just now, saved with the main version. */
    categoryVersion: Record<string, string>;
    /** What the switch dialog chose for a switched category's series (#738), sent with the save. */
    categorySwitchFixes: Record<string, SwitchFix>;
    /** "Andere Versionen ausblenden" (#563). */
    hideOtherVersions: boolean;
    /** Language of the bot's public messages (default for every raider). */
    botLanguage: "de" | "en";
    /** The drawn pictures in bot messages (a test), every switch as a boolean. */
    discordVisuals: Record<DiscordVisualKey, boolean>;
    /** "Neue Gildenrekorde posten" (Dungeon-Bestzeiten): off by default. */
    dungeonRecords: { post: boolean; channelId: string };
    /** Settings per game version (#542), every version the server sent. */
    versionSettings: Record<string, VersionSettingsBlock>;
    /** The features switched off per version (#761, "Funktionen je Version"), sent inside versionSettings. */
    versionDisabled: Record<string, string[]>;
    topItems: TopItem[];
};

export function toDraft(config: AdminConfig): Draft {
    return {
        // The access keys are absent for a non-admin who only holds write on "Einstellungen".
        adminRoleIds: config.adminRoleIds || [],
        rolePermissions: config.rolePermissions || {},
        baseAccess: config.baseAccess || {},
        userPermissions: config.userPermissions || {},
        orgaRoleIds: config.orgaRoleIds || [],
        officerRoleId: config.officerRoleId || "",
        applicationChannelId: config.applicationChannelId || "",
        categoryIds: config.categoryIds || [],
        categoryRoles: config.categoryRoles || {},
        logChannelIds: config.logChannelIds || [],
        raidChannelId: config.raidDefaults?.channelId || "",
        categoryLootTool: config.categoryLootTool || {},
        categoryLootSystem: config.categoryLootSystem || {},
        categorySignupSource: config.categorySignupSource || {},
        signupSourceDefault: config.signupSourceDefault || "raidhelper",
        categorySetupDms: config.categorySetupDms || {},
        categoryLanguage: config.categoryLanguage || {},
        categoryAttendance: config.categoryAttendance || {},
        categoryDiscordEvent: config.categoryDiscordEvent || {},
        categoryVoiceChannel: config.categoryVoiceChannel || {},
        categoryMessageLook: config.categoryMessageLook || {},
        categoryAnnounce: config.categoryAnnounce || {},
        categorySignupNotes: config.categorySignupNotes || {},
        categorySignupNoteChannel: config.categorySignupNoteChannel || {},
        categorySignupCharacters: config.categorySignupCharacters || {},
        categorySheets: config.categorySheets || {},
        categoryPlanning: config.categoryPlanning || {},
        categoryRaidTemplate: config.categoryRaidTemplate || {},
        mainVersion: config.mainVersion || "tbc",
        // #738: an active category stored without a version (before the start-up
        // migration) plays the saved main version — written down with the next save.
        categoryVersion: {
            ...Object.fromEntries((config.categoryIds || []).map((id) => [id, config.mainVersion || "tbc"])),
            ...(config.categoryVersion || {}),
        },
        categorySwitchFixes: {},
        hideOtherVersions: config.hideOtherVersions === true,
        botLanguage: config.botLanguage === "en" ? "en" : "de",
        discordVisuals: discordVisualsOf(config.discordVisuals),
        dungeonRecords: { post: config.dungeonRecords?.post === true, channelId: config.dungeonRecords?.channelId || "" },
        versionSettings: Object.fromEntries(Object.entries(config.versionSettings || {}).map(([id, block]) => [id, blockOf(block)])),
        versionDisabled: disabledFromConfig(config.versionSettings),
        topItems: config.topItems || [],
    };
}
