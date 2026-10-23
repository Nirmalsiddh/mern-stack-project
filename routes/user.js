const express = require("express");
const router = express.Router();
const wrapAsync = require("../utils/wrapAsync");
const passport = require("passport");
const { saveRedirectUrl } = require("../middleware");
const { requireCsrf } = require("../utils/csrf");
const { signupSchema, loginSchema } = require("../schema");
const ExpressError = require("../utils/ExpressError");
const userController = require("../controllers/users");
const limit = purpose => (req, res, next) => req.app.locals.authLimiters[purpose](req, res, next);
const validate = schema => (req, res, next) => {
    const { error, value } = schema.validate(req.body);
    if (error) return next(new ExpressError(400, "Please check the account fields and their lengths."));
    req.body = value;
    next();
};
router.route("/signup")
    .get(userController.renderSignUpForm)
    .post(requireCsrf, limit('signup'), validate(signupSchema), wrapAsync(userController.signUp));
router.route("/login")
    .get(userController.renderLoginForm)
    .post(requireCsrf, limit('login'), validate(loginSchema), saveRedirectUrl,
        passport.authenticate("local", { failureRedirect: '/login', failureFlash: 'Invalid username or password.' }), userController.login);
router.post("/logout", requireCsrf, userController.logout);
router.get("/logout", (req, res) => res.status(405).set('Allow', 'POST').send('Use the logout form.'));
module.exports = router;
