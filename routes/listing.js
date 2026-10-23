const express = require("express");
const router = express.Router({ mergeParams: true });
const Listing = require("../models/listing.js");
const wrapAsync = require("../utils/wrapAsync.js");
const { isLoggedIn, isOwner, validateListing, loadListing } = require("../middleware.js");
const listingController = require("../controllers/listing.js");
const { parseImage, uploadImage } = require("../utils/imageUpload");
const { requireCsrf } = require("../utils/csrf");
router.param("id", loadListing);

router.route("/")
    //Index Route
    .get(wrapAsync(listingController.index))

    // Create Route
    .post( isLoggedIn, parseImage, requireCsrf, validateListing, uploadImage, wrapAsync(listingController.createListing));
    
    // .post(upload.single("listing[image]"), (req, res) => {
    //     res.send(req.file);
    // })

// New Route
router.get("/new", isLoggedIn, wrapAsync(listingController.renderNewForm));
router.get("/search", wrapAsync(listingController.search));

router.route("/:id")
    //show Route
    .get(wrapAsync(listingController.showListing))
    // Update Route
    .put(isLoggedIn, isOwner, parseImage, requireCsrf, validateListing, uploadImage, wrapAsync(listingController.updateListing))
    // Delete Route
    .delete(isLoggedIn, isOwner, requireCsrf, wrapAsync(listingController.destroyListing));


// Edit Route
router.get("/:id/edit", isLoggedIn, isOwner, wrapAsync(listingController.renderEditForm));

module.exports = router;
