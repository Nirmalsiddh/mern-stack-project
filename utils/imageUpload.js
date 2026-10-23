const multer = require('multer');
const sharp = require('sharp');
const { cloudinary } = require('../cloudConfig');
const ExpressError = require('./ExpressError');
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const parseImage = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 10, parts: 11, fieldSize: 20000, fieldNameSize: 100 },
}).single('listing[image]');

async function verifiedImage(buffer) {
    try {
        const image = sharp(buffer, { limitInputPixels: 25000000, failOn: 'warning', animated: false });
        const { format } = await image.metadata();
        if (!['jpeg', 'png'].includes(format)) throw new Error('unsupported');
        // Decode and re-encode; extensions and client MIME types are not evidence.
        return await image.rotate().toFormat(format).toBuffer();
    } catch {
        throw new ExpressError(400, 'Upload a valid PNG or JPEG image (maximum 5 MB and 25 megapixels).');
    }
}
async function uploadImage(req, res, next) {
    try {
        if (!req.file) return next();
        if (!req.app.locals.config.uploadsEnabled) throw new ExpressError(503, 'Image uploads are currently unavailable.');
        const bytes = await verifiedImage(req.file.buffer);
        const result = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream({ folder: 'wanderlust_DEV', resource_type: 'image', timeout: 10000, allowed_formats: ['png', 'jpg', 'jpeg'] }, (err, result) => err ? reject(err) : resolve(result));
            stream.on('error', reject);
            stream.end(bytes);
        });
        if (!result?.secure_url?.startsWith('https://') || !result?.public_id?.startsWith('wanderlust_DEV/')) throw new Error('Invalid image storage response');
        req.file = { path: result.secure_url, filename: result.public_id };
        req.newImage = { ...req.file };
        next();
    } catch (err) {
        next(err instanceof ExpressError ? err : new ExpressError(502, 'Image storage is temporarily unavailable.'));
    }
}

// Never clean up an old image here. An ambiguous database failure might have
// committed the replacement. Only remove a new upload after proving no reference.
async function cleanupUnusedUpload(image, Listing, error) {
    if (!image?.filename || !image.filename.startsWith('wanderlust_DEV/')) return;
    if (!['ValidationError', 'DocumentNotFoundError'].includes(error?.name)) {
        console.error('Uncertain database outcome; uploaded image retained for reconciliation.');
        return;
    }
    try {
        const active = await Listing.exists({ 'image.filename': image.filename });
        if (!active) await cloudinary.uploader.destroy(image.filename, { resource_type: 'image' });
    } catch {
        console.error('Unable to confirm or clean up an unused new image; manual reconciliation may be needed.');
    }
}
module.exports = { parseImage, verifiedImage, uploadImage, cleanupUnusedUpload, MAX_IMAGE_BYTES };
