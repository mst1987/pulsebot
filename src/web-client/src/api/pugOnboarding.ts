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

/** What a category still lacks: hidden for @everyone, visible for the version role and the bot. */
export type PugCategoryGap = "everyone" | "version" | "bot";

export type PugCategory = {
    id: string;
    name: string;
    versionId: string;
    roleKey: string;
    status: "changed" | "same";
    missing: PugCategoryGap[];
};

export type PugPrerequisite = {
    key: "community" | "manageRoles" | "manageGuild" | "roleOrder";
    /** null = not knowable */
    ok: boolean | null;
    /** roleOrder: the roles above the bot */
    roles?: string[];
};

export type PugOnboardingOverview = {
    guildId: string;
    guildName: string;
    online: boolean;
    /** the last apply: ISO time and who pressed the button */
    applied: { at: string; by: string } | null;
    pugCategories?: { id: string; name: string; versionId: string }[];
    otherCategories?: { id: string; name: string; rule: string }[];
    roles?: PugRole[];
    prompts?: PugPrompt[];
    categories?: PugCategory[];
    changes?: number;
    onboarding?: { enabled: boolean; mode: number; defaultChannels: number } | null;
    onboardingError?: string;
    prerequisites?: PugPrerequisite[];
};

export type PugApplyResult = {
    done: { roles: number; categories: number; onboarding: boolean };
    overview: PugOnboardingOverview;
};

/** GET /api/discord/pug-onboarding — the wanted state next to what Discord has. */
export function getPugOnboarding(guildId?: string): Promise<PugOnboardingOverview> {
    const q = guildQuery(guildId);
    return get(`/api/discord/pug-onboarding${q ? `?${q}` : ""}`);
}

/** POST /api/discord/pug-onboarding — takes roles, category rights and the onboarding questions over. */
export function applyPugOnboarding(guildId: string): Promise<PugApplyResult> {
    return send("POST", "/api/discord/pug-onboarding", { guildId });
}
