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
    // Clears all conditional format rules across every tab, then adds one rule
    // per player on every tab covering A1:Z200.
    // All per-tab batchUpdates run in parallel; protected tabs are silently skipped.
    async applyConditionalFormatting(playerColors) {
        const sheets = await this._getSheets();

        const spreadsheet = await sheets.spreadsheets.get({
            spreadsheetId: this.spreadsheetId,
            fields: "sheets(properties.sheetId,conditionalFormats)",
        });
        const allSheets = spreadsheet.data.sheets || [];

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
