import { get } from "./client";

// ── Sync-Tool & Addon ────────────────────────────────────────────────────────
// The newest release of the public addon repo (src/web/apiRoutes/addonRelease.js),
// cached on the server for an hour. The downloads are GitHub's own links.

/** One downloadable file of a release. */
export type AddonAsset = { name: string; url: string; size: number };

export type AddonRelease = {
    /** "1.14.0" (the tag without its "v"). */
    version: string;
    tag: string;
    /** The release page on GitHub ("Was ist neu?"). */
    url: string;
    /** ISO date, "" when unknown. */
    publishedAt: string;
    exe: AddonAsset | null;
    zip: AddonAsset | null;
};

export type AddonReleaseData = {
    /** null: GitHub could not be reached and nothing was cached. */
    release: AddonRelease | null;
    /** Where to send the visitor in that case. */
    fallbackUrl: string;
};

export const getAddonRelease = () => get<AddonReleaseData>("/api/addon-release");
