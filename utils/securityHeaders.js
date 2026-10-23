const helmet = require('helmet');
module.exports = config => helmet({
    strictTransportSecurity: config.production ? undefined : false,
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
            scriptSrcAttr: ["'none'"],
            styleSrc: ["'self'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com'],
            // Existing listing templates use fixed inline layout styles, no user CSS.
            styleSrcAttr: ["'unsafe-inline'"],
            fontSrc: ["'self'", 'https://cdnjs.cloudflare.com', 'https://fonts.gstatic.com'],
            imgSrc: ["'self'", 'data:', 'https://res.cloudinary.com', 'https://images.unsplash.com'],
            connectSrc: ["'self'"], formAction: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"],
            upgradeInsecureRequests: config.production ? [] : null,
        },
    },
});
