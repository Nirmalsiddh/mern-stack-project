const Joi = require("joi");
const { normalizeCategory } = require("./utils/categories.js");

module.exports.listingSchema = Joi.object({
    listing : Joi.object({
        title: Joi.string().required(),
        description: Joi.string().required(),
        location: Joi.string().required(),
        country: Joi.string().required(),
        price: Joi.number().required().min(0),
        image: Joi.string().allow("", null),
        filters: Joi.string().max(30).custom((value, helpers) => {
            const category = normalizeCategory(value);
            return category || helpers.error("any.invalid");
        }),
    }).required(),
});

module.exports.reviewSchema = Joi.object({
    review: Joi.object({
        rating: Joi.number().required().min(1).max(5),
        comment: Joi.string().required(),
    }).required(),
});
