// Network guard for the whole suite (#432): a test that forgets a
// `jest.mock(...)` for an API client must fail loudly instead of quietly
// talking to raid-helper.xyz, Discord or WarcraftLogs.
//
// Runs as a `setupFiles` entry, i.e. before the test file and before any
// `src/` module is loaded, so axios instances created with `axios.create()`
// inherit the stubbed adapter. A test's own `jest.mock("axios")`,
// `jest.mock("https")` or `jest.mock("http")` still wins - it replaces the
// module this guard patched.
//
// Loopback stays open: a few suites start a real server on port 0 and talk to
// it (e.g. scripts/agentOverview), which never leaves the machine.
const http = require("http");
const https = require("https");

const MESSAGE = "Netzwerk in Tests verboten - jest.mock verwenden";
const ORIGINAL = Symbol.for("eventhelper.noNetwork.original");
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// Every blocked attempt, until test/setup/noNetworkCheck.js collects it after
// the test. Throwing alone is not enough: best-effort code (deployStatus,
// "nicht prüfbar") catches the error and the test passes regardless - which is
// exactly how apiRouter.test.js asked GitHub for real until #432.
const blocked = [];

class NetworkBlockedError extends Error {
    constructor(target) {
        super(`${MESSAGE} (${target})`);
        this.name = "NetworkBlockedError";
        this.code = "ENETWORKBLOCKED";
        blocked.push(target);
    }
}

/** The blocked attempts since the last call, oldest first; empties the list. */
function takeBlocked() {
    return blocked.splice(0);
}

function isLoopback(host) {
    const h = String(host || "").toLowerCase();
    return LOOPBACK.has(h) || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/** Host of a url string / URL object, or "" when there is none. */
function hostOfUrl(url) {
    try {
        return new URL(String(url)).hostname;
    } catch {
        return "";
    }
}

/**
 * The host an `http(s).request`/`get` call would connect to. Accepts every
 * signature Node does: (url[, options][, cb]) and (options[, cb]).
 */
function targetOf(args) {
    const [first, second] = args;
    let host;
    let socketPath = "";
    if (typeof first === "string" || first instanceof URL) {
        host = hostOfUrl(first);
        if (second && typeof second === "object") {
            host = second.hostname || second.host || host;
            socketPath = second.socketPath || "";
        }
    } else if (first && typeof first === "object") {
        host = first.hostname || first.host || "localhost";
        socketPath = first.socketPath || "";
    } else {
        host = "localhost";
    }
    // `host` may carry a port ("example.com:443") - strip it, but not from IPv6
    host = String(host);
    if (!host.startsWith("[") && host.split(":").length === 2) host = host.split(":")[0];
    return { host, socketPath };
}

/** Wraps `mod[name]` so only loopback / unix-socket requests go through. */
function guardMethod(mod, name, label) {
    const current = mod[name];
    const original = current[ORIGINAL] || current;
    const guarded = function (...args) {
        const { host, socketPath } = targetOf(args);
        if (socketPath || isLoopback(host)) return original.apply(this, args);
        throw new NetworkBlockedError(`${label}.${name} ${host}`);
    };
    guarded[ORIGINAL] = original;
    mod[name] = guarded;
}

function installHttpGuards() {
    guardMethod(http, "request", "http");
    guardMethod(http, "get", "http");
    guardMethod(https, "request", "https");
    guardMethod(https, "get", "https");
}

function installFetchGuard(target = globalThis) {
    const current = target.fetch;
    if (typeof current !== "function") return;
    const original = current[ORIGINAL] || current;
    const guarded = async function (input, init) {
        const url = typeof input === "string" || input instanceof URL ? input : (input && input.url);
        const host = hostOfUrl(url);
        if (isLoopback(host)) return original.call(this, input, init);
        throw new NetworkBlockedError(`fetch ${host || url}`);
    };
    guarded[ORIGINAL] = original;
    target.fetch = guarded;
}

function installAxiosGuard() {
    let axios;
    try {
        axios = require("axios");
    } catch {
        return; // not installed - nothing to guard
    }
    const current = axios.defaults.adapter;
    const original = (current && current[ORIGINAL]) || current;
    const guarded = function (config) {
        const base = config.baseURL || "";
        const url = String(config.url || "");
        const full = /^[a-z]+:\/\//i.test(url) || !base ? url : `${base.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}`;
        const host = hostOfUrl(full);
        if (isLoopback(host)) return axios.getAdapter(original)(config);
        return Promise.reject(new NetworkBlockedError(`axios ${config.method || "get"} ${host || full}`));
    };
    guarded[ORIGINAL] = original;
    axios.defaults.adapter = guarded;
}

installHttpGuards();
installFetchGuard();
installAxiosGuard();

module.exports = { NetworkBlockedError, isLoopback, targetOf, takeBlocked, MESSAGE };
