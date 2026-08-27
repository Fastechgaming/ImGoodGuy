// Games page (preview). Players enter their Minecraft name, then see a hub with
// Playtime and Coins.
//
// NOTHING IS PERSISTED YET, by design: the name lives in sessionStorage only so
// a refresh doesn't kick you back to the form, and playtime is counted from when
// this tab's session started. When the real games land, swap `Session` below for
// calls to a proper backend + database.
const SESSION_KEY = "angkorsmp-games-session";

const gate = document.getElementById("games-gate");
const hub = document.getElementById("games-hub");
const nameInput = document.getElementById("games-name");
const namePreview = document.getElementById("games-name-preview");
const startBtn = document.getElementById("games-start-btn");

let edition = "java";
let tickTimer = null;

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

/* ---------------- Placeholder game line-up ---------------- */
const GAMES = [
  { icon: "⛏️", name: "Temple Miner", desc: "Dig through Angkor ruins for buried treasure." },
  { icon: "🐝", name: "Bee Rush", desc: "Guide the hive home before the rain arrives." },
  { icon: "🎯", name: "Archer Trial", desc: "Hit the targets before the timer runs out." },
  { icon: "🧩", name: "Khmer Puzzle", desc: "Rebuild the carvings tile by tile." },
];

function renderGamesGrid() {
  document.getElementById("games-grid").innerHTML = GAMES.map(
    (g) => `
    <div class="item-card coming-soon game-card">
      <div class="game-icon">${escapeHtml(g.icon)}</div>
      <div class="item-body">
        <h3>${escapeHtml(g.name)}</h3>
        <p>${escapeHtml(g.desc)}</p>
        <div class="item-actions">
          <button class="buy-btn" disabled>Coming Soon</button>
        </div>
      </div>
    </div>`
  ).join("");
}

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
  const session = {
    playerName: normalizeServerName(raw, edition),
    edition,
    startedAt: Date.now(),
    coins: 0,
  };
  Session.write(session);
  openHub(session);
}

/* ---------------- Hub ---------------- */
function openHub(session) {
  gate.hidden = true;
  hub.hidden = false;
  document.getElementById("hub-player-name").textContent = session.playerName;
  document.getElementById("stat-coins").textContent = Number(session.coins || 0).toLocaleString();
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
  hub.hidden = true;
  gate.hidden = false;
  nameInput.value = "";
  updatePreview();
  nameInput.focus();
});

// Resume the session on refresh so the name form doesn't reappear mid-play.
const existing = Session.read();
if (existing && existing.playerName) openHub(existing);
else renderGamesGrid();
