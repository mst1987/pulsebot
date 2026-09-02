#!/usr/bin/env node
// Downloads the prebuilt `wowsimcli` binary (WoWSims-TBC, MIT) for this platform
// and drops it in bin/. The loot council's upgrade simulation runs it as a local
// subprocess; without it the page falls back to stat weights (see
// src/utils/wowsims/engine.js), so this is optional but recommended.
//
//   node scripts/fetch-wowsimcli.js
//
// Then point the bot at it:  WOWSIMCLI_PATH=<printed path>  in .env / .env.dev
//
// ⚠️ The version is pinned here AND in src/utils/wowsims/engine.js
// (WOWSIMS_VERSION) AND in scripts/fetch-wowsims-data.js (SIM_VERSION) — the
// protojson schema, the vendored rotations and the embedded item DB all hang on
// the release, so the three move together. test/utils/wowsims/version.test.js
// holds them in sync.
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = "wowsims/tbc-new";
const VERSION = "v0.0.97";
const DEST = path.join(__dirname, "..", "bin");

// Release asset per platform. WoWSims ships no 32-bit and no linux/arm build.
const ASSETS = {
    "win32-x64": { asset: "wowsimcli-windows.exe.zip", file: "wowsimcli.exe" },
    "linux-x64": { asset: "wowsimcli-amd64-linux.zip", file: "wowsimcli" },
    "darwin-x64": { asset: "wowsimcli-amd64-darwin.zip", file: "wowsimcli" },
    "darwin-arm64": { asset: "wowsimcli-arm64-darwin.zip", file: "wowsimcli" },
};

function download(url, dest) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { "User-Agent": "EventHelper-fetch-wowsimcli" } }, (res) => {
            if ([301, 302, 307, 308].includes(res.statusCode)) {
                res.resume();
                return resolve(download(res.headers.location, dest));
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`${res.statusCode} für ${url}`));
            }
            const out = fs.createWriteStream(dest);
            res.pipe(out);
            out.on("finish", () => out.close(resolve));
            out.on("error", reject);
        }).on("error", reject);
    });
}

/** Unzip one file, using whatever the platform has (no npm dependency for this). */
function unzip(zip, dir) {
    if (process.platform === "win32") {
        execFileSync("powershell", ["-NoProfile", "-Command",
            `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dir}' -Force`], { stdio: "inherit" });
    } else {
        execFileSync("unzip", ["-o", zip, "-d", dir], { stdio: "inherit" });
    }
}

async function main() {
    const key = `${process.platform}-${process.arch}`;
    const spec = ASSETS[key];
    if (!spec) {
        console.error(`Für ${key} bietet WoWSims kein fertiges Binary an. Selbst bauen: https://github.com/${REPO}`);
        process.exit(1);
    }
    fs.mkdirSync(DEST, { recursive: true });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wowsimcli-"));
    const zip = path.join(tmp, "w.zip");
    const url = `https://github.com/${REPO}/releases/download/${VERSION}/${spec.asset}`;
    console.log(`Lade ${spec.asset} (${REPO} ${VERSION}) …`);
    await download(url, zip);
    unzip(zip, tmp);
    const found = fs.readdirSync(tmp).find((f) => /^wowsimcli/i.test(f) && !f.endsWith(".zip"));
    if (!found) {
        console.error("wowsimcli-Binary im Zip nicht gefunden.");
        process.exit(1);
    }
    const target = path.join(DEST, spec.file);
    fs.copyFileSync(path.join(tmp, found), target);
    if (process.platform !== "win32") fs.chmodSync(target, 0o755);
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`\n-> ${target}`);
    console.log(`In .env / .env.dev eintragen:\n  WOWSIMCLI_PATH=${target}`);
}

main().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
