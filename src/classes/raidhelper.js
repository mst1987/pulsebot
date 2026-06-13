const https = require("https");

class Raidhelper {
  constructor() {
    this.apiKey = process.env.RAIDHELPER_API_KEY;
    this.serverId = process.env.RAIDHELPER_SERVER_ID;
  }

  getEventOptions(timestamp) {
    return {
      host: "raid-helper.xyz",
      port: 443,
      path: `/api/v4/servers/${this.serverId}/events`,
      method: "GET",
      headers: {
        Authorization: this.apiKey,
        StartTimeFilter: timestamp,
        IncludeSignups: true,
      },
    };
  }

  async getAllEvents() {
    return new Promise((resolve, reject) => {
      let data = "";
      const currentUnixTimestamp = Math.floor(Date.now() / 1000);
      const options = this.getEventOptions(currentUnixTimestamp);

      var request = https
        .request(options, (resp) => {
          resp.on("data", (chunk) => {
            data += chunk;
          });

          resp.on("end", () => {
            data = JSON.parse(data);
            if (data.status === "failed") {
              reject(data);
            } else {
              var filteredEvents = data["postedEvents"].sort(
                (eventA, eventB) => eventA.startTime - eventB.startTime,
              );

              resolve(filteredEvents);
            }
          });
        })
        .on("error", (err) => {
          console.log(err.message);
        });
      request.end();
    });
  }

  async getUserSignUps(userid) {
    return new Promise((resolve, reject) => {
      let data = "";
      const currentUnixTimestamp = Math.floor(Date.now() / 1000);
      const options = this.getEventOptions(currentUnixTimestamp);

      var request = https
        .request(options, (resp) => {
          resp.on("data", (chunk) => {
            data += chunk;
          });

          resp.on("end", () => {
            data = JSON.parse(data);
            let filteredEvents = [];
            if (data) {
              filteredEvents = data["postedEvents"]
                .sort((eventA, eventB) => eventA.startTime - eventB.startTime)
                .filter((event) =>
                  event.signUps.find(
                    (signup) =>
                      signup.userId === userid && signup.specName !== "Absence",
                  ),
                );
            }
            resolve(filteredEvents);
          });
        })
        .on("error", (err) => {
          console.log("Error: " + err.message);
        });
      request.end();
    });
  }

  async getMissingSignUps(userid) {
    return new Promise((resolve, reject) => {
      let data = "";
      const currentUnixTimestamp = Math.floor(Date.now() / 1000);
      const options = this.getEventOptions(currentUnixTimestamp);

      var request = https
        .request(options, (resp) => {
          resp.on("data", (chunk) => {
            data += chunk;
          });

          resp.on("end", () => {
            data = JSON.parse(data);
            var filteredEvents = data["postedEvents"]
              .sort((eventA, eventB) => eventA.startTime - eventB.startTime)
              .filter(
                (event) =>
                  !event.signUps.find(
                    (signup) =>
                      signup.userId === userid && signup.specName !== "Absence",
                  ),
              );

            resolve(filteredEvents.map((events) => events.channelId));
          });
        })
        .on("error", (err) => {
          console.log("Error: " + err.message);
        });
      request.end();
    });
  }

  async signUpToRaid(raidid, signUps, userid) {
    let promises = [];
    for (let signUp of signUps) {
      promises.push(await this.signUp(raidid, signUp, userid));
    }

    await Promise.all(promises);
  }

  async signUp(raidid, classes, userid) {
    return new Promise(async (resolve, reject) => {
      const postData = JSON.stringify({
        userId: userid,
        className: classes.className,
        specName: classes.specName,
      });

      const options = {
        host: "raid-helper.xyz",
        port: 443,
        path: "/api/v2/events/" + raidid + "/signups",
        method: "POST",
        headers: {
          Authorization: this.apiKey,
          "Content-Type": "application/json",
          "Content-Length": postData.length,
        },
      };
      const request = https.request(options, (response) => {
        let data = "";
        response.on("data", (chunk) => {
          data += chunk;
        });
        response.on("end", () => {
          resolve(data);
        });
      });

      request.on("error", (error) => {
        reject(error);
      });
      request.write(postData);
      request.end();
    });
  }

  async getEvent(eventid) {
    return new Promise((resolve, reject) => {
      let data = "";
      const options = {
        host: "raid-helper.xyz",
        port: 443,
        path: "/api/v2/events/" + eventid,
        method: "GET",
        headers: { Authorization: this.apiKey },
      };

      var request = https
        .request(options, (resp) => {
          resp.on("data", (chunk) => {
            data += chunk;
          });

          resp.on("end", () => {
            data = JSON.parse(data);
            resolve(data);
          });
        })
        .on("error", (err) => {
          console.log("Error: " + err.message);
        });
      request.end();
    });
  }

  async getSetup(raidid) {
    return new Promise((resolve, reject) => {
      let data = "";
      const currentUnixTimestamp = Math.floor(Date.now() / 1000);
      const options = {
        host: "raid-helper.xyz",
        port: 443,
        path: "/api/raidplan/" + raidid,
        method: "GET",
        headers: {
          Authorization: this.apiKey,
          StartTimeFilter: currentUnixTimestamp,
          IncludeSignups: true,
        },
      };

      var request = https
        .request(options, (resp) => {
          resp.on("data", (chunk) => {
            data += chunk;
          });

          resp.on("end", () => {
            if (!data) {
              resolve();
            } else {
              data = JSON.parse(data);
              resolve({ raidid: raidid, setup: data.slots });
            }
          });
        })
        .on("error", (err) => {
          console.log("Error: " + err.message);
        });

      request.end();
    });
  }

  async saveRaid(data) {
    return new Promise(async (resolve, reject) => {
      const postData = JSON.stringify(data);

      const options = {
        host: "pulse-gdkp.de",
        port: 3001,
        path: "/api/raids/import",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      };

      const request = https.request(options, (response) => {
        let responseData = "";
        response.on("data", (chunk) => {
          responseData += chunk;
        });

        response.on("end", () => {
          resolve(JSON.parse(responseData));
        });
      });

      request.on("error", (error) => {
        reject(error);
      });

      request.write(postData);
      request.end();
    });
  }
}

module.exports = Raidhelper;
