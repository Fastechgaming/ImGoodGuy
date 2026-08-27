// Confirmation page shown right after a receipt is submitted.
(async function loadSuccess() {
  const orderId = new URLSearchParams(location.search).get("order");
  const receipt = document.getElementById("order-receipt");
  const supportLine = document.getElementById("support-line");

  try {
    const cfg = await getSiteConfig();
    if (cfg.supportTelegram) {
      supportLine.innerHTML = `Haven't received your items after an hour?
        <a href="https://t.me/${encodeURIComponent(cfg.supportTelegram)}" target="_blank" rel="noopener">Contact support on Telegram</a>.`;
    }
  } catch {
    /* keep the plain support sentence */
  }

  if (!orderId) {
    receipt.remove();
    return;
  }

  try {
    const order = await fetchJSON(`/api/order/${encodeURIComponent(orderId)}`);
    receipt.innerHTML = `
      <div><span>Item</span><strong>${escapeHtml(order.itemName)}</strong></div>
      <div><span>In server name</span><strong>${escapeHtml(order.playerName)}</strong></div>
      <div><span>Amount</span><strong>$${Number(order.amount).toFixed(2)} ${escapeHtml(order.currency)}</strong></div>
      <div><span>Order ID</span><strong>${escapeHtml(order.id)}</strong></div>
    `;
  } catch {
    receipt.remove();
  }
})();
