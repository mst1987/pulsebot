const { google } = require("googleapis");

// Google Drive client used to give each raid its own throwaway copy of the
// source raidsheet: copy the file, share it by link, and later delete the copy.
//
// It authenticates as a REAL user via OAuth (refresh token), NOT as the service
// account. A service account has no Drive storage quota of its own, so any file
// it tried to own would fail with "storage quota exceeded" — copies must be
// owned by a user with storage. The refresh token belongs to that user; the
// copies land in their Drive. deleteFile only ever removes copies whose ids we
// tracked ourselves — never the source sheet.
//
// Required env (see scripts/get-drive-token.js to obtain the refresh token):
//   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN
class Drive {
    constructor() {
        const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
        const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
        if (!clientId || !clientSecret || !refreshToken) {
            throw new Error(
                "Google-OAuth ist nicht konfiguriert. Setze GOOGLE_OAUTH_CLIENT_ID, "
                + "GOOGLE_OAUTH_CLIENT_SECRET und GOOGLE_OAUTH_REFRESH_TOKEN (siehe "
                + "scripts/get-drive-token.js)."
            );
        }
        this.auth = new google.auth.OAuth2(clientId, clientSecret);
        this.auth.setCredentials({ refresh_token: refreshToken });
        this._drive = null;
    }

    _getDrive() {
        if (!this._drive) {
            this._drive = google.drive({ version: "v3", auth: this.auth });
        }
        return this._drive;
    }

    // Copy a spreadsheet (or any Drive file). The copy is owned by the OAuth
    // user. Returns { id, url } of the copy.
    async copyFile(sourceId, name) {
        const drive = this._getDrive();
        const res = await drive.files.copy({
            fileId: sourceId,
            requestBody: name ? { name } : {},
            fields: "id",
            supportsAllDrives: true,
        });
        const id = res.data && res.data.id;
        if (!id) throw new Error("Drive lieferte keine Datei-ID für die Kopie.");
        return { id, url: `https://docs.google.com/spreadsheets/d/${id}/edit` };
    }

    // Share a file as "anyone with the link can edit" (so the service account
    // that fills the sheet, and the guild, can open it).
    async shareAnyoneWriter(fileId) {
        const drive = this._getDrive();
        await drive.permissions.create({
            fileId,
            requestBody: { role: "writer", type: "anyone" },
            supportsAllDrives: true,
        });
    }

    // Permanently delete a file. Callers must only pass ids of copies they made.
    async deleteFile(fileId) {
        const drive = this._getDrive();
        await drive.files.delete({ fileId, supportsAllDrives: true });
    }
}

module.exports = Drive;
