const { createHash } = require('node:crypto');
const { rateLimit } = require('express-rate-limit');

// Shared counters use the existing MongoDB, with TTL cleanup and no process map.
class MongoRateLimitStore {
    constructor(collection, prefix) { this.collection = collection; this.prefix = prefix; }
    init(options) { this.windowMs = options.windowMs; }
    bucket(key) {
        const boundary = Math.floor(Date.now() / this.windowMs) * this.windowMs;
        const digest = createHash('sha256').update(key).digest('hex');
        return { id: `${this.prefix}:${digest}:${boundary}`, expires: new Date(boundary + this.windowMs) };
    }
    async increment(key) {
        const { id, expires } = this.bucket(key);
        const doc = await this.collection.findOneAndUpdate(
            { _id: id }, { $inc: { count: 1 }, $setOnInsert: { expires } },
            { upsert: true, returnDocument: 'after' },
        );
        return { totalHits: doc.count, resetTime: expires };
    }
    async decrement(key) { await this.collection.updateOne({ _id: this.bucket(key).id, count: { $gt: 0 } }, { $inc: { count: -1 } }); }
    async resetKey(key) { await this.collection.deleteOne({ _id: this.bucket(key).id }); }
}
function createAuthLimiters(collection, config) {
    const build = (prefix, limit) => rateLimit({
        windowMs: config.authWindowMs, limit, store: new MongoRateLimitStore(collection, prefix),
        standardHeaders: 'draft-8', legacyHeaders: false, passOnStoreError: false,
        message: 'Too many attempts. Please try again later.',
    });
    return { login: build('login', config.loginLimit), signup: build('signup', config.signupLimit) };
}
module.exports = { MongoRateLimitStore, createAuthLimiters };
