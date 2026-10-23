const net = require('node:net');

function readConfig(env = process.env) {
    const mode = env.NODE_ENV || 'development';
    if (!['development', 'test', 'production'].includes(mode)) throw new Error('NODE_ENV must be development, test, or production.');
    const production = mode === 'production';
    if (!/^mongodb(?:\+srv)?:\/\//.test(env.ATLASDB_URL || '')) throw new Error('ATLASDB_URL must be a MongoDB connection URI.');
    if (typeof env.SECRET !== 'string' || env.SECRET.length < 32 || new Set(env.SECRET).size < 8) throw new Error('SECRET must be a strong random session secret of at least 32 characters.');
    function integer(name, fallback, min, max) {
        const text = env[name] === undefined ? String(fallback) : env[name];
        if (!/^\d+$/.test(text) || Number(text) < min || Number(text) > max) throw new Error(`${name} is outside its supported integer range.`);
        return Number(text);
    }
    const cloud = [env.CLOUD_NAME, env.CLOUD_API_KEY, env.CLOUD_API_SECRET];
    if (cloud.some(Boolean) && !cloud.every(Boolean)) throw new Error('Supply all three CLOUD_* settings or none.');
    if (env.UPLOADS_ENABLED !== undefined && !['true', 'false'].includes(env.UPLOADS_ENABLED)) throw new Error('UPLOADS_ENABLED must be true or false.');
    const uploadsEnabled = env.UPLOADS_ENABLED === 'true' || (env.UPLOADS_ENABLED !== 'false' && cloud.every(Boolean));
    if (production && env.UPLOADS_ENABLED !== 'false' && !cloud.every(Boolean)) throw new Error('Production image uploads require CLOUD_NAME, CLOUD_API_KEY, and CLOUD_API_SECRET; explicitly disable uploads to run without them.');
    if (uploadsEnabled && !cloud.every(Boolean)) throw new Error('Enabled image uploads require all CLOUD_* settings.');
    const trustProxy = env.TRUST_PROXY ? env.TRUST_PROXY.split(',').map(value => value.trim()) : false;
    if (trustProxy && trustProxy.some(value => {
        const [address, bits, extra] = value.split('/');
        const family = net.isIP(address);
        return !family || extra !== undefined || (bits !== undefined && (!/^\d+$/.test(bits) || Number(bits) === 0 || Number(bits) > (family === 4 ? 32 : 128)));
    })) throw new Error('TRUST_PROXY must list explicit trusted proxy IP addresses or CIDRs, never a hop count or blanket trust.');
    return {
        mode, production, mongoUrl: env.ATLASDB_URL, secret: env.SECRET, uploadsEnabled, trustProxy,
        port: integer('PORT', 8080, 1, 65535),
        sessionMaxAge: integer('SESSION_MAX_AGE_MS', 604800000, 60000, 604800000),
        authWindowMs: integer('AUTH_WINDOW_MS', 900000, 1000, 3600000),
        loginLimit: integer('LOGIN_LIMIT', 10, 1, 100),
        signupLimit: integer('SIGNUP_LIMIT', 5, 1, 100),
        dbTimeoutMs: integer('DB_TIMEOUT_MS', 5000, 100, 30000),
        shutdownTimeoutMs: integer('SHUTDOWN_TIMEOUT_MS', 10000, 100, 30000),
    };
}

function sessionOptions(config, store) {
    if (!store) throw new Error('An explicit session store is required.');
    return {
        name: 'havenhub.sid', store, secret: config.secret, resave: false, saveUninitialized: false,
        cookie: { httpOnly: true, secure: config.production, sameSite: 'lax', maxAge: config.sessionMaxAge, path: '/' },
    };
}
module.exports = { readConfig, sessionOptions };
