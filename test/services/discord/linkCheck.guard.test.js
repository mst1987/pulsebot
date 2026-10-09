// The guard of #537: "Alles, was in den Übersichten steht, MUSS funktionieren."
// A Discord jump link is only built in src/services/discord/linkCheck.js, which
// hands it out only for a channel/message that exists. A new overview gluing
// `discord.com/channels/` together itself would skip that check — this scan
// refuses it. The web client cannot check anything itself: it builds its links
// in lib/discord/discordLinks.ts only, from the `channelState` the server sends.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const SRC = path.join(ROOT, "src");
const CLIENT = path.join(SRC, "web-client");
const NEEDLE = "discord.com/channels/";

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else out.push(full);
    }
    return out;
}

const rel = (file) => path.relative(ROOT, file).split(path.sep).join("/");

describe("#537 guard: Discord links only through linkCheck", () => {
    it("builds discord.com/channels/ links only in services/discord/linkCheck.js (backend)", () => {
        const offenders = walk(SRC)
            .filter((f) => !f.startsWith(CLIENT) && /\.js$/.test(f))
            .filter((f) => fs.readFileSync(f, "utf8").includes(NEEDLE))
            .map(rel);
        expect(offenders).toEqual(["src/services/discord/linkCheck.js"]);
    });

    it("builds discord.com/channels/ links only in lib/discord/discordLinks.ts (web client, tests aside)", () => {
        const offenders = walk(path.join(CLIENT, "src"))
            .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) && !f.includes(`${path.sep}test${path.sep}`))
            .filter((f) => fs.readFileSync(f, "utf8").includes(NEEDLE))
            .map(rel);
        expect(offenders).toEqual(["src/web-client/src/lib/discord/discordLinks.ts"]);
    });

    it("keeps the web client's post link behind the server's channelState", () => {
        const lib = fs.readFileSync(path.join(CLIENT, "src", "lib", "discord", "discordLinks.ts"), "utf8");
        expect(lib).toMatch(/ChannelState/);
        expect(lib).toMatch(/!channelLinkable\(state\)/);
    });
});
