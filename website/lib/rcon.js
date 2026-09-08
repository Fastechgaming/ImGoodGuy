// Runs a delivery command on the Minecraft server over RCON when you press
// "Accept" on a Telegram order.
//
// Requires RCON to be enabled in the server's server.properties:
//   enable-rcon=true
//   rcon.port=25575
//   rcon.password=<something long and random>
// ...and RCON_HOST / RCON_PORT / RCON_PASSWORD set in website/.env
const { Rcon } = require("rcon-client");

// Turns "lp user {player} parent add apsara" into a real command.
function buildCommand(template, { player, itemName, orderId }) {
  return String(template)
    .replace(/\{player\}/g, player)
    .replace(/\{item\}/g, itemName)
    .replace(/\{order\}/g, orderId)
    .replace(/^\//, ""); // RCON commands are sent without the leading slash
}

async function runCommand(commandTemplate, context) {
  const host = process.env.RCON_HOST;
  const port = Number(process.env.RCON_PORT) || 25575;
  const password = process.env.RCON_PASSWORD;

  if (!commandTemplate) {
    return { ok: false, reason: "This item has no delivery command configured." };
  }
  if (!host || !password) {
    return { ok: false, reason: "RCON_HOST / RCON_PASSWORD are not set in .env - cannot deliver automatically." };
  }

  const command = buildCommand(commandTemplate, context);
  let rcon;
  try {
    rcon = await Rcon.connect({ host, port, password, timeout: 8000 });
    const response = await rcon.send(command);
    return { ok: true, command, response: String(response || "").trim() };
  } catch (err) {
    return { ok: false, command, reason: err.message };
  } finally {
    if (rcon) {
      try {
        await rcon.end();
      } catch {
        /* already closed */
      }
    }
  }
}

// Best-effort inverse of a delivery command, used to undo an auto-accepted
// order an admin later flags as fraudulent. Only understands the two verb
// pairs this catalogue's delivery commands actually use (rank grants and
// coin grants) - anything else (a one-off "other" item, a custom command)
// has no safe automatic undo and is left for the admin to handle by hand.
function reverseCommand(template) {
  if (!template) return null;
  const rank = template.match(/^(.*\bparent\s+)add(\s+\S+.*)$/i);
  if (rank) return `${rank[1]}remove${rank[2]}`;
  const coins = template.match(/^(\s*eco\s+)give(\s+.*)$/i);
  if (coins) return `${coins[1]}take${coins[2]}`;
  return null;
}

module.exports = { runCommand, buildCommand, reverseCommand };
