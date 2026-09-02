// Banned Players page - reads the live list from AngkorStore's LiteBans
// hook (see AngkorStore/README.md #api-v1-bans). Never errors: an
// unlinked plugin, LiteBans disabled, or its database not found all just
// mean an empty, "unavailable" list here.
(async function loadBanned() {
  const PAGE_SIZE = 10;
  const banner = document.getElementById("banned-unavailable");
  const body = document.getElementById("banned-body");
  const searchInput = document.getElementById("banned-search");
  const pagination = document.getElementById("banned-pagination");
  const pageLabel = document.getElementById("banned-page-label");
  const prevBtn = document.getElementById("banned-prev");
  const nextBtn = document.getElementById("banned-next");

  let data;
  try {
    data = await fetchJSON("/api/bans");
  } catch {
    data = { available: false, bans: [] };
  }
  const allBans = data.bans || [];
  let page = 1;

  if (!data.available) {
    banner.hidden = false;
  }
  renderFiltered();

  searchInput.addEventListener("input", () => {
    page = 1;
    renderFiltered();
  });
  prevBtn.addEventListener("click", () => {
    page -= 1;
    renderFiltered();
  });
  nextBtn.addEventListener("click", () => {
    page += 1;
    renderFiltered();
  });
  document.addEventListener("i18n:change", renderFiltered);

  function renderFiltered() {
    const query = searchInput.value.trim().toLowerCase();
    const bans = query ? allBans.filter((ban) => ban.player.toLowerCase().includes(query)) : allBans;

    const totalPages = Math.max(1, Math.ceil(bans.length / PAGE_SIZE));
    page = Math.min(Math.max(page, 1), totalPages);

    if (bans.length > PAGE_SIZE) {
      pagination.hidden = false;
      pageLabel.textContent = `[${page}/${totalPages}]`;
      prevBtn.disabled = page <= 1;
      nextBtn.disabled = page >= totalPages;
    } else {
      pagination.hidden = true;
    }

    const start = (page - 1) * PAGE_SIZE;
    render(bans.slice(start, start + PAGE_SIZE), query);
  }

  function render(bans, query) {
    if (!bans.length) {
      const message = query ? t("banned.noMatch") : t("banned.empty");
      body.innerHTML = `<tr><td colspan="5" class="board-empty">${escapeHtml(message)}</td></tr>`;
      return;
    }
    const locale = I18n.lang === "km" ? "km-KH" : "en-US";
    body.innerHTML = bans
      .map((ban) => {
        const date = new Date(ban.bannedAt).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
        const expires = ban.expiresAt
          ? new Date(ban.expiresAt).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" })
          : `<span class="ban-permanent">${escapeHtml(t("banned.permanent"))}</span>`;
        const reason = ban.reason ? escapeHtml(ban.reason) : `<span class="ban-noreason">${escapeHtml(t("banned.noReason"))}</span>`;
        return `<tr>
            <td>${escapeHtml(ban.player)}</td>
            <td class="ban-reason">${reason}</td>
            <td>${escapeHtml(ban.bannedBy || "—")}</td>
            <td>${date}</td>
            <td>${expires}</td>
          </tr>`;
      })
      .join("");
  }
})();
