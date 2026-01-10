const axios = require("axios");
const https = require("https");
const { API_BASE_URL } = require("../config/variables");

const agent = new https.Agent({
    rejectUnauthorized: process.env.NODE_ENV === "production",
});

class GDKP {
    constructor() {
        this.baseUrl = `${API_BASE_URL}/gargul-import`;
    }

    async getTotalItems(userid) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/totalitems/user/${userid}`, { httpsAgent: agent }
            );
            return response.data;
        } catch (error) {
            console.error("Error getting total items:", error.message);
            throw error;
        }
    }
}

module.exports = GDKP;