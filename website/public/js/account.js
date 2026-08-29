// The website account. Each page (games / store) has its OWN identity in the
// same signed cookie, so a name change on one page never touches the other —
// but the very first name anyone verifies, on either page, signs them into
// both. Every call here takes a `scope` ("games" or "store") so the two never
// get mixed up.
//
// When the AngkorStore plugin is connected the reply also carries the player's
// UUID, live coin balance and rank; without it those come back null and the
// pages hide what they cannot show.
const Account = (() => {
  const cached = {};

  async function load(scope) {
    try {
      const data = await fetchJSON(`/api/account?scope=${encodeURIComponent(scope)}`);
      cached[scope] = data && data.player ? data : null;
    } catch {
      cached[scope] = null;
    }
    return cached[scope];
  }

  async function set(rawName, edition, scope) {
    cached[scope] = await fetchJSON("/api/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player: rawName, edition, scope }),
    });
    document.dispatchEvent(new CustomEvent("account:change", { detail: { scope, account: cached[scope] } }));
    return cached[scope];
  }

  function get(scope) {
    return cached[scope] || null;
  }

  function ranks() {
    return fetchJSON("/api/account/ranks");
  }

  return { load, set, get, ranks };
})();
