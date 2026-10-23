const Listing = require("../models/listing.js");

const ExpressError = require("../utils/ExpressError.js");
const { normalizeCategory } = require("../utils/categories.js");

module.exports.index = async (req, res) => {
    const rawFilter = req.query.filter;
    const filter = rawFilter === undefined ? "all" : normalizeCategory(rawFilter);
    if (!filter) throw new ExpressError(400, "Invalid listing category.");
    // Include legacy hyphenated records as well as the original spaced values.
    const query = filter === "all" ? {} : {
        filters: { $in: [...new Set([filter, filter.replace(/ /g, "-")])] },
    };
    const allListings = await Listing.find(query);
    res.render("listing/index.ejs", { allListings });
};

module.exports.search = async (req, res) => {
    const { country } = req.query;
    if (country === undefined) return res.redirect("/listings");
    if (typeof country !== "string" || country.length > 100) {
        throw new ExpressError(400, "Search must be text of at most 100 characters.");
    }
    const search = country.trim();
    if (!search) return res.redirect("/listings");
    const literal = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const allListings = await Listing.find({ country: new RegExp(literal, "i") }, null, { maxTimeMS: 2000 });
    res.render("listing/index.ejs", { allListings });
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
    await listing.populate({ path: "reviews", populate: { path: "author" } });
    await listing.populate("owner");
    res.render("listing/show.ejs", { listing });
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

    await newListing.save();
    req.flash("success", "New Listing Created!");
    res.redirect("/listings");
};

module.exports.renderEditForm = async (req, res) => {
    const listing = res.locals.listing;

    let originalImageUrl = listing.image.url;
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
