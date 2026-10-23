const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { MongoClient } = require('mongodb');
const mongoose = require('mongoose');
const { pageNumber, pageInfo } = require('../utils/pagination');
test('account page input is bounded and out-of-range pages clamp safely', () => {
    for (const value of ['0', '-1', '1.5', '1e2', '1000000', '', ['1'], {}]) assert.throws(() => pageNumber(value));
    assert.equal(pageNumber(undefined), 1);
    const p = pageInfo(25, 999, '/saved');
    assert.equal(p.page, 3); assert.equal(p.skip, 24); assert.equal(p.next, null);
});

test('discovery validates sorting, size, page and combined literal filters', () => {
    const { discovery } = require('../utils/discovery');
    for (const query of [{sort:'__proto__'},{sort:{$gt:''}},{sort:['newest']},{pageSize:'0'},{pageSize:'25'},{pageSize:['12']},{pageSize:1000},{page:'-1'},{filter:{$ne:''}},{country:['India']}]) assert.throws(() => discovery(query), {statusCode:400});
    const state = discovery({country:'[India].*',filter:'iconic-cities',sort:'price-asc',page:'2',pageSize:'6'});
    assert.equal(state.filter.country.test('[India].*'),true);
    assert.equal(state.filter.country.test('India'),false);
    assert.deepEqual(state.order,{price:1,_id:1});
    assert.deepEqual(state.filter.filters.$in,['iconic cities','iconic-cities']);
    const page=pageInfo(20,state.page,'/listings',state.params,state.size);
    const next=new URL(page.next,'http://test');
    assert.equal(next.searchParams.get('page'),'3'); assert.equal(next.searchParams.get('country'),'[India].*');
    assert.equal(next.searchParams.get('filter'),'iconic cities'); assert.equal(next.searchParams.get('sort'),'price-asc'); assert.equal(next.searchParams.get('pageSize'),'6');
});
test('empty rating batches do not require a database connection', async () => {
    const { attachRatings } = require('../utils/ratings');
    await attachRatings([]);
});
test('portfolio HTTP workflows use a verified empty disposable database', { skip: !process.env.HAVENHUB_TEST_MONGODB_URL, timeout: 60000 }, async t => {
    const target = new URL(process.env.HAVENHUB_TEST_MONGODB_URL);
    assert.equal(target.protocol, 'mongodb:'); assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname));
    assert.match(target.pathname, /^\/havenhub_test(?:_[a-z0-9]+)*$/); assert.equal(target.search, ''); assert.equal(target.username, ''); assert.equal(target.password, '');
    target.pathname += '_portfolio_' + randomBytes(8).toString('hex');
    const guard = new MongoClient(target.toString(), { serverSelectionTimeoutMS: 3000 }); await guard.connect();
    const db = guard.db(); assert.equal((await db.listCollections().toArray()).length, 0);
    console.log('Verified empty portfolio database:', db.databaseName);
    let runtime;
    t.after(async () => {
        if (runtime) await runtime.shutdown();
        for (const { name } of await db.listCollections().toArray()) {
            const col = db.collection(name); const ids = (await col.find({}, { projection: { _id: 1 } }).toArray()).map(x => x._id);
            if (ids.length) await col.deleteMany({ _id: { $in: ids } });
            assert.equal(await col.countDocuments(), 0);
        }
        await guard.close();
    });
    const { readConfig } = require('../config/environment');
    runtime = await require('../app').start({ installSignals: false, config: { ...readConfig({ NODE_ENV: 'test', SECRET: randomBytes(48).toString('hex'), ATLASDB_URL: target.toString(), UPLOADS_ENABLED: 'false', LOGIN_LIMIT: '100', SIGNUP_LIMIT: '100' }), port: 0 } });
    const base = `http://127.0.0.1:${runtime.server.address().port}`;
    function client() {
        let cookie = '';
        const request = async (path, fields, method = 'GET', csrf = true) => {
            if (fields && csrf) {
                const page = await request('/login');
                fields = { ...fields, _csrf: page.text.match(/name="_csrf" value="([^"]+)"/)[1] };
            }
            const response = await fetch(base + path, { method: fields ? (method === 'GET' ? 'POST' : method) : method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(fields ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, body: fields ? new URLSearchParams(fields) : undefined, redirect: 'manual' });
            if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
            return { status: response.status, location: response.headers.get('location'), text: await response.text() };
        }; return request;
    }
    const a = client(), b = client(), guest = client();
    const password = randomBytes(16).toString('hex');
    for (const [who, username] of [[a, 'portfolio_a'], [b, 'portfolio_b']]) assert.equal((await who('/signup', { username, email: username + '@example.invalid', password })).status, 302);
    const owner = await db.collection('users').findOne({ username: 'portfolio_a' });
    const other = await db.collection('users').findOne({ username: 'portfolio_b' });
    const Listing = require('../models/listing'); const Favorite = require('../models/favorite');
    await Favorite.init();
    const listing = await Listing.create({ title: 'Owner A space', description: 'A real fixture', owner: owner._id, price: 125, country: 'India', location: 'City', filters: 'rooms' });
    const otherListing = await Listing.create({ title: 'Private B management', owner: other._id, price: 50, country: 'Japan', filters: 'rooms' });
    await t.test('guest account routes and favorite mutations require authentication', async () => {
        for (const path of ['/saved', '/my-listings', '/profile']) assert.equal((await guest(path)).location, '/login');
        assert.equal((await guest('/saved/' + listing.id, {})).location, '/login');
        const returning = client();
        assert.equal((await returning('/saved/' + listing.id, {})).location, '/login');
        assert.equal((await returning('/login', { username: 'portfolio_a', password })).location, '/saved', 'Login returns to a safe GET page rather than replaying a favorite POST');
    });
    await t.test('favorites enforce CSRF, validate IDs, and handle absent listings', async () => {
        assert.equal((await a('/saved/' + listing.id, {}, 'POST', false)).status, 403);
        assert.equal((await a('/saved/invalid', {})).status, 400);
        assert.equal((await a('/saved/' + new mongoose.Types.ObjectId(), {})).status, 404);
        assert.equal((await a('/saved')).text.includes('No saved stays yet.'), true);
    });
    await t.test('concurrent duplicate saves are idempotent and session-owned', async () => {
        const replies = await Promise.all(Array.from({ length: 4 }, () => a('/saved/' + listing.id, { user: String(other._id) })));
        assert.ok(replies.every(x => x.status === 302));
        assert.equal(await Favorite.countDocuments({ user: owner._id, listing: listing._id }), 1);
        assert.equal(await Favorite.countDocuments({ user: other._id }), 0);
        assert.match((await a('/listings/' + listing.id)).text, /aria-pressed="true"/);
        assert.match((await b('/listings/' + listing.id)).text, /aria-pressed="false"/);
    });
    await t.test('saved pages and remove operations isolate users', async () => {
        assert.match((await a('/saved')).text, /Owner A space/);
        assert.doesNotMatch((await b('/saved')).text, /Owner A space/);
        assert.equal((await b('/saved/' + listing.id + '?_method=DELETE', {})).status, 302);
        assert.equal(await Favorite.countDocuments({ user: owner._id }), 1);
        assert.equal((await a('/saved/' + listing.id + '?_method=DELETE', {}, 'POST', false)).status, 403);
        for (let i = 0; i < 2; i++) assert.equal((await a('/saved/' + listing.id + '?_method=DELETE', {})).status, 302);
        assert.equal(await Favorite.countDocuments({ user: owner._id }), 0);
    });
    await t.test('dashboard derives ownership from session and preserves protected management routes', async () => {
        const page = await a('/my-listings?owner=' + other._id);
        assert.match(page.text, /Owner A space/); assert.doesNotMatch(page.text, /Private B management/);
        assert.match(page.text, new RegExp('/listings/' + listing.id + '/edit'));
        assert.equal((await a('/listings/' + listing.id + '/edit')).status, 200, 'Legacy listing without an image remains editable');
        assert.equal((await b('/listings/' + listing.id + '/edit')).status, 403);
        assert.equal((await b('/listings/' + listing.id + '?_method=DELETE', {})).status, 403);
        assert.equal((await a('/my-listings?page=-1')).status, 400);
    });
    await t.test('profile exposes own available fields and live counts only', async () => {
        const page = await a('/profile'); assert.match(page.text, /portfolio_a@example.invalid/); assert.doesNotMatch(page.text, /portfolio_b@example.invalid/);
        assert.ok(!page.text.includes(owner.hash)); assert.ok(!page.text.includes(owner.salt)); assert.ok(!page.text.includes(String(owner._id)));
        assert.doesNotMatch(page.text, /Account creation date/);
    });
    await t.test('deleted and missing saved references are hidden and listing deletion cleans favorites', async () => {
        await a('/saved/' + otherListing.id, {});
        await Favorite.create({ user: owner._id, listing: new mongoose.Types.ObjectId() });
        assert.equal((await a('/saved')).status, 200);
        assert.equal((await b('/listings/' + otherListing.id + '?_method=DELETE', {})).status, 302);
        assert.equal(await Favorite.countDocuments({ listing: otherListing._id }), 0);
        assert.doesNotMatch((await a('/saved')).text, /Private B management/);
        assert.match((await b('/my-listings')).text, /Your first listing starts here/);
    });
    const fixtures = Array.from({length:26},(_,i)=>({ _id:new mongoose.Types.ObjectId(), title:'Sorted fixture '+i, description:'Pagination fixture', owner:owner._id, country:'Sortland', location:'City', price:Math.floor(i/2)*10, filters:i%2?'iconic-cities':'iconic cities', reviews:[] }));
    await db.collection('listings').insertMany(fixtures);
    const cardIds = text => [...text.matchAll(/class="stay-link" href="\/listings\/([a-f0-9]{24})"/g)].map(m=>m[1]);
    const query = '/listings?country=Sortland&filter=iconic-cities';
    await t.test('pagination covers first, middle, last and clamped pages without overlapping records', async () => {
        const first=await guest(query), middle=await guest(query+'&page=2'), last=await guest(query+'&page=3'), far=await guest(query+'&page=999999');
        assert.equal(cardIds(first.text).length,12); assert.equal(cardIds(middle.text).length,12); assert.equal(cardIds(last.text).length,2);
        assert.deepEqual(cardIds(last.text),cardIds(far.text));
        assert.equal(new Set([...cardIds(first.text),...cardIds(middle.text),...cardIds(last.text)]).size,26);
        assert.match(first.text,/Page 1 of 3/); assert.match(last.text,/Page 3 of 3/);
        assert.deepEqual(cardIds((await guest(query)).text),cardIds(first.text));
        assert.match((await guest('/listings?country=Absent')).text,/Page 1 of 1/);
    });
    await t.test('all four allowlisted sort orders use deterministic tie-breakers and preserve filters', async () => {
        for (const sort of ['newest','oldest','price-asc','price-desc']) {
            const direction=sort==='oldest'||sort==='price-asc'?1:-1;
            const expected=[...fixtures].sort((a,b)=> (sort.startsWith('price')?(a.price-b.price)*direction:0)||String(a._id).localeCompare(String(b._id))*direction).slice(0,6).map(x=>String(x._id));
            const response=await guest(query+'&sort='+sort+'&pageSize=6');
            assert.equal(response.status,200); assert.deepEqual(cardIds(response.text),expected);
            assert.match(response.text,/country=Sortland/); assert.match(response.text,/filter=iconic/); assert.match(response.text,/pageSize=6/);
            const searched=await guest('/listings/search?country=Sortland&filter=iconic-cities&sort='+sort+'&pageSize=6&page=2');
            assert.equal(cardIds(searched.text).length,6); assert.match(searched.text,/Page 2 of 5/);
        }
        for (const suffix of ['&page=0','&page=-1','&page[$gt]=1','&sort=invalid','&sort[$gt]=1','&pageSize=1000']) assert.equal((await guest(query+suffix)).status,400);
    });
    await t.test('aggregate card ratings and populated detail ratings agree and update after deletion', async () => {
        const stay=fixtures[25];const reviews=[{_id:new mongoose.Types.ObjectId(),rating:4,comment:'First',author:owner._id},{_id:new mongoose.Types.ObjectId(),rating:5,comment:'Second',author:other._id},{_id:new mongoose.Types.ObjectId(),rating:9,comment:'Invalid legacy',author:owner._id}];
        await db.collection('reviews').insertMany(reviews);
        await db.collection('listings').updateOne({_id:stay._id},{$set:{reviews:[...reviews.map(x=>x._id),reviews[0]._id,new mongoose.Types.ObjectId()]}});
        assert.match((await guest(query)).text,/4.5 out of 5 · 2 reviews/);
        assert.match((await guest('/listings/'+stay._id)).text,/4.5 out of 5 · 2 reviews/);
        assert.equal((await b('/listings/'+stay._id+'/reviews/'+reviews[1]._id+'?_method=DELETE',{})).status,302);
        assert.match((await guest(query)).text,/4.0 out of 5 · 1 review/);
        await db.collection('reviews').deleteOne({_id:reviews[0]._id});
        assert.doesNotMatch((await guest(query)).text,/4.0 out of 5/);
        assert.match((await guest('/listings/'+stay._id)).text,/No reviews yet/);
    });
    // Raw collection writes deliberately bypass Mongoose casting to model legacy/imported data.
    const ratingCases = [
        ['valid numeric ratings', [1, 5, 4.5], '3.5 out of 5 · 3 reviews', 0],
        ['stored numeric strings', ['5', '4'], 'No reviews yet', 2],
        ['stored booleans', [true, false], 'No reviews yet', 2],
        ['mixed valid and invalid ratings', [4, 5, '5', true, 9, null, [4], { value: 5 }], '4.5 out of 5 · 2 reviews', 6],
        ['no valid reviews', [0, 6, null, 'bad', false], 'No reviews yet', 5],
        ['BSON numeric ratings', [mongoose.mongo.Decimal128.fromString('4.5'), mongoose.mongo.Long.fromNumber(5), new mongoose.mongo.Double(4)], '4.5 out of 5 · 3 reviews', 0],
    ];
    for (const [name, values, expected, unavailable] of ratingCases) {
        await t.test('stored rating consistency: ' + name, async () => {
            const id = new mongoose.Types.ObjectId();
            const reviews = values.map(rating => ({ _id: new mongoose.Types.ObjectId(), rating, comment: 'Raw rating fixture', author: owner._id }));
            await db.collection('reviews').insertMany(reviews);
            await db.collection('listings').insertOne({ _id: id, title: 'Rating policy fixture', country: 'Ratingland', owner: owner._id, reviews: [...reviews.map(r => r._id), reviews[0]._id, new mongoose.Types.ObjectId()] });
            const summary = text => text.match(/<p class="rating-summary">([\s\S]*?)<\/p>/)[1].replace(/<[^>]+>/g, '').trim();
            const check = async expectedText => {
                const card = await guest('/listings?country=Ratingland');
                const detail = await guest('/listings/' + id);
                assert.equal(card.status, 200); assert.equal(detail.status, 200);
                assert.equal(summary(card.text), summary(detail.text));
                assert.ok(summary(card.text).endsWith(expectedText), summary(card.text));
                return detail.text;
            };
            const detail = await check(expected);
            // The duplicated first reference is populated twice on details, but counted once.
            assert.equal((detail.match(/Rating unavailable/g) || []).length, unavailable + (unavailable === values.length ? 1 : 0));
            if (name === 'mixed valid and invalid ratings') {
                assert.equal((await a('/listings/' + id + '/reviews/' + reviews[1]._id + '?_method=DELETE', {})).status, 302);
                await check('4.0 out of 5 · 1 review');
                assert.equal((await a('/listings/' + id + '/reviews/' + reviews[0]._id + '?_method=DELETE', {})).status, 302);
                await check('No reviews yet');
                assert.equal((await a('/listings/' + id + '/reviews', { 'review[rating]': '5', 'review[comment]': 'Normal validated review' })).status, 302);
                await check('5.0 out of 5 · 1 review');
            }
            await db.collection('listings').deleteOne({ _id: id });
        });
    }
    await t.test('declared favorites and owner/sort indexes are present in the disposable database', async () => {
        await Listing.init();
        const favorites=await db.collection('favorites').indexes();const listings=await db.collection('listings').indexes();
        assert.ok(favorites.some(x=>x.unique&&x.key.user===1&&x.key.listing===1));
        assert.ok(listings.some(x=>x.key.owner===1&&x.key._id===-1));
        assert.ok(listings.some(x=>x.key.price===1&&x.key._id===1));
    });

    await t.test('account collections paginate live references and exclude dangling favorites from totals', async () => {
        await Favorite.insertMany(fixtures.map(x=>({ user:owner._id, listing:x._id })));
        const first=await a('/saved'), last=await a('/saved?page=3');
        assert.equal(cardIds(first.text).length,12);assert.equal(cardIds(last.text).length,2);
        assert.match(last.text,/Page 3 of 3/);
        assert.equal(cardIds((await a('/my-listings?page=2')).text).length,12);
        assert.match((await b('/my-listings')).text,/Your first listing starts here/);
    });
    await t.test('missing prices remain unavailable and sort deterministically without inventing zero prices', async () => {
        const noPrice={_id:new mongoose.Types.ObjectId(),title:'Missing price',country:'MissingPriceLand',reviews:[]};
        const priced={_id:new mongoose.Types.ObjectId(),title:'Zero price',country:'MissingPriceLand',price:0,reviews:[]};
        await db.collection('listings').insertMany([noPrice,priced]);
        const asc=await guest('/listings?country=MissingPriceLand&sort=price-asc');
        const desc=await guest('/listings?country=MissingPriceLand&sort=price-desc');
        assert.deepEqual(cardIds(asc.text),[String(noPrice._id),String(priced._id)]);
        assert.deepEqual(cardIds(desc.text),[String(priced._id),String(noPrice._id)]);
        assert.match(asc.text,/Price unavailable/);assert.match(asc.text,/₹0/);
    });

});
