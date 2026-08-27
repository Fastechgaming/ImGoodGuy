let allItems = { ranks: [], coins: [], other: [] };
let activeCategory = "ranks";
let supportTelegram = "";

const CATEGORY_LABELS = { ranks: "Ranks", coins: "Coins", other: "Other" };

async function initStore() {
  const cfg = await getSiteConfig();
  supportTelegram = cfg.supportTelegram || "";

  allItems = await fetchJSON("/api/items");
  renderTabs();
  renderGrid();
}

function renderTabs() {
  const wrap = document.getElementById("store-tabs");
  wrap.innerHTML = "";
  Object.keys(CATEGORY_LABELS).forEach((cat) => {
    const btn = document.createElement("button");
    btn.textContent = CATEGORY_LABELS[cat];
    btn.className = cat === activeCategory ? "active" : "";
    btn.addEventListener("click", () => {
      activeCategory = cat;
      renderTabs();
      renderGrid();
    });
    wrap.appendChild(btn);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function renderGrid() {
  const grid = document.getElementById("item-grid");
  const items = allItems[activeCategory] || [];
  if (!items.length) {
    grid.innerHTML = '<p class="empty-note">No items here yet — check back soon!</p>';
    return;
  }
  grid.innerHTML = items
    .map(
      (item) => `
    <div class="item-card">
      <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" onerror="this.style.opacity=0.2" />
      <div class="item-body">
        <h3>${escapeHtml(item.name)}</h3>
        <p>${escapeHtml(item.shortDesc)}</p>
        <div class="price">$${Number(item.price).toFixed(2)}</div>
        <div class="item-actions">
          <button class="buy-btn" data-buy="${item.id}">Buy Now</button>
          <button class="info-btn" data-info="${item.id}" title="Item info & kit video">!</button>
        </div>
      </div>
    </div>`
    )
    .join("");

  grid.querySelectorAll("[data-buy]").forEach((btn) =>
    btn.addEventListener("click", () => openBuyModal(findItem(btn.dataset.buy)))
  );
  grid.querySelectorAll("[data-info]").forEach((btn) =>
    btn.addEventListener("click", () => openInfoModal(findItem(btn.dataset.info)))
  );
}

function findItem(id) {
  for (const cat of Object.keys(allItems)) {
    const found = allItems[cat].find((i) => i.id === id);
    if (found) return found;
  }
  return null;
}

/* ---------------- Info modal ---------------- */
function toEmbedUrl(url) {
  if (!url) return "";
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/watch\?v=)([\w-]+)/);
  if (m) return `https://www.youtube.com/embed/${m[1]}`;
  return url;
}

function openInfoModal(item) {
  if (!item) return;
  const overlay = document.getElementById("info-modal");
  const embed = toEmbedUrl(item.videoUrl);
  document.getElementById("info-modal-body").innerHTML = `
    ${embed ? `<iframe class="video-embed" src="${escapeHtml(embed)}" allowfullscreen></iframe>` : ""}
    <h3>${escapeHtml(item.name)}</h3>
    <p class="info-text">${escapeHtml(item.infoText || item.shortDesc || "")}</p>
  `;
  overlay.classList.add("open");
}

document.getElementById("info-modal-close").addEventListener("click", () => {
  document.getElementById("info-modal").classList.remove("open");
  document.getElementById("info-modal-body").innerHTML = "";
});

/* ---------------- Buy flow modal ---------------- */
const buyModal = document.getElementById("buy-modal");
const buyModalBody = document.getElementById("buy-modal-body");
let buyState = null;
let pollTimer = null;

function closeBuyModal() {
  buyModal.classList.remove("open");
  clearInterval(pollTimer);
  buyState = null;
}
document.getElementById("buy-modal-close").addEventListener("click", closeBuyModal);

function openBuyModal(item) {
  if (!item) return;
  buyState = { item, edition: "java", name: "" };
  renderBuyStep1();
  buyModal.classList.add("open");
}

function renderBuyStep1() {
  const { item, edition, name } = buyState;
  buyModalBody.innerHTML = `
    <h3>Buy: ${escapeHtml(item.name)}</h3>
    <p class="price">$${Number(item.price).toFixed(2)}</p>
    <div class="field">
      <label for="buy-name">Minecraft username</label>
      <input type="text" id="buy-name" placeholder="Steve123" maxlength="20" value="${escapeHtml(name)}" autocomplete="off" />
    </div>
    <div class="field">
      <label>Edition</label>
      <div class="edition-toggle">
        <button type="button" data-edition="java" class="${edition === "java" ? "active" : ""}">Java</button>
        <button type="button" data-edition="bedrock" class="${edition === "bedrock" ? "active" : ""}">Bedrock</button>
      </div>
      <span class="preview-name" id="name-preview"></span>
    </div>
    <button class="continue-btn" id="continue-btn">Continue</button>
  `;

  const nameInput = document.getElementById("buy-name");
  const preview = document.getElementById("name-preview");
  const updatePreview = () => {
    const clean = nameInput.value.trim();
    preview.textContent = clean ? `Will be shown as: ${buyState.edition === "bedrock" ? "." + clean : clean}` : "";
  };
  nameInput.addEventListener("input", () => {
    buyState.name = nameInput.value;
    updatePreview();
  });

  buyModalBody.querySelectorAll("[data-edition]").forEach((btn) =>
    btn.addEventListener("click", () => {
      buyState.edition = btn.dataset.edition;
      buyModalBody.querySelectorAll("[data-edition]").forEach((b) => b.classList.toggle("active", b === btn));
      updatePreview();
    })
  );
  updatePreview();

  document.getElementById("continue-btn").addEventListener("click", startCheckout);
}

async function startCheckout() {
  const name = buyState.name.trim();
  if (!/^[A-Za-z0-9_]{2,16}$/.test(name)) {
    showToast("Enter a valid Minecraft username (letters, numbers, underscore).");
    return;
  }
  const continueBtn = document.getElementById("continue-btn");
  continueBtn.disabled = true;
  continueBtn.textContent = "Generating KHQR…";

  try {
    const result = await fetchJSON("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: buyState.item.id, playerName: name, edition: buyState.edition }),
    });
    buyState.order = result;
    renderBuyStep2();
    updateQrStatusCountdown();
    pollTimer = setInterval(pollPaymentStatus, 4000);
  } catch (err) {
    showToast(err.message);
    continueBtn.disabled = false;
    continueBtn.textContent = "Continue";
  }
}

function renderBuyStep2() {
  const { order } = buyState;
  buyModalBody.innerHTML = `
    <button class="back-link" id="back-to-form">&larr; Back</button>
    <div class="qr-box">
      <h3>Scan to pay with KHQR</h3>
      <img src="${order.qrDataUrl}" alt="KHQR code" />
      <div class="qr-meta"><span>Item</span><strong>${escapeHtml(order.itemName)}</strong></div>
      <div class="qr-meta"><span>Player</span><strong>${escapeHtml(order.playerName)}</strong></div>
      <div class="qr-meta"><span>Amount</span><strong>$${Number(order.amount).toFixed(2)} ${escapeHtml(order.currency)}</strong></div>
      <p class="qr-status" id="qr-status">Waiting for payment…</p>
    </div>
  `;
  document.getElementById("back-to-form").addEventListener("click", () => {
    clearInterval(pollTimer);
    renderBuyStep1();
  });
}

function updateQrStatusCountdown() {
  const statusEl = document.getElementById("qr-status");
  const expiresAt = buyState?.order?.expiresAt;
  if (!statusEl || !expiresAt) return;
  const msLeft = expiresAt - Date.now();
  if (msLeft <= 0) {
    statusEl.textContent = "This KHQR has expired. Go back and try again.";
    clearInterval(pollTimer);
    return;
  }
  const mins = Math.floor(msLeft / 60000);
  const secs = Math.floor((msLeft % 60000) / 1000);
  statusEl.textContent = `Waiting for payment… expires in ${mins}:${String(secs).padStart(2, "0")}`;
}

async function pollPaymentStatus() {
  if (!buyState?.order) return;
  updateQrStatusCountdown();
  if (buyState.order.expiresAt && Date.now() > buyState.order.expiresAt) return;
  try {
    const res = await fetchJSON(`/api/checkout/${buyState.order.orderId}/status`);
    if (res.status === "paid") {
      clearInterval(pollTimer);
      renderBuySuccess();
    }
  } catch {
    /* keep polling silently */
  }
}

function renderBuySuccess() {
  const { order } = buyState;
  buyModalBody.innerHTML = `
    <div class="success-box">
      <div class="success-icon">✅</div>
      <h3>Purchase successful!</h3>
      <div class="receipt">
        <div><span>Item</span><strong>${escapeHtml(order.itemName)}</strong></div>
        <div><span>Player</span><strong>${escapeHtml(order.playerName)}</strong></div>
        <div><span>Amount paid</span><strong>$${Number(order.amount).toFixed(2)} ${escapeHtml(order.currency)}</strong></div>
        <div><span>Order ID</span><strong>${escapeHtml(order.orderId)}</strong></div>
      </div>
      <p>Your item will be delivered in-game shortly. Need help? Contact support:</p>
      ${supportTelegram ? `<a class="tg-support-btn" href="https://t.me/${encodeURIComponent(supportTelegram)}" target="_blank" rel="noopener">💬 Telegram Support</a>` : ""}
      <br /><button class="back-link" id="back-to-store" style="margin-top:1rem;">&larr; Back to store</button>
    </div>
  `;
  document.getElementById("back-to-store").addEventListener("click", closeBuyModal);
}

initStore();
