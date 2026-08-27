// Shared behavior across all pages: theme, nav toggle, site config, toasts.

/* ---------------- Dark / light theme ---------------- */
// Dark is the default. The stored choice is applied by a tiny inline script in
// each page's <head> (see applyStoredTheme below) so there is no flash of the
// wrong theme before this file loads.
const THEME_KEY = "angkorsmp-theme";

function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

function applyTheme(theme) {
  const isLight = theme === "light";
  if (isLight) document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");

  document.querySelectorAll(".theme-toggle").forEach((btn) => {
    // Show the theme you'd switch TO, which is the common convention.
    btn.textContent = isLight ? "🌙" : "☀️";
    btn.setAttribute("aria-label", isLight ? "Switch to dark theme" : "Switch to light theme");
    btn.setAttribute("title", isLight ? "Switch to dark theme" : "Switch to light theme");
  });
}

function toggleTheme() {
  const nowLight = document.documentElement.getAttribute("data-theme") !== "light";
  applyTheme(nowLight ? "light" : "dark");
  try {
    localStorage.setItem(THEME_KEY, nowLight ? "light" : "dark");
  } catch {
    /* private browsing - the choice just won't persist */
  }
}

function toggleNav() {
  document.querySelector(".nav-links")?.classList.toggle("open");
}

function showToast(message) {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.remove("show"), 2500);
}

// Days/hours elapsed since a given ISO date - used for "server age",
// "season age" and "map age" stats.
function daysHoursSince(sinceISO) {
  const start = new Date(sinceISO).getTime();
  const now = Date.now();
  if (Number.isNaN(start) || now < start) return { days: 0, hours: 0 };
  const diffMs = now - start;
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
  return { days, hours };
}

function formatDaysHours({ days, hours }) {
  return `${days}d ${hours}h`;
}

// Formats just the calendar date (Y-M-D) from a config ISO string, ignoring
// the visitor's own timezone - so "2025-05-31T00:00:00+07:00" always reads
// as May 31, never May 30 for someone browsing from the Americas.
function formatConfigDate(iso) {
  if (!iso) return "—";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "—";
  const [, y, mo, d] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d)).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function isMobileDevice() {
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 0 && window.innerWidth < 900);
}

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

let siteConfigCache = null;
async function getSiteConfig() {
  if (siteConfigCache) return siteConfigCache;
  siteConfigCache = await fetchJSON("/api/config");
  return siteConfigCache;
}

function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  const el = document.createElement("textarea");
  el.value = text;
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
  return Promise.resolve();
}

document.addEventListener("DOMContentLoaded", async () => {
  // Sync the toggle glyph with whatever theme the inline head script applied.
  // The click handler is the inline onclick="toggleTheme()" in the markup —
  // don't also addEventListener here or every click would fire twice.
  applyTheme(getStoredTheme() === "light" ? "light" : "dark");

  document.querySelectorAll(".nav-links a").forEach((a) => {
    if (a.getAttribute("href") === location.pathname) a.classList.add("active");
  });

  const navLogo = document.getElementById("nav-logo");
  if (navLogo) {
    try {
      const cfg = await getSiteConfig();
      navLogo.src = cfg.logoIcon || cfg.logo || navLogo.src;
    } catch {
      /* keep the default logo if config fails to load */
    }
  }
});
