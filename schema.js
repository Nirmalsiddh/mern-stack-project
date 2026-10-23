const Joi = require("joi");
const { normalizeCategory } = require("./utils/categories.js");

module.exports.listingSchema = Joi.object({
    listing : Joi.object({
        title: Joi.string().trim().max(120).required(),
        description: Joi.string().trim().max(5000).required(),
        location: Joi.string().trim().max(120).required(),
        country: Joi.string().trim().max(80).required(),
        price: Joi.number().required().min(0).max(10000000),
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
        comment: Joi.string().trim().max(2000).required(),
    }).required(),
});

const username = Joi.string().pattern(/^[A-Za-z0-9_]{3,32}$/).required();
module.exports.signupSchema = Joi.object({
    username, email: Joi.string().trim().lowercase().email({ tlds: { allow: false } }).max(254).required(),
    password: Joi.string().min(12).max(128).required(),
});
module.exports.loginSchema = Joi.object({ username: Joi.string().max(128).required(), password: Joi.string().min(1).max(128).required() });
