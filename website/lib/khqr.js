// KHQR generation + payment verification.
//
// IMPORTANT: We only ever use bakong-khqr's *offline* string-building helpers
// (BakongKHQR.generateIndividual / .generateMerchant / .verify) which do NOT
// make any network calls. We deliberately never call its checkBakongAccount()
// or generateDeepLink() helpers, which depend on an old/vulnerable axios -
// payment verification below is done with Node's built-in fetch() instead.
const { BakongKHQR, IndividualInfo, MerchantInfo, khqrData } = require("bakong-khqr");
const QRCode = require("qrcode");

const QR_VALID_MS = 15 * 60 * 1000; // KHQR (dynamic, amount-included) must carry an expiry

function buildKHQR({ amount, currency = "USD", reference, playerName }) {
  const accountId = process.env.BAKONG_ACCOUNT_ID;
  const merchantName = process.env.BAKONG_MERCHANT_NAME || "AngkorSMP";
  const merchantCity = process.env.BAKONG_MERCHANT_CITY || "Phnom Penh";
  const merchantId = process.env.BAKONG_MERCHANT_ID;

  if (!accountId) {
    throw new Error(
      "BAKONG_ACCOUNT_ID is not set in .env - cannot generate a real KHQR yet. See website/README.md."
    );
  }

  const optional = {
    currency: currency === "KHR" ? khqrData.currency.khr : khqrData.currency.usd,
    amount,
    billNumber: reference,
    storeLabel: "AngkorSMP Store",
    purposeOfTransaction: `Purchase for ${playerName}`,
    expirationTimestamp: Date.now() + QR_VALID_MS,
  };

  const bakongKHQR = new BakongKHQR();
  const info = merchantId
    ? new MerchantInfo(accountId, merchantName, merchantCity, merchantId, "", optional)
    : new IndividualInfo(accountId, merchantName, merchantCity, optional);

  const response = merchantId ? bakongKHQR.generateMerchant(info) : bakongKHQR.generateIndividual(info);

  if (!response || response.status?.code !== 0 || !response.data) {
    throw new Error(`Failed to generate KHQR: ${response?.status?.message || "unknown error"}`);
  }

  return { qrString: response.data.qr, md5: response.data.md5, expiresAt: optional.expirationTimestamp };
}

async function qrStringToDataUrl(qrString) {
  return QRCode.toDataURL(qrString, { errorCorrectionLevel: "M", margin: 1, width: 360 });
}

// Ask Bakong's Open API whether a KHQR (identified by the md5 of its payload)
// has been paid yet. Requires BAKONG_OPENAPI_TOKEN from
// https://api-bakong.nbc.gov.kh (Bakong Open API Developer Portal).
//
// NOTE: verify this endpoint + response shape against the current Bakong
// Open API docs before going live - NBC can revise the contract, and this
// project cannot call the live API from the dev sandbox it was built in.
async function checkPaymentByMd5(md5) {
  const token = process.env.BAKONG_OPENAPI_TOKEN;
  if (!token) {
    return { checked: false, paid: false, reason: "BAKONG_OPENAPI_TOKEN not configured" };
  }

  try {
    const res = await fetch("https://api-bakong.nbc.gov.kh/v1/check_transaction_by_md5", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ md5 }),
    });

    const body = await res.json().catch(() => null);
    const paid = res.ok && body && Number(body.responseCode) === 0 && body.data;
    return { checked: true, paid: Boolean(paid), raw: body };
  } catch (err) {
    return { checked: false, paid: false, reason: err.message };
  }
}

module.exports = { buildKHQR, qrStringToDataUrl, checkPaymentByMd5 };
