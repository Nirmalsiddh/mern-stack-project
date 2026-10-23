const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const ejs = require('ejs');
const { categories, normalizeCategory } = require('../utils/categories');
const root = path.join(__dirname, '..');
const defaults = { layout() {}, currUser: null, csrfToken: 'ui-test-token', categories, normalizeCategory };
const render = (name, data = {}) => ejs.renderFile(path.join(root, 'views', name), { ...defaults, ...data });
const listing = {
    _id: '012345678901234567890123', title: '<script>unsafe</script>', description: 'A description',
    price: 0, location: 'A very long location '.repeat(5), country: 'India', filters: 'iconic-cities',
    image: null, reviews: [], owner: null,
};

test('discovery preserves canonical links, selected category and escaped real metadata with image fallback', async () => {
    const html = await render('listing/index.ejs', { allListings: [listing], activeCategory: 'iconic cities', searchTerm: '' });
    assert.match(html, /filter=iconic%20cities" aria-current="page"/);
    assert.match(html, /filter=amazing%20pools/);
    assert.match(html, /1 stay to explore/);
    assert.match(html, /&lt;script&gt;unsafe&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>unsafe/);
    assert.match(html, /src="\/images\/stay-placeholder.svg"/);
    assert.match(html, /Photo unavailable for/);
    assert.match(html, /₹0/);
    assert.match(html, /loading="lazy"/);
    assert.match(html, /A very long location/);
});

test('search preserves its country value safely and renders a useful zero-result state', async () => {
    const term = '" onfocus="alert(1)';
    const navbar = await render('includes/navbar.ejs', { searchTerm: term });
    assert.match(navbar, /action="\/listings\/search" method="get"/);
    assert.match(navbar, /label[^>]+for="site-search"/);
    assert.match(navbar, /name="country" maxlength="100"/);
    assert.match(navbar, /&#34; onfocus=&#34;alert\(1\)/);
    assert.doesNotMatch(navbar, /value="" onfocus=/);
    const empty = await render('listing/index.ejs', { allListings: [], activeCategory: null, searchTerm: 'Atlantis' });
    assert.match(empty, /Stays in Atlantis/);
    assert.match(empty, /No listings found for Atlantis/);
    assert.match(empty, /href="\/listings">Explore all stays/);
});

test('desktop and native mobile navigation preserve POST logout and session token', async () => {
    const html = await render('includes/navbar.ejs', { currUser: { username: 'host' } });
    assert.equal((html.match(/action="\/logout" method="post"/g) || []).length, 2);
    assert.equal((html.match(/name="_csrf" value="ui-test-token"/g) || []).length, 2);
    assert.match(html, /<details class="mobile-navigation">/);
    assert.match(html, /<summary>Menu/);
    assert.doesNotMatch(html, /href="\/logout"/);
    assert.doesNotMatch(html, /Join HavenHub/);
});

test('authentication forms keep labels, CSRF, bounds, autocomplete and account links', async () => {
    for (const [page, autocomplete, target] of [['login', 'current-password', '/signup'], ['signup', 'new-password', '/login']]) {
        const html = await render(`users/${page}.ejs`);
        assert.match(html, new RegExp(`action="/${page}"`));
        assert.match(html, /name="_csrf" value="ui-test-token"/);
        for (const id of page === 'signup' ? ['username', 'email', 'password'] : ['username', 'password']) {
            assert.match(html, new RegExp(`label for="${id}"`));
            assert.match(html, new RegExp(`id="${id}"`));
        }
        assert.match(html, new RegExp(`autocomplete="${autocomplete}"`));
        assert.ok(html.includes(`href="${target}"`));
        assert.match(html, /HavenHub/);
        assert.doesNotMatch(html, /WanderLust|Wanderlust/);
    }
});

test('shared listing fields retain legacy selection, escaped values, labels and multipart limits', async () => {
    for (const page of ['new', 'edit']) {
        const html = await render(`listing/${page}.ejs`, { listing, originalImageUrl: '' });
        assert.match(html, /enctype="multipart\/form-data"/);
        assert.match(html, /name="_csrf" value="ui-test-token"/);
        for (const id of ['title', 'description', 'category', 'country', 'location', 'price', 'image']) {
            assert.match(html, new RegExp(`label for="${id}"`));
            assert.match(html, new RegExp(`id="${id}"`));
        }
        assert.match(html, /accept="image\/png,image\/jpeg"/);
        assert.match(html, /data-max-bytes="5242880"/);
        assert.match(html, /Maximum 5 MB and 25 megapixels/);
        if (page === 'edit') {
            assert.match(html, /value="iconic cities" selected/);
            assert.match(html, /value="&lt;script&gt;unsafe&lt;\/script&gt;"/);
            assert.match(html, /value="0"/);
            assert.match(html, /required>A description<\/textarea>/);
        } else {
            assert.match(html, /required><\/textarea>/);
        }
    }
});

test('details tolerate absent data and expose a descriptive empty review state', async () => {
    const html = await render('listing/show.ejs', { listing: { ...listing, price: undefined } });
    assert.match(html, /Unavailable user/);
    assert.match(html, /Price unavailable/);
    assert.match(html, /No reviews yet/);
    assert.match(html, /Log in to review/);
    assert.doesNotMatch(html, /name="review\[comment\]"/);
    assert.doesNotMatch(html, /Delete listing/);
    assert.doesNotMatch(html, /Book now|Reserve|Verified host/);
});

test('feedback remains escaped and announced; error recovery points to an existing route', async () => {
    const flash = await render('includes/flash.ejs', { success: ['Saved'], error: ['<img src=x>'] });
    assert.match(flash, /role="status"/);
    assert.match(flash, /role="alert"/);
    assert.match(flash, /&lt;img src=x&gt;/);
    assert.match(flash, /aria-label="Dismiss error message"/);
    const error = await render('error.ejs', { message: '<script>secret</script>' });
    assert.match(error, /&lt;script&gt;secret&lt;\/script&gt;/);
    assert.match(error, /href="\/listings"/);
});

test('shared layout keeps security-compatible assets and semantic page landmarks', () => {
    const layout = fs.readFileSync(path.join(root, 'views/layouts/boilerplate.ejs'), 'utf8');
    assert.match(layout, /href="#main-content"/);
    assert.match(layout, /<main id="main-content"/);
    assert.match(layout, /script defer src="\/js\/script.js"/);
    assert.doesNotMatch(layout, /fonts.googleapis|cdnjs.cloudflare/);
    for (const name of ['listing/index.ejs', 'listing/show.ejs', 'users/login.ejs', 'users/signup.ejs', 'listing/form-fields.ejs']) {
        assert.doesNotMatch(fs.readFileSync(path.join(root, 'views', name), 'utf8'), /\son(?:click|error|load|submit)=/);
    }
});

// A small DOM harness exercises focus outcomes without adding browser dependencies
// to CI. Real Chromium checks additionally verify browser visibility and focus.
const vm = require('node:vm');
function validationHarness(controls, valid = false) {
    let focused = null;
    const listeners = {};
    const form = {
        checkValidity: () => valid,
        classList: { add(value) { assert.equal(value, 'was-validated'); } },
        addEventListener(name, handler) { (listeners[name] ||= []).push(handler); },
        querySelectorAll: () => controls,
        // A fieldset is :invalid when its descendant input is invalid.
        querySelector: () => ({ focus() {} }),
    };
    for (const control of controls) {
        Object.assign(control, {
            attributes: {},
            addEventListener() {},
            setAttribute(name, value) { this.attributes[name] = value; },
            getClientRects() { return this.displayHidden ? [] : [{}]; },
            closest() { return this.hiddenAncestor ? {} : null; },
            focus() { focused = this.id; },
        });
    }
    vm.runInNewContext(fs.readFileSync(path.join(root, 'public/js/script.js'), 'utf8'), {
        document: { querySelectorAll: () => [form], getElementById: () => null },
        window: { getComputedStyle: field => ({ visibility: field.visibility || 'visible' }) },
    });
    assert.equal(listeners.submit.length, 1, 'one submit listener per form');
    const event = { prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    listeners.submit[0](event);
    return { focused, event };
}
const field = (id, options = {}) => ({ id, willValidate: true, validity: { valid: false }, ...options });
for (const page of ['create', 'edit']) {
    test(`${page} validation focuses the first invalid input instead of its fieldset`, () => {
        const fields = [field('valid-title', { validity: { valid: true } }), field('description'), field('country')];
        const result = validationHarness(fields);
        assert.equal(result.focused, 'description');
        assert.equal(result.event.prevented, true);
        assert.equal(result.event.stopped, true);
        assert.equal(fields[0].attributes['aria-invalid'], 'false');
        assert.equal(fields[1].attributes['aria-invalid'], 'true');
    });
}
test('invalid focus skips disabled, hidden, inert and invisible controls', () => {
    const controls = [
        field('hidden-type', { willValidate: false }), field('disabled', { willValidate: false }),
        field('display-none', { displayHidden: true }), field('hidden-ancestor', { hiddenAncestor: true }),
        field('visibility-hidden', { visibility: 'hidden' }), field('visibility-collapse', { visibility: 'collapse' }),
        field('first-visible'), field('second-visible'),
    ];
    assert.equal(validationHarness(controls).focused, 'first-visible');
    assert.equal(validationHarness(controls.slice(0, 6)).focused, null);
});
test('valid submission remains unblocked and does not move focus', () => {
    const result = validationHarness([field('title', { validity: { valid: true } })], true);
    assert.equal(result.focused, null);
    assert.equal(result.event.prevented, false);
    assert.equal(result.event.stopped, false);
});
