// Games page: name gate -> hub -> mini-game -> result.
//
// Points are scored in the browser; COINS are not. Every round is opened and
// closed against /api/games, which is where the 500-coins-per-game-per-day and
// 2,500-coins-per-day limits actually live. The page only displays what the
// server says it awarded.
//
// The name + this visit's points live in sessionStorage so a refresh doesn't
// kick the player back to the form. The daily coin totals always come fresh
// from the server.
const SESSION_KEY = "angkorsmp-games-session";

const gate = document.getElementById("games-gate");
const hub = document.getElementById("games-hub");
const nameInput = document.getElementById("games-name");
const namePreview = document.getElementById("games-name-preview");
const startBtn = document.getElementById("games-start-btn");

let edition = "java";
let session = null;
let daily = null; // last /api/games/daily payload
let resetTimer = null;
let stopCurrentGame = null;
let activeGame = null;
let activeRoundId = null;

const Session = {
  read() {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    } catch {
      return null;
    }
  },
  write(data) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
    } catch {
      /* private mode - the hub still works, it just won't survive a refresh */
    }
  },
  clear() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* nothing to clear */
    }
  },
};

/* ---------------- Name gate ---------------- */
function updatePreview() {
  const shown = normalizeServerName(nameInput.value, edition);
  namePreview.textContent = shown ? t("buy.inServerName", { name: shown }) : "";
}

nameInput.addEventListener("input", updatePreview);
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") startSession();
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

startBtn.addEventListener("click", startSession);

function startSession() {
  const raw = nameInput.value.trim();
  if (!isValidRawName(raw, edition)) {
    showToast(t(edition === "bedrock" ? "buy.invalidBedrock" : "buy.invalidJava"));
    return;
  }
  const fresh = {
    playerName: normalizeServerName(raw, edition),
    edition,
    points: 0,
    rounds: 0,
  };
  Session.write(fresh);
  openHub(fresh);
}

/* ---------------- Hub ---------------- */
async function openHub(data) {
  session = data;
  gate.hidden = true;
  hub.hidden = false;
  document.getElementById("hub-player-name").textContent = session.playerName;
  renderSessionStats();
  renderGamesGrid();
  await refreshDaily();
}

function renderSessionStats() {
  document.getElementById("stat-points").textContent = Number(session.points || 0).toLocaleString();
  document.getElementById("stat-rounds").textContent = Number(session.rounds || 0).toLocaleString();
}

async function refreshDaily() {
  try {
    daily = await fetchJSON(`/api/games/daily?player=${encodeURIComponent(session.playerName)}`);
  } catch {
    daily = null;
  }
  renderDaily();
  renderGamesGrid();
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
    const left = Math.max(0, daily.resetAt - Date.now());
    const hours = Math.floor(left / 3600000);
    const mins = Math.floor((left % 3600000) / 60000);
    node.textContent = t("games.resetsIn", { time: hours ? `${hours}h ${mins}m` : `${mins}m` });
    if (left === 0) refreshDaily(); // rolled past midnight while the tab was open
  };
  tick();
  resetTimer = setInterval(tick, 30000);
}

document.getElementById("games-switch-btn").addEventListener("click", () => {
  clearInterval(resetTimer);
  Session.clear();
  session = null;
  daily = null;
  hub.hidden = true;
  gate.hidden = false;
  nameInput.value = "";
  updatePreview();
  nameInput.focus();
});

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
      body: JSON.stringify({ player: session.playerName, edition: session.edition, gameId: game.id }),
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

  if (session) {
    session.points = Number(session.points || 0) + points;
    session.rounds = Number(session.rounds || 0) + 1;
    Session.write(session);
    renderSessionStats();
  }

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

// Esc closes the game panel.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && overlay.classList.contains("open")) closeGame();
});

// A language switch mid-session: re-label the hub. A game that is actually
// being played is left alone so nobody loses a round to a mistyped tap.
document.addEventListener("i18n:change", () => {
  if (!session) return;
  renderDaily();
  renderGamesGrid();
  if (activeGame && !stopCurrentGame && overlay.classList.contains("open")) {
    gameTitle.textContent = `${activeGame.icon} ${Arcade.name(activeGame)}`;
  }
});

/* ---------------- Boot ---------------- */
const existing = Session.read();
if (existing && existing.playerName) openHub(existing);
