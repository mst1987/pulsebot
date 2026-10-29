// The link a recruitment post's link button opens (#recruitment-forum): only a Discord invite or a Discord channel link,
// so a pasted link can never send raiders off to an arbitrary site. Checked on the server before a post is sent or edited.

const MAX_LENGTH = 512;
const PATTERNS = [
    /^https:\/\/discord\.gg\/[A-Za-z0-9-]{2,64}\/?$/,
    /^https:\/\/(?:www\.)?discord\.com\/invite\/[A-Za-z0-9-]{2,64}\/?$/,
    /^https:\/\/(?:www\.)?discord\.com\/channels\/\d{5,25}(?:\/\d{5,25}){0,2}\/?$/,
];

/** The trimmed link when it is a Discord invite or channel link, else "". */
function cleanInviteUrl(value) {
    const url = String(value ?? "").trim();
    if (!url || url.length > MAX_LENGTH) return "";
    return PATTERNS.some((re) => re.test(url)) ? url : "";
}

/** Whether `value` is a link a recruitment link button may carry. */
function isDiscordInviteUrl(value) {
    return cleanInviteUrl(value) !== "";
}

module.exports = { cleanInviteUrl, isDiscordInviteUrl };
