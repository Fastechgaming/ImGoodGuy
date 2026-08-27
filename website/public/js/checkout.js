// "Complete your Purchase" page: order summary, KHQR to scan, receipt upload.
const params = new URLSearchParams(location.search);
const orderId = params.get("order");
const content = document.getElementById("checkout-content");

let selectedFile = null;

async function loadCheckout() {
  if (!orderId) {
    content.innerHTML = `<p class="empty-note">No order specified. <a href="/store.html">Back to the store</a>.</p>`;
    return;
  }

  let order;
  let cfg;
  try {
    [order, cfg] = await Promise.all([fetchJSON(`/api/order/${encodeURIComponent(orderId)}`), getSiteConfig()]);
  } catch (err) {
    content.innerHTML = `<p class="empty-note">Couldn't load that order (${escapeHtml(err.message)}). <a href="/store.html">Back to the store</a>.</p>`;
    return;
  }

  // Already submitted? Send them to the confirmation instead of letting them pay twice.
  if (order.status !== "awaiting_payment") {
    window.location.replace(`/success.html?order=${encodeURIComponent(order.id)}`);
    return;
  }

  const supportHandle = cfg.supportTelegram || "";
  content.innerHTML = `
    <div class="checkout-summary">
      <img class="checkout-item-img" src="${escapeHtml(order.itemImage || "")}" alt="${escapeHtml(order.itemName)}" onerror="this.style.display='none'" />
      <div class="checkout-summary-text">
        <h3>${escapeHtml(order.itemName)}</h3>
        <p>${escapeHtml(order.itemDesc || "")}</p>
        <div class="checkout-rows">
          <div><span>In server name</span><strong>${escapeHtml(order.playerName)}</strong></div>
          <div><span>Edition</span><strong>${order.edition === "bedrock" ? "Bedrock" : "Java"}</strong></div>
          <div><span>Total</span><strong class="price">$${Number(order.amount).toFixed(2)} ${escapeHtml(order.currency)}</strong></div>
        </div>
      </div>
    </div>

    <div class="checkout-step">
      <h3>1. Scan to pay</h3>
      <p class="checkout-hint">Scan this KHQR with any Cambodian banking app and pay exactly <strong>$${Number(order.amount).toFixed(2)}</strong>.</p>
      <img class="checkout-khqr" src="${escapeHtml(cfg.khqrImage || "/images/site/khqr.png")}" alt="KHQR payment code"
           onerror="this.replaceWith(Object.assign(document.createElement('p'),{className:'empty-note',textContent:'KHQR image not uploaded yet — add it at public/images/site/khqr.png'}))" />
    </div>

    <div class="checkout-step">
      <h3>2. Upload your payment screenshot</h3>
      <p class="checkout-hint">After paying, attach a screenshot of the transaction receipt so we can verify it.</p>
      <label class="file-drop" id="file-drop">
        <input type="file" id="proof-input" accept="image/*" hidden />
        <span class="file-drop-icon">🧾</span>
        <span class="file-drop-text" id="file-drop-text">Tap to choose a screenshot, or drag one here</span>
        <img class="file-preview" id="file-preview" alt="" hidden />
      </label>
    </div>

    <button class="continue-btn" id="submit-btn" disabled>SUBMIT</button>
    <p class="checkout-hint centered" id="submit-note">Attach your receipt to enable Submit.</p>
    ${
      supportHandle
        ? `<p class="checkout-hint centered">Having trouble? <a href="https://t.me/${encodeURIComponent(supportHandle)}" target="_blank" rel="noopener">Contact support on Telegram</a></p>`
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
      showToast("Please choose an image file (a screenshot of your receipt).");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      showToast("That image is larger than 8 MB — please use a smaller screenshot.");
      return;
    }
    selectedFile = file;
    text.textContent = file.name;
    preview.src = URL.createObjectURL(file);
    preview.hidden = false;
    submitBtn.disabled = false;
    note.textContent = "Ready to submit.";
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
  submitBtn.textContent = "Submitting…";
  note.textContent = "Sending your receipt…";

  try {
    const body = new FormData();
    body.append("proof", selectedFile);
    const res = await fetch(`/api/order/${encodeURIComponent(orderId)}/proof`, { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
    window.location.href = `/success.html?order=${encodeURIComponent(orderId)}`;
  } catch (err) {
    showToast(err.message);
    submitBtn.disabled = false;
    submitBtn.textContent = "SUBMIT";
    note.textContent = "Something went wrong — please try again.";
  }
}

loadCheckout();
