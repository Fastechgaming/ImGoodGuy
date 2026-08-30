// Banned Players page - reads the live list from AngkorStore's LiteBans
// hook (see AngkorStore/README.md #api-v1-bans). Never errors: an
// unlinked plugin, LiteBans disabled, or its database not found all just
// mean an empty, "unavailable" list here.
(async function loadBanned() {
  const banner = document.getElementById("banned-unavailable");
  const body = document.getElementById("banned-body");

  let data;
  try {
    data = await fetchJSON("/api/bans");
  } catch {
    data = { available: false, bans: [] };
  }

  if (!data.available) {
    banner.hidden = false;
  }
  render(data.bans || []);

  document.addEventListener("i18n:change", () => render(data.bans || []));

  function render(bans) {
    if (!bans.length) {
      body.innerHTML = `<tr><td colspan="5" class="board-empty">${escapeHtml(t("banned.empty"))}</td></tr>`;
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
