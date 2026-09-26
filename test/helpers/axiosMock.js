// A fake transport for the clients built on src/classes/httpClient.js.
//
// Use it as the factory of an axios mock:
//
//     jest.mock("axios", () => require("../helpers/axiosMock").mockAxios());
//     const { transport, reply, fail, timeout } = require("../helpers/axiosMock");
//
// The real axios stays in place — config merging, interceptors (retry and the
// ApiError translation), response transforms, status validation — and only the
// adapter, the part that would open a socket, is replaced by `transport`, a
// jest.fn(config) the test programs with the helpers below. No test reaches
// the network, and what a client sends is read off `transport.mock.calls`.

const transport = jest.fn();

function mockAxios() {
    const actual = jest.requireActual("axios");
    const create = jest.fn((defaults = {}) => actual.create({ ...defaults, adapter: (config) => transport(config) }));
    return { ...actual, create, default: { ...actual, create } };
}

function axiosError() {
    return jest.requireActual("axios").AxiosError;
}

/** An adapter answer with `status` and `body` (a string body goes through axios' JSON transform). */
function reply(status, body, headers = {}) {
    return (config) => {
        const response = { data: body, status, statusText: String(status), headers, config, request: {} };
        const valid = !config.validateStatus || config.validateStatus(status);
        if (valid) return Promise.resolve(response);
        const AxiosError = axiosError();
        const code = status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST;
        return Promise.reject(new AxiosError(`Request failed with status code ${status}`, code, config, {}, response));
    };
}

/** A network failure without an answer (default: ECONNRESET "socket hang up"). */
function fail(message = "socket hang up", code = "ECONNRESET") {
    return (config) => Promise.reject(new (axiosError())(message, code, config, {}));
}

/** The timeout axios raises when the server never answers. */
function timeout() {
    return (config) => Promise.reject(new (axiosError())(`timeout of ${config.timeout}ms exceeded`, "ECONNABORTED", config, {}));
}

/** Queue answers for the next requests, in order: respond(reply(200, x), fail()). */
function respond(...handlers) {
    for (const h of handlers) transport.mockImplementationOnce(h);
}

/** The config of the n-th request (default: the last one). */
function sent(n = -1) {
    const calls = transport.mock.calls;
    return calls[n < 0 ? calls.length + n : n][0];
}

module.exports = { mockAxios, transport, reply, fail, timeout, respond, sent };
