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

/**
 * Reads a raw request body up to `maxBytes`. Resolves `null` when it is bigger
 * (the connection is cut, nothing more is buffered), else a Buffer (empty on error).
 */
function readRawBody(req, maxBytes) {
    return new Promise((resolve) => {
        const declared = Number(req.headers && req.headers["content-length"]);
        if (Number.isFinite(declared) && declared > maxBytes) {
            req.destroy();
            return resolve(null);
        }
        const chunks = [];
        let size = 0;
        let tooBig = false;
        req.on("data", (chunk) => {
            if (tooBig) return;
            size += chunk.length;
            if (size > maxBytes) { tooBig = true; req.destroy(); return; }
            chunks.push(chunk);
        });
        req.on("end", () => resolve(tooBig ? null : Buffer.concat(chunks)));
        req.on("close", () => { if (tooBig) resolve(null); });
        req.on("error", () => resolve(tooBig ? null : Buffer.alloc(0)));
    });
}

module.exports = { readJsonBody, readRawBody };
