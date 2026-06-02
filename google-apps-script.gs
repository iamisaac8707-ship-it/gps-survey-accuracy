const SPREADSHEET_ID = "";
const SHEET_NAME = "measurements";

const HEADERS = [
  "저장일시",
  "수업_세션",
  "기기_ID",
  "측정_ID",
  "측정일시",
  "출발_위도",
  "출발_경도",
  "목적지_위도",
  "목적지_경도",
  "GPS_직선거리_m",
  "실제_측량값_m",
  "절대_오차_m",
  "상대_오차율_%",
  "주변_환경",
  "환경_코드",
  "GPS_정확도_m",
];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getOrCreateSheet_();
    const payload = parsePayload_(e);

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

function setup() {
  getOrCreateSheet_();
}

function getOrCreateSheet_() {
  const spreadsheet = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    throw new Error("No active spreadsheet. Open Apps Script from the Google Sheet, or set SPREADSHEET_ID.");
  }

  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);

  ensureHeaders_(sheet);

  return sheet;
}

function ensureHeaders_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
  } else {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
  sheet.setFrozenRows(1);
}

function parsePayload_(e) {
  if (e && e.parameter && e.parameter.payload) {
    return JSON.parse(e.parameter.payload);
  }

  if (e && e.postData && e.postData.contents) {
    const contents = e.postData.contents;
    try {
      return JSON.parse(contents);
    } catch (error) {
      const formPayload = parseFormEncoded_(contents).payload;
      if (formPayload) {
        return JSON.parse(formPayload);
      }
      throw error;
    }
  }

  return {};
}

function parseFormEncoded_(contents) {
  return contents.split("&").reduce((params, pair) => {
    const parts = pair.split("=");
    const key = decodeURIComponent((parts.shift() || "").replace(/\+/g, " "));
    const value = decodeURIComponent(parts.join("=").replace(/\+/g, " "));
    if (key) {
      params[key] = value;
    }
    return params;
  }, {});
}

function json_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
