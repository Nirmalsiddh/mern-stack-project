const { csrfSync } = require('csrf-sync');
const { timingSafeEqual } = require('node:crypto');
const protection = csrfSync({
    getTokenFromRequest: req => req.get('x-csrf-token') || req.body?._csrf,
});
function addCsrfToken(req, res, next) {
    res.locals.csrfToken = protection.generateToken(req);
    res.set('Cache-Control', 'no-store');
    next();
}
function requireCsrf(req, res, next) {
    req.csrfToken = overwrite => protection.generateToken(req, overwrite);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const received = protection.getTokenFromRequest(req);
        const stored = req.session.csrfToken;
        // csrf-sync generates 128 random bytes encoded as 256 lowercase hex
        // characters. Bound the buffers before comparing their contents.
        const valid = value => typeof value === 'string' && /^[a-f0-9]{256}$/.test(value);
        if (!valid(received) || !valid(stored) || !timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(stored, 'hex'))) {
            return next(protection.invalidCsrfTokenError);
        }
    }
    if (req.body) delete req.body._csrf;
    next();
}
module.exports = { addCsrfToken, requireCsrf };
