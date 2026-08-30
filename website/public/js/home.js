let lastStatus = null;

async function loadHome() {
  const cfg = await getSiteConfig();

  // Keep it dynamic (reflects a renamed server), but keyword-rich rather
  // than "— Home" - this is what a JS-rendering crawler (Googlebot) sees
  // instead of the static SEO <title> once the page has loaded.
  document.title = cfg.tagline ? `${cfg.serverName} — ${cfg.tagline}` : cfg.serverName;
  document.getElementById("hero-logo").src = cfg.logo || "/images/site/logo-full.png";
  const navLogo = document.getElementById("nav-logo");
  if (navLogo) navLogo.src = cfg.logoIcon || cfg.logo || "/images/site/logo-icon.png";
  document.getElementById("hero-title").textContent = cfg.serverName;
  document.getElementById("hero-tagline").textContent = cfg.tagline || "";
  document.getElementById("welcome-message").textContent = cfg.welcomeMessage || "";

  document.getElementById("telegram-btn").href = cfg.telegramLink || "#";

  const ipBtn = document.getElementById("ip-btn");
  const javaAddress = `${cfg.javaIp}${cfg.javaPort && Number(cfg.javaPort) !== 25565 ? ":" + cfg.javaPort : ""}`;
  const mobile = isMobileDevice();
  ipBtn.querySelector(".ip-text").textContent = javaAddress;
  // The hint under the IP differs on phones, so it can't just be a data-i18n
  // attribute - it is re-rendered by applyLabels() on a language switch.
  ipBtn.querySelector("small").removeAttribute("data-i18n");

  ipBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    if (mobile) {
      const bedrockAddr = `${cfg.bedrockIp}:${cfg.bedrockPort || 19132}`;
      const deepLink = `minecraft://?addExternalServer=${encodeURIComponent(cfg.serverName)}|${bedrockAddr}`;
      copyToClipboard(javaAddress);
      window.location.href = deepLink;
      showToast(t("home.opening"));
    } else {
      await copyToClipboard(javaAddress);
      showToast(t("home.copied", { ip: javaAddress }));
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
  applyLabels(mobile);

  refreshStatus();
  setInterval(refreshStatus, 30000);

  document.addEventListener("i18n:change", () => {
    applyLabels(mobile);
    renderStatus(lastStatus);
    document.getElementById("release-value").textContent = formatConfigDate(cfg.releaseDate);
  });
}

function applyLabels(mobile) {
  const small = document.querySelector("#ip-btn small");
  if (small) small.textContent = mobile ? t("home.tapJoin") : t("home.copyIp");
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

function renderStatus(status) {
  const dot = document.getElementById("status-dot");
  const text = document.getElementById("status-text");
  text.removeAttribute("data-i18n"); // it's driven by live data from here on
  if (!status) {
    dot.className = "status-dot offline";
    text.textContent = t("home.statusUnavailable");
    return;
  }
  dot.className = `status-dot ${status.online ? "online" : "offline"}`;
  text.textContent = status.online
    ? t("home.online", { online: status.players.online, max: status.players.max })
    : t("home.offline");
}

async function refreshStatus() {
  try {
    lastStatus = await fetchJSON("/api/status");
  } catch {
    lastStatus = null;
  }
  renderStatus(lastStatus);
}

loadHome();
