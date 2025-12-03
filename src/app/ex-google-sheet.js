const discordWebhookUrl = "https://discord.com/api/webhooks/1383779028640600154/PuGJBnrS6JthrsJSDysdlUC8gt8SzBeFSZ3FerBltQtJWg9JHQThm-z4n9rLg-dr1slD";

// ===== FUNCTIONS เดิมทั้งหมด (Discord Integration) =====

function checkBossTimeAndNotify() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet(). getSheetByName("BossTime");
  const data = sheet.getDataRange().getValues();
  const now = new Date();
  let tagRole = '';

  for (let i = 1; i < data.length; i++) {
    const bossName = data[i][1];      // คอลัมน์ B
    const hoursCell = data[i][2];     // คอลัมน์ C
    const timeCell = data[i][4];      // คอลัมน์ E
    const status = data[i][5];        // คอลัมน์ F
    const notified = data[i][8];      // คอลัมน์ I (TRUE / FALSE)
    const rowIndex = i + 1;
    let owner_color;

    // ตรวจสอบว่า timeCell เป็น Date ที่ valid
    if (Object.prototype.toString.call(timeCell) === "[object Date]" && !isNaN(timeCell.getTime()) && ! notified) {

      // สร้างเวลาของบอสโดยใช้วันที่วันนี้
      const bossTime = new Date(
        now.getFullYear(),
        now.getMonth(),
        now. getDate(),
        timeCell. getHours(),
        timeCell.getMinutes(),
        timeCell.getSeconds()
      );

      const diffMs = bossTime.getTime() - now.getTime();
      const diffMinutes = Math.floor(diffMs / (1000 * 60));

      if (diffMinutes >= 0 && diffMinutes <= 3) {
        const diffMinutesRound = Math.ceil(diffMinutes);
        const formattedTime = Utilities.formatDate(bossTime, Session.getScriptTimeZone(), "HH:mm");
        if (status == 'มึนงง') {
          owner_color = '[2;36mมึนงง[0m';
          tagRole = '<@&1375023515295551558>';
        } else if (status == 'อุ๋งอุ๋ง') {
          owner_color = '[2;35mอุ๋งอุ๋ง[0m';
          tagRole = '<@&1383385172774223972>';
        } else if (status == 'Rangsit') {
          owner_color = '[2;31mSoul[0m';
          tagRole = '<@&1384294404340056064>';
        }

        const text_style_start = '```ansi\n';
        const text_style_end = '\n```';
        const minutesLeft = diffMinutes + 1;
        const message = `📢 บอส "${bossName}" เกิดเวลา ${formattedTime} บอสของ: ${owner_color} คาดว่าจะเกิดในอีก ${minutesLeft} นาที`;
        const total_msg = text_style_start + message + text_style_end + ' ' + tagRole;
        sendToDiscord(discordWebhookUrl, total_msg);

        if (minutesLeft === 1) {
          sheet.getRange(rowIndex, 9).setValue(true);
        }
      }
    }
  }
}

function sendToDiscord(url, content) {
  const payload = {
    content: content
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload)
  };

  UrlFetchApp.fetch(url, options);
}

function getListBossTime() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("BossTime");
  const data = sheet.getDataRange().getValues();
  const now = new Date();
  const items1 = [];
  const items2 = [];
  const items3 = [];

  for (let i = 1; i < data.length; i++) {
    const bossName = data[i][1];    // คอลัมน์ B
    const spawnTime = data[i][4];   // คอลัมน์ E
    const owner = data[i][5];       // คอลัมน์ F
    const sortValue = data[i][7];   // H

    if (! bossName || !spawnTime || sortValue === '') continue;

    let formattedTime = '';
    let bossTime;
    if (Object.prototype.toString.call(spawnTime) === "[object Date]" && !isNaN(spawnTime.getTime())) {
      bossTime = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        spawnTime.getHours(),
        spawnTime.getMinutes(),
        spawnTime.getSeconds()
      );
      formattedTime = Utilities. formatDate(bossTime, Session.getScriptTimeZone(), "HH:mm");
    } else {
      formattedTime = spawnTime. toString();
    }

    let owner_color;
    if (owner == 'มึนงง') {
      owner_color = '[2;36mมึนงง[0m'
      items1.push({
        bossName,
        owner: owner_color || 'ไม่ระบุ',
        bossTime,
        formattedTime,
        sortValue: parseFloat(sortValue) || 9999
      });
    } else if (owner == 'อุ๋งอุ๋ง') {
      owner_color = '[2;35mอุ๋งอุ๋ง[0m'
      items2.push({
        bossName,
        owner: owner_color || 'ไม่ระบุ',
        bossTime,
        formattedTime,
        sortValue: parseFloat(sortValue) || 9999
      });
    } else if (owner == 'Soul') {
      owner_color = '[2;31mSoul[0m'
      items3. push({
        bossName,
        owner: owner_color || 'ไม่ระบุ',
        bossTime,
        formattedTime,
        sortValue: parseFloat(sortValue) || 9999
      });
    }
  }

  items1.sort((a, b) => a.sortValue - b.sortValue);
  items2.sort((a, b) => a.sortValue - b.sortValue);
  items3.sort((a, b) => a.sortValue - b.sortValue);

  const resultLines1 = items1.map(item =>
    `🕐 ${item.formattedTime} - **${item.bossName}** (ของ ${item.owner})`
  );
  const resultLines2 = items2.map(item =>
    `🕐 ${item.formattedTime} - **${item.bossName}** (ของ ${item.owner})`
  );
  const resultLines3 = items3.map(item =>
    `🕐 ${item.formattedTime} - **${item.bossName}** (ของ ${item.owner})`
  );

  if (resultLines1.length > 0) {
    const finalResultString1 = resultLines1.join('\n');
    sendToDiscord(discordWebhookUrl, '📋 รายชื่อบอส มึนงง(แจ้งทุก 15 นาที):```ansi\n' + finalResultString1 + '\n```');
  }

  if (resultLines2.length > 0) {
    const finalResultString2 = resultLines2.join('\n');
    sendToDiscord(discordWebhookUrl, '📋 รายชื่อบอส อุ๋งอุ๋ง(แจ้งทุก 15 นาที):```ansi\n' + finalResultString2 + '\n```');
  }

  if (resultLines3.length > 0) {
    const finalResultString3 = resultLines3.join('\n');
    sendToDiscord(discordWebhookUrl, '📋 รายชื่อบอส Soul(แจ้งทุก 15 นาที):```ansi\n' + finalResultString3 + '\n```');
  }
}

function onEdit(e) {
  const sheet = e.source.getActiveSheet();
  const editedCell = e.range;
  const row = editedCell.getRow();
  const col = editedCell.getColumn();

  // ตรวจสอบว่าอยู่ในชีตหลัก และเป็นการแก้คอลัมน์ D (เลข 4)
  if (sheet.getName() === "BossTime" && col === 4 && row > 1) {
    const timestampCol = 10; // คอลัมน์ J
    const notifyCol = 9;     // คอลัมน์ I

    // บันทึกวันเวลาในคอลัมน์ J
    sheet.getRange(row, timestampCol).setValue(new Date());

    // รีเซ็ตค่าแจ้งเตือนให้เป็น FALSE
    sheet.getRange(row, notifyCol).setValue(false);
  }
}

// ===== FUNCTIONS ใหม่สำหรับ Angular Integration =====

function doGet(e) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  const action = e.parameter.action;

  try {
    if (action === 'list') {
      return getBossList();
    } else if (action === 'get_boss_names') {
      return getBossNames();
    } else if (action === 'get_all_bosses') {
      return getAllBossesData();
    } else {
      return output.setContent(JSON.stringify({
        success: false,
        message: 'Invalid action'
      }));
    }
  } catch (error) {
    return output.setContent(JSON.stringify({
      success: false,
      message: error.toString()
    }));
  }
}

function doPost(e) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType. JSON);

  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("BossTime");

    if (data.action === 'update_boss_time') {
      return handleUpdateBossTime(data, sheet);
    } else if (data.action === 'add_boss') {
      return handleAddBoss(data, sheet);
    } else if (data.action === 'reset_notification') {
      return handleResetNotification(data, sheet);
    } else {
      return output.setContent(JSON.stringify({
        success: false,
        message: 'Invalid action'
      }));
    }
  } catch (error) {
    return output.setContent(JSON. stringify({
      success: false,
      message: error.toString()
    }));
  }
}

function getBossList() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("BossTime");
  const data = sheet.getDataRange().getValues();
  const results = [];
  const now = new Date();

  for (let i = 1; i < data.length; i++) {
    const bossName = data[i][1];
    const spawnTime = data[i][4];
    const owner = data[i][5];

    if (! bossName || !spawnTime) continue;

    let formattedTime = '';
    if (Object.prototype.toString.call(spawnTime) === "[object Date]" && !isNaN(spawnTime.getTime())) {
      const bossTime = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        spawnTime.getHours(),
        spawnTime.getMinutes(),
        spawnTime.getSeconds()
      );
      formattedTime = Utilities.formatDate(bossTime, Session. getScriptTimeZone(), "HH:mm");
    } else {
      formattedTime = spawnTime.toString();
    }

    results.push({
      bossName,
      owner: owner || 'ไม่ระบุ',
      formattedTime
    });
  }

  return ContentService.createTextOutput(JSON. stringify({
    success: true,
    data: results
  })). setMimeType(ContentService. MimeType.JSON);
}

function getBossNames() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet(). getSheetByName("BossTime");
  const data = sheet.getDataRange().getValues();
  const bossNames = [];

  for (let i = 1; i < data.length; i++) {
    const name = data[i][1];
    if (name && ! bossNames.includes(name)) {
      bossNames.push(name);
    }
  }

  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    bossNames: bossNames
  })).setMimeType(ContentService.MimeType.JSON);
}

function getAllBossesData() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("BossTime");
  const data = sheet.getDataRange().getValues();
  const bosses = [];
  const now = new Date();

  for (let i = 1; i < data.length; i++) {
    const bossName = data[i][1];
    const hoursCell = data[i][2];
    const spawnTime = data[i][4];
    const owner = data[i][5];
    const status = data[i][5];
    const notified = data[i][8];

    if (!bossName) continue;

    let formattedTime = '';
    if (Object.prototype.toString.call(spawnTime) === "[object Date]" && !isNaN(spawnTime.getTime())) {
      formattedTime = Utilities.formatDate(spawnTime, Session. getScriptTimeZone(), "HH:mm");
    }

    bosses.push({
      id: i,
      bossName,
      hours: hoursCell,
      spawnTime: formattedTime,
      owner,
      status,
      notified: notified ?  true : false
    });
  }

  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    data: bosses
  })).setMimeType(ContentService.MimeType.JSON);
}

function handleUpdateBossTime(data, sheet) {
  const bossName = data.name?. trim();
  const timeString = data.time?.trim();
  const owner_boss = data.owner?.trim();

  if (!bossName || ! timeString) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      message: 'Missing name or time'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  Logger.log("Received boss name: " + bossName);
  Logger.log("Received time string: " + timeString);

  const lastRow = sheet.getLastRow();
  const range = sheet.getRange(2, 2, lastRow - 1);
  const values = range.getValues();

  let found = false;

  for (let i = 0; i < values.length; i++) {
    if (values[i][0]. toString().trim() === bossName) {
      Logger.log("Matched sheet boss name: " + values[i][0]. toString(). trim());
      const rowIndex = i + 2;
      const today = new Date();
      const [hours, minutes] = timeString. split(':');
      Logger.log("H : " + hours);
      Logger.log("M : " + minutes);
      today.setHours(parseInt(hours), parseInt(minutes), 0, 0);

      sheet.getRange(rowIndex, 4).setValue(today);
      sheet.getRange(rowIndex, 6).setValue(owner_boss);

      found = true;
      break;
    }
  }

  if (found) {
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      message: 'Updated successfully'
    })).setMimeType(ContentService.MimeType.JSON);
  } else {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      message: 'Boss not found'
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function handleAddBoss(data, sheet) {
  const bossName_new = data.name?.trim();
  const hours = parseFloat(data.hours);

  if (!bossName_new || isNaN(hours)) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      message: '❌ ชื่อบอสหรือชั่วโมงไม่ถูกต้อง'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  const sheetData = sheet.getDataRange().getValues();
  const nameColumnIndex = 1;
  const idColumnIndex = 0;

  const exists = sheetData.some(row => row[nameColumnIndex]?.toString(). trim(). toLowerCase() === bossName_new.toLowerCase());

  if (exists) {
    return ContentService. createTextOutput(JSON.stringify({
      success: false,
      message: `⚠️ บอสชื่อ "${bossName_new}" มีอยู่แล้วในระบบ`
    })). setMimeType(ContentService. MimeType.JSON);
  }

  let newId = 1;

  if (sheetData.length > 1) {
    const lastId = sheetData
      .slice(1)
      .map(row => parseFloat(row[idColumnIndex]))
      .filter(id => !isNaN(id))
      .sort((a, b) => b - a)[0];

    if (lastId) {
      newId = lastId + 1;
    }
  }

  sheet.appendRow([newId, bossName_new, hours]);

  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    message: `✅ เพิ่มบอส "${bossName_new}" (เกิดทุก ${hours} ชม.) แล้ว`
  })).setMimeType(ContentService.MimeType.JSON);
}

function handleResetNotification(data, sheet) {
  const rowIndex = data.rowIndex;

  if (! rowIndex) {
    return ContentService.createTextOutput(JSON. stringify({
      success: false,
      message: 'Missing rowIndex'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  sheet.getRange(rowIndex, 9).setValue(false);

  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    message: 'Notification reset'
  })).setMimeType(ContentService.MimeType. JSON);
}
