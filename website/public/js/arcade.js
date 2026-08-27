/* =============================================================
   AngkorSMP arcade — five self-contained mini-games.

   Every game follows the same contract so the hub can launch any of
   them the same way:

     Arcade.games[id] = {
       id, icon, name, desc, howTo,
       start(mount, onFinish)   // render into `mount`, call onFinish(result)
     }

   `onFinish` receives { points, scoreLabel, detail[] }. Games only ever
   report POINTS — how many coins that is worth is decided by the server
   (see routes/games.js), which also enforces the 500 coins/day per-game
   limit. Nothing here can hand out coins on its own.

   All five games are unlimited: they always end in a result screen with a
   Play Again button, and a player can keep replaying forever.
   ============================================================= */
const Arcade = (() => {
  // Names/descriptions come from the translation dictionary so the whole
  // arcade switches to Khmer with the rest of the site.
  const T = (key, vars) => (typeof t === "function" ? t(key, vars) : key);

  /* ------------------------- shared helpers ------------------------- */

  function el(tag, className, html) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html != null) node.innerHTML = html;
    return node;
  }

  // The HUD strip above every stage. `cells` is [{ id, labelKey }].
  function buildHud(mount, cells) {
    const hud = el("div", "game-hud");
    hud.innerHTML = cells
      .map(
        (c) => `<div class="hud-cell">
            <span class="hud-label" data-i18n="${c.labelKey}">${T(c.labelKey)}</span>
            <span class="hud-value" data-hud="${c.id}">${c.value ?? 0}</span>
          </div>`
      )
      .join("");
    mount.appendChild(hud);
    return (id, value) => {
      const node = hud.querySelector(`[data-hud="${id}"]`);
      if (node) node.textContent = value;
    };
  }

  function buildStage(mount, extraClass) {
    const stage = el("div", `game-stage ${extraClass || ""}`.trim());
    mount.appendChild(stage);
    return stage;
  }

  function addHint(mount, key) {
    const hint = el("p", "game-hint", T(key));
    hint.setAttribute("data-i18n", key);
    mount.appendChild(hint);
    return hint;
  }

  // "+5" style popup at a point inside the stage.
  function floatText(stage, x, y, text, kind) {
    const node = el("span", `float-text ${kind || "good"}`, text);
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    stage.appendChild(node);
    setTimeout(() => node.remove(), 700);
  }

  // requestAnimationFrame loop with a delta in seconds; returns a stopper.
  function loop(step) {
    let raf = 0;
    let last = performance.now();
    let running = true;
    const frame = (now) => {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000); // clamp after a tab switch
      last = now;
      step(dt, now);
      if (running) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }

  // Canvas sized to its parent in CSS pixels, scaled for retina screens.
  function fitCanvas(stage) {
    const canvas = el("canvas", "game-canvas");
    stage.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      canvas.dataset.w = w;
      canvas.dataset.h = h;
    };
    resize();
    window.addEventListener("resize", resize);
    return { canvas, ctx, resize, dispose: () => window.removeEventListener("resize", resize) };
  }

  const rand = (min, max) => min + Math.random() * (max - min);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const fmtTime = (secs) => {
    const s = Math.max(0, Math.floor(secs));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  /* =============================================================
     1. 💣 CREEPER CLICKER — 30s. Tap creepers before they escape.
     Normal +1, Charged +3, Golden +5, with a combo multiplier.
     ============================================================= */
  const creeperClicker = {
    id: "creeper-clicker",
    icon: "💣",
    nameKey: "game.creeper.name",
    descKey: "game.creeper.desc",
    howToKey: "game.creeper.howto",
    start(mount, onFinish) {
      const ROUND_SECONDS = 30;
      const TYPES = [
        { kind: "normal", weight: 70, points: 1, life: 1500, size: 62 },
        { kind: "charged", weight: 22, points: 3, life: 1100, size: 52 },
        { kind: "golden", weight: 8, points: 5, life: 850, size: 44 },
      ];
      const totalWeight = TYPES.reduce((sum, t) => sum + t.weight, 0);

      const setHud = buildHud(mount, [
        { id: "score", labelKey: "hud.points" },
        { id: "combo", labelKey: "hud.combo", value: "x1" },
        { id: "time", labelKey: "hud.time", value: ROUND_SECONDS },
      ]);
      const stage = buildStage(mount, "creeper-stage");
      addHint(mount, "game.creeper.hint");

      let points = 0;
      let combo = 0;
      let best = 0;
      let hits = 0;
      let misses = 0;
      let elapsed = 0;
      let spawnIn = 0.4;
      let done = false;

      // 5 hits in a row = x2, 10 = x3. Capped so scores stay in a sane range.
      const multiplier = () => Math.min(3, 1 + Math.floor(combo / 5));

      function rollType() {
        let roll = Math.random() * totalWeight;
        for (const type of TYPES) {
          roll -= type.weight;
          if (roll <= 0) return type;
        }
        return TYPES[0];
      }

      function spawn() {
        const type = rollType();
        // Creepers shrink and get twitchier as the round goes on.
        const progress = elapsed / ROUND_SECONDS;
        const size = Math.round(type.size * (1 - progress * 0.28));
        const life = type.life * (1 - progress * 0.35);

        const node = el("button", `creeper ${type.kind}`, '<span class="creeper-face"><i></i><i></i><b></b></span>');
        node.type = "button";
        node.style.width = `${size}px`;
        node.style.height = `${size}px`;
        node.style.left = `${rand(4, Math.max(5, stage.clientWidth - size - 4))}px`;
        node.style.top = `${rand(4, Math.max(5, stage.clientHeight - size - 4))}px`;

        const escapeTimer = setTimeout(() => {
          if (!node.isConnected) return;
          node.classList.add("boom");
          setTimeout(() => node.remove(), 260);
          combo = 0;
          misses += 1;
          setHud("combo", "x1");
        }, life);

        node.addEventListener("pointerdown", (event) => {
          event.stopPropagation();
          if (!node.isConnected || done) return;
          clearTimeout(escapeTimer);
          node.classList.add("popped");
          setTimeout(() => node.remove(), 160);

          combo += 1;
          best = Math.max(best, combo);
          hits += 1;
          const gained = type.points * multiplier();
          points += gained;
          setHud("score", points);
          setHud("combo", `x${multiplier()}`);
          const box = stage.getBoundingClientRect();
          floatText(stage, event.clientX - box.left, event.clientY - box.top, `+${gained}`, "good");
        });

        stage.appendChild(node);
      }

      // Tapping empty ground breaks the combo, so spam-tapping is not a strategy.
      const missHandler = (event) => {
        if (done || event.target !== stage) return;
        combo = 0;
        misses += 1;
        setHud("combo", "x1");
        const box = stage.getBoundingClientRect();
        floatText(stage, event.clientX - box.left, event.clientY - box.top, T("game.miss"), "bad");
      };
      stage.addEventListener("pointerdown", missHandler);

      const stop = loop((dt) => {
        elapsed += dt;
        setHud("time", Math.max(0, Math.ceil(ROUND_SECONDS - elapsed)));
        spawnIn -= dt;
        if (spawnIn <= 0) {
          spawn();
          // 0.62s between creepers at the start, down to ~0.3s at the end.
          const progress = elapsed / ROUND_SECONDS;
          spawnIn = rand(0.34, 0.62) * (1 - progress * 0.45);
        }
        if (elapsed >= ROUND_SECONDS) finish();
      });

      function finish() {
        if (done) return;
        done = true;
        stop();
        onFinish({
          points,
          scoreLabelKey: "hud.points",
          detail: [
            ["result.creepersPopped", hits],
            ["result.bestCombo", `x${Math.min(3, 1 + Math.floor(best / 5))} (${best})`],
            ["result.missed", misses],
          ],
        });
      }

      return () => {
        done = true;
        stop();
        stage.removeEventListener("pointerdown", missHandler);
      };
    },
  };

  /* =============================================================
     2. ⛏️ BLOCK BREAKER — 45s. Break the block that is named at the
     top. Right block = points (faster = more), wrong block = penalty.
     The grid grows as the round goes on.
     ============================================================= */
  const BLOCKS = [
    { key: "block.grass", emoji: "🟩", color: "#5aa447" },
    { key: "block.stone", emoji: "⬜", color: "#9a9a9a" },
    { key: "block.dirt", emoji: "🟫", color: "#8a5a3b" },
    { key: "block.gold", emoji: "🟨", color: "#f0c020" },
    { key: "block.diamond", emoji: "💎", color: "#4fd8e8" },
    { key: "block.redstone", emoji: "🟥", color: "#d33c30" },
    { key: "block.lapis", emoji: "🟦", color: "#3a63c8" },
    { key: "block.emerald", emoji: "🟩", color: "#2fbf6a" },
    { key: "block.obsidian", emoji: "⬛", color: "#3a2a55" },
    { key: "block.sand", emoji: "🟧", color: "#e0cf8a" },
  ];

  const blockBreaker = {
    id: "block-breaker",
    icon: "⛏️",
    nameKey: "game.breaker.name",
    descKey: "game.breaker.desc",
    howToKey: "game.breaker.howto",
    start(mount, onFinish) {
      const ROUND_SECONDS = 45;

      const setHud = buildHud(mount, [
        { id: "score", labelKey: "hud.points" },
        { id: "streak", labelKey: "hud.streak" },
        { id: "time", labelKey: "hud.time", value: ROUND_SECONDS },
      ]);

      const targetBar = el(
        "div",
        "bb-target",
        `<span class="bb-target-label" data-i18n="game.breaker.target">${T("game.breaker.target")}</span>
         <span class="bb-target-block"></span>`
      );
      mount.appendChild(targetBar);
      const targetName = targetBar.querySelector(".bb-target-block");

      const grid = el("div", "bb-grid");
      mount.appendChild(grid);
      addHint(mount, "game.breaker.hint");

      let points = 0;
      let streak = 0;
      let bestStreak = 0;
      let correct = 0;
      let wrong = 0;
      let elapsed = 0;
      let shownAt = 0;
      let target = null;
      let done = false;

      // 6 tiles at the start, 12 by the end of the round.
      function tileCount() {
        const progress = elapsed / ROUND_SECONDS;
        return Math.round(6 + progress * 6);
      }

      function deal() {
        const count = tileCount();
        const pool = [...BLOCKS].sort(() => Math.random() - 0.5).slice(0, Math.min(count, BLOCKS.length));
        while (pool.length < count) pool.push(pick(BLOCKS)); // repeats are fine, they raise the difficulty
        target = pick(pool);
        targetName.textContent = T(target.key);
        targetName.style.setProperty("--bb", target.color);

        grid.innerHTML = "";
        pool
          .sort(() => Math.random() - 0.5)
          .forEach((block) => {
            const cell = el(
              "button",
              "bb-cell",
              `<span class="bb-emoji">${block.emoji}</span><span class="bb-name">${T(block.key)}</span>`
            );
            cell.type = "button";
            cell.style.setProperty("--bb", block.color);
            cell.addEventListener("pointerdown", (event) => tap(event, cell, block));
            grid.appendChild(cell);
          });
        shownAt = performance.now();
      }

      function tap(event, cell, block) {
        if (done) return;
        if (block.key === target.key) {
          const reaction = (performance.now() - shownAt) / 1000;
          // 3 base, up to +5 more for breaking it inside a second.
          const speedBonus = Math.round(clamp(5 * (1 - reaction / 1.6), 0, 5));
          const gained = 3 + speedBonus;
          points += gained;
          streak += 1;
          bestStreak = Math.max(bestStreak, streak);
          correct += 1;
          cell.classList.add("hit");
          setHud("score", points);
          setHud("streak", streak);
          const box = grid.getBoundingClientRect();
          floatText(grid, event.clientX - box.left, event.clientY - box.top, `+${gained}`, "good");
          setTimeout(() => { if (!done) deal(); }, 90);
        } else {
          points = Math.max(0, points - 4);
          streak = 0;
          wrong += 1;
          cell.classList.add("miss");
          setTimeout(() => cell.classList.remove("miss"), 260);
          setHud("score", points);
          setHud("streak", 0);
          const box = grid.getBoundingClientRect();
          floatText(grid, event.clientX - box.left, event.clientY - box.top, "-4", "bad");
        }
      }

      grid.style.position = "relative";
      deal();

      const stop = loop((dt) => {
        elapsed += dt;
        setHud("time", Math.max(0, Math.ceil(ROUND_SECONDS - elapsed)));
        if (elapsed >= ROUND_SECONDS) finish();
      });

      function finish() {
        if (done) return;
        done = true;
        stop();
        onFinish({
          points,
          scoreLabelKey: "hud.points",
          detail: [
            ["result.blocksBroken", correct],
            ["result.wrongBlocks", wrong],
            ["result.bestStreak", bestStreak],
          ],
        });
      }

      return () => {
        done = true;
        stop();
      };
    },
  };

  /* =============================================================
     3. 💨 WIND CHARGE DODGE — survive the wind charges. Longer alive =
     more points, near misses pay a dodge bonus, emeralds are worth 10.
     Ends the moment you are hit.
     ============================================================= */
  const windDodge = {
    id: "wind-charge-dodge",
    icon: "💨",
    nameKey: "game.dodge.name",
    descKey: "game.dodge.desc",
    howToKey: "game.dodge.howto",
    start(mount, onFinish) {
      const setHud = buildHud(mount, [
        { id: "score", labelKey: "hud.points" },
        { id: "dodges", labelKey: "hud.dodges" },
        { id: "time", labelKey: "hud.survived", value: "0:00" },
      ]);
      const stage = buildStage(mount, "dodge-stage");
      addHint(mount, "game.dodge.hint");
      const { canvas, ctx, dispose } = fitCanvas(stage);

      const W = () => Number(canvas.dataset.w);
      const H = () => Number(canvas.dataset.h);

      const player = { x: W() / 2, y: H() * 0.72, r: 12, tx: W() / 2, ty: H() * 0.72 };
      const charges = [];
      const emeralds = [];
      const keys = new Set();

      let points = 0;
      let dodges = 0;
      let gems = 0;
      let elapsed = 0;
      let survivalCarry = 0;
      let spawnIn = 1.8; // a moment of grace before the first charge
      let gemIn = 2;
      let done = false;

      /* --- controls: drag anywhere on the stage, or arrow keys / WASD --- */
      const movePointer = (event) => {
        const box = stage.getBoundingClientRect();
        player.tx = clamp(event.clientX - box.left, player.r, W() - player.r);
        player.ty = clamp(event.clientY - box.top, player.r, H() - player.r);
      };
      const onDown = (event) => {
        stage.setPointerCapture?.(event.pointerId);
        movePointer(event);
      };
      stage.addEventListener("pointerdown", onDown);
      stage.addEventListener("pointermove", (event) => {
        if (event.pressure > 0 || event.pointerType === "mouse") movePointer(event);
      });
      const onKeyDown = (e) => keys.add(e.key.toLowerCase());
      const onKeyUp = (e) => keys.delete(e.key.toLowerCase());
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);

      function spawnCharge() {
        // Fire in from a random edge, aimed near where the player is now.
        const speed = 95 + elapsed * 4; // gets faster the longer you live
        const edge = Math.floor(rand(0, 4));
        let x = 0;
        let y = 0;
        if (edge === 0) { x = rand(0, W()); y = -20; }
        else if (edge === 1) { x = W() + 20; y = rand(0, H()); }
        else if (edge === 2) { x = rand(0, W()); y = H() + 20; }
        else { x = -20; y = rand(0, H()); }

        const aimX = player.x + rand(-60, 60);
        const aimY = player.y + rand(-60, 60);
        const len = Math.hypot(aimX - x, aimY - y) || 1;
        charges.push({
          x, y,
          vx: ((aimX - x) / len) * speed,
          vy: ((aimY - y) / len) * speed,
          r: 11,
          spin: rand(0, Math.PI * 2),
          near: false,
        });
      }

      function spawnEmerald() {
        emeralds.push({ x: rand(28, W() - 28), y: rand(28, H() - 28), life: 6 });
      }

      const stop = loop((dt) => {
        elapsed += dt;

        /* keyboard movement nudges the target point */
        const kbSpeed = 320 * dt;
        if (keys.has("arrowleft") || keys.has("a")) player.tx -= kbSpeed;
        if (keys.has("arrowright") || keys.has("d")) player.tx += kbSpeed;
        if (keys.has("arrowup") || keys.has("w")) player.ty -= kbSpeed;
        if (keys.has("arrowdown") || keys.has("s")) player.ty += kbSpeed;
        player.tx = clamp(player.tx, player.r, W() - player.r);
        player.ty = clamp(player.ty, player.r, H() - player.r);
        // Ease toward the target so movement feels smooth instead of teleporting.
        player.x += (player.tx - player.x) * Math.min(1, dt * 14);
        player.y += (player.ty - player.y) * Math.min(1, dt * 14);

        /* +1 point every half second alive */
        survivalCarry += dt;
        while (survivalCarry >= 0.5) {
          survivalCarry -= 0.5;
          points += 1;
        }

        spawnIn -= dt;
        if (spawnIn <= 0) {
          spawnCharge();
          spawnIn = Math.max(0.3, rand(0.8, 1.25) - elapsed * 0.012);
        }
        gemIn -= dt;
        if (gemIn <= 0 && emeralds.length < 3) {
          spawnEmerald();
          gemIn = rand(3.5, 6);
        }

        for (let i = charges.length - 1; i >= 0; i--) {
          const c = charges[i];
          c.x += c.vx * dt;
          c.y += c.vy * dt;
          c.spin += dt * 8;

          const dist = Math.hypot(c.x - player.x, c.y - player.y);
          if (dist < c.r + player.r) return finish();
          // Threading the needle pays: +2 the first time a charge grazes you.
          if (!c.near && dist < c.r + player.r + 26) {
            c.near = true;
            dodges += 1;
            points += 2;
            floatText(stage, player.x, player.y - 18, "+2", "good");
          }
          if (c.x < -60 || c.x > W() + 60 || c.y < -60 || c.y > H() + 60) charges.splice(i, 1);
        }

        for (let i = emeralds.length - 1; i >= 0; i--) {
          const gem = emeralds[i];
          gem.life -= dt;
          if (gem.life <= 0) { emeralds.splice(i, 1); continue; }
          if (Math.hypot(gem.x - player.x, gem.y - player.y) < player.r + 13) {
            emeralds.splice(i, 1);
            gems += 1;
            points += 10;
            floatText(stage, gem.x, gem.y, "+10", "good");
          }
        }

        setHud("score", points);
        setHud("dodges", dodges);
        setHud("time", fmtTime(elapsed));
        draw();
      });

      function draw() {
        const w = W();
        const h = H();
        ctx.clearRect(0, 0, w, h);

        for (const gem of emeralds) {
          ctx.save();
          ctx.translate(gem.x, gem.y);
          ctx.rotate(Math.PI / 4);
          ctx.fillStyle = gem.life < 1.5 && Math.floor(gem.life * 8) % 2 ? "#1d7a48" : "#2fbf6a";
          ctx.fillRect(-9, -9, 18, 18);
          ctx.strokeStyle = "#0f4d2c";
          ctx.lineWidth = 3;
          ctx.strokeRect(-9, -9, 18, 18);
          ctx.restore();
        }

        for (const c of charges) {
          ctx.save();
          ctx.translate(c.x, c.y);
          ctx.rotate(c.spin);
          ctx.strokeStyle = "rgba(210,245,255,0.95)";
          ctx.lineWidth = 3;
          for (let ring = 0; ring < 3; ring++) {
            ctx.beginPath();
            ctx.arc(0, 0, c.r - ring * 3, ring * 1.6, ring * 1.6 + 4.4);
            ctx.stroke();
          }
          ctx.fillStyle = "rgba(255,255,255,0.85)";
          ctx.beginPath();
          ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // the player: a little Steve-ish head
        ctx.fillStyle = "#3b2a1c";
        ctx.fillRect(player.x - 13, player.y - 13, 26, 26);
        ctx.fillStyle = "#c99a6b";
        ctx.fillRect(player.x - 10, player.y - 6, 20, 16);
        ctx.fillStyle = "#fff";
        ctx.fillRect(player.x - 8, player.y - 3, 6, 5);
        ctx.fillRect(player.x + 2, player.y - 3, 6, 5);
        ctx.fillStyle = "#2b6cc4";
        ctx.fillRect(player.x - 6, player.y - 2, 3, 3);
        ctx.fillRect(player.x + 4, player.y - 2, 3, 3);
      }

      function finish() {
        if (done) return;
        done = true;
        stop();
        cleanup();
        onFinish({
          points,
          scoreLabelKey: "hud.points",
          detail: [
            ["result.survived", fmtTime(elapsed)],
            ["result.dodges", dodges],
            ["result.emeralds", gems],
          ],
        });
      }

      function cleanup() {
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        stage.removeEventListener("pointerdown", onDown);
        dispose();
      }

      return () => {
        done = true;
        stop();
        cleanup();
      };
    },
  };

  /* =============================================================
     4. ⚔️ ZOMBIE SURVIVAL — mobs walk down toward your gate, tap to
     hit them. Zombie +5, Armored +15 (2 hits), Burning +25 (fast),
     Mini Boss +100 (5 hits). Kill combos multiply. Three hearts; the
     run ends when the last one goes.
     ============================================================= */
  const zombieSurvival = {
    id: "zombie-survival",
    icon: "⚔️",
    nameKey: "game.zombie.name",
    descKey: "game.zombie.desc",
    howToKey: "game.zombie.howto",
    start(mount, onFinish) {
      const MOBS = {
        zombie: { emoji: "🧟", points: 5, hp: 1, speed: 34, size: 46, weight: 62, cls: "" },
        armored: { emoji: "🧟‍♂️", points: 15, hp: 2, speed: 28, size: 50, weight: 22, cls: "armored" },
        burning: { emoji: "🔥", points: 25, hp: 1, speed: 74, size: 40, weight: 13, cls: "burning" },
        boss: { emoji: "👹", points: 100, hp: 5, speed: 18, size: 70, weight: 3, cls: "boss" },
      };
      const KINDS = Object.keys(MOBS);
      const totalWeight = KINDS.reduce((sum, k) => sum + MOBS[k].weight, 0);

      const setHud = buildHud(mount, [
        { id: "score", labelKey: "hud.points" },
        { id: "combo", labelKey: "hud.combo", value: "x1" },
        { id: "lives", labelKey: "hud.lives", value: "❤️❤️❤️" },
        { id: "time", labelKey: "hud.survived", value: "0:00" },
      ]);
      const stage = buildStage(mount, "zombie-stage");
      stage.appendChild(el("div", "zombie-gate"));
      addHint(mount, "game.zombie.hint");

      const mobs = [];
      let points = 0;
      let combo = 0;
      let bestCombo = 0;
      let kills = 0;
      let bosses = 0;
      let lives = 3;
      let elapsed = 0;
      let spawnIn = 0.8;
      let done = false;

      // 4 kills in a row = x2, 8 = x3.
      const multiplier = () => Math.min(3, 1 + Math.floor(combo / 4));

      function rollKind() {
        let roll = Math.random() * totalWeight;
        for (const kind of KINDS) {
          roll -= MOBS[kind].weight;
          if (roll <= 0) return kind;
        }
        return "zombie";
      }

      function spawn() {
        const kind = rollKind();
        const spec = MOBS[kind];
        const node = el("button", `mob ${spec.cls}`.trim(), `<span class="mob-emoji">${spec.emoji}</span>`);
        node.type = "button";
        node.style.width = `${spec.size}px`;
        node.style.height = `${spec.size}px`;

        const mob = {
          node,
          hp: spec.hp,
          maxHp: spec.hp,
          points: spec.points,
          kind,
          // Everything speeds up the longer you last.
          speed: spec.speed * (1 + elapsed / 55),
          x: rand(6, Math.max(7, stage.clientWidth - spec.size - 6)),
          y: -spec.size,
          size: spec.size,
        };

        if (spec.hp > 1) {
          const bar = el("span", "mob-hp", `<i style="width:100%"></i>`);
          node.appendChild(bar);
        }

        node.addEventListener("pointerdown", (event) => {
          event.stopPropagation();
          if (done || mob.hp <= 0) return;
          mob.hp -= 1;
          const box = stage.getBoundingClientRect();
          const px = event.clientX - box.left;
          const py = event.clientY - box.top;

          if (mob.hp > 0) {
            node.classList.add("hurt");
            setTimeout(() => node.classList.remove("hurt"), 140);
            const bar = node.querySelector(".mob-hp i");
            if (bar) bar.style.width = `${(mob.hp / mob.maxHp) * 100}%`;
            floatText(stage, px, py, T("game.zombie.hit"), "good");
            return;
          }

          const gained = mob.points * multiplier();
          points += gained;
          kills += 1;
          if (mob.kind === "boss") bosses += 1;
          combo += 1;
          bestCombo = Math.max(bestCombo, combo);
          setHud("score", points);
          setHud("combo", `x${multiplier()}`);
          floatText(stage, px, py, `+${gained}`, "good");
          kill(mob);
        });

        stage.appendChild(node);
        mobs.push(mob);
      }

      function kill(mob) {
        mob.hp = -1;
        mob.node.classList.add("mob-dead");
        setTimeout(() => mob.node.remove(), 220);
        const idx = mobs.indexOf(mob);
        if (idx !== -1) mobs.splice(idx, 1);
      }

      function breach(mob) {
        mob.node.remove();
        const idx = mobs.indexOf(mob);
        if (idx !== -1) mobs.splice(idx, 1);
        lives -= 1;
        combo = 0;
        setHud("combo", "x1");
        setHud("lives", "❤️".repeat(Math.max(0, lives)) || "💀");
        stage.classList.add("stage-hurt");
        setTimeout(() => stage.classList.remove("stage-hurt"), 220);
        if (lives <= 0) finish();
      }

      const stop = loop((dt) => {
        elapsed += dt;
        spawnIn -= dt;
        if (spawnIn <= 0) {
          spawn();
          spawnIn = Math.max(0.35, rand(0.75, 1.25) - elapsed * 0.014);
        }

        const floor = stage.clientHeight - 16;
        for (let i = mobs.length - 1; i >= 0; i--) {
          const mob = mobs[i];
          mob.y += mob.speed * dt;
          mob.node.style.transform = `translate(${mob.x}px, ${mob.y}px)`;
          if (mob.y + mob.size >= floor) breach(mob);
        }
        setHud("time", fmtTime(elapsed));
      });

      function finish() {
        if (done) return;
        done = true;
        stop();
        onFinish({
          points,
          scoreLabelKey: "hud.points",
          detail: [
            ["result.mobsKilled", kills],
            ["result.bossesKilled", bosses],
            ["result.bestCombo", `x${Math.min(3, 1 + Math.floor(bestCombo / 4))} (${bestCombo})`],
            ["result.survived", fmtTime(elapsed)],
          ],
        });
      }

      return () => {
        done = true;
        stop();
      };
    },
  };

  /* =============================================================
     5. 🧠 MINECRAFT MEMORY — flip two cards, match the pair. Matching
     fast pays a speed bonus, a wrong pair costs a life. Each cleared
     board is bigger than the last; the run ends when lives run out.
     ============================================================= */
  const memory = {
    id: "minecraft-memory",
    icon: "🧠",
    nameKey: "game.memory.name",
    descKey: "game.memory.desc",
    howToKey: "game.memory.howto",
    start(mount, onFinish) {
      const FACES = ["🟩", "💎", "🧟", "🐷", "🔥", "⛏️", "🪓", "🍎", "🏹", "🛡️", "🧪", "🪙"];
      const START_LIVES = 5;

      const setHud = buildHud(mount, [
        { id: "score", labelKey: "hud.points" },
        { id: "level", labelKey: "hud.board", value: 1 },
        { id: "lives", labelKey: "hud.lives", value: "❤️".repeat(START_LIVES) },
      ]);
      const board = el("div", "mem-board");
      mount.appendChild(board);
      addHint(mount, "game.memory.hint");

      let points = 0;
      let level = 1;
      let lives = START_LIVES;
      let matches = 0;
      let mistakes = 0;
      let first = null;
      let busy = false;
      let flippedAt = 0;
      let remaining = 0;
      let done = false;
      const timers = [];

      const later = (fn, ms) => timers.push(setTimeout(fn, ms));

      // 4 pairs on board 1, then 6, 8, 10 - capped at 10 pairs.
      const pairsFor = (lvl) => Math.min(FACES.length, 3 + lvl);

      function deal() {
        const pairs = pairsFor(level);
        const faces = [...FACES].sort(() => Math.random() - 0.5).slice(0, pairs);
        const cards = [...faces, ...faces].sort(() => Math.random() - 0.5);
        remaining = pairs;
        first = null;
        busy = false;

        const cols = pairs <= 4 ? 4 : pairs <= 6 ? 4 : pairs <= 8 ? 4 : 5;
        board.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        board.innerHTML = "";
        cards.forEach((face) => {
          const card = el(
            "button",
            "mem-card",
            `<span class="mem-inner"><span class="mem-back">🟫</span><span class="mem-front">${face}</span></span>`
          );
          card.type = "button";
          card.dataset.face = face;
          card.addEventListener("pointerdown", () => flip(card));
          board.appendChild(card);
        });
        setHud("level", level);
      }

      function flip(card) {
        if (done || busy || card.classList.contains("open") || card.classList.contains("matched")) return;
        card.classList.add("open");

        if (!first) {
          first = card;
          flippedAt = performance.now();
          return;
        }

        if (first.dataset.face === card.dataset.face) {
          const seconds = (performance.now() - flippedAt) / 1000;
          // 10 base, up to +10 more for a quick pair.
          const speedBonus = Math.round(clamp(10 * (1 - seconds / 3), 0, 10));
          const gained = 10 + speedBonus;
          points += gained;
          matches += 1;
          first.classList.add("matched");
          card.classList.add("matched");
          first = null;
          remaining -= 1;
          setHud("score", points);
          const box = board.getBoundingClientRect();
          const cardBox = card.getBoundingClientRect();
          floatText(board, cardBox.left - box.left + cardBox.width / 2, cardBox.top - box.top, `+${gained}`, "good");
          if (remaining === 0) {
            busy = true;
            const bonus = 25 * level;
            points += bonus;
            setHud("score", points);
            later(() => {
              if (done) return;
              level += 1;
              deal();
            }, 600);
          }
          return;
        }

        // wrong pair: costs points and a heart
        busy = true;
        mistakes += 1;
        lives -= 1;
        points = Math.max(0, points - 3);
        setHud("score", points);
        setHud("lives", "❤️".repeat(Math.max(0, lives)) || "💀");
        card.classList.add("wrong");
        first.classList.add("wrong");
        const wrongFirst = first;
        first = null;
        later(() => {
          wrongFirst.classList.remove("open", "wrong");
          card.classList.remove("open", "wrong");
          busy = false;
          if (lives <= 0) finish();
        }, 620);
      }

      deal();

      function finish() {
        if (done) return;
        done = true;
        timers.forEach(clearTimeout);
        onFinish({
          points,
          scoreLabelKey: "hud.points",
          detail: [
            ["result.boardsCleared", level - 1],
            ["result.pairsFound", matches],
            ["result.mistakes", mistakes],
          ],
        });
      }

      return () => {
        done = true;
        timers.forEach(clearTimeout);
      };
    },
  };

  /* ----------------------------- registry ----------------------------- */
  const list = [creeperClicker, blockBreaker, windDodge, zombieSurvival, memory];
  const byId = (id) => list.find((game) => game.id === id) || null;

  return {
    list,
    byId,
    // Resolved at call time so a language switch re-labels everything.
    name: (game) => T(game.nameKey),
    desc: (game) => T(game.descKey),
    howTo: (game) => T(game.howToKey),
  };
})();
