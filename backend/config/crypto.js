/**
 * App-level AES-256-GCM encryption for customer PII (phone, email) at rest.
 * Ciphertext format: enc:v1:<iv_b64>:<tag_b64>:<data_b64>
 */
const crypto = require('crypto');

const PREFIX = 'enc:v1:';

function deriveKey(secret) {
    // Stable 32-byte key from passphrase or hex
    if (/^[0-9a-fA-F]{64}$/.test(secret)) {
        return Buffer.from(secret, 'hex');
    }
    return crypto.createHash('sha256').update(secret).digest();
}

function getKey() {
    const secret = process.env.PII_ENCRYPTION_KEY;
    if (!secret) {
        throw new Error('PII_ENCRYPTION_KEY is not set');
    }
    return deriveKey(secret.trim());
}

function encrypt(plaintext) {
    if (plaintext == null || plaintext === '') return plaintext;
    const text = String(plaintext);
    if (text.startsWith(PREFIX)) return text; // already encrypted

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decrypt(ciphertext) {
    if (ciphertext == null || ciphertext === '') return ciphertext;
    const text = String(ciphertext);
    if (!text.startsWith(PREFIX)) return text; // legacy plaintext (pre-migration)

    const parts = text.slice(PREFIX.length).split(':');
    if (parts.length !== 3) {
        throw new Error('Invalid ciphertext format');
    }
    const [ivB64, tagB64, dataB64] = parts;
    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        getKey(),
        Buffer.from(ivB64, 'base64')
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(dataB64, 'base64')),
        decipher.final()
    ]);
    return decrypted.toString('utf8');
}

function isEncrypted(value) {
    return typeof value === 'string' && value.startsWith(PREFIX);
}

module.exports = { encrypt, decrypt, isEncrypted };
