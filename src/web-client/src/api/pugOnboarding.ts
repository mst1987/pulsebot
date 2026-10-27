import { get, send } from "./client";
import { guildQuery } from "./discordOverview";

// Roles & onboarding of a PuG server (#906): the contract is the header of
// src/web/apiRoutes/pugOnboarding.js, the shapes come from
// src/services/discord/pugOnboarding.js, the overview is docs/discord-servers.md.

/** "new" = missing in Discord, "changed" = differs, "same" = as wanted, "lost" = goes away on apply. */
export type PugItemStatus = "new" | "changed" | "same" | "lost";

export type PugRole = {
    key: string;
    kind: "version" | "class";
    /** the version or class id */
    id: string;
    name: string;
    /** "#rrggbb", "" = no colour */
    color: string;
    status: Exclude<PugItemStatus, "lost">;
    /** the Discord role, "" while it does not exist */
    roleId: string;
    current: { name: string; color: string } | null;
    categoryIds: string[];
    /** a found role that would grant more than its purpose (bot right, permissions, a channel): the apply refuses */
    privileged: { code: string; detail: string } | null;
};

export type PugPromptOption = { title: string; roleKey: string; status: PugItemStatus; id: string };

export type PugPrompt = {
    /** "versions" | "classes"; "" for a question of someone else that the apply removes */
    key: string;
    title: string;
    required: boolean;
    status: PugItemStatus;
    id: string;
    options: PugPromptOption[];
};

/** What a category still lacks: hidden for @everyone, visible for the version role, the orga roles and the bot. */
export type PugCategoryGap = "everyone" | "version" | "orga" | "bot";

export type PugChannel = { id: string; name: string };

export type PugCategory = {
    id: string;
    name: string;
    versionId: string;
    roleKey: string;
    status: "changed" | "same";
    missing: PugCategoryGap[];
    /** the orga roles that do not see the category yet */
    orga: PugChannel[];
    /** channels that follow the category's rights (synced again after the apply) */
    synced: PugChannel[];
    /** channels with their own rights that stay visible to everyone */
    unsynced: PugChannel[];
};

export type PugPrerequisite = {
    key: "community" | "manageRoles" | "manageGuild" | "roleOrder" | "categoryAccess" | "selfAssign";
    /** null = not knowable */
    ok: boolean | null;
    /** roleOrder: the roles above the bot; selfAssign: the roles that grant more than their purpose */
    roles?: string[];
    /** categoryAccess: the categories where the bot lacks View Channel or Manage Roles */
    categories?: string[];
};

export type PugOnboardingOverview = {
    guildId: string;
    guildName: string;
    online: boolean;
    /** the last apply: ISO time and who pressed the button */
    applied: { at: string; by: string } | null;
    /** `selected` = switched on (the apply covers it), `fallback` = the version is only the default */
    pugCategories?: { id: string; name: string; versionId: string; fallback: boolean; selected: boolean }[];
    otherCategories?: { id: string; name: string; rule: string }[];
    roles?: PugRole[];
    prompts?: PugPrompt[];
    categories?: PugCategory[];
    changes?: number;
    onboarding?: { enabled: boolean; mode: number; defaultChannels: number } | null;
    onboardingError?: string;
    prerequisites?: PugPrerequisite[];
    /** a hash of what the apply would do; the POST sends it back, a mismatch is 409 changed */
    fingerprint?: string;
};

export type PugApplyResult = {
    done: { roles: number; categories: number; channels: number; onboarding: boolean };
    overview: PugOnboardingOverview;
};

/** GET /api/discord/pug-onboarding — the wanted state next to what Discord has. */
export function getPugOnboarding(guildId?: string, categoryIds?: string[]): Promise<PugOnboardingOverview> {
    const parts = [guildQuery(guildId), categoryIds ? `categories=${categoryIds.map(encodeURIComponent).join(",")}` : ""].filter(Boolean);
    return get(`/api/discord/pug-onboarding${parts.length ? `?${parts.join("&")}` : ""}`);
}

/** POST /api/discord/pug-onboarding — takes roles, category rights and the onboarding questions over. */
export function applyPugOnboarding(guildId: string, categoryIds: string[], fingerprint: string): Promise<PugApplyResult> {
    return send("POST", "/api/discord/pug-onboarding", { guildId, categoryIds, fingerprint });
}
