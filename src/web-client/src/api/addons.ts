import { get } from "./client";

// ── Addons (#818) ────────────────────────────────────────────────────────────
// The guild's own addons with their newest release (src/web/apiRoutes/addons.js),
// cached on the server for ten minutes. Every download link points at the
// server (`/api/addons/download?…`), never at GitHub.

/** One file of a release the addon offers. */
export type AddonFile = {
    name: string;
    /** Bytes. */
    size: number;
    /** Hex SHA-256 when GitHub names one, else "". */
    sha256: string;
    /** What installing it means: unpack a zip, start an exe. */
    kind: "zip" | "exe" | "file";
    /** The server's download route for this file. */
    url: string;
};

export type AddonReleaseInfo = {
    /** "0.3.0" (the tag without its "v"). */
    version: string;
    tag: string;
    /** ISO date, "" when unknown. */
    publishedAt: string;
    /** Release notes (Markdown, cut short on the server). */
    notes: string;
    assets: AddonFile[];
};

/**
 * ok: a release (maybe `stale`: GitHub failed, the last good one is shown);
 * no_release: the repo has none yet; token_missing: a private repo without the
 * GitHub token; error: GitHub failed and nothing is cached (`errorCode`).
 */
export type AddonState = "ok" | "no_release" | "token_missing" | "error";

export type AddonCard = {
    id: string;
    name: string;
    description: string;
    /** zamimg icon name. */
    icon: string;
    versions: string[];
    /** The admin's own install note, "" for none. */
    install: string;
    state: AddonState;
    stale: boolean;
    /** unauthorized | forbidden | rate_limited | unreachable, "" without a failure. */
    errorCode: string;
    /** When the shown answer was fetched (ms), 0 for never. */
    fetchedAt: number;
    /** Full admins only. */
    repo?: string;
    private?: boolean;
    /** Only admins and orga roles get this card (the server leaves it out for everyone else). */
    orgaOnly: boolean;
    release: AddonReleaseInfo | null;
};

export type AddonsData = {
    versionId: string;
    mainVersion: string;
    /** A full admin: sees the repo and the setup hints. */
    canManage: boolean;
    /** Full admins only: whether the GitHub token is set. */
    tokenSet?: boolean;
    /** Downloads per hour and account. */
    downloadLimit: number;
    addons: AddonCard[];
    /** The game versions that have addons at all - the hint on an empty page. */
    addonVersions?: { id: string; label: string }[];
};

/** The addons of a game version ("" = the server's main version). */
export const getAddons = (version = "") =>
    get<AddonsData>(`/api/addons${version ? `?version=${encodeURIComponent(version)}` : ""}`);

/** One addon for its detail page /addon/<id>, whatever version the menu shows. */
export type AddonDetailData = {
    canManage: boolean;
    /** Full admins only: whether the GitHub token is set. */
    tokenSet?: boolean;
    downloadLimit: number;
    addon: AddonCard;
    /** The addon's game versions with their names. */
    versions: { id: string; label: string }[];
};

/** One addon by its id; 404 unknown_addon for an unknown, hidden or (for a raider) orga-only one. */
export const getAddonDetail = (addonId: string) =>
    get<AddonDetailData>(`/api/addons/detail?addon=${encodeURIComponent(addonId)}`);

/** One addon as Einstellungen → Addons edits it (config.addonDownloads). */
export type AddonSetting = {
    id: string;
    name: string;
    description: string;
    /** "owner/repo" on GitHub. */
    repo: string;
    /** A private repo needs the GitHub token. */
    private: boolean;
    /** File name patterns of the release files offered (* and ? as wildcards). */
    assets: string[];
    /** Game version ids the addon is shown for. */
    versions: string[];
    install: string;
    icon: string;
    enabled: boolean;
    /** Only admins and orga roles see and download it. */
    orgaOnly: boolean;
};
