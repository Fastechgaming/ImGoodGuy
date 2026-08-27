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
     1. 🏹 BOW SHOT — 30s of archery. Targets pop up around the range;
     shoot them before they vanish. Small ones and moving ones are
     worth more, and everything gets smaller (further away) and quicker
     as the round goes on. A missed arrow costs nothing but time.
     ============================================================= */
  const bowShot = {
    id: "bow-shot",
    icon: "🏹",
    nameKey: "game.bow.name",
    descKey: "game.bow.desc",
    howToKey: "game.bow.howto",
    start(mount, onFinish) {
      const ROUND_SECONDS = 30;
      const KINDS = [
        { kind: "normal", weight: 56, points: 10, size: 76, life: 1900 },
        { kind: "small", weight: 27, points: 25, size: 46, life: 1500 },
        { kind: "moving", weight: 17, points: 40, size: 60, life: 2600 },
      ];
      const totalWeight = KINDS.reduce((sum, k) => sum + k.weight, 0);

      const setHud = buildHud(mount, [
        { id: "score", labelKey: "hud.points" },
        { id: "hits", labelKey: "hud.hits" },
        { id: "time", labelKey: "hud.time", value: ROUND_SECONDS },
      ]);
      const stage = buildStage(mount, "bow-stage");
      addHint(mount, "game.bow.hint");

      const targets = [];
      let points = 0;
      let hits = 0;
      let arrows = 0;
      let smallHits = 0;
      let movingHits = 0;
      let elapsed = 0;
      let spawnIn = 0.5;
      let done = false;

      function rollKind() {
        let roll = Math.random() * totalWeight;
        for (const kind of KINDS) {
          roll -= kind.weight;
          if (roll <= 0) return kind;
        }
        return KINDS[0];
      }

      function spawn() {
        const spec = rollKind();
        const progress = elapsed / ROUND_SECONDS;
        // Targets shrink over the round - the same idea as standing further back.
        const size = Math.max(28, Math.round(spec.size * (1 - progress * 0.34)));
        const life = spec.life * (1 - progress * 0.32);

        const node = el("button", `target ${spec.kind}`, '<span class="target-face"></span>');
        node.type = "button";
        node.style.width = `${size}px`;
        node.style.height = `${size}px`;

        const target = {
          node,
          spec,
          size,
          x: rand(4, Math.max(5, stage.clientWidth - size - 4)),
          y: rand(4, Math.max(5, stage.clientHeight - size - 4)),
          // Moving targets drift across the range and bounce off the edges.
          vx: spec.kind === "moving" ? rand(70, 130) * (Math.random() < 0.5 ? -1 : 1) * (1 + progress) : 0,
          vy: spec.kind === "moving" ? rand(40, 90) * (Math.random() < 0.5 ? -1 : 1) * (1 + progress) : 0,
          expires: performance.now() + life,
          dead: false,
        };
        node.style.left = `${target.x}px`;
        node.style.top = `${target.y}px`;

        node.addEventListener("pointerdown", (event) => {
          event.stopPropagation();
          if (done || target.dead) return;
          arrows += 1;
          hit(target, event);
        });

        stage.appendChild(node);
        targets.push(target);
      }

      function hit(target, event) {
        target.dead = true;
        target.node.classList.add("target-hit");
        setTimeout(() => target.node.remove(), 220);
        const idx = targets.indexOf(target);
        if (idx !== -1) targets.splice(idx, 1);

        points += target.spec.points;
        hits += 1;
        if (target.spec.kind === "small") smallHits += 1;
        if (target.spec.kind === "moving") movingHits += 1;
        setHud("score", points);
        setHud("hits", hits);
        const box = stage.getBoundingClientRect();
        floatText(stage, event.clientX - box.left, event.clientY - box.top, `+${target.spec.points}`, "good");
      }

      // A missed arrow costs nothing - it just isn't a hit. That keeps the
      // game friendly while accuracy still shows up on the results screen.
      const missHandler = (event) => {
        if (done || event.target !== stage) return;
        arrows += 1;
        const box = stage.getBoundingClientRect();
        floatText(stage, event.clientX - box.left, event.clientY - box.top, T("game.bow.miss"), "bad");
      };
      stage.addEventListener("pointerdown", missHandler);

      const stop = loop((dt, now) => {
        elapsed += dt;
        setHud("time", Math.max(0, Math.ceil(ROUND_SECONDS - elapsed)));

        spawnIn -= dt;
        if (spawnIn <= 0) {
          spawn();
          const progress = elapsed / ROUND_SECONDS;
          spawnIn = rand(0.42, 0.8) * (1 - progress * 0.4);
        }

        for (let i = targets.length - 1; i >= 0; i--) {
          const target = targets[i];
          if (target.spec.kind === "moving") {
            target.x += target.vx * dt;
            target.y += target.vy * dt;
            const maxX = Math.max(0, stage.clientWidth - target.size);
            const maxY = Math.max(0, stage.clientHeight - target.size);
            if (target.x < 0 || target.x > maxX) {
              target.vx *= -1;
              target.x = clamp(target.x, 0, maxX);
            }
            if (target.y < 0 || target.y > maxY) {
              target.vy *= -1;
              target.y = clamp(target.y, 0, maxY);
            }
            target.node.style.left = `${target.x}px`;
            target.node.style.top = `${target.y}px`;
          }
          if (now >= target.expires) {
            target.dead = true;
            target.node.classList.add("target-gone");
            setTimeout(() => target.node.remove(), 220);
            targets.splice(i, 1);
          }
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
            ["result.targetsHit", hits],
            ["result.smallHits", smallHits],
            ["result.movingHits", movingHits],
            ["result.accuracy", `${arrows ? Math.round((hits / arrows) * 100) : 0}%`],
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
     4. 💎 DIAMOND RUSH — 45s in a small mine. Tap ore to mine it:
     Coal +1, Iron +3, Gold +5, Diamond +15, Emerald +20. TNT costs
     points and stuns your pick, and it gets nastier the longer you
     mine. The seam reshuffles more and more often, so the good ore
     keeps moving.
     ============================================================= */
  const ORES = [
    { key: "ore.stone", emoji: "🪨", value: 0, weight: 30 },
    { key: "ore.coal", emoji: "⬛", value: 1, weight: 22 },
    { key: "ore.iron", emoji: "⬜", value: 3, weight: 17 },
    { key: "ore.gold", emoji: "🟨", value: 5, weight: 13 },
    { key: "ore.diamond", emoji: "💎", value: 15, weight: 8 },
    { key: "ore.emerald", emoji: "💚", value: 20, weight: 5 },
    { key: "ore.tnt", emoji: "🧨", value: -1, weight: 5 },
  ];

  const diamondRush = {
    id: "diamond-rush",
    icon: "💎",
    nameKey: "game.rush.name",
    descKey: "game.rush.desc",
    howToKey: "game.rush.howto",
    start(mount, onFinish) {
      const ROUND_SECONDS = 45;
      const COLS = 5;
      const ROWS = 4;
      const CELLS = COLS * ROWS;

      const setHud = buildHud(mount, [
        { id: "score", labelKey: "hud.points" },
        { id: "ores", labelKey: "hud.ores" },
        { id: "time", labelKey: "hud.time", value: ROUND_SECONDS },
      ]);

      const grid = el("div", "mine-grid");
      grid.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
      mount.appendChild(grid);
      addHint(mount, "game.rush.hint");

      let points = 0;
      let mined = 0;
      let gems = 0;
      let tntHits = 0;
      let best = ORES[0];
      let elapsed = 0;
      let shuffleIn = 5;
      let stunnedUntil = 0;
      let done = false;
      const timers = [];
      const later = (fn, ms) => timers.push(setTimeout(fn, ms));

      // TNT gets both more common and more expensive as the round runs.
      function weightFor(ore) {
        if (ore.key !== "ore.tnt") return ore.weight;
        return ore.weight * (1 + (elapsed / ROUND_SECONDS) * 1.6);
      }
      function rollOre() {
        const total = ORES.reduce((sum, ore) => sum + weightFor(ore), 0);
        let roll = Math.random() * total;
        for (const ore of ORES) {
          roll -= weightFor(ore);
          if (roll <= 0) return ore;
        }
        return ORES[0];
      }
      function tntPenalty() {
        return 10 + Math.floor(elapsed / 9) * 5;
      }

      const cells = [];
      for (let i = 0; i < CELLS; i++) {
        const node = el("button", "mine-cell", '<span class="mine-emoji"></span>');
        node.type = "button";
        const cell = { node, ore: rollOre(), empty: false };
        paint(cell);
        node.addEventListener("pointerdown", (event) => dig(event, cell));
        grid.appendChild(node);
        cells.push(cell);
      }

      function paint(cell) {
        cell.node.querySelector(".mine-emoji").textContent = cell.empty ? "" : cell.ore.emoji;
        cell.node.classList.toggle("mined", cell.empty);
        cell.node.classList.toggle("tnt", !cell.empty && cell.ore.key === "ore.tnt");
      }

      function dig(event, cell) {
        if (done || cell.empty || performance.now() < stunnedUntil) return;
        const ore = cell.ore;
        const box = grid.getBoundingClientRect();
        const px = event.clientX - box.left;
        const py = event.clientY - box.top;

        if (ore.key === "ore.tnt") {
          const penalty = tntPenalty();
          points = Math.max(0, points - penalty);
          tntHits += 1;
          stunnedUntil = performance.now() + 700; // the blast knocks your pick loose
          grid.classList.add("mine-boom");
          later(() => grid.classList.remove("mine-boom"), 300);
          floatText(grid, px, py, `-${penalty}`, "bad");
        } else {
          points += ore.value;
          if (ore.value > 0) mined += 1;
          if (ore.value >= 15) gems += 1;
          if (ore.value > best.value) best = ore;
          floatText(grid, px, py, ore.value ? `+${ore.value}` : T("game.rush.rubble"), ore.value ? "good" : "bad");
        }

        setHud("score", points);
        setHud("ores", mined);

        cell.empty = true;
        paint(cell);
        // The seam refills so there is always something to swing at.
        later(() => {
          if (done) return;
          cell.ore = rollOre();
          cell.empty = false;
          paint(cell);
        }, 320);
      }

      // "Ores moving": every so often the whole face reshuffles, faster and
      // faster, so a diamond you spotted may not be there when you reach it.
      function reshuffle() {
        for (const cell of cells) {
          if (cell.empty) continue;
          cell.ore = rollOre();
          paint(cell);
        }
        grid.classList.add("mine-shift");
        later(() => grid.classList.remove("mine-shift"), 260);
      }

      const stop = loop((dt) => {
        elapsed += dt;
        setHud("time", Math.max(0, Math.ceil(ROUND_SECONDS - elapsed)));

        shuffleIn -= dt;
        if (shuffleIn <= 0) {
          reshuffle();
          shuffleIn = Math.max(1.8, 5 - elapsed * 0.08);
        }

        if (elapsed >= ROUND_SECONDS) finish();
      });

      function finish() {
        if (done) return;
        done = true;
        stop();
        timers.forEach(clearTimeout);
        onFinish({
          points,
          scoreLabelKey: "hud.points",
          detail: [
            ["result.oresMined", mined],
            ["result.gems", gems],
            ["result.bestFind", best.value > 0 ? `${best.emoji} ${T(best.key)}` : "—"],
            ["result.tntHit", tntHits],
          ],
        });
      }

      return () => {
        done = true;
        stop();
        timers.forEach(clearTimeout);
      };
    },
  };

  /* =============================================================
     5. 🧱 BUILD IT! — memory + building. A structure is shown for a
     few seconds, then it vanishes and you rebuild it from the block
     palette. Correct blocks in the correct places score, wrong ones
     cost, and finishing quickly pays a speed bonus. Structures grow
     from 3x3 up to 6x6 with more block types as the levels climb.
     Three hearts; a badly botched build costs one.
     ============================================================= */
  const BUILD_BLOCKS = [
    { key: "block.dirt", emoji: "🟫" },
    { key: "block.diamond", emoji: "💎" },
    { key: "block.grass", emoji: "🟩" },
    { key: "block.redstone", emoji: "🟥" },
    { key: "block.lapis", emoji: "🟦" },
    { key: "block.gold", emoji: "🟨" },
    { key: "block.obsidian", emoji: "⬛" },
  ];

  const buildIt = {
    id: "build-it",
    icon: "🧱",
    nameKey: "game.build.name",
    descKey: "game.build.desc",
    howToKey: "game.build.howto",
    start(mount, onFinish) {
      const START_LIVES = 3;

      const setHud = buildHud(mount, [
        { id: "score", labelKey: "hud.points" },
        { id: "level", labelKey: "hud.level", value: 1 },
        { id: "lives", labelKey: "hud.lives", value: "❤️".repeat(START_LIVES) },
      ]);

      const banner = el("div", "build-banner");
      mount.appendChild(banner);
      const board = el("div", "build-grid");
      mount.appendChild(board);
      const palette = el("div", "build-palette");
      mount.appendChild(palette);
      const doneBtn = el("button", "continue-btn build-done", T("game.build.done"));
      doneBtn.type = "button";
      mount.appendChild(doneBtn);
      addHint(mount, "game.build.hint");

      let points = 0;
      let level = 1;
      let lives = START_LIVES;
      let built = 0;
      let perfects = 0;
      let placedTotal = 0;
      let wrongTotal = 0;
      let done = false;

      let target = [];     // the structure to copy: block key or null per cell
      let placed = [];     // what the player has built so far
      let selected = null;
      let size = 3;
      let phase = "memorise";
      let phaseEndsAt = 0;
      let buildSeconds = 0;

      const timers = [];
      const later = (fn, ms) => timers.push(setTimeout(fn, ms));

      // 3x3 at level 1, 5x5 by level 5, 6x6 from level 7 on.
      const sizeFor = (lvl) => Math.min(6, 3 + Math.floor((lvl - 1) / 2));
      const typesFor = (lvl) => Math.min(5, 1 + Math.ceil(lvl / 2));
      const memoriseFor = (lvl) => Math.max(1.6, 4.2 - lvl * 0.25);

      function newStructure() {
        size = sizeFor(level);
        const palettePool = [...BUILD_BLOCKS].sort(() => Math.random() - 0.5).slice(0, typesFor(level));
        const cells = size * size;
        // Between half and two thirds of the grid is solid - enough shape to
        // remember, enough empty space that position actually matters.
        const fillCount = Math.max(3, Math.round(cells * rand(0.5, 0.68)));
        const order = [...Array(cells).keys()].sort(() => Math.random() - 0.5);

        target = new Array(cells).fill(null);
        for (let i = 0; i < fillCount; i++) target[order[i]] = pick(palettePool).key;
        placed = new Array(cells).fill(null);

        // From level 4 the palette carries a block that isn't in the answer.
        const shown = [...palettePool];
        if (level >= 4) {
          const decoy = BUILD_BLOCKS.find((b) => !palettePool.some((p) => p.key === b.key));
          if (decoy) shown.push(decoy);
        }
        return shown.sort(() => Math.random() - 0.5);
      }

      function blockByKey(key) {
        return BUILD_BLOCKS.find((b) => b.key === key) || null;
      }

      function drawBoard(cellsToShow, interactive, marks) {
        board.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
        board.innerHTML = "";
        cellsToShow.forEach((key, index) => {
          const block = blockByKey(key);
          const cell = el(
            "button",
            `build-cell${key ? " filled" : ""}${marks ? ` ${marks[index]}` : ""}`,
            `<span class="build-emoji">${block ? block.emoji : ""}</span>`
          );
          cell.type = "button";
          if (interactive) cell.addEventListener("pointerdown", () => place(index));
          else cell.disabled = true;
          board.appendChild(cell);
        });
      }

      function drawPalette(blocks, interactive) {
        palette.innerHTML = "";
        blocks.forEach((block) => {
          const swatch = el(
            "button",
            `build-swatch${selected === block.key ? " active" : ""}`,
            `<span class="build-emoji">${block.emoji}</span><span class="build-swatch-name">${T(block.key)}</span>`
          );
          swatch.type = "button";
          swatch.disabled = !interactive;
          swatch.addEventListener("pointerdown", () => {
            selected = block.key;
            drawPalette(blocks, interactive);
          });
          palette.appendChild(swatch);
        });
      }

      function place(index) {
        if (done || phase !== "build") return;
        // Tapping a cell that already holds the selected block clears it.
        placed[index] = placed[index] === selected ? null : selected;
        drawBoard(placed, true, null);
      }

      /* ---- phases ---- */
      let paletteBlocks = [];

      function startLevel() {
        paletteBlocks = newStructure();
        selected = null;
        phase = "memorise";
        const secs = memoriseFor(level);
        phaseEndsAt = performance.now() + secs * 1000;
        setHud("level", level);
        drawBoard(target, false, null);
        drawPalette(paletteBlocks, false);
        doneBtn.disabled = true;
        board.classList.add("showing");
      }

      function startBuild() {
        phase = "build";
        board.classList.remove("showing");
        selected = paletteBlocks[0] ? paletteBlocks[0].key : null;
        buildSeconds = size * size * 1.5 + 8;
        phaseEndsAt = performance.now() + buildSeconds * 1000;
        drawBoard(placed, true, null);
        drawPalette(paletteBlocks, true);
        doneBtn.disabled = false;
      }

      function submit() {
        if (done || phase !== "build") return;
        phase = "review";
        doneBtn.disabled = true;

        const remaining = Math.max(0, phaseEndsAt - performance.now()) / 1000;
        let correct = 0;
        let wrong = 0;
        let filled = 0;
        const marks = [];
        for (let i = 0; i < target.length; i++) {
          if (target[i]) filled += 1;
          if (placed[i] && placed[i] === target[i]) {
            correct += 1;
            marks.push("mark-right");
          } else if (placed[i]) {
            wrong += 1;
            marks.push("mark-wrong");
          } else {
            marks.push(target[i] ? "mark-missed" : "");
          }
        }

        const accuracy = filled ? correct / filled : 0;
        const perfect = correct === filled && wrong === 0;
        let gained = correct * 8 - wrong * 4;
        // Speed bonus, scaled by how much of the build clock was left.
        if (correct > 0) gained += Math.round(25 * (remaining / buildSeconds));
        if (perfect) gained += 20 * level;

        points = Math.max(0, points + gained);
        placedTotal += correct + wrong;
        wrongTotal += wrong;
        built += 1;
        if (perfect) perfects += 1;
        setHud("score", points);

        // Show the answer with right/wrong/missed marks before moving on.
        drawBoard(target, false, marks);
        banner.className = `build-banner ${perfect ? "perfect" : "review"}`;
        banner.textContent = perfect
          ? T("game.build.perfect")
          : T("game.build.scored", { correct, total: filled });

        if (accuracy < 0.6) {
          lives -= 1;
          setHud("lives", "❤️".repeat(Math.max(0, lives)) || "💀");
        }

        later(() => {
          if (done) return;
          if (lives <= 0) return finish();
          level += 1;
          startLevel();
        }, 1500);
      }

      doneBtn.addEventListener("click", submit);

      startLevel();

      const stop = loop(() => {
        if (phase === "review") return;
        const left = Math.max(0, (phaseEndsAt - performance.now()) / 1000);
        if (phase === "memorise") {
          banner.className = "build-banner memorise";
          banner.textContent = T("game.build.memorise", { secs: Math.ceil(left) });
          if (left <= 0) startBuild();
        } else {
          banner.className = "build-banner building";
          banner.textContent = T("game.build.rebuild", { secs: Math.ceil(left) });
          if (left <= 0) submit(); // out of time - score whatever is on the grid
        }
      });

      function finish() {
        if (done) return;
        done = true;
        stop();
        timers.forEach(clearTimeout);
        onFinish({
          points,
          scoreLabelKey: "hud.points",
          detail: [
            ["result.levelsBuilt", built],
            ["result.perfectBuilds", perfects],
            ["result.blocksPlaced", placedTotal],
            ["result.wrongBlocks", wrongTotal],
          ],
        });
      }

      return () => {
        done = true;
        stop();
        timers.forEach(clearTimeout);
      };
    },
  };

  /* ----------------------------- registry ----------------------------- */
  const list = [bowShot, blockBreaker, windDodge, diamondRush, buildIt];
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
