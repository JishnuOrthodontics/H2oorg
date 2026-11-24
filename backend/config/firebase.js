/**
 * Firebase Admin SDK — verifies Google ID tokens from Staff POS login.
 * Optional until FIREBASE_* env vars are set (login returns 503 until then).
 */
const admin = require('firebase-admin');

let initialized = false;

function isFirebaseConfigured() {
    return Boolean(
        process.env.FIREBASE_PROJECT_ID &&
        process.env.FIREBASE_CLIENT_EMAIL &&
        process.env.FIREBASE_PRIVATE_KEY &&
        String(process.env.FIREBASE_PRIVATE_KEY).includes('BEGIN PRIVATE KEY')
    );
}

function initFirebaseAdmin() {
    if (initialized) return admin;
    if (!isFirebaseConfigured()) return null;

    const privateKey = String(process.env.FIREBASE_PRIVATE_KEY).replace(/\\n/g, '\n');

    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID.trim(),
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL.trim(),
            privateKey
        })
    });
    initialized = true;
    return admin;
}

async function verifyIdToken(idToken) {
    const app = initFirebaseAdmin();
    if (!app) {
        const err = new Error('Firebase Admin is not configured');
        err.status = 503;
        throw err;
    }
    return app.auth().verifyIdToken(idToken);
}

module.exports = {
    isFirebaseConfigured,
    initFirebaseAdmin,
    verifyIdToken
};
