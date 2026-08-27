async function loadMap() {
  const cfg = await getSiteConfig();
  const holder = document.getElementById("map-frame-holder");
  const fallback = document.getElementById("map-fallback");
  const openLinks = [document.getElementById("map-open-link"), document.getElementById("map-open-link-2")];

  if (!cfg.bluemapUrl || cfg.bluemapUrl.includes("map.angkorsmp.com")) {
    // Still the placeholder from site.config.json - nothing real to embed yet.
    fallback.classList.add("show");
    fallback.querySelector("p").textContent =
      "The live map isn't configured yet. Set \"bluemapUrl\" in website/config/site.config.json to your BlueMap URL.";
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
