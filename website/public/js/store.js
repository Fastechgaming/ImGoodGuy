let allItems = { ranks: [], coins: [], other: [] };
let activeCategory = "ranks";
let supportTelegram = "";

const CATEGORY_KEYS = { ranks: "store.tab.ranks", coins: "store.tab.coins", other: "store.tab.other" };

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
  Object.keys(CATEGORY_KEYS).forEach((cat) => {
    const btn = document.createElement("button");
    btn.textContent = t(CATEGORY_KEYS[cat]);
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
    grid.innerHTML = `<p class="empty-note">${escapeHtml(t("store.empty"))}</p>`;
    return;
  }
  grid.innerHTML = items
    .map((item) => {
      const soon = Boolean(item.comingSoon);
      return `
    <div class="item-card${soon ? " coming-soon" : ""}">
      <div class="item-image-wrap">
        <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" onerror="this.style.opacity=0.2" />
        ${soon ? "" : `<img class="sparkle sparkle-1" src="/images/site/sparkle.svg" alt="" aria-hidden="true" />
        <img class="sparkle sparkle-2" src="/images/site/sparkle.svg" alt="" aria-hidden="true" />`}
      </div>
      <div class="item-body">
        <h3>${escapeHtml(item.name)}</h3>
        <p>${escapeHtml(item.shortDesc)}</p>
        <div class="price">${soon ? "—" : escapeHtml(formatPrice(item.price))}</div>
        <div class="item-actions">
          ${
            soon
              ? `<button class="buy-btn" disabled>${escapeHtml(t("store.comingSoon"))}</button>`
              : `<button class="buy-btn" data-buy="${item.id}">${escapeHtml(t("store.buyNow"))}</button>`
          }
          <button class="info-btn" data-info="${item.id}" title="${escapeHtml(t("store.infoTitle"))}">!</button>
        </div>
      </div>
    </div>`;
    })
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
    <div class="info-buy-row">
      <span class="price">${item.comingSoon ? "—" : escapeHtml(formatPrice(item.price))}</span>
      ${
        item.comingSoon
          ? `<button class="continue-btn info-buy-btn" disabled>${escapeHtml(t("store.comingSoon"))}</button>`
          : `<button class="continue-btn info-buy-btn" data-info-buy="${item.id}">${escapeHtml(t("store.buyNow"))}</button>`
      }
    </div>
  `;
  // Buying straight from the info popup: swap this modal for the buy modal.
  const infoBuy = overlay.querySelector("[data-info-buy]");
  if (infoBuy) {
    infoBuy.addEventListener("click", () => {
      closeInfoModal();
      openBuyModal(item);
    });
  }
  overlay.classList.add("open");
}

function closeInfoModal() {
  document.getElementById("info-modal").classList.remove("open");
  document.getElementById("info-modal-body").innerHTML = "";
}
document.getElementById("info-modal-close").addEventListener("click", closeInfoModal);
// Clicking the dimmed backdrop (not the box itself) also closes it.
document.getElementById("info-modal").addEventListener("click", (e) => {
  if (e.target.id === "info-modal") closeInfoModal();
});


/* ---------------- Buy flow modal (step 1: who is this for?) ----------------
   Payment itself happens on /checkout.html - the customer scans our KHQR,
   uploads their receipt, and we approve it from Telegram. */
const buyModal = document.getElementById("buy-modal");
const buyModalBody = document.getElementById("buy-modal-body");
let buyState = null;

function closeBuyModal() {
  buyModal.classList.remove("open");
  buyState = null;
}
document.getElementById("buy-modal-close").addEventListener("click", closeBuyModal);
buyModal.addEventListener("click", (e) => {
  if (e.target.id === "buy-modal") closeBuyModal();
});

function openBuyModal(item) {
  if (!item) return;
  buyState = { item, edition: "java", name: "" };
  renderBuyForm();
  buyModal.classList.add("open");
}

function renderBuyForm() {
  const { item, edition, name } = buyState;
  buyModalBody.innerHTML = `
    <h3>${escapeHtml(t("buy.title", { item: item.name }))}</h3>
    <p class="price">${escapeHtml(formatPrice(item.price))}</p>
    <div class="field">
      <label for="buy-name">${escapeHtml(t("buy.username"))}</label>
      <input type="text" id="buy-name" placeholder="Steve123" maxlength="24" value="${escapeHtml(name)}" autocomplete="off" />
    </div>
    <div class="field">
      <label>${escapeHtml(t("buy.edition"))}</label>
      <div class="edition-toggle">
        <button type="button" data-edition="java" class="${edition === "java" ? "active" : ""}">${escapeHtml(t("buy.java"))}</button>
        <button type="button" data-edition="bedrock" class="${edition === "bedrock" ? "active" : ""}">${escapeHtml(t("buy.bedrock"))}</button>
      </div>
      <span class="preview-name" id="name-preview"></span>
    </div>
    <button class="continue-btn" id="continue-btn">${escapeHtml(t("buy.continue"))}</button>
  `;

  const nameInput = document.getElementById("buy-name");
  const preview = document.getElementById("name-preview");
  const updatePreview = () => {
    const shown = normalizeServerName(nameInput.value, buyState.edition);
    preview.textContent = shown ? t("buy.inServerName", { name: shown }) : "";
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
  if (!isValidRawName(name, buyState.edition)) {
    showToast(t(buyState.edition === "bedrock" ? "buy.invalidBedrock" : "buy.invalidJava"));
    return;
  }
  const continueBtn = document.getElementById("continue-btn");
  continueBtn.disabled = true;
  continueBtn.textContent = t("buy.wait");

  try {
    const result = await fetchJSON("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: buyState.item.id, playerName: name, edition: buyState.edition }),
    });
    window.location.href = `/checkout.html?order=${encodeURIComponent(result.orderId)}`;
  } catch (err) {
    showToast(err.message);
    continueBtn.disabled = false;
    continueBtn.textContent = t("buy.continue");
  }
}

// Re-render everything when the language button is pressed.
document.addEventListener("i18n:change", () => {
  if (!allItems) return;
  renderTabs();
  renderGrid();
  if (buyState) renderBuyForm();
});

initStore();
