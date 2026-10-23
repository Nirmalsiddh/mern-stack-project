module.exports = (err, req, res, next) => {
    if (res.headersSent) return next(err);
    let { statusCode = 500, message = "Something went wrong" } = err;
    if (err.code === 'EBADCSRFTOKEN') {
        statusCode = 403;
        message = 'This form expired or could not be verified. Reload the page and try again.';
    } else if (err.name === 'MulterError') {
        statusCode = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        message = err.code === 'LIMIT_FILE_SIZE' ? 'Image exceeds the 5 MB upload limit.' : 'Invalid multipart upload.';
    } else if (err.name === "CastError") {
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
