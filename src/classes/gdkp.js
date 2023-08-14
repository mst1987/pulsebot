const axios = require('axios');
const https = require('https');
class GDKP {
    constructor() {}

    async getCurrentIDSpent(userid) {
        return new Promise((resolve, reject) => {
            let data = '';
            const options = {
                host: "localhost:3001",
                port: 443,
                path: "/api/gargulimport/currentid/" + userid,
                method: "GET",
                headers: {}
            }

            const agent = new https.Agent({
                rejectUnauthorized: false, // Temporarily ignore SSL validation (not recommended for production)
            });
            const url = 'https://localhost:3001/api/gargul-import/byplayer/currentid/' + userid;
            return axios.get(url, { httpsAgent: agent })
                .then(response => {
                    console.log(response)
                    return response.data;
                })
                .catch(error => {
                    throw error;
                });
        });
    }
}

module.exports = GDKP;