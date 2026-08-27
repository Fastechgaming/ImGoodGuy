// Confirmation page shown right after a receipt is submitted.
let successOrder = null;
let supportHandle = "";

async function loadSuccess() {
  const orderId = new URLSearchParams(location.search).get("order");

  try {
    const cfg = await getSiteConfig();
    supportHandle = cfg.supportTelegram || "";
  } catch {
    /* keep the plain support sentence */
  }

  if (orderId) {
    try {
      successOrder = await fetchJSON(`/api/order/${encodeURIComponent(orderId)}`);
    } catch {
      successOrder = null;
    }
  }
  render();
}

function render() {
  const receipt = document.getElementById("order-receipt");
  const supportLine = document.getElementById("support-line");

  if (supportHandle && supportLine) {
    supportLine.removeAttribute("data-i18n"); // it carries a link now
    supportLine.innerHTML = `${escapeHtml(t("success.supportLineLink"))}
      <a href="https://t.me/${encodeURIComponent(supportHandle)}" target="_blank" rel="noopener">${escapeHtml(
      t("checkout.contactSupport")
    )}</a>.`;
  }

  if (!receipt) return;
  if (!successOrder) {
    receipt.hidden = true;
    return;
  }
  receipt.hidden = false;
  receipt.innerHTML = `
    <div><span>${escapeHtml(t("success.item"))}</span><strong>${escapeHtml(successOrder.itemName)}</strong></div>
    <div><span>${escapeHtml(t("checkout.inServerName"))}</span><strong>${escapeHtml(successOrder.playerName)}</strong></div>
    <div><span>${escapeHtml(t("success.amount"))}</span><strong>${escapeHtml(formatPrice(successOrder.amount))}</strong></div>
    <div><span>${escapeHtml(t("success.orderId"))}</span><strong>${escapeHtml(successOrder.id)}</strong></div>
  `;
}

document.addEventListener("i18n:change", render);
loadSuccess();
