const axios = require('axios');

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
            const url = 'localhost:3001/api/gargul-import/allbuyer';
            return axios.get(url)
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