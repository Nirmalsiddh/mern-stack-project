const Listing = require("../models/listing.js");

module.exports.index = async (req, res) => {
    const {filter} = req.query;
    // const allListings = await Listing.find({});
    let allListings;

    if (filter && filter !== "all") {
        allListings = await Listing.find({ filters: filter });
    } else {
        allListings = await Listing.find({});
    }
    res.render("listing/index.ejs", { allListings });
};
module.exports.search = async (req, res) => {
    const {country} = req.query;
    if(!country){
        return res.redirect("/listings");
    }
    const allListings = await Listing.find({country : new RegExp(country, "i")});
    res.render("listing/index.ejs", {allListings});
}

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
    const { id } = req.params;
    const listing = await Listing.findById(id).populate({path: "reviews", populate: {path: "author"}}).populate("owner");
    // console.log(listing);
    if (!listing) {
        req.flash("error", "Listing you requested for doesn't exist!");
        res.redirect("/listings");
    }
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
    const { id } = req.params;
    const listing = await Listing.findById(id);

    let originalImageUrl = listing.image.url;
    originalImageUrl = originalImageUrl.replace("/upload", "/upload/h_300,w_250");
    // console.log(originalImageUrl);
    req.flash("success", "Listing Edited!");
    res.render("listing/edit.ejs", { listing, originalImageUrl });
};

module.exports.updateListing = async (req, res) => {
    // if (!req.body.listing) {
    //     throw new ExpressError(400, "Send valid data for listing");
    // }
    let { id } = req.params;
    // let listing = await Listing.findById(id);
    // if(!(currUser && listing.owner._id.equals(res.locals.currUser._id))){
    //     req.flash("error", "You don't have permission to edit");
    //     return res.redirect(`/listings/${id}`);
    // }
    let listing = await Listing.findByIdAndUpdate(id, { ...req.body.listing });

    if(typeof req.file !== "undefined"){
        let url = req.file.path;
        let filename = req.file.filename;
        listing.image = { url, filename };
        await listing.save();
    }
    req.flash("success", "Listing Updated!");
    res.redirect(`/listings/${id}`);
};

module.exports.destroyListing = async (req, res) => {
    let { id } = req.params;
    let deletelistings = await Listing.findByIdAndDelete(id);
    // console.log(deletelistings);
    req.flash("success", "Listing Deleted!");
    res.redirect("/listings");
};