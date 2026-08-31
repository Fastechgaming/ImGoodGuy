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
  const held = heldRanks();

  // Every configured rank they hold, not just the highest - a player can
  // legitimately hold more than one (bought two separately).
  if (held.length) {
    rankChip.innerHTML = held
      .slice()
      .sort((a, b) => a.weight - b.weight)
      .map((r) => `<span class="profile-chip">${escapeHtml(r.displayName || r.id)}</span>`)
      .join("");
  } else if (account.linked) {
    // The plugin answered and says they hold no rank yet.
    rankChip.innerHTML = `<span class="profile-chip">${escapeHtml(t("store.noRank"))}</span>`;
  } else {
    rankChip.innerHTML = "";
  }

  if (account.rank) {
    const item = rankItemFor(account.rank.id);
    if (item && item.image) {
      icon.innerHTML = `<img src="${escapeHtml(item.image)}" alt="" />`;
    } else {
      icon.textContent = "🏅";
    }
  } else {
    icon.textContent = "🧑‍🌾";
  }

  if (typeof account.coins === "number") {
    coinsChip.innerHTML = `<img class="coin-icon" src="/images/site/coin-icon.png" alt="" /> ${formatCompact(account.coins)}`;
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

// The ladder entry for the rank an item *is* (independent of what the
// player holds) - e.g. rank-pro -> the "pro" ladder entry.
function ladderEntryForItem(item) {
  return ladderEntry(item.id.replace(/^rank-/, ""));
}

function armedFor(item, state) {
  if (!state || state.kind !== "upgradeable") return null;
  const armedId = armedUpgrade.get(item.id);
  return armedId ? state.eligible.find((r) => r.id === armedId) || null : null;
}

// Plain price, or once a trade-in is armed: "$20.00 → $5.00" plus a small
// caption naming the two ranks. Shared by the card and the info popup.
function priceMarkup(item) {
  if (item.comingSoon) return `<div class="price">—</div>`;
  const state = buttonState(item);
  const armed = armedFor(item, state);
  if (armed) {
    const toEntry = ladderEntryForItem(item);
    const diff = toEntry ? Math.max(0, toEntry.priceUsd - armed.priceUsd) : item.price;
    const toName = (toEntry && toEntry.displayName) || item.name;
    const MARK_FROM = "@@FROM@@";
    const MARK_TO = "@@TO@@";
    const captionHtml = escapeHtml(t("store.upgradeCaption", { from: MARK_FROM, to: MARK_TO }))
      .replace(MARK_FROM, `<span class="rank-lime">${escapeHtml(armed.displayName)}</span>`)
      .replace(MARK_TO, `<span class="rank-lime">${escapeHtml(toName)}</span>`);
    return `
      <div class="price-block">
        <div class="price upgrade-price">
          <span class="price-was">${escapeHtml(formatPrice(item.price))}</span>
          <span class="price-arrow">→</span>
          <span class="price-now">${escapeHtml(formatPrice(diff))}</span>
        </div>
        <div class="upgrade-caption">${captionHtml}</div>
      </div>`;
  }
  return `<div class="price">${escapeHtml(formatPrice(item.price))}</div>`;
}

// The buy/upgrade controls for one item - identical markup whether it's
// rendered on the card or inside the "!" info popup, so both stay in sync
// through the same armedUpgrade state.
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
  // upgradeable: buying it outright (on top of what they hold) is still a
  // valid choice, so it's still labelled "Buy Now" - Up Rank is the separate
  // discounted path, not a rename of the plain purchase.
  const armedId = armedUpgrade.get(item.id) || "";
  const armed = armedFor(item, state);
  return `
    <div class="rank-split">
      <button class="buy-btn confirm-part" data-buy="${item.id}">${escapeHtml(t("store.buyNow"))}</button>
      <div class="uprank-dropdown" data-uprank="${item.id}">
        <button type="button" class="uprank-toggle${armed ? " armed" : ""}" data-uprank-toggle="${item.id}" aria-haspopup="true" aria-expanded="false">
          <span class="up-rank-icon">⬆️</span>
          <span class="up-rank-label">${armed ? escapeHtml(armed.displayName) : escapeHtml(t("store.upRank"))}</span>
        </button>
        <div class="uprank-menu" role="menu">
          ${state.eligible
            .map(
              (r) =>
                `<button type="button" role="menuitem" class="uprank-option${r.id === armedId ? " active" : ""}" data-uprank-option="${item.id}" data-rank-id="${r.id}">${escapeHtml(r.displayName)}</button>`
            )
            .join("")}
        </div>
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
    <div class="item-card${soon ? " coming-soon" : ""}" data-card="${item.id}">
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
        ${priceMarkup(item)}
        <div class="item-actions">
          ${actionsMarkup(item)}
        </div>
      </div>
    </div>`;
    })
    .join("");

  // Clicking anywhere on the card opens the info popup - except the buy/up
  // rank controls themselves.
  grid.querySelectorAll("[data-card]").forEach((card) =>
    card.addEventListener("click", (e) => {
      if (e.target.closest(".item-actions")) return;
      openInfoModal(findItem(card.dataset.card));
    })
  );
}

function findItem(id) {
  for (const cat of Object.keys(allItems)) {
    const found = (allItems[cat] || []).find((i) => i.id === id);
    if (found) return { ...found, category: cat };
  }
  return null;
}

// Item cards clip their contents (rounded corners, sparkles), so the
// dropdown menu can't be positioned relative to it the way the nav's
// language menu is - it would get cut off. Instead it's fixed-positioned
// against the toggle button's own screen coordinates, computed fresh each
// time it opens.
function positionUprankMenu(wrap, toggle) {
  const menu = wrap.querySelector(".uprank-menu");
  if (!menu) return;
  const rect = toggle.getBoundingClientRect();
  const menuWidth = menu.offsetWidth || 170;
  const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${rect.bottom + 10}px`;
}
// Scrolling would leave an open menu pointing at the wrong spot since its
// position isn't live-tracked - simplest fix is to close it, same as any
// other outside interaction.
window.addEventListener(
  "scroll",
  () => document.querySelectorAll(".uprank-dropdown.open").forEach((el) => el.classList.remove("open")),
  true
);

// One delegated listener handles every buy/up-rank control on the page -
// the grid re-renders its innerHTML on every change, and the same controls
// also appear inside the info popup, so per-element listeners would just be
// thrown away and re-attached constantly. Registered once, works everywhere.
document.addEventListener("click", (e) => {
  const buyBtn = e.target.closest("[data-buy]");
  if (buyBtn) {
    const item = findItem(buyBtn.dataset.buy);
    closeInfoModal();
    openConfirm(item, armedUpgrade.get(buyBtn.dataset.buy) || null);
    return;
  }

  const toggle = e.target.closest("[data-uprank-toggle]");
  if (toggle) {
    e.stopPropagation();
    const wrap = toggle.closest(".uprank-dropdown");
    const wasOpen = wrap.classList.contains("open");
    document.querySelectorAll(".uprank-dropdown.open").forEach((el) => el.classList.remove("open"));
    if (!wasOpen) {
      positionUprankMenu(wrap, toggle);
      wrap.classList.add("open");
    }
    toggle.setAttribute("aria-expanded", String(!wasOpen));
    return;
  }

  const option = e.target.closest("[data-uprank-option]");
  if (option) {
    e.stopPropagation();
    armedUpgrade.set(option.dataset.uprankOption, option.dataset.rankId);
    document.querySelectorAll(".uprank-dropdown.open").forEach((el) => el.classList.remove("open"));
    renderGrid();
    if (infoItem && infoItem.id === option.dataset.uprankOption) openInfoModal(infoItem);
    return;
  }

  if (!e.target.closest(".uprank-dropdown")) {
    document.querySelectorAll(".uprank-dropdown.open").forEach((el) => el.classList.remove("open"));
  }
});

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
  // Same price display and buy/up-rank controls as the card, so the two
  // never show conflicting states or prices.
  document.getElementById("info-modal-body").innerHTML = `
    ${embed ? `<iframe class="video-embed" src="${escapeHtml(embed)}" allowfullscreen></iframe>` : ""}
    <h3>${escapeHtml(item.name)}</h3>
    <p class="info-text">${escapeHtml(item.infoText || item.shortDesc || "")}</p>
    <div class="info-buy-row">
      ${priceMarkup(item)}
      <div class="item-actions">
        ${actionsMarkup(item)}
      </div>
    </div>
  `;
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

  const toName = (toEntry && toEntry.displayName) || item.name;
  const displayPrice =
    fromEntry && toEntry ? Math.max(0, toEntry.priceUsd - fromEntry.priceUsd) : item.price;

  buyModalBody.innerHTML = `
    <div class="confirm-head">
      <img class="confirm-icon" src="${escapeHtml(item.image)}" alt="" onerror="this.style.display='none'" />
      <div class="confirm-head-text">
        <h3>${escapeHtml(item.name)}</h3>
        ${
          fromEntry
            ? `<span class="confirm-tag">${escapeHtml(t("store.upgradeSummary", { from: fromEntry.displayName, to: toName }))}</span>`
            : ""
        }
      </div>
    </div>
    <div class="receipt confirm-rows">
      <div><span>${escapeHtml(t("store.confirmName"))}</span><strong>${escapeHtml(account.player)}</strong></div>
      <div><span>${escapeHtml(t("store.confirmPlatform"))}</span><strong>${escapeHtml(
        t(account.edition === "bedrock" ? "buy.bedrock" : "buy.java")
      )}</strong></div>
    </div>
    <div class="confirm-price">${escapeHtml(formatPrice(displayPrice))}</div>
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
