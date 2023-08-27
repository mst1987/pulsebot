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
                console.log('Response: ', response.data.message)
                return response.data;
            }).catch((error) => {
                console.log('Error: ', error.message)
                reject(error);
            })

            resolve(res);
        });
    }

    async bid(auctionData) {
        return new Promise(async(resolve, reject) => {
            const options = {
                host: "https://pulse-gdkp.de:3001",
                port: 443,
                path: "/api/legendary/bid",
                method: "POST",
                headers: {
                    'Content-Length': auctionData.length
                }
            };

            const request = await https.request(options, (response) => {
                let data = '';
                response.on('data', (chunk) => {
                    data += chunk;
                });

                response.on('end', () => {
                    resolve(data); // Resolve the promise with the response data
                });
            });

            request.on('error', (error) => {
                reject(error); // Reject the promise if there's an error
            });

            request.write(auctionData);
            request.end();
        });
    }
}
module.exports = Legendary;