const express = require("express");
const router = express.Router({ mergeParams: true });
const Listing = require("../models/listing.js");
const wrapAsync = require("../utils/wrapAsync.js");
const { isLoggedIn, isOwner, validateListing } = require("../middleware.js");
const listingController = require("../controllers/listing.js");
const multer = require("multer");
const { storage } = require("../cloudConfig.js");
const upload = multer({ storage });

router.route("/")
    //Index Route
    .get(wrapAsync(listingController.index))

    // Create Route
    .post( isLoggedIn, upload.single("listing[image]"), validateListing, wrapAsync(listingController.createListing));
    
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
    .put(upload.single("listing[image]"), validateListing, isLoggedIn, isOwner, wrapAsync(listingController.updateListing))
    // Delete Route
    .delete(isLoggedIn, isOwner, wrapAsync(listingController.destroyListing));


// Edit Route
router.get("/:id/edit", isLoggedIn, isOwner, wrapAsync(listingController.renderEditForm));

module.exports = router;