const Listing = require('../models/listing');
// Both cards and details use raw BSON values, before Mongoose can cast legacy data.
async function attachRatings(listings, { includeReviewRatings = false } = {}) {
    if (!listings.length) return;
    const rows = await Listing.aggregate([
        { $match: { _id: { $in: listings.map(listing => listing._id) } } },
        { $lookup: { from: 'reviews', localField: 'reviews', foreignField: '_id', pipeline: [
            { $match: { $expr: { $and: [
                { $isNumber: '$rating' }, { $gte: ['$rating', 1] }, { $lte: ['$rating', 5] },
            ] } } },
            { $group: { _id: null, average: { $avg: { $toDouble: '$rating' } }, count: { $sum: 1 },
                ...(includeReviewRatings ? { ratings: { $push: { _id: '$_id', rating: { $toDouble: '$rating' } } } } : {}),
            } },
        ], as: 'summary' } },
        { $project: { summary: { $arrayElemAt: ['$summary', 0] } } },
    ]).option({ maxTimeMS: 2000 });
    const summaries = new Map(rows.map(row => [String(row._id), row.summary]));
    for (const listing of listings) {
        const summary = summaries.get(String(listing._id));
        listing.ratingSummary = { count: summary?.count || 0, average: summary?.average ?? null };
        if (includeReviewRatings) {
            const ratings = new Map((summary?.ratings || []).map(review => [String(review._id), review.rating]));
            for (const review of listing.reviews || []) review.rating = ratings.get(String(review._id)) ?? null;
        }
    }
}
module.exports = { attachRatings };
