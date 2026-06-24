// ========================================================
// CẤU HÌNH: dán URL Web App của Google Apps Script vào đây
// Ví dụ: "https://script.google.com/macros/s/AKfycb..../exec"
// ========================================================
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyCYkpcSGnZ4lx9Zy209JNReArfmyC-8FFsPngU3AflkNUFU0AwHuTTGxESFZKrfmyK/exec";

// ========================================================
// Biến trạng thái
// ========================================================
let lastScannedCode = null;
let lastScannedAt = 0;
const DUPLICATE_COOLDOWN_MS = 2500; // tránh gửi trùng mã liên tiếp trong X ms
let historyItems = []; // lưu trong session (reset khi reload trang)

// ========================================================
// Khởi động
// ========================================================
document.addEventListener("DOMContentLoaded", () => {
  checkConfig();
  initScanner();
  bindManualInput();
  bindClearHistory();
});

function checkConfig() {
  if (!SCRIPT_URL || SCRIPT_URL.includes("DÁN_URL")) {
    document.getElementById("configWarning").style.display = "block";
  }
}

// ========================================================
// Camera quét mã (html5-qrcode)
// ========================================================
function initScanner() {
  const statusBar = document.getElementById("statusBar");

  const formatsToSupport = [
    Html5QrcodeSupportedFormats.QR_CODE,
    Html5QrcodeSupportedFormats.EAN_13,
    Html5QrcodeSupportedFormats.EAN_8,
    Html5QrcodeSupportedFormats.UPC_A,
    Html5QrcodeSupportedFormats.UPC_E,
    Html5QrcodeSupportedFormats.CODE_128,
    Html5QrcodeSupportedFormats.CODE_39,
    Html5QrcodeSupportedFormats.CODABAR,
    Html5QrcodeSupportedFormats.ITF,
  ];

  const html5QrCode = new Html5Qrcode("reader", {
    formatsToSupport: formatsToSupport,
    verbose: false,
  });

  const config = {
    fps: 10,
    qrbox: function (viewfinderWidth, viewfinderHeight) {
      const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
      const size = Math.floor(minEdge * 0.7);
      return { width: size, height: size };
    },
    aspectRatio: 1.3,
  };

  html5QrCode
    .start(
      { facingMode: "environment" },
      config,
      (decodedText) => {
        handleScanSuccess(decodedText);
      },
      () => {
        // lỗi quét mỗi frame - bỏ qua, đây là chuyện bình thường khi chưa thấy mã
      }
    )
    .then(() => {
      statusBar.textContent = "Đưa camera vào mã barcode để quét";
    })
    .catch((err) => {
      console.error(err);
      statusBar.textContent =
        "Không thể mở camera. Hãy cấp quyền Camera cho Safari trong Cài đặt, hoặc dùng ô nhập tay bên dưới.";
    });
}

// ========================================================
// Xử lý khi quét thành công
// ========================================================
function handleScanSuccess(code) {
  const now = Date.now();
  // chống gửi trùng liên tiếp khi camera đọc lại cùng 1 mã nhiều frame
  if (code === lastScannedCode && now - lastScannedAt < DUPLICATE_COOLDOWN_MS) {
    return;
  }
  lastScannedCode = code;
  lastScannedAt = now;

  vibrate();
  submitCode(code, "camera");
}

function vibrate() {
  if (navigator.vibrate) {
    navigator.vibrate(80);
  }
}

// ========================================================
// Nhập tay
// ========================================================
function bindManualInput() {
  const input = document.getElementById("manualInput");
  const button = document.getElementById("manualSubmit");

  const submit = () => {
    const value = input.value.trim();
    if (!value) return;
    submitCode(value, "manual");
    input.value = "";
    input.blur();
  };

  button.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
}

// ========================================================
// Gửi mã lên Google Sheet qua Apps Script
// ========================================================
async function submitCode(barcode, source) {
  const timestamp = new Date().toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
  });

  updateLastScanUI(barcode, timestamp, "pending");
  const historyId = addHistoryItem(barcode, timestamp, "pending");

  if (!SCRIPT_URL || SCRIPT_URL.includes("DÁN_URL")) {
    updateLastScanUI(barcode, timestamp, "error");
    updateHistoryStatus(historyId, "error");
    showToast("Chưa cấu hình SCRIPT_URL trong app.js", "error");
    return;
  }

  try {
    // Apps Script doPost cần Content-Type text/plain để tránh CORS preflight bị chặn
    const response = await fetch(SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify({ barcode, timestamp, source }),
    });

    const result = await response.json();

    if (result.status === "success") {
      updateLastScanUI(barcode, timestamp, "ok");
      updateHistoryStatus(historyId, "ok");
      showToast(`Đã lưu: ${barcode}`, "success");
    } else {
      throw new Error(result.message || "Lỗi không xác định từ server");
    }
  } catch (err) {
    console.error(err);
    updateLastScanUI(barcode, timestamp, "error");
    updateHistoryStatus(historyId, "error");
    showToast("Gửi thất bại. Kiểm tra kết nối mạng.", "error");
  }
}

// ========================================================
// UI: lần quét gần nhất
// ========================================================
function updateLastScanUI(code, time, status) {
  document.getElementById("lastCode").textContent = code;
  document.getElementById("lastTime").textContent = time;

  const badge = document.getElementById("lastBadge");
  badge.className = "badge " + badgeClass(status);
  badge.textContent = badgeLabel(status);
}

function badgeClass(status) {
  if (status === "ok") return "badge-ok";
  if (status === "error") return "badge-error";
  return "badge-pending";
}

function badgeLabel(status) {
  if (status === "ok") return "Đã lưu";
  if (status === "error") return "Lỗi";
  return "Đang gửi...";
}

// ========================================================
// UI: lịch sử (trong phiên hiện tại)
// ========================================================
function addHistoryItem(code, time, status) {
  const id = "h" + Date.now() + Math.random().toString(16).slice(2);
  historyItems.unshift({ id, code, time, status });
  renderHistory();
  return id;
}

function updateHistoryStatus(id, status) {
  const item = historyItems.find((h) => h.id === id);
  if (item) {
    item.status = status;
    renderHistory();
  }
}

function renderHistory() {
  const container = document.getElementById("historyList");

  if (historyItems.length === 0) {
    container.innerHTML = '<div class="empty-history">Chưa có mã nào được quét</div>';
    return;
  }

  container.innerHTML = historyItems
    .map((item) => {
      const icon =
        item.status === "ok" ? "✅" : item.status === "error" ? "❌" : "⏳";
      return `
        <div class="history-item">
          <div class="history-code">${icon} ${escapeHtml(item.code)}</div>
          <div class="history-time">${escapeHtml(item.time)}</div>
        </div>
      `;
    })
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function bindClearHistory() {
  document.getElementById("clearHistoryBtn").addEventListener("click", () => {
    historyItems = [];
    renderHistory();
  });
}

// ========================================================
// Toast thông báo nhỏ
// ========================================================
let toastTimeout = null;
function showToast(message, type) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = "toast show " + (type || "");

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.className = "toast";
  }, 2200);
}
