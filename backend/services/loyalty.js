/** Loyalty tiers and redemption helpers (100 points = ₹100). */

function loyaltyTier(points) {
    const p = Number(points) || 0;
    if (p >= 1500) return 'Platinum';
    if (p >= 500) return 'Gold';
    return 'Silver';
}

/**
 * Validate redeem request. 100 pts = ₹100; must be multiple of 100.
 * @returns {{ redeemPoints: number, discountInr: number }}
 */
function validateRedemption(pointsBalance, redeemPoints, cartTotal) {
    let pts = Math.floor(Number(redeemPoints) || 0);
    if (pts <= 0) return { redeemPoints: 0, discountInr: 0 };
    if (pts % 100 !== 0) {
        const err = new Error('Redeem points must be in multiples of 100 (100 pts = ₹100)');
        err.status = 400;
        throw err;
    }
    const balance = Math.floor(Number(pointsBalance) || 0);
    if (pts > balance) {
        const err = new Error(`Insufficient loyalty points (have ${balance}, need ${pts})`);
        err.status = 400;
        throw err;
    }
    const maxByTotal = Math.floor(Number(cartTotal) / 100) * 100;
    if (pts > maxByTotal) pts = maxByTotal;
    return { redeemPoints: pts, discountInr: pts };
}

module.exports = { loyaltyTier, validateRedemption };
