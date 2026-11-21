/**
 * Backend API base URL (must end with /api).
 * Local → localhost. Production → Render free web service (Cloudflare site).
 * After first Render deploy, replace the production URL if the subdomain differs.
 */
window.H2O_API_BASE_URL = (typeof location !== 'undefined' && location.hostname === 'localhost')
    ? 'http://localhost:5000/api'
    : 'https://h2o-pos-api.onrender.com/api';
