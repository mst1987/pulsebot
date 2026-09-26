// Minimal leveled logger on top of console.*. Not a replacement for the ~80
// existing console.* calls across the project (see docs/known-issues.md /
// issue #430) — only for src/bot.js and the few silent catch blocks called
// out in that issue. New code may adopt it gradually.
//
// Level via LOG_LEVEL env var (debug/info/warn/error), default "info".
// logger.child("moduleName") prefixes every line with "[moduleName]".

const LEVELS = ["debug", "info", "warn", "error"];

function levelIndex(level) {
    const idx = LEVELS.indexOf(String(level || "").toLowerCase());
    return idx === -1 ? LEVELS.indexOf("info") : idx;
}

function currentLevelIndex() {
    return levelIndex(process.env.LOG_LEVEL);
}

const CONSOLE_METHOD = { debug: "log", info: "log", warn: "warn", error: "error" };

function log(level, prefix, args) {
    if (levelIndex(level) < currentLevelIndex()) return;
    const method = CONSOLE_METHOD[level] || "log";
    const tag = `[${level}]${prefix ? ` [${prefix}]` : ""}`;
    console[method](tag, ...args);
}

function makeLogger(prefix) {
    return {
        debug: (...args) => log("debug", prefix, args),
        info: (...args) => log("info", prefix, args),
        warn: (...args) => log("warn", prefix, args),
        error: (...args) => log("error", prefix, args),
        child: (childPrefix) => makeLogger(prefix ? `${prefix}:${childPrefix}` : childPrefix),
    };
}

module.exports = makeLogger("");
