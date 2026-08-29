// Games page: name gate -> hub -> mini-game -> result.
//
// Points are scored in the browser; COINS are not. Every round is opened and
// closed against /api/games, which is where the five-plays-a-day-per-game limit
// and the 500 coins/day allowance actually live. The page only displays what
// the server says it awarded.
//
// The player's name lives in a signed cookie shared with the store, so this
// page asks for it once and the store already knows you afterwards.

const gate = document.getElementById("games-gate");
const hub = document.getElementById("games-hub");
const nameInput = document.getElementById("games-name");
const namePreview = document.getElementById("games-name-preview");
const startBtn = document.getElementById("games-start-btn");

let edition = "java";
let account = null;  // { player, uuid, coins, rank, canChange, canChangeAt }
let daily = null;    // last /api/games/daily payload
let board = null;    // last /api/games/leaderboard payload
let resetTimer = null;
let stopCurrentGame = null;
let activeGame = null;
let activeRoundId = null;
let countdownTimer = null;

/* ---------------- Name gate ---------------- */
function updatePreview() {
  const shown = normalizeServerName(nameInput.value, edition);
  namePreview.textContent = shown ? t("buy.inServerName", { name: shown }) : "";
}

nameInput.addEventListener("input", updatePreview);
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") claimName();
});

document.querySelectorAll("#games-gate [data-edition]").forEach((btn) =>
  btn.addEventListener("click", () => {
    edition = btn.dataset.edition;
    document
      .querySelectorAll("#games-gate [data-edition]")
      .forEach((b) => b.classList.toggle("active", b === btn));
    updatePreview();
  })
);

startBtn.addEventListener("click", claimName);

async function claimName() {
  const raw = nameInput.value.trim();
  if (!isValidRawName(raw, edition)) {
    showToast(t(edition === "bedrock" ? "buy.invalidBedrock" : "buy.invalidJava"));
    return;
  }
  startBtn.disabled = true;
  try {
    account = await Account.set(raw, edition, "games");
    openHub();
  } catch (err) {
    showToast(err.message);
  } finally {
    startBtn.disabled = false;
  }
}

/* ---------------- Hub ---------------- */
async function openHub() {
  gate.hidden = true;
  hub.hidden = false;
  document.getElementById("hub-player-name").textContent = account.player;
  renderChangeButton();
  renderGamesGrid();
  await Promise.all([refreshDaily(), refreshBoard()]);
}

function renderChangeButton() {
  const btn = document.getElementById("games-switch-btn");
  btn.removeAttribute("data-i18n");
  btn.textContent = t("games.changeName");
}

async function refreshDaily() {
  try {
    daily = await fetchJSON("/api/games/daily");
  } catch {
    daily = null;
  }
  renderDaily();
  renderGamesGrid();
}

async function refreshBoard() {
  try {
    board = await fetchJSON("/api/games/leaderboard?limit=50");
  } catch {
    board = null;
  }
  renderBoard();
}

function renderDaily() {
  const coins = document.getElementById("stat-coins");
  const earned = document.getElementById("stat-earned");
  const reset = document.getElementById("stat-reset");

  // The headline number is the player's real in-game balance when the plugin
  // is connected; otherwise it's what the website has paid them today.
  const balance = account && typeof account.coins === "number" ? account.coins : daily ? daily.coinsEarned : 0;
  coins.textContent = formatCompact(balance);

  // Same real balance, shown as a small chip under the player name (mirrors
  // the store's profile bar) — only when the plugin actually reports one.
  const hubCoinsChip = document.getElementById("hub-coins-chip");
  if (account && typeof account.coins === "number") {
    hubCoinsChip.textContent = `🪙 ${formatCompact(account.coins)}`;
    hubCoinsChip.hidden = false;
  } else {
    hubCoinsChip.hidden = true;
  }

  if (!daily) {
    earned.textContent = "—";
    reset.textContent = "";
    return;
  }
  earned.textContent = t("games.earnedToday", {
    earned: daily.coinsEarned.toLocaleString(),
    cap: daily.coinCap.toLocaleString(),
  });
  earned.classList.toggle("cap-reached", daily.coinCapReached);
  startResetCountdown(reset);
}

// Live "Resets in 6h 12m" under the daily total.
function startResetCountdown(node) {
  clearInterval(resetTimer);
  const tick = () => {
    if (!daily) return;
    node.textContent = t("games.resetsIn", { time: humanDuration(daily.resetAt - Date.now()) });
    if (daily.resetAt - Date.now() <= 0) refreshDaily();
  };
  tick();
  resetTimer = setInterval(tick, 30000);
}

/* ---------------- Leaderboard ---------------- */
function isYou(row) {
  return account && row.name.toLowerCase() === account.player.toLowerCase();
}

function renderBoard() {
  const top3 = document.getElementById("board-top3");
  const points = document.getElementById("stat-points");

  // The big number is the player's lifetime points, straight from the board.
  points.textContent = board && board.you ? formatCompact(board.you.points) : "0";

  if (!board || !board.top.length) {
    top3.innerHTML = `<li class="board-empty">${escapeHtml(t("games.leaderboardEmpty"))}</li>`;
  } else {
    const medals = ["🥇", "🥈", "🥉"];
    top3.innerHTML = board.top
      .slice(0, 3)
      .map(
        (row) => `<li class="board-row${isYou(row) ? " is-you" : ""}">
            <span class="board-rank">${medals[row.rank - 1] || `#${row.rank}`}</span>
            <span class="board-name">${escapeHtml(row.name)}</span>
            <span class="board-points">${formatCompact(row.points)}</span>
          </li>`
      )
      .join("");
  }
  renderBoardModal();
}

function renderBoardModal() {
  const body = document.getElementById("board-full");
  const note = document.getElementById("board-modal-rank");
  if (!board || !board.top.length) {
    body.innerHTML = `<tr><td colspan="3" class="board-empty">${escapeHtml(t("games.leaderboardEmpty"))}</td></tr>`;
    note.textContent = "";
    return;
  }
  const medals = ["🥇", "🥈", "🥉"];
  body.innerHTML = board.top
    .map(
      (row) => `<tr class="${isYou(row) ? "is-you" : ""}">
          <td class="board-rank">${medals[row.rank - 1] || row.rank}</td>
          <td>${escapeHtml(row.name)}${isYou(row) ? ` <span class="board-you">${escapeHtml(t("games.leaderboardYou"))}</span>` : ""}</td>
          <td class="board-points">${row.points.toLocaleString()}</td>
        </tr>`
    )
    .join("");
  note.textContent = board.you
    ? t("games.leaderboardYourRank", { rank: board.you.rank, points: board.you.points.toLocaleString() })
    : t("games.leaderboardUnranked");
}

const boardModal = document.getElementById("board-modal");
document.getElementById("board-open").addEventListener("click", () => boardModal.classList.add("open"));
document.getElementById("board-modal-close").addEventListener("click", () => boardModal.classList.remove("open"));
boardModal.addEventListener("click", (e) => {
  if (e.target === boardModal) boardModal.classList.remove("open");
});

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
// cooldown is still running it shows a live countdown and disables Save,
// so the player can see exactly why (and how long) instead of guessing.
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

document.getElementById("games-switch-btn").addEventListener("click", () => {
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
    account = await Account.set(raw, changeEdition, "games");
    closeNameModal();
    document.getElementById("hub-player-name").textContent = account.player;
    showToast(t("games.nameSaved", { name: account.player }));
    // Everything is keyed on the name, so both totals have to be re-read.
    await Promise.all([refreshDaily(), refreshBoard()]);
  } catch (err) {
    showToast(err.message);
    renderCooldownNote();
  } finally {
    btn.disabled = account ? Date.now() < account.canChangeAt : false;
  }
}

/* ---------------- Game cards ---------------- */
function playsFor(gameId) {
  return daily && daily.games[gameId] ? daily.games[gameId] : null;
}

function playsMarkup(gameId) {
  const p = playsFor(gameId);
  if (!p) return "";
  const out = p.playsLeft <= 0;
  const pips = Array.from({ length: p.playCap }, (_, i) => `<i class="${i < p.playsLeft ? "" : "spent"}"></i>`).join("");
  return `
    <div class="plays-left${out ? " none" : ""}">
      <div class="plays-pips">${pips}</div>
      <div class="plays-label">${escapeHtml(
        out ? t("games.noPlaysLeft") : t("games.playsLeft", { left: p.playsLeft, cap: p.playCap })
      )}</div>
    </div>`;
}

function renderGamesGrid() {
  document.getElementById("games-grid").innerHTML = Arcade.list
    .map((g) => {
      const p = playsFor(g.id);
      const out = p && p.playsLeft <= 0;
      return `
    <div class="item-card game-card${out ? " spent" : ""}">
      <div class="game-icon">${g.icon}</div>
      <div class="item-body">
        <h3>${escapeHtml(Arcade.name(g))}</h3>
        <p>${escapeHtml(Arcade.desc(g))}</p>
        ${playsMarkup(g.id)}
        <div class="item-actions">
          <button class="buy-btn" data-play="${g.id}"${out ? " disabled" : ""}>${escapeHtml(
            out ? t("games.noPlaysLeft") : t("games.play")
          )}</button>
        </div>
      </div>
    </div>`;
    })
    .join("");

  document
    .querySelectorAll("[data-play]")
    .forEach((b) => b.addEventListener("click", () => openGame(b.dataset.play)));
}

/* ---------------- Game shell ---------------- */
const overlay = document.getElementById("game-overlay");
const gameTitle = document.getElementById("game-title");
const gameBody = document.getElementById("game-body");

function closeGame() {
  clearInterval(countdownTimer);
  if (stopCurrentGame) {
    stopCurrentGame();
    stopCurrentGame = null;
  }
  activeGame = null;
  activeRoundId = null;
  overlay.classList.remove("open");
  gameBody.innerHTML = "";
  document.body.classList.remove("game-open");
}
document.getElementById("game-close").addEventListener("click", closeGame);

function openGame(id) {
  const game = Arcade.byId(id);
  if (!game) return;
  const p = playsFor(id);
  if (p && p.playsLeft <= 0) {
    showToast(t("games.noPlaysLeftToast"));
    return;
  }
  activeGame = game;
  overlay.classList.add("open");
  document.body.classList.add("game-open");
  gameTitle.textContent = `${game.icon} ${Arcade.name(game)}`;
  showIntro(game);
}

function showIntro(game) {
  if (stopCurrentGame) {
    stopCurrentGame();
    stopCurrentGame = null;
  }
  gameBody.innerHTML = `
    <div class="game-screen">
      <div class="game-screen-icon">${game.icon}</div>
      <h3>${escapeHtml(Arcade.name(game))}</h3>
      <p class="checkout-hint centered">${escapeHtml(Arcade.howTo(game))}</p>
      <p class="game-reward-note">${t("games.rewardNote")}</p>
      ${playsMarkup(game.id)}
      <button class="continue-btn game-go-btn" id="game-go">${escapeHtml(t("games.startBtn"))}</button>
    </div>`;
  document.getElementById("game-go").addEventListener("click", () => runGame(game));
}

async function runGame(game) {
  gameBody.innerHTML = `<p class="empty-note">${escapeHtml(t("buy.wait"))}</p>`;

  // Opening the round server-side is what burns one of the day's three plays,
  // so a player who closes the panel mid-game has still used one.
  activeRoundId = null;
  try {
    const started = await fetchJSON("/api/games/round/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId: game.id }),
    });
    activeRoundId = started.roundId;
    daily = started.daily;
    renderDaily();
    renderGamesGrid();
  } catch (err) {
    gameBody.innerHTML = `<div class="game-screen">
        <div class="game-screen-icon">🚫</div>
        <h3>${escapeHtml(t("games.cannotStart"))}</h3>
        <p class="checkout-hint centered">${escapeHtml(err.message)}</p>
        <button class="continue-btn game-go-btn" id="game-back">${escapeHtml(t("result.backToGames"))}</button>
      </div>`;
    document.getElementById("game-back").addEventListener("click", closeGame);
    return;
  }

  countdown(game, () => {
    gameBody.innerHTML = "";
    const mount = document.createElement("div");
    mount.className = "game-mount";
    gameBody.appendChild(mount);
    // Give the layout a frame to settle so canvas sizing measures correctly.
    requestAnimationFrame(() => {
      stopCurrentGame = game.start(mount, (result) => showResult(game, result));
    });
  });
}

// 3… 2… 1… GO! before every round, so nobody is caught mid-blink.
function countdown(game, onDone) {
  clearInterval(countdownTimer);
  let n = 3;
  gameBody.innerHTML = `
    <div class="game-screen countdown-screen">
      <div class="game-screen-icon">${game.icon}</div>
      <div class="countdown-number" id="countdown-number">3</div>
      <p class="checkout-hint centered">${escapeHtml(Arcade.howTo(game))}</p>
    </div>`;
  const node = document.getElementById("countdown-number");
  const tick = () => {
    n -= 1;
    if (!node.isConnected) return clearInterval(countdownTimer);
    if (n > 0) {
      node.textContent = n;
      node.classList.remove("pop");
      void node.offsetWidth; // restart the animation
      node.classList.add("pop");
    } else {
      clearInterval(countdownTimer);
      node.textContent = t("games.go");
      node.classList.add("go");
      setTimeout(onDone, 380);
    }
  };
  node.classList.add("pop");
  countdownTimer = setInterval(tick, 800);
}

async function showResult(game, result) {
  stopCurrentGame = null;
  const points = Number(result.points || 0);

  let payout = null;
  if (activeRoundId) {
    try {
      payout = await fetchJSON("/api/games/round/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundId: activeRoundId, points }),
      });
      daily = payout.daily;
      // Coins that reached the game itself bump the headline balance too.
      if (account && payout.delivered && payout.delivered.ok && typeof payout.delivered.balance === "number") {
        account.coins = payout.delivered.balance;
      } else if (account && typeof account.coins === "number") {
        account.coins += payout.coinsEarned;
      }
      renderDaily();
      renderGamesGrid();
      refreshBoard();
    } catch {
      payout = null;
    }
  }
  activeRoundId = null;

  const coins = payout ? payout.coinsEarned : 0;
  const capped = payout ? payout.daily.coinCapReached : false;

  const rows = (result.detail || [])
    .map(
      ([key, value]) =>
        `<div><span>${escapeHtml(t(key))}</span><strong>${escapeHtml(String(value))}</strong></div>`
    )
    .join("");

  gameBody.innerHTML = `
    <div class="game-screen result-screen">
      <div class="game-screen-icon">${coins >= 30 ? "🏆" : "🎉"}</div>
      <h3>${escapeHtml(capped ? t("games.dailyComplete") : t("result.headline"))}</h3>
      <div class="result-score">
        <span class="result-score-label">${escapeHtml(t("hud.points"))}</span>
        <span class="result-score-value">${points.toLocaleString()}</span>
      </div>
      <div class="coins-won">+${coins} <span>${escapeHtml(t("result.coinsEarned"))}</span></div>
      ${
        payout
          ? `<p class="checkout-hint centered">${escapeHtml(
              capped
                ? t("games.dailyCompleteNote")
                : t("games.earnedToday", {
                    earned: payout.daily.coinsEarned.toLocaleString(),
                    cap: payout.daily.coinCap.toLocaleString(),
                  })
            )}</p>`
          : `<p class="checkout-hint centered">${escapeHtml(t("result.saveFailed"))}</p>`
      }
      <div class="receipt result-detail">${rows}</div>
      <div class="result-actions">
        <button class="continue-btn" id="play-again">${escapeHtml(t("result.playAgain"))}</button>
        <button class="back-link" id="back-to-hub">${escapeHtml(t("result.backToGames"))}</button>
      </div>
    </div>`;

  const again = document.getElementById("play-again");
  const left = playsFor(game.id);
  if (left && left.playsLeft <= 0) {
    again.disabled = true;
    again.textContent = t("games.noPlaysLeft");
  } else {
    again.addEventListener("click", () => runGame(game));
  }
  document.getElementById("back-to-hub").addEventListener("click", closeGame);
}

// Esc closes whichever panel is open.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (overlay.classList.contains("open")) closeGame();
  else if (boardModal.classList.contains("open")) boardModal.classList.remove("open");
  else if (nameModal.classList.contains("open")) closeNameModal();
});

// A language switch mid-session: re-label the hub. A game that is actually
// being played is left alone so nobody loses a round to a mistyped tap.
document.addEventListener("i18n:change", () => {
  if (!account) return;
  renderChangeButton();
  renderDaily();
  renderBoard();
  renderGamesGrid();
  if (activeGame && !stopCurrentGame && overlay.classList.contains("open")) {
    gameTitle.textContent = `${activeGame.icon} ${Arcade.name(activeGame)}`;
  }
});

/* ---------------- Boot ---------------- */
(async function boot() {
  let cfg = null;
  try {
    cfg = await getSiteConfig();
  } catch {
    /* if the config call itself fails, fall through and let the gate try */
  }
  if (cfg && cfg.angkorlinkEnabled === false) {
    gate.hidden = true;
    const box = document.getElementById("games-unavailable");
    box.hidden = false;
    if (cfg.supportTelegram) {
      const line = document.getElementById("games-unavailable-support");
      line.hidden = false;
      line.innerHTML = `<a href="https://t.me/${encodeURIComponent(cfg.supportTelegram)}" target="_blank" rel="noopener">${escapeHtml(
        t("checkout.contactSupport")
      )}</a>`;
    }
    return;
  }

  account = await Account.load("games");
  if (account && account.player) return openHub();
  updatePreview();
})();
