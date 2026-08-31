    // Global variables
        let drData = [];
        let tableRows = [];
        let settingsData = {
            treasuries: [],
            pensionerTypes: []
        };

        // Google Sheets configuration
        const SHEET_ID = "11oRitOvxaUmQIP6cAFBBTBXMnSV_ZIw6DD9aL_RpILc";
        const API_KEY = "AIzaSyBAuS3Brpsw5JOJnjNJii1UlFa7ClXf8d4";

        document.addEventListener('DOMContentLoaded', function() {
            // Initialize flatpickr for date inputs with editable option
            flatpickr("#fromDate", {
                altInput: true,
                altFormat: "d/m/Y",
                dateFormat: "Y-m-d",
                defaultDate: new Date(new Date().getFullYear() - 1, new Date().getMonth(), 1),
                allowInput: true
            });
            
            flatpickr("#toDate", {
                altInput: true,
                altFormat: "d/m/Y",
                dateFormat: "Y-m-d",
                defaultDate: new Date(),
                allowInput: true
            });
            
            // Initialize date inputs and calculate period
            initializeDates();
            
            // Set up event listeners
            document.getElementById('fromDate').addEventListener('change', calculatePeriod);
            document.getElementById('toDate').addEventListener('change', calculatePeriod);
            document.getElementById('calculateDRBtn').addEventListener('click', calculateDR);
            document.getElementById('calculateAmountBtn').addEventListener('click', calculateAmount);
            document.getElementById('resetBtn').addEventListener('click', resetForm);
            document.getElementById('printBtn').addEventListener('click', printCalculation);
            document.getElementById('pensionerType').addEventListener('change', fetchDRData);
            document.getElementById('addRowBtn').addEventListener('click', addNewRow);
            
            // Fetch settings data from Google Sheets
            fetchSettingsData();
        });

        // Initialize dates for calculation period
        function initializeDates() {
            calculatePeriod();
        }

        // Calculate period when dates change
        function calculatePeriod() {
            const fromDateInput = document.getElementById('fromDate');
            const toDateInput = document.getElementById('toDate');
            const yearsInput = document.getElementById('years');
            const monthsInput = document.getElementById('months');
            const daysInput = document.getElementById('days');
            
            const fromDate = new Date(fromDateInput.value);
            const toDate = new Date(toDateInput.value);
            
            if (fromDate && toDate && fromDate <= toDate) {
                let years = toDate.getFullYear() - fromDate.getFullYear();
                let months = toDate.getMonth() - fromDate.getMonth();
                let days = toDate.getDate() - fromDate.getDate();
                
                if (days < 0) {
                    months--;
                    const prevMonth = new Date(toDate.getFullYear(), toDate.getMonth(), 0);
                    days += prevMonth.getDate();
                }
                
                if (months < 0) {
                    years--;
                    months += 12;
                }
                
                yearsInput.value = years;
                monthsInput.value = months;
                daysInput.value = days;
            }
        }

        // Fetch settings data from Google Sheets
        async function fetchSettingsData() {
            try {
                showLoadingState(true);
                
                const treasuryResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Settings!A2:A?key=${API_KEY}`);
                const treasuryData = await treasuryResponse.json();
                
                const pensionTypeResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Settings!B2:B?key=${API_KEY}`);
                const pensionTypeData = await pensionTypeResponse.json();
                
                settingsData.treasuries = treasuryData.values ? treasuryData.values.flat().filter(val => val.trim() !== '') : [];
                settingsData.pensionerTypes = pensionTypeData.values ? pensionTypeData.values.flat().filter(val => val.trim() !== '') : [];
                
                populateSettingsDropdowns();
                showLoadingState(false);
                
            } catch (error) {
                console.error('Error fetching settings data:', error);
                document.getElementById('treasury').innerHTML = '<option value="">Error loading treasuries</option>';
                document.getElementById('pensionerType').innerHTML = '<option value="">Error loading pension types</option>';
                showLoadingState(false);
            }
        }

        // Show/hide loading state
        function showLoadingState(isLoading) {
            const treasurySelect = document.getElementById('treasury');
            const pensionTypeSelect = document.getElementById('pensionerType');
            
            if (isLoading) {
                treasurySelect.innerHTML = '<option value="">Loading treasuries...</option>';
                pensionTypeSelect.innerHTML = '<option value="">Loading pension types...</option>';
                treasurySelect.disabled = true;
                pensionTypeSelect.disabled = true;
            } else {
                treasurySelect.disabled = false;
                pensionTypeSelect.disabled = false;
            }
        }

        // Populate settings dropdowns
        function populateSettingsDropdowns() {
            const treasurySelect = document.getElementById('treasury');
            const pensionerTypeSelect = document.getElementById('pensionerType');
            
            treasurySelect.innerHTML = '<option value="">Select Treasury</option>';
            pensionerTypeSelect.innerHTML = '<option value="">Select Pensioner Type</option>';
            
            settingsData.treasuries.forEach(treasury => {
                const option = document.createElement('option');
                option.value = treasury;
                option.textContent = treasury;
                treasurySelect.appendChild(option);
            });
            
            settingsData.pensionerTypes.forEach(type => {
                const option = document.createElement('option');
                option.value = type;
                option.textContent = type;
                pensionerTypeSelect.appendChild(option);
            });
        }

        // Fetch DR data from Google Sheets based on selected pensioner type
        async function fetchDRData() {
            const pensionerType = document.getElementById('pensionerType').value;
            
            if (!pensionerType) {
                document.getElementById('drTableStatus').textContent = 'Please select a pensioner type to load DR data';
                document.getElementById('drTableStatus').className = 'alert alert-info';
                return;
            }
            
            try {
                document.getElementById('drTableStatus').textContent = 'Loading DR data...';
                document.getElementById('drTableStatus').className = 'alert alert-warning';
                
                const drResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${pensionerType}!C2:F?key=${API_KEY}`);
                const drDataResponse = await drResponse.json();
                
                if (!drDataResponse.values || drDataResponse.values.length === 0) {
                    document.getElementById('drTableStatus').textContent = 'No DR data available for selected pension type';
                    document.getElementById('drTableStatus').className = 'alert alert-warning';
                    drData = [];
                    return;
                }
                
                drData = drDataResponse.values.map(row => ({
                    fromDate: row[0] || '',
                    toDate: row[1] || '',
                    revisionNo: row[2] || '',
                    drDue: parseFloat(row[3] ? row[3].replace('%', '') : 0) || 0
                })).filter(item => item.fromDate && item.toDate);
                
                populateRevisionNoDropdowns();
                
                document.getElementById('drTableStatus').textContent = `DR data loaded for ${pensionerType}. Click "Calculate DR" to fetch DR values.`;
                document.getElementById('drTableStatus').className = 'alert alert-success';
                
            } catch (error) {
                console.error('Error fetching DR data:', error);
                document.getElementById('drTableStatus').textContent = 'Error loading DR data. Please try again.';
                document.getElementById('drTableStatus').className = 'alert alert-danger';
                drData = [];
            }
        }

        // Populate Revision No dropdowns
        function populateRevisionNoDropdowns() {
            const revisionNoFrom = document.getElementById('revisionNoFrom');
            const revisionNoTo = document.getElementById('revisionNoTo');
            
            revisionNoFrom.innerHTML = '<option value="">Select Revision No</option>';
            revisionNoTo.innerHTML = '<option value="">Select Revision No</option>';
            
            const revisionNos = [...new Set(drData.map(item => item.revisionNo))].filter(val => val);
            
            revisionNos.forEach(revNo => {
                const optionFrom = document.createElement('option');
                optionFrom.value = revNo;
                optionFrom.textContent = revNo;
                revisionNoFrom.appendChild(optionFrom);
                
                const optionTo = document.createElement('option');
                optionTo.value = revNo;
                optionTo.textContent = revNo;
                revisionNoTo.appendChild(optionTo);
            });
        }

        // Parse date in dd/mm/yyyy format
        function parseDate(dateString) {
            if (dateString.includes('/')) {
                const parts = dateString.split('/');
                return new Date(parts[2], parts[1] - 1, parts[0]);
            } else if (dateString.includes('-')) {
                return new Date(dateString);
            } else {
                return new Date(dateString);
            }
        }

        // Format date to DD/MM/YYYY for display in table
        function formatDateToDDMMYYYY(date) {
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            return `${day}/${month}/${year}`;
        }

        // Calculate months between two dates
        function calculateMonthsBetweenDates(fromDateStr, toDateStr) {
            const fromDate = parseDate(fromDateStr);
            const toDate = parseDate(toDateStr);
            
            let months = (toDate.getFullYear() - fromDate.getFullYear()) * 12;
            months += toDate.getMonth() - fromDate.getMonth();
            
            if (toDate.getDate() >= fromDate.getDate()) {
                months += 1;
            }
            
            return Math.max(months, 1);
        }

        // Clear DR table
        function clearDRTable() {
            const tableBody = document.getElementById('drTableBody');
            const tableFooter = document.getElementById('drTableFooter');
            
            tableBody.innerHTML = '';
            tableFooter.innerHTML = '';
            tableRows = [];
            document.getElementById('addRowSection').style.display = 'none';
        }

        // Get DR% Due by date range and revision number
        function getDRDueByDateRangeAndRevision(fromDate, toDate, revisionNo) {
            const from = parseDate(fromDate);
            const to = parseDate(toDate);
            
            const matchingRecord = drData.find(item => {
                const itemFrom = parseDate(item.fromDate);
                const itemTo = parseDate(item.toDate);
                const itemRevisionNo = item.revisionNo;
                
                return ((from >= itemFrom && from <= itemTo) || 
                       (to >= itemFrom && to <= itemTo) ||
                       (itemFrom >= from && itemFrom <= to)) &&
                       itemRevisionNo === revisionNo;
            });
            
            return matchingRecord ? matchingRecord.drDue : 0;
        }

        // Get DR for a specific period from filtered data
        function getDRForPeriod(fromDate, toDate, filteredData) {
            const from = parseDate(fromDate);
            const to = parseDate(toDate);
            
            const matchingRecord = filteredData.find(item => {
                const itemFrom = parseDate(item.fromDate);
                const itemTo = parseDate(item.toDate);
                
                return ((from >= itemFrom && from <= itemTo) || 
                       (to >= itemFrom && to <= itemTo) ||
                       (itemFrom >= from && itemFrom <= to));
            });
            
            return matchingRecord ? matchingRecord.drDue : 0;
        }

        // ALWAYS ROUND UP to nearest integer
        function roundUpAmount(amount) {
            return Math.ceil(amount);
        }

        // Remove row from table
        function removeRow(index) {
            tableRows.splice(index, 1);
            renderTable();
            updateGrandTotal();
        }

        // Add new row to table
        function addNewRow() {
            const basicPensionDue = parseFloat(document.getElementById('basicPensionDue').value) || 0;
            const basicPensionDrawn = parseFloat(document.getElementById('basicPensionDrawn').value) || 0;
            const revisionNoFrom = document.getElementById('revisionNoFrom').value;
            const revisionNoTo = document.getElementById('revisionNoTo').value;
            
            let lastToDate = new Date();
            if (tableRows.length > 0) {
                lastToDate = new Date(parseDate(tableRows[tableRows.length - 1].toDate));
                lastToDate.setDate(lastToDate.getDate() + 1);
            }
            
            const newFromDate = formatDateToDDMMYYYY(lastToDate);
            const newToDate = formatDateToDDMMYYYY(new Date(lastToDate.getFullYear(), lastToDate.getMonth() + 1, lastToDate.getDate()));
            
            const months = calculateMonthsBetweenDates(newFromDate, newToDate);
            
            const newRow = {
                fromDate: newFromDate,
                toDate: newToDate,
                dueBasicPension: basicPensionDue,
                drDue: 0,
                drAmountDue: 0,
                amountDue: 0,
                drawnBasicPension: basicPensionDrawn,
                drawnDR: 0,
                drAmountDrawn: 0,
                amountDrawn: 0,
                difference: 0,
                months: months,
                grossAmount: 0,
                revisionNoDue: revisionNoTo,
                revisionNoDrawn: revisionNoFrom
            };
            
            tableRows.push(newRow);
            renderTable();
        }

        // Render table with current data - ADDED DR AMOUNT COLUMNS
        function renderTable() {
            const tableBody = document.getElementById('drTableBody');
            tableBody.innerHTML = '';
            
            tableRows.forEach((row, index) => {
                const tr = document.createElement('tr');
                
                tr.innerHTML = `
                    <td><input type="text" class="editable-input" value="${row.fromDate}" data-field="fromDate" data-index="${index}"></td>
                    <td><input type="text" class="editable-input" value="${row.toDate}" data-field="toDate" data-index="${index}"></td>
                    <td><input type="number" class="editable-input" value="${row.dueBasicPension}" data-field="dueBasicPension" data-index="${index}"></td>
                    <td>
                        <div class="dr-due-container">
                            <input type="number" class="editable-input dr-due-input" value="${row.drDue}" data-field="drDue" data-index="${index}">
                            <span class="revision-label">${row.revisionNoDue || 'N/A'}</span>
                        </div>
                    </td>
                    <td><input type="number" class="editable-input dr-amount-due" value="${row.drAmountDue}" data-field="drAmountDue" data-index="${index}" readonly></td>
                    <td><input type="number" class="editable-input amount-due" value="${row.amountDue}" data-field="amountDue" data-index="${index}"></td>
                    
                    <!-- Drawn Details -->
                    <td><input type="number" class="editable-input drawn-basic-pension" value="${row.drawnBasicPension}" data-field="drawnBasicPension" data-index="${index}"></td>
                    <td>
                        <div class="dr-due-container">
                            <input type="number" class="editable-input drawn-dr" value="${row.drawnDR}" data-field="drawnDR" data-index="${index}">
                            <span class="revision-label">${row.revisionNoDrawn || 'N/A'}</span>
                        </div>
                    </td>
                    <td><input type="number" class="editable-input dr-amount-drawn" value="${row.drAmountDrawn}" data-field="drAmountDrawn" data-index="${index}" readonly></td>
                    <td><input type="number" class="editable-input amount-drawn" value="${row.amountDrawn}" data-field="amountDrawn" data-index="${index}"></td>
                    
                    <!-- Difference Details -->
                    <td><input type="number" class="editable-input difference" value="${row.difference}" data-field="difference" data-index="${index}" readonly></td>
                    <td><input type="number" class="editable-input months" value="${row.months}" data-field="months" data-index="${index}"></td>
                    <td><input type="number" class="editable-input gross-amount" value="${row.grossAmount}" data-field="grossAmount" data-index="${index}" readonly></td>
                    
                    <!-- Action Buttons -->
                    <td class="action-buttons">
                        <button class="btn btn-danger btn-sm remove-row" data-index="${index}">
                            <i class="bi bi-trash"></i>
                        </button>
                    </td>
                `;
                
                tableBody.appendChild(tr);
            });
            
            addEventListenersToTable();
            
            // Show the table and add row section
            document.getElementById('drTable').style.display = 'table';
            document.getElementById('addRowSection').style.display = 'block';
        }

        // Add event listeners to table elements
        function addEventListenersToTable() {
            document.querySelectorAll('.editable-input').forEach(input => {
                if (!input.readOnly) {
                    input.addEventListener('change', function() {
                        const index = parseInt(this.getAttribute('data-index'));
                        const field = this.getAttribute('data-field');
                        const value = this.value;
                        
                        if (field === 'fromDate' || field === 'toDate') {
                            tableRows[index][field] = value;
                            const months = calculateMonthsBetweenDates(
                                tableRows[index].fromDate, 
                                tableRows[index].toDate
                            );
                            tableRows[index].months = months;
                            document.querySelector(`.months[data-index="${index}"]`).value = months;
                        } 
                        else {
                            tableRows[index][field] = parseFloat(value) || 0;
                        }
                    });
                }
            });
            
            document.querySelectorAll('.remove-row').forEach(button => {
                button.addEventListener('click', function() {
                    const index = parseInt(this.getAttribute('data-index'));
                    removeRow(index);
                });
            });
        }

        // Step 1: Calculate DR values
        function calculateDR() {
            const pensionerType = document.getElementById('pensionerType').value;
            const fromDate = document.getElementById('fromDate').value;
            const toDate = document.getElementById('toDate').value;
            const basicPensionDue = parseFloat(document.getElementById('basicPensionDue').value) || 0;
            const basicPensionDrawn = parseFloat(document.getElementById('basicPensionDrawn').value) || 0;
            const revisionNoFrom = document.getElementById('revisionNoFrom').value;
            const revisionNoTo = document.getElementById('revisionNoTo').value;
            
            if (!pensionerType || !fromDate || !toDate || !revisionNoFrom || !revisionNoTo) {
                document.getElementById('drTableStatus').textContent = 'Please fill all required fields: Pensioner Type, From Date, To Date, Revision No From, and Revision No To';
                document.getElementById('drTableStatus').className = 'alert alert-warning';
                return;
            }
            
            if (drData.length === 0) {
                document.getElementById('drTableStatus').textContent = 'No DR data available. Please select a valid pensioner type.';
                document.getElementById('drTableStatus').className = 'alert alert-warning';
                return;
            }
            
            try {
                document.getElementById('drTableStatus').textContent = 'Calculating DR values...';
                document.getElementById('drTableStatus').className = 'alert alert-warning';
                
                const userFromDate = new Date(fromDate);
                const userToDate = new Date(toDate);
                
                const filteredDRDataDue = drData.filter(item => {
                    const itemFrom = parseDate(item.fromDate);
                    const itemTo = parseDate(item.toDate);
                    return (itemFrom <= userToDate && itemTo >= userFromDate) && 
                           item.revisionNo === revisionNoTo;
                });
                
                const filteredDRDataDrawn = drData.filter(item => {
                    const itemFrom = parseDate(item.fromDate);
                    const itemTo = parseDate(item.toDate);
                    return (itemFrom <= userToDate && itemTo >= userFromDate) && 
                           item.revisionNo === revisionNoFrom;
                });
                
                if (filteredDRDataDue.length === 0 || filteredDRDataDrawn.length === 0) {
                    document.getElementById('drTableStatus').textContent = 'No DR data available for the selected date range and revision numbers';
                    document.getElementById('drTableStatus').className = 'alert alert-warning';
                    return;
                }
                
                filteredDRDataDue.sort((a, b) => parseDate(a.fromDate) - parseDate(b.fromDate));
                filteredDRDataDrawn.sort((a, b) => parseDate(a.fromDate) - parseDate(b.fromDate));
                
                // Clear existing rows and create new ones with Basic Pension values
                tableRows = [];
                
                const calculationPeriods = [];
                
                for (let i = 0; i < filteredDRDataDue.length; i++) {
                    const currentRow = filteredDRDataDue[i];
                    let periodFromDate, periodToDate;
                    
                    if (i === 0) {
                        periodFromDate = formatDateToDDMMYYYY(userFromDate);
                    } else {
                        const prevToDate = new Date(parseDate(calculationPeriods[i-1].toDate));
                        prevToDate.setDate(prevToDate.getDate() + 1);
                        periodFromDate = formatDateToDDMMYYYY(prevToDate);
                    }
                    
                    const drToDate = parseDate(currentRow.toDate);
                    const periodToDateObj = drToDate < userToDate ? drToDate : userToDate;
                    periodToDate = formatDateToDDMMYYYY(periodToDateObj);
                    
                    if (parseDate(periodFromDate) > parseDate(periodToDate)) {
                        periodFromDate = periodToDate;
                    }
                    
                    const drawnDRForPeriod = getDRForPeriod(periodFromDate, periodToDate, filteredDRDataDrawn);
                    
                    calculationPeriods.push({
                        fromDate: periodFromDate,
                        toDate: periodToDate,
                        drDue: currentRow.drDue,
                        revisionNoDue: currentRow.revisionNo,
                        drawnDR: drawnDRForPeriod,
                        revisionNoDrawn: revisionNoFrom
                    });
                    
                    if (periodToDateObj.getTime() === userToDate.getTime()) {
                        break;
                    }
                }
                
                // Create table rows with Basic Pension values from form
                calculationPeriods.forEach((row, index) => {
                    const months = calculateMonthsBetweenDates(row.fromDate, row.toDate);
                    
                    // Calculate DR Amounts (ALWAYS ROUND UP)
                    const drAmountDue = (basicPensionDue * row.drDue / 100);
                    const drAmountDrawn = (basicPensionDrawn * row.drawnDR / 100);
                    
                    // Calculate Amount Due and Amount Drawn (ALWAYS ROUND UP)
                    const amountDue = basicPensionDue + drAmountDue;
                    const amountDrawn = basicPensionDrawn + drAmountDrawn;
                    
                    tableRows.push({
                        fromDate: row.fromDate,
                        toDate: row.toDate,
                        dueBasicPension: basicPensionDue,
                        drDue: row.drDue,
                        drAmountDue: roundUpAmount(drAmountDue),
                        amountDue: roundUpAmount(amountDue),
                        drawnBasicPension: basicPensionDrawn,
                        drawnDR: row.drawnDR,
                        drAmountDrawn: roundUpAmount(drAmountDrawn),
                        amountDrawn: roundUpAmount(amountDrawn),
                        difference: 0,
                        months: months,
                        grossAmount: 0,
                        revisionNoDue: row.revisionNoDue,
                        revisionNoDrawn: row.revisionNoDrawn
                    });
                });
                
                renderTable();
                
                document.getElementById('drTableStatus').textContent = 'DR values calculated. Basic Pension values have been auto-filled. Click "Calculate Amount" to complete calculation.';
                document.getElementById('drTableStatus').className = 'alert alert-success';
                
            } catch (error) {
                console.error('Error calculating DR:', error);
                document.getElementById('drTableStatus').textContent = 'Error during DR calculation. Please check your inputs.';
                document.getElementById('drTableStatus').className = 'alert alert-danger';
            }
        }

        // Step 2: Calculate Amounts
        function calculateAmount() {
            if (tableRows.length === 0) {
                document.getElementById('drTableStatus').textContent = 'Please calculate DR values first.';
                document.getElementById('drTableStatus').className = 'alert alert-warning';
                return;
            }
            
            try {
                document.getElementById('drTableStatus').textContent = 'Calculating amounts...';
                document.getElementById('drTableStatus').className = 'alert alert-warning';
                
                let grandTotal = 0;
                
                tableRows.forEach((row, index) => {
                    // Get current input values (in case user modified them)
                    const dueBasicPensionInput = document.querySelector(`.editable-input[data-field="dueBasicPension"][data-index="${index}"]`);
                    const drawnBasicPensionInput = document.querySelector(`.editable-input[data-field="drawnBasicPension"][data-index="${index}"]`);
                    const amountDueInput = document.querySelector(`.editable-input[data-field="amountDue"][data-index="${index}"]`);
                    const amountDrawnInput = document.querySelector(`.editable-input[data-field="amountDrawn"][data-index="${index}"]`);
                    const monthsInput = document.querySelector(`.editable-input[data-field="months"][data-index="${index}"]`);
                    
                    // Get values from inputs
                    const dueBasicPension = parseFloat(dueBasicPensionInput.value) || 0;
                    const drawnBasicPension = parseFloat(drawnBasicPensionInput.value) || 0;
                    const amountDue = parseFloat(amountDueInput.value) || 0;
                    const amountDrawn = parseFloat(amountDrawnInput.value) || 0;
                    const months = parseFloat(monthsInput.value) || 0;
                    
                    // Update row data with current values
                    row.dueBasicPension = dueBasicPension;
                    row.drawnBasicPension = drawnBasicPension;
                    row.months = months;
                    
                    // Calculate DR Amounts based on current Basic Pension values (ALWAYS ROUND UP)
                    const drAmountDue = (row.dueBasicPension * row.drDue / 100);
                    const drAmountDrawn = (row.drawnBasicPension * row.drawnDR / 100);
                    
                    row.drAmountDue = roundUpAmount(drAmountDue);
                    row.drAmountDrawn = roundUpAmount(drAmountDrawn);
                    
                    // Calculate Amount Due and Amount Drawn based on current values (ALWAYS ROUND UP)
                    // If user manually entered values, use them, otherwise calculate
                    let finalAmountDue, finalAmountDrawn;
                    
                    if (amountDue > 0 && amountDue !== row.amountDue) {
                        // User manually entered Amount Due, use it
                        finalAmountDue = amountDue;
                    } else {
                        // Calculate Amount Due = Basic Pension Due + DR Amount Due
                        finalAmountDue = row.dueBasicPension + row.drAmountDue;
                        finalAmountDue = roundUpAmount(finalAmountDue);
                    }
                    
                    if (amountDrawn > 0 && amountDrawn !== row.amountDrawn) {
                        // User manually entered Amount Drawn, use it
                        finalAmountDrawn = amountDrawn;
                    } else {
                        // Calculate Amount Drawn = Basic Pension Drawn + DR Amount Drawn
                        finalAmountDrawn = row.drawnBasicPension + row.drAmountDrawn;
                        finalAmountDrawn = roundUpAmount(finalAmountDrawn);
                    }
                    
                    row.amountDue = finalAmountDue;
                    row.amountDrawn = finalAmountDrawn;
                    
                    // Update the input fields with final values
                    amountDueInput.value = row.amountDue;
                    amountDrawnInput.value = row.amountDrawn;
                    
                    // Calculate Difference = Amount Due - Amount Drawn (EXACT calculation, no rounding)
                    const difference = row.amountDue - row.amountDrawn;
                    row.difference = difference;
                    
                    // Calculate Gross Amount = Difference × Months (EXACT calculation, no rounding)
                    const grossAmount = row.difference * row.months;
                    row.grossAmount = grossAmount;
                    
                    grandTotal += row.grossAmount;
                    
                    // Update table cells
                    document.querySelector(`.dr-amount-due[data-index="${index}"]`).value = row.drAmountDue;
                    document.querySelector(`.dr-amount-drawn[data-index="${index}"]`).value = row.drAmountDrawn;
                    document.querySelector(`.difference[data-index="${index}"]`).value = row.difference;
                    document.querySelector(`.gross-amount[data-index="${index}"]`).value = row.grossAmount;
                });
                
                // Update footer with grand total
                const tableFooter = document.getElementById('drTableFooter');
                tableFooter.innerHTML = `
                    <tr class="total-row">
                        <td colspan="12" class="text-end"><strong>Grand Total:</strong></td>
                        <td><strong id="grandTotal">${Math.ceil(grandTotal)}</strong></td><td></td>
                    </tr>
                `;
                
                document.getElementById('drTableStatus').textContent = `Amount calculation completed. Grand Total: ${Math.ceil(grandTotal)}`;
                document.getElementById('drTableStatus').className = 'alert alert-success';
                
            } catch (error) {
                console.error('Error calculating amounts:', error);
                document.getElementById('drTableStatus').textContent = 'Error during amount calculation. Please check your inputs.';
                document.getElementById('drTableStatus').className = 'alert alert-danger';
            }
        }

        // Update grand total when values change
        function updateGrandTotal() {
            let grandTotal = 0;
            tableRows.forEach(row => {
                grandTotal += row.grossAmount;
            });
            document.getElementById('grandTotal').textContent = Math.ceil(grandTotal);
        }

        // Reset form to initial state
        function resetForm() {
            document.getElementById('treasury').value = '';
            document.getElementById('pensionerType').value = '';
            document.getElementById('pensionerCode').value = '';
            document.getElementById('pensionerName').value = '';
            document.getElementById('basicPensionDrawn').value = '';
            document.getElementById('drawnDR').value = '';
            document.getElementById('basicPensionDue').value = '';
            document.getElementById('revisionNoFrom').value = '';
            document.getElementById('revisionNoTo').value = '';
            initializeDates();
            clearDRTable();
            document.getElementById('drTableStatus').textContent = 'Please fill all details and click "Calculate DR" to start calculation.';
            document.getElementById('drTableStatus').className = 'alert alert-info';
            document.getElementById('drTable').style.display = 'none';
        }

        // Print calculation
function printCalculation() {
    if (tableRows.length === 0) {
        alert('Please calculate first before printing.');
        return;
    }
    
    document.getElementById('printPensionerName').textContent = 
        document.getElementById('pensionerName').value.toUpperCase() || 'NOT PROVIDED';
    
    const treasury = document.getElementById('treasury').value;
    const pensionerType = document.getElementById('pensionerType').value;
    const pensionerCode = document.getElementById('pensionerCode').value;
    const fullPensionerCode = `${treasury} - ${pensionerType} / ${pensionerCode}`;
    document.getElementById('printPensionerCode').textContent = fullPensionerCode || 'NOT PROVIDED';
    
    const fromDate = document.getElementById('fromDate').value;
    const toDate = document.getElementById('toDate').value;
    
    if (fromDate) {
        const fromDateObj = new Date(fromDate);
        document.getElementById('printFromDate').textContent = formatDateToDDMMYYYY(fromDateObj);
    } else {
        document.getElementById('printFromDate').textContent = 'NOT PROVIDED';
    }
    
    if (toDate) {
        const toDateObj = new Date(toDate);
        document.getElementById('printToDate').textContent = formatDateToDDMMYYYY(toDateObj);
    } else {
        document.getElementById('printToDate').textContent = 'NOT PROVIDED';
    }
    
    // Update remarks in print
    document.getElementById('printRemarks').textContent = document.getElementById('remarks').value || '';
    
    const printTableBody = document.getElementById('printTableBody');
    printTableBody.innerHTML = '';
    
    let grandTotal = 0;
    
    tableRows.forEach((row, index) => {
        grandTotal += row.grossAmount;
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${row.fromDate}</td>
            <td>${row.toDate}</td>
            <td>${row.dueBasicPension}</td>
            <td>${row.drDue}%</td>
            <td>${row.drAmountDue}</td>
            <td>${row.amountDue}</td>
            <td>${row.drawnBasicPension}</td>
            <td>${row.drawnDR}%</td>
            <td>${row.drAmountDrawn}</td>
            <td>${row.amountDrawn}</td>
            <td>${row.difference}</td>
            <td>${row.months}</td>
            <td>${row.grossAmount}</td>
        `;
        printTableBody.appendChild(tr);
    });
    
    // Update grand total in print footer
    document.getElementById('printGrandTotal').textContent = Math.ceil(grandTotal);
    
    document.getElementById('printSection').style.display = 'block';
    window.print();
    document.getElementById('printSection').style.display = 'none';
}
