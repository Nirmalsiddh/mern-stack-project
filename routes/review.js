const express = require("express");
const router = express.Router({mergeParams: true});
// const Listing = require("../models/listing.js");
const wrapAsync = require("../utils/wrapAsync.js");
const Review = require("../models/review.js");
const { validateReview, isLoggedIn, isReviewAuthor, loadListing, loadReview } = require("../middleware.js");
const { requireCsrf } = require("../utils/csrf");
const reviewController = require("../controllers/reviews.js");
// The parent id is inherited via mergeParams, so validate it on this router too.
router.use(loadListing);
router.param("reviewId", loadReview);

// Post Review Route
router.post("/", isLoggedIn, requireCsrf, validateReview, wrapAsync(reviewController.createReview));
// Delete Review Route
router.delete("/:reviewId", isLoggedIn, isReviewAuthor, requireCsrf, wrapAsync(reviewController.destroyReview));

module.exports = router;
