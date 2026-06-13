const axios = require("axios");
const { API_BASE_URL } = require("../config/variables");
const agent = require("../utils/httpAgent");

class Legendary {
    constructor() {
        this.baseUrl = `${API_BASE_URL}/legendary`;
    }

    async createAuction(auctionData) {
        try {
            const response = await axios.post(
                `${this.baseUrl}/createauction`,
                auctionData, { httpsAgent: agent }
            );
            return response.data;
        } catch (error) {
            console.error("Error creating auction:", error.message);
            throw error;
        }
    }

    async updateAuction(auctionData) {
        try {
            const response = await axios.put(
                `${this.baseUrl}/${auctionData.channel}`,
                auctionData, { httpsAgent: agent }
            );
            return response.data;
        } catch (error) {
            console.error("Error updating auction:", error.message);
            throw error;
        }
    }

    async deleteAuction(channel) {
        try {
            const response = await axios.delete(`${this.baseUrl}/${channel}`, {
                httpsAgent: agent,
            });
            return response.data;
        } catch (error) {
            console.error("Error deleting auction:", error.message);
            throw error;
        }
    }

    async bid(bidData) {
        try {
            const response = await axios.post(`${this.baseUrl}/bid`, bidData, {
                httpsAgent: agent,
            });
            return response.data;
        } catch (error) {
            console.error("Error placing bid:", error.message);
            throw error;
        }
    }

    async getAuction(channel) {
        try {
            const response = await axios.get(`${this.baseUrl}/${channel}`, {
                httpsAgent: agent,
            });
            return response.data;
        } catch (error) {
            console.error("Error getting auction:", error.message);
            throw error;
        }
    }

    async getHighestBid(channel) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/currentbid/${channel}`, { httpsAgent: agent }
            );
            return response.data;
        } catch (error) {
            console.error("Error getting highest bid:", error.message);
            throw error;
        }
    }

    async getHighestBids() {
        try {
            const response = await axios.get(`${this.baseUrl}/highestbids`, {
                httpsAgent: agent,
            });
            return response.data;
        } catch (error) {
            console.error("Error getting highest bids:", error.message);
            throw error;
        }
    }

    async getWinner(channel) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/highestbid/${channel}`, { httpsAgent: agent }
            );
            return response.data;
        } catch (error) {
            console.error("Error getting winner:", error.message);
            throw error;
        }
    }
}

module.exports = Legendary;