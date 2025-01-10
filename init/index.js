const mongoose = require("mongoose");
const initData = require("./data.js");
const Listing = require("../models/listing.js");

const MOONGOSE_URL = "mongodb://127.0.0.1:27017/wanderlust";

main().then(() => {
    console.log("connect to DB");
}).catch((err) => {
    console.log(err);
});

async function main() {
    await mongoose.connect(MOONGOSE_URL);
};

const initDB = async () => {
    await Listing.deleteMany({});
    initData.data = initData.data.map((obj) => ({ ...obj, owner: "6774498a71793fb3abeb1770" }));
    await Listing.insertMany(initData.data);
    console.log("data was initialised");
}
initDB();