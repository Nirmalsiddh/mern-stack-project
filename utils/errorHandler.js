module.exports = (err, req, res, next) => {
    if (res.headersSent) return next(err);
    let { statusCode = 500, message = "Something went wrong" } = err;
    if (err.name === "CastError") {
        statusCode = 400;
        message = "Invalid resource identifier.";
    } else if (err.name === "ValidationError") {
        statusCode = 400;
        message = "Please check the submitted information.";
    } else if (statusCode >= 500) {
        message = "Something went wrong. Please try again later.";
    }
    res.status(statusCode).render("error.ejs", { message });
};
