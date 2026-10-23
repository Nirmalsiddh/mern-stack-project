const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const net = require('node:net');
const mongoose = require('mongoose');
const path = require('node:path');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const configured = process.env.HAVENHUB_TEST_MONGODB_URL;

test('HTTP application regressions on an isolated disposable MongoDB database', { skip: !configured && 'Set HAVENHUB_TEST_MONGODB_URL to an explicit loopback havenhub_test database', timeout: 30000 }, async t => {
    // Never use ATLASDB_URL or a development database. Each run gets its own database.
    const target = new URL(configured);
    assert.equal(target.protocol, 'mongodb:');
    assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname), 'Integration tests require an explicit local MongoDB');
    assert.match(target.pathname, /^\/havenhub_test(?:_[a-z0-9]+)*$/);
    assert.equal(target.search, '', 'Connection options are not accepted for the disposable local database');
    assert.equal(target.username, '');
    assert.equal(target.password, '');
    target.pathname += '_' + randomBytes(8).toString('hex');
    const uri = target.toString();
    const connection = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 3000 }).asPromise();
    const db = connection.db;
    assert.equal((await db.listCollections().toArray()).length, 0, 'Refuse to write into an existing database');
    console.log(`Disposable test target: ${target.hostname}:${target.port || 27017}${target.pathname}`);
    let child;
    let emptyTargetVerified = true;
    t.after(async () => {
        if (child && child.exitCode === null && child.signalCode === null) {
            const exited = once(child, 'exit');
            child.kill('SIGTERM');
            await exited;
        }
        // The random database was verified empty before startup. Delete only IDs
        // created in this run; never reset/drop collections or any other database.
        if (emptyTargetVerified) {
            for (const { name } of await db.listCollections().toArray()) {
                const collection = db.collection(name);
                const ids = (await collection.find({}, { projection: { _id: 1 } }).toArray()).map(doc => doc._id);
                if (ids.length) await collection.deleteMany({ _id: { $in: ids } });
                assert.equal(await collection.countDocuments(), 0);
            }
        }
        await connection.close();
    });
    const probe = net.createServer().listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    child = spawn(process.execPath, ['app.js'], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, NODE_ENV: 'test', ATLASDB_URL: uri, SECRET: randomBytes(48).toString('hex'), PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let logs = '';
    child.stdout.on('data', chunk => { logs += chunk; });
    child.stderr.on('data', chunk => { logs += chunk; });
    for (let i = 0; i < 100 && !(logs.includes('connect to DB') && logs.includes('app is listening')); i++) {
        assert.equal(child.exitCode, null, 'Application exited before readiness');
        await wait(50);
    }
    assert.ok(logs.includes('connect to DB'), 'Database readiness not reached');
    const base = `http://127.0.0.1:${port}`;
    function client() {
        let cookie = '';
        return async (url, fields, method = 'GET') => {
            const response = await fetch(base + url, {
                method: fields ? (method === 'GET' ? 'POST' : method) : method,
                headers: { ...(cookie ? { Cookie: cookie } : {}), ...(fields ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
                body: fields ? new URLSearchParams(fields) : undefined,
                redirect: 'manual',
            });
            const setCookie = response.headers.get('set-cookie');
            if (setCookie) cookie = setCookie.split(';')[0];
            return { status: response.status, location: response.headers.get('location'), text: await response.text() };
        };
    }
    const owner = client();
    const stranger = client();
    const guest = client();
    const credentials = { username: 'phase1_owner', email: 'owner@example.invalid', password: randomBytes(16).toString('hex') };
    let ownerId;
    let listingId;
    let reviewId;
    const missingId = new mongoose.Types.ObjectId();
    const listingBody = { 'listing[title]': 'Phase1 house', 'listing[description]': 'Test description', 'listing[price]': '125', 'listing[country]': 'India', 'listing[location]': 'Test city', 'listing[filters]': 'iconic-cities' };

    await t.test('public pages and static assets remain accessible', async () => {
        for (const page of ['/listings', '/login', '/signup', '/css/style.css', '/js/script.js']) {
            assert.equal((await guest(page)).status, 200);
        }
        const home = await guest('/');
        assert.equal(home.status, 302);
        assert.equal(home.location, '/listings');
    });
    await t.test('registration creates an authenticated user with hashed credentials', async () => {
        const res = await owner('/signup', credentials);
        assert.equal(res.status, 302);
        assert.equal(res.location, '/listings');
        const user = await db.collection('users').findOne({ username: credentials.username });
        assert.ok(user.hash && user.salt);
        assert.equal(user.password, undefined);
        ownerId = user._id;
        assert.equal((await owner('/listings/new')).status, 200);
        assert.equal((await stranger('/signup', { username: 'phase1_stranger', email: 'stranger@example.invalid', password: 'unique-test-password' })).status, 302);
    });
    await t.test('guest listing creation redirects to login without inserting a listing', async () => {
        const res = await guest('/listings', listingBody);
        assert.equal(res.status, 302);
        assert.equal(res.location, '/login');
        assert.equal(await db.collection('listings').countDocuments(), 0);
    });
    await t.test('invalid categories are rejected during creation', async () => {
        assert.equal((await owner('/listings', { ...listingBody, 'listing[filters]': 'not-real' })).status, 400);
        assert.equal(await db.collection('listings').countDocuments(), 0);
    });
    await t.test('owner creates a listing with a canonical category and fallback image', async () => {
        assert.equal((await owner('/listings', listingBody)).status, 302);
        const doc = await db.collection('listings').findOne({ title: 'Phase1 house' });
        listingId = doc._id;
        assert.equal(doc.filters, 'iconic cities');
        assert.ok(doc.owner.equals(ownerId));
        assert.ok(doc.image.url);
    });
    await t.test('public listing retrieval renders details and hides owner controls', async () => {
        const res = await guest('/listings/' + listingId);
        assert.equal(res.status, 200);
        assert.match(res.text, /Phase1 house/);
        assert.ok(!res.text.includes(`/listings/${listingId}/edit`));
    });
    await t.test('search matches country, escapes regex, and renders the no-match state', async () => {
        assert.match((await guest('/listings/search?country=india')).text, /Phase1 house/);
        for (const country of ['Atlantis', '[', '.*', '(a+)+$']) {
            const res = await guest('/listings/search?country=' + encodeURIComponent(country));
            assert.equal(res.status, 200);
            assert.match(res.text, /No listings found/);
        }
    });
    await t.test('empty search redirects; long and structured inputs return 400', async () => {
        for (const query of ['', '?country=', '?country=%20%20']) {
            const res = await guest('/listings/search' + query);
            assert.equal(res.status, 302);
            assert.equal(res.location, '/listings');
        }
        for (const query of ['?country=' + 'x'.repeat(101), '?country[$ne]=x', '?country=India&country=Japan']) {
            assert.equal((await guest('/listings/search' + query)).status, 400);
        }
    });
    await t.test('category filters match canonical and legacy records without changing them', async () => {
        const fixtures = [
            { title: 'Legacy alias', filters: 'iconic-cities' },
            { title: 'Uncategorized legacy' },
        ].map(doc => ({ ...doc, owner: ownerId, price: 100, country: 'France', image: { url: 'https://example.invalid/test.jpg' }, reviews: [] }));
        await db.collection('listings').insertMany(fixtures);
        for (const category of ['iconic%20cities', 'iconic-cities']) {
            const res = await guest('/listings?filter=' + category);
            assert.equal(res.status, 200);
            assert.match(res.text, /Phase1 house/);
            assert.match(res.text, /Legacy alias/);
            assert.doesNotMatch(res.text, /Uncategorized legacy/);
        }
        assert.match((await guest('/listings')).text, /Uncategorized legacy/);
        assert.equal((await db.collection('listings').findOne({ title: 'Legacy alias' })).filters, 'iconic-cities');
        assert.equal((await guest('/listings?filter=invalid')).status, 400);
        assert.equal((await guest('/listings?filter[$ne]=x')).status, 400);
    });
    await t.test('missing and malformed listing IDs return safe errors on every resource route', async () => {
        for (const [id, status] of [[missingId, 404], ['not-an-id', 400]]) {
            for (const [suffix, fields, method] of [['', null, 'GET'], ['/edit', null, 'GET'], ['', listingBody, 'PUT'], ['', null, 'DELETE'], ['/reviews', { 'review[rating]': '4', 'review[comment]': 'Test' }, 'POST']]) {
                const res = await owner(`/listings/${id}${suffix}`, fields, method);
                assert.equal(res.status, status);
                assert.doesNotMatch(res.text, /CastError|TypeError|mongodb:\/\/|node_modules/);
            }
        }
    });
    await t.test('another user cannot edit, update, or delete the listing', async () => {
        assert.equal((await stranger(`/listings/${listingId}/edit`)).status, 403);
        assert.equal((await stranger(`/listings/${listingId}`, listingBody, 'PUT')).status, 403);
        assert.equal((await stranger(`/listings/${listingId}`, null, 'DELETE')).status, 403);
        assert.equal((await db.collection('listings').findOne({ _id: listingId })).title, 'Phase1 house');
    });
    await t.test('guest update and delete redirect to login', async () => {
        for (const [fields, method] of [[listingBody, 'PUT'], [null, 'DELETE']]) {
            const res = await guest(`/listings/${listingId}`, fields, method);
            assert.equal(res.status, 302);
            assert.equal(res.location, '/login');
        }
    });
    await t.test('owner edit form selects current category; no-image update preserves image', async () => {
        const page = await owner(`/listings/${listingId}/edit`);
        assert.equal(page.status, 200);
        assert.match(page.text, /value="iconic cities" selected/);
        const oldImage = (await db.collection('listings').findOne({ _id: listingId })).image;
        assert.equal((await owner(`/listings/${listingId}`, { ...listingBody, 'listing[title]': 'Updated house', 'listing[filters]': 'amazing-pools' }, 'PUT')).status, 302);
        const doc = await db.collection('listings').findOne({ _id: listingId });
        assert.equal(doc.title, 'Updated house');
        assert.equal(doc.filters, 'amazing pools');
        assert.deepEqual(doc.image, oldImage);
        assert.match((await guest('/listings?filter=amazing%20pools')).text, /Updated house/);
        assert.equal((await owner(`/listings/${listingId}`, { ...listingBody, 'listing[filters]': 'invalid' }, 'PUT')).status, 400);
        assert.equal((await db.collection('listings').findOne({ _id: listingId })).filters, 'amazing pools');
    });
    await t.test('review creation requires login and validates ratings', async () => {
        const fields = { 'review[rating]': '4', 'review[comment]': 'Useful review' };
        assert.equal((await guest(`/listings/${listingId}/reviews`, fields)).location, '/login');
        assert.equal((await owner(`/listings/${listingId}/reviews`, { ...fields, 'review[rating]': '9' })).status, 400);
        const before = Date.now();
        assert.equal((await owner(`/listings/${listingId}/reviews`, fields)).status, 302);
        const review = await db.collection('reviews').findOne({ comment: 'Useful review' });
        reviewId = review._id;
        assert.ok(review.author.equals(ownerId));
        assert.ok(review.createdAt.getTime() >= before);
        assert.ok((await db.collection('listings').findOne({ _id: listingId })).reviews.some(id => id.equals(reviewId)));
    });
    await t.test('review deletion UI matches authorization; backend rejects guest and stranger', async () => {
        const control = `reviews/${reviewId}?_method=DELETE`;
        assert.ok((await owner(`/listings/${listingId}`)).text.includes(control));
        assert.ok(!(await guest(`/listings/${listingId}`)).text.includes(control));
        assert.ok(!(await stranger(`/listings/${listingId}`)).text.includes(control));
        assert.equal((await guest(`/listings/${listingId}/reviews/${reviewId}`, null, 'DELETE')).location, '/login');
        assert.equal((await stranger(`/listings/${listingId}/reviews/${reviewId}`, null, 'DELETE')).status, 403);
        assert.ok(await db.collection('reviews').findOne({ _id: reviewId }));
    });
    await t.test('missing, invalid, and unrelated review IDs are rejected', async () => {
        assert.equal((await owner(`/listings/${listingId}/reviews/${missingId}`, null, 'DELETE')).status, 404);
        assert.equal((await owner(`/listings/${listingId}/reviews/invalid`, null, 'DELETE')).status, 400);
        const otherListing = await db.collection('listings').findOne({ title: 'Legacy alias' });
        assert.equal((await owner(`/listings/${otherListing._id}/reviews/${reviewId}`, null, 'DELETE')).status, 404);
        assert.ok(await db.collection('reviews').findOne({ _id: reviewId }));
    });
    await t.test('review author can delete a review and remove its listing reference', async () => {
        assert.equal((await owner(`/listings/${listingId}/reviews/${reviewId}`, null, 'DELETE')).status, 302);
        assert.equal(await db.collection('reviews').findOne({ _id: reviewId }), null);
        assert.equal((await db.collection('listings').findOne({ _id: listingId })).reviews.length, 0);
    });
    await t.test('logout ends access; failed and successful login behave correctly', async () => {
        assert.equal((await owner('/logout')).status, 302);
        assert.equal((await owner(`/listings/${listingId}/edit`)).location, '/login');
        assert.equal((await owner('/login', { ...credentials, password: 'wrong-password' })).location, '/login');
        assert.equal((await owner('/login', credentials)).location, `/listings/${listingId}/edit`);
        assert.equal((await owner(`/listings/${listingId}/edit`)).status, 200);
    });
    await t.test('legacy listing updates use real document validation and persistence', async legacy => {
        await verifyLegacyUpdates(legacy, connection, ownerId);
    });
    await t.test('owner can delete listing and cascade-delete its reviews', async () => {
        assert.equal((await owner(`/listings/${listingId}/reviews`, { 'review[rating]': '5', 'review[comment]': 'Cascade test' })).status, 302);
        const review = await db.collection('reviews').findOne({ comment: 'Cascade test' });
        const res = await owner(`/listings/${listingId}`, null, 'DELETE');
        assert.equal(res.status, 302);
        assert.equal(res.location, '/listings');
        assert.equal(await db.collection('listings').findOne({ _id: listingId }), null);
        assert.equal(await db.collection('reviews').findOne({ _id: review._id }), null);
        assert.equal((await guest(`/listings/${listingId}`)).status, 404);
    });
    assert.doesNotMatch(logs, /ERR_HTTP_HEADERS_SENT|UnhandledPromiseRejection|ReferenceError/);
});

// Only Cloudinary storage and authentication identity are simulated here. Queries
// delegate to a real model on the verified-empty database; save() is never mocked.
async function verifyLegacyUpdates(t, connection, ownerId) {
    const express = require('express');
    const Listing = require('../models/listing');
    const TestListing = connection.model('Listing', Listing.schema);
    const { storage } = require('../cloudConfig');
    const router = require('../routes/listing');
    const { categories, normalizeCategory } = require('../utils/categories');
    let uploads = 0;
    t.mock.method(Listing, 'findById', (...args) => TestListing.findById(...args));
    t.mock.method(Listing, 'findByIdAndUpdate', (...args) => TestListing.findByIdAndUpdate(...args));
    t.mock.method(storage, '_handleFile', (req, file, done) => {
        uploads++;
        file.stream.resume();
        file.stream.on('end', () => done(null, { path: 'https://example.invalid/replacement.png', filename: 'mock-replacement' }));
    });
    const app = express();
    app.set('views', path.join(__dirname, '../views'));
    app.set('view engine', 'ejs');
    app.engine('ejs', require('ejs-mate'));
    app.use((req, res, next) => {
        req.user = req.headers['x-test-user'] === 'owner' ? { _id: ownerId } : req.headers['x-test-user'] === 'stranger' ? { _id: new mongoose.Types.ObjectId() } : undefined;
        req.isAuthenticated = () => Boolean(req.user);
        req.session = {};
        req.flash = () => {};
        Object.assign(res.locals, { currUser: req.user, categories, normalizeCategory, success: [], error: [] });
        next();
    });
    app.use('/listings', router);
    app.use(require('../utils/errorHandler'));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const base = `http://127.0.0.1:${server.address().port}`;
    const collection = connection.db.collection('listings');
    async function fixture(filters) {
        const doc = { title: 'Before update', description: 'Test description', location: 'Test city', country: 'India', price: 100, owner: ownerId, image: { url: 'https://example.invalid/original.png', filename: 'original' }, reviews: [] };
        if (filters !== undefined) doc.filters = filters;
        const { insertedId } = await collection.insertOne(doc);
        return insertedId;
    }
    async function update(id, { category, image = false, user = 'owner' } = {}) {
        const body = new FormData();
        for (const [key, value] of Object.entries({ title: 'After update', description: 'Updated description', location: 'Updated city', country: 'Japan', price: '200' })) body.set(`listing[${key}]`, value);
        if (category !== undefined) body.set('listing[filters]', category);
        if (image) body.set('listing[image]', new Blob(['fake PNG'], { type: 'image/png' }), 'replacement.png');
        const response = await fetch(`${base}/listings/${id}`, { method: 'PUT', body, headers: user ? { 'x-test-user': user } : {}, redirect: 'manual' });
        await response.text();
        return response;
    }
    await t.test('legacy edit form selects the canonical category without changing storage', async () => {
        const id = await fixture('iconic-cities');
        const response = await fetch(`${base}/listings/${id}/edit`, { headers: { 'x-test-user': 'owner' } });
        assert.equal(response.status, 200);
        assert.match(await response.text(), /value="iconic cities" selected/);
        assert.equal((await collection.findOne({ _id: id })).filters, 'iconic-cities');
    });
    for (const [legacy, canonical] of [['iconic-cities', 'iconic cities'], ['amazing-pools', 'amazing pools']]) {
        for (const image of [false, true]) {
            await t.test(`${legacy} normalizes on update with image=${image} and no category field`, async () => {
                const id = await fixture(legacy);
                assert.equal((await update(id, { image })).status, 302);
                const doc = await collection.findOne({ _id: id });
                assert.equal(doc.filters, canonical);
                assert.equal(doc.title, 'After update');
                assert.equal(doc.image.filename, image ? 'mock-replacement' : 'original');
            });
        }
    }
    await t.test('an explicit category selection overrides the legacy category', async () => {
        const id = await fixture('iconic-cities');
        assert.equal((await update(id, { category: 'rooms', image: true })).status, 302);
        assert.equal((await collection.findOne({ _id: id })).filters, 'rooms');
    });
    await t.test('valid existing category and image are preserved when omitted', async () => {
        const id = await fixture('amazing pools');
        assert.equal((await update(id)).status, 302);
        const doc = await collection.findOne({ _id: id });
        assert.equal(doc.filters, 'amazing pools');
        assert.equal(doc.image.filename, 'original');
    });
    await t.test('an uncategorized legacy listing remains editable', async () => {
        const id = await fixture();
        assert.equal((await update(id, { image: true })).status, 302);
        assert.equal((await collection.findOne({ _id: id })).filters, 'all');
    });
    await t.test('invalid submitted category leaves every persisted field unchanged', async () => {
        const id = await fixture('iconic-cities');
        const before = await collection.findOne({ _id: id });
        assert.equal((await update(id, { category: 'invalid-category', image: true })).status, 400);
        assert.deepEqual(await collection.findOne({ _id: id }), before);
    });
    await t.test('real Mongoose validation failure leaves fields and image unchanged', async () => {
        // Unknown historical data must be rejected, not silently recategorized.
        const id = await fixture('unknown-existing-category');
        const before = await collection.findOne({ _id: id });
        assert.equal((await update(id, { image: true })).status, 400);
        assert.deepEqual(await collection.findOne({ _id: id }), before);
    });
    await t.test('guest and non-owner requests never process uploads or mutate the listing', async () => {
        const id = await fixture('iconic-cities');
        const before = await collection.findOne({ _id: id });
        const previousUploads = uploads;
        assert.equal((await update(id, { user: null, image: true })).status, 302);
        assert.equal((await update(id, { user: 'stranger', image: true })).status, 403);
        assert.equal(uploads, previousUploads);
        assert.deepEqual(await collection.findOne({ _id: id }), before);
    });
}
