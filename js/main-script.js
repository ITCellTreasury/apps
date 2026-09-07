// Google Sheets configuration
const SPREADSHEET_ID = '1jd1xZe9x2mrZm5KAwGT12vMNYjbrnynsmelNKeK95jc';
const API_KEY = 'AIzaSyBB1V3vJpNZ9X1GIF-YOwoa6YSt_iXMLo0';
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxYAM6iuUmr0Sr72N6s7XClG05gOV8mwINpc5f-Ju5ZrmbBD_CZfjfaQeOy3ZoVUX1_/exec';
const MENU_SHEET = 'Menu';
const ICON_SHEET = 'icons';
const LOGIN_SHEET = 'Login';
const FLASH_SHEET = 'scroll texts';
const MENU_RANGE = 'A:D';
const ICON_RANGE = 'A:F';
const LOGIN_RANGE = 'B:D';
const FLASH_RANGE = 'A:A';

// Add cache-busting timestamp to all API calls
const CACHE_BUST = Date.now();

// Chat configuration for notification system
const CHAT_SPREADSHEET_ID = "1fkiFo1i60NxA_ujl1GhPmNnSLKI6seb3YiMVhPxZjgM";
const CHAT_SHEET_NAME = "Chats";
const CHAT_API_KEY = "AIzaSyBAuS3Brpsw5JOJnjNJii1UlFa7ClXf8d4";

let menuData = [];
let iconData = new Map();
let isAuthenticated = false;
let currentUser = null;
let flashNewsInterval = null;
let unreadCheckInterval = null;
let lastUnreadCount = 0;
let notificationSound = null;
let soundEnabled = true;
let audioContext = null;
let userInteracted = false;

// Make variables globally accessible
window.isAuthenticated = false;
window.currentUser = null;

// ======================== NOTIFICATION SOUND FUNCTIONS ========================
function initNotificationSound() {
    try {
        notificationSound = new Audio('./sweet.mp3');
        notificationSound.volume = 0.5;
        notificationSound.load();
        console.log("Notification sound loaded from ./sweet.mp3");
        
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            console.log("Web Audio API context created (suspended)");
        }
    } catch(e) {
        console.log("Audio not supported or file not found:", e);
        notificationSound = null;
    }
}

function enableAudioOnUserInteraction() {
    if (userInteracted) return;
    userInteracted = true;
    
    console.log("User interaction detected - enabling audio");
    
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().then(() => {
            console.log("AudioContext resumed successfully");
        }).catch(e => {
            console.log("Failed to resume AudioContext:", e);
        });
    }
    
    if (notificationSound) {
        try {
            notificationSound.volume = 0;
            notificationSound.play().then(() => {
                notificationSound.pause();
                notificationSound.currentTime = 0;
                notificationSound.volume = 0.5;
                console.log("Audio unlocked via silent playback");
            }).catch(e => {
                console.log("Silent playback failed:", e);
            });
        } catch(e) {
            console.log("Error unlocking audio:", e);
        }
    }
}

function setupUserInteractionListener() {
    const events = ['click', 'touchstart', 'keydown', 'mousedown'];
    const handler = function() {
        enableAudioOnUserInteraction();
        events.forEach(event => {
            document.removeEventListener(event, handler);
        });
    };
    
    events.forEach(event => {
        document.addEventListener(event, handler);
    });
}

function playNotificationSound() {
    if (!soundEnabled) {
        console.log("Sound disabled by user");
        return;
    }
    
    if (notificationSound) {
        try {
            notificationSound.currentTime = 0;
            const playPromise = notificationSound.play();
            
            if (playPromise !== undefined) {
                playPromise.then(() => {
                    console.log("Notification sound played successfully");
                }).catch(error => {
                    console.log("Audio play failed:", error.message);
                    playFallbackBeep();
                });
            }
        } catch(e) {
            console.log("Sound play error:", e);
            playFallbackBeep();
        }
    } else {
        playFallbackBeep();
    }
}

function playFallbackBeep() {
    if (!userInteracted && (!audioContext || audioContext.state !== 'running')) {
        console.log("Waiting for user interaction before playing beep");
        return;
    }
    
    try {
        let ctx = audioContext;
        if (!ctx) {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
            audioContext = ctx;
        }
        
        if (ctx.state === 'suspended') {
            ctx.resume().then(() => {
                playBeepWithContext(ctx);
            }).catch(e => console.log("Cannot resume AudioContext:", e));
        } else if (ctx.state === 'running') {
            playBeepWithContext(ctx);
        } else {
            const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
            tempCtx.resume().then(() => {
                playBeepWithContext(tempCtx);
                setTimeout(() => tempCtx.close(), 500);
            }).catch(e => console.log("Cannot create temp context:", e));
        }
    } catch(e) {
        console.log("Fallback beep failed:", e);
    }
}

function playBeepWithContext(ctx) {
    try {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);
        oscillator.frequency.value = 880;
        gainNode.gain.value = 0.15;
        oscillator.start();
        gainNode.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.4);
        oscillator.stop(ctx.currentTime + 0.4);
        console.log("Fallback beep played");
    } catch(e) {
        console.log("Beep playback failed:", e);
    }
}

function toggleNotificationSound() {
    soundEnabled = !soundEnabled;
    localStorage.setItem('notificationSoundEnabled', soundEnabled);
    console.log("Notification sound:", soundEnabled ? "Enabled" : "Disabled");
    
    const soundIcon = document.getElementById('notificationSoundIcon');
    if (soundIcon) {
        soundIcon.innerHTML = soundEnabled ? '<i class="bi bi-volume-up-fill"></i>' : '<i class="bi bi-volume-mute-fill"></i>';
    }
    
    return soundEnabled;
}

const savedSoundPref = localStorage.getItem('notificationSoundEnabled');
if (savedSoundPref !== null) {
    soundEnabled = savedSoundPref === 'true';
}

// ======================== UPDATE LOGIN TIMESTAMP ========================
function updateLoginTimestamp(username) {
    return new Promise((resolve) => {
        try {
            const timestamp = new Date().toISOString();
            const callbackName = 'cb_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
            
            const script = document.createElement('script');
            const url = `${WEB_APP_URL}?action=updateLoginTime&username=${encodeURIComponent(username)}&timestamp=${encodeURIComponent(timestamp)}&callback=${callbackName}`;
            
            window[callbackName] = function(response) {
                delete window[callbackName];
                document.body.removeChild(script);
                
                if (response && response.success) {
                    console.log('✓ Login timestamp recorded for', username);
                } else {
                    console.warn('⚠ Timestamp update failed:', response?.error || 'Unknown error');
                }
                resolve(true);
            };
            
            script.onerror = function() {
                delete window[callbackName];
                document.body.removeChild(script);
                console.warn('⚠ Timestamp update request failed for', username);
                resolve(false);
            };
            
            // Set timeout to prevent hanging
            setTimeout(() => {
                if (window[callbackName]) {
                    delete window[callbackName];
                    try { document.body.removeChild(script); } catch(e) {}
                    console.warn('⚠ Timestamp update timeout for', username);
                    resolve(false);
                }
            }, 10000);
            
            script.src = url;
            document.body.appendChild(script);
            
        } catch (error) {
            console.error('Error updating timestamp:', error);
            resolve(false);
        }
    });
}

// ======================== THEME FUNCTIONS ========================
function initTheme() {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        document.body.className = savedTheme;
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) themeToggle.checked = savedTheme === 'dark-theme';
    } else {
        document.body.className = prefersDark ? 'dark-theme' : 'light-theme';
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) themeToggle.checked = prefersDark;
    }
}

function toggleTheme() {
    const isDark = document.body.classList.contains('dark-theme');
    const newTheme = isDark ? 'light-theme' : 'dark-theme';
    document.body.className = newTheme;
    localStorage.setItem('theme', newTheme);
}

// ======================== LOGIN ERROR FUNCTIONS ========================
function showLoginError(message) {
    const errorDiv = document.getElementById('loginError');
    const errorText = document.getElementById('errorMessageText');
    if (errorDiv && errorText) {
        errorText.textContent = message;
        errorDiv.style.display = 'flex';
        
        setTimeout(() => {
            errorDiv.style.display = 'none';
        }, 5000);
    }
}

function hideLoginError() {
    const errorDiv = document.getElementById('loginError');
    if (errorDiv) {
        errorDiv.style.display = 'none';
    }
}

// ======================== NOTIFICATION SYSTEM FUNCTIONS ========================
function getCurrentBranchForChat() {
    if (currentUser && currentUser.username) {
        let username = currentUser.username.toUpperCase();
        if (/^BR\d{4}$/i.test(username) || username === "ADMIN") {
            return username;
        }
    }
    
    let branch = localStorage.getItem('branchCode');
    if (branch && (/^BR\d{4}$/i.test(branch) || branch === "ADMIN")) {
        return branch.toUpperCase();
    }
    
    branch = localStorage.getItem('selectedBranch');
    if (branch && (/^BR\d{4}$/i.test(branch) || branch === "ADMIN")) {
        return branch.toUpperCase();
    }
    
    const sessionUser = sessionStorage.getItem('currentUser');
    if (sessionUser) {
        try {
            const userData = JSON.parse(sessionUser);
            const username = userData.username;
            if (username && (/^BR\d{4}$/i.test(username) || username === "ADMIN")) {
                return username.toUpperCase();
            }
        } catch(e) {}
    }
    
    return null;
}

async function fetchUnreadChatCount() {
    const branch = getCurrentBranchForChat();
    if (!branch) {
        console.log("No branch found for unread chat check");
        updateNotificationBadge(0);
        return 0;
    }
    
    try {
        const range = `${CHAT_SHEET_NAME}!A:K`;
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${CHAT_SPREADSHEET_ID}/values/${range}?key=${CHAT_API_KEY}&_=${Date.now()}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (!data.values || data.values.length <= 1) {
            updateNotificationBadge(0);
            return 0;
        }
        
        const rows = data.values.slice(1);
        let unreadCount = 0;
        
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (row.length >= 3) {
                const messageBranch = row[1] ? row[1].toString().toUpperCase() : "";
                const readStatus = row[8] ? row[8].toString() : "";
                const readBy = row[9] ? row[9].toString() : "";
                const allMentionReadBy = row[10] ? row[10].toString() : "";
                const messageText = row[2] ? row[2].toString().toLowerCase() : "";
                const isAllMention = messageText.includes('@all');
                
                if (messageBranch !== branch) {
                    if (!isAllMention && readStatus !== "TRUE" && !readBy.includes(branch)) {
                        unreadCount++;
                    }
                    else if (isAllMention && !allMentionReadBy.includes(branch)) {
                        unreadCount++;
                    }
                }
            }
        }
        
        if (unreadCount > lastUnreadCount && unreadCount > 0) {
            setTimeout(() => playNotificationSound(), 100);
        }
        
        lastUnreadCount = unreadCount;
        updateNotificationBadge(unreadCount);
        return unreadCount;
        
    } catch (error) {
        console.error("Error fetching unread chat count:", error);
        updateNotificationBadge(0);
        return 0;
    }
}

function updateNotificationBadge(count) {
    const badge = document.getElementById('notificationBadge');
    if (!badge) return;
    
    if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.classList.remove('zero');
        badge.style.animation = 'pulse-red 0.5s ease-in-out';
        setTimeout(() => {
            if (badge) badge.style.animation = 'pulse-red 1.5s infinite';
        }, 500);
        document.title = `(${count}) NOC Admin`;
    } else {
        badge.textContent = '0';
        badge.classList.add('zero');
        document.title = 'NOC Admin';
    }
}

function openChatInIframe() {
    const chatUrl = "./chat.html?t=" + Date.now();
    const iframe = document.getElementById('content-frame');
    const loading = document.getElementById('loading');
    const welcomeMessage = document.getElementById('welcome-message');
    
    if (welcomeMessage) welcomeMessage.style.display = 'none';
    if (loading) loading.style.display = 'flex';
    
    iframe.onload = function() { 
        if (loading) loading.style.display = 'none'; 
        setTimeout(() => {
            fetchUnreadChatCount();
        }, 3000);
    };
    
    iframe.onerror = function() { 
        if (loading) loading.style.display = 'none'; 
        console.error('Error loading chat page');
    };
    
    iframe.src = chatUrl;
}

function startUnreadCheckInterval() {
    if (unreadCheckInterval) clearInterval(unreadCheckInterval);
    
    fetchUnreadChatCount();
    
    unreadCheckInterval = setInterval(() => {
        if (isAuthenticated) {
            fetchUnreadChatCount();
        }
    }, 10000);
}

function stopUnreadCheckInterval() {
    if (unreadCheckInterval) {
        clearInterval(unreadCheckInterval);
        unreadCheckInterval = null;
    }
}

function initNotificationSystem() {
    initNotificationSound();
    setupUserInteractionListener();
    
    const notificationBtn = document.getElementById('notificationIconBtn');
    if (notificationBtn) {
        notificationBtn.removeEventListener('click', openChatInIframe);
        notificationBtn.addEventListener('click', openChatInIframe);
    }
    startUnreadCheckInterval();
}

// ======================== FLASH NEWS FUNCTIONS ========================
async function fetchAndDisplayFlashNews() {
    const flashContainer = document.getElementById('flashNewsContainer');
    const flashTicker = document.getElementById('flashNewsTicker');
    
    if (!flashContainer || !flashTicker) return;
    
    try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${FLASH_SHEET}!A2:A?key=${API_KEY}&_=${Date.now()}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.error) {
            console.warn('Flash news sheet error:', data.error);
            flashContainer.classList.add('hidden');
            adjustWrapperHeightForTicker();
            return;
        }
        
        let newsItems = [];
        if (data.values && data.values.length > 0) {
            newsItems = data.values
                .map(row => row[0] ? row[0].toString().trim() : '')
                .filter(text => text !== '' && text !== null && text !== undefined);
        }
        
        if (newsItems.length === 0) {
            console.log('No scroll texts found in A2:A range, hiding ticker');
            flashContainer.classList.add('hidden');
            adjustWrapperHeightForTicker();
            return;
        }
        
        let tickerHtml = '';
        newsItems.forEach((item) => {
            tickerHtml += `<span><i class="bi bi-megaphone-fill"></i> ${escapeHtml(item)}</span>`;
        });
        
        const totalItems = newsItems.length;
        let scrollDuration = Math.min(40, Math.max(15, 25 + (totalItems * 0.5)));
        
        flashTicker.innerHTML = tickerHtml;
        
        flashTicker.style.animation = 'none';
        flashTicker.offsetHeight;
        flashTicker.style.animation = `scroll-left ${scrollDuration}s linear infinite`;
        
        flashContainer.classList.remove('hidden');
        adjustWrapperHeightForTicker();
        
        console.log(`Flash news ticker displayed with ${newsItems.length} items, scroll duration: ${scrollDuration}s`);
        
    } catch (error) {
        console.error('Error fetching flash news:', error);
        flashContainer.classList.add('hidden');
        adjustWrapperHeightForTicker();
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function adjustWrapperHeightForTicker() {
    const flashContainer = document.getElementById('flashNewsContainer');
    const wrapper = document.querySelector('.dashboard-container .wrapper');
    
    if (!wrapper) return;
    
    const navbar = document.querySelector('.navbar-custom');
    const navbarHeight = navbar ? navbar.offsetHeight : 73;
    const isTickerVisible = flashContainer && !flashContainer.classList.contains('hidden');
    const tickerHeight = isTickerVisible && flashContainer ? flashContainer.offsetHeight : 0;
    const viewportHeight = window.innerHeight;
    
    wrapper.style.height = `${viewportHeight - navbarHeight - tickerHeight}px`;
}

// ======================== FETCH USER DETAILS FROM LOGIN SHEET ========================
async function fetchUserDetailsFromLoginSheet(userId) {
    try {
        const loginUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${LOGIN_SHEET}!A:J?key=${API_KEY}&_=${Date.now()}`;
        const response = await fetch(loginUrl);
        const data = await response.json();
        
        if (data.error || !data.values) {
            console.error('Error fetching user details:', data.error);
            return null;
        }
        
        const rows = data.values;
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (row.length >= 2) {
                const storedUserId = row[1] || ''; // Column B: User ID
                
                // Match against User ID (Column B)
                if (storedUserId === userId) {
                    return {
                        userName: row[0] || '',           // Column A: User Name (Display Name)
                        userId: row[1] || '',             // Column B: User ID
                        password: row[2] || '',           // Column C: Password
                        menuSheet: row[3] || '',          // Column D: Menu Sheet
                        email: row[4] || '',              // Column E: Email ID
                        otp: row[5] || '',                // Column F: OTP
                        loginTimestamp: row[6] || '',     // Column G: Login Time
                        treasury: row[7] || '',           // Column H: Treasury Name
                        otpExpiry: row[8] || '',          // Column I: OTP Expiry
                        imageUrl: row[9] || null          // Column J: Image URL
                    };
                }
            }
        }
        console.warn('User not found with ID:', userId);
        return null;
    } catch (error) {
        console.error('Error fetching user details:', error);
        return null;
    }
}

// ======================== LOGIN FUNCTIONS ========================
async function validateLogin(userId, password) {
    try {
        const loginUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${LOGIN_SHEET}!A:J?key=${API_KEY}&_=${Date.now()}`;
        const response = await fetch(loginUrl);
        const data = await response.json();
        
        if (data.error) {
            console.error('API Error:', data.error);
            return null;
        }
        
        if (data.values) {
            for (let i = 1; i < data.values.length; i++) {
                const row = data.values[i];
                if (row.length >= 3) {
                    // Column B: User ID, Column C: Password, Column D: Menu Sheet
                    const storedUserId = row[1] || '';
                    const storedPassword = row[2] || '';
                    const menuSheet = row[3] ? row[3].trim() : null;
                    
                    if (userId === storedUserId && password === storedPassword) {
                        if (!menuSheet) {
                            console.error('No menu sheet specified for user:', userId);
                            return null;
                        }
                        
                        return {
                            userId: storedUserId,
                            menuSheet: menuSheet
                        };
                    }
                }
            }
        }
        
        return null;
    } catch (error) {
        console.error('Login validation error:', error);
        return null;
    }
}

// ======================== MAIN LOGIN HANDLER ========================
window.handleLogin = async function() {
    const userId = document.getElementById('username').value.trim(); // This is User ID (Column B)
    const password = document.getElementById('password').value.trim();
    const loginBtn = document.getElementById('loginBtn');
    const loginSpinner = document.getElementById('loginSpinner');
    const loginText = document.getElementById('loginText');
    const loginOverlay = document.getElementById('loginOverlay');
    
    hideLoginError();
    
    if (!userId || !password) {
        showLoginError('Please enter both User ID and password');
        return;
    }
    
    loginBtn.disabled = true;
    loginSpinner.classList.remove('d-none');
    loginText.textContent = 'Verifying...';
    document.activeElement.blur();
    
    try {
        // Validate using User ID (Column B)
        const userData = await validateLogin(userId, password);
        
        if (userData) {
            isAuthenticated = true;
            window.isAuthenticated = true;
            
            // Fetch full user details using User ID (Column B)
            const fullDetails = await fetchUserDetailsFromLoginSheet(userId);
            console.log('Full user details fetched:', fullDetails);
            
            // Build complete user data
            const completeUserData = {
                // Use the actual User Name from Column A for display
                username: fullDetails?.userName || userId,  // ← Column A: Display Name
                userId: userId,                              // ← Column B: User ID (login ID)
                userDisplayName: fullDetails?.userName || userId,
                loginTime: new Date().toISOString(),
                menuSheet: userData.menuSheet,
                email: fullDetails?.email || '',            // ← Column E: Email
                treasury: fullDetails?.treasury || '',      // ← Column H: Treasury
                imageUrl: fullDetails?.imageUrl || null,    // ← Column J: Image URL
                _fullDetails: fullDetails // Store for reference
            };
            
            console.log('Complete user data:', completeUserData);
            
            // Store in localStorage and sessionStorage
            localStorage.setItem('currentUser', JSON.stringify(completeUserData));
            sessionStorage.setItem('currentUser', JSON.stringify(completeUserData));
            
            currentUser = completeUserData;
            window.currentUser = completeUserData;
            
            // Update login timestamp (non-blocking)
            updateLoginTimestamp(userId);
            
            loginOverlay.style.opacity = '0';
            
            setTimeout(() => {
                loginOverlay.style.display = 'none';
                document.getElementById('dashboardContainer').style.display = 'block';
                
                // Update navbar user
                if (typeof window.updateNavbarUser === 'function') {
                    window.updateNavbarUser(completeUserData);
                }
                
                loadMenuData(userData.menuSheet);
                
                setTimeout(() => {
                    fetchAndDisplayFlashNews();
                    initNotificationSystem();
                }, 100);
            }, 500);
        } else {
            loginBtn.disabled = false;
            loginSpinner.classList.add('d-none');
            loginText.textContent = 'Login';
            document.getElementById('password').value = '';
            showLoginError('Invalid User ID or password');
            document.getElementById('username').focus();
        }
    } catch (error) {
        console.error('Login error:', error);
        loginBtn.disabled = false;
        loginSpinner.classList.add('d-none');
        loginText.textContent = 'Login';
        showLoginError('Unable to verify credentials. Please try again.');
        document.getElementById('username').focus();
    }
};
// ======================== LOGOUT FUNCTION ========================
window.logout = function() {
    stopUnreadCheckInterval();
    
    localStorage.removeItem('currentUser');
    sessionStorage.removeItem('currentUser');
    currentUser = null;
    isAuthenticated = false;
    
    window.isAuthenticated = false;
    window.currentUser = null;
    
    const loginOverlay = document.getElementById('loginOverlay');
    const dashboardContainer = document.getElementById('dashboardContainer');
    const flashContainer = document.getElementById('flashNewsContainer');
    
    if (flashContainer) {
        flashContainer.classList.add('hidden');
    }
    
    loginOverlay.style.display = 'flex';
    loginOverlay.style.opacity = '1';
    dashboardContainer.style.display = 'none';
    
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    
    updateNotificationBadge(0);
    lastUnreadCount = 0;
    document.title = 'NOC Admin';
    userInteracted = false;
    
    if (typeof window.hideUserPopup === 'function') {
        window.hideUserPopup();
    }
    
    setTimeout(() => {
        document.getElementById('username').focus();
        resetLoginButtonState();
    }, 100);
};

// ======================== USER DISPLAY FUNCTIONS ========================
window.displayLoggedInUser = function() {
    const storedUser = localStorage.getItem('currentUser');
    if (storedUser) {
        try {
            const userData = JSON.parse(storedUser);
            currentUser = userData;
            window.currentUser = userData;
            
            if (typeof window.updateNavbarUser === 'function') {
                window.updateNavbarUser(userData);
            }
        } catch (e) {
            console.error('Error parsing user data:', e);
        }
    }
};

// ======================== CHECK EXISTING SESSION ========================
window.checkExistingSession = function() {
    const storedUser = localStorage.getItem('currentUser');
    if (storedUser) {
        try {
            const userData = JSON.parse(storedUser);
            const loginTime = new Date(userData.loginTime);
            const now = new Date();
            const hoursSinceLogin = (now - loginTime) / (1000 * 60 * 60);
            
            if (hoursSinceLogin > 24) {
                window.logout();
                return;
            }
            
            isAuthenticated = true;
            currentUser = userData;
            window.isAuthenticated = true;
            window.currentUser = userData;
            
            const loginOverlay = document.getElementById('loginOverlay');
            const dashboardContainer = document.getElementById('dashboardContainer');
            
            loginOverlay.style.display = 'none';
            dashboardContainer.style.display = 'block';
            
            if (typeof window.updateNavbarUser === 'function') {
                window.updateNavbarUser(userData);
            }
            
            loadMenuData(userData.menuSheet);
            setTimeout(() => {
                fetchAndDisplayFlashNews();
                initNotificationSystem();
            }, 100);
        } catch (e) {
            console.error('Error restoring session:', e);
            window.logout();
        }
    }
};

// ======================== MENU DATA FUNCTIONS ========================
function processIconData(rows) {
    if (!rows || rows.length < 2) return;
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length < 6) continue;
        const [mainMenu, mainIcon, subMenu, subIcon, linkItem, linkIcon] = row;
        if (mainMenu && subMenu && linkItem) {
            const key = `${mainMenu}|${subMenu}|${linkItem}`;
            iconData.set(key, {
                mainIcon: mainIcon || '<i class="bi bi-folder2"></i>',
                subIcon: subIcon || '<i class="bi bi-folder2"></i>',
                linkIcon: linkIcon || '<i class="bi bi-link-45deg"></i>'
            });
            const mainKey = `${mainMenu}||`;
            if (!iconData.has(mainKey)) iconData.set(mainKey, { mainIcon: mainIcon || '<i class="bi bi-grid"></i>' });
            const subKey = `${mainMenu}|${subMenu}|`;
            if (!iconData.has(subKey)) iconData.set(subKey, { subIcon: subIcon || '<i class="bi bi-folder"></i>' });
        }
    }
}

function getIcon(mainMenu, subMenu = '', linkItem = '', level) {
    const key = `${mainMenu}|${subMenu}|${linkItem}`;
    const icons = iconData.get(key);
    if (icons) {
        switch (level) {
            case 'main': return icons.mainIcon || '<i class="bi bi-grid"></i>';
            case 'sub': return icons.subIcon || '<i class="bi bi-folder"></i>';
            case 'link': return icons.linkIcon || '<i class="bi bi-link-45deg"></i>';
        }
    }
    if (level === 'main') {
        const mainKey = `${mainMenu}||`;
        const mainIcons = iconData.get(mainKey);
        if (mainIcons && mainIcons.mainIcon) return mainIcons.mainIcon;
    }
    if (level === 'sub') {
        const subKey = `${mainMenu}|${subMenu}|`;
        const subIcons = iconData.get(subKey);
        if (subIcons && subIcons.subIcon) return subIcons.subIcon;
    }
    switch (level) {
        case 'main': return '<i class="bi bi-grid"></i>';
        case 'sub': return '<i class="bi bi-folder"></i>';
        case 'link': return '<i class="bi bi-link-45deg"></i>';
        default: return '<i class="bi bi-folder2"></i>';
    }
}

function processMenuData(rows) {
    if (!rows || rows.length < 2) return [];
    const menuMap = new Map();
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length < 4) continue;
        const [mainMenu, subMenu, linkItem, url] = row;
        if (!mainMenu || !subMenu || !linkItem || !url) continue;
        if (!menuMap.has(mainMenu)) menuMap.set(mainMenu, new Map());
        const subMenuMap = menuMap.get(mainMenu);
        if (!subMenuMap.has(subMenu)) subMenuMap.set(subMenu, []);
        subMenuMap.get(subMenu).push({
            title: linkItem,
            url: url,
            icon: getIcon(mainMenu, subMenu, linkItem, 'link')
        });
    }
    return Array.from(menuMap.entries()).map(([mainMenu, subMenuMap]) => ({
        title: mainMenu,
        icon: getIcon(mainMenu, '', '', 'main'),
        subMenus: Array.from(subMenuMap.entries()).map(([subMenu, items]) => ({
            title: subMenu,
            icon: getIcon(mainMenu, subMenu, '', 'sub'),
            items: items
        }))
    }));
}

async function fetchSheetData(menuSheetName) {
    try {
        console.log('Fetching menu from sheet:', menuSheetName);
        
        iconData.clear();
        
        const menuUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${menuSheetName}!${MENU_RANGE}?key=${API_KEY}&_=${Date.now()}`;
        const menuResponse = await fetch(menuUrl);
        const menuData_raw = await menuResponse.json();
        
        if (menuData_raw.error) {
            console.error('Menu sheet error:', menuData_raw.error);
            throw new Error(`Menu sheet '${menuSheetName}' not found or inaccessible`);
        }
        
        const iconUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${ICON_SHEET}!${ICON_RANGE}?key=${API_KEY}&_=${Date.now()}`;
        const iconResponse = await fetch(iconUrl);
        const iconData_raw = await iconResponse.json();
        if (!iconData_raw.error) processIconData(iconData_raw.values);
        
        return processMenuData(menuData_raw.values);
    } catch (error) {
        console.error('Error fetching data:', error);
        showError('Error loading menu: ' + error.message);
        return [];
    }
}

function loadMenuData(menuSheetName) {
    try {
        if (!menuSheetName) {
            showError('No menu sheet configured for this user');
            return;
        }
        
        fetchSheetData(menuSheetName).then(data => {
            menuData = data;
            renderMenuCards(menuData, 'desktopSidebar');
            renderMenuCards(menuData, 'mobileSidebar');
            
            window.displayLoggedInUser();
            
            const welcomeMsg = document.getElementById('welcome-message');
            if (welcomeMsg) {
                welcomeMsg.style.display = 'block';
                setTimeout(() => {
                    welcomeMsg.style.display = 'none';
                }, 5000);
            }
            
            const loading = document.getElementById('loading');
            if (loading) loading.style.display = 'none';
            
            if (currentUser) {
                console.log(`Logged in as: ${currentUser.username}, using menu sheet: ${menuSheetName}`);
            }
        }).catch(error => {
            console.error('Error loading menu data:', error);
            showError('Error loading menu data');
        });
    } catch (error) {
        console.error('Error in loadMenuData:', error);
        showError('Error loading menu data');
    }
}

function showError(message) {
    const desktop = document.getElementById('desktopSidebar');
    const mobile = document.getElementById('mobileSidebar');
    if (desktop) desktop.innerHTML = `<div class="error-message text-danger p-3">${escapeHtml(message)}</div>`;
    if (mobile) mobile.innerHTML = `<div class="error-message text-danger p-3">${escapeHtml(message)}</div>`;
}

function renderMenuCards(menuData, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!menuData || menuData.length === 0) {
        container.innerHTML = '<div class="text-muted p-3">No menu items available for your account</div>';
        return;
    }
    let html = '';
    menuData.forEach(main => {
        let subHtml = '';
        main.subMenus.forEach(sub => {
            let linksHtml = '';
            sub.items.forEach(link => {
                linksHtml += `<li class="link-item" data-url="${link.url}" data-title="${link.title}">${link.icon} ${escapeHtml(link.title)}</li>`;
            });
            subHtml += `<div class="submenu-block">
                <div class="submenu-title">${sub.icon} ${escapeHtml(sub.title)}</div>
                <ul class="link-items">${linksHtml}</ul>
            </div>`;
        });
        html += `<div class="menu-card">
            <div class="menu-card-header">${main.icon} ${escapeHtml(main.title)}</div>
            <div class="menu-card-body">${subHtml}</div>
        </div>`;
    });
    container.innerHTML = html;
    
    container.querySelectorAll('.link-item').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            const url = el.dataset.url;
            
            container.querySelectorAll('.link-item').forEach(item => {
                item.classList.remove('active');
            });
            
            el.classList.add('active');
            
            loadUrlInIframe(url);
            if (window.innerWidth < 992) {
                const offcanvasEl = document.getElementById('mobileMenuOffcanvas');
                if (offcanvasEl) {
                    const bsOffcanvas = bootstrap.Offcanvas.getInstance(offcanvasEl);
                    if (bsOffcanvas) bsOffcanvas.hide();
                }
            }
        });
    });
}

function loadUrlInIframe(url) {
    const iframe = document.getElementById('content-frame');
    const loading = document.getElementById('loading');
    const welcomeMessage = document.getElementById('welcome-message');
    
    if (welcomeMessage) welcomeMessage.style.display = 'none';
    if (loading) loading.style.display = 'flex';
    
    let fullUrl = url;
    
    if (fullUrl.includes('?')) {
        fullUrl += `&_=${Date.now()}`;
    } else {
        fullUrl += `?_=${Date.now()}`;
    }
    
    if (url.includes('treasury-status') && currentUser && currentUser.branch) {
        const separator = url.includes('?') ? '&' : '?';
        fullUrl = `${url}${separator}branch=${encodeURIComponent(currentUser.branch)}`;
    }
    
    iframe.onload = function() { 
        if (loading) loading.style.display = 'none'; 
    };
    
    iframe.onerror = function() { 
        if (loading) loading.style.display = 'none'; 
        alert('Error loading page: ' + fullUrl); 
    };
    
    iframe.src = fullUrl;
}

// ======================== SIDEBAR TOGGLE FUNCTION (UPDATED) ========================
function initDesktopSidebarToggle() {
    const btn = document.getElementById('desktopSidebarToggle');
    const sidebar = document.getElementById('desktopSidebarContainer');
    const contentArea = document.getElementById('contentArea');
    
    if (!btn || !sidebar) {
        console.warn('Sidebar toggle elements not found');
        return;
    }
    
    // Check if sidebar is collapsed from localStorage
    const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    if (isCollapsed) {
        sidebar.classList.add('collapsed');
        if (contentArea) contentArea.classList.add('expanded');
    }
    
    // Remove any existing listeners to prevent duplicates
    btn.removeEventListener('click', handleSidebarToggle);
    btn.addEventListener('click', handleSidebarToggle);
}

function handleSidebarToggle(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const sidebar = document.getElementById('desktopSidebarContainer');
    const contentArea = document.getElementById('contentArea');
    
    if (!sidebar) return;
    
    sidebar.classList.toggle('collapsed');
    if (contentArea) contentArea.classList.toggle('expanded');
    
    // Save state
    const collapsed = sidebar.classList.contains('collapsed');
    localStorage.setItem('sidebarCollapsed', collapsed ? 'true' : 'false');
    
    // Resize iframe when sidebar toggles
    setTimeout(() => {
        const iframe = document.getElementById('content-frame');
        if (iframe && iframe.contentWindow) {
            try {
                iframe.contentWindow.dispatchEvent(new Event('resize'));
            } catch(e) {
                // Cross-origin, ignore
            }
        }
        window.dispatchEvent(new Event('resize'));
        adjustWrapperHeightForTicker();
    }, 300);
}

// ======================== RESET LOGIN BUTTON STATE ========================
function resetLoginButtonState() {
    const loginBtn = document.getElementById('loginBtn');
    const loginSpinner = document.getElementById('loginSpinner');
    const loginText = document.getElementById('loginText');
    
    if (loginBtn) loginBtn.disabled = false;
    if (loginSpinner) loginSpinner.classList.add('d-none');
    if (loginText) loginText.textContent = 'Login';
}

// ======================== INITIALIZATION ========================
document.addEventListener('DOMContentLoaded', function() {
    initTheme();
    
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('change', toggleTheme);
    }
    
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
        loginBtn.addEventListener('click', window.handleLogin);
    }
    
    const username = document.getElementById('username');
    const password = document.getElementById('password');
    
    if (username) {
        username.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (password) password.focus();
            }
        });
        username.addEventListener('input', hideLoginError);
    }
    
    if (password) {
        password.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                window.handleLogin();
            }
        });
        password.addEventListener('input', hideLoginError);
    }
    
    // Initialize sidebar toggle (called after DOM is ready)
    initDesktopSidebarToggle();
    
    const welcomeMsg = document.getElementById('welcome-message');
    if (welcomeMsg) welcomeMsg.style.display = 'none';
    
    window.checkExistingSession();
    
    window.addEventListener('resize', () => {
        if (isAuthenticated) {
            adjustWrapperHeightForTicker();
        }
    });
    
    setTimeout(() => {
        if (!isAuthenticated && username) {
            username.focus();
        }
    }, 100);
});

// Iframe load event
const contentFrame = document.getElementById('content-frame');
if (contentFrame) {
    contentFrame.addEventListener('load', function() {
        const loading = document.getElementById('loading');
        if (loading) loading.style.display = 'none';
    });
}

// Service worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/network/sw.js')
            .then(registration => {
                console.log('ServiceWorker registered successfully');
            })
            .catch(error => {
                console.log('ServiceWorker registration failed:', error);
            });
    });
}

// Export functions
window.fetchAndDisplayFlashNews = fetchAndDisplayFlashNews;
window.adjustWrapperHeightForTicker = adjustWrapperHeightForTicker;
window.fetchUnreadChatCount = fetchUnreadChatCount;
window.openChatInIframe = openChatInIframe;
window.getCurrentBranchForChat = getCurrentBranchForChat;
window.toggleNotificationSound = toggleNotificationSound;
window.initTheme = initTheme;
window.toggleTheme = toggleTheme;
window.showLoginError = showLoginError;
window.hideLoginError = hideLoginError;
window.initNotificationSystem = initNotificationSystem;
window.resetLoginButtonState = resetLoginButtonState;
window.fetchUserDetailsFromLoginSheet = fetchUserDetailsFromLoginSheet;
window.loadMenuData = loadMenuData;
window.initDesktopSidebarToggle = initDesktopSidebarToggle;

console.log('[System] All systems initialized');
console.log('[System] User details will be fetched from Login sheet columns: A-Username, B-UserID, E-Email, H-Treasury, J-ImageURL');