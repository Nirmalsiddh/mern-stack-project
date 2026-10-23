const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');
const Listing = require('../models/listing');
const { storage } = require('../cloudConfig');
const router = require('../routes/listing');
const { categories } = require('../utils/categories');

const ownerId = new mongoose.Types.ObjectId();
const strangerId = new mongoose.Types.ObjectId();
const listingId = new mongoose.Types.ObjectId();

async function harness(t) {
    const listing = new Listing({ _id: listingId, title: 'Original', description: 'Description', country: 'India', location: 'City', price: 100, owner: ownerId, image: { url: 'original', filename: 'original.jpg' } });
    let uploads = 0;
    let updates = 0;
    t.mock.method(Listing, 'findById', async id => id === listingId.toString() ? listing : null);
    // This unit harness mocks persistence, but still runs real document validation.
    t.mock.method(listing, 'save', async () => { await listing.validate(); updates++; return listing; });
    t.mock.method(storage, '_handleFile', (req, file, done) => {
        uploads++;
        file.stream.resume();
        file.stream.on('end', () => done(null, { path: 'https://example.invalid/upload.png', filename: 'mock-upload' }));
    });
    const app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use((req, res, next) => {
        req.user = req.headers['x-test-user'] === 'owner' ? { _id: ownerId } : req.headers['x-test-user'] === 'stranger' ? { _id: strangerId } : undefined;
        req.isAuthenticated = () => Boolean(req.user);
        req.session = {};
        req.flash = () => {};
        res.locals.categories = categories;
        next();
    });
    app.use('/listings', router);
    app.use((err, req, res, next) => res.status(err.statusCode || 500).send(err.statusCode ? err.message : 'Internal error'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    return { listing, get uploads() { return uploads; }, get updates() { return updates; }, async send(user, id = listingId, withImage = true) {
        const form = new FormData();
        for (const [key, value] of Object.entries({ title: 'Updated', description: 'Description', country: 'India', location: 'City', price: '200', filters: 'amazing pools' })) form.set(`listing[${key}]`, value);
        if (withImage) form.set('listing[image]', new Blob(['fake PNG'], { type: 'image/png' }), 'test.png');
        return fetch(`http://127.0.0.1:${server.address().port}/listings/${id}`, { method: 'PUT', headers: user ? { 'x-test-user': user } : {}, body: form, redirect: 'manual' });
    } };
}

test('unauthenticated multipart modification never invokes upload processing', async t => {
    const h = await harness(t);
    const res = await h.send();
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/login');
    assert.equal(h.uploads, 0);
    assert.equal(h.updates, 0);
});
test('another user cannot upload to or update a listing', async t => {
    const h = await harness(t);
    assert.equal((await h.send('stranger')).status, 403);
    assert.equal(h.uploads, 0);
    assert.equal(h.updates, 0);
});
test('invalid and missing listing ids fail before uploading', async t => {
    const h = await harness(t);
    assert.equal((await h.send('owner', 'bad-id')).status, 400);
    assert.equal((await h.send('owner', new mongoose.Types.ObjectId())).status, 404);
    assert.equal(h.uploads, 0);
    assert.equal(h.updates, 0);
});
test('authorized multipart update processes one mocked upload and saves image', async t => {
    const h = await harness(t);
    const res = await h.send('owner');
    assert.equal(res.status, 302);
    assert.equal(h.uploads, 1);
    assert.equal(h.updates, 1);
    assert.equal(h.listing.title, 'Updated');
    assert.equal(h.listing.filters, 'amazing pools');
    assert.equal(h.listing.image.url, 'https://example.invalid/upload.png');
});
test('authorized update without an image preserves the current image', async t => {
    const h = await harness(t);
    assert.equal((await h.send('owner', listingId, false)).status, 302);
    assert.equal(h.uploads, 0);
    assert.equal(h.updates, 1);
    assert.equal(h.listing.image.url, 'original');
});
