const { createHash, randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');

// connect-mongo's supported serialization hooks keep encrypted session payloads
// independent of its optional cipher dependency. The signing secret is unchanged.
module.exports = secret => {
    const key = createHash('sha256').update('havenhub:session-encryption:' + secret).digest();
    const sessionObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    function decode(value, length) {
        if (typeof value !== 'string' || !value.length) throw new Error();
        const bytes = Buffer.from(value, 'base64');
        if (bytes.toString('base64') !== value || (length !== undefined && bytes.length !== length)) throw new Error();
        return bytes;
    }
    return {
        serialize(value) {
            if (!sessionObject(value)) throw new Error('Invalid session payload.');
            const json = JSON.stringify(value);
            if (!sessionObject(JSON.parse(json))) throw new Error('Invalid session payload.');
            const iv = randomBytes(12);
            const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
            const ciphertext = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
            return JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64') });
        },
        unserialize(encoded) {
            try {
                if (typeof encoded !== 'string') throw new Error();
                const envelope = JSON.parse(encoded);
                if (!sessionObject(envelope) || envelope.version !== 1 || Object.keys(envelope).length !== 4) throw new Error();
                const iv = decode(envelope.iv, 12);
                const tag = decode(envelope.tag, 16);
                const ciphertext = decode(envelope.data);
                const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
                decipher.setAuthTag(tag);
                const value = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
                if (!sessionObject(value)) throw new Error();
                return value;
            } catch { throw new Error('Invalid stored session.'); }
        },
    };
};
