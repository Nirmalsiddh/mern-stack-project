// Keep the existing database values; accept old hyphenated links without a migration.
const categories = [
    { value: "all", label: "All", icon: "fa-solid fa-list" },
    { value: "trending", label: "Trending", icon: "fa-solid fa-fire" },
    { value: "rooms", label: "Rooms", icon: "fa-solid fa-bed" },
    { value: "iconic cities", label: "Iconic cities", icon: "fa-solid fa-city" },
    { value: "mountains", label: "Mountains", icon: "fa-solid fa-mountain" },
    { value: "castles", label: "Castles", icon: "fa-solid fa-chess-rook" },
    { value: "amazing pools", label: "Amazing Pools", icon: "fa-solid fa-person-swimming" },
    { value: "camping", label: "Camping", icon: "fa-solid fa-campground" },
    { value: "farms", label: "Farms", icon: "fa-solid fa-tractor" },
    { value: "arctic", label: "Arctic", icon: "fa-solid fa-snowflake" },
    { value: "domes", label: "Domes", icon: "fa-solid fa-igloo" },
    { value: "boats", label: "Boats", icon: "fa-solid fa-sailboat" },
];
const categoryValues = categories.map(category => category.value);

function normalizeCategory(value) {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase().replace(/-/g, " ");
    return categoryValues.includes(normalized) ? normalized : null;
}

module.exports = { categories, categoryValues, normalizeCategory };
