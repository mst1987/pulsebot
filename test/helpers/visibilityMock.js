// A stand-in for services/characters/profileVisibility in route tests (#1077): tests set the accounts
// on `visibleRaiderIds`; `raiderVisibility` follows them with a readable member list. An unreadable
// one: `raiderVisibility.mockResolvedValueOnce({ ids: new Set(), membersKnown: false })`.
function visibilityMock(actual = {}) {
    const mock = { ...actual, visibleRaiderIds: jest.fn() };
    mock.raiderVisibility = jest.fn(async (...args) => ({ ids: await mock.visibleRaiderIds(...args), membersKnown: true }));
    return mock;
}

module.exports = { visibilityMock };
