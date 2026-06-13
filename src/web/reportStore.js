const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Reports are stored as JSON files under data/reports/<id>.json
const REPORTS_DIR = path.join(__dirname, "..", "..", "data", "reports");

function ensureDir() {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

function newId() {
    // short, unlisted, hard-to-guess id
    return crypto.randomBytes(6).toString("hex");
}

function filePath(id) {
    return path.join(REPORTS_DIR, `${id}.json`);
}

/**
 * Persist a report and return its id.
 * @param {object} report  the full report payload (meta + players)
 */
function saveReport(report) {
    ensureDir();
    const id = newId();
    const payload = { ...report, id, generatedAt: report.generatedAt || Date.now() };
    fs.writeFileSync(filePath(id), JSON.stringify(payload));
    return id;
}

/** Load a report by id, or null if it does not exist / is unreadable. */
function getReport(id) {
    if (!/^[a-f0-9]{6,}$/i.test(id)) return null;
    try {
        return JSON.parse(fs.readFileSync(filePath(id), "utf8"));
    } catch {
        return null;
    }
}

/** Delete a report by id. Returns true if a file was removed. */
function deleteReport(id) {
    if (!/^[a-f0-9]{6,}$/i.test(id)) return false;
    try {
        fs.unlinkSync(filePath(id));
        return true;
    } catch {
        return false;
    }
}

/** List all reports (lightweight metadata), newest first. */
function listReports() {
    ensureDir();
    const files = fs.readdirSync(REPORTS_DIR).filter((f) => f.endsWith(".json"));
    const out = [];
    for (const f of files) {
        try {
            const r = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, f), "utf8"));
            out.push({
                id: r.id,
                title: r.title,
                zone: r.zone,
                date: r.date,
                generatedAt: r.generatedAt,
                playerCount: (r.players || []).length,
                issueCount: (r.players || []).reduce((n, p) => n + (p.issues || []).length, 0),
            });
        } catch {
            // skip unreadable file
        }
    }
    out.sort((a, b) => (b.generatedAt || 0) - (a.generatedAt || 0));
    return out;
}

module.exports = { saveReport, getReport, deleteReport, listReports, REPORTS_DIR };
