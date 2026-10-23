const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const crypto = require('node:crypto');
const express = require('express');
const { installHarnessSecurity, csrfSession } = require('../test-support/security');
const { requireCsrf } = require('../utils/csrf');
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};

async function startupProbe(mode, cleanupFails = false) {
    // Exercise the actual connect-mongo constructor and initialization promise.
    // Only MongoDB I/O is substituted; no external database or credentials are used.
    const source = `
        process.env.NODE_ENV = 'test';
        const mongoose = require('mongoose');
        const express = require('express');
        const { readConfig } = require('./config/environment');
        let resolveIndex, rejectIndex, listens = 0, closes = 0, disconnects = 0, unhandled = 0;
        process.on('unhandledRejection', () => { unhandled++; });
        const index = new Promise((resolve, reject) => { resolveIndex = resolve; rejectIndex = reject; });
        const client = { db: () => ({ collection: () => ({ createIndex: () => index }) }), close: async () => { closes++; if (${cleanupFails}) throw Error('synthetic cleanup failure'); } };
        mongoose.connect = async () => {};
        mongoose.disconnect = async () => { disconnects++; };
        mongoose.connection.db = { collection: () => ({ createIndex: async () => {} }) };
        mongoose.connection.getClient = () => client;
        const originalListen = express.application.listen;
        express.application.listen = function (...args) { listens++; return originalListen.apply(this, args); };
        const config = { ...readConfig({ NODE_ENV: 'test', SECRET: require('crypto').randomBytes(48).toString('hex'), ATLASDB_URL: 'mongodb://127.0.0.1:1/havenhub_test_unused', UPLOADS_ENABLED: 'false' }), port: 0 };
        (async () => {
            if (${JSON.stringify(mode)} === 'success') resolveIndex('expires_1');
            const outcome = require('./app').start({ config, installSignals: false }).then(runtime => ({ runtime }), error => ({ error }));
            await new Promise(resolve => setTimeout(resolve, 40));
            const premature = ${JSON.stringify(mode)} !== 'success' && listens !== 0;
            if (${JSON.stringify(mode)} === 'rejected') rejectIndex(new Error('synthetic-initialization-error'));
            else resolveIndex('expires_1');
            const result = await outcome;
            if (result.runtime) await result.runtime.shutdown();
            await new Promise(resolve => setTimeout(resolve, 20));
            console.log('RESULT:' + JSON.stringify({ premature, listens, closes, disconnects, unhandled, rejected: Boolean(result.error), errorMessage: result.error?.message }));
        })().catch(() => { process.exitCode = 2; });
    `;
    const child = spawn(process.execPath, ['-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', bytes => { output += bytes; });
    child.stderr.on('data', bytes => { output += bytes; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    const [code, signal] = await once(child, 'exit');
    clearTimeout(timer);
    assert.equal(code, 0, output);
    assert.equal(signal, null, output);
    return JSON.parse(output.match(/RESULT:(.*)/)[1]);
}

for (const mode of ['success', 'delayed', 'rejected']) {
    test(`startup ${mode}: session initialization precedes listening and is cleaned up without unhandled rejection`, async () => {
        const result = await startupProbe(mode);
        assert.equal(result.premature, false);
        assert.equal(result.listens, mode === 'rejected' ? 0 : 1);
        assert.equal(result.rejected, mode === 'rejected');
        assert.equal(result.unhandled, 0);
        assert.equal(result.closes, 1);
        assert.equal(result.disconnects, 1);
        if (mode === 'rejected') {
            const cleanupFailure = await startupProbe(mode, true);
            assert.equal(cleanupFailure.listens, 0);
            assert.equal(cleanupFailure.unhandled, 0);
            assert.equal(cleanupFailure.closes, 1);
            assert.equal(cleanupFailure.disconnects, 1, 'Failed store close must not skip Mongoose cleanup');
            assert.equal(cleanupFailure.errorMessage, 'synthetic-initialization-error');
        }
    });
}

test('encryption rejects truncated tags, invalid IVs, malformed envelopes and invalid session payloads', () => {
    const secret = crypto.randomBytes(48).toString('hex');
    const transforms = require('../utils/sessionTransforms')(secret);
    const value = { cookie: { maxAge: 60000 }, passport: { user: 'synthetic' } };
    const encoded = transforms.serialize(value);
    assert.deepEqual(transforms.unserialize(encoded), value);
    // Preserve envelopes written before these corrections (same key/format).
    const oldKey = crypto.createHash('sha256').update('havenhub:session-encryption:' + secret).digest();
    function oldEnvelope(json) {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', oldKey, iv);
        const data = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
        return JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
    }
    assert.deepEqual(transforms.unserialize(oldEnvelope(JSON.stringify(value))), value);
    for (const json of ['', 'null', '[]', '"invalid"', '{']) assert.throws(() => transforms.unserialize(oldEnvelope(json)));
    const envelope = JSON.parse(encoded);
    const tag = Buffer.from(envelope.tag, 'base64');
    for (const length of [0, 4, 8, 12, 15]) {
        assert.throws(() => transforms.unserialize(JSON.stringify({ ...envelope, tag: tag.subarray(0, length).toString('base64') })));
    }
    for (const length of [0, 8, 11, 13, 16]) {
        assert.throws(() => transforms.unserialize(JSON.stringify({ ...envelope, iv: crypto.randomBytes(length).toString('base64') })));
    }
    const altered = Buffer.from(tag); altered[0] ^= 1;
    assert.throws(() => transforms.unserialize(JSON.stringify({ ...envelope, tag: altered.toString('base64') })));
    const ciphertext = Buffer.from(envelope.data, 'base64'); ciphertext[0] ^= 1;
    assert.throws(() => transforms.unserialize(JSON.stringify({ ...envelope, data: ciphertext.toString('base64') })));
    for (const patch of [{ version: 2 }, { data: '' }, { data: 'not base64!' }, { data: envelope.data.slice(0, -4) }, { iv: null }, { tag: [] }, { extra: true }]) {
        assert.throws(() => transforms.unserialize(JSON.stringify({ ...envelope, ...patch })));
    }
    for (const encoded of ['', '{', 'null', '[]', '{}', '"invalid"']) assert.throws(() => transforms.unserialize(encoded));
    for (const value of [null, undefined, '', 'invalid', [], 1]) assert.throws(() => transforms.serialize(value));
});

test('readiness bounds unresponsive work, aborts it, shares one operation and handles late settlement', { timeout: 2000 }, async () => {
    const { createReadinessCheck } = require('../app');
    for (const lateReject of [false, true]) {
        const ping = deferred();
        let calls = 0, options;
        const connection = { readyState: 1, db: { command: (command, received) => { calls++; options = received; return ping.promise; } } };
        const ready = createReadinessCheck(connection, 25);
        assert.deepEqual(await Promise.all(Array.from({ length: 20 }, () => ready())), Array(20).fill(false));
        assert.equal(calls, 1);
        assert.equal(options.timeoutMS, 25);
        assert.equal(options.signal.aborted, true);
        assert.deepEqual(await Promise.all(Array.from({ length: 20 }, () => ready())), Array(20).fill(false));
        assert.equal(calls, 1, 'A driver ignoring abort must not accumulate operations');
        if (lateReject) ping.reject(new Error('synthetic late database rejection'));
        else ping.resolve({ ok: 1 });
        await new Promise(resolve => setImmediate(resolve));
        connection.db.command = async () => ({ ok: 1 });
        assert.equal(await ready(), true);
        connection.readyState = 0;
        assert.equal(await ready(), false);
        connection.readyState = 1;
        connection.db.command = async () => { throw Error('synthetic unavailable'); };
        assert.equal(await ready(), false);
    }
});

test('unresponsive readiness HTTP requests return 503 without cookies or unbounded background work', { timeout: 3500 }, async t => {
    const { createApp } = require('../app');
    const { readConfig } = require('../config/environment');
    const session = require('express-session');
    const ping = deferred();
    let calls = 0;
    const connection = { readyState: 1, db: { command: () => { calls++; return ping.promise; } } };
    const pass = (req, res, next) => next();
    const config = readConfig({ NODE_ENV: 'test', SECRET: crypto.randomBytes(48).toString('hex'), ATLASDB_URL: 'mongodb://127.0.0.1:1/havenhub_test_unused', UPLOADS_ENABLED: 'false' });
    const app = createApp({ config, store: new session.MemoryStore(), connection, authLimiters: { login: pass, signup: pass } });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const base = `http://127.0.0.1:${server.address().port}`;
    const responses = await Promise.all(Array.from({ length: 10 }, () => fetch(base + '/health/ready')));
    for (const response of responses) {
        assert.equal(response.status, 503);
        assert.equal(response.headers.get('set-cookie'), null);
        assert.deepEqual(await response.json(), { status: 'unavailable' });
    }
    assert.equal(calls, 1);
    assert.equal((await fetch(base + '/health/ready')).status, 503);
    assert.equal(calls, 1);
    ping.reject(Error('synthetic late failure'));
    await new Promise(resolve => setImmediate(resolve));
});

test('CSRF preserves valid/header/session behavior and rejects malformed and unequal token lengths', async t => {
    const app = express();
    installHarnessSecurity(app);
    app.use(express.urlencoded({ extended: true }));
    app.post('/change', requireCsrf, (req, res) => res.send('saved'));
    app.use((error, req, res, next) => res.status(error.statusCode || 500).send('rejected'));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const base = `http://127.0.0.1:${server.address().port}`;
    const csrf = await csrfSession(base);
    for (const token of ['', csrf.token.slice(1), csrf.token + 'a', 'z'.repeat(256), 'a'.repeat(10000)]) {
        assert.equal((await fetch(base + '/change', { method: 'POST', headers: { Cookie: csrf.cookie }, body: new URLSearchParams({ _csrf: token }) })).status, 403);
    }
    assert.equal((await fetch(base + '/change', { method: 'POST', headers: { Cookie: csrf.cookie, 'x-csrf-token': csrf.token } })).status, 200);
    const duplicate = new URLSearchParams(); duplicate.append('_csrf', csrf.token); duplicate.append('_csrf', csrf.token);
    assert.equal((await fetch(base + '/change', { method: 'POST', headers: { Cookie: csrf.cookie }, body: duplicate })).status, 403);
});

test('authentication uses one real password verification for unknown and existing users and preserves failures', async t => {
    const User = require('../models/user');
    const { createAuthenticate } = require('../utils/authenticate');
    const user = new User({ username: 'synthetic-user' });
    await user.setPassword('synthetic-valid-password');
    const authenticate = await createAuthenticate(User);
    t.mock.method(User, 'findByUsername', async name => name === 'synthetic-user' ? user : null);
    const pbkdf2 = t.mock.method(crypto, 'pbkdf2');
    const login = (username, password) => new Promise((resolve, reject) => authenticate(username, password, (error, user) => error ? reject(error) : resolve(user)));
    assert.equal(await login('unknown', 'wrong'), false);
    assert.equal(pbkdf2.mock.callCount(), 1);
    assert.equal(await login('synthetic-user', 'wrong'), false);
    assert.equal(pbkdf2.mock.callCount(), 2);
    assert.equal(await login('synthetic-user', 'synthetic-valid-password'), user);
    assert.equal(pbkdf2.mock.callCount(), 3);
    t.mock.method(User, 'findByUsername', async () => { throw Error('synthetic database failure'); });
    await assert.rejects(login('unknown', 'wrong'), /synthetic database failure/);
});
