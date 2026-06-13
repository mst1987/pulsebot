const pendingApplications = new Map();

// Remove stale entries after 30 minutes (modal must be submitted promptly)
setInterval(() => {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [userId, data] of pendingApplications.entries()) {
        if (data.timestamp < cutoff) {
            pendingApplications.delete(userId);
        }
    }
}, 5 * 60 * 1000);

module.exports = { pendingApplications };
