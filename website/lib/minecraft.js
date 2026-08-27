const { status, statusBedrock } = require("minecraft-server-util");

// Cache the last good result for a few seconds so a page full of visitors
// doesn't each trigger a fresh ping to the Minecraft server.
let cache = { data: null, expires: 0 };
const CACHE_MS = 10_000;
const PING_TIMEOUT_MS = 4000;

async function getServerStatus(cfg) {
  if (cache.data && Date.now() < cache.expires) return cache.data;

  // Java and Bedrock are checked at the same time (not one-then-fallback) so a
  // dead/unused protocol doesn't add its whole timeout to every request, and
  // so a Bedrock-only (or Java-only) server always reports correctly.
  const [javaResult, bedrockResult] = await Promise.allSettled([
    status(cfg.javaIp, Number(cfg.javaPort) || 25565, { timeout: PING_TIMEOUT_MS, enableSRV: true }),
    statusBedrock(cfg.bedrockIp || cfg.javaIp, Number(cfg.bedrockPort) || 19132, { timeout: PING_TIMEOUT_MS }),
  ]);

  let result;
  if (javaResult.status === "fulfilled") {
    const res = javaResult.value;
    result = {
      online: true,
      edition: "java",
      players: { online: res.players.online, max: res.players.max },
      motd: res.motd?.clean || cfg.tagline || "",
      version: res.version?.name || "",
    };
  } else if (bedrockResult.status === "fulfilled") {
    const res = bedrockResult.value;
    result = {
      online: true,
      edition: "bedrock",
      players: { online: res.playersOnline, max: res.playersMax },
      motd: res.motd?.clean || cfg.tagline || "",
      version: res.version || "",
    };
  } else {
    result = { online: false, players: { online: 0, max: 0 }, motd: "", version: "" };
    // Logged (not shown to visitors) so you can tell WHY it reports offline -
    // e.g. "offline or unreachable" usually means outbound TCP/UDP to that
    // port is blocked from wherever this website is hosted (common on cheap
    // web hosts that only allow outbound 80/443), not that the Minecraft
    // server itself is down. Check javaPort/bedrockPort in
    // config/site.config.json match your real server, and that this host's
    // firewall allows outbound traffic to them.
    console.error(
      `[minecraft-status] java(${cfg.javaIp}:${cfg.javaPort || 25565}): ${javaResult.reason?.message}` +
        ` | bedrock(${cfg.bedrockIp || cfg.javaIp}:${cfg.bedrockPort || 19132}): ${bedrockResult.reason?.message}`
    );
  }

  cache = { data: result, expires: Date.now() + CACHE_MS };
  return result;
}

module.exports = { getServerStatus };
