/**
 * ======================================================================
 * 🐬 Chadwick Dolphin App - Tech Office Data Sync
 * ======================================================================
 */

// ===== CONFIG =====
const CONFIG = {
  FIREBASE_PROJECT_ID: 'lost-and-found-20c10',
  FIREBASE_API_KEY: 'AIzaSyDVg9Bxu9WWM4xe-yNVHCNxL-RaxGOJWog',  // .env의 EXPO_PUBLIC_FIREBASE_API_KEY
  GEMINI_API_KEY: 'AIzaSyBf6saz9iMYGODmf8SsyrZYDjmnKgn53U0',    // .env의 EXPO_PUBLIC_GEMINI_API_KEY (요약 통합에 사용)
  KNOWLEDGE_SHEET: 'Knowledge',
  ANNOUNCEMENT_SHEET: 'Announcements',
  CHATLOG_SHEET: 'Chat Logs',
  KNOWLEDGE_COLLECTION: 'tech_knowledge',
  ANNOUNCEMENT_COLLECTION: 'tech_announcements',
  CHATLOG_COLLECTION: 'tech_chat_logs',
  GROUP_WINDOW_MINUTES: 30, // 같은 사람이 이 분 이내에 한 대화는 하나로 묶음
};
// ==================

function syncAll() {
  syncKnowledge();
  syncAnnouncements();
  safeAlert('동기화 완료!');
}

// ──────────────────────────────────────
// 1. KNOWLEDGE BASE SYNC
// ──────────────────────────────────────
function syncKnowledge() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.KNOWLEDGE_SHEET);
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return;
  const headers = data[0].map(h => String(h).trim().toLowerCase());
  const rows = data.slice(1).filter(row => row[headers.indexOf('title')]);
  deleteCollection(CONFIG.KNOWLEDGE_COLLECTION);
  rows.forEach((row, index) => {
    const doc = {};
    headers.forEach((header, colIdx) => {
      const value = row[colIdx];
      if (header === 'order') doc[header] = Number(value) || index + 1;
      else if (header === 'imageurl') doc['imageUrl'] = convertDriveLink(String(value || ''));
      else doc[header] = String(value || '');
    });
    if (!doc['order']) doc['order'] = index + 1;
    createDocument(CONFIG.KNOWLEDGE_COLLECTION, doc, false);
  });
}

// ──────────────────────────────────────
// 2. ANNOUNCEMENTS SYNC
// ──────────────────────────────────────
function syncAnnouncements() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.ANNOUNCEMENT_SHEET);
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return;
  const headers = data[0].map(h => String(h).trim().toLowerCase());
  const rows = data.slice(1).filter(row => row[headers.indexOf('title')]);
  deleteCollection(CONFIG.ANNOUNCEMENT_COLLECTION);
  const now = new Date().getTime();
  rows.forEach((row, index) => {
    const doc = {};
    headers.forEach((header, colIdx) => { doc[header] = String(row[colIdx] || ''); });
    doc['createdAt'] = { timestampValue: new Date(now - (index * 1000)).toISOString() };
    createDocument(CONFIG.ANNOUNCEMENT_COLLECTION, doc, true);
  });
}

// ──────────────────────────────────────
// 3. CHAT LOGS PULL (Firestore -> Sheet, 그룹핑)
// ──────────────────────────────────────
function pullChatLogs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.CHATLOG_SHEET);
  if (!sheet) sheet = ss.insertSheet(CONFIG.CHATLOG_SHEET);

  // 매번 완전히 다시 씀 (항상 최신 상태)
  sheet.clearContents();
  sheet.clearFormats();
  sheet.appendRow(['Date', 'Student Name', 'Email', 'Topic(s)', 'AI Summary', 'Total Messages', 'All Questions']);
  sheet.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#E0E7FF');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(3, 180);
  sheet.setColumnWidth(5, 450);
  sheet.setColumnWidth(7, 350);

  const docs = listDocuments(CONFIG.CHATLOG_COLLECTION);
  if (!docs || docs.length === 0) {
    safeAlert('아직 대화 로그가 없습니다.');
    return;
  }

  // 1. Firestore 문서를 파싱
  const logs = docs.map(doc => {
    const f = doc.fields || {};
    const tsRaw = f.createdAt && f.createdAt.timestampValue;
    return {
      email: (f.userEmail && f.userEmail.stringValue) || 'unknown',
      name: (f.userName && f.userName.stringValue) || 'Unknown',
      topic: (f.topic && f.topic.stringValue) || 'general',
      summary: (f.summary && f.summary.stringValue) || '',
      messageCount: parseInt((f.messageCount && f.messageCount.integerValue) || '0'),
      questions: ((f.userQuestions && f.userQuestions.arrayValue && f.userQuestions.arrayValue.values) || [])
        .map(function(v) { return v.stringValue || ''; }).filter(Boolean),
      ts: tsRaw ? new Date(tsRaw).getTime() : 0,
    };
  }).filter(function(l) { return l.ts > 0; }).sort(function(a, b) { return a.ts - b.ts; }); // 오래된 순

  // 2. 같은 email + GROUP_WINDOW_MINUTES 이내 -> 하나의 세션으로 묶기
  const WINDOW = CONFIG.GROUP_WINDOW_MINUTES * 60 * 1000;
  const groups = [];

  logs.forEach(function(log) {
    const last = groups.length > 0 ? groups[groups.length - 1] : null;
    if (last && last.email === log.email && (log.ts - last.latestTs) <= WINDOW) {
      last.latestTs = log.ts;
      last.topics[log.topic] = true;
      last.totalMessages += log.messageCount;
      log.questions.forEach(function(q) { last.allQuestions.push(q); });
      last.allSummaries.push(log.summary);
    } else {
      const topicsObj = {};
      topicsObj[log.topic] = true;
      groups.push({
        email: log.email,
        name: log.name,
        startTs: log.ts,
        latestTs: log.ts,
        topics: topicsObj,
        totalMessages: log.messageCount,
        allQuestions: log.questions.slice(),
        allSummaries: [log.summary],
      });
    }
  });

  // 3. 최신순 정렬 후 한 행씩 작성
  groups.reverse().forEach(function(g, i) {
    const dateStr = new Date(g.startTs).toLocaleString();
    const topicsStr = Object.keys(g.topics).join(', ');
    const questionsStr = g.allQuestions.join(' | ');

    // 여러 세션이 묶인 경우 Gemini로 통합 요약, 아니면 그대로
    let mergedSummary = g.allSummaries.join(' / ');
    if (CONFIG.GEMINI_API_KEY && g.allSummaries.length > 1) {
      mergedSummary = callGeminiSummarize(g.allSummaries, g.allQuestions);
    }

    sheet.appendRow([dateStr, g.name, g.email, topicsStr, mergedSummary, g.totalMessages, questionsStr]);
    // 교대 색상
    sheet.getRange(i + 2, 1, 1, 7).setBackground(i % 2 === 0 ? '#FFFFFF' : '#F8F9FF');
  });

  safeAlert(groups.length + '개 세션으로 정리 완료!\n(같은 사람이 30분 이내에 한 대화는 하나로 묶었습니다)');
}

// ──────────────────────────────────────
// GEMINI 통합 요약 호출
// ──────────────────────────────────────
function callGeminiSummarize(summaries, questions) {
  try {
    const prompt = 'Summarize the following tech support session in 1-2 sentences. '
      + 'Focus on what the student needed and whether it was resolved.\n\n'
      + 'Individual summaries:\n- ' + summaries.join('\n- ')
      + '\n\nQuestions asked:\n- ' + questions.join('\n- ');

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + CONFIG.GEMINI_API_KEY;
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 120, temperature: 0.3 },
      }),
      muteHttpExceptions: true,
    });
    const json = JSON.parse(res.getContentText());
    const text = json.candidates && json.candidates[0] && json.candidates[0].content
      && json.candidates[0].content.parts && json.candidates[0].content.parts[0]
      && json.candidates[0].content.parts[0].text;
    return text || summaries.join(' / ');
  } catch (e) {
    return summaries.join(' / ');
  }
}

// ──────────────────────────────────────
// HELPER FUNCTIONS
// ──────────────────────────────────────

function convertDriveLink(url) {
  if (!url) return '';
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return 'https://drive.google.com/uc?export=view&id=' + match[1];
  return url;
}

function createDocument(collectionName, data, isRaw) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + CONFIG.FIREBASE_PROJECT_ID +
    '/databases/(default)/documents/' + collectionName + '?key=' + CONFIG.FIREBASE_API_KEY;
  const fields = {};
  if (isRaw) {
    Object.keys(data).forEach(function(key) {
      if (key === 'createdAt') fields[key] = data[key];
      else fields[key] = { stringValue: String(data[key]) };
    });
  } else {
    Object.keys(data).forEach(function(key) {
      const value = data[key];
      if (typeof value === 'number') fields[key] = { integerValue: value };
      else fields[key] = { stringValue: String(value) };
    });
  }
  try {
    UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ fields }), muteHttpExceptions: true,
    });
  } catch (e) {}
}

function deleteCollection(collectionName) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + CONFIG.FIREBASE_PROJECT_ID +
    '/databases/(default)/documents/' + collectionName + '?key=' + CONFIG.FIREBASE_API_KEY + '&pageSize=100';
  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const result = JSON.parse(response.getContentText());
    if (result.documents) {
      result.documents.forEach(function(doc) {
        UrlFetchApp.fetch('https://firestore.googleapis.com/v1/' + doc.name + '?key=' + CONFIG.FIREBASE_API_KEY,
          { method: 'delete', muteHttpExceptions: true });
      });
    }
  } catch (e) {}
}

function listDocuments(collectionName) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + CONFIG.FIREBASE_PROJECT_ID +
    '/databases/(default)/documents/' + collectionName + '?key=' + CONFIG.FIREBASE_API_KEY +
    '&pageSize=500';
  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const result = JSON.parse(response.getContentText());
    return result.documents || [];
  } catch (e) {
    return [];
  }
}

// Trigger에서 실행하면 getUi()를 못 쓰므로, 에러 나면 Logger로 대체
function safeAlert(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    Logger.log(message);
  }
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🐬 Dolphin App')
    .addItem('🔄 Sync All to App', 'syncAll')
    .addItem('📋 Pull Chat Logs', 'pullChatLogs')
    .addToUi();
}
