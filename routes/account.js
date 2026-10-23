const router = require('express').Router();
const { isLoggedIn } = require('../middleware');
const { requireCsrf } = require('../utils/csrf');
const wrap = require('../utils/wrapAsync');
const controller = require('../controllers/account');
router.use(['/saved', '/my-listings', '/profile'], (req, res, next) => {
    // Login returns with GET; never store a POST-only favorite URL for replay.
    if (!req.isAuthenticated() && !['GET', 'HEAD'].includes(req.method)) {
        req.session.redirectUrl = '/saved';
        req.flash('error', 'you must be Logged in!');
        return res.redirect('/login');
    }
    return isLoggedIn(req, res, next);
});
router.get('/saved', wrap(controller.saved));
router.post('/saved/:id', requireCsrf, wrap(controller.save));
router.delete('/saved/:id', requireCsrf, wrap(controller.remove));
router.get('/my-listings', wrap(controller.mine));
router.get('/profile', wrap(controller.profile));
module.exports = router;
