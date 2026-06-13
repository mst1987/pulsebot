const axios = require("axios");
const { API_BASE_URL } = require("../config/variables");
const agent = require("../utils/httpAgent");

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