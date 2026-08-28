// Store page. You verify your Minecraft name once, then the catalogue knows
// who it is selling to: it can show your rank and coins, price rank upgrades
// against what you already own, and deliver to the right account.
let allItems = { ranks: [], coins: [], other: [] };
let ladder = [];        // the rank ladder, ascending
let account = null;
let activeCategory = "ranks";
let pendingItem = null; // the item sitting in the confirmation dialog

const CATEGORY_KEYS = { ranks: "store.tab.ranks", coins: "store.tab.coins", other: "store.tab.other" };

const gate = document.getElementById("store-gate");
const body = document.getElementById("store-body");
const nameInput = document.getElementById("store-name");
const namePreview = document.getElementById("store-name-preview");
const verifyBtn = document.getElementById("store-verify-btn");
let edition = "java";

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

/* ---------------- Sign in ---------------- */
function updatePreview() {
  const shown = normalizeServerName(nameInput.value, edition);
  namePreview.textContent = shown ? t("buy.inServerName", { name: shown }) : "";
}
nameInput.addEventListener("input", updatePreview);
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") verifyName();
});
document.querySelectorAll("#store-edition [data-edition]").forEach((btn) =>
  btn.addEventListener("click", () => {
    edition = btn.dataset.edition;
    document
      .querySelectorAll("#store-edition [data-edition]")
      .forEach((b) => b.classList.toggle("active", b === btn));
    updatePreview();
  })
);
verifyBtn.addEventListener("click", verifyName);

async function verifyName() {
  const raw = nameInput.value.trim();
  if (!isValidRawName(raw, edition)) {
    showToast(t(edition === "bedrock" ? "buy.invalidBedrock" : "buy.invalidJava"));
    return;
  }
  verifyBtn.disabled = true;
  try {
    account = await Account.set(raw, edition, "store");
    await showStore();
  } catch (err) {
    showToast(err.message);
  } finally {
    verifyBtn.disabled = false;
  }
}

async function showStore() {
  gate.hidden = true;
  body.hidden = false;
  renderProfile();
  renderTabs();
  renderGrid();
}

/* ---------------- Profile bar ---------------- */
function rankItemFor(rankId) {
  return (allItems.ranks || []).find((item) => item.id === `rank-${rankId}` || item.id === rankId) || null;
}

function renderProfile() {
  document.getElementById("store-player-name").textContent = account.player;

  const rankChip = document.getElementById("store-rank-chip");
  const coinsChip = document.getElementById("store-coins-chip");
  const icon = document.getElementById("store-rank-icon");

  if (account.rank) {
    rankChip.textContent = account.rank.displayName || account.rank.id;
    rankChip.hidden = false;
    const item = rankItemFor(account.rank.id);
    if (item && item.image) {
      icon.innerHTML = `<img src="${escapeHtml(item.image)}" alt="" />`;
    } else {
      icon.textContent = "🏅";
    }
  } else if (account.linked) {
    // The plugin answered and says they hold no rank yet.
    rankChip.textContent = t("store.noRank");
    rankChip.hidden = false;
    icon.textContent = "🧑‍🌾";
  } else {
    rankChip.hidden = true;
    icon.textContent = "🧑‍🌾";
  }

  if (typeof account.coins === "number") {
    coinsChip.textContent = `🪙 ${formatCompact(account.coins)}`;
    coinsChip.hidden = false;
  } else {
    coinsChip.hidden = true;
  }
}

/* ---------------- Catalogue ---------------- */
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

// Where a store rank sits on the ladder, and where the player sits.
function rankWeight(itemId) {
  const entry = ladder.find((r) => r.itemId === itemId || `rank-${r.id}` === itemId);
  return entry ? entry.weight : null;
}
function myWeight() {
  if (!account || !account.rank) return null;
  const entry = ladder.find((r) => r.id === account.rank.id);
  return entry ? entry.weight : typeof account.rank.weight === "number" ? account.rank.weight : null;
}

// Buy button state for one item: a plain buy, an upgrade, the rank you already
// hold, or one you are already past.
function buttonFor(item) {
  if (item.comingSoon) {
    return { cls: "buy-btn", label: t("store.comingSoon"), disabled: true };
  }
  if (item.category !== "ranks") {
    return { cls: "buy-btn", label: t("store.buyNow"), disabled: false };
  }
  const mine = myWeight();
  const theirs = rankWeight(item.id);
  if (mine == null || theirs == null) {
    return { cls: "buy-btn", label: t("store.buyNow"), disabled: false };
  }
  if (theirs === mine) {
    return { cls: "buy-btn rank-current", label: t("store.currentRank"), disabled: true };
  }
  if (theirs < mine) {
    return { cls: "buy-btn rank-lower", label: t("store.lowerRank"), disabled: true };
  }
  return { cls: "buy-btn rank-upgrade", label: t("store.upgradeNow"), disabled: false };
}

function renderGrid() {
  const grid = document.getElementById("item-grid");
  const items = (allItems[activeCategory] || []).map((item) => ({ ...item, category: activeCategory }));
  if (!items.length) {
    grid.innerHTML = `<p class="empty-note">${escapeHtml(t("store.empty"))}</p>`;
    return;
  }
  grid.innerHTML = items
    .map((item) => {
      const soon = Boolean(item.comingSoon);
      const btn = buttonFor(item);
      return `
    <div class="item-card${soon ? " coming-soon" : ""}">
      <div class="item-image-wrap">
        <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" onerror="this.style.opacity=0.2" />
        ${soon ? "" : `<span class="sparkle sparkle-1" aria-hidden="true"></span>
        <span class="sparkle sparkle-2" aria-hidden="true"></span>
        <span class="sparkle sparkle-3" aria-hidden="true"></span>
        <span class="sparkle sparkle-4" aria-hidden="true"></span>`}
      </div>
      <div class="item-body">
        <h3>${escapeHtml(item.name)}</h3>
        <p>${escapeHtml(item.shortDesc)}</p>
        <div class="price">${soon ? "—" : escapeHtml(formatPrice(item.price))}</div>
        <div class="item-actions">
          <button class="${btn.cls}"${btn.disabled ? " disabled" : ` data-buy="${item.id}"`}>${escapeHtml(btn.label)}</button>
          <button class="info-btn" data-info="${item.id}" title="${escapeHtml(t("store.infoTitle"))}">!</button>
        </div>
      </div>
    </div>`;
    })
    .join("");

  grid.querySelectorAll("[data-buy]").forEach((btn) =>
    btn.addEventListener("click", () => openConfirm(findItem(btn.dataset.buy)))
  );
  grid.querySelectorAll("[data-info]").forEach((btn) =>
    btn.addEventListener("click", () => openInfoModal(findItem(btn.dataset.info)))
  );
}

function findItem(id) {
  for (const cat of Object.keys(allItems)) {
    const found = (allItems[cat] || []).find((i) => i.id === id);
    if (found) return { ...found, category: cat };
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

let infoItem = null;

function openInfoModal(item) {
  if (!item) return;
  infoItem = item;
  const overlay = document.getElementById("info-modal");
  const embed = toEmbedUrl(item.videoUrl);
  const btn = buttonFor(item);
  document.getElementById("info-modal-body").innerHTML = `
    ${embed ? `<iframe class="video-embed" src="${escapeHtml(embed)}" allowfullscreen></iframe>` : ""}
    <h3>${escapeHtml(item.name)}</h3>
    <p class="info-text">${escapeHtml(item.infoText || item.shortDesc || "")}</p>
    <div class="info-buy-row">
      <span class="price">${item.comingSoon ? "—" : escapeHtml(formatPrice(item.price))}</span>
      <button class="continue-btn info-buy-btn ${btn.cls.replace("buy-btn", "").trim()}"${
        btn.disabled ? " disabled" : ' id="info-buy"'
      }>${escapeHtml(btn.label)}</button>
    </div>
  `;
  const infoBuy = overlay.querySelector("#info-buy");
  if (infoBuy) {
    infoBuy.addEventListener("click", () => {
      closeInfoModal();
      openConfirm(item);
    });
  }
  overlay.classList.add("open");
}

function closeInfoModal() {
  document.getElementById("info-modal").classList.remove("open");
  document.getElementById("info-modal-body").innerHTML = "";
  infoItem = null;
}
document.getElementById("info-modal-close").addEventListener("click", closeInfoModal);
document.getElementById("info-modal").addEventListener("click", (e) => {
  if (e.target.id === "info-modal") closeInfoModal();
});

/* ---------------- Purchase confirmation ----------------
   Payment happens on /checkout.html - the customer scans our KHQR, uploads
   their receipt, and we approve it from Telegram. This dialog is the last
   "is this right?" before an order is created. */
const buyModal = document.getElementById("buy-modal");
const buyModalBody = document.getElementById("buy-modal-body");

function closeBuyModal() {
  buyModal.classList.remove("open");
  pendingItem = null;
}
document.getElementById("buy-modal-close").addEventListener("click", closeBuyModal);
buyModal.addEventListener("click", (e) => {
  if (e.target.id === "buy-modal") closeBuyModal();
});

function openConfirm(item) {
  if (!item || !account) return;
  pendingItem = item;
  const isUpgrade = item.category === "ranks" && myWeight() != null;
  buyModalBody.innerHTML = `
    <div class="confirm-head">
      <img class="confirm-icon" src="${escapeHtml(item.image)}" alt="" onerror="this.style.display='none'" />
      <h3>${escapeHtml(item.name)}</h3>
      ${isUpgrade ? `<span class="confirm-tag">${escapeHtml(t("store.upgradeNow"))}</span>` : ""}
    </div>
    <div class="receipt confirm-rows">
      <div><span>${escapeHtml(t("checkout.inServerName"))}</span><strong>${escapeHtml(account.player)}</strong></div>
      <div><span>${escapeHtml(t("checkout.edition"))}</span><strong>${escapeHtml(
        t(account.edition === "bedrock" ? "buy.bedrock" : "buy.java")
      )}</strong></div>
      <div><span>${escapeHtml(t("checkout.total"))}</span><strong class="price">${escapeHtml(
        formatPrice(item.price)
      )}</strong></div>
    </div>
    <div class="confirm-actions">
      <button class="continue-btn" id="confirm-buy">${escapeHtml(t("store.confirm"))}</button>
      <button class="back-link" id="cancel-buy">${escapeHtml(t("store.cancel"))}</button>
    </div>
  `;
  document.getElementById("confirm-buy").addEventListener("click", startCheckout);
  document.getElementById("cancel-buy").addEventListener("click", closeBuyModal);
  buyModal.classList.add("open");
}

async function startCheckout() {
  if (!pendingItem) return;
  const btn = document.getElementById("confirm-buy");
  btn.disabled = true;
  btn.textContent = t("buy.wait");
  try {
    const result = await fetchJSON("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: pendingItem.id }),
    });
    window.location.href = `/checkout.html?order=${encodeURIComponent(result.orderId)}`;
  } catch (err) {
    showToast(err.message);
    btn.disabled = false;
    btn.textContent = t("store.confirm");
  }
}

/* ---------------- Change name ---------------- */
const nameModal = document.getElementById("name-modal");
const changeInput = document.getElementById("change-name");
const changePreview = document.getElementById("change-name-preview");
let changeEdition = "java";

function updateChangePreview() {
  const shown = normalizeServerName(changeInput.value, changeEdition);
  changePreview.textContent = shown ? t("buy.inServerName", { name: shown }) : "";
}
changeInput.addEventListener("input", updateChangePreview);
document.querySelectorAll("#change-edition [data-edition]").forEach((btn) =>
  btn.addEventListener("click", () => {
    changeEdition = btn.dataset.edition;
    document
      .querySelectorAll("#change-edition [data-edition]")
      .forEach((b) => b.classList.toggle("active", b === btn));
    updateChangePreview();
  })
);

// The modal always opens — no more silently refusing the click. While the
// cooldown is still running it shows a live countdown and disables Save, so
// the player can see exactly why (and how long) instead of guessing.
let modalCooldownTimer = null;

function renderCooldownNote() {
  const note = document.getElementById("change-cooldown-note");
  const btn = document.getElementById("change-name-save");
  const nameField = document.getElementById("change-name-field");
  const editionField = document.getElementById("change-edition-field");
  const left = account ? account.canChangeAt - Date.now() : 0;
  const locked = left > 0;
  note.hidden = !locked;
  if (locked) note.textContent = t("games.nameLockedToast", { time: humanDuration(left) });
  btn.hidden = locked;
  btn.disabled = locked;
  nameField.hidden = locked;
  editionField.hidden = locked;
}

document.getElementById("store-change-btn").addEventListener("click", () => {
  changeEdition = account ? account.edition : "java";
  document
    .querySelectorAll("#change-edition [data-edition]")
    .forEach((b) => b.classList.toggle("active", b.dataset.edition === changeEdition));
  changeInput.value = "";
  updateChangePreview();
  nameModal.classList.add("open");
  renderCooldownNote();
  clearInterval(modalCooldownTimer);
  modalCooldownTimer = setInterval(renderCooldownNote, 1000);
  if (!changeInput.closest(".field").hidden) changeInput.focus();
});

function closeNameModal() {
  nameModal.classList.remove("open");
  clearInterval(modalCooldownTimer);
}
document.getElementById("name-modal-close").addEventListener("click", closeNameModal);
nameModal.addEventListener("click", (e) => {
  if (e.target === nameModal) closeNameModal();
});
changeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveNewName();
});
document.getElementById("change-name-save").addEventListener("click", saveNewName);

async function saveNewName() {
  if (account && Date.now() < account.canChangeAt) return; // button should already be disabled
  const raw = changeInput.value.trim();
  if (!isValidRawName(raw, changeEdition)) {
    showToast(t(changeEdition === "bedrock" ? "buy.invalidBedrock" : "buy.invalidJava"));
    return;
  }
  const btn = document.getElementById("change-name-save");
  btn.disabled = true;
  try {
    account = await Account.set(raw, changeEdition, "store");
    closeNameModal();
    showToast(t("games.nameSaved", { name: account.player }));
    renderProfile();
    renderGrid(); // rank buttons depend on who is signed in
  } catch (err) {
    showToast(err.message);
    renderCooldownNote();
  } finally {
    btn.disabled = account ? Date.now() < account.canChangeAt : false;
  }
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (buyModal.classList.contains("open")) closeBuyModal();
  else if (nameModal.classList.contains("open")) closeNameModal();
  else if (document.getElementById("info-modal").classList.contains("open")) closeInfoModal();
});

document.addEventListener("i18n:change", () => {
  if (!account) return;
  renderProfile();
  renderTabs();
  renderGrid();
  if (pendingItem) openConfirm(pendingItem);
  if (infoItem) openInfoModal(infoItem);
});

/* ---------------- Boot ---------------- */
(async function initStore() {
  [allItems, account] = await Promise.all([fetchJSON("/api/items"), Account.load("store")]);
  try {
    ladder = (await Account.ranks()).ranks || [];
  } catch {
    ladder = [];
  }
  if (account && account.player) return showStore();
  updatePreview();
})();
