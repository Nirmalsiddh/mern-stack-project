const mongoose = require('mongoose');
const favoriteSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
});
favoriteSchema.index({ user: 1, listing: 1 }, { unique: true });
favoriteSchema.index({ user: 1, _id: -1 });
favoriteSchema.index({ listing: 1 });
module.exports = mongoose.model('Favorite', favoriteSchema);
