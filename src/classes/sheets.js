const { google } = require("googleapis");

class SheetsClient {
    // config (all optional) lets a caller target a specific raidsheet:
    //   { spreadsheetId, sheetName, gid }. Anything omitted falls back to the
    //   GOOGLE_* env vars (backwards-compatible with the original no-arg usage).
    constructor(config = {}) {
        this.spreadsheetId = config.spreadsheetId || process.env.GOOGLE_SPREADSHEET_ID;
        this.sheetName = config.sheetName || process.env.GOOGLE_SHEET_NAME || "Setup";
        this.sheetId = config.gid !== undefined && config.gid !== null && config.gid !== ""
            ? Number(config.gid)
            : (Number(process.env.GOOGLE_SHEET_GID) || 34139428);
        this.auth = new google.auth.GoogleAuth({
            keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE,
            scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        });
        this._sheetsPromise = null;
    }

    // Reuse a single authenticated client per SheetsClient instance
    async _getSheets() {
        if (!this._sheetsPromise) {
            this._sheetsPromise = this.auth.getClient().then((client) =>
                google.sheets({ version: "v4", auth: client })
            );
        }
        return this._sheetsPromise;
    }

    // Duplicate a tab within the SAME spreadsheet (no new Drive file, so this
    // works for a service account that has no storage quota of its own). Returns
    // { sheetId, title } of the new tab. On a name collision a numeric suffix is
    // appended. sourceGid defaults to this client's configured tab.
    async duplicateTab(newTitle, sourceGid = this.sheetId) {
        const sheets = await this._getSheets();
        const base = String(newTitle || "Raid").slice(0, 90);
        for (let attempt = 0; attempt < 6; attempt++) {
            const title = attempt === 0 ? base : `${base} (${attempt + 1})`;
            try {
                const res = await sheets.spreadsheets.batchUpdate({
                    spreadsheetId: this.spreadsheetId,
                    requestBody: { requests: [{ duplicateSheet: { sourceSheetId: Number(sourceGid), newSheetName: title } }] },
                });
                const props = res.data.replies[0].duplicateSheet.properties;
                return { sheetId: props.sheetId, title: props.title };
            } catch (e) {
                const msg = String(e.message || "");
                // Retry only when the failure is a duplicate tab name.
                if (!/already exists|bereits/i.test(msg) || attempt === 5) throw e;
            }
        }
        throw new Error("Konnte keinen eindeutigen Tab-Namen finden.");
    }

    // Delete a tab by its sheetId (gid). Callers must only pass gids of tabs we
    // created — never the source template tab.
    async deleteTab(sheetGid) {
        const sheets = await this._getSheets();
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: this.spreadsheetId,
            requestBody: { requests: [{ deleteSheet: { sheetId: Number(sheetGid) } }] },
        });
    }

    async batchWrite(data) {
        const sheets = await this._getSheets();
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: this.spreadsheetId,
            requestBody: { valueInputOption: "USER_ENTERED", data },
        });
    }

    async batchClear(ranges) {
        const sheets = await this._getSheets();
        await sheets.spreadsheets.values.batchClear({
            spreadsheetId: this.spreadsheetId,
            requestBody: { ranges },
        });
    }

    // playerColors: [{ name: "Brandowl", color: { red, green, blue } }]
    // Clears conditional format rules, then adds one rule per player covering
    // A1:Z200. When `onlyTitle` is given only that tab is touched (so per-raid
    // tabs don't clobber each other's colours); otherwise every tab is updated.
    // All per-tab batchUpdates run in parallel; protected tabs are silently skipped.
    async applyConditionalFormatting(playerColors, onlyTitle) {
        const sheets = await this._getSheets();

        const spreadsheet = await sheets.spreadsheets.get({
            spreadsheetId: this.spreadsheetId,
            fields: "sheets(properties(sheetId,title),conditionalFormats)",
        });
        let allSheets = spreadsheet.data.sheets || [];
        if (onlyTitle) allSheets = allSheets.filter((s) => s.properties.title === onlyTitle);

        const updateTab = async (sheet) => {
            const sheetId = sheet.properties.sheetId;
            const ruleCount = (sheet.conditionalFormats || []).length;
            const requests = [];

            for (let i = ruleCount - 1; i >= 0; i--) {
                requests.push({ deleteConditionalFormatRule: { sheetId, index: i } });
            }

            const coveredRange = {
                sheetId,
                startRowIndex: 0,
                endRowIndex: 200,
                startColumnIndex: 0,
                endColumnIndex: 26,
            };
            for (const { name, color } of playerColors) {
                if (!name || !color) continue;
                requests.push({
                    addConditionalFormatRule: {
                        rule: {
                            ranges: [coveredRange],
                            booleanRule: {
                                condition: {
                                    type: "TEXT_EQ",
                                    values: [{ userEnteredValue: name }],
                                },
                                format: {
                                    backgroundColor: color,
                                    textFormat: { foregroundColor: { red: 0, green: 0, blue: 0 } },
                                },
                            },
                        },
                        index: 0,
                    },
                });
            }

            if (requests.length === 0) return;
            try {
                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId: this.spreadsheetId,
                    requestBody: { requests },
                });
            } catch (e) {
                console.log(`[sheets] Skipping tab ${sheetId} (protected or error): ${e.message}`);
            }
        };

        await Promise.all(allSheets.map(updateTab));
    }
}

module.exports = SheetsClient;
