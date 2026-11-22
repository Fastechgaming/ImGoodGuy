// Apply the festival sale once, after calculating the normal item or upgrade price.
function discountPercent() {
  const value = Number(process.env.FESTIVAL_DISCOUNT_PERCENT ?? 20);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 20;
}

function salePrice(amount, percent = discountPercent()) {
  const cents = Math.round(Number(amount) * 100);
  return Math.round(cents * (100 - percent) / 100) / 100;
}

module.exports = { discountPercent, salePrice };
