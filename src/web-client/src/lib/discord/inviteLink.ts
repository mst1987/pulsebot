// The link a recruitment post's link button may carry: a Discord invite or a Discord channel link. Mirrors
// src/utils/recruitment/inviteLink.js — the server checks again and refuses anything else; this copy only
// lets the dialog say so before the click.

const MAX_LENGTH = 512;
const PATTERNS = [
    /^https:\/\/discord\.gg\/[A-Za-z0-9-]{2,64}\/?$/,
    /^https:\/\/(?:www\.)?discord\.com\/invite\/[A-Za-z0-9-]{2,64}\/?$/,
    /^https:\/\/(?:www\.)?discord\.com\/channels\/\d{5,25}(?:\/\d{5,25}){0,2}\/?$/,
];

/** Whether `value` (trimmed) is a Discord invite or channel link. */
export function isDiscordInviteUrl(value: string): boolean {
    const url = (value || "").trim();
    return !!url && url.length <= MAX_LENGTH && PATTERNS.some((re) => re.test(url));
}
