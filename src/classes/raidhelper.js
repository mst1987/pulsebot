const https = require("https");

class Raidhelper {
  // opts.serverId lets callers override the raid-helper.xyz server id from the
  // admin-editable settings store (see utils/raidhelperClient.js); apiKey stays
  // env-only since it's a real secret.
  constructor(opts = {}) {
    this.apiKey = process.env.RAIDHELPER_API_KEY;
    this.serverId = opts.serverId || process.env.RAIDHELPER_SERVER_ID;
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

  // Fetch the server's events with a StartTimeFilter lower bound (unix seconds),
  // sorted ascending by start time. Shared by getAllEvents/getPastEvents.
  async fetchEvents(startTimeFilter) {
    return new Promise((resolve, reject) => {
      let data = "";
      const options = this.getEventOptions(startTimeFilter);

      var request = https
        .request(options, (resp) => {
          resp.on("data", (chunk) => {
            data += chunk;
          });

          resp.on("end", () => {
            // Raid-Helper returns plain-text errors (e.g. "Endpoint ... not found")
            // for bad server ids / API errors. Guard JSON.parse so a non-JSON body
            // rejects cleanly instead of throwing out of this async callback and
            // crashing the process.
            let parsed;
            try {
              parsed = JSON.parse(data);
            } catch {
              return reject(new Error(`Unerwartete Antwort von Raid-Helper (HTTP ${resp.statusCode}): ${String(data).slice(0, 200)}`));
            }
            if (!parsed || parsed.status === "failed" || !Array.isArray(parsed.postedEvents)) {
              return reject(parsed && parsed.status === "failed" ? parsed : new Error("Raid-Helper lieferte keine Events."));
            }
            const filteredEvents = parsed.postedEvents.sort(
              (eventA, eventB) => eventA.startTime - eventB.startTime,
            );
            resolve(filteredEvents);
          });
        })
        .on("error", (err) => reject(err));
      request.end();
    });
  }

  async getAllEvents() {
    return this.fetchEvents(Math.floor(Date.now() / 1000));
  }

  // Events that have already started, newest first. Raid-Helper's StartTimeFilter
  // is only a LOWER bound (there is no documented upper-bound header on v4), so we
  // ask for everything since `sinceSeconds` and drop what is still upcoming here.
  async getPastEvents(sinceSeconds) {
    const now = Math.floor(Date.now() / 1000);
    const events = await this.fetchEvents(Math.floor(sinceSeconds) || now);
    return events
      .filter((event) => Number(event.startTime) <= now)
      .sort((eventA, eventB) => eventB.startTime - eventA.startTime);
  }

  // Derive the distinct templates the server actually uses from its events.
  // Raid-Helper exposes no "list templates" endpoint, so we read the already
  // available events (v4 endpoint) and collapse them to { id, name } by
  // templateId. Returns [] on any API failure so callers can degrade cleanly.
  async getTemplates() {
    let events;
    try {
      events = await this.getAllEvents();
    } catch {
      return [];
    }
    const byId = new Map();
    for (const event of events || []) {
      const hasId = event && event.templateId !== null && event.templateId !== undefined;
      const id = hasId ? String(event.templateId).trim() : "";
      if (!id || byId.has(id)) continue;
      const name = String(
        event.templateName || event.templateTitle || event.title || ""
      ).trim();
      byId.set(id, { id, name });
    }
    return [...byId.values()].sort((a, b) =>
      (a.name || a.id).localeCompare(b.name || b.id)
    );
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
        path: "/api/v4/events/" + raidid + "/signups",
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
        path: "/api/v4/events/" + eventid,
        method: "GET",
        headers: { Authorization: this.apiKey },
      };

      var request = https
        .request(options, (resp) => {
          resp.on("data", (chunk) => {
            data += chunk;
          });
          resp.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
          });
          resp.on("error", reject);
        })
        .on("error", reject);
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
              return resolve();
            }
            // Guard JSON.parse: a raidplan that doesn't exist yet returns a
            // non-JSON body. Resolve undefined (no setup) instead of throwing out
            // of this async callback and crashing the process.
            let parsed;
            try {
              parsed = JSON.parse(data);
            } catch {
              return resolve();
            }
            resolve({ raidid: raidid, setup: parsed.slots, startTime: parsed.startTime || parsed.date || parsed.start_time || null });
          });
        })
        .on("error", () => resolve());

      request.end();
    });
  }

  // Create a new Raid-Helper event in the given channel.
  // data: { channelId, leaderId, templateId, date (dd-MM-yyyy), time (HH:mm), title, description }
  // Endpoint per raid-helper.xyz API: POST /api/v4/servers/{serverId}/channels/{channelId}/event
  // (the v2 event-creation/signup endpoints have been shut down server-side — they now all
  // 404 with a generic "Endpoint ... not found" regardless of auth, verified live 2026-07-25)
  async createEvent(data) {
    return new Promise((resolve, reject) => {
      const { channelId, ...body } = data;
      const postData = JSON.stringify(body);

      const options = {
        host: "raid-helper.xyz",
        port: 443,
        path: `/api/v4/servers/${this.serverId}/channels/${channelId}/event`,
        method: "POST",
        headers: {
          Authorization: this.apiKey,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
        },
      };

      const request = https.request(options, (response) => {
        let responseData = "";
        response.on("data", (chunk) => {
          responseData += chunk;
        });
        response.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(responseData);
          } catch {
            return reject(new Error(`Unerwartete Antwort von Raid-Helper (HTTP ${response.statusCode}): ${responseData.slice(0, 200)}`));
          }
          resolve(parsed);
        });
      });

      request.on("error", (error) => reject(error));
      request.write(postData);
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
