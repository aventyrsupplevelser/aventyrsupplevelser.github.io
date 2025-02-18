// bookingscript.js


/***************************************
         * 1) Initialize Supabase client
         ***************************************/


 const { createClient } = supabase;
 const supabaseClient = createClient(
     'https://czbvtmrqzvovytzqokko.supabase.co',
     'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN6YnZ0bXJxenZvdnl0enFva2tvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzU0OTEzNzAsImV4cCI6MjA1MTA2NzM3MH0.ndbAxa4eaqP8coL61aSWQ9oxt1kt3f9vmvumUcV8Olo'
 ); 

 /***************************************
  * 2) Constants & Global State
  ***************************************/
 const available = "rgb(173, 240, 159)";
 const notAvailable = "rgb(255, 128, 124)";
 const fewLeft = "rgb(255, 199, 5)";

 // Keep track of which time slot is selected
 let currentTimeSlot = null;

 // This object stores the user’s ticket selections:
 const ticketState = {
     adult: 0,
     youth: 0,
     kid: 0,
     fullday: 0,
     is_rebookable: false,
 };

 // Prices for each type of ticket
 const PRICES = {
     adult: 400,
     youth: 300,
     kid: 200,
     fullday: 100,
     rebooking: 25  // 25 kr per person if rebookable
 };

 /****************************************
  * 3) BookingCalendar Class
  *    - Renders month days
  *    - Fetches available dates
  *    - Allows user to select a date
  ****************************************/
 class BookingCalendar {
     constructor(container) {
         this.container = container;
         this.selectedDate = null;
         this.availableDates = {};
         this.currentMonth = new Date();
         this.currentMonth.setDate(1);
         this.init();
     }

     async init() {
         // First, render the calendar for the current month.
         this.render();

         // Then, fetch the available dates.
         await this.fetchAvailableDates();

         // If no available dates were found on the initial load, try moving forward.
         if (Object.keys(this.availableDates).length === 0) {
             this.changeMonth(1);
         }
     }

     async fetchAvailableDates() {
         try {
             const year = this.currentMonth.getFullYear();
             const month = this.currentMonth.getMonth() + 1;

             // Start & end of selected month
             const startOfMonth = new Date(year, month - 1, 1, 0, 0, 0);
             const endOfMonth = new Date(year, month, 0, 23, 59, 59);

             // If user is on the current month, skip any times < now+60 min
             const now = new Date();
             const cutoffTime = new Date();
             cutoffTime.setMinutes(cutoffTime.getMinutes() + 60);

             const isCurrentMonth = (now.getMonth() === startOfMonth.getMonth()) &&
                 (now.getFullYear() === startOfMonth.getFullYear());
             const queryStartTime = isCurrentMonth ? cutoffTime : startOfMonth;

             // Fetch from Supabase
             const { data: slots, error } = await supabaseClient
                 .from('time_slots')
                 .select('start_time, total_spots, available_spots')
                 .eq('blocked', false) // Add this line to exclude blocked slots
                 .gte('start_time', queryStartTime.toISOString())
                 .lt('start_time', endOfMonth.toISOString());

             if (error) throw error;

             // Tally totalSpots & availableSpots by date
             const dateAvailability = {};
             slots.forEach(slot => {
                 const date = new Date(slot.start_time);
                 const dateStr = date.toISOString().split('T')[0];

                 if (!dateAvailability[dateStr]) {
                     dateAvailability[dateStr] = { totalSpots: 0, availableSpots: 0 };
                 }
                 dateAvailability[dateStr].totalSpots += slot.total_spots;
                 dateAvailability[dateStr].availableSpots += slot.available_spots;
             });

             this.availableDates = dateAvailability;
             this.updateAvailableDays();
         } catch (error) {
             console.error('Error fetching available dates:', error);
         }
     }

     render() {
         // Build the calendar HTML
         this.container.innerHTML = `
       <div class="calendar-container">
         <div class="calendar-header">
           <button id="prevMonth"><span class="material-symbols-outlined">
arrow_left_alt
</span></button>
           <h3>${this.getMonthDisplay()}</h3>
           <button id="nextMonth"><span class="material-symbols-outlined">
arrow_right_alt
</span></button>
         </div>
         <div class="calendar-grid">
           ${this.renderWeekdays()}
           ${this.renderDays()}
         </div>
         <div class="calendar-legend">
           <div class="legend-item">
             <div class="legend-dot" style="background-color: ${available};"></div>
             <span>Finns platser</span>
           </div>
           <div class="legend-item">
             <div class="legend-dot" style="background-color: ${fewLeft};"></div>
             <span>Få platser</span>
           </div>
           <div class="legend-item">
             <div class="legend-dot" style="background-color: ${notAvailable};"></div>
             <span>Fullbokat</span>
           </div>
         </div>
       </div>
     `;

         // Next / Prev month & day clicks
         this.attachEventListeners();
     }

     getMonthDisplay() {
         return this.currentMonth.toLocaleDateString('sv-SE', {
             month: 'long',
             year: 'numeric'
         });
     }

     renderWeekdays() {
         const weekdays = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];
         return weekdays.map(day => `<div class="calendar-weekday">${day}</div>`).join('');
     }

     renderDays() {
         const days = [];
         const firstDay = new Date(this.currentMonth.getFullYear(), this.currentMonth.getMonth(), 1).getDay();
         const offset = (firstDay === 0) ? 6 : firstDay - 1; // Monday-based offset
         const daysInMonth = new Date(this.currentMonth.getFullYear(), this.currentMonth.getMonth() + 1, 0).getDate();

         // Empty cells before first day
         for (let i = 0; i < offset; i++) {
             days.push('<div></div>');
         }

         // Render each day
         for (let day = 1; day <= daysInMonth; day++) {
             const dateStr = `${this.currentMonth.getFullYear()}-${String(this.currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
             const isPast = new Date(dateStr) < new Date(new Date().toDateString());

             days.push(`
         <button 
           type="button"
           class="calendar-day" 
           data-date="${dateStr}"
           ${isPast ? 'disabled' : ''}
         >
           ${day}
         </button>
       `);
         }
         return days.join('');
     }

     attachEventListeners() {
         // Next / Prev month
         const prevMonthButton = this.container.querySelector('#prevMonth');
         const nextMonthButton = this.container.querySelector('#nextMonth');

         // If in current month, disable prev
         const now = new Date();
         const isCurrentMonth = this.currentMonth.getMonth() === now.getMonth() &&
             this.currentMonth.getFullYear() === now.getFullYear();
         if (isCurrentMonth) {
             prevMonthButton.disabled = true;
             prevMonthButton.style.opacity = '0.5';
             prevMonthButton.style.cursor = 'not-allowed';
         } else {
             prevMonthButton.disabled = false;
             prevMonthButton.style.opacity = '1';
             prevMonthButton.style.cursor = 'pointer';
         }

         prevMonthButton.addEventListener('click', async (e) => {
             e.preventDefault();
             this.changeMonth(-1);
         });

         nextMonthButton.addEventListener('click', async (e) => {
             e.preventDefault();
             this.changeMonth(+1);
         });

         // Day clicks
         this.container.querySelectorAll('.calendar-day').forEach(day => {
             day.addEventListener('click', (e) => {
                 if (!e.target.disabled) {
                     const dateStr = e.target.dataset.date;
                     this.selectDate(dateStr);
                 }
             });
         });
     }

     async changeMonth(direction, depth = 0) {
         currentTimeSlot = null;
         document.querySelectorAll('.time-slot').forEach(slot => slot.classList.remove('selected'));
         updateTicketButtonStates();
         clearTicketSelections();
         loadTimeSlots();
         const maxDepth = 7; // maximum number of months to skip in a row
         // Calculate the new month based on the direction
         const newMonth = new Date(this.currentMonth);
         newMonth.setMonth(this.currentMonth.getMonth() + direction);

         // Prevent going backwards before the current month if that's desired
         const now = new Date();
         const currentMonthYear = new Date(now.getFullYear(), now.getMonth());
         if (direction < 0 && newMonth < currentMonthYear) {
             return; // do nothing if trying to go back too far
         }

         // Set and render the new month
         this.currentMonth = newMonth;
         this.render();

         // Refresh available dates for the current month
         await this.fetchAvailableDates();

         // Check if any available dates were found for this month.
         // (Assuming fetchAvailableDates() updates this.availableDates.)
         if (Object.keys(this.availableDates).length === 0 && depth < maxDepth) {
             // No available dates were found in this month—skip to the next/previous month.
             return this.changeMonth(direction, depth + 1);
         }

         // Finally, update the days in the calendar (which colors them based on availability, etc.)
         this.updateAvailableDays();
     }


     updateAvailableDays() {
         // Color each day according to availability
         this.container.querySelectorAll('.calendar-day').forEach(day => {
             const dateStr = day.dataset.date;
             const availability = this.availableDates[dateStr];

             if (availability) {
                 const ratio = availability.availableSpots / availability.totalSpots;

                 if (ratio === 0) {
                     day.style.backgroundColor = notAvailable;
                     day.disabled = true;
                 } else if (ratio <= 0.5) {
                     day.style.backgroundColor = fewLeft;
                     day.classList.add('available');
                 } else {
                     day.style.backgroundColor = available;
                     day.classList.add('available');
                 }
             } else {
                 // Not available at all
                 day.style.backgroundColor = 'rgb(240, 240, 240)';
                 day.disabled = true;
             }
         });
     }

     selectDate(dateStr) {
         document.getElementById('messageContainer').style.display = 'none';
         // Remove any previously selected
         this.container.querySelectorAll('.calendar-day').forEach(d => d.classList.remove('selected'));

         // Mark this day as selected
         const selectedBtn = this.container.querySelector(`[data-date="${dateStr}"]`);
         selectedBtn?.classList.add('selected');

         // Clear any previously selected time slot
         document.querySelectorAll('.time-slot').forEach(slot => slot.classList.remove('selected'));
         currentTimeSlot = null;

         this.selectedDate = dateStr;

         // Show the times section
         const timesSection = document.getElementById('times');
         const timeSlotsContainer = document.getElementById('timeSlots');
         timesSection.classList.add('visible');
         timeSlotsContainer.classList.add('visible');

         // Scroll to times
         timeSlotsContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

         // Actually load the time slots for this date
         loadTimeSlots(dateStr);
         updateTicketButtonStates();
     }
 }

 /****************************************
  * 4) Load Time Slots for a Given Date
  ****************************************/
 async function loadTimeSlots(dateStr) {
     try {
         // Reset ticket & times
         clearTicketSelections();

         // Start & end of selected day
         const startOfDay = new Date(`${dateStr}T00:00:00`);
         const endOfDay = new Date(`${dateStr}T23:59:59`);

         // 60-min cutoff from now
         const cutoffTime = new Date();
         cutoffTime.setMinutes(cutoffTime.getMinutes() + 60);

         const { data: slots, error } = await supabaseClient
             .from('time_slots')
             .select('*')
             .eq('blocked', false) // Add this line to exclude blocked slots
             .gte('start_time', cutoffTime.toISOString())
             .gte('start_time', startOfDay.toISOString())
             .lte('start_time', endOfDay.toISOString())
             .order('start_time');

         if (error) throw error;

         const timeSlotsEl = document.getElementById('timeSlots');
         if (!slots || slots.length === 0) {
             timeSlotsEl.innerHTML = `
         <p style="min-width: 300px;">
           Inga lediga tider detta datum. <br><br>
           Om ni är fler än 10 kan ni boka en tid
           utanför de i kalendern genom att maila oss.
         </p>`;
             return;
         }

         // Generate HTML for each slot
         const slotHtml = slots.map(slot => {
             const localTime = new Date(slot.start_time);
             let bgColor = available;
             let isSelectable = true;

             if (slot.available_spots === 0) {
                 bgColor = notAvailable;
                 isSelectable = false;
             } else if (slot.available_spots < 10) {
                 bgColor = fewLeft;
             }

             const timeStr = localTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
             return `
         <div 
           class="time-slot ${!isSelectable ? 'disabled' : ''}"
           data-slot-id="${slot.id}"
           data-allows-fullday="${slot.allow_full_day}"
           data-available-spots="${slot.available_spots}"
           data-availability-color="${bgColor}"
           style="background-color: ${bgColor}; ${!isSelectable ? 'cursor: not-allowed; opacity: 0.4;' : ''}"
         >
           ${timeStr}
         </div>
       `;
         }).join('');

         timeSlotsEl.innerHTML = slotHtml;
     } catch (err) {
         console.error('Error loading time slots:', err);
         document.getElementById('timeSlots').innerHTML =
             '<p class="error">Kunde inte ladda tider. Försök igen.</p>';
     }
 }

 /****************************************
  * 5) Select a Time Slot (no inline onclick)
  ****************************************/
 function selectTimeSlot(slotEl) {
     if (slotEl.classList.contains('disabled')) return;

     // Remove selection from all other slots
     document.querySelectorAll('.time-slot').forEach(s => s.classList.remove('selected'));
     slotEl.classList.add('selected');

     // Update global currentTimeSlot
     currentTimeSlot = slotEl.dataset.slotId;

     // Clear ticket counts & re-check
     clearTicketSelections();

     // If slot doesn't allow full day, hide the full day section
     const allowsFullDay = (slotEl.dataset.allowsFullday === 'true');
     const fulldaySectionEl = document.querySelector('.fulldaySection');
     if (fulldaySectionEl) {
         fulldaySectionEl.style.display = allowsFullDay ? 'block' : 'none';
         if (!allowsFullDay) {
             ticketState.fullday = 0;
             document.getElementById('fulldayQuantity').textContent = '0';
         }
     }

     const timeText = slotEl.textContent.trim(); // Gets the time like "14:30"
     const dateEl = document.querySelector('.calendar-day.selected');
     const dateStr = dateEl.dataset.date; // Gets the date like "2025-02-04"
     const selectedSlotTime = new Date(`${dateStr}T${timeText}`);
     const now = new Date();
     const hoursDifference = (selectedSlotTime - now) / (1000 * 60 * 60);

     // Show/hide rebooking section based on time difference
     const rebookingSection = document.getElementById('rebooking');
     if (hoursDifference <= 30) {  // 60 days × 24 hours = 1440 hours
         rebookingSection.style.display = 'none';
         // Make sure rebooking is disabled if it was previously enabled
         ticketState.is_rebookable = false;
         const rebookingCheckbox = document.getElementById('rebookingCheckbox');
         if (rebookingCheckbox) rebookingCheckbox.checked = false;
     } else {
         rebookingSection.style.display = 'block';
     }

     // Show ticket section
     const ticketSection = document.querySelector('#tickets');
     ticketSection.classList.add('visible');
     showSection('#tickets', true);

     // Show the "continue" button but disable it until user selects tickets
     const continueBtn = document.getElementById('continueToPaymentBtn');
     continueBtn.style.display = 'block';
     continueBtn.classList.add('disabled');

     // Scroll to ticket section
     ticketSection.scrollIntoView({ behavior: 'smooth', block: 'center' });

     // Update the spots-left text
     updateSpotsLeftDisplay();
     updateTicketButtonStates();
 }

 /****************************************
  * 6) Ticket Selection Logic
  ****************************************/
 function clearTicketSelections() {
     ticketState.adult = 0;
     ticketState.youth = 0;
     ticketState.kid = 0;
     ticketState.fullday = 0;
     ticketState.is_rebookable = false;

     // Reset quantity display for all
     document.getElementById('adultQuantity').textContent = '0';
     document.getElementById('youthQuantity').textContent = '0';
     document.getElementById('kidQuantity').textContent = '0';
     document.getElementById('fulldayQuantity').textContent = '0';

     // Rebooking checkbox
     const rebookingCheckbox = document.getElementById('rebookingCheckbox');
     if (rebookingCheckbox) rebookingCheckbox.checked = false;

     // Spots left
     document.getElementById('spotsLeft').textContent = '';
     updateTotalDisplay();
 }

 function updateTicketButtonStates() {
     // If no time slot is selected, disable all ticket selector arrows
     if (!currentTimeSlot) {
         document.querySelectorAll('.quantity-btn').forEach(btn => {
             btn.disabled = true;
             btn.style.opacity = '0.5';
         });
         return;
     }

     // Otherwise, enable and update buttons normally
     const selectedSlot = document.querySelector('.time-slot.selected');
     const availableSpots = selectedSlot ? parseInt(selectedSlot.dataset.availableSpots) : 0;
     const totalChosen = ticketState.adult + ticketState.youth + ticketState.kid;

     // Update each type of ticket
     handleButton('adult', availableSpots, totalChosen);
     handleButton('youth', availableSpots, totalChosen);
     handleButton('kid', availableSpots, totalChosen);
     updateFulldayButtons();

     // Enable or disable the "continue" button based on selection
     validateTicketSelection();
 }

 function handleButton(type, availableSpots, totalChosen) {
     const plusBtn = document.querySelector(`[data-ticket-type="${type}"].plus`);
     const minusBtn = document.querySelector(`[data-ticket-type="${type}"].minus`);

     if (!plusBtn || !minusBtn) return;

     // For the plus button
     plusBtn.disabled = (!currentTimeSlot ||
         totalChosen >= availableSpots);

     // If kid, also require at least 1 adult
     if (type === 'kid' && ticketState.adult === 0) {
         plusBtn.disabled = true;
     }
     plusBtn.style.opacity = plusBtn.disabled ? '0.5' : '1';

     // For the minus button
     minusBtn.disabled = (ticketState[type] === 0);
     minusBtn.style.opacity = minusBtn.disabled ? '0.5' : '1';
 }

 function updateFulldayButtons() {
     // Fullday can’t exceed total (adult+youth+kid)
     const totalTickets = ticketState.adult + ticketState.youth + ticketState.kid;
     const plusBtn = document.querySelector('[data-ticket-type="fullday"].plus');
     const minusBtn = document.querySelector('[data-ticket-type="fullday"].minus');

     if (!plusBtn || !minusBtn) return;

     plusBtn.disabled = (ticketState.fullday >= totalTickets);
     minusBtn.disabled = (ticketState.fullday === 0);

     plusBtn.style.opacity = plusBtn.disabled ? '0.5' : '1';
     minusBtn.style.opacity = minusBtn.disabled ? '0.5' : '1';
 }

 function handleQuantityChange(type, change) {
     const selectedSlot = document.querySelector('.time-slot.selected');
     if (!selectedSlot && type !== 'fullday') {
         // Can't pick adult/youth/kid if no slot chosen
         updateTicketButtonStates();
         return;
     }

     const currentValue = ticketState[type];
     const availableSpots = selectedSlot ? parseInt(selectedSlot.dataset.availableSpots) : 0;
     const totalChosen = ticketState.adult + ticketState.youth + ticketState.kid;

     if (type === 'fullday') {
         // Full day can't exceed total chosen
         const newValue = currentValue + change;
         const totalTix = ticketState.adult + ticketState.youth + ticketState.kid;
         if (newValue >= 0 && newValue <= totalTix) {
             ticketState.fullday = newValue;
             document.getElementById('fulldayQuantity').textContent = newValue.toString();
         }
     } else {
         const newValue = currentValue + change;
         // Don’t exceed available spots
         if (newValue >= 0 && (totalChosen + change) <= availableSpots) {
             // Kid requires adult
             if (type === 'kid' && ticketState.adult === 0 && change > 0) {
                 // If we have no adult, skip
                 return;
             }
             ticketState[type] = newValue;
             document.getElementById(`${type}Quantity`).textContent = newValue.toString();
         }
     }

     if (type === 'adult' && ticketState.adult === 0 && ticketState.kid > 0) {
         ticketState.kid = 0;
         document.getElementById('kidQuantity').textContent = '0';
     }

     const mainTicketsTotal = ticketState.adult + ticketState.youth + ticketState.kid;
     if (ticketState.fullday > mainTicketsTotal) {
         ticketState.fullday = mainTicketsTotal;
         document.getElementById('fulldayQuantity').textContent = mainTicketsTotal.toString();
     }

     // Re-check after changes
     updateTicketButtonStates();
     updateSpotsLeftDisplay();
     updateTotalDisplay();
 }

 function updateSpotsLeftDisplay() {
     const spotsLeftEl = document.getElementById('spotsLeft');
     const selectedSlot = document.querySelector('.time-slot.selected');
     if (!selectedSlot) {
         spotsLeftEl.textContent = '';
         return;
     }

     const availableSpots = parseInt(selectedSlot.dataset.availableSpots);
     const totalChosen = ticketState.adult + ticketState.youth + ticketState.kid;
     const spotsLeft = availableSpots - totalChosen;

     // Darken color a bit for text
     const color = selectedSlot.dataset.availabilityColor;
     const darker = darkenColor(color);

     spotsLeftEl.style.color = darker;
     spotsLeftEl.style.fontWeight = '600';
     spotsLeftEl.textContent = `${spotsLeft} platser kvar`;
 }

 function darkenColor(color) {
     // color in "rgb(r, g, b)" => reduce each by ~50
     const rgb = color.match(/\d+/g);
     if (rgb) {
         const [r, g, b] = rgb.map(c => Math.max(0, parseInt(c) - 50));
         return `rgb(${r}, ${g}, ${b})`;
     }
     return color;
 }

 function validateTicketSelection() {
     const total = ticketState.adult + ticketState.youth + ticketState.kid;
     const btn = document.getElementById('continueToPaymentBtn');
     if (!btn) return;

     if (total === 0) {
         btn.classList.add('disabled');
     } else {
         btn.classList.remove('disabled');
     }
 }

 /****************************************
  * 7) Payment Flow, Summaries, etc.
  ****************************************/

 function updateTotalDisplay() {
     const baseTotal = (
         ticketState.adult * PRICES.adult +
         ticketState.youth * PRICES.youth +
         ticketState.kid * PRICES.kid +
         ticketState.fullday * PRICES.fullday
     );

     const totalTickets = ticketState.adult + ticketState.youth + ticketState.kid;
     const rebookingFee = ticketState.is_rebookable ? (totalTickets * PRICES.rebooking) : 0;
     const grandTotal = baseTotal + rebookingFee;

     const btn = document.getElementById('continueToPaymentBtn');
     if (btn) {
         btn.textContent = `Fortsätt till betalning: ${grandTotal} kr`;
     }
 }

 function calculateTotal(tickets) {
     // Calculate base total (without rebooking)
     const base = (
         tickets.adult * PRICES.adult +
         tickets.youth * PRICES.youth +
         tickets.kid * PRICES.kid +
         tickets.fullday * PRICES.fullday
     );

     const totalTix = tickets.adult + tickets.youth + tickets.kid;
     const rebookingFee = tickets.is_rebookable ? (totalTix * PRICES.rebooking) : 0;

     // Get any applied discounts from localStorage
     const bookingData = JSON.parse(localStorage.getItem('bookingData'));
     let giftCardAmount = 0;
     let promoDiscount = 0;

     // First apply gift card to base amount
     if (bookingData?.gift_card_applied) {
         giftCardAmount = bookingData.gift_card_applied.value;
     }

     // Then apply promo to remaining base amount after gift card
     const remainingAfterGiftCard = Math.max(0, base - giftCardAmount);

     if (bookingData?.promo_applied) {
         if (bookingData.promo_applied.is_percentage) {
             promoDiscount = remainingAfterGiftCard * (bookingData.promo_applied.value / 100);
         } else {
             promoDiscount = bookingData.promo_applied.value;
         }
     }

     // Calculate discounted base amount
     const discountedBase = Math.max(0, remainingAfterGiftCard - promoDiscount);

     // Add rebooking fee after discounts
     const totalAfterRebooking = discountedBase + rebookingFee;

     // Calculate VAT (6%) only on the base amount (excluding rebooking)
     const vatRate = 0.06;
     const vat = (discountedBase * vatRate) / (1 + vatRate);

     return {
         subtotal: base,
         giftCardAmount,
         promoDiscount,
         vat,
         rebookingFee,
         total: totalAfterRebooking
     };
 }

 function formatSwedishDate(dateStr) {
     const date = new Date(dateStr);
     const weekdays = ['söndag', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag'];
     const months = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];

     const weekday = weekdays[date.getDay()];
     const day = date.getDate();
     const month = months[date.getMonth()];

     return `${weekday} ${day} ${month}`;
 }

 function displayBookingSummary({ tickets, totals }) {
     try {
         const summaryEl = document.getElementById('bookingSummaryFinal');
         if (!summaryEl) return;

         const totalRebook = (tickets.adult + tickets.youth + tickets.kid) * PRICES.rebooking;
         const formattedDate = formatSwedishDate(tickets.date);

         const bookingData = JSON.parse(localStorage.getItem('bookingData'));
         const hasGiftCard = bookingData?.gift_card_applied;
         const hasPromo = bookingData?.promo_applied;

         summaryEl.innerHTML = `
     <p id="selectedDateTime">
         Datum: <span style="font-weight: bold;">${formattedDate}</span>
         <p>Tid: <span style="font-weight: bold;">${tickets.time || ''}</span></p>
     </p>
     <hr>
     ${tickets.adult ? `<p>Vuxen: ${tickets.adult} st <span style="float: right;">${tickets.adult * PRICES.adult} kr</span></p>` : ''}
     ${tickets.youth ? `<p>Ungdom: ${tickets.youth} st <span style="float: right;">${tickets.youth * PRICES.youth} kr</span></p>` : ''}
     ${tickets.kid ? `<p>Barn: ${tickets.kid} st <span style="float: right;">${tickets.kid * PRICES.kid} kr</span></p>` : ''}
     ${tickets.fullday ? `<p>Förlängning till heldag: ${tickets.fullday} st <span style="float: right;">${tickets.fullday * PRICES.fullday} kr</span></p>` : ''}
     <hr>
     ${hasGiftCard ? `<p style="color: #2d862d;">Presentkort: <span style="float: right;">-${totals.giftCardAmount} kr</span></p>` : ''}
     ${hasPromo ? `<p style="color: #2d862d;">Rabatt: <span style="float: right;">-${totals.promoDiscount} kr</span></p>` : ''}
     ${(hasGiftCard || hasPromo) ? '<hr>' : ''}
     <p id="totalvat">Varav moms (6%): <span style="float: right;">${totals.vat.toFixed(2)} kr</span></p>
     <hr>
                 ${tickets.is_rebookable ? `<p>Ombokningsgaranti: <span style="float: right;">${totalRebook} kr</span></p><hr>` : ''}
     <p id="totalCost" style="font-weight: bold;">Totalt att betala: <span style="float: right;">${totals.total} kr</span></p>
     <hr>
     <p id="timeRemaining" style="margin-top: 20px; opacity: 0.7; font-size: 0.8em; color: #2d862d;"></p>
 `;
     } catch (err) {
         console.error('Error displaying summary:', err);
     }
 }
 function updateTimeRemaining() {
     const bookingData = JSON.parse(localStorage.getItem('bookingData'));
     const timeRemainingEl = document.getElementById('timeRemaining');

     // If no element or no data, do nothing
     if (!timeRemainingEl || !bookingData?.expiresAt) {
         return;
     }

     const now = Date.now();
     const diffMs = bookingData.expiresAt - now;
     if (diffMs <= 0) {
         // Expired
         timeRemainingEl.textContent = "Din bokningssession har gått ut.";
         return;
     }
     const diffMinutes = Math.floor(diffMs / (1000 * 60));
     timeRemainingEl.textContent = `Gör klart din bokning inom ${diffMinutes} minut${diffMinutes !== 1 ? 'er' : ''}.`;
 }

 /********************************************
  * 8) Payment Button / Next Step Logic
  ********************************************/
 async function handleContinueToPayment() {
     try {
         // Check if user selected at least 1 ticket
         const totalTickets = ticketState.adult + ticketState.youth + ticketState.kid;
         if (!currentTimeSlot || totalTickets === 0) {
             alert('Vänligen välj minst en biljett och en tid.');
             return;
         }

         // Show customer form section
         document.getElementById('continueToPaymentBtn').style.display = 'none';
         showSection('customerSection', true);
         customerSection.scrollIntoView({ behavior: 'smooth', block: 'end' });
         showSection('paymentButtons', true);

         const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
         const swishPhoneSection = document.getElementById('swishPhoneSection');
         const alternateDeviceSection = document.getElementById('alternateDeviceSection');

         // Reset displays
         swishPhoneSection.style.display = 'none';
         alternateDeviceSection.style.display = 'none';

         // Set initial state based on device
         if (!isMobile) {
             swishPhoneSection.style.display = 'block';
         } else {
             alternateDeviceSection.style.display = 'block';
         }

         const dateEl = document.querySelector('.calendar-day.selected');
         const timeEl = document.querySelector('.time-slot.selected');

         const selectedDate = dateEl ? dateEl.dataset.date : '';
         const selectedTime = timeEl ? timeEl.textContent.trim() : '';

         // Prepare for summary
         const summaryTickets = {
             ...ticketState,
             date: selectedDate,
             time: selectedTime
         };
         const totals = calculateTotal(summaryTickets);

         // Make or update the "pending" booking on the server
         displayBookingSummary({ tickets: summaryTickets, totals });

         updateFreeBookingUI(totals);


         await createOrUpdatePendingBooking(summaryTickets);


         updateTimeRemaining();

         // Optional: Start an interval for every minute
         if (!window.timeRemainingInterval) {
             window.timeRemainingInterval = setInterval(updateTimeRemaining, 60000);
         }

     } catch (error) {
         console.error('Error in handleContinueToPayment:', error);
         // Show button again if error
         document.getElementById('continueToPaymentBtn').style.display = 'block';
         showSection('customerSection', false);
         showSection('paymentButtons', false);
         alert('Ett fel uppstod. Försök igen.');
     }
 }

 function showSection(id, show) {
     const el = document.getElementById(id);
     if (!el) return;
     el.style.display = show ? 'block' : 'none';
 }

 async function createOrUpdatePendingBooking(tickets) {
     let bookingData = JSON.parse(localStorage.getItem('bookingData'));

     // If there's no existing local booking or it's expired, create new
     if (!bookingData || Date.now() > bookingData.expiresAt) {
         const { data, error } = await supabaseClient.rpc('create_booking', {
             p_time_slot_id: currentTimeSlot,
             p_adult_quantity: tickets.adult,
             p_youth_quantity: tickets.youth,
             p_kid_quantity: tickets.kid,
             p_full_day: tickets.fullday,
             p_is_rebookable: tickets.is_rebookable
         });

         if (error) throw error;

         bookingData = {
             bookingId: data.booking_id,
             token: data.access_token,
             expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes
             booking_number: data.booking_number
         };
         localStorage.setItem('bookingData', JSON.stringify(bookingData));
     }
     else {
         // Update existing booking
         const { error } = await supabaseClient.rpc('manage_booking', {
             p_booking_id: bookingData.bookingId,
             p_access_token: bookingData.token,
             p_new_time_slot_id: currentTimeSlot,
             p_new_adult_quantity: tickets.adult,
             p_new_youth_quantity: tickets.youth,
             p_new_kid_quantity: tickets.kid,
             p_full_day: tickets.fullday,
             p_is_rebookable: tickets.is_rebookable,
             p_delete: false
         });

         if (error) throw error;

         // Extend expiry
         bookingData.expiresAt = Date.now() + 30 * 60 * 1000;
         localStorage.setItem('bookingData', JSON.stringify(bookingData));
         localStorage.removeItem('spotsReleased');
     }


 }

 /********************************************
  * 9) Payment Handling
  ********************************************/


 function showSwishPhoneInput(event) {
     if (event) event.preventDefault();
     document.getElementById('swishPhoneSection').style.display = 'block';
     document.getElementById('alternateDeviceSection').style.display = 'none';
     document.getElementById('swishPhone').focus();
 }

 function formatSwishNumber(input) {
     let number = input.replace(/\D/g, ''); // Remove all non-numeric characters

     if (number.startsWith("46")) {
         return number; // Already in correct format
     } else if (number.startsWith("0")) {
         return "46" + number.substring(1); // Remove leading zero and add country code
     } else if (number.startsWith("+46")) {
         return number.replace("+", ""); // Remove "+" if it exists
     } else {
         return null; // Invalid format
     }
 }

 async function handleSwishPayment() {

     // Get customer info
     const customerName = document.getElementById('customerName').value.trim();
     const customerEmail = document.getElementById('customerEmail').value.trim();
     const customerComment = document.getElementById('customerComment').value.trim();

     // Validate required fields
     if (!customerName || !customerEmail) {
         requiredInfoMessage.style.display = 'block';
         requiredInfoMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
         return;
     }

     // Initial validations
     const termsCheckbox = document.getElementById('termsCheckbox');
     const termsError = document.getElementById('termsError');
     if (!termsCheckbox.checked) {
         termsError.style.display = 'block';
         termsError.scrollIntoView({ behavior: 'smooth', block: 'center' });
         return;
     }
     termsError.style.display = 'none';

     // Get booking data
     const bookingData = JSON.parse(localStorage.getItem('bookingData'));
     if (!bookingData) {
         alert('No active booking found');
         return;
     }

     const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
     const swishPhoneSection = document.getElementById('swishPhoneSection');
     const alternateDeviceSection = document.getElementById('alternateDeviceSection');
     const swishPhoneError = document.getElementById('swishPhoneError');

     // Show/hide relevant sections based on device type
     if (!isMobile) {
         swishPhoneSection.style.display = 'block';
     } else {
         alternateDeviceSection.style.display = 'block';
     }

     let phoneNumber = null;
     if (swishPhoneSection.style.display === 'block') {
         phoneNumber = document.getElementById('swishPhone').value.trim();

         if (!phoneNumber) {
             swishPhoneError.style.display = 'block';
             return;
         }

         phoneNumber = formatSwishNumber(phoneNumber); // Ensure correct format

         if (!phoneNumber) {
             swishPhoneError.style.display = 'block';
             swishPhoneError.textContent = "Ogiltigt telefonnummer. Ange ett svenskt mobilnummer.";
             return;
         }

         swishPhoneError.style.display = 'none';
     }

     const paymentContainer = document.getElementById('payment-container');
     paymentContainer.style.display = 'block';
     paymentContainer.innerHTML = `
         <div style="padding-left: 3px; font-size: 1.1em;">
             Laddar swishbetalning..
         </div>
     `;

     try {
         const response = await fetch(
             'http://localhost:3000/api/swish/swish-payment',
             {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({
                     bookingNumber: bookingData.booking_number,
                     isMobile,
                     payerAlias: phoneNumber,
                     access_token: bookingData.token,
                     bookingId: bookingData.bookingId
                 })
             }
         );

         const result = await response.json();
         if (!result.success) {
             throw new Error(result.error || 'Payment failed');
         }

         if (isMobile && result.token && !phoneNumber) {
             // Open Swish app
             const returnUrl = `${window.location.origin}/tackfordinbokning.html?order_id=${bookingData.booking_number}`;
             window.location.href = `swish://paymentrequest?token=${result.token}&callbackurl=${encodeURIComponent(returnUrl)}`;
         } else {
             // Show instructions for desktop users
             paymentContainer.innerHTML = `
         <div style="padding: 5px 0px 0px 3px; font-size: 1.2em; font-weight: 700;">
             Öppna Swish-appen på din telefon
         </div>
     `;
         }

     } catch (error) {
         console.error('Swish payment error:', error);
         paymentContainer.innerHTML = `
     <div class="error" style="text-align: center; margin: 20px;">
         <p>Betalning misslyckades: ${error.message}</p>
         <button onclick="handleSwishPayment()" style="margin-top: 10px;">
             Försök igen
         </button>
     </div>
 `;
     }
     updateCustomer();
     checkPaymentStatus();

 }

 async function updateCustomer() {

     // Get customer info
     const customerName = document.getElementById('customerName').value.trim();
     const customerEmail = document.getElementById('customerEmail').value.trim();
     const customerComment = document.getElementById('customerComment').value.trim();
     const wantsNewsletter = document.getElementById('nyhetsbrev').checked;  // Get newsletter preference


     // Get session data
     const sessionData = JSON.parse(localStorage.getItem('bookingData'));
     if (!sessionData?.bookingId) throw new Error('No active booking found');

     // Update booking details
     const { error: updateError } = await supabaseClient.rpc('update_customer_details', {
         p_booking_id: sessionData.bookingId,
         p_access_token: sessionData.token,
         p_customer_name: customerName,
         p_customer_email: customerEmail,
         p_comments: customerComment,
         p_wants_newsletter: wantsNewsletter  // Add newsletter preference
     });

     if (updateError) throw updateError;

 }

 async function payByCard(paymentMethod) {

     // Get customer info
     const customerName = document.getElementById('customerName').value.trim();
     const customerEmail = document.getElementById('customerEmail').value.trim();
     const customerComment = document.getElementById('customerComment').value.trim();

     // Validate required fields
     if (!customerName || !customerEmail) {
         requiredInfoMessage.style.display = 'block';
         requiredInfoMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
         return;
     }
     requiredInfoMessage.style.display = 'none';
     // Terms acceptance

     const termsCheckbox = document.getElementById('termsCheckbox');
     const termsError = document.getElementById('termsError');
     if (!termsCheckbox.checked) {
         termsError.style.display = 'block';
         termsError.scrollIntoView({ behavior: 'smooth', block: 'center' });
         return;
     }
     termsError.style.display = 'none';

     const kortSpan = document.getElementById('kortSpan');
     kortSpan.innerHTML = `Laddar betalning ..`;

     try {

         updateCustomer();

         const sessionData = JSON.parse(localStorage.getItem('bookingData'));

         const existingLink = sessionData.QuickPayLink;
         if (existingLink) {
             console.log('Using existing payment link');
             window.location.href = existingLink;
             return;
         }

         // Get the payment link from the server
         const response = await fetch(
             'http://localhost:3000/api/swish/get-payment-form',
             {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({
                     order_id: sessionData.booking_number,
                     access_token: sessionData.token,
                     bookingId: sessionData.bookingId
                 }),
             }
         );

         if (!response.ok) throw new Error('Failed to get payment link');

         const { url } = await response.json();

         sessionData.QuickPayLink = url;
         localStorage.setItem('bookingData', JSON.stringify(sessionData));


         // Redirect to the payment link
         window.location.href = url;

     } catch (error) {
         console.error('Error in handlePayment:', error);
         alert('Ett fel uppstod vid betalningen. Försök igen.');
     }

 }

 /****************************************
  * 10) Misc Helpers (reset flow, etc.)
  ****************************************/
 function resetPaymentFlow() {
     // Hide payment sections
     showSection('customerSection', false);
     showSection('paymentButtons', false);
     showSection('payment-container', false);

     // Show the "continue" button
     const continueBtn = document.getElementById('continueToPaymentBtn');
     continueBtn.style.display = 'block';

     // Optionally release spots on the server if needed
     const sessionData = JSON.parse(localStorage.getItem('bookingData'));
     const hasReleasedSpots = localStorage.getItem('spotsReleased');

     if (sessionData?.bookingId && hasReleasedSpots !== true) {
         supabaseClient
             .rpc('reset_booking', {
                 p_booking_id: sessionData.bookingId,
                 p_access_token: sessionData.token,
                 p_new_time_slot_id: currentTimeSlot
             })
             .then(({ error }) => {
                 if (error) {
                     console.error('Error resetting booking:', error);
                 }
             })
             .catch(console.error);

         localStorage.setItem('spotsReleased', 'true');
     }
 }

 function checkPaymentStatus() {
     let attempts = 0;
     const maxAttempts = 2100; // 35 minutes worth of attempts
     let interval = 1000; // Start checking every second

     const sessionData = JSON.parse(localStorage.getItem('bookingData'));
     const bookingNumber = sessionData.booking_number;
     const access_token = sessionData.access_token;

     const checkStatus = setInterval(async () => {
         try {
             attempts++;

             // After 5 minutes (300 seconds), check every 2 seconds instead
             if (attempts === 300) {
                 clearInterval(checkStatus);
                 interval = 2000;
                 checkPaymentStatus(); // Restart with new interval
                 return;
             }

             // Check if we've exceeded max attempts (35 minutes)
             if (attempts >= maxAttempts) {
                 clearInterval(checkStatus);
                 console.log('Payment status check timed out after 35 minutes');
                 return;
             }

             console.log('Checking payment status...');

             // Call the Postgres function instead of querying the table
             const { data, error } = await supabaseClient
                 .rpc('get_booking_status', {
                     p_access_token: sessionData.token
                 });

             if (error) {
                 console.error('Error fetching booking status:', error);
                 return; // Continue checking even if there's an error
             }

             // The function returns an array with one object, so check the first element
             if (data?.[0]?.status === 'confirmed') {
                 clearInterval(checkStatus);
                 window.location.href = `/bokningssystem/frontend/tackfordinbokning.html?order_id=${bookingNumber}&access_token=${access_token}`;
                 return;
             }

         } catch (error) {
             console.error('Error in payment status check:', error);
             // Continue checking even if there's an error
         }
     }, interval);

     // Clean up interval on page unload
     window.addEventListener('unload', () => clearInterval(checkStatus));
 }


 // Clear local storage on page load
 function clearLocalStorageOnLoad() {
     localStorage.removeItem('bookingData');
     localStorage.removeItem('spotsReleased');
 }
 window.addEventListener('load', clearLocalStorageOnLoad);

 /****************************************
  * 11) DOMContentLoaded - Main init
  ****************************************/
 document.addEventListener('DOMContentLoaded', () => {
     // 1. Create the calendar in the correct place
     const calendarContainer = document.createElement('div');
     calendarContainer.id = 'calendar-container';

     // Insert into the .booking-section .form-group
     const formGroup = document.querySelector('.booking-section .form-group');
     formGroup.appendChild(calendarContainer);

     // 2. Instantiate the calendar
     new BookingCalendar(calendarContainer);

     // 3. Add a single event listener for time-slot clicks
     document.getElementById('timeSlots').addEventListener('click', (e) => {
         const slotEl = e.target.closest('.time-slot');
         if (slotEl && !slotEl.classList.contains('disabled')) {
             // Whenever user clicks a time slot, we handle it here
             resetPaymentFlow();   // If we were partway through payment, reset
             selectTimeSlot(slotEl);
         }
     });

     // 4. Add event listeners for ticket + / - buttons
     document.querySelectorAll('.quantity-btn').forEach(btn => {
         btn.addEventListener('click', () => {
             const type = btn.dataset.ticketType;
             const change = btn.classList.contains('plus') ? 1 : -1;
             resetPaymentFlow();
             handleQuantityChange(type, change);
         });
     });

     // 5. “Rebooking guarantee” checkbox
     const rebookingCheckbox = document.getElementById('rebookingCheckbox');
     rebookingCheckbox.addEventListener('change', (e) => {
         ticketState.is_rebookable = e.target.checked;
         updateTotalDisplay();
         resetPaymentFlow();
     });

     // 6. Continue to Payment button
     document.getElementById('continueToPaymentBtn').addEventListener('click', handleContinueToPayment);

     // 7. Terms checkbox
     const termsCheckbox = document.getElementById('termsCheckbox');
     const termsError = document.getElementById('termsError');
     termsCheckbox.addEventListener('change', () => {
         if (termsCheckbox.checked) {
             termsError.style.display = 'none';
         }
     });

     // 9. Handle local booking data expiration
     const bookingData = JSON.parse(localStorage.getItem('bookingData'));
     if (bookingData && Date.now() > bookingData.expiresAt) {
         // Expired
         localStorage.removeItem('bookingData');
         restartBookingProcess();
     } else {
         // Hide any message container
         document.getElementById('messageContainer').style.display = 'none';
     }

     // Periodically check expiration
     setInterval(() => {
         const storedData = JSON.parse(localStorage.getItem('bookingData'));
         if (storedData && Date.now() > storedData.expiresAt) {
             console.log('Clearing expired booking data...');
             restartBookingProcess();
             localStorage.removeItem('bookingData');
         }
     }, 10000);

     const codeCheckbox = document.getElementById('kodbox');
 const codeInputDiv = document.getElementById('codeInput');

 codeCheckbox.addEventListener('change', (e) => {
     if (e.target.checked) {
         codeInputDiv.style.display = 'flex';
         codeInputDiv.style.marginTop = '15px';
     } else {
         codeInputDiv.style.display = 'none';
         // Clear the input when hiding
         document.querySelector('#codeInput input[type="text"]').value = '';

         // Also clear any applied codes from localStorage
         const bookingData = JSON.parse(localStorage.getItem('bookingData'));
         if (bookingData) {
             // delete bookingData.gift_card_applied;
             // delete bookingData.promo_applied;
             localStorage.setItem('bookingData', JSON.stringify(bookingData));
         }

     }
 });

 document.getElementById('useCode').addEventListener('click', async (e) => {
     e.preventDefault();
     const codeInput = document.querySelector('#codeInput input[type="text"]');
     const code = codeInput.value.trim();

     const codeMessage = document.getElementById('codeMessage');


     if (!code) {
         codeMessage.style.display = 'block';
         codeMessage.innerHTML = 'Vänligen ange en kod';
         codeMessage.style.backgroundColor = '#ffe6e6';
         codeMessage.style.color = 'red';
         return;
     }

     try {
         const bookingData = JSON.parse(localStorage.getItem('bookingData'));
         if (!bookingData?.bookingId || !bookingData?.token) {
             throw new Error('No active booking found');
         }

         const { data, error } = await supabaseClient.rpc('validate_and_apply_code', {
             p_code: code,
             p_booking_id: bookingData.bookingId,
             p_access_token: bookingData.token
         });

         if (error) throw error;

         if (data.success) {
             // Store the applied code info based on type
             if (data.type === 'gift_card') {
                 bookingData.gift_card_applied = {
                     code: code,
                     value: data.amount
                 };
             } else if (data.type === 'promo') {
                 bookingData.promo_applied = {
                     code: code,
                     is_percentage: data.is_percentage,
                     value: data.discount_value
                 };
             }
             localStorage.setItem('bookingData', JSON.stringify(bookingData));

             // Get current selected date and time
             const dateEl = document.querySelector('.calendar-day.selected');
             const timeEl = document.querySelector('.time-slot.selected');
             const selectedDate = dateEl ? dateEl.dataset.date : '';
             const selectedTime = timeEl ? timeEl.textContent.trim() : '';

             // Create current tickets object
             const currentTickets = {
                 ...ticketState,
                 date: selectedDate,
                 time: selectedTime
             };

             // Calculate totals and display summary
             const totals = calculateTotal(currentTickets);
             displayBookingSummary({ tickets: currentTickets, totals });

             // Update the UI based on whether it's now free
             updateFreeBookingUI(totals);


             // Show success message
             const codeMessage = document.getElementById('codeMessage');
             codeMessage.style.display = 'block';
             codeMessage.style.backgroundColor = 'rgb(230, 241, 225)';
             codeMessage.style.color = 'black';
             codeMessage.innerHTML = data.message;
             // Clear input
             codeInput.value = '';

             // Update the total price display
             updateTotalDisplay();
             updateTimeRemaining();

         } else {
             const codeMessage = document.getElementById('codeMessage');
             codeMessage.style.display = 'block';
             codeMessage.style.backgroundColor = '#ffe6e6';
             codeMessage.style.color = 'red';
             codeMessage.innerHTML = data.message;
         }

     } catch (error) {
         console.error('Error validating code:', error);
         alert('Ett fel uppstod vid validering av koden');
     }
 });

 });

 function restartBookingProcess() {
     // Reset everything visually
     clearTicketSelections();
     document.querySelector('#timeSlots').innerHTML = '';
     document.getElementById('times').classList.remove('visible');
     showSection('tickets', false);
     showSection('customerSection', false);
     showSection('paymentButtons', false);
     showSection('payment-container', false);
     currentTimeSlot = null;


     // Reset the continue button
     const continueBtn = document.getElementById('continueToPaymentBtn');
     continueBtn.style.display = 'none';
     continueBtn.classList.add('disabled');

     // Clear any selected day
     document.querySelectorAll('.calendar-day').forEach(day => day.classList.remove('selected'));

     // Show a message
     showMessage('Din bokningssession har gått ut. <br><br> Vänligen börja om din bokning.');
 }

 function showMessage(msg) {
     const msgEl = document.getElementById('messageContainer');
     msgEl.style.display = 'block';
     msgEl.innerHTML = msg;
     window.scrollTo({ top: 0, behavior: 'smooth' });
 }

 /****************************************
  * 12) GIFT CARD stuFF
  ****************************************/

 

 function updateFreeBookingUI(totals) {
     const paymentButtons = document.getElementById('paymentButtons');
     let confirmButton = document.getElementById('freeConfirmBtn');
     const choosePayMethod = document.getElementById('choosePayMethod');

     if (totals.total === 0) {
         // Hide payment buttons
         paymentButtons.style.display = 'none';
         choosePayMethod.style.display = 'none';
         confirmButton.style.display = 'block'

         confirmButton.addEventListener('click', handleFreeBooking);

     } else {
         // Show payment buttons and remove confirm button if it exists
         paymentButtons.style.display = 'flex';
         confirmButton.style.display = 'none'


     }
 }

 async function handleFreeBooking() {
     try {
         // Get customer info
         const customerName = document.getElementById('customerName').value.trim();
         const customerEmail = document.getElementById('customerEmail').value.trim();
         const customerComment = document.getElementById('customerComment').value.trim();
         const wantsNewsletter = document.getElementById('nyhetsbrev').checked;

         // Validate required fields
         if (!customerName || !customerEmail) {
             requiredInfoMessage.style.display = 'block';
             requiredInfoMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
             return;
         }
         requiredInfoMessage.style.display = 'none';

         // Validate terms acceptance
         const termsCheckbox = document.getElementById('termsCheckbox');
         const termsError = document.getElementById('termsError');
         if (!termsCheckbox.checked) {
             termsError.style.display = 'block';
             termsError.scrollIntoView({ behavior: 'smooth', block: 'center' });
             return;
         }
         termsError.style.display = 'none';

         // Get session data
         const sessionData = JSON.parse(localStorage.getItem('bookingData'));
         if (!sessionData?.bookingId || !sessionData?.token) {
             throw new Error('No active booking found');
         }

         // Update customer details first
         await updateCustomer();

         // Send request to process free booking
         const response = await fetch('http://localhost:3000/api/swish/free-booking', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({
                 bookingId: sessionData.bookingId,
                 access_token: sessionData.token,
                 booking_number: sessionData.booking_number
             })
         });

         if (!response.ok) {
             const errorData = await response.json();
             throw new Error(errorData.error || 'Failed to process free booking');
         }

         // Show message while processing
         const freeMessage = document.getElementById('freeMessage');
         freeMessage.style.display = 'block';
         freeMessage.innerHTML = 'Bekräftar din bokning...';
         freeMessage.scrollIntoView({ behavior: 'smooth' });

         // Start checking status
         checkPaymentStatus();

     } catch (error) {
         console.error('Error processing free booking:', error);
         const freeMessage = document.getElementById('freeMessage');
         freeMessage.style.display = 'block';
         freeMessage.innerHTML = 'Ett fel uppstod. Försök igen.';
         freeMessage.style.backgroundColor = '#ffe6e6';
         freeMessage.style.color = 'red';
         freeMessage.scrollIntoView({ behavior: 'smooth' });
     }
 }