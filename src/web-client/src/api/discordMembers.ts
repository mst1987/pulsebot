import { get } from "./client";
import type { DiscordSide, ServerRolesHead } from "./discordRoles";

// The members of the event and the talk server (System › Discord › Mitglieder):
// the contract is the header of src/web/apiRoutes/discordMembers.js, the
// overview docs/channels.md. Read only.

/** A role as the members page needs it: highest first, without @everyone. */
export type MemberRole = { id: string; name: string; color: string; position: number };

/** An open roster the member is in. */
export type MemberRoster = { id: string; name: string; categoryId: string; versionId: string; status: string };

/** A character of the member, once per version and name; class and version "" when unknown. */
export type MemberCharacter = {
    name: string;
    className: string;
    versionId: string;
    /** the open rosters it stands in (ids of `ServerMember.rosters`) */
    rosterIds: string[];
};

export type ServerMember = {
    id: string;
    name: string;
    username: string;
    avatarUrl: string | null;
    bot: boolean;
    joinedAt: number | null;
    /** highest first */
    roleIds: string[];
    rosters: MemberRoster[];
    characters: MemberCharacter[];
    /** rosters whose member or trial role the member holds without being in them */
    missingRosters: { id: string; name: string }[];
};

export type ServerMembers = ServerRolesHead & { total: number; roles: MemberRole[]; members: ServerMember[] };

export type MemberChannel = { id: string; name: string; kind: "text" | "voice" | "forum" };

/** A category ("" = without category) with the channels the member can see in it. */
export type MemberChannelGroup = { id: string; name: string; visible: number; total: number; channels: MemberChannel[] };

export type ServerMemberDetail = ServerRolesHead & {
    /** the account is not (or no longer) on the server; `member` is null then */
    gone?: boolean;
    member: ServerMember | null;
    roles: MemberRole[];
    channels: MemberChannelGroup[];
};

export function getServerMembers(side: DiscordSide): Promise<ServerMembers> {
    return get(`/api/discord/members?side=${side}`);
}

export function getServerMemberDetail(side: DiscordSide, userId: string): Promise<ServerMemberDetail> {
    return get(`/api/discord/members/detail?side=${side}&userId=${encodeURIComponent(userId)}`);
}
