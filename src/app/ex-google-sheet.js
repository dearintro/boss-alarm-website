const discordWebhookUrl = "https://discord.com/api/webhooks/1383779028640600154/PuGJBnrS6JthrsJSDysdlUC8gt8SzBeFSZ3FerBltQtJWg9JHQThm-z4n9rLg-dr1slD";

function checkBossTimeAndNotify() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("BossTime"); // แก้ชื่อชีต
  const data = sheet.getDataRange().getValues();
  const now = new Date();
  let tagRole ='';

  for (let i = 1; i < data.length; i++) {
    const bossName = data[i][1];      // คอลัมน์ B
    const hoursCell = data[i][2];         // คอลัมน์ C
    const timeCell = data[i][4];      // คอลัมน์ E
    const status = data[i][5];        // คอลัมน์ F
    const notified = data[i][8];       // คอลัมน์ I (TRUE / FALSE)
    const rowIndex = i + 1;
    let owner_color;
          // ตรวจสอบว่า timeCell เป็น Date ที่ valid
    if (Object.prototype.toString.call(timeCell) === "[object Date]" && !isNaN(timeCell.getTime()) && !notified) {

            // สร้างเวลาของบอสโดยใช้วันที่วันนี้
      const bossTime = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        timeCell.getHours(),
        timeCell.getMinutes(),
        timeCell.getSeconds()
      );

      const diffMs = bossTime.getTime() - now.getTime(); // ไม่ใช้ Math.abs
      const diffMinutes = Math.floor(diffMs / (1000 * 60));

      if (diffMinutes >= 0 && diffMinutes <= 3) {
        const diffMinutesRound = Math.ceil(diffMinutes);
        const formattedTime = Utilities.formatDate(bossTime, Session.getScriptTimeZone(), "HH:mm");
        if(status=='มึนงง'){
            owner_color = '[2;36m,มึนงง[0m';
            tagRole = '<@&1375023515295551558>';
          }else if(status=='อุ๋งอุ๋ง'){
            owner_color = '[2;35mอุ๋งอุ๋ง[0m';
            tagRole = '<@&1383385172774223972>';
          }else if(status=='Rangsit'){
            owner_color = '[2;31mSoul[0m';
            tagRole = '<@&1384294404340056064>';
          }

        const text_style_start = '```ansi\n';
        const text_style_end = '\n```';
        const minutesLeft = diffMinutes + 1; // แสดงว่าเหลืออีกกี่นาที
        const message = `📢 บอส "${bossName}" เกิดเวลา ${formattedTime} บอสของ: ${owner_color} คาดว่าจะเกิดในอีก ${minutesLeft} นาที`;
        const total_msg = text_style_start+message+text_style_end+' '+tagRole;
        sendToDiscord(discordWebhookUrl, total_msg);
            // ถ้าเหลืออีกแค่ 1 นาที → ให้ตั้งค่าแจ้งเตือนว่า "แจ้งแล้ว"
          if (minutesLeft === 1) {
            sheet.getRange(rowIndex, 9).setValue(true); // คอลัมน์ I
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

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("BossTime");

  if (data.action === 'update_boss_time') {
    // หาแถวที่มีชื่อบอสแล้วอัปเดตเวลาคอลัมน์ D
    const bossName = data.name?.trim();
    const timeString = data.time?.trim();
    const owner_boss = data.owner?.trim();

      if (!bossName || !timeString) {
        return ContentService.createTextOutput(JSON.stringify({ success: false, message: 'Missing name or time' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    Logger.log("Received boss name: " + bossName);
    Logger.log("Received time string: " + timeString);
      const lastRow = sheet.getLastRow();
      const range = sheet.getRange(2, 2, lastRow - 1); // Column B (ชื่อบอส), แถว 2 เป็นต้นไป
      const values = range.getValues();

      let found = false;

      for (let i = 0; i < values.length; i++) {
        if (values[i][0].toString().trim() === bossName) {
          Logger.log("Matched sheet boss name: " + values[i][0].toString().trim());
          const rowIndex = i + 2; // เพราะเริ่มจากแถว 2
          const today = new Date();
          const [hours, minutes] = timeString.split(':');
          Logger.log("H : "+hours);
          Logger.log("M : "+minutes);
          today.setHours(parseInt(hours), parseInt(minutes), 0, 0);

          sheet.getRange(rowIndex, 4).setValue(today); // คอลัมน์ D = เวลาที่บอสตาย
          sheet.getRange(rowIndex, 6).setValue(owner_boss); // คอลัมน์ F = บอสของ

          found = true;
          break;
        }
      }

      if (found) {
        return ContentService.createTextOutput(JSON.stringify({ success: true, message: 'Updated successfully' }))
          .setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService.createTextOutput(JSON.stringify({ success: false, message: 'Boss not found' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

  if (data.action === 'add_boss') {
    // เพิ่มบอสลงในแถวใหม่
       const bossName_new = data.name?.trim();
       const hours = parseFloat(data.hours);

    if (!bossName_new || isNaN(hours)) {
      return ContentService.createTextOutput(
        JSON.stringify({ message: '❌ ชื่อบอสหรือชั่วโมงไม่ถูกต้อง' })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    const sheetData = sheet.getDataRange().getValues();
    const nameColumnIndex = 1; // คอลัมน์ B (index เริ่มจาก 0)
    const idColumnIndex = 0; // คอลัมน์ A (index เริ่มจาก 0)

    // ตรวจสอบว่ามีบอสชื่อนี้อยู่แล้วหรือไม่
    const exists = sheetData.some(row => row[nameColumnIndex]?.toString().trim().toLowerCase() === bossName_new.toLowerCase());

    if (exists) {
      return ContentService.createTextOutput(
        JSON.stringify({ success: false, message: `⚠️ บอสชื่อ "${bossName_new}" มีอยู่แล้วในระบบ` })
      ).setMimeType(ContentService.MimeType.JSON);
    }


    let newId = 1; // กำหนดค่าเริ่มต้นเป็น 1 เผื่อกรณีที่ชีตว่างเปล่า

    // หา ID ล่าสุดในคอลัมน์ A
    if (sheetData.length > 1) { // ตรวจสอบว่ามีข้อมูลมากกว่า 1 แถว (เพื่อข้าม Header row)
      const lastId = sheetData
        .slice(1) // เริ่มต้นจากแถวที่ 2 (index 1) เพื่อข้าม header
        .map(row => parseFloat(row[idColumnIndex])) // แปลงค่าในคอลัมน์ A เป็นตัวเลข
        .filter(id => !isNaN(id)) // กรองเฉพาะค่าที่เป็นตัวเลข
        .sort((a, b) => b - a)[0]; // เรียงลำดับจากมากไปน้อยและเอาค่าแรก (ค่าสูงสุด)

      if (lastId) {
        newId = lastId + 1;
      }
    }

    // เพิ่มบรรทัดใหม่
    sheet.appendRow([newId, bossNameื_new, hours]); // คอลัมน์ A: เว้นไว้, B: bossName, C: hours

    return ContentService.createTextOutput(
      JSON.stringify({ success: true, message: `✅ เพิ่มบอส "${bossNameื_new}" (เกิดทุก ${hours} ชม.) แล้ว` })
    ).setMimeType(ContentService.MimeType.JSON);
  }

    // default case
  return ContentService.createTextOutput(
    JSON.stringify({ success: false, message: 'Invalid action' })
  ).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  if (e.parameter.action === 'list') {
    // ดึงรายการบอสทั้งหมดและคืนค่ากลับไป
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("BossTime"); // แก้ชื่อชีต
    const data = sheet.getDataRange().getValues();
      // เริ่มจากแถวที่ 2 (แถว 0 คือ header)
    const results = [];
    const now = new Date();

    for (let i = 1; i < data.length; i++) {
      const bossName = data[i][1];    // คอลัมน์ B
      const spawnTime = data[i][4];   // คอลัมน์ E
      const owner = data[i][5];       // คอลัมน์ F

    if (!bossName || !spawnTime) continue;

    // Format เวลาด้วย Utilities (ถ้า spawnTime เป็น Date object)
    let formattedTime = '';
    if (Object.prototype.toString.call(spawnTime) === "[object Date]" && !isNaN(spawnTime.getTime())) {
                  // สร้างเวลาของบอสโดยใช้วันที่วันนี้
      const bossTime = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        spawnTime.getHours(),
        spawnTime.getMinutes(),
        spawnTime.getSeconds()
      );
      formattedTime = Utilities.formatDate(bossTime, Session.getScriptTimeZone(), "HH:mm");
    } else {
      formattedTime = spawnTime.toString();
    }

    const line = `🕐 ${formattedTime} - **${bossName}** (ของ ${owner || 'ไม่ระบุ'})`;
    results.push(line);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ message: results.join('\n') }))
    .setMimeType(ContentService.MimeType.JSON);
  }

    if (e.parameter.action === 'get_boss_names') {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("BossTime");
    const data = sheet.getDataRange().getValues();
    const bossNames = [];

    for (let i = 1; i < data.length; i++) {
      const name = data[i][1];
      if (name && !bossNames.includes(name)) {
        bossNames.push(name);
      }
    }

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      bossNames: bossNames
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function getListBossTime(){
      // ดึงรายการบอสทั้งหมดและคืนค่ากลับไป
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("BossTime"); // แก้ชื่อชีต
    const data = sheet.getDataRange().getValues();
      // เริ่มจากแถวที่ 2 (แถว 0 คือ header)
    //const results = [];
    const now = new Date();
    const items = [];
    const items1 = [];
    const items2 =[];
    const items3 =[];

    for (let i = 1; i < data.length; i++) {
      const bossName = data[i][1];    // คอลัมน์ B
      const spawnTime = data[i][4];   // คอลัมน์ E
      const owner = data[i][5];       // คอลัมน์ F
      const sortValue = data[i][7];    // H

    if (!bossName || !spawnTime || sortValue === '') continue;

    // Format เวลาด้วย Utilities (ถ้า spawnTime เป็น Date object)
    let formattedTime = '';
    let bossTime;
    if (Object.prototype.toString.call(spawnTime) === "[object Date]" && !isNaN(spawnTime.getTime())) {
                  // สร้างเวลาของบอสโดยใช้วันที่วันนี้
       bossTime = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        spawnTime.getHours(),
        spawnTime.getMinutes(),
        spawnTime.getSeconds()
      );
      formattedTime = Utilities.formatDate(bossTime, Session.getScriptTimeZone(), "HH:mm");
    } else {
      formattedTime = spawnTime.toString();
    }

    let owner_color;
    if(owner=='มึนงง'){
      owner_color = '[2;36mมึนงง[0m'
      items1.push({
        bossName,
        owner: owner_color || 'ไม่ระบุ',
        bossTime,
        formattedTime,
        sortValue: parseFloat(sortValue) || 9999 // fallback เผื่อเป็น null หรือไม่ใช่ตัวเลข
      });

    }else if(owner=='อุ๋งอุ๋ง'){
      owner_color = '[2;35mอุ๋งอุ๋ง[0m'
      items2.push({
        bossName,
        owner: owner_color || 'ไม่ระบุ',
        bossTime,
        formattedTime,
        sortValue: parseFloat(sortValue) || 9999 // fallback เผื่อเป็น null หรือไม่ใช่ตัวเลข
      });
    }else if(owner=='Soul'){
      owner_color = '[2;31mSoul[0m'
      items3.push({
        bossName,
        owner: owner_color || 'ไม่ระบุ',
        bossTime,
        formattedTime,
        sortValue: parseFloat(sortValue) || 9999 // fallback เผื่อเป็น null หรือไม่ใช่ตัวเลข
      });
    }

    // items.push({
    //   bossName,
    //   owner: owner_color || 'ไม่ระบุ',
    //   bossTime,
    //   formattedTime,
    //   sortValue: parseFloat(sortValue) || 9999 // fallback เผื่อเป็น null หรือไม่ใช่ตัวเลข
    // });
  }
      // ✅ Sort ตาม sortValue (ค่าน้อย = ใกล้ปัจจุบันที่สุด)
      items1.sort((a, b) => a.sortValue - b.sortValue);
      items2.sort((a, b) => a.sortValue - b.sortValue);
      items3.sort((a, b) => a.sortValue - b.sortValue);

        // สร้างข้อความที่จะแสดง
      const resultLines1 = items1.map(item =>
        `🕐 ${item.formattedTime} - **${item.bossName}** (ของ ${item.owner})`
      );
      const resultLines2 = items2.map(item =>
        `🕐 ${item.formattedTime} - **${item.bossName}** (ของ ${item.owner})`
      );
      const resultLines3 = items3.map(item =>
        `🕐 ${item.formattedTime} - **${item.bossName}** (ของ ${item.owner})`
      );

  // รวม array 'results' ให้เป็น string เดียว โดยคั่นด้วย '\n'

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

function onEdit(e){
  const sheet = e.source.getActiveSheet();
  const editedCell = e.range;
  const row = editedCell.getRow();
  const col = editedCell.getColumn();

  // ตรวจสอบว่าอยู่ในชีตหลัก และเป็นการแก้คอลัมน์ D (เลข 4)
  if (sheet.getName() === "BossTime" && col === 4 && row > 1) {
    const timestampCol = 10; // คอลัมน์ J
    const notifyCol = 9; // คอลัมน์ I

    // บันทึกวันเวลาในคอลัมน์ J
    sheet.getRange(row, timestampCol).setValue(new Date());

    // รีเซ็ตค่าแจ้งเตือนให้เป็น FALSE
    sheet.getRange(row, notifyCol).setValue(false);
  }
}


