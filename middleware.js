const Listing = require("./models/listing.js");
const Review = require("./models/review.js");
const ExpressError = require("./utils/ExpressError.js");
const { listingSchema, reviewSchema } = require("./schema.js");
const mongoose = require("mongoose");
const wrapAsync = require("./utils/wrapAsync.js");

module.exports.loadListing = wrapAsync(async (req, res, next) => {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) {
        throw new ExpressError(400, "Invalid listing identifier.");
    }
    const listing = await Listing.findById(req.params.id);
    if (!listing) throw new ExpressError(404, "Listing not found.");
    res.locals.listing = listing;
    next();
});

module.exports.loadReview = wrapAsync(async (req, res, next) => {
    if (!mongoose.isObjectIdOrHexString(req.params.reviewId)) {
        throw new ExpressError(400, "Invalid review identifier.");
    }
    const review = await Review.findById(req.params.reviewId);
    const belongsToListing = res.locals.listing.reviews.some(id => id.equals(req.params.reviewId));
    if (!review || !belongsToListing) throw new ExpressError(404, "Review not found for this listing.");
    res.locals.review = review;
    next();
});

module.exports.isLoggedIn = (req, res, next) => {
    if(!req.isAuthenticated()){
        req.session.redirectUrl = req.originalUrl;
        req.flash("error", "you must be Logged in!");
        return res.redirect("/login");
    }
    next();
}

module.exports.saveRedirectUrl = (req, res, next) => {
    if(req.session.redirectUrl){
        res.locals.redirectUrl = req.session.redirectUrl;
    }
    next();
};

module.exports.isOwner = (req, res, next) => {
    const listing = res.locals.listing;
    if (!listing || !listing.owner || !req.user || !listing.owner.equals(req.user._id)) {
        return next(new ExpressError(403, "You are not the owner of this listing."));
    }
    next();
};

module.exports.validateListing = (req, res, next) => {
    let { error, value } = listingSchema.validate(req.body);
    if (error) {
        let errMSG = error.details.map((err) => err.message).join(",");
        throw new ExpressError(400, errMSG);
    } else {
        req.body = value;
        next();
    }
}

module.exports.validateReview = (req, res, next) => {
    let { error, value } = reviewSchema.validate(req.body);
    if(error){
        let errMSG = error.details.map((err) => err.message).join(",");
        throw new ExpressError(400, errMSG);
    }else{
        req.body = value;
        next();
    }
}

module.exports.isReviewAuthor = (req, res, next) => {
    const review = res.locals.review;
    if (!review || !review.author || !req.user || !review.author.equals(req.user._id)) {
        return next(new ExpressError(403, "You are not the author of this review."));
    }
    next();
};
