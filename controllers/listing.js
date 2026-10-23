const Listing = require("../models/listing.js");

const ExpressError = require("../utils/ExpressError.js");
const { cleanupUnusedUpload } = require("../utils/imageUpload");
const { normalizeCategory } = require("../utils/categories.js");

const { discovery, sortOptions } = require('../utils/discovery');
const { pageInfo } = require('../utils/pagination');
const { attachRatings } = require('../utils/ratings');
async function renderDiscovery(req, res) {
    const state = discovery(req.query);
    const total = await Listing.countDocuments(state.filter).maxTimeMS(2000);
    const pagination = pageInfo(total, state.page, '/listings', state.params, state.size);
    const allListings = await Listing.find(state.filter, 'title image price location country', {
        maxTimeMS: 2000, sort: state.order, skip: pagination.skip, limit: pagination.size,
    });
    await attachRatings(allListings);
    const categoryUrl = category => {
        const params = { filter: category, ...state.params }; params.filter = category;
        return '/listings?' + new URLSearchParams(params).toString().replace(/\+/g, '%20');
    };
    res.render('listing/index.ejs', { allListings, pagination, activeCategory: state.category, searchTerm: state.country, sort: state.sort, sortOptions, categoryUrl, pageSize: state.size });
}
module.exports.index = renderDiscovery;
module.exports.search = async (req, res) => {
    // Retain the established empty-country redirect, validating structure first.
    const state = discovery(req.query);
    if (!state.country) return res.redirect('/listings');
    return renderDiscovery(req, res);
};

module.exports.renderNewForm = async (req, res) => {
    // req.flash("success", "New Listing Created!");
    // console.log(req.user);
    // if(!req.isAuthenticated()){
    //     req.flash("error", "you must be authenticate to create listing!");
    //     return res.redirect("/login");
    // }
    res.render("listing/new.ejs");
};

module.exports.showListing = async (req, res) => {
    const listing = res.locals.listing;
    // Keep malformed legacy values out of Mongoose's Number casting; the shared
    // aggregation supplies both the summary and validated individual star values.
    await listing.populate({ path: "reviews", options: { lean: true }, populate: { path: "author" } });
    await listing.populate("owner");
    await attachRatings([listing], { includeReviewRatings: true });
    const isSaved = req.user ? Boolean(await require('../models/favorite').exists({ user: req.user._id, listing: listing._id })) : false;
    res.render("listing/show.ejs", { listing, isSaved });
};

module.exports.createListing = async (req, res, next) => {
    // let url = req.file.path;
    // let filename = req.file.filename
    let ur =  "https://images.unsplash.com/photo-1625505826533-5c80aca7d157?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MTJ8fGdvYXxlbnwwfHwwfHx8MA%3D%3D&auto=format&fit=crop&w=800&q=60";
    let url = req.file ? req.file.path : ur;
    let filename = req.file ? req.file.filename : "default.jpg";

    // console.log(url, " .. ", filename);
    // console.log(req.file);
    let listing = req.body.listing;
    const newListing = new Listing(listing);
    newListing.owner = req.user._id;
    newListing.image = {url, filename}

    try {
        await newListing.save();
    } catch (err) {
        await cleanupUnusedUpload(req.newImage, Listing, err);
        throw err;
    }
    req.flash("success", "New Listing Created!");
    res.redirect("/listings");
};

module.exports.renderEditForm = async (req, res) => {
    const listing = res.locals.listing;

    let originalImageUrl = listing.image?.url || '/images/stay-placeholder.svg';
    originalImageUrl = originalImageUrl.replace("/upload", "/upload/h_300,w_250");
    // console.log(originalImageUrl);
    res.render("listing/edit.ejs", { listing, originalImageUrl });
};

module.exports.updateListing = async (req, res) => {
    const { id } = req.params;
    const listing = res.locals.listing; // Loaded and ownership-checked before upload.
    if (!listing) throw new ExpressError(404, "Listing not found.");

    const updates = { ...req.body.listing };
    // Only a processed upload may replace the stored image object.
    delete updates.image;
    listing.set(updates);

    // Preserve an explicit selection, otherwise normalize the existing value.
    // Unknown historical values remain invalid rather than being silently lost.
    const category = normalizeCategory(listing.filters);
    if (category) listing.filters = category;
    else if (listing.filters == null) listing.filters = "all";

    if (req.file) {
        listing.image = { url: req.file.path, filename: req.file.filename };
    }
    // Mongoose validates the complete document before issuing one database write.
    try {
        await listing.save();
    } catch (err) {
        await cleanupUnusedUpload(req.newImage, Listing, err);
        if (err.name === "DocumentNotFoundError") {
            throw new ExpressError(404, "Listing not found.");
        }
        throw err;
    }
    req.flash("success", "Listing Updated!");
    res.redirect(`/listings/${id}`);
};

module.exports.destroyListing = async (req, res) => {
    let { id } = req.params;
    let deletelistings = await Listing.findByIdAndDelete(id);
    if (!deletelistings) throw new ExpressError(404, "Listing not found.");
    req.flash("success", "Listing Deleted!");
    res.redirect("/listings");
};
