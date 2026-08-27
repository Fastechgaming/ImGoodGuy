const { status, statusBedrock } = require("minecraft-server-util");

// Cache the last good result for a few seconds so a page full of visitors
// doesn't each trigger a fresh ping to the Minecraft server.
let cache = { data: null, expires: 0 };
const CACHE_MS = 10_000;

async function getServerStatus(cfg) {
  if (cache.data && Date.now() < cache.expires) return cache.data;

  let result;
  try {
    const res = await status(cfg.javaIp, Number(cfg.javaPort) || 25565, {
      timeout: 5000,
      enableSRV: true,
    });
    result = {
      online: true,
      edition: "java",
      players: { online: res.players.online, max: res.players.max },
      motd: res.motd?.clean || cfg.tagline || "",
      version: res.version?.name || "",
    };
  } catch (javaErr) {
    try {
      const res = await statusBedrock(cfg.bedrockIp || cfg.javaIp, Number(cfg.bedrockPort) || 19132, {
        timeout: 5000,
      });
      result = {
        online: true,
        edition: "bedrock",
        players: { online: res.playersOnline, max: res.playersMax },
        motd: res.motd?.clean || cfg.tagline || "",
        version: res.version || "",
      };
    } catch (bedrockErr) {
      result = { online: false, players: { online: 0, max: 0 }, motd: "", version: "" };
    }
  }

  cache = { data: result, expires: Date.now() + CACHE_MS };
  return result;
}

module.exports = { getServerStatus };
