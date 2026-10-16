import { get, send } from "./client";
import type { Role } from "./settings";

// ---- Addon-Downloadzentrale im Discord (src/web/apiRoutes/addonCenter.js) ----
// One bot message in a channel: every addon of the channel's game version with a
// download button and a patch notes link; a set role is pinged on a new version. Full admins only; every
// change is saved at once (no save bar) and answers the whole view again.

/** `versionId` "" = automatic: the game version of the channel's category. */
export type AddonCenterSettings = { channelId: string; roleId: string; versionId: string };

/** A game version the centre can show. */
export type AddonCenterVersion = { id: string; label: string };

/** The posted message: where, since when, its link ("" while Discord has not confirmed it). */
export type AddonCenterPost = { channelId: string; postedAt: number; url: string };

export type AddonCenterChannel = {
    id: string;
    name: string;
    guildId: string;
    /** The game version its category plays (and the server, when there are two). */
    category: string;
};

export type AddonCenterView = {
    settings: AddonCenterSettings;
    center: AddonCenterPost | null;
    /** The last version check (ms), 0 = none yet. */
    checkedAt: number;
    /** Whether the bot is connected to Discord. */
    online: boolean;
    channels: AddonCenterChannel[];
    /** The roles per server id: the update role lives on the centre's server. */
    roles: Record<string, Role[]>;
    /** The game versions to pick from (the visible ones). */
    versions: AddonCenterVersion[];
    /** What "automatic" means for the chosen channel, null without a channel. */
    autoVersion: AddonCenterVersion | null;
    /** The settings were saved, but moving the centre failed (why). */
    warning?: string;
};

export const getAddonCenter = () => get<AddonCenterView>("/api/addon-center");

/** Save some settings at once; another channel moves a posted centre there. */
export function saveAddonCenter(patch: Partial<AddonCenterSettings>): Promise<AddonCenterView> {
    return send("PUT", "/api/addon-center", patch);
}

/** Post the centre (again: the old message is deleted). */
export function postAddonCenter(): Promise<AddonCenterView> {
    return send("POST", "/api/addon-center", {});
}

/** Take the centre down. */
export function removeAddonCenter(): Promise<AddonCenterView> {
    return send("DELETE", "/api/addon-center", {});
}
