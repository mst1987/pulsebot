const https = require('https');
class Legendary {
    constructor() {}

    async createAuction(auctionData) {
        return new Promise(async(resolve, reject) => {
            const options = {
                host: "https://pulse-gdkp.de",
                port: 3001,
                path: "/api/legendary/createauction",
                method: "POST",
                headers: {
                    'Content-Type': 'application/json',
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