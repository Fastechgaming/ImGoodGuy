async function loadMap() {
  const cfg = await getSiteConfig();
  const holder = document.getElementById("map-frame-holder");
  const fallback = document.getElementById("map-fallback");
  const openLinks = [document.getElementById("map-open-link"), document.getElementById("map-open-link-2")];

  const renderAge = () => {
    const mapAgeText = document.getElementById("map-age-text");
    if (!mapAgeText) return;
    mapAgeText.textContent = cfg.mapStartDate
      ? t("map.age", { age: formatDaysHours(daysHoursSince(cfg.mapStartDate)) })
      : "";
  };
  renderAge();
  document.addEventListener("i18n:change", renderAge);

  if (!cfg.bluemapUrl || cfg.bluemapUrl.includes("map.angkorsmp.com")) {
    // Still the placeholder from site.config.json - nothing real to embed yet.
    fallback.classList.add("show");
    const note = fallback.querySelector("p");
    note.setAttribute("data-i18n", "map.notConfigured");
    note.textContent = t("map.notConfigured");
    openLinks.forEach((el) => el.remove());
    return;
  }

  openLinks.forEach((el) => (el.href = cfg.bluemapUrl));
  const iframe = document.createElement("iframe");
  iframe.src = cfg.bluemapUrl;
  iframe.title = "AngkorSMP Live Map";
  iframe.loading = "lazy";
  iframe.allow = "fullscreen";
  holder.prepend(iframe);
}

loadMap();
