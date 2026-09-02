/* =============================================================
   AngkorSMP arcade — six self-contained mini-games.

   Every game follows the same contract so the hub can launch any of
   them the same way:

     Arcade.games[id] = {
       id, icon, nameKey, descKey, howToKey,
       start(mount, onFinish)   // render into `mount`, call onFinish(result)
     }

   `onFinish` receives { points, detail[] }. Games only ever report
   POINTS — how many coins that is worth is decided by the server (see
   routes/games.js), which also enforces the five-plays-a-day-per-game
   limit and the 500 coins/day allowance. Nothing here hands out coins.

   Every game ends in a results screen with a Play Again button.
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

  // Block textures live in /images/blocks and are shared by every game.
  const TEXTURES = {};
  function texture(name) {
    if (!TEXTURES[name]) {
      const img = new Image();
      img.src = `/images/blocks/${name}.png`;
      TEXTURES[name] = img;
    }
    return TEXTURES[name];
  }
  // Draw a texture, falling back to a flat colour until it has loaded.
  function drawTex(ctx, name, x, y, w, h, fallback) {
    const img = texture(name);
    if (img.complete && img.naturalWidth) ctx.drawImage(img, x, y, w, h);
    else {
      ctx.fillStyle = fallback || "#7a7a7a";
      ctx.fillRect(x, y, w, h);
    }
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

  // "+5" style popup at a point inside a container.
  function floatText(host, x, y, text, kind) {
    const node = el("span", `float-text ${kind || "good"}`, text);
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    host.appendChild(node);
    setTimeout(() => node.remove(), 700);
  }

  // Shared by every game's loop() below: true while the hub's countdown is
  // still running. The game has already been mounted and painted one frame
  // (see each game's early draw() call) so it's visible, just not ticking -
  // that's what lets the countdown overlay a real, still frame instead of a
  // blank screen.
  let frozen = false;
  function setFrozen(value) {
    frozen = value;
  }

  // requestAnimationFrame loop with a delta in seconds; returns a stopper.
  function loop(step) {
    let raf = 0;
    let last = performance.now();
    let running = true;
    const frame = (now) => {
      if (!running) return;
      if (frozen) {
        last = now; // keep dt from jumping once play resumes
        raf = requestAnimationFrame(frame);
        return;
      }
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
      ctx.imageSmoothingEnabled = false; // keep the pixel art crisp
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

  // The eight blocks Block Breaker and the parkour course share.
  const BLOCKS = [
    { key: "block.grass", tex: "grass", colour: "#6aaa4a" },
    { key: "block.dirt", tex: "dirt", colour: "#866043" },
    { key: "block.stone", tex: "stone", colour: "#808080" },
    { key: "block.planks", tex: "planks", colour: "#b28956" },
    { key: "block.diamond", tex: "diamond", colour: "#61dbd6" },
    { key: "block.gold", tex: "gold", colour: "#f6d03d" },
    { key: "block.redstone", tex: "redstone", colour: "#b02e26" },
    { key: "block.obsidian", tex: "obsidian", colour: "#160f26" },
  ];

  /* =============================================================
     1. 🌋 LAVA RUN — climb a 100m tower before the lava catches you.
     The player bounces automatically; you only steer left and right,
     which keeps it playable one-handed on a phone. A rail down the
     left edge shows the finish, where you are, and where the lava is.
     ============================================================= */
  const lavaRun = {
    id: "lava-run",
    icon: "🌋",
    nameKey: "game.lava.name",
    descKey: "game.lava.desc",
    howToKey: "game.lava.howto",
    start(mount, onFinish) {
      const PLATFORMS = 100;         // the course is 100m tall
      const GAP = 66;                // vertical spacing between platforms
      const CHECKPOINT_EVERY = 20;   // 5 checkpoints on the way up
      const GRAVITY = 1500;
      const JUMP_V = -680;           // apex is ~154px, comfortably over one gap
      const MOVE_SPEED = 340;
      // The furthest the next ledge is ever placed sideways. A bounce gives
      // about 0.75s of air, which at MOVE_SPEED covers ~250px - so anything
      // inside this is genuinely reachable, and the course is always climbable.
      const MAX_SIDE_STEP = 165;
      const PAR_SECONDS = 90;

      const setHud = buildHud(mount, [
        { id: "score", labelKey: "hud.points" },
        { id: "gems", labelKey: "hud.diamonds" },
        { id: "height", labelKey: "hud.height", value: "0m" },
      ]);
      const stage = buildStage(mount, "lava-stage");
      addHint(mount, "game.lava.hint");
      const { canvas, ctx, dispose } = fitCanvas(stage);

      const RAIL_W = 30; // the progress rail down the left edge
      const W = () => Number(canvas.dataset.w);
      const H = () => Number(canvas.dataset.h);
      const playW = () => W() - RAIL_W;

      /* ---- build the course ---- */
      // y is measured upward from the floor; the camera converts to screen.
      const platforms = [];
      const diamonds = [];
      const FLOOR_Y = 0;
      const TOP_Y = PLATFORMS * GAP;

      function buildCourse() {
        const w = playW();
        platforms.length = 0;
        diamonds.length = 0;

        // A full-width stone floor plus a wide starting ledge: a fumbled first
        // bounce drops you back onto the floor instead of straight into the
        // lava. The floor is swallowed within a few seconds, which is what
        // starts the climb.
        platforms.push({ x: 0, y: FLOOR_Y, w, kind: "floor", vx: 0, gone: false, fading: 0 });
        const startW = Math.min(180, w - 40);
        platforms.push({ x: w / 2 - startW / 2, y: FLOOR_Y + 26, w: startW, kind: "solid", vx: 0, gone: false, fading: 0 });

        let prevCenter = w / 2;
        for (let i = 1; i <= PLATFORMS; i++) {
          const difficulty = i / PLATFORMS; // 0 at the bottom, 1 at the top
          const checkpoint = i % CHECKPOINT_EVERY === 0;
          // Ledges narrow as you climb; checkpoints stay generous.
          const width = checkpoint
            ? Math.min(140, w - 40)
            : Math.max(62, Math.round(rand(112, 146) - difficulty * 52));

          // Each ledge sits within one bounce of the last one.
          const half = width / 2;
          const center = clamp(
            prevCenter + rand(-MAX_SIDE_STEP, MAX_SIDE_STEP),
            half + 6,
            Math.max(half + 6, w - half - 6)
          );
          prevCenter = center;

          let kind = "solid";
          if (i > 6 && !checkpoint) {
            const roll = Math.random();
            if (roll < 0.1 + difficulty * 0.2) kind = "moving";
            else if (roll < 0.16 + difficulty * 0.36) kind = "crumble";
          }

          platforms.push({
            x: center - half,
            y: FLOOR_Y + 26 + i * GAP,
            w: width,
            kind,
            checkpoint,
            claimed: false,
            vx: kind === "moving" ? rand(40, 62) * (1 + difficulty) * (Math.random() < 0.5 ? -1 : 1) : 0,
            gone: false,
            fading: 0,
          });

          if (!checkpoint && Math.random() < 0.13) {
            diamonds.push({ x: center, y: FLOOR_Y + 26 + i * GAP + 36, taken: false });
          }
        }
      }
      buildCourse();

      const player = { x: playW() / 2, y: FLOOR_Y + 60, vy: 0, r: 13, targetX: null };
      let camera = 0;          // world y at the bottom of the screen
      let lavaY = FLOOR_Y - 240;
      let points = 0;
      let gems = 0;
      let checkpoints = 0;
      let best = 0;            // highest y reached
      let elapsed = 0;
      let done = false;

      // Lava creeps faster the higher you get - the top of the tower is a
      // sprint - but never quite outpaces a clean climb (~90px/s).
      function lavaSpeed() {
        return Math.min(86, 24 + (best / TOP_Y) * 52 + elapsed * 0.2);
      }

      /* ---- controls: drag to steer, or arrow keys / A-D ---- */
      const keys = new Set();
      const onKeyDown = (e) => {
        const k = e.key.toLowerCase();
        if (["arrowleft", "arrowright", "a", "d"].includes(k)) e.preventDefault();
        keys.add(k);
      };
      const onKeyUp = (e) => keys.delete(e.key.toLowerCase());
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);

      const steer = (event) => {
        const box = stage.getBoundingClientRect();
        player.targetX = clamp(event.clientX - box.left - RAIL_W, player.r, playW() - player.r);
      };
      const onDown = (event) => {
        stage.setPointerCapture?.(event.pointerId);
        steer(event);
      };
      const onMove = (event) => {
        if (event.pressure > 0 || event.pointerType === "mouse") steer(event);
      };
      const onUp = () => {
        player.targetX = null;
      };
      stage.addEventListener("pointerdown", onDown);
      stage.addEventListener("pointermove", onMove);
      stage.addEventListener("pointerup", onUp);
      stage.addEventListener("pointercancel", onUp);

      draw(); // paint the starting frame immediately - the countdown overlays on top of it, frozen, not a blank canvas
      const stop = loop((dt) => {
        elapsed += dt;
        const w = playW();
        const h = H();

        /* ---- horizontal steering ---- */
        let dir = 0;
        if (keys.has("arrowleft") || keys.has("a")) dir -= 1;
        if (keys.has("arrowright") || keys.has("d")) dir += 1;
        if (dir !== 0) {
          player.targetX = null;
          player.x += dir * MOVE_SPEED * dt;
        } else if (player.targetX != null) {
          player.x += (player.targetX - player.x) * Math.min(1, dt * 12);
        }
        // Walk out one side, come back in the other - a classic climber trick
        // that stops narrow ledges near the wall from being unfair.
        if (player.x < -player.r) player.x = w + player.r;
        if (player.x > w + player.r) player.x = -player.r;

        /* ---- gravity + auto-bounce ---- */
        player.vy += GRAVITY * dt;
        const prevY = player.y;
        player.y -= player.vy * dt; // vy is screen-style: negative goes up

        for (const p of platforms) {
          if (p.gone) continue;
          if (p.vx) {
            p.x += p.vx * dt;
            if (p.x < 0 || p.x + p.w > w) {
              p.vx *= -1;
              p.x = clamp(p.x, 0, Math.max(0, w - p.w));
            }
          } else if (p.x + p.w > w) {
            p.x = Math.max(0, w - p.w); // the panel was resized mid-run
          }
          // Land only while falling, and only when crossing the top face.
          const falling = player.vy > 0;
          const crossed = prevY >= p.y && player.y <= p.y;
          const overlaps = player.x + player.r > p.x && player.x - player.r < p.x + p.w;
          if (falling && crossed && overlaps) {
            player.y = p.y;
            player.vy = JUMP_V;
            if (p.kind === "crumble") p.fading = 0.35; // one bounce and it's gone

            if (p.checkpoint && !p.claimed) {
              p.claimed = true;
              checkpoints += 1;
              points += 15;
              floatText(stage, RAIL_W + player.x, h - (player.y - camera), "+15", "good");
            }
          }
        }

        for (const p of platforms) {
          if (p.fading > 0) {
            p.fading -= dt;
            if (p.fading <= 0) p.gone = true;
          }
        }

        if (player.y > best) {
          // 1 point per metre climbed, awarded as you pass it.
          points += Math.floor(player.y / GAP) - Math.floor(best / GAP);
          best = player.y;
        }

        /* ---- diamonds ---- */
        for (const gem of diamonds) {
          if (gem.taken) continue;
          if (Math.abs(gem.x - player.x) < 20 && Math.abs(gem.y - player.y) < 24) {
            gem.taken = true;
            gems += 1;
            points += 15;
            floatText(stage, RAIL_W + gem.x, h - (gem.y - camera), "+15", "good");
          }
        }

        /* ---- camera follows, lava chases ---- */
        const wantCamera = Math.max(0, player.y - h * 0.42);
        camera += (wantCamera - camera) * Math.min(1, dt * 6);
        lavaY += lavaSpeed() * dt;
        // The lava never falls far behind, so there is no hiding - but it does
        // leave enough room to drop a couple of ledges and recover.
        lavaY = Math.max(lavaY, camera - h * 0.35);

        setHud("score", points);
        setHud("gems", gems);
        setHud("height", `${Math.round(best / GAP)}m`);

        if (player.y >= TOP_Y + 26) return finish(true);
        if (player.y <= lavaY) return finish(false);

        draw();
      });

      function draw() {
        const w = playW();
        const h = H();
        const toScreen = (worldY) => h - (worldY - camera);
        ctx.clearRect(0, 0, W(), h);

        ctx.save();
        ctx.translate(RAIL_W, 0);

        /* cave walls */
        ctx.fillStyle = "rgba(0,0,0,0.22)";
        ctx.fillRect(0, 0, 8, h);
        ctx.fillRect(w - 8, 0, 8, h);

        /* the finish line */
        const finishScreenY = toScreen(TOP_Y + 26);
        if (finishScreenY > -40 && finishScreenY < h + 40) {
          for (let i = 0; i < Math.ceil(w / 16); i++) {
            ctx.fillStyle = i % 2 ? "#fdfdfd" : "#2b2b2b";
            ctx.fillRect(i * 16, finishScreenY - 12, 16, 12);
          }
          ctx.fillStyle = "#ffd873";
          ctx.font = "bold 16px 'Baloo 2', sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("🏆 FINISH", w / 2, finishScreenY - 20);
        }

        /* platforms */
        for (const p of platforms) {
          if (p.gone) continue;
          const y = toScreen(p.y);
          if (y < -30 || y > h + 30) continue;
          ctx.globalAlpha = p.fading > 0 ? Math.max(0.2, p.fading / 0.35) : 1;
          const thickness = p.kind === "floor" ? 22 : 14;
          const tex = p.checkpoint
            ? "gold"
            : p.kind === "moving" ? "diamond"
            : p.kind === "crumble" ? "dirt"
            : p.kind === "floor" ? "stone"
            : "grass";
          for (let x = p.x; x < p.x + p.w; x += thickness) {
            drawTex(ctx, tex, x, y, Math.min(thickness, p.x + p.w - x), thickness);
          }
          ctx.strokeStyle = "rgba(0,0,0,0.5)";
          ctx.lineWidth = 2;
          ctx.strokeRect(p.x, y, p.w, thickness);
          if (p.checkpoint) {
            ctx.font = "bold 13px 'Baloo 2', sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("🏃", p.x + p.w / 2, y - 4);
          }
          ctx.globalAlpha = 1;
        }

        /* diamonds */
        for (const gem of diamonds) {
          if (gem.taken) continue;
          const y = toScreen(gem.y);
          if (y < -20 || y > h + 20) continue;
          drawTex(ctx, "diamond", gem.x - 9, y - 9, 18, 18, "#61dbd6");
          ctx.strokeStyle = "#1c7d92";
          ctx.lineWidth = 2;
          ctx.strokeRect(gem.x - 9, y - 9, 18, 18);
        }

        /* the player */
        const py = toScreen(player.y);
        drawPlayerHead(ctx, player.x, py);

        /* the lava */
        const lavaScreenY = toScreen(lavaY);
        if (lavaScreenY < h + 20) {
          const grad = ctx.createLinearGradient(0, lavaScreenY, 0, h);
          grad.addColorStop(0, "#ffb43c");
          grad.addColorStop(0.35, "#ff6a1f");
          grad.addColorStop(1, "#c01c06");
          ctx.fillStyle = grad;
          ctx.fillRect(0, lavaScreenY, w, h - lavaScreenY + 4);
          ctx.fillStyle = "#ffd873";
          for (let x = 0; x < w; x += 18) {
            const bob = Math.sin(elapsed * 4 + x * 0.08) * 4;
            ctx.fillRect(x, lavaScreenY - 4 + bob, 14, 6);
          }
        }

        ctx.restore();
        drawRail(h);
      }

      // The left-hand rail: the whole 100m at a glance — finish at the top,
      // you in the middle, the lava creeping up from below.
      function drawRail(h) {
        const pad = 10;
        const top = pad;
        const bottom = h - pad;
        const span = bottom - top;
        const at = (worldY) => bottom - clamp(worldY / (TOP_Y + 26), 0, 1) * span;

        ctx.fillStyle = "rgba(0,0,0,0.42)";
        ctx.fillRect(0, 0, RAIL_W, h);
        ctx.fillStyle = "rgba(255,255,255,0.14)";
        ctx.fillRect(RAIL_W / 2 - 3, top, 6, span);

        // lava fill
        const lavaTop = at(Math.max(0, lavaY));
        ctx.fillStyle = "rgba(255,106,31,0.85)";
        ctx.fillRect(RAIL_W / 2 - 3, lavaTop, 6, bottom - lavaTop);

        // checkpoints
        ctx.fillStyle = "rgba(255,216,115,0.75)";
        for (let i = CHECKPOINT_EVERY; i <= PLATFORMS; i += CHECKPOINT_EVERY) {
          const y = at(FLOOR_Y + 26 + i * GAP);
          ctx.fillRect(RAIL_W / 2 - 6, y - 1, 12, 2);
        }

        // finish flag
        ctx.font = "11px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("🏆", RAIL_W / 2, top + 2);

        // you
        const you = at(player.y);
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(RAIL_W / 2, you, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#2b2b2b";
        ctx.lineWidth = 2;
        ctx.stroke();

        // metres climbed, printed sideways up the rail
        ctx.save();
        ctx.translate(RAIL_W - 6, h / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.font = "bold 10px 'Baloo 2', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${Math.round(best / GAP)}m / ${PLATFORMS}m`, 0, 0);
        ctx.restore();
      }

      function finish(reachedTop) {
        if (done) return;
        done = true;
        stop();
        cleanup();

        let speedBonus = 0;
        if (reachedTop) {
          points += 100;
          // Every second under par is worth 2 points, up to 60.
          speedBonus = Math.round(clamp((PAR_SECONDS - elapsed) * 2, 0, 60));
          points += speedBonus;
        }

        onFinish({
          points,
          detail: [
            ["result.height", `${Math.round(best / GAP)}m / ${PLATFORMS}m`],
            ["result.diamonds", gems],
            ["result.checkpoints", checkpoints],
            ["result.runTime", fmtTime(elapsed)],
            ["result.outcome", T(reachedTop ? "result.finished" : "result.burned")],
          ],
        });
      }

      function cleanup() {
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        stage.removeEventListener("pointerdown", onDown);
        stage.removeEventListener("pointermove", onMove);
        stage.removeEventListener("pointerup", onUp);
        stage.removeEventListener("pointercancel", onUp);
        dispose();
      }

      return () => {
        done = true;
        stop();
        cleanup();
      };
    },
  };

  // A little Steve-ish head, shared by the climbing and parkour games.
  function drawPlayerHead(ctx, x, baselineY) {
    ctx.fillStyle = "#3b2a1c";
    ctx.fillRect(x - 13, baselineY - 26, 26, 26);
    ctx.fillStyle = "#c99a6b";
    ctx.fillRect(x - 10, baselineY - 19, 20, 16);
    ctx.fillStyle = "#fff";
    ctx.fillRect(x - 8, baselineY - 16, 6, 5);
    ctx.fillRect(x + 2, baselineY - 16, 6, 5);
    ctx.fillStyle = "#2b6cc4";
    ctx.fillRect(x - 6, baselineY - 15, 3, 3);
    ctx.fillRect(x + 4, baselineY - 15, 3, 3);
  }

  /* =============================================================
     2. ⛏️ BLOCK BREAKER — four levels of ten blocks each, on grids
     that grow 2x3 → 3x3 → 3x4 → 4x4. Break only the block named at
     the top; a wrong tap costs you a second off the clock. Clearing
     all four levels before time runs out pays the full reward.
     ============================================================= */
  const blockBreaker = {
    id: "block-breaker",
    icon: "⛏️",
    nameKey: "game.breaker.name",
    descKey: "game.breaker.desc",
    howToKey: "game.breaker.howto",
    start(mount, onFinish) {
      const ROUND_SECONDS = 50;
      const PER_LEVEL = 10; // blocks to break to clear a level
      const LEVELS = [
        { cols: 3, rows: 2, multiplier: 1 },
        { cols: 3, rows: 3, multiplier: 1.5 },
        { cols: 4, rows: 3, multiplier: 2 },
        { cols: 4, rows: 4, multiplier: 2.5 },
      ];

      const setHud = buildHud(mount, [
        { id: "score", labelKey: "hud.points" },
        { id: "level", labelKey: "hud.level", value: "1/4" },
        { id: "left", labelKey: "hud.toGo", value: PER_LEVEL },
        { id: "time", labelKey: "hud.time", value: ROUND_SECONDS },
      ]);

      const targetBar = el(
        "div",
        "bb-target",
        `<span class="bb-target-label" data-i18n="game.breaker.target">${T("game.breaker.target")}</span>
         <img class="bb-target-tex" alt="" />
         <span class="bb-target-block"></span>`
      );
      mount.appendChild(targetBar);
      const targetName = targetBar.querySelector(".bb-target-block");
      const targetTex = targetBar.querySelector(".bb-target-tex");

      const grid = el("div", "bb-grid");
      grid.style.position = "relative";
      mount.appendChild(grid);
      addHint(mount, "game.breaker.hint");

      let points = 0;
      let level = 0;       // index into LEVELS
      let cleared = 0;     // blocks broken in the current level
      let correct = 0;
      let wrong = 0;
      let elapsed = 0;
      let penalty = 0;     // seconds lost to wrong taps
      let shownAt = 0;
      let target = null;
      let targetLeft = 0; // how many copies of the target are still live on the grid
      let allDone = false;
      let done = false;

      function deal() {
        const spec = LEVELS[level];
        const count = spec.cols * spec.rows;
        const pool = [...BLOCKS].sort(() => Math.random() - 0.5).slice(0, Math.min(count, BLOCKS.length));
        while (pool.length < count) pool.push(pick(BLOCKS)); // repeats raise the difficulty
        target = pick(pool);
        targetLeft = pool.filter((b) => b.key === target.key).length;

        targetName.textContent = T(target.key);
        targetTex.src = `/images/blocks/${target.tex}.png`;

        // Fixed, capped tile size instead of 1fr - a 4x4 grid at full panel
        // width got tall enough to push the Save/target bar off-screen and
        // force scrolling mid-round. This keeps tiles compact on every
        // screen size and lets the grid center itself instead of stretching.
        grid.style.gridTemplateColumns = `repeat(${spec.cols}, min(72px, 17vw))`;
        grid.innerHTML = "";
        pool
          .sort(() => Math.random() - 0.5)
          .forEach((block) => {
            const cell = el(
              "button",
              "bb-cell",
              `<img class="bb-tex" src="/images/blocks/${block.tex}.png" alt="" draggable="false" />`
            );
            cell.type = "button";
            cell.style.setProperty("--bb", block.colour);
            let broken = false;
            cell.addEventListener("pointerdown", (event) => {
              if (broken) return; // this one's already been hit - only unbroken cells still respond
              if (block.key === target.key) broken = true;
              tap(event, cell, block);
            });
            grid.appendChild(cell);
          });
        shownAt = performance.now();
        setHud("level", `${level + 1}/${LEVELS.length}`);
        setHud("left", PER_LEVEL - cleared);
      }

      function tap(event, cell, block) {
        if (done) return;
        const box = grid.getBoundingClientRect();
        const px = event.clientX - box.left;
        const py = event.clientY - box.top;

        if (block.key === target.key) {
          const reaction = (performance.now() - shownAt) / 1000;
          // 3 base, up to 4 more for breaking it inside a second and a half,
          // then scaled by which level you are on.
          const speedBonus = Math.round(clamp(4 * (1 - reaction / 1.5), 0, 4));
          const gained = Math.round((3 + speedBonus) * LEVELS[level].multiplier);
          points += gained;
          correct += 1;
          cell.classList.add("hit");
          cell.disabled = true;
          setHud("score", points);
          floatText(grid, px, py, `+${gained}`, "good");

          targetLeft -= 1;
          if (targetLeft > 0) return; // more copies of this block still standing

          cleared += 1;
          setHud("left", Math.max(0, PER_LEVEL - cleared));

          if (cleared >= PER_LEVEL) {
            if (level + 1 >= LEVELS.length) {
              allDone = true;
              points += 60; // clearing the whole set
              setHud("score", points);
              return finish();
            }
            level += 1;
            cleared = 0;
            grid.classList.add("bb-levelup");
            setTimeout(() => grid.classList.remove("bb-levelup"), 350);
            setTimeout(() => { if (!done) deal(); }, 340);
            return;
          }
          setTimeout(() => { if (!done) deal(); }, 90);
        } else {
          // A wrong block costs a second of clock, not points.
          penalty += 1;
          wrong += 1;
          cell.classList.add("miss");
          setTimeout(() => cell.classList.remove("miss"), 260);
          floatText(grid, px, py, T("game.breaker.penalty"), "bad");
        }
      }

      deal();

      const stop = loop((dt) => {
        elapsed += dt;
        const left = ROUND_SECONDS - elapsed - penalty;
        setHud("time", Math.max(0, Math.ceil(left)));
        if (left <= 0) finish();
      });

      function finish() {
        if (done) return;
        done = true;
        stop();
        onFinish({
          points,
          blocksBroken: correct, // drives the coin payout server-side - see lib/gamestats.js coinsForBreaker
          detail: [
            ["result.levelsCleared", allDone ? `${LEVELS.length}/${LEVELS.length}` : `${level}/${LEVELS.length}`],
            ["result.blocksBroken", correct],
            ["result.wrongBlocks", wrong],
            ["result.timeLost", `${penalty}s`],
            ["result.outcome", T(allDone ? "result.allCleared" : "result.timeUp")],
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
     more points, near misses pay a dodge bonus, emeralds are worth 5.
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
      let spawnIn = 1.8;
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
        const speed = 95 + elapsed * 4;
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

      draw(); // paint the starting frame immediately - the countdown overlays on top of it, frozen, not a blank canvas
      const stop = loop((dt) => {
        elapsed += dt;

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

        /* +1 point per second alive */
        survivalCarry += dt;
        while (survivalCarry >= 1) {
          survivalCarry -= 1;
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
            points += 5;
            floatText(stage, gem.x, gem.y, "+5", "good");
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
          const blink = gem.life < 1.5 && Math.floor(gem.life * 8) % 2;
          ctx.globalAlpha = blink ? 0.45 : 1;
          drawTex(ctx, "ore-emerald", gem.x - 11, gem.y - 11, 22, 22, "#2fbf6a");
          ctx.globalAlpha = 1;
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

        drawPlayerHead(ctx, player.x, player.y + 13);
      }

      function finish() {
        if (done) return;
        done = true;
        stop();
        cleanup();
        onFinish({
          points,
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
     4. 💎 DIAMOND RUSH — 30 hard seconds in a small mine. Tap ore to
     mine it: Coal +1, Iron +2, Gold +4, Diamond +8, Emerald +12.
     One tap on TNT and the run is over, so look before you swing —
     and the seam reshuffles faster and faster.
     ============================================================= */
  const ORES = [
    { key: "ore.stone", tex: "stone", value: 0, weight: 30 },
    { key: "ore.coal", tex: "ore-coal", value: 1, weight: 22 },
    { key: "ore.iron", tex: "ore-iron", value: 2, weight: 17 },
    { key: "ore.gold", tex: "ore-gold", value: 3, weight: 13 },
    { key: "ore.diamond", tex: "ore-diamond", value: 4, weight: 8 },
    { key: "ore.emerald", tex: "ore-emerald", value: 6, weight: 5 },
    { key: "ore.tnt", tex: "tnt", value: -1, weight: 5 },
  ];

  const diamondRush = {
    id: "diamond-rush",
    icon: "💎",
    nameKey: "game.rush.name",
    descKey: "game.rush.desc",
    howToKey: "game.rush.howto",
    start(mount, onFinish) {
      const ROUND_SECONDS = 30;
      const COLS = 5;
      const ROWS = 4;
      const CELLS = COLS * ROWS;

      const setHud = buildHud(mount, [
        { id: "score", labelKey: "hud.points" },
        { id: "ores", labelKey: "hud.ores" },
        { id: "time", labelKey: "hud.time", value: ROUND_SECONDS },
      ]);

      const grid = el("div", "mine-grid");
      // Fixed, capped tile size instead of 1fr - see the same fix in Block
      // Breaker for why: 1fr made the grid tall enough to require scrolling.
      grid.style.gridTemplateColumns = `repeat(${COLS}, min(58px, 15vw))`;
      mount.appendChild(grid);
      addHint(mount, "game.rush.hint");

      let points = 0;
      let mined = 0;
      let gems = 0;
      let best = ORES[0];
      let elapsed = 0;
      let shuffleIn = 3;
      let blownUp = false;
      let done = false;
      const timers = [];
      const later = (fn, ms) => timers.push(setTimeout(fn, ms));

      // TNT gets steadily more common as the clock runs down.
      function weightFor(ore) {
        if (ore.key !== "ore.tnt") return ore.weight;
        return ore.weight * (1 + (elapsed / ROUND_SECONDS) * 1.8);
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

      const cells = [];
      for (let i = 0; i < CELLS; i++) {
        const node = el("button", "mine-cell", '<img class="mine-tex" alt="" draggable="false" />');
        node.type = "button";
        const cell = { node, ore: rollOre(), empty: false };
        paint(cell);
        node.addEventListener("pointerdown", (event) => dig(event, cell));
        grid.appendChild(node);
        cells.push(cell);
      }

      function paint(cell) {
        const img = cell.node.querySelector(".mine-tex");
        if (cell.empty) {
          img.removeAttribute("src");
          img.style.visibility = "hidden";
        } else {
          img.src = `/images/blocks/${cell.ore.tex}.png`;
          img.style.visibility = "visible";
        }
        cell.node.classList.toggle("mined", cell.empty);
        cell.node.classList.toggle("tnt", !cell.empty && cell.ore.key === "ore.tnt");
      }

      function dig(event, cell) {
        if (done || cell.empty) return;
        const ore = cell.ore;
        const box = grid.getBoundingClientRect();
        const px = event.clientX - box.left;
        const py = event.clientY - box.top;

        if (ore.key === "ore.tnt") {
          // One wrong swing ends the run.
          blownUp = true;
          grid.classList.add("mine-boom");
          floatText(grid, px, py, "💥", "bad");
          return finish();
        }

        points += ore.value;
        if (ore.value > 0) mined += 1;
        if (ore.value >= 8) gems += 1;
        if (ore.value > best.value) best = ore;
        floatText(grid, px, py, ore.value ? `+${ore.value}` : T("game.rush.rubble"), ore.value ? "good" : "bad");

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
        }, 280);
      }

      // "Ores moving": every so often the whole face reshuffles, faster and
      // faster, so the diamond you spotted may be TNT by the time you reach it.
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
          shuffleIn = Math.max(1.2, 3 - elapsed * 0.06);
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
          detail: [
            ["result.oresMined", mined],
            ["result.gems", gems],
            ["result.bestFind", best.value > 0 ? T(best.key) : "—"],
            ["result.survived", fmtTime(elapsed)],
            ["result.outcome", T(blownUp ? "result.blownUp" : "result.timeUp")],
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
     5. 💥 TNT ESCAPE — a small arena. TNT lands around you, flashes a
     blast circle, and goes off. Keep moving; one explosion catching
     you ends the run. Survive the 45 seconds to clear it.
     ============================================================= */
  const tntEscape = {
    id: "tnt-escape",
    icon: "💥",
    nameKey: "game.tnt.name",
    descKey: "game.tnt.desc",
    howToKey: "game.tnt.howto",
    start(mount, onFinish) {
      const ROUND_SECONDS = 45;

      const setHud = buildHud(mount, [
        { id: "score", labelKey: "hud.points" },
        { id: "dodges", labelKey: "hud.dodges" },
        { id: "time", labelKey: "hud.time", value: ROUND_SECONDS },
      ]);
      const stage = buildStage(mount, "tnt-stage");
      addHint(mount, "game.tnt.hint");
      const { canvas, ctx, dispose } = fitCanvas(stage);

      const W = () => Number(canvas.dataset.w);
      const H = () => Number(canvas.dataset.h);

      const player = { x: W() / 2, y: H() / 2, r: 12, tx: W() / 2, ty: H() / 2 };
      const bombs = [];
      const blasts = [];
      const keys = new Set();

      let points = 0;
      let dodges = 0;
      let elapsed = 0;
      let survivalCarry = 0;
      let spawnIn = 2.2; // a breath before the first stick lands
      let survived = false;
      let done = false;

      /* --- controls: drag, or arrow keys / WASD --- */
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

      function spawnBomb() {
        const progress = elapsed / ROUND_SECONDS;
        // Later bombs land closer to you, with a shorter fuse and a wider blast.
        // The first few seconds are deliberately scattershot.
        const aimAtPlayer = elapsed > 5 && Math.random() < 0.35 + progress * 0.4;
        const spread = 150 - progress * 70;
        const x = aimAtPlayer
          ? clamp(player.x + rand(-spread, spread), 24, W() - 24)
          : rand(24, W() - 24);
        const y = aimAtPlayer
          ? clamp(player.y + rand(-spread, spread), 24, H() - 24)
          : rand(24, H() - 24);
        bombs.push({
          x, y,
          fuse: Math.max(0.8, 1.7 - progress * 0.75),
          maxFuse: Math.max(0.8, 1.7 - progress * 0.75),
          radius: 46 + progress * 30,
          counted: false,
        });
      }

      draw(); // paint the starting frame immediately - the countdown overlays on top of it, frozen, not a blank canvas
      const stop = loop((dt) => {
        elapsed += dt;

        const kbSpeed = 330 * dt;
        if (keys.has("arrowleft") || keys.has("a")) player.tx -= kbSpeed;
        if (keys.has("arrowright") || keys.has("d")) player.tx += kbSpeed;
        if (keys.has("arrowup") || keys.has("w")) player.ty -= kbSpeed;
        if (keys.has("arrowdown") || keys.has("s")) player.ty += kbSpeed;
        player.tx = clamp(player.tx, player.r, W() - player.r);
        player.ty = clamp(player.ty, player.r, H() - player.r);
        player.x += (player.tx - player.x) * Math.min(1, dt * 14);
        player.y += (player.ty - player.y) * Math.min(1, dt * 14);

        /* +3 points per second alive */
        survivalCarry += dt;
        while (survivalCarry >= 1) {
          survivalCarry -= 1;
          points += 3;
        }

        spawnIn -= dt;
        if (spawnIn <= 0) {
          spawnBomb();
          spawnIn = Math.max(0.28, rand(0.6, 1.1) - elapsed * 0.012);
        }

        for (let i = bombs.length - 1; i >= 0; i--) {
          const b = bombs[i];
          b.fuse -= dt;
          if (b.fuse > 0) continue;

          const dist = Math.hypot(b.x - player.x, b.y - player.y);
          blasts.push({ x: b.x, y: b.y, radius: b.radius, life: 0.35 });
          bombs.splice(i, 1);
          if (dist < b.radius + player.r) return finish(false);
          // Standing just outside the blast pays.
          if (dist < b.radius + player.r + 34) {
            dodges += 1;
            points += 5;
            floatText(stage, player.x, player.y - 20, "+5", "good");
          }
        }

        for (let i = blasts.length - 1; i >= 0; i--) {
          blasts[i].life -= dt;
          if (blasts[i].life <= 0) blasts.splice(i, 1);
        }

        setHud("score", points);
        setHud("dodges", dodges);
        setHud("time", Math.max(0, Math.ceil(ROUND_SECONDS - elapsed)));

        if (elapsed >= ROUND_SECONDS) return finish(true);
        draw();
      });

      function draw() {
        const w = W();
        const h = H();
        ctx.clearRect(0, 0, w, h);

        // arena floor
        for (let y = 0; y < h; y += 32) {
          for (let x = 0; x < w; x += 32) {
            drawTex(ctx, (x / 32 + y / 32) % 2 ? "stone" : "dirt", x, y, 32, 32);
          }
        }
        ctx.fillStyle = "rgba(0,0,0,0.28)";
        ctx.fillRect(0, 0, w, h);

        // live blast circles, so you can see where NOT to be
        for (const b of bombs) {
          const t = 1 - b.fuse / b.maxFuse;
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 90, 40, ${0.10 + t * 0.26})`;
          ctx.fill();
          ctx.strokeStyle = `rgba(255, 170, 60, ${0.5 + t * 0.5})`;
          ctx.lineWidth = 3;
          ctx.stroke();

          const flash = b.fuse < 0.35 && Math.floor(b.fuse * 16) % 2;
          ctx.globalAlpha = flash ? 0.55 : 1;
          drawTex(ctx, "tnt", b.x - 14, b.y - 14, 28, 28, "#b02e26");
          ctx.globalAlpha = 1;
        }

        for (const blast of blasts) {
          const t = 1 - blast.life / 0.35;
          ctx.beginPath();
          ctx.arc(blast.x, blast.y, blast.radius * (0.7 + t * 0.5), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, ${Math.round(180 - t * 120)}, 60, ${0.75 * (1 - t)})`;
          ctx.fill();
        }

        drawPlayerHead(ctx, player.x, player.y + 13);
      }

      function finish(clearedIt) {
        if (done) return;
        done = true;
        survived = clearedIt;
        if (clearedIt) points += 40; // made it to the end
        stop();
        cleanup();
        onFinish({
          points,
          detail: [
            ["result.survived", fmtTime(elapsed)],
            ["result.dodges", dodges],
            ["result.outcome", T(clearedIt ? "result.survivedAll" : "result.blownUp")],
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

  /* ----------------------------- registry ----------------------------- */
  const list = [lavaRun, blockBreaker, windDodge, diamondRush, tntEscape];
  const byId = (id) => list.find((game) => game.id === id) || null;

  return {
    list,
    byId,
    // Resolved at call time so a language switch re-labels everything.
    name: (game) => T(game.nameKey),
    desc: (game) => T(game.descKey),
    howTo: (game) => T(game.howToKey),
    setFrozen,
  };
})();
