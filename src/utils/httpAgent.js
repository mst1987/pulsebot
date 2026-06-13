const https = require("https");

module.exports = new https.Agent({
    rejectUnauthorized: process.env.NODE_ENV === "production",
});
