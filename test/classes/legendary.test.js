jest.mock("axios");
jest.mock("../../src/utils/httpAgent");

const axios = require("axios");
const Legendary = require("../../src/classes/legendary.js");
const { API_BASE_URL } = require("../../src/config/variables.js");
const agent = require("../../src/utils/httpAgent");

const BASE = `${API_BASE_URL}/legendary`;

describe("classes/Legendary", () => {
    let client;

    beforeEach(() => {
        client = new Legendary();
    });

    it("builds the base url from API_BASE_URL", () => {
        expect(client.baseUrl).toBe(BASE);
    });

    describe("createAuction", () => {
        it("POSTs auction data and returns the response body", async () => {
            const payload = { channel: "chan-1", item: "Atiesh" };
            axios.post.mockResolvedValue({ data: { id: 7 } });

            const result = await client.createAuction(payload);

            expect(axios.post).toHaveBeenCalledWith(
                `${BASE}/createauction`,
                payload,
                { httpsAgent: agent }
            );
            expect(result).toEqual({ id: 7 });
        });

        it("re-throws on failure", async () => {
            axios.post.mockRejectedValue(new Error("boom"));
            await expect(client.createAuction({})).rejects.toThrow("boom");
        });
    });

    describe("updateAuction", () => {
        it("PUTs to the channel-specific url", async () => {
            const payload = { channel: "chan-9", bid: 100 };
            axios.put.mockResolvedValue({ data: "ok" });

            const result = await client.updateAuction(payload);

            expect(axios.put).toHaveBeenCalledWith(`${BASE}/chan-9`, payload, {
                httpsAgent: agent,
            });
            expect(result).toBe("ok");
        });

        it("re-throws on failure", async () => {
            axios.put.mockRejectedValue(new Error("bad"));
            await expect(
                client.updateAuction({ channel: "x" })
            ).rejects.toThrow("bad");
        });
    });

    describe("deleteAuction", () => {
        it("DELETEs the channel url", async () => {
            axios.delete.mockResolvedValue({ data: { deleted: true } });

            const result = await client.deleteAuction("chan-3");

            expect(axios.delete).toHaveBeenCalledWith(`${BASE}/chan-3`, {
                httpsAgent: agent,
            });
            expect(result).toEqual({ deleted: true });
        });

        it("re-throws on failure", async () => {
            axios.delete.mockRejectedValue(new Error("nope"));
            await expect(client.deleteAuction("chan-3")).rejects.toThrow("nope");
        });
    });

    describe("bid", () => {
        it("POSTs the bid to the /bid endpoint", async () => {
            const bidData = { channel: "chan-1", gold: 5000 };
            axios.post.mockResolvedValue({ data: { accepted: true } });

            const result = await client.bid(bidData);

            expect(axios.post).toHaveBeenCalledWith(`${BASE}/bid`, bidData, {
                httpsAgent: agent,
            });
            expect(result).toEqual({ accepted: true });
        });

        it("re-throws on failure", async () => {
            axios.post.mockRejectedValue(new Error("rejected"));
            await expect(client.bid({})).rejects.toThrow("rejected");
        });
    });

    describe("getAuction", () => {
        it("GETs the channel url", async () => {
            axios.get.mockResolvedValue({ data: { channel: "chan-1" } });

            const result = await client.getAuction("chan-1");

            expect(axios.get).toHaveBeenCalledWith(`${BASE}/chan-1`, {
                httpsAgent: agent,
            });
            expect(result).toEqual({ channel: "chan-1" });
        });

        it("re-throws on failure", async () => {
            axios.get.mockRejectedValue(new Error("404"));
            await expect(client.getAuction("chan-1")).rejects.toThrow("404");
        });
    });

    describe("getHighestBid", () => {
        it("GETs the currentbid url", async () => {
            axios.get.mockResolvedValue({ data: { gold: 9000 } });

            const result = await client.getHighestBid("chan-1");

            expect(axios.get).toHaveBeenCalledWith(
                `${BASE}/currentbid/chan-1`,
                { httpsAgent: agent }
            );
            expect(result).toEqual({ gold: 9000 });
        });

        it("re-throws on failure", async () => {
            axios.get.mockRejectedValue(new Error("err"));
            await expect(client.getHighestBid("chan-1")).rejects.toThrow("err");
        });
    });

    describe("getHighestBids", () => {
        it("GETs the highestbids url", async () => {
            axios.get.mockResolvedValue({ data: [{ gold: 1 }] });

            const result = await client.getHighestBids();

            expect(axios.get).toHaveBeenCalledWith(`${BASE}/highestbids`, {
                httpsAgent: agent,
            });
            expect(result).toEqual([{ gold: 1 }]);
        });

        it("re-throws on failure", async () => {
            axios.get.mockRejectedValue(new Error("err"));
            await expect(client.getHighestBids()).rejects.toThrow("err");
        });
    });

    describe("getWinner", () => {
        it("GETs the highestbid url", async () => {
            axios.get.mockResolvedValue({ data: { winner: "Player" } });

            const result = await client.getWinner("chan-1");

            expect(axios.get).toHaveBeenCalledWith(
                `${BASE}/highestbid/chan-1`,
                { httpsAgent: agent }
            );
            expect(result).toEqual({ winner: "Player" });
        });

        it("re-throws on failure", async () => {
            axios.get.mockRejectedValue(new Error("err"));
            await expect(client.getWinner("chan-1")).rejects.toThrow("err");
        });
    });
});
