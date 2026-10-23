const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const Review = require("./review.js");
const { categoryValues } = require("../utils/categories.js");

let url =  "https://images.unsplash.com/photo-1625505826533-5c80aca7d157?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MTJ8fGdvYXxlbnwwfHwwfHx8MA%3D%3D&auto=format&fit=crop&w=800&q=60";
const listingSchema = new Schema({
    title: {
        type: String,
        required: true,
    },
    description: {
        type: String,
        max: [30, "please enter short description"],
    },
    image: {
        url: String,
        filename: String,
    },
    price: Number,
    location: String,
    country: String,
    reviews: [
        {
            type: Schema.Types.ObjectId,
            ref: "Review",
        }
    ],
    owner: {
        type: Schema.Types.ObjectId,
        ref: "User",
    },
    filters: {
        type: String,
        enum: categoryValues,
        default: "all",
    }
});
listingSchema.index({ price: 1, _id: 1 });
listingSchema.index({ filters: 1, _id: -1 });
listingSchema.index({ owner: 1, _id: -1 });
listingSchema.post("findOneAndDelete", async(listing) => {
    if(listing){
        await require('./favorite').deleteMany({ listing: listing._id });
        await Review.deleteMany({ _id: {$in : listing.reviews}});
    }
});

const Listing = mongoose.model("Listing", listingSchema);
module.exports = Listing;
