// ========================================================
// CẤU HÌNH: dán URL Web App của Google Apps Script vào đây
// Ví dụ: "https://script.google.com/macros/s/AKfycb..../exec"
// ========================================================
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyCYkpcSGnZ4lx9Zy209JNReArfmyC-8FFsPngU3AflkNUFU0AwHuTTGxESFZKrfmyK/exec";

// PHẢI khớp chính xác với biến SECRET_KEY trong file Apps Script (.gs)
// Đổi thành chuỗi bí mật riêng của bạn, ví dụ: "kho-spc-2026-x7k9"
const SECRET_KEY = "jppydpftYmA54YrgSpkWGGPZFSetVtxU";

// ========================================================
// Biến trạng thái
// ========================================================
let lastScannedCode = null;
let lastScannedAt = 0;
const DUPLICATE_COOLDOWN_MS = 1500; // tránh gửi trùng mã liên tiếp trong X ms
let historyItems = []; // lưu trong session (reset khi reload trang)

// ========================================================
// Khởi động
// ========================================================
document.addEventListener("DOMContentLoaded", () => {
  checkConfig();
  initScanner();
  bindManualInput();
  bindClearHistory();
  bindAudioUnlock();
});

// Safari chỉ cho phép phát âm thanh sau khi có tương tác người dùng (chạm/click).
// Vì camera tự bật ngay khi vào trang, ta "mở khóa" AudioContext ngay lần chạm đầu tiên,
// để đảm bảo tiếng bíp phát được kể cả ở lần quét đầu tiên.
function bindAudioUnlock() {
  const unlock = () => {
    getAudioContext();
    document.removeEventListener("touchstart", unlock);
    document.removeEventListener("click", unlock);
  };
  document.addEventListener("touchstart", unlock, { once: true });
  document.addEventListener("click", unlock, { once: true });
}

function checkConfig() {
  const urlNotSet = !SCRIPT_URL || SCRIPT_URL.includes("DÁN_URL");
  const keyNotSet = !SECRET_KEY || SECRET_KEY.includes("DOI_CHUOI");
  if (urlNotSet || keyNotSet) {
    document.getElementById("configWarning").style.display = "block";
  }
}

// ========================================================
// Camera quét mã (html5-qrcode)
// ========================================================
let html5QrCodeInstance = null;

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
    experimentalFeatures: {
      useBarCodeDetectorIfSupported: true,
    },
  });
  html5QrCodeInstance = html5QrCode;

  const config = {
    fps: 20,
    // Khung chữ nhật ngang, rộng hơn cao - phù hợp barcode 1D dài và mảnh
    qrbox: function (viewfinderWidth, viewfinderHeight) {
      const width = Math.floor(viewfinderWidth * 0.9);
      const height = Math.floor(viewfinderHeight * 0.45);
      return { width: width, height: height };
    },
    aspectRatio: 1.3,
    disableFlip: false,
  };

  // Yêu cầu độ phân giải cao + lấy nét liên tục (giúp đọc rõ mã nhỏ/mã mờ)
  const cameraConfig = {
    facingMode: "environment",
    width: { ideal: 1920, min: 1280 },
    height: { ideal: 1080, min: 720 },
    advanced: [{ focusMode: "continuous" }],
  };

  html5QrCode
    .start(
      cameraConfig,
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
      setupCameraControls();
    })
    .catch((err) => {
      console.error(err);
      statusBar.textContent =
        "Không thể mở camera. Hãy cấp quyền Camera cho Safari trong Cài đặt, hoặc dùng ô nhập tay bên dưới.";
    });
}

// ========================================================
// Điều khiển Zoom / Đèn flash (nếu thiết bị hỗ trợ)
// ========================================================
let currentZoom = 1;
let zoomCapabilities = null;
let torchOn = false;
let torchSupported = false;

function setupCameraControls() {
  const videoEl = document.querySelector("#reader video");
  if (!videoEl || !videoEl.srcObject) return;

  const track = videoEl.srcObject.getVideoTracks()[0];
  if (!track) return;

  const capabilities = track.getCapabilities ? track.getCapabilities() : {};
  const controlsBar = document.getElementById("cameraControls");
  const zoomInBtn = document.getElementById("zoomInBtn");
  const zoomOutBtn = document.getElementById("zoomOutBtn");
  const torchBtn = document.getElementById("torchBtn");

  let anyControlAvailable = false;

  // --- Lấy nét liên tục (giúp camera tự nét lại khi đưa mã vào gần) ---
  if (capabilities.focusMode && capabilities.focusMode.includes("continuous")) {
    track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
  }

  // --- Zoom ---
  if (capabilities.zoom) {
    zoomCapabilities = capabilities.zoom;
    const startZoom = Math.min(capabilities.zoom.max, Math.max(capabilities.zoom.min, 1.5));
    currentZoom = startZoom;
    track.applyConstraints({ advanced: [{ zoom: startZoom }] }).catch(() => {});
    anyControlAvailable = true;

    zoomInBtn.addEventListener("click", () => adjustZoom(track, 0.5));
    zoomOutBtn.addEventListener("click", () => adjustZoom(track, -0.5));
  } else {
    zoomInBtn.style.display = "none";
    zoomOutBtn.style.display = "none";
  }

  // --- Đèn flash (torch) ---
  if (capabilities.torch) {
    torchSupported = true;
    anyControlAvailable = true;
    torchBtn.addEventListener("click", () => toggleTorch(track));
  } else {
    torchBtn.style.display = "none";
  }

  if (anyControlAvailable) {
    controlsBar.style.display = "flex";
  }
}

function adjustZoom(track, delta) {
  if (!zoomCapabilities) return;
  const min = zoomCapabilities.min || 1;
  const max = zoomCapabilities.max || 1;
  let newZoom = Math.min(max, Math.max(min, currentZoom + delta));
  currentZoom = newZoom;

  track
    .applyConstraints({ advanced: [{ zoom: newZoom }] })
    .catch((err) => console.error("Zoom error:", err));
}

function toggleTorch(track) {
  torchOn = !torchOn;
  track
    .applyConstraints({ advanced: [{ torch: torchOn }] })
    .then(() => {
      document.getElementById("torchBtn").classList.toggle("active", torchOn);
    })
    .catch((err) => {
      console.error("Torch error:", err);
      showToast("Đèn flash không khả dụng trên thiết bị này", "error");
    });
}

// ========================================================
// Âm thanh phản hồi (Web Audio API - không cần file audio)
// ========================================================
let audioCtx = null;

function getAudioContext() {
  // Phải tạo AudioContext sau 1 tương tác người dùng (yêu cầu của Safari)
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

function playTone(frequency, durationMs, volume) {
  try {
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gainNode.gain.value = volume;

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    const now = ctx.currentTime;
    oscillator.start(now);
    // giảm âm lượng dần để tránh tiếng "tách" khi tắt
    gainNode.gain.setValueAtTime(volume, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + durationMs / 1000);
    oscillator.stop(now + durationMs / 1000);
  } catch (err) {
    console.error("Audio error:", err);
  }
}

// Tiếng "bíp" cao, ngắn - giống máy quét kho, phát ngay khi camera nhận ra mã
function playSuccessBeep() {
  playTone(1500, 100, 0.25);
}

// Tiếng đôi thấp - báo gửi lên Sheet thất bại
function playErrorBeep() {
  playTone(300, 150, 0.25);
  setTimeout(() => playTone(300, 150, 0.25), 180);
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
  playSuccessBeep();
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
    playSuccessBeep();
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
      body: JSON.stringify({ barcode, timestamp, source, key: SECRET_KEY }),
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
    playErrorBeep();
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
