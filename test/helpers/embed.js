// The size Discord counts for an embed (title, description, footer, fields) — for the suites that check a lookup answer
// stays within EMBED_LIMITS.total (src/utils/discord/botLookup.js clamps it, the suites check the result).

function embedSize(embed = {}) {
    return (embed.title || "").length + (embed.description || "").length
        + (embed.footer ? String(embed.footer.text || "").length : 0)
        + (embed.fields || []).reduce((n, f) => n + String(f.name).length + String(f.value).length, 0);
}

module.exports = { embedSize };
