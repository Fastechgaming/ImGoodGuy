// Local, free fraud check for an uploaded payment screenshot - no paid API,
// no external verification service (the real Bakong API isn't available to
// this project yet). Four independent, offline-ish signals feed one
// verdict; none of them prove a screenshot is genuine, they only catch the
// ones clearly worth a human's second look before anything auto-delivers:
//
//   1. OCR (tesseract.js) - does the screenshot's own text actually contain
//      the amount this order is for? The strongest signal: a real receipt
//      shows the number, a receipt for a different (usually smaller) amount
//      edited to look like this order generally won't.
//   2. OCR again - if the receipt shows a date, does it fall anywhere near
//      when this order was actually placed? Catches a genuine screenshot
//      from a totally different (often older) transaction being reused.
//      Soft on purpose: most receipts crop the date out entirely, and a
//      screenshot with no date at all is not itself suspicious.
//   3. EXIF - was it saved by known photo-editing software?
//   4. Dimensions - an implausibly tiny/cropped image is a common way to
//      hide the parts of a receipt that would give an edit away.
//
// False positives just mean an order goes to manual review instead of
// auto-delivering - never worse than the fully-manual flow this replaces.
const path = require("path");
const exifr = require("exifr");
const { imageSize } = require("image-size");
const { createWorker } = require("tesseract.js");

const EDITOR_SOFTWARE = /photoshop|gimp|pixelmator|snapseed|picsart|lightroom|affinity photo|canva/i;
const MIN_DIMENSION = 300; // a real payment-app screenshot is always bigger than this

// Must match RIEL_PER_USD in public/js/i18n.js - Khmer-language customers are
// quoted (and told to pay) the Riel-converted price on /checkout, not the
// USD one, so their genuine receipt shows that Riel figure, never a dollar
// amount. Without this the OCR check only ever looked for the USD variants
// and flagged every real Riel payment as suspicious.
const RIEL_PER_USD = 4000;

// The English trained-data file ships as an npm package (@tesseract.js-data/eng)
// instead of letting tesseract.js fetch it from jsdelivr on first use - this
// keeps OCR working even if the server's outbound internet is flaky/blocked,
// and avoids depending on a CDN staying up forever.
const LANG_PATH = path.join(__dirname, "..", "node_modules", "@tesseract.js-data", "eng", "4.0.0");

function amountVariants(amount) {
  const n = Number(amount) || 0;
  const fixed = n.toFixed(2);
  const variants = new Set([fixed, fixed.replace(".", ",")]);
  if (Number.isInteger(n)) variants.add(String(n));
  const riel = Math.round(n * RIEL_PER_USD);
  variants.add(String(riel));
  variants.add(riel.toLocaleString("en-US")); // e.g. "12,000" - how formatRiel() shows it on /checkout
  return [...variants];
}

function textShowsAmount(text, amount) {
  const cleaned = text.replace(/[^\d.,]/g, " ");
  return amountVariants(amount).some((v) => cleaned.includes(v));
}

// Matches lib/gamestats.js's TZ_OFFSET_MS - a receipt's printed date is a
// wall-clock calendar date on the customer's phone, in Cambodia local time.
const TZ_OFFSET_MS = 7 * 60 * 60 * 1000;
// How many calendar days of slack around [order created, proof submitted] a
// receipt's date is allowed before it counts as implausible - generous on
// purpose, to absorb ambiguous DD/MM-vs-MM/DD parses and orders left
// pending a few days before the customer actually pays.
const DATE_TOLERANCE_DAYS = 2;
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function toDayIndex(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2020 || y > 2035) return null;
  return Math.floor(Date.UTC(y, mo - 1, d) / 86400000);
}

// Best-effort extraction of every date-like substring in the OCR text, as
// Cambodia-calendar day indexes - not exhaustive, just the formats
// Cambodian banking apps commonly show (Bakong, ABA, ACLEDA, Wing, ...).
function extractDayIndexes(text) {
  const days = [];
  const add = (v) => {
    if (v != null) days.push(v);
  };

  // 2025-05-31 or 2025/05/31
  for (const m of text.matchAll(/\b(20\d{2})[-\/](\d{1,2})[-\/](\d{1,2})\b/g)) {
    add(toDayIndex(+m[1], +m[2], +m[3]));
  }
  // 31-05-2025 or 31/05/2025 - day-month-year, the convention used locally
  for (const m of text.matchAll(/\b(\d{1,2})[-\/](\d{1,2})[-\/](20\d{2})\b/g)) {
    add(toDayIndex(+m[3], +m[2], +m[1]));
  }
  // 31 May 2025 / 31May2025
  for (const m of text.matchAll(/\b(\d{1,2})\s*([A-Za-z]{3,9})\s*,?\s*(20\d{2})\b/g)) {
    add(toDayIndex(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]));
  }
  // May 31, 2025 / May 31 2025
  for (const m of text.matchAll(/\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(20\d{2})\b/g)) {
    add(toDayIndex(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]));
  }

  return days;
}

// null when the receipt has nothing that looks like a date at all - that's
// common (a lot of apps crop it out of the shareable receipt) and, on its
// own, not suspicious. Only returns false when a date WAS found and none of
// the dates found land anywhere near this order's own timeframe.
function dateLooksPlausible(text, order) {
  const found = extractDayIndexes(text);
  if (!found.length) return null;

  const createdDay = Math.floor((order.createdAt + TZ_OFFSET_MS) / 86400000);
  const submittedDay = Math.floor(((order.submittedAt || Date.now()) + TZ_OFFSET_MS) / 86400000);
  const lo = Math.min(createdDay, submittedDay) - DATE_TOLERANCE_DAYS;
  const hi = Math.max(createdDay, submittedDay) + DATE_TOLERANCE_DAYS;
  return found.some((d) => d >= lo && d <= hi);
}

async function ocrText(buffer) {
  const worker = await createWorker("eng", 1, { langPath: LANG_PATH, gzip: true, cachePath: LANG_PATH });
  try {
    const {
      data: { text },
    } = await worker.recognize(buffer);
    return text || "";
  } finally {
    await worker.terminate();
  }
}

// Reads the proof image at `path` and decides whether it's worth flagging
// for manual review before order `order` is auto-delivered.
async function analyzeProof(path, order) {
  const fs = require("fs");
  const buffer = fs.readFileSync(path);
  const reasons = [];

  try {
    const { width, height } = imageSize(buffer);
    if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
      reasons.push(`Screenshot is unusually small (${width}x${height}) — could be cropped.`);
    }
  } catch {
    reasons.push("Couldn't read the image's dimensions.");
  }

  try {
    const meta = await exifr.parse(buffer, { pick: ["Software"] });
    if (meta && meta.Software && EDITOR_SOFTWARE.test(meta.Software)) {
      reasons.push(`Saved with editing software: ${meta.Software}`);
    }
  } catch {
    // Most phone screenshots carry no EXIF at all - not itself suspicious.
  }

  let text = "";
  try {
    text = await ocrText(buffer);
  } catch (err) {
    reasons.push(`Couldn't read any text off the screenshot (${err.message}).`);
  }
  if (text && !textShowsAmount(text, order.amount)) {
    const usd = Number(order.amount).toFixed(2);
    const riel = Math.round(Number(order.amount) * RIEL_PER_USD).toLocaleString("en-US");
    reasons.push(`Neither $${usd} nor ${riel}៛ appears anywhere in the screenshot's text.`);
  }
  if (text && dateLooksPlausible(text, order) === false) {
    reasons.push("The date on the screenshot doesn't match when this order was placed — might be an old or reused receipt.");
  }

  return { suspicious: reasons.length > 0, reasons, ocrText: text };
}

module.exports = { analyzeProof };
