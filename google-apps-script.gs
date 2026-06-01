const SHEET_NAME = "measurements";

const HEADERS = [
  "saved_at",
  "session_code",
  "client_id",
  "client_measurement_id",
  "timestamp",
  "start_lat",
  "start_lng",
  "end_lat",
  "end_lng",
  "gps_distance_m",
  "actual_distance_m",
  "absolute_error_m",
  "relative_error_percent",
  "environment",
  "environment_key",
  "gps_accuracy_m",
];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getOrCreateSheet_();
    const payload = JSON.parse(e.postData.contents || "{}");

    sheet.appendRow([
      new Date(),
      payload.sessionCode || "default",
      payload.clientId || "",
      payload.clientMeasurementId || "",
      payload.timestamp || "",
      payload.startLat || "",
      payload.startLng || "",
      payload.endLat || "",
      payload.endLng || "",
      payload.gpsDistance || "",
      payload.actualDistance || "",
      payload.absoluteError || "",
      payload.relativeError || "",
      payload.environment || "",
      payload.environmentKey || "",
      payload.gpsAccuracy || "",
    ]);

    return json_({ ok: true });
  } catch (error) {
    return json_({ ok: false, error: String(error) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return json_({ ok: true, message: "GPS survey sheet endpoint is running." });
}

function getOrCreateSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function json_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
