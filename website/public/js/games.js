// Games page: name gate -> hub -> mini-game -> result.
//
// Points are scored in the browser; COINS are not. Every round is opened and
// closed against /api/games, which is where the 500-coins-per-game-per-day and
// 2,500-coins-per-day limits actually live. The page only displays what the
// server says it awarded.
//
// The player's name is held in a signed cookie by the server, so this page asks
// for it exactly once and then remembers it forever. Changing it is rate
// limited to once every 24 hours, server-side, which is what stops someone
// farming a fresh daily allowance under a new name every few minutes.

const gate = document.getElementById("games-gate");
const hub = document.getElementById("games-hub");
const nameInput = document.getElementById("games-name");
const namePreview = document.getElementById("games-name-preview");
const startBtn = document.getElementById("games-start-btn");

let edition = "java";
let account = null;  // { player, edition, canChange, canChangeAt }
let daily = null;    // last /api/games/daily payload
let board = null;    // last /api/games/leaderboard payload
let sessionPoints = 0;
let sessionRounds = 0;
let resetTimer = null;
let stopCurrentGame = null;
let activeGame = null;
let activeRoundId = null;

/* ---------------- helpers ---------------- */
function humanDuration(ms) {
  const total = Math.max(0, Math.ceil(ms / 60000));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return hours ? `${hours}h ${mins}m` : `${mins}m`;
}

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
    account = await fetchJSON("/api/games/player", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player: raw, edition }),
    });
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
  renderSessionStats();
  renderChangeButton();
  renderGamesGrid();
  await Promise.all([refreshDaily(), refreshBoard()]);
}

function renderSessionStats() {
  document.getElementById("stat-points").textContent = sessionPoints.toLocaleString();
  document.getElementById("stat-rounds").textContent = sessionRounds.toLocaleString();
}

// Outside the cooldown the button opens the change dialog; inside it, it just
// shows how long is left.
function renderChangeButton() {
  const btn = document.getElementById("games-switch-btn");
  btn.removeAttribute("data-i18n");
  const left = account ? account.canChangeAt - Date.now() : 0;
  if (account && left > 0) {
    btn.textContent = t("games.changeLocked", { time: humanDuration(left) });
    btn.classList.add("locked");
  } else {
    btn.textContent = t("games.changeName");
    btn.classList.remove("locked");
  }
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
  const cap = document.getElementById("stat-coins-cap");
  const reset = document.getElementById("stat-reset");
  if (!daily) {
    coins.textContent = "—";
    cap.textContent = "—";
    reset.textContent = "";
    return;
  }
  coins.textContent = daily.total.toLocaleString();
  cap.textContent = t("games.dailyLimit", { cap: daily.totalCap.toLocaleString() });
  startResetCountdown(reset);
}

// Live "Resets in 6h 12m" under the daily coin total.
function startResetCountdown(node) {
  clearInterval(resetTimer);
  const tick = () => {
    if (!daily) return;
    node.textContent = t("games.resetsIn", { time: humanDuration(daily.resetAt - Date.now()) });
    renderChangeButton(); // the name lock counts down on the same clock
    if (daily.resetAt - Date.now() <= 0) refreshDaily();
  };
  tick();
  resetTimer = setInterval(tick, 30000);
}

/* ---------------- Leaderboard ---------------- */
function boardRowName(row) {
  const isYou = account && row.name.toLowerCase() === account.player.toLowerCase();
  return `${escapeHtml(row.name)}${isYou ? ` <span class="board-you">${escapeHtml(t("games.leaderboardYou"))}</span>` : ""}`;
}

function renderBoard() {
  const top5 = document.getElementById("board-top5");
  const yourRank = document.getElementById("board-your-rank");
  if (!board || !board.top.length) {
    top5.innerHTML = `<li class="board-empty">${escapeHtml(t("games.leaderboardEmpty"))}</li>`;
    yourRank.textContent = "";
  } else {
    const medals = ["🥇", "🥈", "🥉"];
    top5.innerHTML = board.top
      .slice(0, 5)
      .map((row) => {
        const you = account && row.name.toLowerCase() === account.player.toLowerCase();
        return `<li class="board-row${you ? " is-you" : ""}">
            <span class="board-rank">${medals[row.rank - 1] || `#${row.rank}`}</span>
            <span class="board-name">${boardRowName(row)}</span>
            <span class="board-points">${row.points.toLocaleString()}</span>
          </li>`;
      })
      .join("");
    yourRank.textContent = board.you
      ? t("games.leaderboardYourRank", { rank: board.you.rank, points: board.you.points.toLocaleString() })
      : t("games.leaderboardUnranked");
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
    .map((row) => {
      const you = account && row.name.toLowerCase() === account.player.toLowerCase();
      return `<tr class="${you ? "is-you" : ""}">
          <td class="board-rank">${medals[row.rank - 1] || row.rank}</td>
          <td>${boardRowName(row)}</td>
          <td class="board-points">${row.points.toLocaleString()}</td>
        </tr>`;
    })
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

/* ---------------- Change name (once a day) ---------------- */
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

document.getElementById("games-switch-btn").addEventListener("click", () => {
  const left = account ? account.canChangeAt - Date.now() : 0;
  if (left > 0) {
    showToast(t("games.nameLockedToast", { time: humanDuration(left) }));
    return;
  }
  changeEdition = account ? account.edition : "java";
  document
    .querySelectorAll("#change-edition [data-edition]")
    .forEach((b) => b.classList.toggle("active", b.dataset.edition === changeEdition));
  changeInput.value = "";
  updateChangePreview();
  nameModal.classList.add("open");
  changeInput.focus();
});

function closeNameModal() {
  nameModal.classList.remove("open");
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
  const raw = changeInput.value.trim();
  if (!isValidRawName(raw, changeEdition)) {
    showToast(t(changeEdition === "bedrock" ? "buy.invalidBedrock" : "buy.invalidJava"));
    return;
  }
  const btn = document.getElementById("change-name-save");
  btn.disabled = true;
  try {
    account = await fetchJSON("/api/games/player", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player: raw, edition: changeEdition }),
    });
    closeNameModal();
    document.getElementById("hub-player-name").textContent = account.player;
    showToast(t("games.nameSaved", { name: account.player }));
    renderChangeButton();
    // Everything is keyed on the name, so both totals have to be re-read.
    await Promise.all([refreshDaily(), refreshBoard()]);
  } catch (err) {
    showToast(err.message);
  } finally {
    btn.disabled = false;
  }
}

/* ---------------- Game cards ---------------- */
// { earned, cap, complete } for one game, or null before the first fetch.
function progressFor(gameId) {
  if (!daily || !daily.games[gameId]) return null;
  const row = daily.games[gameId];
  return { earned: row.earned, cap: row.cap, complete: row.earned >= row.cap };
}

function progressMarkup(gameId) {
  const p = progressFor(gameId);
  if (!p) return "";
  const pct = Math.round((p.earned / p.cap) * 100);
  const label = p.complete
    ? t("games.dailyCompleteFull", { cap: p.cap.toLocaleString() })
    : t("games.todaysReward", { earned: p.earned.toLocaleString(), cap: p.cap.toLocaleString() });
  return `
    <div class="daily-progress${p.complete ? " complete" : ""}">
      <div class="daily-progress-label">${escapeHtml(label)}</div>
      <div class="daily-bar"><i style="width:${pct}%"></i></div>
      ${p.complete ? `<div class="daily-progress-note">${escapeHtml(t("games.dailyCompleteNote"))}</div>` : ""}
    </div>`;
}

function renderGamesGrid() {
  document.getElementById("games-grid").innerHTML = Arcade.list
    .map(
      (g) => `
    <div class="item-card game-card">
      <div class="game-icon">${g.icon}</div>
      <div class="item-body">
        <h3>${escapeHtml(Arcade.name(g))}</h3>
        <p>${escapeHtml(Arcade.desc(g))}</p>
        ${progressMarkup(g.id)}
        <div class="item-actions">
          <button class="buy-btn" data-play="${g.id}">${escapeHtml(t("games.play"))}</button>
        </div>
      </div>
    </div>`
    )
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
      ${progressMarkup(game.id)}
      <button class="continue-btn game-go-btn" id="game-go">${escapeHtml(t("games.startBtn"))}</button>
    </div>`;
  document.getElementById("game-go").addEventListener("click", () => runGame(game));
}

async function runGame(game) {
  gameBody.innerHTML = `<p class="empty-note">${escapeHtml(t("buy.wait"))}</p>`;

  // Ask the server to open the round first — that's the clock the payout is
  // checked against. If it fails the game still runs, just without coins.
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
  } catch {
    activeRoundId = null;
  }

  gameBody.innerHTML = "";
  const mount = document.createElement("div");
  mount.className = "game-mount";
  gameBody.appendChild(mount);
  // Give the layout a frame to settle so canvas sizing measures correctly.
  requestAnimationFrame(() => {
    stopCurrentGame = game.start(mount, (result) => showResult(game, result));
  });
}

async function showResult(game, result) {
  stopCurrentGame = null;
  const points = Number(result.points || 0);
  sessionPoints += points;
  sessionRounds += 1;
  renderSessionStats();

  // Cash the round in. Everything shown below comes back from the server.
  let payout = null;
  if (activeRoundId) {
    try {
      payout = await fetchJSON("/api/games/round/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundId: activeRoundId, points }),
      });
      daily = payout.daily;
      renderDaily();
      renderGamesGrid();
      refreshBoard();
    } catch {
      payout = null;
    }
  }
  activeRoundId = null;

  const coins = payout ? payout.coinsEarned : 0;
  const complete = payout ? payout.dailyComplete : false;

  const rows = (result.detail || [])
    .map(
      ([key, value]) =>
        `<div><span>${escapeHtml(t(key))}</span><strong>${escapeHtml(String(value))}</strong></div>`
    )
    .join("");

  gameBody.innerHTML = `
    <div class="game-screen result-screen">
      <div class="game-screen-icon">${complete ? "🏆" : "🎉"}</div>
      <h3>${escapeHtml(complete ? t("games.dailyComplete") : t("result.headline"))}</h3>
      <div class="result-score">
        <span class="result-score-label">${escapeHtml(t("hud.points"))}</span>
        <span class="result-score-value">${points.toLocaleString()}</span>
      </div>
      <div class="coins-won">+${coins.toLocaleString()} <span>${escapeHtml(t("result.coinsEarned"))}</span></div>
      ${payout ? progressMarkup(game.id) : `<p class="checkout-hint centered">${escapeHtml(t("result.saveFailed"))}</p>`}
      <div class="receipt result-detail">${rows}</div>
      <div class="result-actions">
        <button class="continue-btn" id="play-again">${escapeHtml(t("result.playAgain"))}</button>
        <button class="back-link" id="back-to-hub">${escapeHtml(t("result.backToGames"))}</button>
      </div>
    </div>`;

  document.getElementById("play-again").addEventListener("click", () => runGame(game));
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
  try {
    const known = await fetchJSON("/api/games/player");
    if (known && known.player) {
      account = known;
      await openHub();
      return;
    }
  } catch {
    /* no server / no cookie - fall through to the name form */
  }
  updatePreview();
})();
