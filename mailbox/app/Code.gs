/**
 * INTERNAL MAILBOX - Google Apps Script Backend
 * Backend: Google Sheets + Google Drive
 * Mail model: internal only; no Gmail delivery.
 *
 * Optimized version:
 * - Mailbox_Index is the fast mailbox/listing index.
 * - Normal mailbox requests do not read Emails.Body.
 * - 25/50 pagination.
 * - User-specific Mailbox_Index lookup.
 * - Configuration and user caching.
 * - Lightweight API actions.
 */

const CONFIG_SPREADSHEET_ID = '1nEVX-k4gQfXfl-pzEU4CNRshJtgjCiCtD-xiKCHqs2s';
const SESSION_PREFIX = 'IMBX_SESSION_';
const SESSION_SECONDS = 21600;
const CONFIG_CACHE_KEY = 'IMBX_CONFIG_V4';
const USERS_CACHE_KEY = 'IMBX_USERS_V3';
const USER_INDEX_CACHE_PREFIX = 'IMBX_INDEX_V3_';
const USER_INDEX_CACHE_SECONDS = 60;
const USERS_CACHE_SECONDS = 60;
const CONFIG_CACHE_SECONDS = 21600;

const REQUIRED_HEADERS = {
  Users: [
    'User_ID','Email_Address','Password_Hash','Full_Name','Designation','Department',
    'Mobile','Role','Status','Profile_Image_URL','Created_Date','Last_Login',
    'Failed_Login_Count','Last_Failed_Login','Session_Revoked'
  ],
  Emails: [
    'Mail_ID','Reference_No','Thread_ID','Message_ID','Parent_Message_ID','Sender_Email',
    'Sender_Name','To_Email','Cc_Email','Bcc_Email','Subject','Body','Body_Type',
    'Sent_DateTime','Received_DateTime','Folder','Status','Is_Read','Is_Starred',
    'Is_Archived','Is_Spam','Is_Deleted','Label','Has_Attachment','Attachment_Count',
    'Reply_To','Forwarded_From','Created_By','Last_Updated','Last_Updated_By'
  ],
  Mailbox_Index: [
    'Mailbox_Record_ID','Mail_ID','Reference_No','User_ID','User_Email','Folder',
    'Is_Read','Is_Starred','Is_Archived','Is_Spam','Is_Deleted','Received_DateTime',
    'Last_Updated','Subject','Sender_Name','Sender_Email','To_Email','Label',
    'Has_Attachment','Attachment_Count','Preview','Message_DateTime'
  ],
  Attachments: [
    'Attachment_ID','Reference_No','Message_ID','Thread_ID','User_ID',
    'Original_File_Name','Drive_File_Name','Drive_File_ID','Drive_URL','Mime_Type',
    'File_Size','Drive_Folder_ID','Uploaded_By','Uploaded_DateTime','Status','Deleted_DateTime'
  ]
};

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'health';
  try {
    if (action === 'health') return json_({ ok:true, service:'internal-mailbox', time:now_() });
    return json_({ ok:false, error:'Use POST for mailbox operations.' });
  } catch (err) {
    return json_({ ok:false, error:String(err) });
  }
}

function doPost(e) {
  try {
    const body = parseRequest_(e);
    const action = String(body.action || '').trim();

    switch (action) {
      case 'login': return json_(login_(body));
      case 'logout': return json_(logout_(body));
      case 'bootstrap': return json_(bootstrap_(body));
      case 'mailbox': return json_(listMessages_(body));
      case 'listMessages': return json_(listMessages_(body)); // backward compatibility
      case 'getMessage': return json_(getMessage_(body));
      case 'sendMessage': return json_(sendMessage_(body));
      case 'saveDraft': return json_(saveDraft_(body));
      case 'updateMessage': return json_(updateMessage_(body));
      case 'search': return json_(searchMessages_(body));
      case 'suggestRecipients': return json_(suggestRecipients_(body));
      case 'setupCheck': return json_(setupCheck_());
      case 'clearCache': return json_(clearMailboxCaches_());
      case 'rebuildMailboxIndex': return json_(rebuildMailboxIndexMetadata_());
      default:
        return json_({ ok:false, error:'Unknown action: ' + action });
    }
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return json_({ ok:false, error:String(err && err.message ? err.message : err) });
  }
}

function parseRequest_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  try { return JSON.parse(e.postData.contents); }
  catch (_) { return {}; }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function setupCheck_() {
  const cfg = readConfig_();
  const result = {
    ok:true,
    configSpreadsheetId:CONFIG_SPREADSHEET_ID,
    usersSpreadsheetId:extractId_(cfg.USERS_SHEET_ID || cfg.USERS_SHEET_URL || ''),
    mailDatabaseSpreadsheetId:extractId_(cfg.MAIL_DATABASE_SHEET_ID || cfg.MAIL_DATABASE_URL || ''),
    driveRegisterSpreadsheetId:extractId_(cfg.DRIVE_REGISTER_SHEET_ID || cfg.DRIVE_REGISTER_URL || ''),
    driveFolderId:extractId_(cfg.MAIL_DRIVE_FOLDER_ID || cfg.MAIL_DRIVE_FOLDER_URL || ''),
    missing:[]
  };
  Object.keys(result).forEach(k => {
    if (k !== 'missing' && result[k] === '') result.missing.push(k);
  });
  return result;
}

function bootstrap_(body) {
  const session = requireSession_(body.token);
  const cfg = readConfig_();
  const user = getUserById_(session.userId);
  if (!user) throw new Error('User account not found.');

  return {
    ok:true,
    user:safeUser_(user),
    config:{
      appName:cfg.APP_NAME || 'Internal Mailbox',
      appVersion:cfg.APP_VERSION || '1.0.0',
      pageSize:[25,50].includes(Number(cfg.DEFAULT_PAGE_SIZE)) ? Number(cfg.DEFAULT_PAGE_SIZE) : 25,
      timezone:cfg.TIMEZONE || Session.getScriptTimeZone() || 'Asia/Kolkata',
      maxAttachmentSizeMB:Number(cfg.MAX_ATTACHMENT_SIZE_MB || 25),
      maxAttachments:Number(cfg.MAX_ATTACHMENTS || 10),
      allowCc:String(cfg.ALLOW_CC || 'YES').toUpperCase() === 'YES',
      allowBcc:String(cfg.ALLOW_BCC || 'YES').toUpperCase() === 'YES'
    }
  };
}

function login_(body) {
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) throw new Error('Email address and password are required.');

  const user = getUserByEmail_(email);
  if (!user) throw new Error('Invalid login credentials.');
  if (String(user.Status || '').toUpperCase() !== 'ACTIVE') throw new Error('User account is not active.');
  if (String(user.Session_Revoked || '').toUpperCase() === 'YES') throw new Error('User session has been revoked.');

  const expected = String(user.Password_Hash || '').trim();
  const actual = sha256_(password);
  if (!expected || expected.toLowerCase() !== actual.toLowerCase()) {
    incrementFailedLogin_(user);
    throw new Error('Invalid login credentials.');
  }

  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g,'');
  CacheService.getScriptCache().put(
    SESSION_PREFIX + token,
    JSON.stringify({ email:email, userId:String(user.User_ID), created:Date.now() }),
    SESSION_SECONDS
  );

  updateUserLogin_(user);
  return { ok:true, token:token, user:safeUser_(user) };
}

function logout_(body) {
  if (body && body.token) CacheService.getScriptCache().remove(SESSION_PREFIX + body.token);
  return { ok:true };
}

function requireSession_(token) {
  token = String(token || '');
  if (!token) throw new Error('Session expired. Please login again.');

  const cache = CacheService.getScriptCache();
  const raw = cache.get(SESSION_PREFIX + token);
  if (!raw) throw new Error('Session expired. Please login again.');

  const session = JSON.parse(raw);
  const user = getUserById_(session.userId);

  if (!user || String(user.Status || '').toUpperCase() !== 'ACTIVE') {
    cache.remove(SESSION_PREFIX + token);
    throw new Error('User account is inactive.');
  }

  if (String(user.Session_Revoked || '').toUpperCase() === 'YES') {
    cache.remove(SESSION_PREFIX + token);
    throw new Error('Session revoked. Please login again.');
  }

  cache.put(SESSION_PREFIX + token, raw, SESSION_SECONDS);
  return session;
}

/* =========================================================
   FAST MAILBOX LISTING
========================================================= */

function listMessages_(body) {
  const session = requireSession_(body.token);
  const folder = String(body.folder || 'INBOX').toUpperCase();
  const search = String(body.search || '').trim().toLowerCase();
  const page = Math.max(Number(body.page || 1), 1);
  const pageSize = normalizePageSize_(body.pageSize || body.limit || 25);

  /* Normal mailbox listing uses only Mailbox_Index. */
  let rows = getMailboxIndexForUser_(session.userId);

  rows = rows.filter(r => {
    const rowFolder = String(r.Folder || '').toUpperCase();

    if (folder === 'STARRED') {
      if (String(r.Is_Starred || '').toUpperCase() !== 'YES') return false;
    } else if (rowFolder !== folder) {
      return false;
    }

    if (String(r.Is_Deleted || '').toUpperCase() === 'YES' && folder !== 'TRASH') {
      return false;
    }

    return true;
  });

  if (search) {
    rows = rows.filter(r => indexSearchText_(r).includes(search));
  }

  sortIndexRows_(rows);
  return paginateIndexRows_(rows, folder, page, pageSize);
}

function normalizePageSize_(value) {
  return Number(value) === 50 ? 50 : 25;
}

function indexSearchText_(r) {
  return [
    r.Subject,
    r.Sender_Name,
    r.Sender_Email,
    r.To_Email,
    r.Reference_No,
    r.Label,
    r.Preview
  ].join(' ').toLowerCase();
}

function sortIndexRows_(rows) {
  rows.sort((a,b) => {
    const da = String(a.Message_DateTime || a.Received_DateTime || '');
    const db = String(b.Message_DateTime || b.Received_DateTime || '');
    return db.localeCompare(da);
  });
}

function paginateIndexRows_(rows, folder, page, pageSize) {
  const total = rows.length;
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  return {
    ok:true,
    folder:folder,
    page:safePage,
    pageSize:pageSize,
    total:total,
    totalPages:totalPages,
    hasPrevious:safePage > 1,
    hasNext:safePage < totalPages,
    messages:pageRows.map(mailboxIndexView_)
  };
}

function mailboxIndexView_(r) {
  return {
    mailId:String(r.Mail_ID || ''),
    referenceNo:String(r.Reference_No || ''),
    senderEmail:String(r.Sender_Email || ''),
    senderName:String(r.Sender_Name || ''),
    to:String(r.To_Email || ''),
    subject:String(r.Subject || ''),
    body:String(r.Preview || ''),
    bodyType:'TEXT',
    date:String(r.Message_DateTime || r.Received_DateTime || ''),
    folder:String(r.Folder || ''),
    isRead:String(r.Is_Read || '').toUpperCase() === 'YES',
    isStarred:String(r.Is_Starred || '').toUpperCase() === 'YES',
    hasAttachment:String(r.Has_Attachment || '').toUpperCase() === 'YES',
    attachmentCount:Number(r.Attachment_Count || 0),
    label:String(r.Label || '')
  };
}

/* =========================================================
   FULL-TEXT SEARCH - deliberately separate/heavier action
========================================================= */

function searchMessages_(body) {
  const session = requireSession_(body.token);
  const folder = String(body.folder || 'INBOX').toUpperCase();
  const search = String(body.search || '').trim().toLowerCase();
  const page = Math.max(Number(body.page || 1), 1);
  const pageSize = normalizePageSize_(body.pageSize || 25);

  if (!search) return listMessages_(body);

  const rows = getMailboxIndexForUser_(session.userId);
  const emails = getSheetObjects_('Emails');
  const emailMap = {};
  emails.forEach(m => emailMap[String(m.Mail_ID)] = m);

  const matches = [];

  rows.forEach(r => {
    const rowFolder = String(r.Folder || '').toUpperCase();
    if (folder === 'STARRED') {
      if (String(r.Is_Starred || '').toUpperCase() !== 'YES') return;
    } else if (rowFolder !== folder) {
      return;
    }
    if (String(r.Is_Deleted || '').toUpperCase() === 'YES' && folder !== 'TRASH') return;

    const m = emailMap[String(r.Mail_ID)];
    if (!m) return;

    const hay = [
      m.Subject,m.Sender_Name,m.Sender_Email,m.To_Email,m.Cc_Email,
      m.Bcc_Email,m.Body,m.Reference_No,m.Label
    ].join(' ').toLowerCase();

    if (hay.includes(search)) matches.push(r);
  });

  sortIndexRows_(matches);
  return paginateIndexRows_(matches, folder, page, pageSize);
}

/* =========================================================
   GET ONE MESSAGE - only this action loads the complete body
========================================================= */

function getMessage_(body) {
  const session = requireSession_(body.token);
  const mailId = String(body.mailId || '').trim();
  if (!mailId) throw new Error('Mail ID is required.');

  const indexRows = getMailboxIndexForUser_(session.userId);
  const r = indexRows.find(x => String(x.Mail_ID) === mailId);
  if (!r) throw new Error('You do not have access to this message.');

  const m = getObjectByKey_('Emails', 'Mail_ID', mailId);
  if (!m) throw new Error('Message not found.');

  if (String(r.Is_Read || '').toUpperCase() !== 'YES') {
    updateMailboxIndex_(r.Mailbox_Record_ID, {
      Is_Read:'YES',
      Last_Updated:now_()
    });
    invalidateMailboxCache_(session.userId);
    r.Is_Read = 'YES';
  }

  const attachments = getRowsByKey_(
    'Attachments',
    'Message_ID',
    String(m.Message_ID || '')
  ).filter(a => String(a.Status || '').toUpperCase() === 'ACTIVE');

  return {
    ok:true,
    message:messageView_(m, r),
    attachments:attachments.map(a => ({
      attachmentId:a.Attachment_ID,
      fileName:a.Original_File_Name,
      fileId:a.Drive_File_ID,
      url:a.Drive_URL,
      mimeType:a.Mime_Type,
      size:a.File_Size
    }))
  };
}

function messageView_(m, r) {
  return {
    mailId:String(m.Mail_ID || ''),
    referenceNo:String(m.Reference_No || ''),
    threadId:String(m.Thread_ID || ''),
    messageId:String(m.Message_ID || ''),
    senderEmail:String(m.Sender_Email || ''),
    senderName:String(m.Sender_Name || ''),
    to:String(m.To_Email || ''),
    cc:String(m.Cc_Email || ''),
    bcc:String(m.Bcc_Email || ''),
    subject:String(m.Subject || ''),
    body:String(m.Body || ''),
    bodyType:String(m.Body_Type || 'TEXT'),
    date:String(m.Sent_DateTime || m.Received_DateTime || ''),
    folder:String(r.Folder || ''),
    status:String(m.Status || ''),
    isRead:String(r.Is_Read || '').toUpperCase() === 'YES',
    isStarred:String(r.Is_Starred || '').toUpperCase() === 'YES',
    hasAttachment:String(m.Has_Attachment || '').toUpperCase() === 'YES',
    attachmentCount:Number(m.Attachment_Count || 0),
    label:String(m.Label || '')
  };
}

/* =========================================================
   SEND
========================================================= */

function sendMessage_(body) {
  const session = requireSession_(body.token);
  const to = normalizeEmails_(body.to);
  const cc = normalizeEmails_(body.cc);
  const bcc = normalizeEmails_(body.bcc);
  const subject = String(body.subject || '').trim();
  const messageBody = String(body.body || '');

  if (!to.length) throw new Error('At least one recipient is required.');
  if (!subject) throw new Error('Subject is required.');

  const allRecipients = unique_(to.concat(cc, bcc));
  const users = allRecipients.map(getUserByEmail_).filter(Boolean);
  if (users.length !== allRecipients.length) {
    const known = users.map(u => String(u.Email_Address).toLowerCase());
    const missing = allRecipients.filter(x => !known.includes(x));
    throw new Error('Recipient is not an internal mailbox user: ' + missing.join(', '));
  }

  const cfg = readConfig_();
  const maxAttachments = Number(cfg.MAX_ATTACHMENTS || 10);
  const maxBytes = Number(cfg.MAX_ATTACHMENT_SIZE_MB || 25) * 1024 * 1024;
  const files = Array.isArray(body.attachments) ? body.attachments : [];
  if (files.length > maxAttachments) throw new Error('Too many attachments.');
  files.forEach(f => {
    if (Number(f.size || 0) > maxBytes) throw new Error('Attachment exceeds configured size limit: ' + f.name);
  });

  const mailId = nextId_('MAIL');
  const messageId = nextId_('MSG');
  const reference = nextReference_();
  const threadId = body.threadId ? String(body.threadId) : nextId_('THR');
  const now = now_();
  const sender = getUserById_(session.userId);
  if (!sender) throw new Error('Sender account not found.');
  const bodyType = String(body.bodyType || 'TEXT').toUpperCase();
  const preview = createPreview_(messageBody);

  appendObject_('Emails', {
    Mail_ID:mailId,
    Reference_No:reference,
    Thread_ID:threadId,
    Message_ID:messageId,
    Parent_Message_ID:String(body.parentMessageId || ''),
    Sender_Email:String(sender.Email_Address),
    Sender_Name:String(sender.Full_Name),
    To_Email:to.join(', '),
    Cc_Email:cc.join(', '),
    Bcc_Email:bcc.join(', '),
    Subject:subject,
    Body:messageBody,
    Body_Type:bodyType,
    Sent_DateTime:now,
    Received_DateTime:now,
    Folder:'SENT',
    Status:'SENT',
    Is_Read:'YES',
    Is_Starred:'NO',
    Is_Archived:'NO',
    Is_Spam:'NO',
    Is_Deleted:'NO',
    Label:String(body.label || ''),
    Has_Attachment:files.length ? 'YES' : 'NO',
    Attachment_Count:files.length,
    Reply_To:String(body.replyTo || ''),
    Forwarded_From:String(body.forwardedFrom || ''),
    Created_By:String(sender.User_ID),
    Last_Updated:now,
    Last_Updated_By:String(sender.User_ID)
  });

  const indexBase = {
    Mail_ID:mailId,
    Reference_No:reference,
    Subject:subject,
    Sender_Name:String(sender.Full_Name),
    Sender_Email:String(sender.Email_Address),
    To_Email:to.join(', '),
    Label:String(body.label || ''),
    Has_Attachment:files.length ? 'YES' : 'NO',
    Attachment_Count:files.length,
    Preview:preview,
    Message_DateTime:now,
    Received_DateTime:now,
    Last_Updated:now
  };

  appendObject_('Mailbox_Index', Object.assign({}, indexBase, {
    Mailbox_Record_ID:nextId_('MBX'),
    User_ID:String(sender.User_ID),
    User_Email:String(sender.Email_Address),
    Folder:'SENT',
    Is_Read:'YES', Is_Starred:'NO', Is_Archived:'NO', Is_Spam:'NO', Is_Deleted:'NO'
  }));

  const affectedUsers = [String(sender.User_ID)];

  users.forEach(recipient => {
    if (String(recipient.User_ID) === String(sender.User_ID)) return;

    appendObject_('Mailbox_Index', Object.assign({}, indexBase, {
      Mailbox_Record_ID:nextId_('MBX'),
      User_ID:String(recipient.User_ID),
      User_Email:String(recipient.Email_Address),
      Folder:'INBOX',
      Is_Read:'NO', Is_Starred:'NO', Is_Archived:'NO', Is_Spam:'NO', Is_Deleted:'NO'
    }));

    affectedUsers.push(String(recipient.User_ID));
  });

  invalidateMailboxCache_(affectedUsers);

  if (files.length) saveAttachments_(files, {
    reference:reference,
    messageId:messageId,
    threadId:threadId,
    userId:String(sender.User_ID),
    uploadedBy:String(sender.User_ID),
    now:now
  });

  return { ok:true, mailId:mailId, referenceNo:reference, threadId:threadId, messageId:messageId };
}

/* =========================================================
   DRAFTS
========================================================= */

function saveDraft_(body) {
  const session = requireSession_(body.token);
  const sender = getUserById_(session.userId);
  if (!sender) throw new Error('User account not found.');

  const now = now_();
  const mailId = String(body.mailId || nextId_('MAIL'));
  const existing = getObjectByKey_('Emails', 'Mail_ID', mailId);

  if (existing && String(existing.Sender_Email || '').toLowerCase() !== String(sender.Email_Address || '').toLowerCase()) {
    throw new Error('You do not have access to this draft.');
  }

  const reference = existing ? String(existing.Reference_No || '') : nextReference_();
  const threadId = String(body.threadId || (existing ? existing.Thread_ID : nextId_('THR')));
  const messageId = existing ? String(existing.Message_ID || '') : nextId_('MSG');
  const subject = String(body.subject || '');
  const messageBody = String(body.body || '');

  const values = {
    Mail_ID:mailId, Reference_No:reference, Thread_ID:threadId, Message_ID:messageId,
    Parent_Message_ID:String(body.parentMessageId || ''),
    Sender_Email:String(sender.Email_Address), Sender_Name:String(sender.Full_Name),
    To_Email:String(body.to || ''), Cc_Email:String(body.cc || ''), Bcc_Email:String(body.bcc || ''),
    Subject:subject, Body:messageBody, Body_Type:String(body.bodyType || 'TEXT'),
    Sent_DateTime:'', Received_DateTime:'', Folder:'DRAFT', Status:'DRAFT',
    Is_Read:'YES', Is_Starred:'NO', Is_Archived:'NO', Is_Spam:'NO', Is_Deleted:'NO',
    Label:String(body.label || ''), Has_Attachment:'NO', Attachment_Count:0,
    Reply_To:String(body.replyTo || ''), Forwarded_From:String(body.forwardedFrom || ''),
    Created_By:String(sender.User_ID), Last_Updated:now, Last_Updated_By:String(sender.User_ID)
  };

  if (existing) updateEmail_(mailId, values);
  else appendObject_('Emails', values);

  const idxRows = getMailboxIndexForUser_(sender.User_ID);
  const idx = idxRows.find(x => String(x.Mail_ID) === mailId);
  const indexValues = {
    Folder:'DRAFT', Last_Updated:now,
    Subject:subject,
    Sender_Name:String(sender.Full_Name),
    Sender_Email:String(sender.Email_Address),
    To_Email:String(body.to || ''),
    Label:String(body.label || ''),
    Preview:createPreview_(messageBody),
    Message_DateTime:now,
    Has_Attachment:'NO',
    Attachment_Count:0
  };

  if (idx) {
    updateMailboxIndex_(idx.Mailbox_Record_ID, indexValues);
  } else {
    appendObject_('Mailbox_Index', Object.assign({}, indexValues, {
      Mailbox_Record_ID:nextId_('MBX'),
      Mail_ID:mailId,
      Reference_No:reference,
      User_ID:String(sender.User_ID),
      User_Email:String(sender.Email_Address),
      Is_Read:'YES', Is_Starred:'NO', Is_Archived:'NO', Is_Spam:'NO', Is_Deleted:'NO',
      Received_DateTime:now
    }));
  }

  invalidateMailboxCache_(sender.User_ID);
  return { ok:true, mailId:mailId, referenceNo:reference, threadId:threadId, messageId:messageId };
}

/* =========================================================
   LIGHTWEIGHT MESSAGE UPDATE
========================================================= */

function updateMessage_(body) {
  const session = requireSession_(body.token);
  const mailId = String(body.mailId || '');
  if (!mailId) throw new Error('Mail ID is required.');

  const rows = getMailboxIndexForUser_(session.userId);
  const idx = rows.find(x => String(x.Mail_ID) === mailId);
  if (!idx) throw new Error('Message not found.');

  const allowed = ['Folder','Is_Read','Is_Starred','Is_Archived','Is_Spam','Is_Deleted'];
  const changes = {};
  allowed.forEach(k => { if (body[k] !== undefined) changes[k] = body[k]; });
  changes.Last_Updated = now_();

  updateMailboxIndex_(idx.Mailbox_Record_ID, changes);
  invalidateMailboxCache_(session.userId);
  return { ok:true };
}

/* =========================================================
   RECIPIENT SUGGESTIONS
========================================================= */

function suggestRecipients_(body) {
  const session = requireSession_(body.token);
  const query = String(body.query || '').trim().toLowerCase();
  if (!query) return { ok:true, items:[] };

  const users = getUsersCached_();
  const items = users
    .filter(u => String(u.User_ID || '') !== String(session.userId))
    .filter(u => String(u.Status || '').toUpperCase() === 'ACTIVE')
    .filter(u => {
      const hay = [u.Email_Address,u.Full_Name,u.Designation,u.Department]
        .join(' ').toLowerCase();
      return hay.includes(query);
    })
    .slice(0, 10)
    .map(u => ({
      userId:String(u.User_ID),
      email:String(u.Email_Address),
      name:String(u.Full_Name),
      designation:String(u.Designation || ''),
      department:String(u.Department || '')
    }));

  return { ok:true, items:items };
}

/* =========================================================
   ATTACHMENTS
========================================================= */

function saveAttachments_(files, meta) {
  const cfg = readConfig_();
  const folderId = extractId_(cfg.MAIL_DRIVE_FOLDER_ID || cfg.MAIL_DRIVE_FOLDER_URL || '');
  if (!folderId) throw new Error('MAIL_DRIVE_FOLDER_ID is not configured.');

  const root = DriveApp.getFolderById(folderId);
  const tz = cfg.TIMEZONE || Session.getScriptTimeZone() || 'Asia/Kolkata';
  const year = Utilities.formatDate(new Date(), tz, 'yyyy');
  const month = Utilities.formatDate(new Date(), tz, 'MM');
  const yearFolder = getOrCreateFolder_(root, year);
  const monthFolder = getOrCreateFolder_(yearFolder, month);
  const mailFolder = getOrCreateFolder_(monthFolder, meta.reference);

  files.forEach((f, i) => {
    const bytes = Utilities.base64Decode(String(f.base64 || ''));
    const blob = Utilities.newBlob(
      bytes,
      String(f.mimeType || 'application/octet-stream'),
      String(f.name || ('attachment-' + (i + 1)))
    );
    const file = mailFolder.createFile(blob);
    appendObject_('Attachments', {
      Attachment_ID:nextId_('ATT'),
      Reference_No:meta.reference,
      Message_ID:meta.messageId,
      Thread_ID:meta.threadId,
      User_ID:meta.userId,
      Original_File_Name:String(f.name || ''),
      Drive_File_Name:file.getName(),
      Drive_File_ID:file.getId(),
      Drive_URL:file.getUrl(),
      Mime_Type:String(f.mimeType || ''),
      File_Size:bytes.length,
      Drive_Folder_ID:mailFolder.getId(),
      Uploaded_By:meta.uploadedBy,
      Uploaded_DateTime:meta.now,
      Status:'ACTIVE',
      Deleted_DateTime:''
    });
  });
}

/* =========================================================
   CONFIG / USERS CACHE
========================================================= */

function readConfig_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CONFIG_CACHE_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch (_) {}
  }

  const ss = SpreadsheetApp.openById(CONFIG_SPREADSHEET_ID);
  const sh = ss.getSheetByName('Configuration');
  if (!sh) throw new Error('Configuration tab not found.');

  const lastRow = sh.getLastRow();
  const out = {};
  if (lastRow >= 2) {
    const values = sh.getRange(1, 1, lastRow, 2).getValues();
    for (let i = 1; i < values.length; i++) {
      const key = String(values[i][0] || '').trim();
      if (key) out[key] = values[i][1];
    }
  }

  try { cache.put(CONFIG_CACHE_KEY, JSON.stringify(out), CONFIG_CACHE_SECONDS); } catch (_) {}
  return out;
}

function getUsersCached_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(USERS_CACHE_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch (_) {}
  }

  const users = getSheetObjects_('Users');
  try { cache.put(USERS_CACHE_KEY, JSON.stringify(users), USERS_CACHE_SECONDS); } catch (_) {}
  return users;
}

function invalidateUsersCache_() {
  CacheService.getScriptCache().remove(USERS_CACHE_KEY);
}

function clearMailboxCaches_() {
  const cache = CacheService.getScriptCache();
  cache.remove(CONFIG_CACHE_KEY);
  cache.remove(USERS_CACHE_KEY);
  return { ok:true };
}

function getUserIndexCacheKey_(userId) {
  return USER_INDEX_CACHE_PREFIX + String(userId);
}

function invalidateMailboxCache_(userIds) {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  const cache = CacheService.getScriptCache();
  ids.forEach(id => {
    if (id !== undefined && id !== null && String(id)) {
      cache.remove(getUserIndexCacheKey_(id));
    }
  });
}

/* =========================================================
   SHEET ACCESS
========================================================= */

function getSpreadsheetFor_(type) {
  const cfg = readConfig_();
  let raw = '';
  if (type === 'Users') raw = cfg.USERS_SHEET_ID || cfg.USERS_SHEET_URL;
  if (type === 'Emails' || type === 'Mailbox_Index') raw = cfg.MAIL_DATABASE_SHEET_ID || cfg.MAIL_DATABASE_URL;
  if (type === 'Attachments') raw = cfg.DRIVE_REGISTER_SHEET_ID || cfg.DRIVE_REGISTER_URL;
  const id = extractId_(raw);
  if (!id) throw new Error('Spreadsheet ID is not configured for ' + type);
  return SpreadsheetApp.openById(id);
}

function getSheetObjects_(sheetName) {
  const type = sheetName === 'Users' ? 'Users' :
    (sheetName === 'Attachments' ? 'Attachments' : 'Emails');
  const ss = getSpreadsheetFor_(type);
  let sh = ss.getSheetByName(sheetName);
  if (!sh && sheetName === 'Mailbox_Index') sh = ss.insertSheet('Mailbox_Index');
  if (!sh) throw new Error('Sheet/tab not found: ' + sheetName);

  const lastRow = sh.getLastRow();
  const lastColumn = sh.getLastColumn();
  if (lastRow < 1 || lastColumn < 1) return [];

  const values = sh.getRange(1, 1, lastRow, lastColumn).getValues();
  const headers = values[0].map(String);
  return values.slice(1).filter(row => row.some(v => v !== '')).map(row => {
    const o = {};
    headers.forEach((h, i) => o[h] = row[i] instanceof Date ? formatDate_(row[i]) : row[i]);
    return o;
  });
}

/* User-specific index lookup: only the matching User_ID rows are converted. */
function getMailboxIndexForUser_(userId) {
  const key = getUserIndexCacheKey_(userId);
  const cache = CacheService.getScriptCache();
  const cached = cache.get(key);

  if (cached) {
    try { return JSON.parse(cached); } catch (_) {}
  }

  const ss = getSpreadsheetFor_('Mailbox_Index');
  let sh = ss.getSheetByName('Mailbox_Index');
  if (!sh) sh = ss.insertSheet('Mailbox_Index');

  const lastRow = sh.getLastRow();
  const lastColumn = sh.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return [];

  const values = sh.getRange(1, 1, lastRow, lastColumn).getValues();
  const headers = values[0].map(String);
  const userCol = headers.indexOf('User_ID');

  if (userCol < 0) {
    throw new Error('Missing column User_ID in Mailbox_Index');
  }

  const cfg = readConfig_();
  const tz = cfg.TIMEZONE || Session.getScriptTimeZone() || 'Asia/Kolkata';
  const rows = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (String(row[userCol]) !== String(userId)) continue;

    const obj = {};
    headers.forEach((h, c) => {
      obj[h] = row[c] instanceof Date
        ? Utilities.formatDate(row[c], tz, 'dd/MM/yyyy HH:mm:ss')
        : row[c];
    });
    rows.push(obj);
  }

  try {
    cache.put(key, JSON.stringify(rows), USER_INDEX_CACHE_SECONDS);
  } catch (_) {
    // Very large mailboxes can exceed CacheService size; normal operation continues.
  }

  return rows;
}

/* Reads one matching row or rows by scanning only the key column first. */
function getObjectByKey_(sheetName, keyHeader, keyValue) {
  const rows = getRowsByKey_(sheetName, keyHeader, keyValue);
  return rows.length ? rows[0] : null;
}

function getRowsByKey_(sheetName, keyHeader, keyValue) {
  const type = sheetName === 'Users' ? 'Users' :
    (sheetName === 'Attachments' ? 'Attachments' : 'Emails');
  const ss = getSpreadsheetFor_(type);
  let sh = ss.getSheetByName(sheetName);
  if (!sh && sheetName === 'Mailbox_Index') sh = ss.insertSheet('Mailbox_Index');
  if (!sh) throw new Error('Sheet/tab not found: ' + sheetName);

  const lastRow = sh.getLastRow();
  const lastColumn = sh.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return [];

  const headers = sh.getRange(1, 1, 1, lastColumn).getValues()[0].map(String);
  const keyCol = headers.indexOf(keyHeader);
  if (keyCol < 0) throw new Error('Missing column ' + keyHeader + ' in ' + sheetName);

  const keyValues = sh.getRange(2, keyCol + 1, lastRow - 1, 1).getValues();
  const matchedRows = [];
  for (let i = 0; i < keyValues.length; i++) {
    if (String(keyValues[i][0]) === String(keyValue)) matchedRows.push(i + 2);
  }
  if (!matchedRows.length) return [];

  const out = [];
  matchedRows.forEach(rowNumber => {
    const row = sh.getRange(rowNumber, 1, 1, lastColumn).getValues()[0];
    const o = {};
    headers.forEach((h, i) => o[h] = row[i] instanceof Date ? formatDate_(row[i]) : row[i]);
    out.push(o);
  });
  return out;
}

function appendObject_(sheetName, obj) {
  const type = sheetName === 'Users' ? 'Users' :
    (sheetName === 'Attachments' ? 'Attachments' : 'Emails');
  const ss = getSpreadsheetFor_(type);
  let sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);

  ensureHeaders_(sh, REQUIRED_HEADERS[sheetName] || Object.keys(obj));
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const row = headers.map(h => obj[h] === undefined ? '' : obj[h]);
  sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}

function ensureHeaders_(sh, headers) {
  const lastColumn = sh.getLastColumn();
  const current = lastColumn
    ? sh.getRange(1, 1, 1, lastColumn).getValues()[0].map(String)
    : [];

  if (!current.length || current.every(x => !x)) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    return;
  }

  const missing = headers.filter(h => !current.includes(h));
  if (missing.length) {
    sh.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
  }
}

/* Updates only the key column first, then the specific changed cells. */
function updateByKey_(sheetName, keyHeader, keyValue, changes) {
  const type = sheetName === 'Users' ? 'Users' :
    (sheetName === 'Attachments' ? 'Attachments' : 'Emails');
  const ss = getSpreadsheetFor_(type);
  const sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error('Sheet/tab not found: ' + sheetName);

  const lastRow = sh.getLastRow();
  const lastColumn = sh.getLastColumn();
  if (lastRow < 2) throw new Error('Record not found: ' + keyValue);

  const headers = sh.getRange(1, 1, 1, lastColumn).getValues()[0].map(String);
  const keyCol = headers.indexOf(keyHeader);
  if (keyCol < 0) throw new Error('Missing column ' + keyHeader);

  const keyValues = sh.getRange(2, keyCol + 1, lastRow - 1, 1).getValues();
  let rowNumber = 0;
  for (let i = 0; i < keyValues.length; i++) {
    if (String(keyValues[i][0]) === String(keyValue)) {
      rowNumber = i + 2;
      break;
    }
  }
  if (!rowNumber) throw new Error('Record not found: ' + keyValue);

  Object.keys(changes).forEach(k => {
    const c = headers.indexOf(k);
    if (c >= 0) sh.getRange(rowNumber, c + 1).setValue(changes[k]);
  });
}

function updateMailboxIndex_(recordId, changes) {
  updateByKey_('Mailbox_Index', 'Mailbox_Record_ID', recordId, changes);
}

function updateEmail_(mailId, changes) {
  updateByKey_('Emails', 'Mail_ID', mailId, changes);
}

/* =========================================================
   USER FUNCTIONS
========================================================= */

function getUserByEmail_(email) {
  const target = String(email || '').trim().toLowerCase();
  return getUsersCached_().find(u =>
    String(u.Email_Address || '').trim().toLowerCase() === target
  ) || null;
}

function getUserById_(id) {
  return getUsersCached_().find(u =>
    String(u.User_ID || '') === String(id)
  ) || null;
}

function safeUser_(u) {
  return {
    userId:String(u.User_ID || ''),
    email:String(u.Email_Address || ''),
    name:String(u.Full_Name || ''),
    designation:String(u.Designation || ''),
    department:String(u.Department || ''),
    role:String(u.Role || ''),
    profileImageUrl:String(u.Profile_Image_URL || '')
  };
}

function incrementFailedLogin_(user) {
  const count = Number(user.Failed_Login_Count || 0) + 1;
  updateByKey_('Users', 'User_ID', user.User_ID, {
    Failed_Login_Count:count,
    Last_Failed_Login:now_()
  });
  invalidateUsersCache_();
}

function updateUserLogin_(user) {
  updateByKey_('Users', 'User_ID', user.User_ID, {
    Last_Login:now_(),
    Failed_Login_Count:0,
    Last_Failed_Login:''
  });
  invalidateUsersCache_();
}

/* =========================================================
   INDEX MIGRATION
   Run once after deploying this version.
========================================================= */

function rebuildMailboxIndexMetadata_() {
  const ss = getSpreadsheetFor_('Mailbox_Index');
  let sh = ss.getSheetByName('Mailbox_Index');
  if (!sh) throw new Error('Mailbox_Index tab not found.');

  ensureHeaders_(sh, REQUIRED_HEADERS.Mailbox_Index);

  const emails = getSheetObjects_('Emails');
  const emailMap = {};
  emails.forEach(m => emailMap[String(m.Mail_ID)] = m);

  const lastRow = sh.getLastRow();
  const lastColumn = sh.getLastColumn();
  if (lastRow < 2) return { ok:true, updated:0 };

  const headers = sh.getRange(1, 1, 1, lastColumn).getValues()[0].map(String);
  const col = {};
  headers.forEach((h, i) => col[h] = i);

  const values = sh.getRange(2, 1, lastRow - 1, lastColumn).getValues();
  let updated = 0;

  values.forEach(row => {
    const mailId = String(row[col.Mail_ID] || '');
    const email = emailMap[mailId];
    if (!mailId || !email) return;

    row[col.Subject] = String(email.Subject || '');
    row[col.Sender_Name] = String(email.Sender_Name || '');
    row[col.Sender_Email] = String(email.Sender_Email || '');
    row[col.To_Email] = String(email.To_Email || '');
    row[col.Label] = String(email.Label || '');
    row[col.Has_Attachment] = String(email.Has_Attachment || 'NO');
    row[col.Attachment_Count] = Number(email.Attachment_Count || 0);
    row[col.Preview] = createPreview_(email.Body);
    row[col.Message_DateTime] = String(email.Sent_DateTime || email.Received_DateTime || '');
    updated++;
  });

  sh.getRange(2, 1, values.length, lastColumn).setValues(values);
  clearMailboxCaches_();
  return { ok:true, updated:updated };
}

function createPreview_(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 180);
}

/* =========================================================
   IDs / UTILITIES
========================================================= */

function nextReference_() {
  const cfg = readConfig_();
  const prefix = String(cfg.REFERENCE_PREFIX || 'MLR-MAIL');
  const tz = cfg.TIMEZONE || Session.getScriptTimeZone() || 'Asia/Kolkata';
  const year = Utilities.formatDate(new Date(), tz, 'yyyy');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    const key = 'MAIL_SEQ_' + year;
    const next = Number(props.getProperty(key) || 0) + 1;
    props.setProperty(key, String(next));
    return prefix + '-' + year + '-' + ('000000' + next).slice(-6);
  } finally {
    lock.releaseLock();
  }
}

function nextId_(prefix) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    const key = 'SEQ_' + prefix;
    const next = Number(props.getProperty(key) || 0) + 1;
    props.setProperty(key, String(next));
    return prefix + Utilities.formatString('%06d', next);
  } finally {
    lock.releaseLock();
  }
}

function normalizeEmails_(value) {
  if (Array.isArray(value)) {
    return unique_(value.map(x => String(x).trim().toLowerCase()).filter(Boolean));
  }
  return unique_(String(value || '').split(/[;,]/).map(x => x.trim().toLowerCase()).filter(Boolean));
}

function unique_(arr) {
  return Array.from(new Set(arr));
}

function sha256_(text) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    text,
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function now_() {
  const cfg = readConfig_();
  return Utilities.formatDate(
    new Date(),
    cfg.TIMEZONE || Session.getScriptTimeZone() || 'Asia/Kolkata',
    'dd/MM/yyyy HH:mm:ss'
  );
}

function formatDate_(d) {
  const cfg = readConfig_();
  return Utilities.formatDate(
    d,
    cfg.TIMEZONE || Session.getScriptTimeZone() || 'Asia/Kolkata',
    'dd/MM/yyyy HH:mm:ss'
  );
}

function extractId_(value) {
  const s = String(value || '').trim();
  const m = s.match(/[-\w]{20,}/);
  return m ? m[0] : '';
}

function getOrCreateFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
