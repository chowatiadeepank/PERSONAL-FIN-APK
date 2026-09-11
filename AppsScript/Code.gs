/**
 * Personal Finance — Google Sheet sync backend.
 *
 * WHAT THIS DOES
 * - Receives your app's data (POST) and stores a full backup, plus a
 *   human-readable tab per data type (Accounts, Transactions, Debts,
 *   Investments, SoldInvestments, InvestmentEvents, Loans, Recurring),
 *   so you can open the Sheet on your laptop, phone, tablet — anywhere —
 *   and see your data as normal rows and columns.
 * - Lets the app pull that backup back down (GET), so a second device
 *   (or a reinstalled app) can restore the latest data automatically.
 *
 * HOW TO INSTALL
 * 1. Go to https://script.google.com/ and create a New project.
 * 2. Delete the placeholder code and paste this whole file in.
 * 3. Click "Deploy" → "New deployment".
 *    - Click the gear icon next to "Select type" → choose "Web app".
 *    - Description: anything, e.g. "Personal Finance sync".
 *    - Execute as: "Me".
 *    - Who has access: "Anyone".  (Required — the app calls this
 *      anonymously. Your data is only as private as this link, so don't
 *      share it publicly.)
 * 4. Click "Deploy", authorize the permissions Google asks for.
 * 5. Copy the "Web app URL" that ends in /exec.
 * 6. In the app, open Settings → "Google Sheet sync", paste that link
 *    into "Apps Script web app link", and tap "Save link".
 * 7. A new Google Sheet is created automatically the first time you sync
 *    (in the same Google Drive as this script) — you don't need to
 *    create one yourself.
 *
 * If you ever change the code here, click "Deploy" → "Manage deployments"
 * → the pencil/edit icon → "New version" → Deploy, so the same URL picks
 * up your changes.
 */

var RAW_SHEET_NAME = "RawBackup_DoNotEdit";
var META_SHEET_NAME = "Meta";

function getOrCreateSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("SHEET_ID");
  var ss;
  if (id) {
    try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create("Personal Finance Data");
    props.setProperty("SHEET_ID", ss.getId());
  }
  return ss;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
      .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || "pull";
    var ss = getOrCreateSpreadsheet_();

    if (action === "ping") {
      return jsonOut_({ ok: true, sheetUrl: ss.getUrl() });
    }

    // action === "pull"
    var raw = ss.getSheetByName(RAW_SHEET_NAME);
    if (!raw) return jsonOut_({ ok: false, error: "No backup has been pushed yet." });
    var json = raw.getRange(1, 1).getValue();
    var lastModified = Number(raw.getRange(1, 2).getValue()) || 0;
    if (!json) return jsonOut_({ ok: false, error: "No backup has been pushed yet." });
    var data = JSON.parse(json);
    return jsonOut_({ ok: true, data: data, lastModified: lastModified });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var data = body.data || {};
    var lastModified = body.lastModified || Date.now();
    var ss = getOrCreateSpreadsheet_();

    // 1) Store the exact JSON so a pull restores your data perfectly.
    var raw = ss.getSheetByName(RAW_SHEET_NAME) || ss.insertSheet(RAW_SHEET_NAME);
    raw.getRange(1, 1).setValue(JSON.stringify(data));
    raw.getRange(1, 2).setValue(lastModified);
    raw.hideSheet();

    // 2) Also lay each list out as its own readable tab.
    var categories = ["accounts", "transactions", "debts", "investments",
      "soldInvestments", "investmentEvents", "loans", "recurring"];
    categories.forEach(function (key) {
      writeCategorySheet_(ss, categoryTabName_(key), data[key]);
    });

    // 3) A small summary tab.
    var meta = ss.getSheetByName(META_SHEET_NAME) || ss.insertSheet(META_SHEET_NAME);
    meta.clearContents();
    meta.getRange(1, 1, 3, 2).setValues([
      ["Last synced (from device)", new Date(lastModified)],
      ["Last synced (server received)", new Date()],
      ["Accounts / Transactions / Loans etc.", "See the other tabs →"]
    ]);

    // Keep the readable tabs in a sensible order, raw/meta tucked away.
    orderSheets_(ss, categories.map(categoryTabName_));

    return jsonOut_({ ok: true, lastModified: lastModified, sheetUrl: ss.getUrl() });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function categoryTabName_(key) {
  var names = {
    accounts: "Accounts",
    transactions: "Transactions",
    debts: "Debts",
    investments: "Investments",
    soldInvestments: "Sold Investments",
    investmentEvents: "Investment Events",
    loans: "Loans",
    recurring: "Recurring"
  };
  return names[key] || key;
}

/** Writes an array of objects to a sheet as a normal table.
 *  Column set is computed from whatever fields are actually present,
 *  so this keeps working even if the app's data model changes shape. */
function writeCategorySheet_(ss, sheetName, arr) {
  var sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  sheet.clearContents();
  if (!arr || !arr.length) {
    sheet.getRange(1, 1).setValue("(no entries yet)");
    return;
  }
  var keys = [];
  arr.forEach(function (obj) {
    Object.keys(obj || {}).forEach(function (k) {
      if (keys.indexOf(k) === -1) keys.push(k);
    });
  });
  var rows = [keys];
  arr.forEach(function (obj) {
    rows.push(keys.map(function (k) {
      var v = obj[k];
      if (v === undefined || v === null) return "";
      if (typeof v === "object") return JSON.stringify(v);
      return v;
    }));
  });
  sheet.getRange(1, 1, rows.length, keys.length).setValues(rows);
  sheet.getRange(1, 1, 1, keys.length).setFontWeight("bold");
  sheet.setFrozenRows(1);
}

function orderSheets_(ss, orderedNames) {
  orderedNames.forEach(function (name, i) {
    var sh = ss.getSheetByName(name);
    if (sh) ss.setActiveSheet(sh), ss.moveActiveSheet(i + 1);
  });
}
