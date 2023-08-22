const axios = require('axios');
const https = require('https');
class GDKP {
    constructor() {}

    async getTotalItems(userid) {
        const agent = new https.Agent({
            rejectUnauthorized: false, // Temporarily ignore SSL validation (not recommended for production)
        });
        const url = 'https://pulse-gdkp.de:3001/api/gargul-import/totalitems/user/' + userid;
        return axios.get(url, { httpsAgent: agent })
            .then(response => {
                return response.data;
            })
            .catch(error => {
                throw error;
            });
    }
}
module.exports = GDKP;