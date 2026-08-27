// The website account, shared by the games page and the store.
//
// The name lives in a signed cookie on the server, so verifying it on either
// page signs you in on both. When the AngkorLink plugin is connected the reply
// also carries the player's UUID, live coin balance and rank; without it those
// come back null and the pages hide what they cannot show.
const Account = (() => {
  let cached = null;

  async function load() {
    try {
      const data = await fetchJSON("/api/account");
      cached = data && data.player ? data : null;
    } catch {
      cached = null;
    }
    return cached;
  }

  async function set(rawName, edition) {
    cached = await fetchJSON("/api/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player: rawName, edition }),
    });
    document.dispatchEvent(new CustomEvent("account:change", { detail: cached }));
    return cached;
  }

  function get() {
    return cached;
  }

  function ranks() {
    return fetchJSON("/api/account/ranks");
  }

  return { load, set, get, ranks };
})();
