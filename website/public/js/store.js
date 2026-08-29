// Store page. You verify your Minecraft name once, then the catalogue knows
// who it is selling to: it can show your rank and coins, price rank upgrades
// against what you already own, and deliver to the right account.
let allItems = { ranks: [], coins: [], other: [] };
let ladder = [];        // the rank ladder, ascending
let account = null;
let activeCategory = "ranks";
let pendingItem = null; // the item sitting in the confirmation dialog
let pendingUpgradeFrom = null; // rank id being traded in, or null for a plain buy

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
function ladderEntry(rankId) {
  return ladder.find((r) => r.id === rankId) || null;
}

// A player can legitimately hold more than one configured rank at once
// (bought two separately, neither replacing the other) - the plugin reports
// all of them in account.ranks, not just the highest.
function heldRanks() {
  return account && Array.isArray(account.ranks) ? account.ranks : [];
}

// Every held rank the player could trade in for `targetWeight` - i.e. worth
// less - ascending. Empty when there's nothing to upgrade from, even if they
// hold something *above* the target (buying a rank below what you already
// have is just a plain purchase, not a downgrade path).
function eligibleFromRanks(targetWeight) {
  return heldRanks()
    .filter((r) => typeof r.weight === "number" && r.weight < targetWeight)
    .map((r) => ladderEntry(r.id))
    .filter(Boolean)
    .sort((a, b) => a.weight - b.weight);
}

// Buy button state for one rank item: a plain buy, the rank you already
// hold, or one you could upgrade into (with the ranks you could trade in).
function buttonState(item) {
  if (item.comingSoon) return { kind: "soon" };
  if (item.category !== "ranks") return { kind: "plain" };
  const theirs = rankWeight(item.id);
  if (theirs == null) return { kind: "plain" };
  if (heldRanks().some((r) => r.weight === theirs)) return { kind: "owned" };
  const eligible = eligibleFromRanks(theirs);
  return eligible.length ? { kind: "upgradeable", eligible } : { kind: "plain" };
}

// Which held rank each upgradeable item is currently armed to trade in for,
// keyed by item id - set by picking one from the card's Up Rank dropdown,
// read when Confirm is pressed. Cleared whenever the grid data changes
// under it (a fresh account load could make a stale choice invalid).
const armedUpgrade = new Map();

function actionsMarkup(item) {
  const state = buttonState(item);
  if (state.kind === "soon") {
    return `<button class="buy-btn" disabled>${escapeHtml(t("store.comingSoon"))}</button>`;
  }
  if (state.kind === "owned") {
    return `<button class="buy-btn rank-lower" disabled>${escapeHtml(t("store.alreadyOwned"))}</button>`;
  }
  if (state.kind === "plain") {
    return `<button class="buy-btn" data-buy="${item.id}">${escapeHtml(t("store.buyNow"))}</button>`;
  }
  // upgradeable: a plain-price Confirm plus a separate Up Rank picker - buying
  // the rank outright (on top of what they hold) is still a valid choice.
  const armedId = armedUpgrade.get(item.id) || "";
  const armed = state.eligible.find((r) => r.id === armedId) || null;
  return `
    <div class="rank-split">
      <button class="buy-btn confirm-part" data-buy="${item.id}">${escapeHtml(t("store.confirm"))}</button>
      <div class="up-rank-wrap">
        <button type="button" class="up-rank-btn${armed ? " armed" : ""}" tabindex="-1">
          <span class="up-rank-icon">⬆️</span>
          <span class="up-rank-label">${armed ? escapeHtml(armed.displayName) : escapeHtml(t("store.upRank"))}</span>
        </button>
        <select class="up-rank-select" data-upgrade-select="${item.id}" aria-label="${escapeHtml(t("store.upRankChoose"))}">
          <option value="">${escapeHtml(t("store.upRankChoose"))}</option>
          ${state.eligible
            .map((r) => `<option value="${r.id}"${r.id === armedId ? " selected" : ""}>${escapeHtml(r.displayName)}</option>`)
            .join("")}
        </select>
      </div>
    </div>`;
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
          ${actionsMarkup(item)}
          <button class="info-btn" data-info="${item.id}" title="${escapeHtml(t("store.infoTitle"))}">!</button>
        </div>
      </div>
    </div>`;
    })
    .join("");

  grid.querySelectorAll("[data-buy]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const item = findItem(btn.dataset.buy);
      openConfirm(item, armedUpgrade.get(btn.dataset.buy) || null);
    })
  );
  grid.querySelectorAll("[data-upgrade-select]").forEach((select) =>
    select.addEventListener("change", () => {
      if (select.value) armedUpgrade.set(select.dataset.upgradeSelect, select.value);
      else armedUpgrade.delete(select.dataset.upgradeSelect);
      renderGrid();
    })
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
  // The "!" popup always offers a plain buy at full price - the discounted
  // upgrade path lives on the card itself (Up Rank), not duplicated here.
  const state = buttonState(item);
  const disabled = state.kind === "soon" || state.kind === "owned";
  const label = state.kind === "soon" ? t("store.comingSoon") : state.kind === "owned" ? t("store.alreadyOwned") : t("store.buyNow");
  const ownedCls = state.kind === "owned" ? " rank-lower" : "";
  document.getElementById("info-modal-body").innerHTML = `
    ${embed ? `<iframe class="video-embed" src="${escapeHtml(embed)}" allowfullscreen></iframe>` : ""}
    <h3>${escapeHtml(item.name)}</h3>
    <p class="info-text">${escapeHtml(item.infoText || item.shortDesc || "")}</p>
    <div class="info-buy-row">
      <span class="price">${item.comingSoon ? "—" : escapeHtml(formatPrice(item.price))}</span>
      <button class="continue-btn info-buy-btn${ownedCls}"${disabled ? " disabled" : ' id="info-buy"'}>${escapeHtml(label)}</button>
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
   Payment happens on /checkout - the customer scans our KHQR, uploads
   their receipt, and we approve it from Telegram. This dialog is the last
   "is this right?" before an order is created. */
const buyModal = document.getElementById("buy-modal");
const buyModalBody = document.getElementById("buy-modal-body");

function closeBuyModal() {
  buyModal.classList.remove("open");
  pendingItem = null;
  pendingUpgradeFrom = null;
}
document.getElementById("buy-modal-close").addEventListener("click", closeBuyModal);
buyModal.addEventListener("click", (e) => {
  if (e.target.id === "buy-modal") closeBuyModal();
});

// `fromRankId` is the trade-in the player picked on the card's Up Rank
// dropdown, if any - null means a plain full-price purchase, even for an
// upgrade-eligible item. The price shown here is an estimate for the
// player's benefit only; /api/checkout recomputes it from the server's own
// ladder data, the same way it always has for full-price items.
function openConfirm(item, fromRankId) {
  if (!item || !account) return;
  pendingItem = item;
  const fromEntry = fromRankId ? ladderEntry(fromRankId) : null;
  const toEntry = ladderEntry(item.id.replace(/^rank-/, ""));
  pendingUpgradeFrom = fromEntry ? fromEntry.id : null;

  const displayPrice =
    fromEntry && toEntry ? Math.max(0, toEntry.priceUsd - fromEntry.priceUsd) : item.price;

  buyModalBody.innerHTML = `
    <div class="confirm-head">
      <img class="confirm-icon" src="${escapeHtml(item.image)}" alt="" onerror="this.style.display='none'" />
      <h3>${escapeHtml(item.name)}</h3>
      ${
        fromEntry
          ? `<span class="confirm-tag">${escapeHtml(
              t("store.upgradeSummary", { from: fromEntry.displayName, to: item.name })
            )}</span>`
          : ""
      }
    </div>
    <div class="receipt confirm-rows">
      <div><span>${escapeHtml(t("checkout.inServerName"))}</span><strong>${escapeHtml(account.player)}</strong></div>
      <div><span>${escapeHtml(t("checkout.edition"))}</span><strong>${escapeHtml(
        t(account.edition === "bedrock" ? "buy.bedrock" : "buy.java")
      )}</strong></div>
      <div><span>${escapeHtml(t("checkout.total"))}</span><strong class="price">${escapeHtml(
        formatPrice(displayPrice)
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
      body: JSON.stringify({ itemId: pendingItem.id, upgradeFromRankId: pendingUpgradeFrom || undefined }),
    });
    window.location.href = `/checkout?order=${encodeURIComponent(result.orderId)}`;
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
  let cfg = null;
  try {
    cfg = await getSiteConfig();
  } catch {
    /* if the config call itself fails, fall through and let the gate try */
  }
  if (cfg && cfg.angkorstoreEnabled === false) {
    gate.hidden = true;
    const box = document.getElementById("store-unavailable");
    box.hidden = false;
    if (cfg.supportTelegram) {
      const line = document.getElementById("store-unavailable-support");
      line.hidden = false;
      line.innerHTML = `<a href="https://t.me/${encodeURIComponent(cfg.supportTelegram)}" target="_blank" rel="noopener">${escapeHtml(
        t("checkout.contactSupport")
      )}</a>`;
    }
    return;
  }

  [allItems, account] = await Promise.all([fetchJSON("/api/items"), Account.load("store")]);
  try {
    ladder = (await Account.ranks()).ranks || [];
  } catch {
    ladder = [];
  }
  if (account && account.player) return showStore();
  updatePreview();
})();
