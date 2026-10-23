if (process.env.NODE_ENV !== 'production') require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('node:path');
const methodOverride = require('method-override');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const passport = require('passport');
const LocalStrategy = require('passport-local');
const User = require('./models/user');
const { readConfig, sessionOptions } = require('./config/environment');
const { categories, normalizeCategory } = require('./utils/categories');
const { addCsrfToken } = require('./utils/csrf');
const { createAuthLimiters } = require('./utils/authRateLimit');
const ExpressError = require('./utils/ExpressError');

// Driver cancellation/CSOT bounds actual work. The response deadline also covers
// adapters that ignore cancellation; retain that operation until it settles so
// repeated probes cannot spawn an unbounded number of background commands.
function createReadinessCheck(connection, timeoutMs = 1000) {
    let inFlight;
    return () => {
        if (connection.readyState !== 1) return Promise.resolve(false);
        if (inFlight) return inFlight.result;
        const entry = {};
        inFlight = entry;
        const controller = new AbortController();
        let timer;
        const outcome = Promise.resolve().then(() => connection.db.command(
            { ping: 1, maxTimeMS: timeoutMs }, { timeoutMS: timeoutMs, signal: controller.signal },
        )).then(() => true, () => false);
        entry.result = Promise.race([
            outcome,
            new Promise(resolve => { timer = setTimeout(() => { resolve(false); controller.abort(); }, timeoutMs); }),
        ]).finally(() => clearTimeout(timer));
        outcome.then(() => { if (inFlight === entry) inFlight = undefined; });
        return entry.result;
    };
}

function createApp({ config, store, connection = mongoose.connection, authLimiters, authenticate }) {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', config.trustProxy);
    app.locals.config = { production: config.production, uploadsEnabled: config.uploadsEnabled };
    Object.assign(app.locals, { success: [], error: [], currUser: null, csrfToken: '', categories, normalizeCategory });
    app.locals.shuttingDown = false;
    app.locals.authLimiters = authLimiters || createAuthLimiters(connection.db.collection('auth_rate_limits'), config);
    app.use(require('./utils/securityHeaders')(config));
    app.use('/health', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    app.get('/health/live', (req, res) => res.json({ status: 'ok' }));
    const ready = createReadinessCheck(connection);
    app.get('/health/ready', async (req, res) => {
        const available = !app.locals.shuttingDown && await ready();
        if (available && !app.locals.shuttingDown) res.json({ status: 'ready' });
        else res.status(503).json({ status: 'unavailable' });
    });
    app.set('views', path.join(__dirname, 'views'));
    app.set('view engine', 'ejs');
    app.engine('ejs', require('ejs-mate'));
    app.use(express.static(path.join(__dirname, 'public')));
    app.use(express.urlencoded({ extended: true, limit: '32kb', parameterLimit: 30, depth: 3 }));
    app.use(methodOverride('_method'));
    app.use(session(sessionOptions(config, store)));
    app.use(require('connect-flash')());
    app.use(passport.initialize());
    app.use(passport.session());
    let authentication = authenticate ? Promise.resolve(authenticate) : undefined;
    passport.use(new LocalStrategy((username, password, done) => {
        authentication ||= require('./utils/authenticate').createAuthenticate(User);
        authentication.then(verify => verify(username, password, done), done);
    }));
    passport.serializeUser(User.serializeUser());
    passport.deserializeUser(User.deserializeUser());
    app.use((req, res, next) => {
        res.locals.success = req.flash('success');
        res.locals.error = req.flash('error');
        res.locals.currUser = req.user;
        res.locals.categories = categories;
        res.locals.normalizeCategory = normalizeCategory;
        next();
    });
    app.use(addCsrfToken);
    app.use('/listings', require('./routes/listing'));
    app.use('/listings/:id/reviews', require('./routes/review'));
    app.use('/', require('./routes/user'));
    app.get('/', (req, res) => res.redirect('/listings'));
    app.all('*', (req, res, next) => next(new ExpressError(404, 'Page not found')));
    app.use(require('./utils/errorHandler'));
    return app;
}

async function start({ config = readConfig(), installSignals = true } = {}) {
    let store;
    try {
        await mongoose.connect(config.mongoUrl, { serverSelectionTimeoutMS: config.dbTimeoutMs, connectTimeoutMS: config.dbTimeoutMs });
        await mongoose.connection.db.collection('auth_rate_limits').createIndex({ expires: 1 }, { expireAfterSeconds: 0 });
        store = MongoStore.create({
            client: mongoose.connection.getClient(),
            ...require('./utils/sessionTransforms')(config.secret), ttl: Math.ceil(config.sessionMaxAge / 1000),
            touchAfter: 300,
        });
        store.on('error', require('./utils/sessionStoreError'));
        // Public in connect-mongo 5's type declarations; includes native TTL
        // index creation. The error event does not handle rejection here.
        await store.collectionP;
        const authenticate = await require('./utils/authenticate').createAuthenticate(User);
        const app = createApp({ config, store, authenticate });
        const server = await new Promise((resolve, reject) => {
            const listener = app.listen(config.port, () => resolve(listener));
            listener.once('error', reject);
        });
        console.log('connect to DB');
        console.log(`app is listening at ${server.address().port}.`);
        let stopping;
        async function shutdown() {
            if (stopping) return stopping;
            app.locals.shuttingDown = true;
            stopping = (async () => {
                let deadline;
                try {
                    await Promise.race([
                        (async () => {
                            await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
                            await store.close();
                            await mongoose.disconnect();
                        })(),
                        new Promise((resolve, reject) => { deadline = setTimeout(() => { server.closeAllConnections(); reject(new Error('Shutdown deadline exceeded.')); }, config.shutdownTimeoutMs); }),
                    ]);
                } finally { clearTimeout(deadline); }
            })();
            return stopping;
        }
        if (installSignals) {
            const onSignal = () => shutdown().then(() => process.exit(0), () => process.exit(1));
            process.once('SIGTERM', onSignal);
            process.once('SIGINT', onSignal);
        }
        return { app, server, shutdown };
    } catch (err) {
        try { if (store) await store.close(); } catch { /* Still disconnect below. */ }
        try { await mongoose.disconnect(); } catch { /* Preserve the startup error. */ }
        throw err;
    }
}
if (require.main === module) {
    let config;
    try { config = readConfig(); }
    catch (err) { console.error(`Configuration error: ${err.message}`); process.exitCode = 1; }
    if (config) start({ config }).catch(() => {
        console.error('Application startup failed. Check MongoDB connectivity and configured port.');
        process.exitCode = 1;
    });
}
module.exports = { createApp, start, createReadinessCheck };
