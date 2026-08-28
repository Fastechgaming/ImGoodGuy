// "Complete your Purchase" page: order summary, KHQR to scan, receipt upload.
const params = new URLSearchParams(location.search);
const orderId = params.get("order");
const content = document.getElementById("checkout-content");

let selectedFile = null;

// The scan hint has the amount in bold in the middle of the sentence, so the
// translated string is split around its {amount} slot rather than escaped whole.
function scanHintHtml(amount) {
  const bold = `<strong>${escapeHtml(formatPrice(amount))}</strong>`;
  return t("checkout.scanHint").split("{amount}").map(escapeHtml).join(bold);
}

async function loadCheckout() {
  if (!orderId) {
    content.innerHTML = `<p class="empty-note">${escapeHtml(t("checkout.noOrder"))} <a href="/store">${escapeHtml(t("checkout.backToStore"))}</a>.</p>`;
    return;
  }

  let order;
  let cfg;
  try {
    [order, cfg] = await Promise.all([fetchJSON(`/api/order/${encodeURIComponent(orderId)}`), getSiteConfig()]);
  } catch (err) {
    content.innerHTML = `<p class="empty-note">${escapeHtml(t("checkout.loadFailed", { error: err.message }))} <a href="/store">${escapeHtml(t("checkout.backToStore"))}</a>.</p>`;
    return;
  }

  // Already submitted? Send them to the confirmation instead of letting them pay twice.
  if (order.status !== "awaiting_payment") {
    window.location.replace(`/success?order=${encodeURIComponent(order.id)}`);
    return;
  }

  const supportHandle = cfg.supportTelegram || "";
  const khqrSrc = cfg.khqrImage || "/images/site/khqr.png";
  content.innerHTML = `
    <div class="checkout-summary">
      <img class="checkout-item-img" src="${escapeHtml(order.itemImage || "")}" alt="${escapeHtml(order.itemName)}" onerror="this.style.display='none'" />
      <div class="checkout-summary-text">
        <h3>${escapeHtml(order.itemName)}</h3>
        <p>${escapeHtml(order.itemDesc || "")}</p>
        <div class="checkout-rows">
          <div><span>${escapeHtml(t("checkout.inServerName"))}</span><strong>${escapeHtml(order.playerName)}</strong></div>
          <div><span>${escapeHtml(t("checkout.edition"))}</span><strong>${escapeHtml(t(order.edition === "bedrock" ? "buy.bedrock" : "buy.java"))}</strong></div>
          <div><span>${escapeHtml(t("checkout.total"))}</span><strong class="price">${escapeHtml(formatPrice(order.amount))}</strong></div>
        </div>
      </div>
    </div>

    <div class="checkout-step">
      <h3>${escapeHtml(t("checkout.step1"))}</h3>
      <p class="checkout-hint">${scanHintHtml(order.amount)}</p>
      <img class="checkout-khqr" src="${escapeHtml(khqrSrc)}" alt="KHQR payment code"
           onerror="this.replaceWith(Object.assign(document.createElement('p'),{className:'empty-note',textContent:t('checkout.khqrMissing')}))" />
      <div class="khqr-actions">
        <a class="save-khqr-btn" id="save-khqr" href="${escapeHtml(khqrSrc)}" download="AngkorSMP-KHQR.png">
          ${escapeHtml(t("checkout.saveKhqr"))}
        </a>
        <span class="checkout-hint khqr-save-hint">${escapeHtml(t("checkout.saveHint"))}</span>
      </div>
    </div>

    <div class="checkout-step">
      <h3>${escapeHtml(t("checkout.step2"))}</h3>
      <p class="checkout-hint">${escapeHtml(t("checkout.uploadHint"))}</p>
      <label class="file-drop" id="file-drop">
        <input type="file" id="proof-input" accept="image/*" hidden />
        <span class="file-drop-icon">🧾</span>
        <span class="file-drop-text" id="file-drop-text">${escapeHtml(t("checkout.dropText"))}</span>
        <img class="file-preview" id="file-preview" alt="" hidden />
      </label>
    </div>

    <button class="continue-btn" id="submit-btn" disabled>${escapeHtml(t("checkout.submit"))}</button>
    <p class="checkout-hint centered" id="submit-note">${escapeHtml(t("checkout.submitNote"))}</p>
    ${
      supportHandle
        ? `<p class="checkout-hint centered">${escapeHtml(t("checkout.trouble"))} <a href="https://t.me/${encodeURIComponent(supportHandle)}" target="_blank" rel="noopener">${escapeHtml(t("checkout.contactSupport"))}</a></p>`
        : ""
    }
  `;

  wireFileDrop();
  document.getElementById("submit-btn").addEventListener("click", submitProof);
}

function wireFileDrop() {
  const drop = document.getElementById("file-drop");
  const input = document.getElementById("proof-input");
  const text = document.getElementById("file-drop-text");
  const preview = document.getElementById("file-preview");
  const submitBtn = document.getElementById("submit-btn");
  const note = document.getElementById("submit-note");

  function accept(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      showToast(t("checkout.notImage"));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      showToast(t("checkout.tooBig"));
      return;
    }
    selectedFile = file;
    text.textContent = file.name;
    preview.src = URL.createObjectURL(file);
    preview.hidden = false;
    submitBtn.disabled = false;
    note.textContent = t("checkout.ready");
  }

  input.addEventListener("change", () => accept(input.files[0]));

  ["dragenter", "dragover"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("dragging");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove("dragging");
    })
  );
  drop.addEventListener("drop", (e) => accept(e.dataTransfer.files[0]));
}

async function submitProof() {
  if (!selectedFile) return;
  const submitBtn = document.getElementById("submit-btn");
  const note = document.getElementById("submit-note");
  submitBtn.disabled = true;
  submitBtn.textContent = t("checkout.submitting");
  note.textContent = t("checkout.sending");

  try {
    const body = new FormData();
    body.append("proof", selectedFile);
    const res = await fetch(`/api/order/${encodeURIComponent(orderId)}/proof`, { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
    window.location.href = `/success?order=${encodeURIComponent(orderId)}`;
  } catch (err) {
    showToast(err.message);
    submitBtn.disabled = false;
    submitBtn.textContent = t("checkout.submit");
    note.textContent = t("checkout.retry");
  }
}

// The whole panel is rendered from JS, so a language switch simply rebuilds it.
document.addEventListener("i18n:change", () => {
  selectedFile = null;
  loadCheckout();
});

loadCheckout();
