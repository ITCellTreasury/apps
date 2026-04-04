   // ======================= CONFIGURATION =======================
        const DATA_URL = 'https://sheets.googleapis.com/v4/spreadsheets'
        const DATA_ID = '1KkbLPyco3vfQjdebI8sa2JFgBYBQKerlm7_tVjo5wnI';
        const TABLE_NAME = 'Apps Details';
        const API_KEY = 'AIzaSyBAuS3Brpsw5JOJnjNJii1UlFa7ClXf8d4';
        const RANGE = 'A2:F';  // Columns: Name, URL, Icon URL, Tag, Description, Rating
        
        // Build  API URL (v4)
        const DATA_API_URL = `${DATA_URL}/${DATA_ID}/values/${encodeURIComponent(TABLE_NAME)}!${RANGE}?key=${API_KEY}&majorDimension=ROWS`;
        
        let allApps = [];
        let currentFilter = '';
        
        // DOM Elements
        const container = document.getElementById('apps-container');
        const desktopSearchInput = document.getElementById('desktopSearchInput');
        const desktopClearBtn = document.getElementById('desktopClearBtn');
        const mobileSearchBtn = document.getElementById('mobileSearchBtn');
        const mobileSearchOverlay = document.getElementById('mobileSearchOverlay');
        const mobileSearchInput = document.getElementById('mobileSearchInput');
        const closeMobileSearch = document.getElementById('closeMobileSearch');
        const infoBar = document.getElementById('infoBar');
        const resultsCountSpan = document.getElementById('resultsCount').querySelector('span');
        const appCountBadgeSpan = document.getElementById('appCountBadge').querySelector('span');
        const refreshToastDiv = document.getElementById('refreshToast');
        const toastMessageSpan = document.getElementById('toastMessage');
        
        function showToast(message, isError = false) {
            toastMessageSpan.textContent = message;
            refreshToastDiv.classList.add('show');
            if (isError) {
                refreshToastDiv.style.background = '#d32f2f';
                refreshToastDiv.querySelector('i').className = 'bi bi-exclamation-triangle-fill';
            } else {
                refreshToastDiv.style.background = '#1f1f1f';
                refreshToastDiv.querySelector('i').className = 'bi bi-check-circle-fill';
            }
            setTimeout(() => {
                refreshToastDiv.classList.remove('show');
                setTimeout(() => {
                    refreshToastDiv.style.background = '#1f1f1f';
                    refreshToastDiv.querySelector('i').className = 'bi bi-check-circle-fill';
                }, 300);
            }, 2500);
        }
        
        function getInitials(appName) {
            if (!appName) return 'A';
            const words = appName.trim().split(/\s+/);
            if (words.length === 1) return words[0].charAt(0).toUpperCase();
            return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
        }
        
        function renderStars(rating) {
            const numRating = parseFloat(rating);
            if (isNaN(numRating) || numRating < 0) return '<i class="bi bi-star"></i><i class="bi bi-star"></i><i class="bi bi-star"></i><i class="bi bi-star"></i><i class="bi bi-star"></i>';
            const fullStars = Math.floor(numRating);
            const hasHalf = numRating % 1 >= 0.5;
            const emptyStars = 5 - fullStars - (hasHalf ? 1 : 0);
            let starsHtml = '';
            for (let i = 0; i < fullStars; i++) starsHtml += '<i class="bi bi-star-fill"></i>';
            if (hasHalf) starsHtml += '<i class="bi bi-star-half"></i>';
            for (let i = 0; i < emptyStars; i++) starsHtml += '<i class="bi bi-star"></i>';
            return starsHtml;
        }
        
        // Fetch data from  API (no caching, fresh each time)
        async function fetchAppsFromSheets() {
            const url = DATA_API_URL;
            try {
                const response = await fetch(url, {
                    cache: 'no-store',
                    headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
                });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                const data = await response.json();
                if (!data.values || data.values.length === 0) {
                    throw new Error('No data found in sheet. Ensure sheet "Apps Details" has data in columns A-F (starting row 2).');
                }
                const apps = [];
                for (let row of data.values) {
                    // Ensure at least 1 column has name, fill missing with defaults
                    const appName = row[0] ? row[0].trim() : null;
                    if (!appName) continue; // skip rows without app name
                    
                    const launchUrl = (row[1] && row[1].trim()) ? row[1].trim() : './';
                    const iconUrl = (row[2] && row[2].trim()) ? row[2].trim() : null;
                    const tag = (row[3] && row[3].trim()) ? row[3].trim() : 'App';
                    const description = (row[4] && row[4].trim()) ? row[4].trim() : 'No description available';
                    let rating = 4.0;
                    if (row[5] && row[5].trim()) {
                        const parsed = parseFloat(row[5].trim());
                        if (!isNaN(parsed)) rating = Math.min(5, Math.max(0, parsed));
                    }
                    
                    apps.push({
                        id: appName.replace(/[^a-z0-9]/gi, '_').toLowerCase(),
                        name: appName,
                        url: launchUrl,
                        iconUrl: iconUrl,
                        tag: tag,
                        description: description,
                        rating: rating,
                        searchTokens: (appName + ' ' + tag + ' ' + description).toLowerCase()
                    });
                }
                return apps;
            } catch (error) {
                console.error('Data fetch error:', error);
                throw error;
            }
        }
        
        async function loadApplications(showToastMsg = false) {
            container.innerHTML = `
                <div class="state-container">
                    <div class="spinner-circle"></div>
                    <div class="state-title">Loading...</div>
                    <div class="state-sub">Please wait, fetching live catalog</div>
                </div>
            `;
            
            try {
                const apps = await fetchAppsFromSheets();
                if (apps.length === 0) {
                    renderEmptyState('No applications found', 'Please check your Data  "Apps Details" tab has valid data (A2:F range with at least app names).', null, false);
                    if (showToastMsg) showToast('No apps found in Data', true);
                    allApps = [];
                    updateTotalBadge();
                    return;
                }
                allApps = apps;
                updateTotalBadge();
                if (currentFilter) {
                    const filtered = filterApps(currentFilter);
                    renderAppsGrid(filtered);
                } else {
                    renderAppsGrid(allApps);
                }
                if (showToastMsg) {
                    showToast(`Synced ${apps.length} app${apps.length !== 1 ? 's' : ''} .`);
                }
            } catch (error) {
                console.error('Load error:', error);
                let friendlyMsg = 'Failed to load App Data . ';
                if (error.message.includes('403')) friendlyMsg += 'API key may be invalid or Sheets API not enabled.';
                else if (error.message.includes('404')) friendlyMsg += 'Spreadsheet ID or sheet name incorrect.';
                else friendlyMsg += 'Check API key, sheet permissions, and range A2:F.';
                renderEmptyState('Unable to load catalog', friendlyMsg, error.message, false);
                if (showToastMsg) showToast('Data fetch error', true);
                allApps = [];
                updateTotalBadge();
            }
        }
        
        function updateTotalBadge() {
            if (allApps.length) {
                appCountBadgeSpan.textContent = `${allApps.length} app${allApps.length !== 1 ? 's' : ''} available`;
            } else {
                appCountBadgeSpan.textContent = '0 apps';
            }
        }
        
        function filterApps(searchTerm) {
            if (!searchTerm.trim()) return allApps;
            const term = searchTerm.trim().toLowerCase();
            return allApps.filter(app => app.searchTokens.includes(term));
        }
        
        function renderAppsGrid(appsToRender) {
            if (!appsToRender.length) {
                if (currentFilter && allApps.length > 0) {
                    renderEmptyState('No matching apps', `No apps found for "${escapeHtml(currentFilter)}"`, null, true);
                } else if (allApps.length === 0) {
                    renderEmptyState('App list is empty', 'Please check  configuration', null, false);
                } else {
                    renderEmptyState('No apps found', 'Try adjusting your search', null, true);
                }
                return;
            }
            
            const gridHtml = `
                <div class="apps-grid">
                    ${appsToRender.map(app => `
                        <div class="app-card" data-url="${escapeHtml(app.url)}">
                            <div class="card-header">
                                <div class="icon-wrapper">
                                    ${app.iconUrl ? 
                                        `<img src="${escapeHtml(app.iconUrl)}" alt="${escapeHtml(app.name)}" class="app-icon-large" 
                                            onerror="this.style.display='none'; this.parentElement.querySelector('.default-icon-large').style.display='flex';">` : 
                                        ''
                                    }
                                    <div class="default-icon-large" ${app.iconUrl ? 'style="display: none;"' : ''}>
                                        ${escapeHtml(getInitials(app.name))}
                                    </div>
                                </div>
                                <div class="app-info-header">
                                    <div class="app-title">${escapeHtml(app.name)}</div>
                                    <div class="app-tag">
                                        <i class="bi bi-tag-fill"></i>
                                        ${escapeHtml(app.tag)}
                                    </div>
                                    <div class="star-rating">
                                        <div class="stars">
                                            ${renderStars(app.rating)}
                                        </div>
                                        <span class="rating-value">${app.rating.toFixed(1)}</span>
                                    </div>
                                </div>
                            </div>
                            <div class="app-description">
                                <div class="description-text">${escapeHtml(app.description)}</div>
                            </div>
                            <div class="card-footer">
                                <div class="launch-btn">
                                    <i class="bi bi-box-arrow-up-right"></i>
                                    <span>View</span>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
            container.innerHTML = gridHtml;
            
            document.querySelectorAll('.app-card').forEach(card => {
                card.addEventListener('click', (e) => {
                    const url = card.getAttribute('data-url');
                    if (url && url !== '#') {
                        window.open(url, '_blank', 'noopener,noreferrer');
                    }
                });
            });
            
            const showingCount = appsToRender.length;
            if (currentFilter) {
                resultsCountSpan.innerHTML = `${showingCount} result${showingCount !== 1 ? 's' : ''} for "${escapeHtml(currentFilter)}"`;
                infoBar.style.display = 'flex';
            } else {
                resultsCountSpan.innerHTML = `All apps · ${allApps.length} available`;
                infoBar.style.display = 'flex';
            }
        }
        
        function renderEmptyState(title, message, errorDetail = null, isSearchEmpty = false) {
            let additionalHtml = '';
            if (errorDetail && !isSearchEmpty) {
                additionalHtml = `<div style="font-size:0.7rem; margin-top:12px; color:#ea4335; display:flex; align-items:center; gap:4px;"><i class="bi bi-exclamation-triangle"></i>${escapeHtml(errorDetail.substring(0, 120))}</div>`;
            }
            if (isSearchEmpty && allApps.length > 0) {
                additionalHtml += `<button id="resetSearchBtn" class="reset-search-btn"><i class="bi bi-arrow-counterclockwise"></i> Clear Search</button>`;
            }
            container.innerHTML = `
                <div class="state-container">
                    <div class="empty-icon">
                        <i class="bi ${isSearchEmpty ? 'bi-search' : 'bi-exclamation-octagon'}"></i>
                    </div>
                    <div class="state-title">${escapeHtml(title)}</div>
                    <div class="state-sub">${escapeHtml(message)}</div>
                    ${additionalHtml}
                </div>
            `;
            if (isSearchEmpty && allApps.length > 0) {
                const resetBtn = document.getElementById('resetSearchBtn');
                if (resetBtn) resetBtn.addEventListener('click', () => { updateSearchValue(''); performSearch(); });
            }
            infoBar.style.display = 'none';
        }
        
        function updateSearchValue(value) {
            currentFilter = value;
            if (desktopSearchInput) desktopSearchInput.value = value;
            if (mobileSearchInput) mobileSearchInput.value = value;
        }
        
        function performSearch() {
            const filtered = filterApps(currentFilter);
            renderAppsGrid(filtered);
        }
        
        function handleSearchInput(value) {
            currentFilter = value;
            performSearch();
            if (desktopSearchInput && desktopSearchInput.value !== value) desktopSearchInput.value = value;
            if (mobileSearchInput && mobileSearchInput.value !== value) mobileSearchInput.value = value;
        }
        
        function attachSearchEvents() {
            if (desktopSearchInput) desktopSearchInput.addEventListener('input', (e) => handleSearchInput(e.target.value));
            if (desktopClearBtn) desktopClearBtn.addEventListener('click', () => { handleSearchInput(''); if(desktopSearchInput) desktopSearchInput.focus(); });
            if (mobileSearchInput) mobileSearchInput.addEventListener('input', (e) => handleSearchInput(e.target.value));
            if (mobileSearchBtn) mobileSearchBtn.addEventListener('click', () => { mobileSearchOverlay.classList.add('active'); mobileSearchInput.focus(); });
            if (closeMobileSearch) closeMobileSearch.addEventListener('click', () => mobileSearchOverlay.classList.remove('active'));
            mobileSearchOverlay.addEventListener('click', (e) => { if (e.target === mobileSearchOverlay) mobileSearchOverlay.classList.remove('active'); });
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && mobileSearchOverlay.classList.contains('active')) mobileSearchOverlay.classList.remove('active'); });
        }
        
        async function autoRefresh() {
            await loadApplications(true);
            performSearch();
        }
        
        function escapeHtml(str) {
            if (!str) return '';
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }
        
        async function init() {
            await loadApplications(false);
            attachSearchEvents();
            setInterval(autoRefresh, 35000);
        }
        
        init();
