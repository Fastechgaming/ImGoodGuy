// Shared Minecraft-name rules. This file is loaded by the browser AND required
// by the Node server (see the module.exports at the bottom) so the name the
// customer is shown is always byte-for-byte the name the order is created with.
//
// Bedrock players reach a Java server through Geyser/Floodgate, which prefixes
// their gamertag with a "." and replaces spaces with "_". So:
//   "Play er"   -> ".Play_er"
//   ".Play er"  -> ".Play_er"   (don't double the dot the user already typed)
//   "Play_er"   -> ".Play_er"
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.normalizeServerName = api.normalizeServerName;
    root.isValidRawName = api.isValidRawName;
  }
})(typeof self !== "undefined" ? self : this, function () {
  function normalizeServerName(rawName, edition) {
    const trimmed = String(rawName == null ? "" : rawName).trim();

    if (edition === "bedrock") {
      const withoutDots = trimmed.replace(/^\.+/, ""); // user may have typed the dot themselves
      const underscored = withoutDots.replace(/\s+/g, "_"); // gamertags may contain spaces
      return underscored ? `.${underscored}` : "";
    }

    return trimmed;
  }

  // Validates what the player typed, before the Bedrock prefix is applied.
  // Bedrock gamertags may contain spaces; Java names may not.
  function isValidRawName(rawName, edition) {
    const trimmed = String(rawName == null ? "" : rawName).trim();
    if (edition === "bedrock") {
      const core = trimmed.replace(/^\.+/, "").replace(/\s+/g, "_");
      return /^[A-Za-z0-9_]{2,20}$/.test(core);
    }
    return /^[A-Za-z0-9_]{2,16}$/.test(trimmed);
  }

  return { normalizeServerName, isValidRawName };
});
