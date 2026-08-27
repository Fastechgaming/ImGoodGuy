// Shared behavior across all pages: nav toggle, site config, toasts.

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
