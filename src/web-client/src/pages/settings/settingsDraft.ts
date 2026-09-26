import type { AdminConfig, RolePermissions, Access, TopItem, EventSource } from "../../api";
import { type CategorySheet } from "../../components/CategoryMatrix";

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
    categorySheets: Record<string, CategorySheet>;
    categoryRaidTemplate: Record<string, string>;
    topItems: TopItem[];
};

export function toDraft(config: AdminConfig): Draft {
    return {
        // The access keys are absent for a non-admin who only holds write on "Einstellungen".
        adminRoleIds: config.adminRoleIds || [],
        rolePermissions: config.rolePermissions || {},
        baseAccess: config.baseAccess || {},
        userPermissions: config.userPermissions || {},
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
        categoryDiscordEvent: config.categoryDiscordEvent || {},
        categoryVoiceChannel: config.categoryVoiceChannel || {},
        categoryMessageLook: config.categoryMessageLook || {},
        categoryAnnounce: config.categoryAnnounce || {},
        categorySignupNotes: config.categorySignupNotes || {},
        categorySignupNoteChannel: config.categorySignupNoteChannel || {},
        categorySheets: config.categorySheets || {},
        categoryRaidTemplate: config.categoryRaidTemplate || {},
        topItems: config.topItems || [],
    };
}
