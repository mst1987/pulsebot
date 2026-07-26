const auth = require("../auth");
const { ok } = require("../apiResponse");

/** GET /api/session — who the caller is (if anyone), plus their CSRF token. */
function getSession(req, res) {
    const user = auth.getUser(req);
    ok(res, {
        user: user ? { id: user.id, name: user.name, isAdmin: !!user.isAdmin } : null,
        csrfToken: user ? auth.csrfToken(req) : null,
    });
}

module.exports = { getSession };
