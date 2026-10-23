const User = require("../models/user.js");

module.exports.renderSignUpForm = (req, res) => {
    res.render("users/signup.ejs");
};

module.exports.signUp = async(req, res, next) => {
    try{
        const { username, email, password } = req.body;
        const newUser = new User({ email, username });
        const registeredUser = await User.register(newUser, password);
        // console.log(registeredUser);
        req.login(registeredUser, (err) => {
            if(err){
                return next(err);
            }
            req.flash("success", `Welcome to HavenHub`);
            res.redirect("/listings");
        });
    }catch(e){
        req.flash("error", "Unable to create an account with those details.");
        res.redirect("/signup");
    }
};

module.exports.renderLoginForm = (req, res) => {
    res.render("users/login.ejs");
};

module.exports.login = async (req, res) => {
    // res.send("Welocome to the wanderlust, you are logged in!");
    req.flash("success", "Welcome back to HavenHub");
    let redirectUrl = require("../utils/safeRedirect")(res.locals.redirectUrl);
    res.redirect(redirectUrl);
};

module.exports.logout = async(req, res, next) => {
    req.logout((err) => {
        if(err){
            return next(err);
        }
        req.session.destroy(err => {
            if (err) return next(err);
            res.clearCookie('havenhub.sid', { path: '/', httpOnly: true, sameSite: 'lax', secure: req.app.locals.config.production });
            res.redirect('/listings');
        });
    });
};
