const session = require('express-session');
const { randomBytes } = require('node:crypto');
const { Writable } = require('node:stream');
const sharp = require('sharp');
const { addCsrfToken } = require('../utils/csrf');
const { cloudinary } = require('../cloudConfig');
const png = () => sharp({ create: { width: 2, height: 2, channels: 3, background: '#335577' } }).png().toBuffer();
function installHarnessSecurity(app) {
    app.locals.config = { uploadsEnabled: true, production: false };
    app.use(session({ store: new session.MemoryStore(), secret: randomBytes(48).toString('hex'), resave: false, saveUninitialized: false }));
    app.use(addCsrfToken);
    app.get('/__test/csrf', (req, res) => res.json({ token: res.locals.csrfToken }));
}
async function csrfSession(base) {
    const response = await fetch(base + '/__test/csrf');
    return { token: (await response.json()).token, cookie: response.headers.get('set-cookie').split(';')[0] };
}
function mockUpload(t, publicId, onUpload = () => {}) {
    const destroyed = [];
    t.mock.method(cloudinary.uploader, 'destroy', async id => { destroyed.push(id); return { result: 'ok' }; });
    t.mock.method(cloudinary.uploader, 'upload_stream', (options, done) => {
        onUpload();
        return new Writable({ write(chunk, encoding, callback) { callback(); }, final(callback) {
            done(null, { secure_url: 'https://example.invalid/' + publicId.split('/').pop() + '.png', public_id: publicId });
            callback();
        } });
    });
    return { destroyed };
}
module.exports = { installHarnessSecurity, csrfSession, mockUpload, png };
