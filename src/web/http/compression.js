// Response compression and request timing for the plain-Node web server.
//
// Two jobs, both applied once in server.js (`install`), so no route has to know about them:
//   - compress text answers (JSON, SSR pages, the SPA's files) with brotli or gzip, picked from Accept-Encoding;
//   - time /api, /r and /p requests: a `Server-Timing: app;dur=<ms>` header, a debug line, a warn line for slow ones.
//
// The zlib calls are the async ones, so a 16 MB report page does not block the event loop while it is squeezed.
// Streams and downloads are left alone: anything that writes before end() or sets a Content-Encoding itself
// (staticClient.js does, for its cached files) passes through untouched. In production nginx sits in front and does
// not compress an answer that already carries Content-Encoding (docs/deployment.md).
const http = require("http");
const zlib = require("zlib");
const { promisify } = require("util");
const log = require("../../logger").child("http");
const requestStats = require("../../services/system/requestStats");

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

/** Below this a body is not worth the CPU and the extra header bytes. */
const MIN_BYTES = 1024;
/** Brotli quality for answers built per request: 4 is gzip-like in speed, noticeably smaller in size. */
const DYNAMIC_BROTLI_QUALITY = 4;
/** Brotli quality for the immutable build files, compressed once and kept (staticClient.js). */
const STATIC_BROTLI_QUALITY = 11;
/** Paths that get a timing: the JSON API, the report pages and the public raid plan pages. */
const TIMED_PREFIXES = ["/api/", "/r/", "/p/"];

/** Node's own `headersSent` getter, looked up when needed (a suite may replace the http module). */
const headersSentGetter = () => Object.getOwnPropertyDescriptor(http.OutgoingMessage.prototype, "headersSent").get;

/** The encoding to answer with: "br", "gzip" or "" (identity). Honors q-values; q=0 means refused. */
function pickEncoding(acceptEncoding) {
    const header = String(acceptEncoding || "").toLowerCase();
    if (!header) return "";
    const q = {};
    for (const part of header.split(",")) {
        const [name, ...params] = part.trim().split(";");
        if (!name) continue;
        let value = 1;
        for (const p of params) {
            const m = /^\s*q\s*=\s*([\d.]+)\s*$/.exec(p);
            if (m) value = Number(m[1]);
        }
        q[name.trim()] = Number.isNaN(value) ? 0 : value;
    }
    const weight = (enc) => (enc in q ? q[enc] : (q["*"] === undefined ? 0 : q["*"]));
    const br = weight("br");
    const gz = Math.max(weight("gzip"), weight("x-gzip"));
    if (br <= 0 && gz <= 0) return "";
    return br >= gz ? "br" : "gzip";
}

/** Whether a Content-Type is text-like enough to shrink (text/*, JSON, JavaScript, SVG, XML). */
function isCompressible(contentType) {
    const type = String(contentType || "").split(";")[0].trim().toLowerCase();
    if (!type) return false;
    return type.startsWith("text/") || type === "image/svg+xml" || type === "application/javascript"
        || type === "application/json" || type.endsWith("+json") || type.endsWith("+xml") || type === "application/xml";
}

/** Compresses a buffer or string with `encoding` ("br" or "gzip"); resolves to the compressed Buffer. */
function compress(body, encoding, { brotliQuality = DYNAMIC_BROTLI_QUALITY } = {}) {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    if (encoding === "br") {
        return brotli(buf, {
            params: {
                [zlib.constants.BROTLI_PARAM_QUALITY]: brotliQuality,
                [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
            },
        });
    }
    return gzip(buf, { level: 6 });
}

function headerKey(headers, name) {
    return Object.keys(headers).find((k) => k.toLowerCase() === name);
}

/** Adds `Accept-Encoding` to an existing Vary value without duplicating it. */
function withVary(existing) {
    const current = String(existing || "").trim();
    if (!current) return "Accept-Encoding";
    if (current === "*" || /(^|,)\s*accept-encoding\s*(,|$)/i.test(current)) return current;
    return `${current}, Accept-Encoding`;
}

// SLOW_REQUEST_MS (default 1000) is read by the request statistics, which also count the slow requests.
const { slowThresholdMs, DEFAULT_SLOW_MS } = requestStats;

function isTimed(pathname) {
    return TIMED_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * Logs one finished request: warn from the slow threshold on, debug below. Path only - never the query string.
 * The same request goes into the route statistics of the "Systemstatus" page (services/system/requestStats.js).
 */
function logRequest(method, pathname, status, ms) {
    const line = `${method} ${pathname} -> ${status} in ${Math.round(ms)} ms`;
    const slow = ms >= slowThresholdMs();
    if (slow) log.warn(`slow request: ${line}`);
    else log.debug(line);
    requestStats.record(method, pathname, status, ms, slow);
}

/**
 * Wraps one real response (Node's ServerResponse) so that a whole-body answer - writeHead(...) then end(body) - is
 * timed and, when it qualifies, compressed. Does nothing for a stand-in without `on` (the unit tests' mock responses).
 */
function install(req, res, pathname) {
    if (typeof res.on !== "function") return;
    const started = process.hrtime.bigint();
    const timed = isTimed(pathname);
    // HEAD never has a body to compress.
    const encoding = req.method === "HEAD" ? "" : pickEncoding(req.headers && req.headers["accept-encoding"]);
    const origWriteHead = res.writeHead.bind(res);
    const origWrite = res.write.bind(res);
    const origEnd = res.end.bind(res);
    let pending = null; // { status, headers } of a writeHead not yet passed on
    let ended = false;
    let passThrough = false;

    // The answer counts as sent once end() ran (its compression may still be under way), so an error handler
    // never writes a second one. A held-back head alone is not "sent": a handler that fails before end() can still
    // be answered with a 500.
    Object.defineProperty(res, "headersSent", {
        configurable: true,
        get() { return passThrough || ended || headersSentGetter().call(res); },
    });

    res.writeHead = (status, ...rest) => {
        if (passThrough || ended) return origWriteHead(status, ...rest);
        if (rest.some((r) => Array.isArray(r))) { // raw header array: not worth interpreting
            passThrough = true;
            return origWriteHead(status, ...rest);
        }
        const headers = rest.find((r) => r && typeof r === "object");
        pending = { status, headers: { ...(headers || {}) } };
        return res;
    };

    // A streamed answer: send the held head and get out of the way.
    res.write = (...args) => {
        if (pending && !passThrough) origWriteHead(pending.status, pending.headers);
        passThrough = true;
        return origWrite(...args);
    };

    res.end = (body, ...rest) => {
        if (passThrough || ended || !pending) {
            ended = true;
            return origEnd(body, ...rest);
        }
        ended = true;
        const { status, headers } = pending;
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        if (timed && !headerKey(headers, "server-timing")) headers["Server-Timing"] = `app;dur=${ms.toFixed(1)}`;
        const done = (outBody) => {
            origWriteHead(status, headers);
            origEnd(outBody);
            if (timed) logRequest(req.method, pathname, status, ms);
        };
        const typeKey = headerKey(headers, "content-type");
        const type = typeKey ? headers[typeKey] : res.getHeader("content-type");
        const size = body === undefined || body === null ? 0 : Buffer.byteLength(body);
        const candidate = size >= MIN_BYTES && status >= 200 && status !== 204 && status !== 304
            && isCompressible(type) && !headerKey(headers, "content-encoding") && !res.getHeader("content-encoding");
        if (!candidate) {
            done(body);
            return res;
        }
        // The same URL may be answered plain or compressed, whatever this client asked for.
        const vk = headerKey(headers, "vary") || "Vary";
        headers[vk] = withVary(headers[vk]);
        if (!encoding) {
            done(body);
            return res;
        }
        compress(body, encoding).then((out) => {
            headers["Content-Encoding"] = encoding;
            const lk = headerKey(headers, "content-length");
            if (lk) delete headers[lk];
            headers["Content-Length"] = out.length;
            done(out);
        }, (err) => {
            log.error("compression failed, sending the plain body:", (err && err.message) || err);
            done(body);
        });
        return res;
    };
}

module.exports = {
    install, pickEncoding, isCompressible, compress, withVary, slowThresholdMs,
    MIN_BYTES, STATIC_BROTLI_QUALITY, DYNAMIC_BROTLI_QUALITY, DEFAULT_SLOW_MS,
};
