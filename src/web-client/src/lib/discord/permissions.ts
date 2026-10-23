// The Discord permissions as the roles page shows them (System › Discord › Rollen).
//
// The server sends discord.js flag names only ("ManageRoles"); the groups, their
// order and the labels live here and in i18n/locales/<lang>/discord.json
// (`discord.perm.<key>`). The groups follow Discord's own role settings, so a
// permission sits where an admin looks for it in Discord. A key this list does
// not know yet (Discord adds new ones) lands in "advanced" under its raw name.
import { t, tOr } from "../../i18n";

export type PermissionGroup = "general" | "members" | "text" | "voice" | "events" | "advanced";

export const PERMISSION_GROUPS: { id: PermissionGroup; keys: string[] }[] = [
    {
        id: "general",
        keys: [
            "ViewChannel", "ManageChannels", "ManageRoles", "CreateGuildExpressions", "ManageGuildExpressions",
            "ManageEmojisAndStickers", "ViewAuditLog", "ViewGuildInsights", "ManageWebhooks", "ManageGuild",
            "ViewCreatorMonetizationAnalytics",
        ],
    },
    {
        id: "members",
        keys: ["CreateInstantInvite", "ChangeNickname", "ManageNicknames", "KickMembers", "BanMembers", "ModerateMembers"],
    },
    {
        id: "text",
        keys: [
            "SendMessages", "SendMessagesInThreads", "CreatePublicThreads", "CreatePrivateThreads", "EmbedLinks",
            "AttachFiles", "AddReactions", "UseExternalEmojis", "UseExternalStickers", "MentionEveryone",
            "ManageMessages", "PinMessages", "BypassSlowmode", "ManageThreads", "ReadMessageHistory",
            "SendTTSMessages", "SendVoiceMessages", "SendPolls", "UseApplicationCommands", "UseEmbeddedActivities",
            "UseExternalApps",
        ],
    },
    {
        id: "voice",
        keys: [
            "Connect", "Speak", "Stream", "UseSoundboard", "UseExternalSounds", "UseVAD", "PrioritySpeaker",
            "MuteMembers", "DeafenMembers", "MoveMembers", "SetVoiceChannelStatus", "RequestToSpeak",
        ],
    },
    { id: "events", keys: ["CreateEvents", "ManageEvents"] },
    { id: "advanced", keys: ["Administrator"] },
];

/** Every permission the page knows, in group order. */
export const ALL_PERMISSIONS: string[] = PERMISSION_GROUPS.flatMap((g) => g.keys);

/**
 * The permissions that let a role change or harm the server — the same list as
 * SENSITIVE in src/services/discord/roleHygiene.js (the server marks them per role
 * and counts them for the overview; this copy highlights them in the full list).
 * test/services/discord/serverRoles.test.js keeps both lists equal.
 */
export const SENSITIVE_PERMISSIONS: ReadonlySet<string> = new Set([
    "Administrator", "ManageGuild", "ManageRoles", "ManageChannels",
    "BanMembers", "KickMembers", "MentionEveryone", "ManageWebhooks",
]);

/** The label of a permission in the active language; an unknown key stays as it is. */
export function permissionLabel(key: string): string {
    return tOr(`discord.perm.${key}`, key);
}

/** The heading of a permission group. */
export function permissionGroupLabel(group: PermissionGroup): string {
    return t(`discord.permGroup.${group}`);
}

export type PermissionRow = { key: string; label: string; set: boolean; sensitive: boolean };

/**
 * The groups with their permissions for one role: only the set ones, or every
 * known one when `all` is on. Empty groups are left out; keys the list does not
 * know join "advanced".
 */
export function groupPermissions(set: string[], all: boolean): { id: PermissionGroup; label: string; rows: PermissionRow[] }[] {
    const has = new Set(set);
    const known = new Set(ALL_PERMISSIONS);
    const unknown = set.filter((k) => !known.has(k));
    return PERMISSION_GROUPS
        .map((g) => {
            const keys = g.id === "advanced" ? [...g.keys, ...unknown] : g.keys;
            const rows = keys
                .filter((k) => all || has.has(k))
                .map((k) => ({ key: k, label: permissionLabel(k), set: has.has(k), sensitive: SENSITIVE_PERMISSIONS.has(k) }));
            return { id: g.id, label: permissionGroupLabel(g.id), rows };
        })
        .filter((g) => g.rows.length > 0);
}
