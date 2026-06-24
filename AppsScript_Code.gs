// ========================================================
// ĐỔI giá trị này thành 1 chuỗi bí mật do bạn tự nghĩ ra,
// ví dụ: "kho-spc-2026-x7k9", rồi dùng đúng chuỗi này
// trong file app.js (biến SECRET_KEY)
// ========================================================
var SECRET_KEY = "DOI_CHUOI_BI_MAT_CUA_BAN_O_DAY";

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    // Kiểm tra Secret Key - nếu sai hoặc thiếu thì từ chối ghi
    if (!data.key || data.key !== SECRET_KEY) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'error', message: 'Unauthorized: sai hoặc thiếu key' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sheet1');

    // Nếu sheet chưa có dòng tiêu đề, thêm vào
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Mã barcode', 'Thời gian quét']);
    }

    var barcode = data.barcode;
    var timestamp = data.timestamp || new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

    sheet.appendRow([barcode, timestamp]);

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Hàm test đơn giản, có thể bỏ qua
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'API đang hoạt động' }))
    .setMimeType(ContentService.MimeType.JSON);
}
