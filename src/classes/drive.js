const { google } = require("googleapis");

// Thin Google Drive client used to give each raid its own throwaway copy of the
// source raidsheet: copy the file, share it by link, and later delete the copy.
// Uses the same service-account key as classes/sheets.js but with the Drive
// scope. The copies are owned by the service account; deleteFile only ever
// removes copies whose ids we tracked ourselves — never the source sheet.
class Drive {
    constructor() {
        this.auth = new google.auth.GoogleAuth({
            keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE,
            scopes: ["https://www.googleapis.com/auth/drive"],
        });
        this._drivePromise = null;
    }

    async _getDrive() {
        if (!this._drivePromise) {
            this._drivePromise = this.auth.getClient().then((client) =>
                google.drive({ version: "v3", auth: client })
            );
        }
        return this._drivePromise;
    }

    // Copy a spreadsheet (or any Drive file). Returns { id, url } of the copy.
    async copyFile(sourceId, name) {
        const drive = await this._getDrive();
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

    // Share a file as "anyone with the link can edit".
    async shareAnyoneWriter(fileId) {
        const drive = await this._getDrive();
        await drive.permissions.create({
            fileId,
            requestBody: { role: "writer", type: "anyone" },
            supportsAllDrives: true,
        });
    }

    // Permanently delete a file. Callers must only pass ids of copies they made.
    async deleteFile(fileId) {
        const drive = await this._getDrive();
        await drive.files.delete({ fileId, supportsAllDrives: true });
    }
}

module.exports = Drive;
