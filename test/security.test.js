const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const session = require('express-session');
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { Writable } = require('node:stream');
const { once } = require('node:events');
const { readConfig, sessionOptions } = require('../config/environment');
const { createApp } = require('../app');
const { requireCsrf } = require('../utils/csrf');
const { parseImage, uploadImage, cleanupUnusedUpload, verifiedImage, MAX_IMAGE_BYTES } = require('../utils/imageUpload');
const { cloudinary } = require('../cloudConfig');
const { installHarnessSecurity, csrfSession, mockUpload, png } = require('../test-support/security');
const env = () => ({ NODE_ENV: 'test', SECRET: randomBytes(48).toString('hex'), ATLASDB_URL: 'mongodb://127.0.0.1:27017/havenhub_test_config', UPLOADS_ENABLED: 'false' });

async function listen(t, app) {
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    return `http://127.0.0.1:${server.address().port}`;
}
for (const patch of [{ SECRET: '' }, { SECRET: 'a'.repeat(64) }, { ATLASDB_URL: '' }, { PORT: 'NaN' }, { NODE_ENV: 'prod' }, { TRUST_PROXY: 'true' }, { TRUST_PROXY: '1' }, { TRUST_PROXY: '0.0.0.0/99' }, { NODE_ENV: 'production' , UPLOADS_ENABLED: undefined }, { CLOUD_NAME: 'partial' }]) {
    test(`configuration rejects invalid ${Object.keys(patch).join(', ')} safely`, () => {
        assert.throws(() => readConfig({ ...env(), ...patch }), error => !error.message.includes('mongodb://') && !error.message.includes('partial'));
    });
}
test('session cookies are explicit and production requires secure cookies', () => {
    const development = readConfig(env());
    const production = readConfig({ ...env(), NODE_ENV: 'production', TRUST_PROXY: '127.0.0.1/32' });
    for (const config of [development, production]) {
        const options = sessionOptions(config, new session.MemoryStore());
        assert.equal(options.cookie.httpOnly, true);
        assert.equal(options.cookie.sameSite, 'lax');
        assert.equal(options.cookie.secure, config.production);
        assert.equal(options.cookie.maxAge, 604800000);
        assert.equal(options.resave, false);
        assert.equal(options.saveUninitialized, false);
    }
    assert.throws(() => sessionOptions(production));
});
test('redirects accept local paths and reject external or malformed locations', () => {
    const safe = require('../utils/safeRedirect');
    assert.equal(safe('/listings/123/edit'), '/listings/123/edit');
    for (const input of ['https://evil.invalid', '//evil.invalid', '/\\evil.invalid', '/\r\nLocation: evil', null]) assert.equal(safe(input), '/listings');
});
test('CSRF tokens are session-bound; valid accepted, missing/invalid/replayed from another session rejected', async t => {
    const app = express();
    installHarnessSecurity(app);
    app.use(express.urlencoded({ extended: true }));
    app.post('/change', requireCsrf, (req, res) => res.send('saved'));
    app.use((err, req, res, next) => res.status(err.statusCode || 500).send('error'));
    const base = await listen(t, app);
    const csrf = await csrfSession(base);
    async function send(token, cookie = csrf.cookie) {
        return fetch(base + '/change', { method: 'POST', headers: { Cookie: cookie }, body: new URLSearchParams(token ? { _csrf: token } : {}) });
    }
    assert.equal((await send(csrf.token)).status, 200);
    assert.equal((await send()).status, 403);
    assert.equal((await send('invalid')).status, 403);
    assert.equal((await send(csrf.token, (await csrfSession(base)).cookie)).status, 403);
});

test('health endpoints and headers avoid sessions and expose no infrastructure', async t => {
    const connection = { readyState: 1, db: { command: async () => ({ ok: 1 }) } };
    const pass = (req, res, next) => next();
    const app = createApp({ config: readConfig(env()), store: new session.MemoryStore(), connection, authLimiters: { login: pass, signup: pass } });
    const base = await listen(t, app);
    const live = await fetch(base + '/health/live');
    assert.equal(live.status, 200);
    assert.equal(live.headers.get('set-cookie'), null);
    assert.equal(live.headers.get('x-powered-by'), null);
    assert.equal(live.headers.get('x-content-type-options'), 'nosniff');
    assert.match(live.headers.get('content-security-policy'), /script-src-attr 'none'/);
    assert.match(live.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(live.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(base + '/health/ready')).status, 200);
    connection.readyState = 0;
    const unavailable = await fetch(base + '/health/ready');
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), { status: 'unavailable' });
    connection.readyState = 1;
    app.locals.shuttingDown = true;
    assert.equal((await fetch(base + '/health/ready')).status, 503);
});
test('proxy trust is limited to explicit ranges and HTTPS sets a Secure session cookie', async t => {
    const pass = (req, res, next) => next();
    const config = readConfig({ ...env(), NODE_ENV: 'production', TRUST_PROXY: '127.0.0.1/32' });
    const app = createApp({ config, store: new session.MemoryStore(), authLimiters: { login: pass, signup: pass } });
    const base = await listen(t, app);
    const https = await fetch(base + '/login', { headers: { 'X-Forwarded-Proto': 'https' } });
    assert.match(https.headers.get('set-cookie'), /; Secure/);
    assert.match(https.headers.get('set-cookie'), /; HttpOnly/);
    assert.match(https.headers.get('set-cookie'), /; SameSite=Lax/);
    assert.match(https.headers.get('strict-transport-security'), /max-age/);
    const http = await fetch(base + '/login');
    assert.equal(http.headers.get('set-cookie'), null);
    const untrusted = createApp({ config: readConfig({ ...env(), NODE_ENV: 'production' }), store: new session.MemoryStore(), authLimiters: { login: pass, signup: pass } });
    const direct = await fetch((await listen(t, untrusted)) + '/login', { headers: { 'X-Forwarded-Proto': 'https' } });
    assert.equal(direct.headers.get('set-cookie'), null);
});
test('store errors render a safe response even before session locals initialize', async t => {
    const store = new session.MemoryStore();
    store.get = (sid, callback) => callback(new Error('mongodb://secret-user:secret-value@private-host'));
    const pass = (req, res, next) => next();
    const app = createApp({ config: readConfig(env()), store, authLimiters: { login: pass, signup: pass } });
    const base = await listen(t, app);
    const first = await fetch(base + '/login');
    const cookie = first.headers.get('set-cookie').split(';')[0];
    const failed = await fetch(base + '/login', { headers: { Cookie: cookie } });
    assert.equal(failed.status, 500);
    assert.doesNotMatch(await failed.text(), /secret-value|private-host|ReferenceError/);
});

test('decoder accepts real PNG/JPEG data and rejects spoofed, truncated, and executable content', async () => {
    const sharp = require('sharp');
    const original = await png();
    assert.equal((await sharp(await verifiedImage(original)).metadata()).format, 'png');
    const jpeg = await sharp(original).jpeg().toBuffer();
    assert.equal((await sharp(await verifiedImage(jpeg)).metadata()).format, 'jpeg');
    for (const bytes of [Buffer.from('MZ executable pretending to be an image'), Buffer.from('<svg onload="alert(1)"></svg>'), original.subarray(0, 30)]) await assert.rejects(verifiedImage(bytes), { statusCode: 400 });
});
test('multipart CSRF, file size, type, and storage failures are enforced before persistence', async t => {
    let calls = 0;
    mockUpload(t, 'wanderlust_DEV/security-test', () => calls++);
    const app = express();
    installHarnessSecurity(app);
    app.post('/upload', parseImage, requireCsrf, uploadImage, (req, res) => res.json({ path: req.file?.path || null }));
    app.use((err, req, res, next) => {
        if (err.name === 'MulterError') return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).send('Invalid upload');
        res.status(err.statusCode || 500).send('Request rejected');
    });
    const base = await listen(t, app);
    const csrf = await csrfSession(base);
    async function send(bytes, token = csrf.token, fields = {}) {
        const form = new FormData();
        if (token) form.set('_csrf', token);
        for (const [key, value] of Object.entries(fields)) form.set(key, value);
        if (bytes) form.set('listing[image]', new Blob([bytes], { type: 'image/png' }), 'claimed.png');
        return fetch(base + '/upload', { method: 'POST', headers: { Cookie: csrf.cookie }, body: form });
    }
    assert.equal((await send(await png(), null)).status, 403);
    assert.equal((await send(await png(), 'invalid')).status, 403);
    assert.equal((await send(Buffer.from('MZ executable'))).status, 400);
    assert.equal((await send(Buffer.alloc(MAX_IMAGE_BYTES + 1))).status, 413);
    assert.equal(calls, 0);
    assert.equal((await send(null, csrf.token, { 'listing[description]': '界'.repeat(5000) })).status, 200);
    assert.equal((await send(null, csrf.token, { 'listing[description]': 'x'.repeat(20001) })).status, 400);
    assert.equal((await send(null)).status, 200);
    assert.equal((await send(await png())).status, 200);
    assert.equal(calls, 1);
    t.mock.method(cloudinary.uploader, 'upload_stream', (options, done) => new Writable({ write(chunk, encoding, callback) { callback(new Error('private cloud configuration')); } }));
    const failed = await send(await png());
    assert.equal(failed.status, 502);
    assert.doesNotMatch(await failed.text(), /private cloud/);
});
test('cleanup removes only confirmed unreferenced new uploads, never active or ambiguous images', async t => {
    const deleted = [];
    t.mock.method(console, 'error', () => {});
    t.mock.method(cloudinary.uploader, 'destroy', async id => { deleted.push(id); });
    const validation = { name: 'ValidationError' };
    const image = { filename: 'wanderlust_DEV/new-test' };
    await cleanupUnusedUpload(image, { exists: async () => false }, validation);
    assert.deepEqual(deleted, ['wanderlust_DEV/new-test']);
    await cleanupUnusedUpload({ filename: 'wanderlust_DEV/active' }, { exists: async () => true }, validation);
    await cleanupUnusedUpload({ filename: 'wanderlust_DEV/uncertain' }, { exists: () => assert.fail('Must not race an uncertain write') }, new Error('network error'));
    await cleanupUnusedUpload({ filename: 'wanderlust_DEV/not-checked' }, { exists: async () => { throw Error('DB offline'); } }, validation);
    await cleanupUnusedUpload({ filename: 'external/asset' }, { exists: () => assert.fail('Unmanaged asset') }, validation);
    assert.deepEqual(deleted, ['wanderlust_DEV/new-test']);
});

async function runChild(overrides) {
    const child = spawn(process.execPath, ['app.js'], { env: { ...process.env, ...env(), CLOUD_NAME: '', CLOUD_API_KEY: '', CLOUD_API_SECRET: '', ...overrides }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => output += chunk);
    child.stderr.on('data', chunk => output += chunk);
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    const [code, signal] = await once(child, 'exit');
    clearTimeout(timer);
    return { code, signal, output };
}
test('missing configuration exits without leaking values or listening', async () => {
    const result = await runChild({ SECRET: 'private-invalid-secret' });
    assert.equal(result.code, 1);
    assert.equal(result.signal, null);
    assert.match(result.output, /Configuration error/);
    assert.doesNotMatch(result.output, /private-invalid-secret|app is listening/);
});
test('unavailable database exits predictably without accepting traffic', async () => {
    const result = await runChild({ ATLASDB_URL: 'mongodb://127.0.0.1:1/havenhub_test_unavailable', DB_TIMEOUT_MS: '100' });
    assert.equal(result.code, 1);
    assert.equal(result.signal, null);
    assert.match(result.output, /Application startup failed/);
    assert.doesNotMatch(result.output, /mongodb:\/\/|app is listening/);
});

test('session encryption round-trips JSON, uses random IVs, and rejects tampering', () => {
    const transforms = require('../utils/sessionTransforms')(env().SECRET);
    const value = { csrfToken: 'synthetic-token', passport: { user: 'synthetic-user' }, cookie: { maxAge: 1000 } };
    const first = transforms.serialize(value);
    const second = transforms.serialize(value);
    assert.notEqual(first, second);
    assert.deepEqual(transforms.unserialize(first), value);
    assert.doesNotMatch(first, /synthetic-token|synthetic-user/);
    const changed = JSON.parse(first);
    const ciphertext = Buffer.from(changed.data, 'base64');
    ciphertext[0] ^= 1;
    changed.data = ciphertext.toString('base64');
    assert.throws(() => transforms.unserialize(JSON.stringify(changed)));
});

test('field bounds and types reject unsafe payloads without breaking legacy usernames', () => {
    const { listingSchema, reviewSchema, signupSchema, loginSchema } = require('../schema');
    assert.equal(loginSchema.validate({ username: 'old-user', password: 'existing-password' }).error, undefined);
    assert.ok(loginSchema.validate({ username: { $ne: '' }, password: 'password' }).error);
    assert.ok(signupSchema.validate({ username: 'new-user', email: 'a@example.invalid', password: 'long-password-123' }).error);
    assert.ok(reviewSchema.validate({ review: { rating: 5, comment: 'x'.repeat(2001) } }).error);
    const listing = { title: 'x'.repeat(121), description: 'Description', location: 'City', country: 'India', price: 1 };
    assert.ok(listingSchema.validate({ listing }).error);
    assert.ok(listingSchema.validate({ listing: { ...listing, title: 'Valid', country: { $ne: '' } } }).error);
    assert.throws(() => readConfig({ ...env(), TRUST_PROXY: '0.0.0.0/0' }));
});
