function formatUptime(releaseDateISO) {
  const start = new Date(releaseDateISO).getTime();
  const now = Date.now();
  if (Number.isNaN(start) || now < start) return { days: 0, hours: 0 };
  const diffMs = now - start;
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
  return { days, hours };
}

async function loadHome() {
  const cfg = await getSiteConfig();

  document.title = `${cfg.serverName} — Home`;
  document.getElementById("hero-logo").src = cfg.logo || "/images/site/logo.svg";
  document.getElementById("hero-title").textContent = cfg.serverName;
  document.getElementById("hero-tagline").textContent = cfg.tagline || "";
  document.getElementById("welcome-message").textContent = cfg.welcomeMessage || "";

  const discordBtn = document.getElementById("discord-btn");
  discordBtn.href = cfg.discordInvite || "#";

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

  document.getElementById("season-value").textContent = cfg.season || "—";
  document.getElementById("release-value").textContent = cfg.releaseDate
    ? new Date(cfg.releaseDate).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : "—";

  const { days, hours } = formatUptime(cfg.releaseDate);
  document.getElementById("uptime-value").textContent = `${days}d ${hours}h`;

  refreshStatus();
  setInterval(refreshStatus, 30000);
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
