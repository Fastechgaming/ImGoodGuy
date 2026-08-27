// Games page. Players enter their Minecraft name, then get a hub with
// Playtime / Coins and three playable mini-games.
//
// NOTHING IS PERSISTED TO A DATABASE YET, by design: the session (name +
// coins earned) lives in sessionStorage only, so a refresh doesn't kick the
// player back to the form. When the real backend lands, replace the `Session`
// object below with API calls and wire Withdraw to an RCON `eco give`.
const SESSION_KEY = "angkorsmp-games-session";

const gate = document.getElementById("games-gate");
const hub = document.getElementById("games-hub");
const nameInput = document.getElementById("games-name");
const namePreview = document.getElementById("games-name-preview");
const startBtn = document.getElementById("games-start-btn");

let edition = "java";
let tickTimer = null;
let session = null;
let stopCurrentGame = null;

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
  namePreview.textContent = shown ? `In server name: ${shown}` : "";
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
    showToast(
      edition === "bedrock"
        ? "Enter a valid Bedrock gamertag (letters, numbers, spaces or underscores)."
        : "Enter a valid Java username (letters, numbers, underscore)."
    );
    return;
  }
  const fresh = {
    playerName: normalizeServerName(raw, edition),
    edition,
    startedAt: Date.now(),
    coins: 0,
    played: 0,
  };
  Session.write(fresh);
  openHub(fresh);
}

/* ---------------- Hub ---------------- */
function refreshStats() {
  document.getElementById("stat-coins").textContent = Number(session.coins || 0).toLocaleString();
}

function openHub(data) {
  session = data;
  gate.hidden = true;
  hub.hidden = false;
  document.getElementById("hub-player-name").textContent = session.playerName;
  refreshStats();
  renderGamesGrid();

  const tick = () => {
    const secs = Math.max(0, Math.floor((Date.now() - session.startedAt) / 1000));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    document.getElementById("stat-playtime").textContent = h ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
  };
  tick();
  clearInterval(tickTimer);
  tickTimer = setInterval(tick, 1000);
}

document.getElementById("games-switch-btn").addEventListener("click", () => {
  clearInterval(tickTimer);
  Session.clear();
  session = null;
  hub.hidden = true;
  gate.hidden = false;
  nameInput.value = "";
  updatePreview();
  nameInput.focus();
});

function renderGamesGrid() {
  document.getElementById("games-grid").innerHTML = Arcade.list
    .map(
      (g) => `
    <div class="item-card game-card">
      <div class="game-icon">${g.icon}</div>
      <div class="item-body">
        <h3>${escapeHtml(g.name)}</h3>
        <p>${escapeHtml(g.desc)}</p>
        <div class="item-actions">
          <button class="buy-btn" data-play="${g.id}">Play</button>
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
  overlay.classList.remove("open");
  gameBody.innerHTML = "";
  document.body.classList.remove("game-open");
}
document.getElementById("game-close").addEventListener("click", closeGame);

function openGame(id) {
  const game = Arcade.byId(id);
  if (!game) return;
  overlay.classList.add("open");
  document.body.classList.add("game-open");
  gameTitle.textContent = `${game.icon} ${game.name}`;
  showIntro(game);
}

function showIntro(game) {
  if (stopCurrentGame) { stopCurrentGame(); stopCurrentGame = null; }
  gameBody.innerHTML = `
    <div class="game-screen">
      <div class="game-screen-icon">${game.icon}</div>
      <h3>${escapeHtml(game.name)}</h3>
      <p class="checkout-hint centered">${escapeHtml(game.howTo)}</p>
      <p class="game-reward-note">Earn <strong>500 – 5,000 coins</strong> based on how well you do.</p>
      <button class="continue-btn game-go-btn" id="game-go">Start</button>
    </div>`;
  document.getElementById("game-go").addEventListener("click", () => runGame(game));
}

function runGame(game) {
  gameBody.innerHTML = "";
  const mount = document.createElement("div");
  mount.className = "game-mount";
  gameBody.appendChild(mount);
  // Give the layout a frame to settle so canvas sizing measures correctly.
  requestAnimationFrame(() => {
    stopCurrentGame = game.start(mount, (result) => showResult(game, result));
  });
}

function showResult(game, result) {
  stopCurrentGame = null;
  // Coins are added to the in-page session only - nothing is written to a DB.
  if (session) {
    session.coins = Number(session.coins || 0) + Number(result.coins || 0);
    session.played = Number(session.played || 0) + 1;
    Session.write(session);
    refreshStats();
  }

  const rows = (result.detail || [])
    .map(([k, v]) => `<div><span>${escapeHtml(k)}</span><strong>${escapeHtml(String(v))}</strong></div>`)
    .join("");

  gameBody.innerHTML = `
    <div class="game-screen result-screen">
      <div class="game-screen-icon">${result.coins >= 5000 ? "🏆" : "🎉"}</div>
      <h3>${escapeHtml(Arcade.rankLabel(result.coins))}</h3>
      <div class="result-score">
        <span class="result-score-label">${escapeHtml(result.scoreLabel || "Score")}</span>
        <span class="result-score-value">${escapeHtml(String(result.score))}</span>
      </div>
      <div class="coins-won">+${Number(result.coins).toLocaleString()} <span>coins</span></div>
      <div class="receipt result-detail">${rows}</div>
      <div class="result-actions">
        <button class="continue-btn" id="play-again">Play Again</button>
        <button class="back-link" id="back-to-hub">&larr; Back to games</button>
      </div>
    </div>`;

  document.getElementById("play-again").addEventListener("click", () => runGame(game));
  document.getElementById("back-to-hub").addEventListener("click", closeGame);
}

// Esc closes the game panel.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && overlay.classList.contains("open")) closeGame();
});

/* ---------------- Boot ---------------- */
const existing = Session.read();
if (existing && existing.playerName) openHub(existing);
