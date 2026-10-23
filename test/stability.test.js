const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ejs = require('ejs');
const mongoose = require('mongoose');
const Listing = require('../models/listing');
const Review = require('../models/review');
const controller = require('../controllers/listing');
const middleware = require('../middleware');
const wrapAsync = require('../utils/wrapAsync');
const { listingSchema } = require('../schema');
const { categories, normalizeCategory } = require('../utils/categories');
const root = path.join(__dirname, '..');
const body = { title: 'Test', description: 'Description', country: 'India', location: 'City', price: 10 };

for (const input of ['[', '.*', '(a+)+$', 'India']) {
    test(`search treats ${JSON.stringify(input)} as literal text`, async t => {
        let query;
        t.mock.method(Listing, 'countDocuments', () => ({ maxTimeMS: async () => 0 }));
        t.mock.method(Listing, 'find', async value => { query = value; return []; });
        await controller.search({ query: { country: input } }, { render(view, data) { assert.deepEqual(data.allListings, []); } });
        assert.equal(query.country.test(input), true);
        if (input !== 'India') assert.equal(query.country.test('India'), false);
    });
}
for (const input of [undefined, '', '   ']) {
    test(`empty search ${JSON.stringify(input)} redirects without querying`, async t => {
        const find = t.mock.method(Listing, 'find', () => { throw Error('Unexpected query'); });
        let redirected;
        await controller.search({ query: { country: input } }, { redirect(url) { redirected = url; } });
        assert.equal(redirected, '/listings');
        assert.equal(find.mock.callCount(), 0);
    });
}
for (const input of ['x'.repeat(101), ['India'], { $ne: '' }]) {
    test(`malformed search ${JSON.stringify(input).slice(0, 35)} returns 400`, async t => {
        const find = t.mock.method(Listing, 'find', () => { throw Error('Unexpected query'); });
        await assert.rejects(controller.search({ query: { country: input } }, {}), { statusCode: 400 });
        assert.equal(find.mock.callCount(), 0);
    });
}

test('categories normalize old links and validate listing input', () => {
    assert.equal(normalizeCategory('Iconic-Cities'), 'iconic cities');
    assert.equal(normalizeCategory('amazing-pools'), 'amazing pools');
    assert.equal(normalizeCategory({ $ne: '' }), null);
    assert.equal(new Listing(body).filters, 'all');
    for (const category of categories) {
        const result = listingSchema.validate({ listing: { ...body, filters: category.value } });
        assert.equal(result.error, undefined);
        assert.equal(result.value.listing.filters, category.value);
    }
    assert.ok(listingSchema.validate({ listing: { ...body, filters: 'invalid' } }).error);
    assert.equal(listingSchema.validate({ listing: { ...body, filters: 'iconic-cities' } }).value.listing.filters, 'iconic cities');
});

test('filter queries include spaced and legacy hyphenated records', async t => {
    t.mock.method(Listing, 'countDocuments', () => ({ maxTimeMS: async () => 0 }));
    let query;
    t.mock.method(Listing, 'find', async value => { query = value; return []; });
    await controller.index({ query: { filter: 'amazing-pools' } }, { render() {} });
    assert.deepEqual(query, { filters: { $in: ['amazing pools', 'amazing-pools'] } });
    await controller.index({ query: {} }, { render() {} });
    assert.deepEqual(query, {});
    await assert.rejects(controller.index({ query: { filter: 'bad' } }, {}), { statusCode: 400 });
    await assert.rejects(controller.index({ query: { filter: ['rooms'] } }, {}), { statusCode: 400 });
});

test('review timestamps are calculated per document', () => {
    const original = Date.now;
    let now = original();
    // The existing function reference calls Date.now's underlying clock, so use
    // separated construction times and verify both timestamps fall in their windows.
    assert.equal(typeof Review.schema.path('createdAt').defaultValue, 'function');
    const first = new Review({ comment: 'One', rating: 3 });
    assert.ok(first.createdAt.getTime() >= now);
    return new Promise(resolve => setTimeout(resolve, 20)).then(() => {
        now = original();
        const second = new Review({ comment: 'Two', rating: 4 });
        assert.ok(second.createdAt.getTime() >= now);
        assert.ok(second.createdAt > first.createdAt);
    });
});

test('session store error handler never logs credential or session payloads', t => {
    const log = t.mock.method(console, 'error', () => {});
    const handler = require('../utils/sessionStoreError');
    assert.doesNotThrow(() => handler(new Error('mongodb://user:credential@host/session-id')));
    assert.doesNotThrow(() => handler());
    assert.equal(log.mock.callCount(), 2);
    for (const call of log.mock.calls) assert.doesNotMatch(call.arguments.join(' '), /credential|session-id/);
});

test('async resource lookup errors reach Express next', async t => {
    const failure = new Error('database unavailable');
    t.mock.method(Listing, 'findById', async () => { throw failure; });
    const error = await new Promise(resolve => middleware.loadListing({ params: { id: new mongoose.Types.ObjectId().toString() } }, { locals: {} }, resolve));
    assert.equal(error, failure);
    const wrappedError = await new Promise(resolve => wrapAsync(async () => { throw failure; })({}, {}, resolve));
    assert.equal(wrappedError, failure);
});

test('shared script handles optional DOM elements and preserves form validation', () => {
    const source = fs.readFileSync(path.join(root, 'public/js/script.js'), 'utf8');
    const handlers = {};
    const form = { addEventListener(name, handler) { handlers[name] = handler; }, checkValidity: () => false, classList: { add(value) { assert.equal(value, 'was-validated'); } } };
    const context = { document: { querySelectorAll: () => [form], getElementById: () => null } };
    assert.doesNotThrow(() => vm.runInNewContext(source, context));
    let blocked = 0;
    handlers.submit({ preventDefault() { blocked++; }, stopPropagation() { blocked++; } });
    assert.equal(blocked, 2);
    assert.equal(Object.hasOwn(context, 'info'), false);
});

test('tax switch registers one handler and toggles all tax labels', () => {
    const source = fs.readFileSync(path.join(root, 'public/js/script.js'), 'utf8');
    const labels = [{ style: {} }, { style: {} }];
    let change;
    let count = 0;
    const toggle = { checked: true, addEventListener(event, handler) { assert.equal(event, 'change'); count++; change = handler; } };
    const context = { document: { querySelectorAll: () => [], getElementById: () => toggle, getElementsByClassName: () => labels } };
    vm.runInNewContext(source, context);
    assert.equal(count, 1);
    change();
    assert.ok(labels.every(label => label.style.display === 'inline'));
    toggle.checked = false;
    change();
    assert.ok(labels.every(label => label.style.display === 'none'));
    assert.equal(Object.hasOwn(context, 'info'), false);
});

test('search form sends country and category links use canonical values', async () => {
    const navbar = await ejs.renderFile(path.join(root, 'views/includes/navbar.ejs'), { currUser: null });
    assert.match(navbar, /name="country" maxlength="100"/);
    const html = await ejs.renderFile(path.join(root, 'views/listing/index.ejs'), { layout() {}, allListings: [], categories });
    assert.match(html, /filter=iconic%20cities/);
    assert.match(html, /filter=amazing%20pools/);
    assert.match(html, /No listings found/);
});

test('review deletion UI is restricted to authors and tolerates missing authors', async () => {
    const owner = { _id: new mongoose.Types.ObjectId(), username: 'Owner' };
    const author = { _id: new mongoose.Types.ObjectId(), username: 'Author' };
    const review = { _id: new mongoose.Types.ObjectId(), author, comment: 'Review', rating: 4 };
    const listing = { _id: new mongoose.Types.ObjectId(), owner, title: 'Listing', description: 'Text', image: { url: 'image' }, price: 100, reviews: [review] };
    const render = currUser => ejs.renderFile(path.join(root, 'views/listing/show.ejs'), { layout() {}, listing, currUser, csrfToken: "test-token" });
    const control = `reviews/${review._id}?_method=DELETE`;
    assert.ok((await render(author)).includes(control));
    assert.ok(!(await render(owner)).includes(control));
    assert.ok(!(await render(null)).includes(control));
    review.author = null;
    listing.owner = null;
    assert.match(await render(author), /Unavailable user/);
    assert.ok(!(await render(author)).includes(control));
});

test('central errors hide internal details and preserve expected client errors', () => {
    const handler = require('../utils/errorHandler');
    for (const [err, expected] of [[new Error('mongodb://credentials@host/private'), 500], [{ name: 'CastError', message: 'private value' }, 400], [{ name: 'ValidationError', message: 'private value' }, 400], [{ statusCode: 403, message: 'You are not the owner.' }, 403]]) {
        let status;
        let message;
        handler(err, {}, { status(code) { status = code; return this; }, render(view, data) { message = data.message; assert.equal(view, 'error.ejs'); } }, () => assert.fail('Unexpected forwarding'));
        assert.equal(status, expected);
        assert.doesNotMatch(message, /credentials|private/);
        if (expected === 403) assert.equal(message, 'You are not the owner.');
    }
});

test('central errors forward after headers are sent without sending a second response', () => {
    const error = new Error('Already sent');
    let forwarded;
    require('../utils/errorHandler')(error, {}, { headersSent: true, status() { assert.fail('Second response attempted'); } }, err => { forwarded = err; });
    assert.equal(forwarded, error);
});

test('search queries have a database execution time limit', async t => {
    t.mock.method(Listing, 'countDocuments', () => ({ maxTimeMS: async () => 0 }));
    let options;
    t.mock.method(Listing, 'find', async (query, projection, settings) => { options = settings; return []; });
    await controller.search({ query: { country: 'India' } }, { render() {} });
    assert.equal(options.maxTimeMS, 2000);
});

test('resource disappearance during an authorized update or deletion returns 404', async t => {
    t.mock.method(Listing, 'findByIdAndDelete', async () => null);
    const req = { params: { id: new mongoose.Types.ObjectId().toString() }, body: { listing: body } };
    const listing = new Listing(body);
    t.mock.method(listing, 'save', async () => {
        const error = new Error('Document no longer exists');
        error.name = 'DocumentNotFoundError';
        throw error;
    });
    await assert.rejects(controller.updateListing(req, { locals: { listing } }), { statusCode: 404 });
    await assert.rejects(controller.destroyListing(req, {}), { statusCode: 404 });
});
