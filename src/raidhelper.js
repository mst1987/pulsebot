const https = require('https');

class Raidhelper {
    constructor() {}

    async getEvents(userid) {
        return new Promise((resolve, reject) => {
            let data = '';
            const currentUnixTimestamp = Math.floor(Date.now() / 1000);
            const options = {
                host: "raid-helper.dev",
                port: 443,
                path: "/api/v3/servers/250382792217591808/events",
                method: "GET",
                headers: { 'Authorization': 'Rw8rsVTqkn5i9Adu214rfIc9HaxIGwaFCNAuVB90', 'StartTimeFilter': currentUnixTimestamp, 'IncludeSignups': true }
            }

            var request = https.request(options, (resp) => {
                resp.on('data', (chunk) => {
                    data += chunk;
                });

                // The whole response has been received. Print out the result.
                resp.on('end', () => {
                    data = JSON.parse(data);
                    var filteredEvents = data['postedEvents'].sort((eventA, eventB) => eventA.startTime - eventB.startTime).filter(event => event.signUps.find((signup) => signup.userId === userid && signup.specName !== 'Absence'));

                    resolve(filteredEvents.map(events => events.channelId));
                });

            }).on("error", (err) => {
                console.log("Error: " + err.message);
            });
            request.end()
        });
    }

    async getAllEvents() {
        return new Promise((resolve, reject) => {
            let data = '';
            const currentUnixTimestamp = Math.floor(Date.now() / 1000);
            const options = {
                host: "raid-helper.dev",
                port: 443,
                path: "/api/v3/servers/250382792217591808/events",
                method: "GET",
                headers: { 'Authorization': 'Rw8rsVTqkn5i9Adu214rfIc9HaxIGwaFCNAuVB90', 'StartTimeFilter': currentUnixTimestamp, 'IncludeSignups': true }
            }

            var request = https.request(options, (resp) => {
                resp.on('data', (chunk) => {
                    data += chunk;
                });

                // The whole response has been received. Print out the result.
                resp.on('end', () => {
                    data = JSON.parse(data);
                    var filteredEvents = data['postedEvents'].sort((eventA, eventB) => eventA.startTime - eventB.startTime);

                    resolve(filteredEvents);
                });

            }).on("error", (err) => {
                console.log("Error: " + err.message);
            });
            request.end()
        });
    }

    async getEventData(userid) {
        return new Promise((resolve, reject) => {
            let data = '';
            const currentUnixTimestamp = Math.floor(Date.now() / 1000);
            const options = {
                host: "raid-helper.dev",
                port: 443,
                path: "/api/v3/servers/250382792217591808/events",
                method: "GET",
                headers: { 'Authorization': 'Rw8rsVTqkn5i9Adu214rfIc9HaxIGwaFCNAuVB90', 'StartTimeFilter': currentUnixTimestamp, 'IncludeSignups': true }
            }

            var request = https.request(options, (resp) => {
                resp.on('data', (chunk) => {
                    data += chunk;
                });

                // The whole response has been received. Print out the result.
                resp.on('end', () => {
                    data = JSON.parse(data);
                    filteredEvents = [];
                    if (data) {
                        var filteredEvents = data['postedEvents'].sort((eventA, eventB) => eventA.startTime - eventB.startTime).filter(event => event.signUps.find((signup) => signup.userId === userid && signup.specName !== 'Absence'));


                    }
                    resolve(filteredEvents);
                });

            }).on("error", (err) => {
                console.log("Error: " + err.message);
            });
            request.end()
        });
    }

    async getMissingSignUps(userid) {
        return new Promise((resolve, reject) => {
            let data = '';
            const currentUnixTimestamp = Math.floor(Date.now() / 1000);
            const options = {
                host: "raid-helper.dev",
                port: 443,
                path: "/api/v3/servers/250382792217591808/events",
                method: "GET",
                headers: { 'Authorization': 'Rw8rsVTqkn5i9Adu214rfIc9HaxIGwaFCNAuVB90', 'StartTimeFilter': currentUnixTimestamp, 'IncludeSignups': true }
            }

            var request = https.request(options, (resp) => {
                resp.on('data', (chunk) => {
                    data += chunk;
                });

                resp.on('end', () => {
                    data = JSON.parse(data);
                    var filteredEvents = data['postedEvents'].sort((eventA, eventB) => eventA.startTime - eventB.startTime).filter(event => !event.signUps.find((signup) => signup.userId === userid));

                    resolve(filteredEvents.map(events => events.channelId));
                });

            }).on("error", (err) => {
                console.log("Error: " + err.message);
            });
            request.end()
        });
    }

    async signUpToRaid(raidid, classes, userid) {
        return await this.signUp(raidid, classes, userid);
    }

    async signUp(raidid, classes, userid) {
        return new Promise(async(resolve, reject) => {
            const postData = JSON.stringify({
                userId: userid,
                className: classes.className,
                specName: classes.specName
            });

            const options = {
                host: "raid-helper.dev",
                port: 443,
                path: "/api/v2/events/" + raidid + "/signups",
                method: "POST",
                headers: {
                    'Authorization': 'Rw8rsVTqkn5i9Adu214rfIc9HaxIGwaFCNAuVB90',
                    'Content-Type': 'application/json',
                    'Content-Length': postData.length
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

            request.write(postData);
            request.end();
        });
    }

    async checkIfEvent(eventid) {

        return new Promise((resolve, reject) => {
            let data = '';
            const options = {
                host: "raid-helper.dev",
                port: 443,
                path: "/api/v2/events/" + eventid,
                method: "GET",
                headers: { 'Authorization': 'Rw8rsVTqkn5i9Adu214rfIc9HaxIGwaFCNAuVB90' }
            }

            var request = https.request(options, (resp) => {
                resp.on('data', (chunk) => {
                    data += chunk;
                });

                // The whole response has been received. Print out the result.
                resp.on('end', () => {
                    data = JSON.parse(data);

                    resolve(data);
                });

            }).on("error", (err) => {
                console.log("Error: " + err.message);
            });
            request.end()
        });
    }

    async getSetup(raidid) {
        return new Promise((resolve, reject) => {
            let data = '';
            const currentUnixTimestamp = Math.floor(Date.now() / 1000);
            const options = {
                host: "raid-helper.dev",
                port: 443,
                path: "/api/raidplan/" + raidid,
                method: "GET",
                headers: { 'Authorization': 'Rw8rsVTqkn5i9Adu214rfIc9HaxIGwaFCNAuVB90', 'StartTimeFilter': currentUnixTimestamp, 'IncludeSignups': true }
            }

            var request = https.request(options, (resp) => {
                resp.on('data', (chunk) => {
                    data += chunk;
                });

                resp.on('end', () => {
                    if (!data) {
                        resolve()
                    } else {
                        data = JSON.parse(data);
                        console.log(data._id)
                        resolve({ raidid: raidid, setup: data.raidDrop });
                    }
                });

            }).on("error", (err) => {
                console.log("Error: " + err.message);
            });
            request.end()
        });
    }
}

module.exports = Raidhelper;