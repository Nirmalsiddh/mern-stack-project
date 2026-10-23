module.exports = function logSessionStoreError(err) {
    // Store errors may contain connection strings or session data. Log no payload.
    console.error("MongoDB session store error; session storage is unavailable.");
};
