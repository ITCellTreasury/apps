
window.MAILBOX_API_URL=window.MAILBOX_API_URL||'https://script.google.com/macros/s/AKfycbzSmkO0f-qB60RgFK4L8ZJ5XHJDcevJS6cJvbfEbgRpyWCaYJjWB01s0NFmwYsSJobj/exec';
const MailboxAPI=(()=>{
 const inFlightRequests=new Map();
 const READ_ACTIONS=new Set(['mailbox','getMessage','getThread','bootstrap','listMailboxUsers','listThreadProfileImages','suggestRecipients','getProfile']);
 async function request(action,payload={}){
   const dedupe=READ_ACTIONS.has(action);
   const key=dedupe?action+'|'+JSON.stringify(payload):'';
   if(dedupe&&inFlightRequests.has(key))return inFlightRequests.get(key);
   const task=(async()=>{
     const response=await fetch(window.MAILBOX_API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(Object.assign({action},payload)),redirect:'follow'});
     if(!response.ok)throw new Error('Server error: '+response.status);
     const data=await response.json();
     if(!data.ok)throw new Error(data.error||'Request failed.');
     return data;
   })();
   if(dedupe)inFlightRequests.set(key,task);
   try{return await task}
   finally{if(dedupe&&inFlightRequests.get(key)===task)inFlightRequests.delete(key)}
 }
 // Persist authentication across browser restarts. Migrate existing sessionStorage
 // sessions (created by the current login page) into localStorage on first load.
 const readStored=(key)=>localStorage.getItem(key)||sessionStorage.getItem(key)||'';
 const token=()=>readStored('mailbox_token');
 const user=()=>{try{return JSON.parse(readStored('mailbox_user')||'null')}catch(_){return null}};
 const setSession=data=>{
   if(!data||!data.token)throw new Error('Invalid login session.');
   localStorage.setItem('mailbox_token',data.token);
   localStorage.setItem('mailbox_user',JSON.stringify(data.user||{}));
   // Keep a compatibility copy for any existing page code still reading sessionStorage.
   sessionStorage.setItem('mailbox_token',data.token);
   sessionStorage.setItem('mailbox_user',JSON.stringify(data.user||{}));
 };
 const clearSession=()=>{
   ['mailbox_token','mailbox_user'].forEach(key=>{localStorage.removeItem(key);sessionStorage.removeItem(key)});
 };
 // Migrate an active login created by login.html before this persistent storage update.
 if(!localStorage.getItem('mailbox_token')&&sessionStorage.getItem('mailbox_token')){
   localStorage.setItem('mailbox_token',sessionStorage.getItem('mailbox_token'));
   const savedUser=sessionStorage.getItem('mailbox_user');
   if(savedUser)localStorage.setItem('mailbox_user',savedUser);
 }
 const requireLogin=()=>{if(!token())location.href='login.html'};
 return{request,token,user,setSession,clearSession,requireLogin,logout:()=>request('logout',{token:token()}),bootstrap:()=>request('bootstrap',{token:token()}),list:(folder,search='',page=1,pageSize=25,sort='date-desc')=>request('mailbox',{token:token(),folder,search,page,pageSize,sort}),get:mailId=>request('getMessage',{token:token(),mailId}),getThread:mailId=>request('getThread',{token:token(),mailId}),suggestRecipients:query=>request('suggestRecipients',{token:token(),query}),send:payload=>request('sendMessage',Object.assign({token:token()},payload)),draft:payload=>request('saveDraft',Object.assign({token:token()},payload)),update:payload=>request('updateMessage',Object.assign({token:token()},payload))}
})();

(() => {
'use strict';
MailboxAPI.requireLogin();
const $=id=>document.getElementById(id);
const folders={INBOX:'Inbox',SENT:'Sent',DRAFT:'Drafts',STARRED:'Starred',ARCHIVE:'Archive',SPAM:'Spam',TRASH:'Trash'};
let currentFolder=sessionStorage.getItem('mailbox_folder')||'INBOX';
let currentPage=1,pageSize=25,totalPages=1,currentMessages=[],selectedIds=new Set(),selectedMailId='',selectedThreadMailId='',selectedMessage=null,selectedAttachments=[],threadMessages=[];
let searchTimer=null,silentTimer=null,loading=false,loadSequence=0,composeMode='new',originalMessage=null,originalAttachments=[],sending=false,attachmentFiles=[];
const folderCache=new Map();
const folderViews=new Map();
// Keep recently opened conversations in memory to avoid repeat Apps Script calls.
const threadCache=new Map();
const threadCacheTTL=120000;
const CACHE_TTL=60000;
let splitterDragging=false;
const user=MailboxAPI.user()||{};
$('avatar').textContent=initials(user.name||user.fullName,user.email||user.emailAddress);

/* =========================================================
   SORTING STATE
   ========================================================= */
let currentSort = localStorage.getItem('mailbox_sort') || 'date-desc';

function parseMailDate(value) {
  if (value === null || value === undefined || value === '') return 0;
  // The API may send today's date as a time-only string (e.g. "12:35 PM").
  // Interpret that as today's local date so it sorts alongside full timestamps.
  const raw = String(value).trim();
  const timeOnly = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (timeOnly) {
    let hours = Number(timeOnly[1]) % 12;
    if (timeOnly[4].toUpperCase() === 'PM') hours += 12;
    const d = new Date();
    d.setHours(hours, Number(timeOnly[2]), Number(timeOnly[3] || 0), 0);
    return d.getTime();
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortMessages(list) {
  const arr = Array.isArray(list) ? list.slice() : [];
  const [field, dir] = String(currentSort || 'date-desc').split('-');
  const mul = dir === 'asc' ? 1 : -1;
  arr.sort((a, b) => {
    let va, vb;
    switch (field) {
      case 'date':
        va = parseMailDate(a.date);
        vb = parseMailDate(b.date);
        break;
      case 'sender':
        va = String(a.senderName || a.senderEmail || a.to || '').toLowerCase();
        vb = String(b.senderName || b.senderEmail || b.to || '').toLowerCase();
        break;
      case 'subject':
        va = String(a.subject || '').toLowerCase();
        vb = String(b.subject || '').toLowerCase();
        break;
      default:
        va = parseMailDate(a.date);
        vb = parseMailDate(b.date);
    }
    if (va < vb) return -1 * mul;
    if (va > vb) return 1 * mul;
    return 0;
  });
  return arr;
}

/* =========================================================
   CENTRAL VIEW STATE
   ========================================================= */
let activeView = 'folders';

function initials(name,email){const s=String(name||email||'U').trim();const p=s.split(/\s+/).filter(Boolean);return (p.length>1?p[0][0]+p[1][0]:s.slice(0,2)).toUpperCase()}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function escAttr(v){return esc(v)}
function formatDate(v){if(!v)return '';const raw=String(v).trim();const timeOnly=/^\d{1,2}:\d{2}(?::\d{2})?\s*(AM|PM)$/i.test(raw);const d=timeOnly?new Date(parseMailDate(raw)):new Date(v);if(Number.isNaN(d.getTime()))return raw;const now=new Date();const same=d.toDateString()===now.toDateString();return same?d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):d.toLocaleDateString([], {day:'2-digit',month:'short',year:'numeric'})}
function formatSize(bytes){const n=Number(bytes||0);if(!n)return '';if(n<1024)return n+' B';if(n<1048576)return (n/1024).toFixed(1)+' KB';if(n<1073741824)return (n/1048576).toFixed(1)+' MB';return (n/1073741824).toFixed(1)+' GB'}
function showOverlay(){ $('loadingOverlay').classList.add('show'); $('loadingOverlay').setAttribute('aria-hidden','false') }
function hideOverlay(){ $('loadingOverlay').classList.remove('show'); $('loadingOverlay').setAttribute('aria-hidden','true') }
function saveFolder(){sessionStorage.setItem('mailbox_folder',currentFolder)}
function updateFolderUI(){document.querySelectorAll('.folder').forEach(b=>b.classList.toggle('active',b.dataset.folder===currentFolder));$('listTitle').textContent=folders[currentFolder]||currentFolder}
function signature(list){return (list||[]).map(m=>[m.mailId,m.date,m.subject,m.isRead?'1':'0',m.isStarred?'1':'0',m.threadId||'',m.conversationCount||1].join('|')).join('~')}

/* =========================================================
   UNIFIED ALERT BOX
   ========================================================= */
function showAlert(message, type='info', duration=4000) {
  const box = $('unifiedAlert');
  const msg = $('alertMsg');
  const icon = $('alertIcon');
  const icons = { info:'ℹ️', success:'✅', warning:'⚠️', error:'❌' };
  msg.textContent = message;
  icon.textContent = icons[type] || icons.info;
  box.className = 'alert-box show alert-' + type;
  clearTimeout(box._timer);
  if (duration > 0) {
    box._timer = setTimeout(() => box.classList.remove('show'), duration);
  }
}
$('alertClose').addEventListener('click', () => $('unifiedAlert').classList.remove('show'));

/* =========================================================
   CUSTOM CONFIRM DIALOG
   ========================================================= */
let confirmResolver = null;

function showConfirm(options = {}) {
  const {
    title = 'Are you sure?',
    message = '',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    variant = 'primary' // primary | danger | warn
  } = options;

  const overlay = $('confirmOverlay');
  const iconEl = $('confirmIcon');
  const titleEl = $('confirmTitle');
  const msgEl = $('confirmMessage');
  const okBtn = $('confirmOk');
  const cancelBtn = $('confirmCancel');

  titleEl.textContent = title;
  msgEl.textContent = message;
  okBtn.textContent = confirmText;
  cancelBtn.textContent = cancelText;

  okBtn.className = 'confirm-btn ' + (variant === 'danger' ? 'danger' : 'primary');
  iconEl.className = 'confirm-icon' + (variant === 'danger' ? ' danger' : variant === 'warn' ? ' warn' : '');
  iconEl.textContent = variant === 'danger' ? '🗑️' : variant === 'warn' ? '⚠️' : '❓';

  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden', 'false');

  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}

function closeConfirm(result) {
  const overlay = $('confirmOverlay');
  overlay.classList.remove('show');
  overlay.setAttribute('aria-hidden', 'true');
  if (confirmResolver) {
    confirmResolver(result);
    confirmResolver = null;
  }
}

$('confirmOk').addEventListener('click', () => closeConfirm(true));
$('confirmCancel').addEventListener('click', () => closeConfirm(false));
$('confirmOverlay').addEventListener('click', (e) => {
  if (e.target === $('confirmOverlay')) closeConfirm(false);
});

/* =========================================================
   NOTIFICATION TUNE
   ========================================================= */
let notificationAudio = null;
let audioReady = false;

function initNotificationAudio() {
  if (notificationAudio) return;
  notificationAudio = new Audio('notification.mp3');
  notificationAudio.volume = 0.6;
  notificationAudio.load();
  const unlock = () => {
    if (audioReady) return;
    notificationAudio.play().then(() => {
      notificationAudio.pause();
      notificationAudio.currentTime = 0;
      audioReady = true;
    }).catch(() => {});
  };
  document.addEventListener('click', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });
  document.addEventListener('touchstart', unlock, { once: true });
}

function playNotificationTune() {
  if (!notificationAudio) initNotificationAudio();
  if (!notificationAudio) return;
  const clone = notificationAudio.cloneNode();
  clone.volume = 0.6;
  clone.play().catch(() => {
    const retry = () => {
      clone.play().catch(() => {});
      document.removeEventListener('click', retry);
    };
    document.addEventListener('click', retry, { once: true });
  });
}

let lastInboxCount = 0;
let lastMailIds = new Set();

/* =========================================================
   THE ONE TRUE VIEW SWITCHER
   ========================================================= */
function switchView(viewName){
  if(viewName!=='folders' && viewName!=='compose') return;
  activeView = viewName;

  const foldersWorkspace = $('foldersWorkspace');
  const composeContainer = $('composeContainer');
  const foldersTab       = $('foldersTab');

  if(viewName === 'compose'){
    foldersWorkspace.classList.add('workspace-hidden');
    foldersWorkspace.setAttribute('aria-hidden','true');
    composeContainer.classList.add('show');
    composeContainer.setAttribute('aria-hidden','false');
    foldersTab.classList.remove('active');
    if (typeof ComposerManager !== 'undefined') ComposerManager.activateCurrent();
  } else {
    composeContainer.classList.remove('show');
    composeContainer.setAttribute('aria-hidden','true');
    foldersWorkspace.classList.remove('workspace-hidden');
    foldersWorkspace.removeAttribute('aria-hidden');
    foldersTab.classList.add('active');
    if (typeof ComposerManager !== 'undefined') ComposerManager.deactivateAll();
  }
}

/* =========================================================
   MULTI-COMPOSER MANAGER
   ========================================================= */
const ComposerManager = (() => {
  let composers = new Map();
  let activeId = null;
  let nextId = 1;

  const container = $('composeContainer');
  const tabsEl = $('composeTabs');

  function createComposer(mode = 'new', message = null, attachments = []) {
    const id = 'composer-' + (nextId++);
    const el = document.createElement('div');
    el.className = 'compose';
    el.dataset.composerId = id;
    el.innerHTML = `
      <div class="compose-head">
        <div><span class="compose-title" data-role="title">New message</span><span class="mode-badge hidden" data-role="badge"></span></div>
        <button class="icon-btn" data-action="close" title="Close"><i class="bi bi-x-lg"></i></button>
      </div>
      <div class="compose-body">
        <div class="alert hidden" data-role="alert"></div>
        <div class="alert hidden" data-role="loading">Loading original message…</div>
        <div class="compose-row"><label class="compose-label" for="recipient-to">To <button type="button" class="recipient-directory-trigger" data-open-recipient-directory="to" title="Choose from Mail ID Details" aria-label="Choose To recipients"><i class="bi bi-chevron-down"></i></button></label><div class="recipient-box" data-recipient-box="to"><div class="recipient-chips" data-chips="to"></div><input id="recipient-to" class="compose-input recipient-entry" data-field="to" autocomplete="off" placeholder="Recipient email"><div class="autocomplete" data-role="suggestions-to"></div></div></div>
        <div class="compose-row"><label class="compose-label" for="recipient-cc">Cc <button type="button" class="recipient-directory-trigger" data-open-recipient-directory="cc" title="Choose from Mail ID Details" aria-label="Choose Cc recipients"><i class="bi bi-chevron-down"></i></button></label><div class="recipient-box" data-recipient-box="cc"><div class="recipient-chips" data-chips="cc"></div><input id="recipient-cc" class="compose-input recipient-entry" data-field="cc" autocomplete="off" placeholder="Optional"><div class="autocomplete" data-role="suggestions-cc"></div></div></div>
        <div class="compose-row"><label class="compose-label" for="recipient-bcc">Bcc <button type="button" class="recipient-directory-trigger" data-open-recipient-directory="bcc" title="Choose from Mail ID Details" aria-label="Choose Bcc recipients"><i class="bi bi-chevron-down"></i></button></label><div class="recipient-box" data-recipient-box="bcc"><div class="recipient-chips" data-chips="bcc"></div><input id="recipient-bcc" class="compose-input recipient-entry" data-field="bcc" autocomplete="off" placeholder="Optional"><div class="autocomplete" data-role="suggestions-bcc"></div></div></div>
        <div class="compose-row"><label class="compose-label">Subject</label><input class="compose-input" data-field="subject" placeholder="Subject"></div>
        <div class="editor-tools" role="toolbar" aria-label="Message formatting">
          <select data-editor-select="fontName" title="Font family"><option value="Arial">Arial</option><option value="Calibri">Calibri</option><option value="Georgia">Georgia</option><option value="Tahoma">Tahoma</option><option value="Times New Roman">Times New Roman</option><option value="Verdana">Verdana</option><option value="Courier New">Courier New</option></select>
          <select data-editor-select="fontSize" title="Font size"><option value="2">Small</option><option value="3" selected>Normal</option><option value="4">Large</option><option value="5">Larger</option><option value="6">Huge</option><option value="7">Maximum</option></select>
          <span class="editor-tool-separator"></span>
          <button type="button" data-cmd="bold" title="Bold"><b>B</b></button><button type="button" data-cmd="italic" title="Italic"><i>I</i></button><button type="button" data-cmd="underline" title="Underline"><u>U</u></button><button type="button" data-cmd="strikeThrough" title="Strikethrough"><s>S</s></button><button type="button" data-cmd="superscript" title="Superscript">x<sup>2</sup></button><button type="button" data-cmd="subscript" title="Subscript">x<sub>2</sub></button>
          <label class="editor-color-tool" title="Text colour">A <input type="color" data-editor-color="foreColor" aria-label="Text colour"></label><label class="editor-color-tool" title="Highlight colour"><i class="bi bi-highlighter"></i><input type="color" data-editor-color="hiliteColor" aria-label="Highlight colour" value="#fff59d"></label>
          <span class="editor-tool-separator"></span>
          <button type="button" data-cmd="justifyLeft" title="Align left"><i class="bi bi-text-left"></i></button><button type="button" data-cmd="justifyCenter" title="Align centre"><i class="bi bi-text-center"></i></button><button type="button" data-cmd="justifyRight" title="Align right"><i class="bi bi-text-right"></i></button><button type="button" data-cmd="justifyFull" title="Justify"><i class="bi bi-justify"></i></button>
          <button type="button" data-cmd="insertUnorderedList" title="Bulleted list"><i class="bi bi-list-ul"></i></button><button type="button" data-cmd="insertOrderedList" title="Numbered list"><i class="bi bi-list-ol"></i></button><button type="button" data-cmd="outdent" title="Decrease indent"><i class="bi bi-outdent"></i></button><button type="button" data-cmd="indent" title="Increase indent"><i class="bi bi-indent"></i></button>
          <select data-editor-select="formatBlock" title="Paragraph style"><option value="p">Paragraph</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option><option value="h4">Heading 4</option><option value="pre">Code</option><option value="blockquote">Quote</option></select>
          <span class="editor-tool-separator"></span>
          <button type="button" data-cmd="createLink" title="Insert link"><i class="bi bi-link-45deg"></i></button><button type="button" data-cmd="unlink" title="Remove link"><i class="bi bi-link-45deg"></i><i class="bi bi-slash"></i></button><button type="button" data-cmd="insertHorizontalRule" title="Horizontal line"><i class="bi bi-hr"></i></button><button type="button" data-cmd="undo" title="Undo"><i class="bi bi-arrow-counterclockwise"></i></button><button type="button" data-cmd="redo" title="Redo"><i class="bi bi-arrow-clockwise"></i></button><button type="button" data-cmd="removeFormat" title="Clear formatting"><i class="bi bi-eraser"></i></button>
        </div>
        <div class="compose-area rich-editor" contenteditable="true" role="textbox" aria-multiline="true" data-field="body" data-placeholder="Write your message…"></div>
        <div class="file-list" data-role="files"></div>
        <div class="compose-status" data-role="status"></div>
      </div>
      <div class="compose-foot">
        <div class="compose-left">
          <input type="file" multiple class="hidden" data-role="file-input">
          <button class="secondary-btn" type="button" data-action="attach"><i class="bi bi-paperclip"></i> Attach</button>
          <button class="secondary-btn" type="button" data-action="draft">Save draft</button>
          <button class="secondary-btn" type="button" data-action="discard">Discard</button>
        </div>
        <button class="send-btn" type="button" data-action="send"><i class="bi bi-hourglass-split send-pending-icon" aria-hidden="true"></i><span class="send-label">Send</span></button>
      </div>
    `;
    container.appendChild(el);

    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'compose-tab';
    tab.dataset.composerId = id;
    tab.innerHTML = '<span class="compose-tab-label"></span><span class="compose-tab-close" role="button" aria-label="Close compose tab">×</span>';
    tabsEl.appendChild(tab);

    const state = { id, el, tab, mode, originalMessage: message, draftMailId: mode === 'draft' && message ? (message.mailId || message.id || '') : '', originalAttachments: attachments || [], attachmentFiles: [], recipients: {to:[],cc:[],bcc:[]}, sending: false, suggestTimer: {to:null,cc:null,bcc:null}, suggestSeq: {to:0,cc:0,bcc:0}, dirty: false };
    composers.set(id, state);
    bindComposerEvents(state);
    initComposerFields(state, mode, message, attachments);
    activateComposer(id);
    return state;
  }

  function initComposerFields(state, mode, message, attachments) {
    const el = state.el;
    const titleEl = el.querySelector('[data-role="title"]');
    const badgeEl = el.querySelector('[data-role="badge"]');
    const toInput = el.querySelector('[data-field="to"]');
    const subjectInput = el.querySelector('[data-field="subject"]');
    const bodyEl = el.querySelector('[data-field="body"]');

    titleEl.textContent = mode === 'reply' ? 'Reply message' : mode === 'replyAll' ? 'Reply all message' : mode === 'forward' ? 'Forward message' : mode === 'draft' ? 'Edit draft' : 'New message';
    badgeEl.classList.toggle('hidden', mode === 'new' || mode === 'draft');
    badgeEl.textContent = mode === 'reply' ? 'Reply' : mode === 'replyAll' ? 'Reply all' : 'Forward';

    if (mode === 'reply' && message) { addRecipient(state, 'to', message.senderEmail || '', false); subjectInput.value = replySubject(message.subject); bodyEl.innerHTML = '<br><br>'; }
    if (mode === 'replyAll' && message) {
      const own = String((user.email || user.emailAddress || '')).trim().toLowerCase();
      const sender = String(message.senderEmail || '').trim().toLowerCase();
      const splitEmails = value => {
        const raw = String(value || '');
        const found = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
        return found ? [...new Set(found.map(v => v.trim()))] : raw.split(/[;,]+/).map(v => v.trim()).filter(validEmail);
      };
      // For a message sent by the current user, address the original recipients.
      const toList = (sender && own && sender === own ? splitEmails(message.to) : splitEmails(message.senderEmail)).filter(email => email.toLowerCase() !== own);
      const ccList = [...splitEmails(message.to), ...splitEmails(message.cc)]
        .filter(email => email.toLowerCase() !== own && !toList.some(to => to.toLowerCase() === email.toLowerCase()));
      [...new Set(toList)].forEach(email => addRecipient(state, 'to', email, false));
      [...new Set(ccList)].forEach(email => addRecipient(state, 'cc', email, false));
      subjectInput.value = replySubject(message.subject);
      bodyEl.innerHTML = '<br><br>';
    }
    if (mode === 'forward' && message) { subjectInput.value = forwardSubject(message.subject); bodyEl.innerHTML = createForwarded(message); }
    if (mode === 'draft' && message) {
      subjectInput.value = message.subject || message.Subject || '';
      bodyEl.innerHTML = message.body || message.Body || '';
      ['to','cc','bcc'].forEach(field => String(message[field] || message[field.toUpperCase()] || '').split(/[;,]+/).map(v=>v.trim()).filter(Boolean).forEach(v=>addRecipient(state,field,v,false)));
    }

    Object.defineProperty(bodyEl, 'value', { get() { return this.innerHTML; }, set(v) { this.innerHTML = v || ''; }, configurable: true });

    if (mode === 'forward' && attachments.length) prepareForwardAttachments(state, attachments);
    toInput.focus();
    syncTabLabel(state);
  }

  function bindComposerEvents(state) {
    const el = state.el;
    const tab = state.tab;
    tab.addEventListener('click', (e) => { if (e.target.closest('.compose-tab-close')) { requestCloseComposer(state.id); return; } activateComposer(state.id); });
    el.querySelector('[data-action="close"]').addEventListener('click', () => requestCloseComposer(state.id));
    // Move a recipient chip between To, Cc and Bcc by dragging it to another field.
    el.addEventListener('dragstart', e => {
      const chip=e.target.closest('.recipient-chip[data-recipient-email]');
      if(!chip)return;
      const payload={email:chip.dataset.recipientEmail,from:chip.dataset.recipientField};
      e.dataTransfer.effectAllowed='move';
      e.dataTransfer.setData('application/x-mail-recipient',JSON.stringify(payload));
      e.dataTransfer.setData('text/plain',payload.email);
      chip.classList.add('is-dragging');
    });
    el.addEventListener('dragend', e => {
      const chip=e.target.closest('.recipient-chip');
      if(chip)chip.classList.remove('is-dragging');
      el.querySelectorAll('.recipient-drop-target').forEach(x=>x.classList.remove('recipient-drop-target'));
    });
    ['to','cc','bcc'].forEach(targetField=>{
      const box=el.querySelector(`[data-recipient-box="${targetField}"]`);
      box.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('application/x-mail-recipient')||e.dataTransfer.types.includes('text/plain')){e.preventDefault();e.dataTransfer.dropEffect='move';box.classList.add('recipient-drop-target')}});
      box.addEventListener('dragleave',e=>{if(!box.contains(e.relatedTarget))box.classList.remove('recipient-drop-target')});
      box.addEventListener('drop',e=>{
        e.preventDefault();box.classList.remove('recipient-drop-target');
        let payload=null;
        try{payload=JSON.parse(e.dataTransfer.getData('application/x-mail-recipient')||'null')}catch(_){}
        if(!payload||!payload.email||!['to','cc','bcc'].includes(payload.from)||payload.from===targetField)return;
        const sourceList=state.recipients[payload.from];
        const index=sourceList.findIndex(x=>x.toLowerCase()===String(payload.email).toLowerCase());
        if(index<0)return;
        const email=sourceList.splice(index,1)[0];
        if(!state.recipients[targetField].some(x=>x.toLowerCase()===email.toLowerCase()))state.recipients[targetField].push(email);
        renderRecipientChips(state,payload.from);renderRecipientChips(state,targetField);
        state.dirty=true;
      });
    });
    el.querySelector('[data-action="send"]').addEventListener('click', () => sendComposer(state));

    const fileInput = el.querySelector('[data-role="file-input"]');
    el.querySelector('[data-action="attach"]').addEventListener('click', () => { if (!state.sending) fileInput.click(); });
    fileInput.addEventListener('change', (e) => {
      if (state.sending) return;
      for (const f of [...e.target.files]) state.attachmentFiles.push(f);
      renderFiles(state);
      el.querySelector('[data-role="status"]').textContent = `${state.attachmentFiles.length} attachment(s) selected.`;
      e.target.value = '';
    });

    el.querySelector('[data-action="draft"]').addEventListener('click', () => saveDraftComposer(state));
    el.querySelector('[data-action="discard"]').addEventListener('click', () => requestDiscardComposer(state));

    const editor = el.querySelector('[data-field="body"]');
    el.querySelectorAll('.editor-tools button').forEach(b => b.addEventListener('mousedown', e => e.preventDefault()));
    el.querySelectorAll('[data-cmd]').forEach(b => {
      b.addEventListener('click', () => {
        const cmd = b.dataset.cmd;
        let value = null;
        if (cmd === 'createLink') {
          value = prompt('Enter link URL (include https://)');
          if (!value) return;
          if (!/^(https?:|mailto:)/i.test(value)) value = 'https://' + value;
        }
        editor.focus();
        document.execCommand(cmd, false, value);
      });
    });
    el.querySelectorAll('[data-editor-select]').forEach(control => control.addEventListener('change', () => {
      editor.focus(); document.execCommand(control.dataset.editorSelect, false, control.value);
    }));
    el.querySelectorAll('[data-editor-color]').forEach(control => control.addEventListener('input', () => {
      editor.focus(); document.execCommand(control.dataset.editorColor, false, control.value);
    }));

    el.querySelector('[data-field="subject"]').addEventListener('input', () => syncTabLabel(state));

    ['to','cc','bcc'].forEach(field => {
      const input = el.querySelector(`[data-field="${field}"]`);
      const suggestions = el.querySelector(`[data-role="suggestions-${field}"]`);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ',' || e.key === ';') { e.preventDefault(); commitRecipient(state, field); }
        if (e.key === 'Backspace' && !input.value && state.recipients[field].length) { state.recipients[field].pop(); renderRecipientChips(state, field); }
      });
      input.addEventListener('input', () => {
        const raw = input.value;
        if (/[;,]$/.test(raw)) { ++state.suggestSeq[field]; clearTimeout(state.suggestTimer[field]); commitRecipient(state, field); hideSuggestions(suggestions); return; }

        // Search only the current address token. Suggestions begin after 3 characters;
        // an '@' is not required, so names and the beginning of email IDs can match.
        const q = raw.split(/[;,]/).pop().trim();
        state.dirty = true;
        const seq = ++state.suggestSeq[field];
        clearTimeout(state.suggestTimer[field]);
        if (q.length < 3) { hideSuggestions(suggestions); return; }

        state.suggestTimer[field] = setTimeout(async () => {
          try {
            const r = await MailboxAPI.suggestRecipients(q);
            if (seq === state.suggestSeq[field] && input.value.split(/[;,]/).pop().trim() === q)
              renderSuggestions(suggestions, r.items || [], input, state, field);
          } catch (_) {
            if (seq === state.suggestSeq[field]) hideSuggestions(suggestions);
          }
        }, 180);
      });
      input.addEventListener('blur', () => setTimeout(() => { commitRecipient(state, field); hideSuggestions(suggestions); }, 220));
      el.querySelector(`[data-recipient-box="${field}"]`).addEventListener('click', (e) => { if (!e.target.closest('.recipient-directory-trigger')) input.focus(); });
      el.querySelector(`[data-open-recipient-directory="${field}"]`).addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openRecipientDirectory(state, field); });
    });
  }

  function validEmail(v) { return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(v); }
  function addRecipient(state, field, value, clearInput = true) {
    const email = String(value || '').trim().replace(/[;,]+$/, '');
    if (!email) return;
    if (!validEmail(email)) { showAlert(`Please check this email address: ${email}`, 'warning'); return; }
    const list = state.recipients[field];
    if (!list.some(x => x.toLowerCase() === email.toLowerCase())) list.push(email);
    if (clearInput) state.el.querySelector(`[data-field="${field}"]`).value = '';
    renderRecipientChips(state, field);
  }
  function commitRecipient(state, field) {
    const input = state.el.querySelector(`[data-field="${field}"]`);
    const raw = input.value.trim();
    if (!raw) return;
    raw.split(/[;,]+/).map(x => x.trim()).filter(Boolean).forEach(x => addRecipient(state, field, x, false));
    input.value = '';
  }
  function renderRecipientChips(state, field) {
    const host = state.el.querySelector(`[data-chips="${field}"]`);
    host.innerHTML = state.recipients[field].map((email, i) => `<span class="recipient-chip" draggable="true" data-recipient-email="${escAttr(email)}" data-recipient-field="${field}" title="Drag to move to To, Cc or Bcc"><span>${esc(email)}</span><button type="button" aria-label="Remove ${esc(email)}" data-remove-recipient="${i}">×</button></span>`).join('');
    host.querySelectorAll('[data-remove-recipient]').forEach(btn => btn.addEventListener('click', () => { state.recipients[field].splice(Number(btn.dataset.removeRecipient), 1); renderRecipientChips(state, field); }));
  }
  function recipientValue(state, field) { commitRecipient(state, field); return state.recipients[field].join(', '); }
  function hideSuggestions(container) { container.classList.remove('show'); container.innerHTML = ''; }
  function renderSuggestions(container, items, input, state, field) {
    if (!items.length) { hideSuggestions(container); return; }
    container.innerHTML = items.map((x, i) => `<div class="suggestion" data-suggest-index="${i}"><div class="suggestion-name">${esc(x.name || x.email)}</div><div class="suggestion-email">${esc(x.email)}${x.department ? ' · ' + esc(x.department) : ''}</div></div>`).join('');
    container.classList.add('show');
    container.querySelectorAll('[data-suggest-index]').forEach(el => {
      el.addEventListener('mousedown', (e) => { e.preventDefault(); const x = items[Number(el.dataset.suggestIndex)]; addRecipient(state, field, x.email); input.value = ''; ++state.suggestSeq[field]; clearTimeout(state.suggestTimer[field]); hideSuggestions(container); input.focus(); state.dirty = true; });
    });
  }

  // Cache the user directory after the first successful load.
  let recipientDirectoryCache = null;
  let recipientDirectoryTarget = null;
  let recipientDirectoryState = null;
  let recipientDirectoryRows = [];
  let recipientDirectorySelected = new Set();

  function normalizeDirectoryItems(result) {
    const candidates = [result && result.items, result && result.users, result && result.mailboxUsers, result && result.recipients, result && result.data && result.data.items, result && result.data && result.data.users];
    const list = candidates.find(Array.isArray) || [];
    const seen = new Set();
    return list.map(x => ({
      name: String(x.name || x.fullName || x.full_name || x.Name || x.displayName || '').trim(),
      email: String(x.email || x.emailAddress || x.mailId || x.mailID || x.Email || x['Mail ID'] || x.mail || '').trim(),
      designation: String(x.designation || x.Designation || x.title || x.jobTitle || '').trim(),
      department: String(x.department || x.Department || x.role || x.Role || '').trim()
    })).filter(x => { if (!validEmail(x.email)) return false; const k=x.email.toLowerCase(); if(seen.has(k)) return false; seen.add(k); return true; }).sort((a,b)=>(a.name||a.email).localeCompare(b.name||b.email));
  }

  async function fetchRecipientDirectory() {
    if (recipientDirectoryCache) return recipientDirectoryCache;
    let lastError = null;
    try { const r=await MailboxAPI.request('listMailboxUsers',{}); const items=normalizeDirectoryItems(r); if(items.length)return recipientDirectoryCache=items; } catch(e) { lastError=e; }
    try { const r=await MailboxAPI.bootstrap(); const items=normalizeDirectoryItems(r); if(items.length)return recipientDirectoryCache=items; } catch(e) { lastError=e; }
    try { const r=await MailboxAPI.suggestRecipients('@'); const items=normalizeDirectoryItems(r); if(items.length)return recipientDirectoryCache=items; } catch(e) { lastError=e; }
    throw new Error(lastError && lastError.message ? lastError.message : 'The mailbox user directory was not returned by the server.');
  }

  function renderRecipientDirectory() {
    const q=$('recipientDirectorySearch').value.trim().toLowerCase();
    const filtered=recipientDirectoryRows.filter(x=>[x.name,x.email,x.designation,x.department].join(' ').toLowerCase().includes(q));
    $('recipientDirectoryCount').textContent=`${filtered.length} user${filtered.length===1?'':'s'}`;
    $('recipientDirectoryList').innerHTML=filtered.length?filtered.map(x=>{const key=x.email.toLowerCase();return `<label class="recipient-directory-row"><input type="checkbox" data-directory-email="${escAttr(key)}" ${recipientDirectorySelected.has(key)?'checked':''}><span class="recipient-directory-person"><span class="recipient-directory-name">${esc(x.name||x.email)}</span><span class="recipient-directory-meta">${esc(x.email)}${x.designation?' · '+esc(x.designation):''}${x.department?' · '+esc(x.department):''}</span></span></label>`}).join(''):'<div class="recipient-directory-empty">No matching Mail ID Details found.</div>';
    const selectedFiltered=filtered.filter(x=>recipientDirectorySelected.has(x.email.toLowerCase())).length;
    $('recipientDirectorySelectAll').checked=filtered.length>0&&selectedFiltered===filtered.length;
    $('recipientDirectorySelectAll').indeterminate=selectedFiltered>0&&selectedFiltered<filtered.length;
    $('recipientDirectorySelected').textContent=`${recipientDirectorySelected.size} selected`;
    $('recipientDirectoryList').querySelectorAll('[data-directory-email]').forEach(cb=>cb.addEventListener('change',()=>{const key=cb.dataset.directoryEmail;if(cb.checked)recipientDirectorySelected.add(key);else recipientDirectorySelected.delete(key);renderRecipientDirectory()}));
  }

  async function openRecipientDirectory(state,field) {
    recipientDirectoryState=state;recipientDirectoryTarget=field;recipientDirectorySelected=new Set();$('recipientDirectorySearch').value='';
    $('recipientDirectoryModal').classList.add('show');$('recipientDirectoryModal').setAttribute('aria-hidden','false');$('recipientDirectoryList').innerHTML='<div class="recipient-directory-loading">Loading Mail ID Details…</div>';$('recipientDirectoryCount').textContent='Loading…';$('recipientDirectorySelected').textContent='0 selected';
    try { recipientDirectoryRows=await fetchRecipientDirectory();renderRecipientDirectory(); }
    catch(err) {$('recipientDirectoryList').innerHTML=`<div class="recipient-directory-empty">Unable to load Mail ID Details.<br>${esc(err.message||'Please check the mailbox Apps Script backend.')}</div>`;$('recipientDirectoryCount').textContent='Unavailable'}
  }
  function closeRecipientDirectory() {$('recipientDirectoryModal').classList.remove('show');$('recipientDirectoryModal').setAttribute('aria-hidden','true');recipientDirectoryState=null;recipientDirectoryTarget=null;}
  $('recipientDirectoryClose').addEventListener('click',closeRecipientDirectory);
  $('recipientDirectoryCancel').addEventListener('click',closeRecipientDirectory);
  $('recipientDirectoryModal').addEventListener('click',e=>{if(e.target===$('recipientDirectoryModal'))closeRecipientDirectory()});
  $('recipientDirectorySearch').addEventListener('input',renderRecipientDirectory);
  $('recipientDirectorySelectAll').addEventListener('change',()=>{const q=$('recipientDirectorySearch').value.trim().toLowerCase();recipientDirectoryRows.filter(x=>[x.name,x.email,x.designation,x.department].join(' ').toLowerCase().includes(q)).forEach(x=>{const key=x.email.toLowerCase();if($('recipientDirectorySelectAll').checked)recipientDirectorySelected.add(key);else recipientDirectorySelected.delete(key)});renderRecipientDirectory()});
  $('recipientDirectoryInsert').addEventListener('click',()=>{if(!recipientDirectoryState||!recipientDirectoryTarget){closeRecipientDirectory();return}const state=recipientDirectoryState,field=recipientDirectoryTarget;const chosen=recipientDirectoryRows.filter(x=>recipientDirectorySelected.has(x.email.toLowerCase()));chosen.forEach(x=>addRecipient(state,field,x.email));state.dirty=state.dirty||chosen.length>0;state.el.querySelector(`[data-field="${field}"]`).focus();closeRecipientDirectory();if(chosen.length)showAlert(`${chosen.length} recipient${chosen.length===1?'':'s'} inserted into ${field.toUpperCase()}.`,'success',1800)});

  function syncTabLabel(state) {
    const el = state.el;
    const title = el.querySelector('[data-role="title"]').textContent;
    const subject = el.querySelector('[data-field="subject"]').value.trim();
    const label = title === 'Reply message' ? 'Reply: ' + (subject || 'message') : title === 'Reply all message' ? 'Reply all: ' + (subject || 'message') : title === 'Forward message' ? 'Forward: ' + (subject || 'message') : 'New message';
    state.tab.querySelector('.compose-tab-label').textContent = label;
  }

  function activateComposer(id) {
    const state = composers.get(id);
    if (!state) return;
    composers.forEach(s => { s.el.style.display = 'none'; s.tab.classList.remove('active'); });
    state.el.style.display = 'flex';
    state.tab.classList.add('active');
    activeId = id;
    switchView('compose');
  }

  function deactivateAll() { composers.forEach(s => { s.el.style.display = 'none'; s.tab.classList.remove('active'); }); activeId = null; }
  function activateCurrent() { if (activeId && composers.has(activeId)) activateComposer(activeId); else if (composers.size > 0) activateComposer(composers.keys().next().value); else switchView('folders'); }

  async function requestCloseComposer(id) {
    const state = composers.get(id);
    if (!state) return;
    if (state.sending) {
      showAlert('Please wait — the message is currently sending.', 'warning');
      return;
    }
    const hasContent = isComposerDirty(state);
    if (!hasContent) { closeComposer(id); return; }
    const saveFirst = await showConfirm({
      title: 'Save draft before closing?',
      message: 'This message has unsaved changes. Save it as a draft before closing the composer?',
      confirmText: 'Save draft',
      cancelText: 'Discard',
      variant: 'warn'
    });
    if (saveFirst) { await saveDraftComposer(state, { closeAfter: true }); return; }
    const discard = await showConfirm({
      title: 'Discard unsaved message?',
      message: 'The unsaved changes will be lost permanently.',
      confirmText: 'Discard message',
      cancelText: 'Keep editing',
      variant: 'danger'
    });
    if (discard) closeComposer(id);
  }

  function isComposerDirty(state) {
    const el = state.el;
    const to = recipientValue(state, 'to');
    const cc = recipientValue(state, 'cc');
    const bcc = recipientValue(state, 'bcc');
    const subject = el.querySelector('[data-field="subject"]').value.trim();
    const bodyHtml = el.querySelector('[data-field="body"]').innerHTML.trim();
    const bodyText = bodyHtml.replace(/<br\s*\/?>/gi, '').replace(/<[^>]+>/g, '').trim();
    if (to || cc || bcc || subject || bodyText) return true;
    if (state.attachmentFiles.length) return true;
    return false;
  }

  async function requestDiscardComposer(state) {
    if (state.sending) return;
    const confirmed = await showConfirm({
      title: 'Discard this message?',
      message: 'Your draft will be permanently removed and cannot be recovered.',
      confirmText: 'Discard',
      cancelText: 'Cancel',
      variant: 'danger'
    });
    if (confirmed) closeComposer(state.id);
  }

  function closeComposer(id, reason = 'cancel') {
    const state = composers.get(id);
    if (!state || state.sending) return;
    state.el.remove(); state.tab.remove(); composers.delete(id);
    if (activeId === id) {
      activeId = null;
      if (composers.size > 0) activateComposer(composers.keys().next().value);
      else switchView('folders');
    }
    if(reason==='cancel' && state.mode==='new') showAlert('New message composition cancelled.', 'info', 2400);
  }

  function removeAll() { composers.forEach(s => { s.el.remove(); s.tab.remove(); }); composers.clear(); activeId = null; }
  function prepareForwardAttachments(state, items) {
    const statusEl = state.el.querySelector('[data-role="status"]');
    statusEl.textContent = 'Preparing original attachments…';
    (async () => {
      for (const item of items) { try { const file = await attachmentToFile(item); state.attachmentFiles.push(file); renderFiles(state); } catch (e) { console.warn('Forward attachment failed', e); } }
      statusEl.textContent = state.attachmentFiles.length ? `${state.attachmentFiles.length} original attachment(s) prepared.` : 'Original attachments could not be copied automatically.';
    })();
  }

  async function attachmentToFile(item) {
    if (item.base64 || item.data) { const b = atob(item.base64 || item.data); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new File([u], item.fileName || item.name || 'attachment', { type: item.mimeType || item.type || 'application/octet-stream' }); }
    const url = item.url || item.downloadUrl || item.fileUrl;
    if (!url) throw new Error('Attachment URL is missing.');
    const r = await fetch(url, { credentials: 'omit' });
    if (!r.ok) throw new Error('Unable to download attachment.');
    const blob = await r.blob();
    return new File([blob], item.fileName || item.name || 'attachment', { type: item.mimeType || blob.type || 'application/octet-stream' });
  }

  function renderFiles(state) {
    const c = state.el.querySelector('[data-role="files"]');
    c.innerHTML = state.attachmentFiles.map((f, i) => `<div class="file-chip"><span><i class="bi bi-paperclip"></i> ${esc(f.name)} · ${esc(formatSize(f.size))}</span><button type="button" data-remove-file="${i}">×</button></div>`).join('');
    c.querySelectorAll('[data-remove-file]').forEach(b => { b.addEventListener('click', () => { state.attachmentFiles.splice(Number(b.dataset.removeFile), 1); renderFiles(state); }); });
  }

  function readFiles(state) {
    return Promise.all(state.attachmentFiles.map(file => new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve({ name: file.name, size: file.size, mimeType: file.type, base64: String(r.result || '').split(',')[1] || '' });
      r.onerror = reject;
      r.readAsDataURL(file);
    })));
  }

  function setSendingState(state, isSending) {
    state.sending = isSending;
    state.el.querySelectorAll('input, textarea, button, [contenteditable]').forEach(el => el.disabled = isSending);
    const sendBtn = state.el.querySelector('[data-action="send"]');
    const sendIcon = sendBtn.querySelector('.send-pending-icon');
    sendBtn.classList.toggle('loading', isSending);
    sendBtn.classList.toggle('is-sending', isSending);
    sendBtn.disabled = isSending;
    if (sendIcon) {
      sendIcon.className = 'bi ' + (isSending ? 'bi-hourglass-split' : 'bi-send') + ' send-pending-icon';
      sendIcon.setAttribute('aria-label', isSending ? 'Sending' : 'Send');
    }
    const label = sendBtn.querySelector('.send-label');
    if (label) label.textContent = isSending ? 'Sending…' : 'Send';
  }

  async function sendComposer(state) {
    if (state.sending) return;
    const el = state.el;
    el.querySelector('[data-role="alert"]').classList.add('hidden');
    const to = recipientValue(state, 'to');
    const cc = recipientValue(state, 'cc');
    const bcc = recipientValue(state, 'bcc');
    if (!to) { showAlert('Please enter at least one recipient.', 'warning'); el.querySelector('[data-field="to"]').focus(); return; }
    const subject = el.querySelector('[data-field="subject"]').value.trim();
    if (!subject) {
      const ok = await showConfirm({
        title: 'Send without a subject?',
        message: 'Your message has no subject line. You can still send it, but adding a subject is recommended.',
        confirmText: 'Send anyway',
        cancelText: 'Add subject',
        variant: 'warn'
      });
      if (!ok) { el.querySelector('[data-field="subject"]').focus(); return; }
    }
    try {
      setSendingState(state, true);
      el.querySelector('[data-role="status"]').textContent = 'Preparing message…';
      const attachments = await readFiles(state);
      el.querySelector('[data-role="status"]').textContent = 'Sending message…';
      const original = state.originalMessage || null;
      const result = await MailboxAPI.send({
        to, cc, bcc, subject,
        body: el.querySelector('[data-field="body"]').innerHTML,
        bodyType: 'HTML',
        attachments,
        threadId: ['reply','replyAll'].includes(state.mode) && original ? (original.threadId || '') : '',
        parentMessageId: ['reply','replyAll'].includes(state.mode) && original ? (original.messageId || '') : '',
        replyTo: ['reply','replyAll'].includes(state.mode) && original ? (original.senderEmail || '') : '',
        forwardedFrom: state.mode === 'forward' && original ? (original.messageId || '') : ''
      });
      setSendingState(state, false);
      if (state.draftMailId) { MailboxAPI.update({mailId:state.draftMailId,Folder:'TRASH',Is_Deleted:'YES'}).catch(()=>{}); invalidateFolderCache('DRAFT'); }
      closeComposer(state.id, 'sent');
      $('successReference').textContent = 'Reference: ' + (result.referenceNo || '—');
      $('successModal').classList.add('show');
      invalidateFolderCache('SENT'); invalidateFolderCache('INBOX');
      await load(1);
    } catch (err) { setSendingState(state, false); showAlert(err.message || 'Unable to send message.', 'error'); el.querySelector('[data-role="status"]').textContent = ''; }
  }

  async function saveDraftComposer(state, options = {}) {
    if (state.sending) return;
    const el = state.el;
    try {
      setSendingState(state, true);
      const original = state.originalMessage || null;
      const result = await MailboxAPI.draft({
        ...(state.draftMailId ? {mailId: state.draftMailId} : {}),
        to: recipientValue(state, 'to'),
        cc: recipientValue(state, 'cc'),
        bcc: recipientValue(state, 'bcc'),
        subject: el.querySelector('[data-field="subject"]').value,
        body: el.querySelector('[data-field="body"]').innerHTML,
        bodyType: 'HTML',
        threadId: ['reply','replyAll'].includes(state.mode) && original ? (original.threadId || '') : '',
        parentMessageId: ['reply','replyAll'].includes(state.mode) && original ? (original.messageId || '') : '',
        replyTo: ['reply','replyAll'].includes(state.mode) && original ? (original.senderEmail || '') : '',
        forwardedFrom: state.mode === 'forward' && original ? (original.messageId || '') : ''
      });
      setSendingState(state, false);
      if (result.mailId || result.id) state.draftMailId = result.mailId || result.id;
      el.querySelector('[data-role="status"]').textContent = 'Draft saved' + (result.referenceNo ? ' · ' + result.referenceNo : '');
      invalidateFolderCache('DRAFT'); folderViews.delete('DRAFT');
      if (currentFolder === 'DRAFT') load(1,{silent:true}).catch(()=>{});
      if (options.closeAfter) { closeComposer(state.id, 'saved'); showAlert('Draft saved. Composer closed.', 'success', 2500); }
      else { showAlert('Draft saved.', 'success', 1800); }
    } catch (err) { setSendingState(state, false); showAlert(err.message || 'Unable to save draft.', 'error'); }
  }

  function replySubject(s) { return /^re:/i.test(String(s || '')) ? String(s) : 'Re: ' + String(s || '(No subject)'); }
  function forwardSubject(s) { return /^fwd:/i.test(String(s || '')) ? String(s) : 'Fwd: ' + String(s || '(No subject)'); }
  function createForwarded(m) { return `\n\n---------- Forwarded message ----------\nFrom: ${m.senderName || ''} <${m.senderEmail || ''}>\nDate: ${m.date || ''}\nSubject: ${m.subject || '(No subject)'}\nTo: ${m.to || ''}${m.cc ? '\nCc: ' + m.cc : ''}\n\n${String(m.body || '')}`; }

  return { createComposer, closeComposer, activateComposer, activateCurrent, deactivateAll, removeAll, getActiveId: () => activeId, hasComposers: () => composers.size > 0 };
})();

/* =========================================================
   MAILBOX LOADING
   ========================================================= */
function cacheKey(folder=currentFolder,page=1){return `${folder}|${$('searchInput').value.trim().toLowerCase()}|${page}|${pageSize}|${currentSort}`}

function applyMailboxData(data){
 currentMessages=sortMessages(data.messages);
 currentPage=data.page||1;
 totalPages=data.totalPages||1;
 selectedIds.clear();
 renderList();updatePager(data);updateToolbar();
 folderViews.set(currentFolder,{html:$('mailList').innerHTML,scrollTop:$('mailList').scrollTop,messages:currentMessages,page:currentPage,totalPages:totalPages});
 if(currentFolder==='INBOX'){
   const unread = currentMessages.filter(m=>!m.isRead).length;
   showInboxCount(unread);
   const currentIds = new Set(currentMessages.map(m => m.mailId));
   let hasNew = false;
   if (lastMailIds.size > 0) {
     for (const id of currentIds) { if (!lastMailIds.has(id)) { hasNew = true; break; } }
   }
   if (hasNew) {
     playNotificationTune();
     showAlert('New mail received!', 'info', 4000);
   }
   lastMailIds = currentIds;
   lastInboxCount = unread;
 }
}

function renderListLoading(){ $('mailList').innerHTML='<div class="list-loading"><span class="panel-spinner" aria-label="Loading"></span> Loading messages…</div>'; }

async function load(page=1,opts={}){
 const seq=++loadSequence;
 const key=cacheKey(currentFolder,page);
 const cached=folderCache.get(key);
 const fresh=cached && (Date.now()-cached.time<CACHE_TTL);
 if(cached){ applyMailboxData(cached.data); if(fresh && opts.cacheOnly)return; }
 loading=true;
 if(!cached && !opts.silent)renderListLoading();
 try{
  const data=await MailboxAPI.list(currentFolder,$('searchInput').value.trim(),page,pageSize,currentSort);
  if(seq!==loadSequence)return;
  folderCache.set(key,{data,time:Date.now()});
  const changed = signature(data.messages||[]) !== signature(currentMessages) || Number(data.total||0)!==Number(currentMessages.length);
  if(changed || !cached) {
    const scrollTop=$('mailList').scrollTop;
    applyMailboxData(data);
    if(cached && opts.silent) requestAnimationFrame(()=>{$('mailList').scrollTop=scrollTop});
  }
 }catch(err){
  if(seq!==loadSequence)return;
  if(/session|login|revoked|inactive/i.test(err.message||'')){MailboxAPI.clearSession();location.href='login.html';return}
  if(!cached) $('mailList').innerHTML='<div class="empty"><div class="empty-title">Unable to load mailbox</div><div class="empty-text">'+esc(err.message||'Request failed.')+'</div></div>';
 }finally{if(seq===loadSequence)loading=false}
}

function showInboxCount(n){const b=$('inboxCount');if(n>0){b.textContent=n;b.classList.remove('hidden')}else b.classList.add('hidden')}

function sentStatusMarkup(m){
  // A row in SENT is displayed only after the backend has saved the message.
  // No recipient read/delivery receipt is requested or inferred.
  return '<span class="mail-status is-delivered" title="Sent" aria-label="Sent"><i class="bi bi-check-circle"></i></span>';
}


function mailDateParts(value){
 const ms=parseMailDate(value);
 if(!ms)return null;
 const d=new Date(ms);
 return Number.isNaN(d.getTime())?null:d;
}
function mailDateGroup(value){
 const d=mailDateParts(value);
 if(!d)return {key:'undated',label:'Date unavailable'};
 const now=new Date(), today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
 const day=new Date(d.getFullYear(),d.getMonth(),d.getDate());
 const diff=Math.floor((today-day)/86400000);
 if(diff===0)return {key:'today',label:'Today'};
 if(diff>0&&diff<=7)return {key:'last-week',label:'Last week'};
 if(d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth())return {key:'this-month',label:'This month'};
 const previousMonth=new Date(now.getFullYear(),now.getMonth()-1,1);
 if(d.getFullYear()===previousMonth.getFullYear()&&d.getMonth()===previousMonth.getMonth())
   return {key:'last-month',label:previousMonth.toLocaleDateString([], {month:'long',year:'numeric'})};
 const key=`month-${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
 return {key,label:d.toLocaleDateString([], {month:'long',year:'numeric'})};
}


function renderMailRow(m){
 const sent=currentFolder==='SENT';
 const status=sent?sentStatusMarkup(m):'';
 const sender=esc(m.senderName||m.senderEmail||m.to||'Unknown');
 const recipient=sent&&m.to?`<span class="mail-recipient">to ${esc(m.to)}</span>`:'';

 return `<div class="mail-row ${m.isRead?'':'unread'} ${m.mailId===selectedMailId?'selected':''}" data-id="${escAttr(m.mailId)}">
   <div class="mail-check">
     <input type="checkbox" data-select="${escAttr(m.mailId)}" ${selectedIds.has(m.mailId)?'checked':''}>
   </div>
   <div class="mail-main">
     <div class="mail-top">
       <div class="sender-line">
         <span class="sender">${sender}</span>${recipient}
       </div>
       <div class="date">${esc(formatDate(m.date))}</div>
     </div>
     <div class="subject-line">
       ${m.hasAttachment?'<span class="attachment-dot"><i class="bi bi-paperclip"></i></span>':''}
       <div class="subject">${esc(m.subject||'(No subject)')}</div>
       ${status}
     </div>
     <div class="preview">${esc(m.body||'')}</div>
   </div>
   <div class="mail-row-end">
     <button class="star ${m.isStarred?'active':''}" data-star="${escAttr(m.mailId)}" title="${m.isStarred?'Unstar':'Star'}">
       <i class="bi ${m.isStarred?'bi-star-fill':'bi-star'}"></i>
     </button>
     ${Number(m.conversationCount||1)>1?`<span class="conversation-count" title="${Number(m.conversationCount)} messages in this conversation">${Number(m.conversationCount)}</span>`:''}
   </div>
 </div>`;
}

function renderList(){
 if(!currentMessages.length){
   const folderName = folders[currentFolder] || currentFolder;
   $('mailList').innerHTML='<div class="empty"><div class="empty-title">No messages in '+esc(folderName)+'</div><div class="empty-text">This folder is empty. New messages will appear here.</div></div>';
   return;
 }
 // Group the currently loaded page without changing the server pagination or sort order.
 const groups=[];
 const groupMap=new Map();
 currentMessages.forEach(m=>{
   const g=mailDateGroup(m.date);
   if(!groupMap.has(g.key)){const bucket={...g,messages:[]};groupMap.set(g.key,bucket);groups.push(bucket);}
   groupMap.get(g.key).messages.push(m);
 });
 $('mailList').innerHTML=groups.map(g=>`
   <section class="mail-date-group" data-date-group="${escAttr(g.key)}">
     <div class="mail-date-group-title"><span>${esc(g.label)}</span><span class="mail-date-group-count">${g.messages.length}</span></div>
     <div class="mail-date-group-items">${g.messages.map(renderMailRow).join('')}</div>
   </section>`).join('');

}

// One set of delegated handlers serves every rendered row; no per-row listener churn.
$('mailList').addEventListener('change',e=>{
 const checkbox=e.target.closest('[data-select]');
 if(!checkbox)return;
 const id=checkbox.dataset.select;
 if(checkbox.checked)selectedIds.add(id);else selectedIds.delete(id);
 updateToolbar();
});
$('mailList').addEventListener('click',async e=>{
 const star=e.target.closest('[data-star]');
 if(star){
   e.stopPropagation();
   const id=star.dataset.star,m=currentMessages.find(x=>x.mailId===id);
   if(!m)return;
   const old=!!m.isStarred;m.isStarred=!old;renderList();
   try{
     await MailboxAPI.update({mailId:id,Is_Starred:m.isStarred?'YES':'NO'});
     invalidateFolderCache();folderViews.clear();threadCache.delete(String(id));
     if(currentFolder==='STARRED'&&!m.isStarred){currentMessages=currentMessages.filter(x=>x.mailId!==id);renderList()}
     else folderCache.delete(cacheKey(currentFolder,currentPage));
     showAlert(m.isStarred?'Mail starred.':'Mail unstarred.','success',2200);
   }catch(err){m.isStarred=old;renderList();showAlert(err.message||'Unable to update star.','error')}
   return;
 }
 const row=e.target.closest('.mail-row');
 if(!row||e.target.closest('input,button'))return;
 if(currentFolder==='DRAFT')openDraft(row.dataset.id);else openMessage(row.dataset.id);
});

function updatePager(data){const total=Number(data.total||0);const start=total?((currentPage-1)*pageSize+1):0;const end=Math.min(currentPage*pageSize,total);$('rangeText').textContent=total?`${start}-${end} of ${total}`:'0 messages';$('pageText').textContent=`${currentPage} / ${totalPages}`;$('prevPage').disabled=!data.hasPrevious;$('nextPage').disabled=!data.hasNext;$('pageSize').value=String(pageSize)}
function updateToolbar(){$('toolbar').classList.toggle('show',selectedIds.size>0)}
function invalidateFolderCache(folder=currentFolder){for(const k of [...folderCache.keys()])if(k.startsWith(folder+'|'))folderCache.delete(k)}

async function applySelected(changes){
 const ids=[...selectedIds];if(!ids.length)return;
 try{
   // Serialize writes to avoid bursts of simultaneous Apps Script executions.
   for(const mailId of ids) await MailboxAPI.update(Object.assign({mailId},changes));
   selectedIds.clear();invalidateFolderCache();folderViews.clear();threadCache.clear();
   if(changes.Folder || changes.Is_Deleted==='YES' || changes.Is_Spam==='YES') { currentMessages=currentMessages.filter(m=>!ids.includes(m.mailId));renderList(); } else { currentMessages.forEach(m=>{if(ids.includes(m.mailId)){if(changes.Is_Read!==undefined)m.isRead=changes.Is_Read==='YES';}});renderList(); }
   load(currentPage,{silent:true}).catch(()=>{});
   const target=changes.Folder==='ARCHIVE'?'Archive':changes.Folder==='SPAM'?'Spam':changes.Folder==='TRASH'?'Trash':'';
   const action=target?`${ids.length} message${ids.length===1?'':'s'} moved to ${target}.`:changes.Is_Read==='YES'?'Selected messages marked as read.':changes.Is_Read==='NO'?'Selected messages marked as unread.':'Selected messages updated.';
   showAlert(action,'success',2600);
 }catch(err){showAlert(err.message||'Unable to update messages.','error')}
}

function setThreadSubject(subject){
 const el=$('readSubject');
 const value=String(subject||'(No subject)');
 el.textContent=value;
 el.title=value;
 el.classList.remove('is-expanded');
 el.setAttribute('aria-label',value);
}
function paintReadHeader(m){
 setThreadSubject(m.subject);
 $('threadCount').textContent=threadMessages.length?`${threadMessages.length} message${threadMessages.length===1?'':'s'}`:'';
}

async function openMessage(id){
 const row=currentMessages.find(x=>x.mailId===id);if(!row)return;
 selectedMailId=id;selectedThreadMailId=id;selectedMessage=row;selectedAttachments=[];threadMessages=[];
 $('foldersWorkspace').classList.remove('reading-hidden');
 renderList();$('readEmpty').classList.add('hidden');$('readContent').classList.remove('hidden');$('readPane').classList.add('mobile-show');
 setThreadSubject(row.subject);$('threadCount').textContent='';
 $('threadMessages').innerHTML='<div class="loading-inline"><span class="panel-spinner" aria-label="Loading"></span></div>';
 if(!row.isRead){row.isRead=true;renderList();}
 const cached=threadCache.get(String(id));
 if(cached&&Date.now()-cached.time<threadCacheTTL){
   threadMessages=cached.messages;
   const chosen=threadMessages.find(x=>String(x.message&&x.message.mailId)===String(id))||threadMessages[threadMessages.length-1];
   if(chosen){selectedMessage=chosen.message;selectedAttachments=chosen.attachments||[];paintReadHeader(selectedMessage);renderThread();}
   // Refresh profile photos in parallel; never hold the conversation display for them.
   loadThreadProfileImages().then(()=>{if(selectedMailId===id)renderThread()});
   return;
 }
 try{
   // Start the optional photo lookup alongside the thread request, not after it.
   const photosPromise=loadThreadProfileImages();
   const result=await MailboxAPI.getThread(id);
   if(selectedMailId!==id)return;
   threadMessages=Array.isArray(result.messages)?result.messages:[];
   if(!threadMessages.length)throw new Error('No messages found in this conversation.');
   threadCache.set(String(id),{messages:threadMessages,time:Date.now()});
   const chosen=threadMessages.find(x=>String(x.message&&x.message.mailId)===String(id))||threadMessages[threadMessages.length-1];
   selectedMessage=chosen.message;selectedAttachments=chosen.attachments||[];
   paintReadHeader(selectedMessage);renderThread();
   photosPromise.then(()=>{if(selectedMailId===id)renderThread()});
 }catch(err){
   if(selectedMailId===id)$('threadMessages').innerHTML=`<div class="thread-empty">${esc(err.message||'Unable to load conversation.')}</div>`;
 }
}

// Profile photos for people in a conversation, indexed by their email address.
const threadProfileImageMap=new Map();
let threadProfileImageMapLoaded=false;
async function loadThreadProfileImages(){
 if(threadProfileImageMapLoaded)return;
 try{
   // Dedicated endpoint returns the Users-sheet photo URL for every active account.
   const result=await MailboxAPI.request('listThreadProfileImages',{token:MailboxAPI.token()});
   const candidates=[result&&result.users,result&&result.items,result&&result.data&&result.data.users,result&&result.data&&result.data.items];
   const users=candidates.find(Array.isArray)||[];
   users.forEach(u=>{
     const email=String(u.email||u.emailAddress||u.Email_Address||u.Email||u.mailId||'').trim().toLowerCase();
     const photo=String(u.profileImageUrl||u.Profile_Image_URL||u.profile_image_url||u.avatarUrl||u.photoUrl||'').trim();
     if(email&&photo)threadProfileImageMap.set(email,photo);
   });
   threadProfileImageMapLoaded=true;
 }catch(err){
   // Retry on the next thread refresh if the endpoint is temporarily unavailable.
   threadProfileImageMapLoaded=false;
   console.warn('Unable to load thread profile photos:',err);
 }
}

function threadAvatarMarkup(m){
 const senderEmail=String(m.senderEmail||m.sender_email||m.fromEmail||m.from||m.senderAddress||(m.sender&&(m.sender.email||m.sender.emailAddress||m.sender.Email_Address))||'').trim().toLowerCase();
 const directPhoto=m.senderProfileImageUrl||m.senderImageUrl||m.senderPhotoUrl||m.profileImageUrl||m.senderAvatarUrl||m.avatarUrl||m.photoUrl||m.Profile_Image_URL||(m.sender&&(m.sender.profileImageUrl||m.sender.Profile_Image_URL||m.sender.avatarUrl));
 const photo=String(directPhoto||threadProfileImageMap.get(senderEmail)||'').trim();
 const fallback=esc(initials(m.senderName||m.fromName||m.sender_name,senderEmail));
 return `<div class="thread-avatar${photo?' has-photo':''}"><span>${fallback}</span>${photo?`<img src="${escAttr(photo)}" alt="" loading="eager" referrerpolicy="no-referrer" onerror="this.style.display='none';this.parentElement.classList.remove('has-photo')">`:''}</div>`;
}

function renderThread(){
 const host=$('threadMessages');
 const ordered=threadMessages.slice().reverse();
 host.innerHTML=ordered.map((item,index)=>{
   const m=item.message||{},files=item.attachments||[],mid=escAttr(m.mailId||'');
   const expanded=index===0;
   const selected=String(m.mailId||'')===String(selectedThreadMailId||selectedMailId||'');
   const rawFolder=m.folder||m.Folder||m.folderName||m.mailFolder||currentFolder;
   const folderKey=String(rawFolder||'').toUpperCase();
   const folderLabel=folders[folderKey]||String(rawFolder||'');
   const recipients=[m.to?`To: ${esc(m.to)}`:'',m.cc?`Cc: ${esc(m.cc)}`:'',m.bcc?`Bcc: ${esc(m.bcc)}`:''].filter(Boolean).join(' · ');
   const body=String(m.bodyType||'').toUpperCase()==='HTML'?(m.body||''):`<div class="thread-plain-body">${esc(m.body||'')}</div>`;
   const attachments=files.map(a=>`<a class="attachment" href="${escAttr(a.url||'#')}" target="_blank" rel="noopener noreferrer" download><span><i class="bi bi-paperclip"></i></span><span title="${escAttr(a.fileName)}">${esc(a.fileName||'Attachment')}</span><small>${esc(formatSize(a.size))}</small></a>`).join('');
   return `<article class="thread-message ${expanded?'expanded':''} ${selected?'selected':''}" data-thread-mail="${mid}">
     <div class="thread-message-head" role="button" tabindex="0" aria-expanded="${expanded}" data-thread-toggle="${mid}">${threadAvatarMarkup(m)}<div class="thread-person"><div class="thread-person-name">${esc(m.senderName||m.senderEmail||'Unknown sender')}</div><div class="thread-person-email">${esc(m.senderEmail||'')}</div><div class="thread-recipient-line"><span class="thread-recipients">${recipients||'Recipients not available'}</span><span class="thread-folder"><i class="bi bi-folder2"></i> ${esc(folderLabel)}</span></div></div><time class="thread-date">${esc(formatDate(m.date)||m.date||'')}</time></div>
     <div class="thread-message-body">${body}</div>
     ${attachments?`<div class="thread-attachments">${attachments}</div>`:''}
     <div class="thread-message-actions">
       <button class="thread-action" data-thread-action="reply" data-mail="${mid}" title="Reply"><i class="bi bi-reply"></i> Reply</button>
       <button class="thread-action" data-thread-action="replyAll" data-mail="${mid}" title="Reply all"><i class="bi bi-reply-all"></i> Reply all</button>
       <button class="thread-action" data-thread-action="forward" data-mail="${mid}" title="Forward"><i class="bi bi-forward"></i> Forward</button>
       <button class="thread-action ${m.isStarred?'active':''}" data-thread-action="star" data-mail="${mid}" title="${m.isStarred?'Unstar':'Star'}"><i class="bi ${m.isStarred?'bi-star-fill':'bi-star'}"></i></button>
       <button class="thread-action" data-thread-action="read" data-mail="${mid}" title="Mark ${m.isRead?'unread':'read'}"><i class="bi ${m.isRead?'bi-envelope':'bi-envelope-open'}"></i> ${m.isRead?'Unread':'Read'}</button>
       <button class="thread-action" data-thread-action="archive" data-mail="${mid}" title="Archive"><i class="bi bi-archive"></i> Archive</button>
       <button class="thread-action" data-thread-action="spam" data-mail="${mid}" title="Report spam"><i class="bi bi-exclamation-octagon"></i> Spam</button>
       <button class="thread-action danger" data-thread-action="trash" data-mail="${mid}" title="Move to Trash"><i class="bi bi-trash3"></i></button>
     </div>
   </article>`;
 }).join('');
}

async function openDraft(id){
 const row=currentMessages.find(x=>String(x.mailId)===String(id));if(!row)return;
 try{
   showAlert('Opening draft…','info',900);
   const result=await MailboxAPI.get(id);
   const draft=result.message||result.data||result;
   const message=Object.assign({},row,draft,{mailId:id});
   ComposerManager.createComposer('draft',message,[]);
 }catch(err){showAlert(err.message||'Unable to open draft for editing.','error');}
}

async function refreshThread(){
 if(!selectedMailId)return;
 const id=selectedMailId;
 const result=await MailboxAPI.getThread(id);
 if(selectedMailId!==id)return;
 threadMessages=Array.isArray(result.messages)?result.messages:[];
 await loadThreadProfileImages();
 const chosen=threadMessages.find(x=>x.message.mailId===id)||threadMessages[threadMessages.length-1];
 if(!chosen){closeRead();return;}
 selectedMessage=chosen.message;selectedAttachments=chosen.attachments||[];paintReadHeader(selectedMessage);renderThread();
}

async function threadMessageAction(mailId,action){
 const item=threadMessages.find(x=>String(x.message.mailId)===String(mailId));if(!item)return;
 const m=item.message;
 if(action==='reply'||action==='replyAll'||action==='forward'){
   ComposerManager.createComposer(action,m,item.attachments||[]);return;
 }
 let changes={};
 if(action==='star')changes.Is_Starred=m.isStarred?'NO':'YES';
 else if(action==='read')changes.Is_Read=m.isRead?'NO':'YES';
 else if(action==='archive')changes={Folder:'ARCHIVE',Is_Archived:'YES',Is_Deleted:'NO',Is_Spam:'NO'};
 else if(action==='spam')changes={Folder:'SPAM',Is_Spam:'YES',Is_Deleted:'NO'};
 else if(action==='trash'){
   const ok=await showConfirm({title:'Move to Trash?',message:'This message will be moved to the Trash folder. You can restore it later.',confirmText:'Move to Trash',cancelText:'Cancel',variant:'danger'});
   if(!ok)return;changes={Folder:'TRASH',Is_Deleted:'YES'};
 }
 try{
   // Update the visible UI immediately; refresh the server-backed list in the background.
   if(action==='star') { m.isStarred=!m.isStarred; }
   if(action==='read') { m.isRead=!m.isRead; }
   if(['archive','spam','trash'].includes(action)) { threadMessages=threadMessages.filter(x=>String(x.message.mailId)!==String(mailId)); }
   if(action==='archive'||action==='spam'||action==='trash') { closeRead(); currentMessages=currentMessages.filter(x=>String(x.mailId)!==String(mailId));renderList(); }
   await MailboxAPI.update(Object.assign({mailId},changes));
   threadCache.delete(String(mailId));
   invalidateFolderCache();folderViews.clear();
   load(currentPage,{silent:true}).catch(()=>{});
   if(!['archive','spam','trash'].includes(action)) await refreshThread();
   const destination={archive:'Archive',spam:'Spam',trash:'Trash'}[action];
   showAlert(action==='star'?(m.isStarred?'Thread message starred.':'Thread message unstarred.'):action==='read'?'Thread message read status updated.':`Message moved to ${destination}.`, 'success', 2600);
 }catch(err){showAlert(err.message||'Unable to update message.','error');}
}

$('threadMessages').addEventListener('click',e=>{
 const action=e.target.closest('[data-thread-action]');if(action){threadMessageAction(action.dataset.mail,action.dataset.threadAction);return;}
 const head=e.target.closest('[data-thread-toggle]');if(head){const card=head.closest('.thread-message');selectedThreadMailId=String(card.dataset.threadMail||'');$('threadMessages').querySelectorAll('.thread-message').forEach(node=>node.classList.toggle('selected',node===card));const expanded=card.classList.toggle('expanded');head.setAttribute('aria-expanded',String(expanded));}
});
$('threadMessages').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-thread-toggle]')){e.preventDefault();const card=e.target.closest('.thread-message');selectedThreadMailId=String(card.dataset.threadMail||'');$('threadMessages').querySelectorAll('.thread-message').forEach(node=>node.classList.toggle('selected',node===card));const expanded=card.classList.toggle('expanded');e.target.setAttribute('aria-expanded',String(expanded));}});

function openThreadPopup(printAfterOpen=false){
 const subject=String(selectedMessage?.subject||$('readSubject').textContent||'(No subject)');
 const threadHtml=$('threadMessages').innerHTML;
 const popup=window.open('','mailbox-thread-'+Date.now(),'width=920,height=760,resizable=yes,scrollbars=yes');
 if(!popup){showAlert('Your browser blocked the thread window. Allow pop-ups for this site and try again.','warning');return;}
 const safeTitle=esc(subject);
 popup.document.open();
 popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css"><link rel="stylesheet" href="mailbox-common.css"><style>
 *{box-sizing:border-box}body{margin:0;padding:28px;background:#f3f6fa;color:#172033;font-family:Inter,Segoe UI,Arial,sans-serif}
 .print-shell{max-width:900px;margin:0 auto;background:#fff;padding:24px;border-radius:12px}
 h1{font-size:22px;margin:0 0 20px;padding-bottom:16px;border-bottom:1px solid #ddd;overflow-wrap:anywhere}
 .thread-messages{overflow:visible!important}.thread-message{break-inside:avoid;page-break-inside:avoid;margin-bottom:14px!important;border:1px solid #ddd!important;border-radius:8px!important}
 .thread-message-body{display:block!important}.thread-message-actions{display:none!important}
 .thread-message-head{break-inside:avoid}.thread-attachments a{color:#1457b8}
 @media print{body{padding:0;background:#fff}.print-shell{max-width:none;padding:0;border:0;border-radius:0}.thread-message{box-shadow:none!important}.thread-message-body{display:block!important}}
 </style></head><body><main class="print-shell"><h1>${safeTitle}</h1><section class="thread-messages">${threadHtml}</section></main></body></html>`);
 popup.document.close();
 if(printAfterOpen){
   popup.addEventListener('load',()=>{popup.focus();popup.print();},{once:true});
   setTimeout(()=>{try{popup.focus();popup.print()}catch(_){}},700);
 }
}

function closeRead(){selectedMailId='';selectedThreadMailId='';selectedMessage=null;selectedAttachments=[];threadMessages=[];$('readContent').classList.add('hidden');$('readEmpty').classList.remove('hidden');$('readPane').classList.remove('mobile-show');$('foldersWorkspace').classList.add('reading-hidden');renderList()}

/* =========================================================
   WIRE-UP
   ========================================================= */
$('composeBtn').addEventListener('click',()=>ComposerManager.createComposer('new'));
$('successOk').addEventListener('click',()=>{$('successModal').classList.remove('show');});
$('backBtn').addEventListener('click',closeRead);
$('closeReadBtn').addEventListener('click',closeRead);
$('openThreadWindowBtn').addEventListener('click',()=>openThreadPopup(false));
$('printThreadBtn').addEventListener('click',()=>openThreadPopup(true));

/* sort dropdown — sync with saved preference */
$('readSubject').addEventListener('click',()=>{$('readSubject').classList.toggle('is-expanded')});

$('sortSelect').value = currentSort;
$('sortSelect').addEventListener('change',()=>{
  currentSort = $('sortSelect').value;
  localStorage.setItem('mailbox_sort', currentSort);
  folderCache.clear();folderViews.clear();currentPage=1;
  load(1);
  const labels={'date-desc':'Newest first','date-asc':'Oldest first','sender-asc':'Sender A to Z','sender-desc':'Sender Z to A','subject-asc':'Subject A to Z','subject-desc':'Subject Z to A'};
  showAlert(`Mail list sorted: ${labels[currentSort]||currentSort}.`,'info',2200);
});

const prefetchTimers=new Map();
const prefetchPromises=new Map();
function prefetchFolder(folder){
 const key=cacheKey(folder,1);
 if(folderCache.has(key)||prefetchPromises.has(key)||folder===currentFolder)return;
 const promise=MailboxAPI.list(folder,'',1,pageSize,currentSort).then(data=>{folderCache.set(key,{data,time:Date.now()});return data}).catch(()=>null).finally(()=>prefetchPromises.delete(key));
 prefetchPromises.set(key,promise);
}
document.querySelectorAll('.folder').forEach(b=>{
 b.addEventListener('mouseenter',()=>{ const folder=b.dataset.folder; clearTimeout(prefetchTimers.get(folder)); prefetchTimers.set(folder,setTimeout(()=>prefetchFolder(folder),180)); });
 b.addEventListener('mouseleave',()=>clearTimeout(prefetchTimers.get(b.dataset.folder)));
 b.addEventListener('click',()=>{
   if(currentFolder===b.dataset.folder) { closeRead(); switchView('folders'); return; }
   folderViews.set(currentFolder,{html:$('mailList').innerHTML,scrollTop:$('mailList').scrollTop,messages:currentMessages,page:currentPage,totalPages:totalPages});
   currentFolder=b.dataset.folder;currentPage=1;selectedMailId='';selectedMessage=null;selectedAttachments=[];saveFolder();updateFolderUI();closeRead();
   const view=folderViews.get(currentFolder);const c=folderCache.get(cacheKey(currentFolder,1));
   if(!c && !view) { renderListLoading(); }
   else if(view&&view.messages){ currentMessages=sortMessages(view.messages);currentPage=view.page||1;totalPages=view.totalPages||1;renderList();updatePager({total:currentMessages.length,page:currentPage,totalPages:totalPages,hasPrevious:currentPage>1,hasNext:currentPage<totalPages});requestAnimationFrame(()=>{$('mailList').scrollTop=view.scrollTop||0}); }
   else if(c)applyMailboxData(c.data);
   load(1,{silent:true});
   switchView('folders');
 });
});
$('prevPage').addEventListener('click',()=>load(Math.max(1,currentPage-1)));$('nextPage').addEventListener('click',()=>load(Math.min(totalPages,currentPage+1)));$('pageSize').addEventListener('change',()=>{pageSize=Number($('pageSize').value)||25;load(1)});
$('selectAllBtn').addEventListener('click',()=>{const all=currentMessages.length&&selectedIds.size===currentMessages.length;if(all)selectedIds.clear();else currentMessages.forEach(m=>selectedIds.add(m.mailId));renderList();updateToolbar()});
$('markReadBtn').addEventListener('click',()=>applySelected({Is_Read:'YES'}));$('markUnreadBtn').addEventListener('click',()=>applySelected({Is_Read:'NO'}));$('archiveBtn').addEventListener('click',()=>applySelected({Folder:'ARCHIVE',Is_Archived:'YES'}));$('spamBtn').addEventListener('click',()=>applySelected({Folder:'SPAM',Is_Spam:'YES'}));$('deleteBtn').addEventListener('click',async()=>{
  const ok = await showConfirm({
    title: 'Move selected to Trash?',
    message: selectedIds.size + ' message(s) will be moved to the Trash folder.',
    confirmText: 'Move to Trash',
    cancelText: 'Cancel',
    variant: 'danger'
  });
  if (ok) applySelected({Folder:'TRASH',Is_Deleted:'YES'});
});
$('refreshBtn').addEventListener('click',()=>load(currentPage).then(()=>showAlert('Mailbox refreshed.','success',1800)));
$('refreshListBtn').addEventListener('click',()=>load(currentPage).then(()=>showAlert('Mail list refreshed.','success',1800)));
function runSearch(){clearTimeout(searchTimer);searchTimer=setTimeout(()=>load(1),260);$('clearSearch').style.display=$('searchInput').value?'block':'none'}
$('searchInput').addEventListener('input',runSearch);$('searchInput').addEventListener('keydown',e=>{if(e.key==='Escape'){$('searchInput').value='';runSearch()}});$('clearSearch').addEventListener('click',()=>{$('searchInput').value='';runSearch();$('searchInput').focus()});
$('logoutBtn').addEventListener('click',async()=>{
  const ok = await showConfirm({
    title: 'Log out?',
    message: 'You will be signed out of your mailbox. Any unsent drafts will be lost.',
    confirmText: 'Log out',
    cancelText: 'Stay signed in',
    variant: 'warn'
  });
  if (!ok) return;
  try{await MailboxAPI.logout()}catch(_){}
  MailboxAPI.clearSession();location.href='login.html';
});

$('foldersTab').addEventListener('click',()=>switchView('folders'));

document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    if($('confirmOverlay').classList.contains('show')) { closeConfirm(false); return; }
    if($('successModal').classList.contains('show')) $('successModal').classList.remove('show');
    else if(activeView==='compose') { const activeId = ComposerManager.getActiveId(); if (activeId) ComposerManager.requestCloseComposer ? ComposerManager.requestCloseComposer(activeId) : ComposerManager.closeComposer(activeId); }
    else if($('readPane').classList.contains('mobile-show')) closeRead();
  }
});

document.addEventListener('visibilitychange',()=>{if(!document.hidden)load(currentPage,{silent:true})});

/* =========================================================
   SILENT REFRESH — every 30 seconds
   ========================================================= */
async function silentRefresh(){
  if(document.hidden){silentTimer=setTimeout(silentRefresh,30000);return}
  try{
    const key=cacheKey(currentFolder,currentPage);
    const data=await MailboxAPI.list(currentFolder,$('searchInput').value.trim(),currentPage,pageSize,currentSort);
    folderCache.set(key,{data,time:Date.now()});
    const sig=signature(data.messages||[]);
    if(sig!==signature(currentMessages)){
      currentMessages=sortMessages(data.messages);
      currentPage=data.page||currentPage;
      totalPages=data.totalPages||1;
      renderList();
      updatePager(data);
      if(currentFolder==='INBOX'){
        const unread = currentMessages.filter(m=>!m.isRead).length;
        showInboxCount(unread);
        const currentIds = new Set(currentMessages.map(m => m.mailId));
        let hasNew = false;
        if (lastMailIds.size > 0) {
          for (const id of currentIds) { if (!lastMailIds.has(id)) { hasNew = true; break; } }
        }
        if (hasNew) {
          playNotificationTune();
          showAlert('New mail received!', 'info', 4000);
        }
        lastMailIds = currentIds;
        lastInboxCount = unread;
      }
    }
  }catch(_){}
  finally{silentTimer=setTimeout(silentRefresh,30000)}
}
function startSilent(){clearTimeout(silentTimer);silentTimer=setTimeout(silentRefresh,30000)}

function initSplitter(){
 const handle=$('paneSplitter'),main=document.querySelector('.main'),mailArea=document.querySelector('.mail-area');
 if(!handle||!main||!mailArea)return;
 const saved=parseInt(localStorage.getItem('mailbox_list_width')||'',10);
 const applyWidth=w=>{const min=320,max=Math.min(main.getBoundingClientRect().width*.75,900);const width=Math.max(min,Math.min(max,w));mailArea.style.width=width+'px';mailArea.style.flexBasis=width+'px';};
 if(saved>=320)applyWidth(saved);
 const move=e=>{if(!splitterDragging)return;const rect=main.getBoundingClientRect();const side=document.querySelector('.sidebar').getBoundingClientRect();applyWidth(e.clientX-side.right);e.preventDefault()};
 const stop=()=>{if(!splitterDragging)return;splitterDragging=false;handle.classList.remove('dragging');document.body.style.cursor='';document.body.style.userSelect='';localStorage.setItem('mailbox_list_width',Math.round(mailArea.getBoundingClientRect().width));window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop);};
 handle.addEventListener('pointerdown',e=>{if(window.matchMedia('(max-width:760px)').matches)return;splitterDragging=true;handle.classList.add('dragging');document.body.style.cursor='col-resize';document.body.style.userSelect='none';window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',stop,{once:false});e.preventDefault();});
}
window.addEventListener('resize',()=>{if(window.matchMedia('(max-width:760px)').matches){document.querySelector('.mail-area').style.width=''}else{const w=parseInt(localStorage.getItem('mailbox_list_width')||'',10);if(w)document.querySelector('.mail-area').style.width=w+'px';document.querySelector('.mail-area').style.flexBasis=w+'px'}});

initNotificationAudio();
initSplitter();
updateFolderUI();
switchView('folders');
load(1).finally(()=>startSilent());
})();
