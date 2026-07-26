// JSON body parser for the /api/* layer, the JSON counterpart to server.js's
// readFormBody() (which parses application/x-www-form-urlencoded).

/** Reads and parses a JSON request body (capped at 1MB). Resolves {} on any error. */
function readJsonBody(req) {
    return new Promise((resolve) => {
        let data = "";
        let tooBig = false;
        req.on("data", (chunk) => {
            data += chunk;
            if (data.length > 1e6) { tooBig = true; req.destroy(); }
        });
        req.on("end", () => {
            if (tooBig || !data) return resolve({});
            try {
                resolve(JSON.parse(data));
            } catch {
                resolve({});
            }
        });
        req.on("error", () => resolve({}));
    });
}

module.exports = { readJsonBody };
