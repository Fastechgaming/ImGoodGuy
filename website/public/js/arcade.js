/* =============================================================
   AngkorSMP arcade — three self-contained mini-games.

   Every game follows the same contract so the hub can launch any of
   them the same way:

     Arcade.games[id] = {
       id, icon, name, desc,
       howTo: "one line of instructions",
       start(mount, onFinish)   // render into `mount`, call onFinish(result)
     }

   `onFinish` receives { score, scoreLabel, coins, detail[] } and the hub
   draws the shared results screen from it.

   Rewards are the same everywhere: 500 coins minimum, 5,000 for a
   perfect run, stepped by how well the player did.
   ============================================================= */
const Arcade = (() => {
  const MIN_COINS = 500;
  const MAX_COINS = 5000;

  // fraction (0..1) -> coins, in the tiers the brief asked for
  function rewardFor(fraction) {
    const f = Math.max(0, Math.min(1, Number(fraction) || 0));
    if (f >= 1) return 5000;
    if (f >= 0.8) return 4000;
    if (f >= 0.6) return 3000;
    if (f >= 0.4) return 2000;
    if (f >= 0.2) return 1000;
    return MIN_COINS;
  }

  function rankLabel(coins) {
    return (
      { 500: "Keep trying!", 1000: "Okay", 2000: "Good", 3000: "Great", 4000: "Excellent", 5000: "PERFECT!" }[coins] ||
      "Nice"
    );
  }

  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };

  // A countdown shared by the timed games. Returns a stop() handle.
  function countdown(seconds, onTick, onDone) {
    const endAt = performance.now() + seconds * 1000;
    let raf = 0;
    let stopped = false;
    const step = () => {
      if (stopped) return;
      const left = Math.max(0, (endAt - performance.now()) / 1000);
      onTick(left);
      if (left <= 0) return onDone();
      raf = requestAnimationFrame(step);
    };
    step();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }

  function hud(items) {
    const bar = el("div", "game-hud");
    const refs = {};
    items.forEach(({ key, label, value }) => {
      const cell = el("div", "hud-cell");
      cell.appendChild(el("span", "hud-label", label));
      const v = el("span", "hud-value", value);
      cell.appendChild(v);
      bar.appendChild(cell);
      refs[key] = v;
    });
    return { bar, refs };
  }

  /* ==========================================================
     1. TNT ESCAPE — 60s survival on a canvas arena
     ========================================================== */
  const tntEscape = {
    id: "tnt-escape",
    icon: "💥",
    name: "TNT Escape",
    desc: "Dodge falling TNT for as long as you can.",
    howTo: "Move with WASD / arrow keys, or drag your finger. Survive 60 seconds!",
    start(mount, onFinish) {
      const DURATION = 60;
      const { bar, refs } = hud([
        { key: "time", label: "Survived", value: "0.0s" },
        { key: "left", label: "Left", value: "60.0s" },
        { key: "tnt", label: "Dodged", value: "0" },
      ]);
      mount.appendChild(bar);

      const stage = el("div", "game-stage");
      const canvas = el("canvas", "game-canvas");
      stage.appendChild(canvas);
      mount.appendChild(stage);
      mount.appendChild(el("p", "game-hint", "WASD / arrows to move &middot; drag on touch"));

      const ctx = canvas.getContext("2d");
      let W = 0, H = 0, dpr = 1;
      function resize() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        const r = stage.getBoundingClientRect();
        W = r.width; H = r.height;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        canvas.style.width = W + "px";
        canvas.style.height = H + "px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      resize();
      window.addEventListener("resize", resize);

      const player = { x: W / 2, y: H / 2, r: 13, speed: 235 };
      const keys = new Set();
      let touchTarget = null;
      const bombs = [];
      const blasts = [];
      let dodged = 0;
      let survived = 0;
      let running = true;
      let spawnAcc = 0;

      const onKeyDown = (e) => {
        if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "].includes(e.key)) e.preventDefault();
        keys.add(e.key.toLowerCase());
      };
      const onKeyUp = (e) => keys.delete(e.key.toLowerCase());
      window.addEventListener("keydown", onKeyDown, { passive: false });
      window.addEventListener("keyup", onKeyUp);

      const pointTo = (e) => {
        const r = canvas.getBoundingClientRect();
        const p = e.touches ? e.touches[0] : e;
        touchTarget = { x: p.clientX - r.left, y: p.clientY - r.top };
      };
      canvas.addEventListener("pointerdown", pointTo);
      canvas.addEventListener("pointermove", (e) => { if (e.buttons || e.pointerType === "touch") pointTo(e); });
      canvas.addEventListener("pointerup", () => (touchTarget = null));
      canvas.addEventListener("touchmove", (e) => { e.preventDefault(); pointTo(e); }, { passive: false });

      function spawnBomb() {
        // Harder over time: shorter fuse, bigger blast.
        const t = survived / DURATION;
        const margin = 26;
        bombs.push({
          x: margin + Math.random() * Math.max(1, W - margin * 2),
          y: margin + Math.random() * Math.max(1, H - margin * 2),
          fuse: 1.5 - t * 0.75,          // 1.5s down to 0.75s
          radius: 52 + t * 34,           // 52px up to 86px
          age: 0,
        });
      }

      let last = performance.now();
      let raf = 0;

      function finish(reason) {
        if (!running) return;
        running = false;
        cancelAnimationFrame(raf);
        stopTimer();
        cleanup();
        const fraction = Math.min(1, survived / DURATION);
        const coins = rewardFor(fraction);
        onFinish({
          score: survived.toFixed(1) + "s",
          scoreLabel: "Survived",
          coins,
          detail: [
            ["Time survived", survived.toFixed(1) + "s / " + DURATION + "s"],
            ["TNT dodged", String(dodged)],
            ["Result", reason],
          ],
        });
      }

      const stopTimer = countdown(
        DURATION,
        (left) => {
          if (!running) return;
          survived = DURATION - left;
          refs.time.textContent = survived.toFixed(1) + "s";
          refs.left.textContent = left.toFixed(1) + "s";
        },
        () => finish("Survived the full run!")
      );

      function loop(now) {
        if (!running) return;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;

        // --- movement ---
        let dx = 0, dy = 0;
        if (keys.has("arrowleft") || keys.has("a")) dx -= 1;
        if (keys.has("arrowright") || keys.has("d")) dx += 1;
        if (keys.has("arrowup") || keys.has("w")) dy -= 1;
        if (keys.has("arrowdown") || keys.has("s")) dy += 1;
        if (touchTarget) {
          const tx = touchTarget.x - player.x, ty = touchTarget.y - player.y;
          const d = Math.hypot(tx, ty);
          if (d > 4) { dx = tx / d; dy = ty / d; }
        }
        const len = Math.hypot(dx, dy) || 1;
        player.x += (dx / len) * player.speed * dt;
        player.y += (dy / len) * player.speed * dt;
        player.x = Math.max(player.r, Math.min(W - player.r, player.x));
        player.y = Math.max(player.r, Math.min(H - player.r, player.y));

        // --- spawn rate ramps up ---
        const rate = 1.5 + (survived / DURATION) * 3.5; // 1.5/s -> 5/s
        spawnAcc += dt * rate;
        while (spawnAcc >= 1) { spawnBomb(); spawnAcc -= 1; }

        // --- bombs ---
        for (let i = bombs.length - 1; i >= 0; i--) {
          const b = bombs[i];
          b.age += dt;
          if (b.age >= b.fuse) {
            blasts.push({ x: b.x, y: b.y, radius: b.radius, age: 0 });
            const hit = Math.hypot(player.x - b.x, player.y - b.y) < b.radius + player.r * 0.35;
            bombs.splice(i, 1);
            if (hit) { draw(); return finish("Caught in a blast!"); }
            dodged++;
            refs.tnt.textContent = String(dodged);
          }
        }
        for (let i = blasts.length - 1; i >= 0; i--) {
          blasts[i].age += dt;
          if (blasts[i].age > 0.35) blasts.splice(i, 1);
        }

        draw();
        raf = requestAnimationFrame(loop);
      }

      function draw() {
        ctx.clearRect(0, 0, W, H);
        // grass-ish arena grid
        ctx.fillStyle = "#2f5a2a";
        ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = "rgba(0,0,0,0.12)";
        ctx.lineWidth = 1;
        for (let x = 0; x < W; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
        for (let y = 0; y < H; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

        // blast rings
        blasts.forEach((b) => {
          const p = b.age / 0.35;
          ctx.globalAlpha = 1 - p;
          ctx.fillStyle = "#ffb347";
          ctx.beginPath(); ctx.arc(b.x, b.y, b.radius * (0.6 + p * 0.6), 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
        });

        // tnt blocks (flash faster as the fuse burns down)
        bombs.forEach((b) => {
          const p = b.age / b.fuse;
          const flash = Math.sin(b.age * (8 + p * 26)) > 0;
          const s = 22;
          ctx.fillStyle = flash ? "#ff5a3c" : "#c0392b";
          ctx.fillRect(b.x - s / 2, b.y - s / 2, s, s);
          ctx.fillStyle = "#f5f0e6";
          ctx.fillRect(b.x - s / 2, b.y - 4, s, 8);
          ctx.fillStyle = "#2a1608";
          ctx.font = "bold 7px monospace";
          ctx.textAlign = "center";
          ctx.fillText("TNT", b.x, b.y + 2.5);
          // danger radius preview
          ctx.strokeStyle = `rgba(255,90,60,${0.15 + p * 0.5})`;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2); ctx.stroke();
        });

        // player (little steve head)
        ctx.fillStyle = "#8a5a3b";
        ctx.fillRect(player.x - player.r, player.y - player.r, player.r * 2, player.r * 2);
        ctx.fillStyle = "#f0c9a0";
        ctx.fillRect(player.x - player.r, player.y - 2, player.r * 2, 9);
        ctx.fillStyle = "#fff";
        ctx.fillRect(player.x - 8, player.y - 1, 5, 5);
        ctx.fillRect(player.x + 3, player.y - 1, 5, 5);
        ctx.fillStyle = "#2b4c8c";
        ctx.fillRect(player.x - 7, player.y, 3, 3);
        ctx.fillRect(player.x + 4, player.y, 3, 3);
      }

      function cleanup() {
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        window.removeEventListener("resize", resize);
      }

      raf = requestAnimationFrame(loop);
      return () => { running = false; cancelAnimationFrame(raf); stopTimer(); cleanup(); };
    },
  };

  /* ==========================================================
     2. CREEPER CLICK — 45s reaction test
     ========================================================== */
  const creeperClick = {
    id: "creeper-click",
    icon: "💣",
    name: "Creeper Click",
    desc: "Tap the creepers before they blow up.",
    howTo: "Click or tap every creeper you see. Charged (blue) ones are worth 3!",
    start(mount, onFinish) {
      const DURATION = 45;
      const TARGET_SCORE = 60; // a strong run; hitting this = perfect payout

      const { bar, refs } = hud([
        { key: "left", label: "Time", value: "45.0s" },
        { key: "killed", label: "Defeated", value: "0" },
        { key: "combo", label: "Combo", value: "x1" },
        { key: "score", label: "Score", value: "0" },
      ]);
      mount.appendChild(bar);

      const stage = el("div", "game-stage creeper-stage");
      mount.appendChild(stage);
      mount.appendChild(el("p", "game-hint", "Missing a creeper breaks your combo &middot; empty clicks cost a point"));

      let score = 0, killed = 0, combo = 0, best = 0, running = true;
      const live = new Set();
      let spawnTimer = null;

      const setHud = () => {
        refs.killed.textContent = String(killed);
        refs.combo.textContent = "x" + Math.max(1, combo);
        refs.score.textContent = String(Math.max(0, score));
      };

      function floatText(x, y, text, cls) {
        const f = el("span", "float-text " + (cls || ""), text);
        f.style.left = x + "px";
        f.style.top = y + "px";
        stage.appendChild(f);
        setTimeout(() => f.remove(), 700);
      }

      // Clicking empty ground is a small penalty.
      stage.addEventListener("pointerdown", (e) => {
        if (!running || e.target !== stage) return;
        score = Math.max(0, score - 1);
        combo = 0;
        const r = stage.getBoundingClientRect();
        floatText(e.clientX - r.left, e.clientY - r.top, "-1", "bad");
        setHud();
      });

      function spawn() {
        if (!running) return;
        const charged = Math.random() < 0.22;
        const size = charged ? 66 : 58;
        const r = stage.getBoundingClientRect();
        const c = el("button", "creeper" + (charged ? " charged" : ""));
        c.type = "button";
        c.style.width = c.style.height = size + "px";
        c.style.left = Math.random() * Math.max(1, r.width - size) + "px";
        c.style.top = Math.random() * Math.max(1, r.height - size) + "px";
        c.innerHTML = `
          <span class="creeper-face">
            <i></i><i></i>
            <b></b>
          </span>`;
        c.setAttribute("aria-label", charged ? "Charged creeper" : "Creeper");

        // Later creepers stay up for less time.
        const elapsed = DURATION - remaining;
        const life = Math.max(680, 1500 - elapsed * 18);
        let done = false;

        const hit = (e) => {
          e.stopPropagation();
          if (done || !running) return;
          done = true;
          killed++;
          combo++;
          best = Math.max(best, combo);
          const bonus = Math.floor(Math.max(0, combo - 1) / 3); // +1 every 3 in a row
          const gain = (charged ? 3 : 1) + bonus;
          score += gain;
          const sr = stage.getBoundingClientRect();
          floatText(e.clientX - sr.left, e.clientY - sr.top, "+" + gain, "good");
          c.classList.add("popped");
          live.delete(c);
          setTimeout(() => c.remove(), 160);
          setHud();
        };
        c.addEventListener("pointerdown", hit);

        stage.appendChild(c);
        live.add(c);

        setTimeout(() => {
          if (done || !running) return;
          done = true;
          combo = 0;                    // missed one - combo resets
          c.classList.add("boom");
          live.delete(c);
          setTimeout(() => c.remove(), 260);
          setHud();
        }, life);
      }

      function scheduleSpawn() {
        if (!running) return;
        const elapsed = DURATION - remaining;
        const gap = Math.max(240, 780 - elapsed * 10);
        spawnTimer = setTimeout(() => { spawn(); scheduleSpawn(); }, gap);
      }

      let remaining = DURATION;
      const stopTimer = countdown(
        DURATION,
        (left) => { remaining = left; refs.left.textContent = left.toFixed(1) + "s"; },
        () => finish()
      );

      function finish() {
        if (!running) return;
        running = false;
        clearTimeout(spawnTimer);
        stopTimer();
        live.forEach((c) => c.remove());
        const coins = rewardFor(score / TARGET_SCORE);
        onFinish({
          score: String(Math.max(0, score)),
          scoreLabel: "Score",
          coins,
          detail: [
            ["Creepers defeated", String(killed)],
            ["Best combo", "x" + Math.max(1, best)],
            ["Score", `${Math.max(0, score)} / ${TARGET_SCORE} for a perfect run`],
          ],
        });
      }

      spawn();
      scheduleSpawn();
      setHud();
      return () => { running = false; clearTimeout(spawnTimer); stopTimer(); };
    },
  };

  /* ==========================================================
     3. BLOCK BREAKER — 10 rounds of "break the right blocks"
     ========================================================== */
  const BLOCKS = [
    { id: "diamond", name: "Diamond Ore", emoji: "💎", color: "#4fd8e8" },
    { id: "gold", name: "Gold Ore", emoji: "🟨", color: "#f7c948" },
    { id: "iron", name: "Iron Ore", emoji: "⬜", color: "#d6d1c4" },
    { id: "redstone", name: "Redstone Ore", emoji: "🟥", color: "#e2513a" },
    { id: "emerald", name: "Emerald Ore", emoji: "🟩", color: "#3fce6c" },
    { id: "coal", name: "Coal Ore", emoji: "⬛", color: "#3a3a3a" },
    { id: "lapis", name: "Lapis Ore", emoji: "🟦", color: "#3b6ed6" },
  ];

  const blockBreaker = {
    id: "block-breaker",
    icon: "⛏️",
    name: "Block Breaker",
    desc: "Break only the blocks you're told to.",
    howTo: "Each round names a block — tap every matching block in the grid before time runs out.",
    start(mount, onFinish) {
      const ROUNDS = 10;
      const { bar, refs } = hud([
        { key: "round", label: "Round", value: "1/10" },
        { key: "time", label: "Time", value: "0.0s" },
        { key: "score", label: "Rounds won", value: "0" },
      ]);
      mount.appendChild(bar);

      const target = el("div", "bb-target");
      mount.appendChild(target);
      const grid = el("div", "bb-grid");
      mount.appendChild(grid);
      mount.appendChild(el("p", "game-hint", "Wrong block = 1 second penalty"));

      let round = 0, won = 0, running = true, stopTimer = null;

      function startRound() {
        if (!running) return;
        round++;
        if (round > ROUNDS) return finish();
        refs.round.textContent = `${round}/${ROUNDS}`;

        const want = BLOCKS[Math.floor(Math.random() * BLOCKS.length)];
        const cells = 12;
        const need = 3 + Math.floor(Math.random() * 3); // 3-5 correct tiles
        const layout = [];
        for (let i = 0; i < cells; i++) {
          layout.push(i < need ? want : BLOCKS.filter((b) => b.id !== want.id)[Math.floor(Math.random() * (BLOCKS.length - 1))]);
        }
        layout.sort(() => Math.random() - 0.5);

        target.innerHTML = `<span class="bb-target-label">BREAK</span>
          <span class="bb-target-block" style="--bb:${want.color}">${want.emoji} ${escapeHtml(want.name)}</span>`;

        grid.innerHTML = "";
        let left = need;
        // Rounds get tighter: 7s down to ~3.4s
        let secs = Math.max(3.4, 7 - (round - 1) * 0.4);
        const roundEnd = { at: performance.now() + secs * 1000 };

        layout.forEach((b) => {
          const cell = el("button", "bb-cell");
          cell.type = "button";
          cell.style.setProperty("--bb", b.color);
          cell.innerHTML = `<span class="bb-emoji">${b.emoji}</span><span class="bb-name">${escapeHtml(b.name)}</span>`;
          cell.addEventListener("pointerdown", () => {
            if (!running || cell.disabled) return;
            if (b.id === want.id) {
              cell.disabled = true;
              cell.classList.add("hit");
              left--;
              if (left === 0) { won++; refs.score.textContent = String(won); stopRoundTimer(); setTimeout(startRound, 260); }
            } else {
              cell.classList.add("miss");
              setTimeout(() => cell.classList.remove("miss"), 260);
              roundEnd.at -= 1000; // penalty
            }
          });
          grid.appendChild(cell);
        });

        let raf = 0;
        const tick = () => {
          if (!running) return;
          const rem = Math.max(0, (roundEnd.at - performance.now()) / 1000);
          refs.time.textContent = rem.toFixed(1) + "s";
          if (rem <= 0) { stopRoundTimer(); setTimeout(startRound, 260); return; }
          raf = requestAnimationFrame(tick);
        };
        const stopRoundTimer = () => cancelAnimationFrame(raf);
        stopTimer = stopRoundTimer;
        tick();
      }

      function finish() {
        if (!running) return;
        running = false;
        if (stopTimer) stopTimer();
        const coins = rewardFor(won / ROUNDS);
        onFinish({
          score: `${won}/${ROUNDS}`,
          scoreLabel: "Rounds won",
          coins,
          detail: [
            ["Rounds cleared", `${won} of ${ROUNDS}`],
            ["Accuracy", Math.round((won / ROUNDS) * 100) + "%"],
            ["Perfect run", won === ROUNDS ? "Yes — 5,000 coins!" : "Clear all 10 for 5,000"],
          ],
        });
      }

      startRound();
      return () => { running = false; if (stopTimer) stopTimer(); };
    },
  };

  return {
    rewardFor,
    rankLabel,
    MIN_COINS,
    MAX_COINS,
    list: [tntEscape, creeperClick, blockBreaker],
    byId(id) {
      return this.list.find((g) => g.id === id);
    },
  };
})();
