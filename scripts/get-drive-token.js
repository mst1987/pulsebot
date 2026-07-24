// One-time helper to obtain a Google OAuth refresh token for the Drive copy
// feature. Run it once, approve in the browser, then paste the printed
// GOOGLE_OAUTH_REFRESH_TOKEN into your .env / .env.dev.
//
// Prerequisites (in the Google Cloud Console, same project as the sheet):
//   1. APIs & Services -> Credentials -> Create OAuth client ID -> type "Desktop".
//   2. Put the client id/secret into .env (or .env.dev) as:
//        GOOGLE_OAUTH_CLIENT_ID=...
//        GOOGLE_OAUTH_CLIENT_SECRET=...
//   3. OAuth consent screen: add YOUR Google account as a test user (or publish
//      the app) and add the scope .../auth/drive.
//
// Then run:  node scripts/get-drive-token.js
//
// Notes:
//   - While the consent screen is in "Testing", refresh tokens expire after 7
//     days — publish the app ("In production") for a long-lived token.
//   - The token grants full Drive access to the signed-in account. Keep it
//     secret; it lives only in your git-ignored .env.

const http = require("http");
const { google } = require("googleapis");

// Load env the same way the bot does: prefer .env.dev, fall back to .env.
try { require("dotenv").config({ path: ".env.dev" }); } catch { /* optional */ }
require("dotenv").config();

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const PORT = Number(process.env.OAUTH_HELPER_PORT) || 53682;
const redirectUri = `http://localhost:${PORT}`;

if (!clientId || !clientSecret) {
    console.error("FEHLT: GOOGLE_OAUTH_CLIENT_ID und/oder GOOGLE_OAUTH_CLIENT_SECRET in .env(.dev).");
    process.exit(1);
}

const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // force a refresh_token even on re-consent
    scope: ["https://www.googleapis.com/auth/drive"],
});

const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, redirectUri);
        const code = url.searchParams.get("code");
        if (!code) { res.writeHead(400); res.end("Kein code-Parameter."); return; }
        const { tokens } = await oAuth2Client.getToken(code);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h2>Fertig!</h2><p>Du kannst dieses Fenster schließen und zum Terminal zurückkehren.</p>");
        console.log("\n=== Erfolg ===");
        if (tokens.refresh_token) {
            console.log("Trage das in deine .env / .env.dev ein:\n");
            console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}\n`);
        } else {
            console.log("Kein refresh_token erhalten. Widerrufe den Zugriff unter");
            console.log("https://myaccount.google.com/permissions und führe das Skript erneut aus.");
        }
        server.close();
        process.exit(tokens.refresh_token ? 0 : 1);
    } catch (e) {
        res.writeHead(500); res.end("Fehler: " + e.message);
        console.error("Token-Austausch fehlgeschlagen:", e.message);
        server.close();
        process.exit(1);
    }
});

server.listen(PORT, () => {
    console.log("1) Öffne diese URL im Browser und stimme zu:\n");
    console.log("   " + authUrl + "\n");
    console.log(`2) Google leitet auf ${redirectUri} zurück; dieses Skript fängt den Code ab.`);
    console.log("   (Warte auf die Anmeldung …)");
});
