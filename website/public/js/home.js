async function loadHome() {
  const cfg = await getSiteConfig();

  document.title = `${cfg.serverName} — Home`;
  document.getElementById("hero-logo").src = cfg.logo || "/images/site/logo-full.png";
  const navLogo = document.getElementById("nav-logo");
  if (navLogo) navLogo.src = cfg.logoIcon || cfg.logo || "/images/site/logo-icon.png";
  document.getElementById("hero-title").textContent = cfg.serverName;
  document.getElementById("hero-tagline").textContent = cfg.tagline || "";
  document.getElementById("welcome-message").textContent = cfg.welcomeMessage || "";

  const telegramBtn = document.getElementById("telegram-btn");
  telegramBtn.href = cfg.telegramLink || "#";

  const ipBtn = document.getElementById("ip-btn");
  const javaAddress = `${cfg.javaIp}${cfg.javaPort && Number(cfg.javaPort) !== 25565 ? ":" + cfg.javaPort : ""}`;
  const mobile = isMobileDevice();
  ipBtn.querySelector(".ip-text").textContent = javaAddress;
  ipBtn.querySelector("small").textContent = mobile ? "Tap to join (Bedrock)" : "Click to copy IP";

  ipBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    if (mobile) {
      const bedrockAddr = `${cfg.bedrockIp}:${cfg.bedrockPort || 19132}`;
      const deepLink = `minecraft://?addExternalServer=${encodeURIComponent(cfg.serverName)}|${bedrockAddr}`;
      copyToClipboard(javaAddress);
      window.location.href = deepLink;
      showToast("Opening Minecraft (Bedrock)… Java IP also copied just in case!");
    } else {
      await copyToClipboard(javaAddress);
      showToast(`Copied "${javaAddress}" — paste it into Minecraft > Multiplayer > Add Server`);
    }
  });

  document.getElementById("release-value").textContent = formatConfigDate(cfg.releaseDate);
  document.getElementById("server-age-value").textContent = cfg.releaseDate
    ? formatDaysHours(daysHoursSince(cfg.releaseDate))
    : "—";

  document.getElementById("season-value").textContent = cfg.season || "—";
  document.getElementById("season-age-value").textContent = cfg.seasonStartDate
    ? formatDaysHours(daysHoursSince(cfg.seasonStartDate))
    : "—";

  renderFeatures(cfg.serverFeatures || []);

  refreshStatus();
  setInterval(refreshStatus, 30000);
}

function renderFeatures(features) {
  const grid = document.getElementById("feature-grid");
  grid.innerHTML = features
    .map((f) => {
      const tag = f.link ? "a" : "div";
      const href = f.link ? ` href="${escapeHtml(f.link)}"` : "";
      const cls = f.link ? "feature-card linked" : "feature-card";
      return `
        <${tag} class="${cls}"${href}>
          <div class="feature-icon">${escapeHtml(f.icon || "")}</div>
          <div class="feature-title">${escapeHtml(f.title || "")}</div>
          <div class="feature-desc">${escapeHtml(f.desc || "")}</div>
        </${tag}>`;
    })
    .join("");
}

async function refreshStatus() {
  const dot = document.getElementById("status-dot");
  const text = document.getElementById("status-text");
  try {
    const s = await fetchJSON("/api/status");
    dot.className = `status-dot ${s.online ? "online" : "offline"}`;
    text.textContent = s.online ? `Online — ${s.players.online}/${s.players.max} players` : "Server offline";
  } catch {
    dot.className = "status-dot offline";
    text.textContent = "Status unavailable";
  }
}

loadHome();
