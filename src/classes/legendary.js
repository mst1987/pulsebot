const https = require('https');
const axios = require('axios');

const agent = new https.Agent({
    rejectUnauthorized: false
});
class Legendary {
    constructor() {}

    async createAuction(auctionData) {
        const url = "https://pulse-gdkp.de:3001/api/legendary/createauction";
        return new Promise(async(resolve, reject) => {
            const res = await axios.post(url, auctionData, {
                httpsAgent: agent,
            }).then((response) => {
                return response.data;
            }).catch((error) => {
                return error;
            })

            resolve(res);
        });
    }

    async deleteAuction(channel) {
        const url = "https://pulse-gdkp.de:3001/api/legendary/deleteauction/" + channel;
        return new Promise(async(resolve, reject) => {
            const res = await axios.delete(url, {
                httpsAgent: agent,
            }).then((response) => {
                return response.data;
            }).catch((error) => {
                return error;
            })

            resolve(res);
        });
    }

    async bid(bidData) {
        const url = "https://pulse-gdkp.de:3001/api/legendary/bid";
        return new Promise(async(resolve, reject) => {
            const res = await axios.post(url, bidData, {
                httpsAgent: agent,
            }).then((response) => {
                return response.data;
            }).catch((error) => {
                throw error;
            })

            resolve(res);
        });
    }


    async getAuction(channel) {
        const url = 'https://pulse-gdkp.de:3001/api/legendary/' + channel;
        return axios.get(url, { httpsAgent: agent })
            .then(response => {
                return response.data;
            })
            .catch(error => {
                throw error;
            });
    }
}
module.exports = Legendary;