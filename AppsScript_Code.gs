function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sheet1');

    // Nếu sheet chưa có dòng tiêu đề, thêm vào
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Mã barcode', 'Thời gian quét']);
    }

    var data = JSON.parse(e.postData.contents);
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
