/**
 * Public Firebase web config (safe to expose in the browser).
 * Project: h2o-pos
 * Authorized domains must include: localhost, h2oorg.com, www.h2oorg.com
 */
window.H2O_FIREBASE_CONFIG = {
    apiKey: "AIzaSyCeRRu9OOW56bGUJZtErlUOC_7FcXJqHqs",
    authDomain: "h2o-pos.firebaseapp.com",
    projectId: "h2o-pos",
    storageBucket: "h2o-pos.firebasestorage.app",
    messagingSenderId: "1041741156388",
    appId: "1:1041741156388:web:7780800f934366029e08b1",
    measurementId: "G-HB70WB7102"
};

window.H2O_FIREBASE_READY = Boolean(
    window.H2O_FIREBASE_CONFIG &&
    window.H2O_FIREBASE_CONFIG.apiKey &&
    window.H2O_FIREBASE_CONFIG.projectId
);

if (window.H2O_FIREBASE_READY && typeof firebase !== 'undefined') {
    try {
        if (!firebase.apps.length) {
            firebase.initializeApp(window.H2O_FIREBASE_CONFIG);
        }
    } catch (err) {
        console.error('Firebase init failed:', err);
        window.H2O_FIREBASE_READY = false;
    }
}
