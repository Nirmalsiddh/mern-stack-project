const mongoose = require('mongoose');
const Favorite = require('../models/favorite');
const Listing = require('../models/listing');
const { attachRatings } = require('../utils/ratings');
const User = require('../models/user');
const ExpressError = require('../utils/ExpressError');
const { pageNumber, pageInfo } = require('../utils/pagination');
const cardFields = { title: 1, image: 1, price: 1, location: 1, country: 1 };
const existingSaved = (user, fields = { _id: 1 }) => [
    { $match: { user } },
    { $lookup: { from: 'listings', localField: 'listing', foreignField: '_id', pipeline: [{ $project: fields }], as: 'stay' } },
    { $unwind: '$stay' },
];
module.exports.save = async (req, res) => {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) throw new ExpressError(400, 'Invalid listing identifier.');
    if (!await Listing.exists({ _id: req.params.id })) throw new ExpressError(404, 'Listing not found.');
    // This is a new collection. Ensure the unique pair index before concurrent upserts.
    await Favorite.init();
    const pair = { user: req.user._id, listing: req.params.id };
    try { await Favorite.updateOne(pair, { $setOnInsert: pair }, { upsert: true }); }
    catch (err) { if (err.code !== 11000) throw err; }
    // Cover a listing deleted while the save was in flight. Reads also join only live listings.
    if (!await Listing.exists({ _id: req.params.id })) {
        await Favorite.deleteOne(pair);
        throw new ExpressError(404, 'Listing not found.');
    }
    req.flash('success', 'Listing saved.');
    res.redirect(`/listings/${req.params.id}`);
};
module.exports.remove = async (req, res) => {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) throw new ExpressError(400, 'Invalid listing identifier.');
    await Favorite.deleteOne({ user: req.user._id, listing: req.params.id });
    req.flash('success', 'Listing removed from saved stays.');
    res.redirect('/saved');
};
module.exports.saved = async (req, res) => {
    const requested = pageNumber(req.query.page);
    const base = existingSaved(req.user._id);
    const count = await Favorite.aggregate([...base, { $count: 'total' }]).option({ maxTimeMS: 2000 });
    const pagination = pageInfo(count[0]?.total || 0, requested, '/saved');
    const rows = await Favorite.aggregate([...existingSaved(req.user._id, cardFields), { $sort: { _id: -1 } }, { $skip: pagination.skip }, { $limit: pagination.size }, { $replaceWith: '$stay' }]).option({ maxTimeMS: 2000 });
    await attachRatings(rows);
    res.render('account/listings', { allListings: rows, pagination, collectionMode: 'saved', heading: 'Saved listings', intro: 'Places worth keeping close for your next adventure.' });
};
module.exports.mine = async (req, res) => {
    const requested = pageNumber(req.query.page);
    const query = { owner: req.user._id };
    const total = await Listing.countDocuments(query).maxTimeMS(2000);
    const pagination = pageInfo(total, requested, '/my-listings');
    const allListings = await Listing.find(query).select('title image price location country').sort({ _id: -1 }).skip(pagination.skip).limit(pagination.size).lean().maxTimeMS(2000);
    await attachRatings(allListings);
    res.render('account/listings', { allListings, pagination, collectionMode: 'owned', heading: 'My listings', intro: 'A home for the spaces you share.' });
};
module.exports.profile = async (req, res) => {
    const [account, owned, saved] = await Promise.all([
        User.findById(req.user._id).select('username email -_id').lean(),
        Listing.countDocuments({ owner: req.user._id }).maxTimeMS(2000),
        Favorite.aggregate([...existingSaved(req.user._id), { $count: 'total' }]).option({ maxTimeMS: 2000 }),
    ]);
    if (!account) throw new ExpressError(404, 'Account not found.');
    res.render('account/profile', { account, owned, saved: saved[0]?.total || 0 });
};
