// Local, free fraud check for an uploaded payment screenshot - no paid API,
// no external verification service (the real Bakong API isn't available to
// this project yet). Three independent, offline-ish signals feed one
// verdict; none of them prove a screenshot is genuine, they only catch the
// ones clearly worth a human's second look before anything auto-delivers:
//
//   1. OCR (tesseract.js) - does the screenshot's own text actually contain
//      the amount this order is for? The strongest signal: a real receipt
//      shows the number, a receipt for a different (usually smaller) amount
//      edited to look like this order generally won't.
//   2. EXIF - was it saved by known photo-editing software?
//   3. Dimensions - an implausibly tiny/cropped image is a common way to
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
  return [...variants];
}

function textShowsAmount(text, amount) {
  const cleaned = text.replace(/[^\d.,]/g, " ");
  return amountVariants(amount).some((v) => cleaned.includes(v));
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
    reasons.push(`The amount $${Number(order.amount).toFixed(2)} doesn't appear anywhere in the screenshot's text.`);
  }

  return { suspicious: reasons.length > 0, reasons, ocrText: text };
}

module.exports = { analyzeProof };
