// Declare shared variables at module scope
let sumValue = 0;
let giftElements = null;

function initializeGiftCard() {
    // Get and store all needed DOM elements
    giftElements = {
        sumEl: document.getElementById('sumValue'),
        minusBtn: document.getElementById('minusBtn'),
        plusBtn: document.getElementById('plusBtn'),
        termsCheckbox: document.getElementById('termsCheckbox'),
        termsError: document.getElementById('termsError'),
        paymentButtons: document.getElementById('paymentButtons'),
        paymentContainer: document.getElementById('payment-container'),
        requiredSumMessage: document.getElementById('requiredSumMessage'),
        requiredInfoMessage: document.getElementById('requiredInfoMessage'),
        swishPhoneSection: document.getElementById('swishPhoneSection'),
        alternateDeviceSection: document.getElementById('alternateDeviceSection'),
        swishPhoneError: document.getElementById('swishPhoneError')
    };

    // Reset sumValue when initializing
    sumValue = 0;
    if (giftElements.sumEl) {
        giftElements.sumEl.textContent = '0 kr';
    }

    // Set up button listeners
    if (giftElements.plusBtn && giftElements.minusBtn && giftElements.sumEl) {
        giftElements.plusBtn.addEventListener('click', () => {
            sumValue += 100;
            giftElements.sumEl.textContent = sumValue + ' kr';
            if (sumValue > 0) {
                giftElements.minusBtn.disabled = false;
            }
        });

        giftElements.minusBtn.addEventListener('click', () => {
            if (sumValue >= 100) {
                sumValue -= 100;
                giftElements.sumEl.textContent = sumValue + ' kr';
            }
            if (sumValue === 0) {
                giftElements.minusBtn.disabled = true;
            }
        });
    }

    // Payment handlers
    const swishButton = document.getElementById('swishbutton');
    const kortButton = document.getElementById('kortbetalning');
    
    if (swishButton) {
        swishButton.addEventListener('click', payBySwish);
    }
    if (kortButton) {
        kortButton.addEventListener('click', payByCard);
    }

    // Mobile detection for Swish
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (giftElements.swishPhoneSection && giftElements.alternateDeviceSection) {
        if (!isMobile) {
            giftElements.swishPhoneSection.style.display = "block";
            giftElements.alternateDeviceSection.style.display = "none";
        } else {
            giftElements.alternateDeviceSection.style.display = "block";
            giftElements.swishPhoneSection.style.display = "none";
        }
    }
}

function formatSwishNumber(input) {
    let number = input.replace(/\D/g, '');

    if (number.startsWith("46")) {
        return number;
    } else if (number.startsWith("0")) {
        return "46" + number.substring(1);
    } else if (number.startsWith("+46")) {
        return number.replace("+", "");
    } else {
        return null;
    }
}

function showSwishPhoneInput(event) {
    if (event) event.preventDefault();
    if (giftElements.swishPhoneSection && giftElements.alternateDeviceSection) {
        giftElements.swishPhoneSection.style.display = 'block';
        giftElements.alternateDeviceSection.style.display = 'none';
        document.getElementById('swishPhone')?.focus();
    }
}

async function payBySwish() {
    if (!giftElements) return;

    if (sumValue === 0) {
        giftElements.requiredSumMessage.style.display = 'block';
        giftElements.requiredSumMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    giftElements.requiredSumMessage.style.display = 'none';

    const giftTo = document.getElementById('giftTo')?.value.trim();
    const giftFrom = document.getElementById('giftFrom')?.value.trim();
    const purchaserEmail = document.getElementById('purchaserEmail')?.value.trim();

    if (!giftTo || !giftFrom || !purchaserEmail) {
        giftElements.requiredInfoMessage.style.display = 'block';
        giftElements.requiredInfoMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    giftElements.requiredInfoMessage.style.display = 'none';

    if (!giftElements.termsCheckbox?.checked) {
        giftElements.termsError.style.display = 'block';
        giftElements.termsError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    let phoneNumber = null;

    if (giftElements.swishPhoneSection.style.display === 'block') {
        phoneNumber = document.getElementById('swishPhone')?.value.trim();

        if (!phoneNumber) {
            giftElements.swishPhoneError.style.display = 'block';
            return;
        }

        phoneNumber = formatSwishNumber(phoneNumber);

        if (!phoneNumber) {
            giftElements.swishPhoneError.style.display = 'block';
            giftElements.swishPhoneError.textContent = "Ogiltigt telefonnummer. Ange ett svenskt mobilnummer.";
            return;
        }

        giftElements.swishPhoneError.style.display = 'none';
    }

    giftElements.paymentContainer.style.display = 'block';
    giftElements.paymentContainer.innerHTML = `
        <div style="padding-left: 3px; padding-top: 20px; font-size: 1.1em;">
            Laddar swishbetalning..
        </div>
    `;

    try {
        const response = await fetch(
            'http://localhost:3000/api/swish/gift-swish',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    isMobile,
                    payerAlias: phoneNumber,
                    giftTo,
                    giftFrom,
                    purchaserEmail,
                    sumValue
                })
            }
        );

        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || 'Payment failed');
        }

        if (isMobile && result.token && !phoneNumber) {
            const returnUrl = `${window.location.origin}/tackfordittkop.html`;
            window.location.href = `swish://paymentrequest?token=${result.token}&callbackurl=${encodeURIComponent(returnUrl)}`;
        } else {
            giftElements.paymentContainer.innerHTML = `
                <div style="padding: 20px 0px 0px 3px; font-size: 1.2em; font-weight: 700;">
                    Öppna Swish-appen på din telefon
                </div>
            `;
        }

        // Start checking payment status
        checkPaymentStatus();

    } catch (error) {
        console.error('Swish payment error:', error);
        giftElements.paymentContainer.innerHTML = `
            <div class="error" style="text-align: center; margin: 20px;">
                <p>Betalning misslyckades: ${error.message}</p>
                <button onclick="payBySwish()" style="margin-top: 10px;">
                    Försök igen
                </button>
            </div>
        `;
    }
}

async function payByCard() {
    if (!giftElements) return;

    if (sumValue === 0) {
        giftElements.requiredSumMessage.style.display = 'block';
        giftElements.requiredSumMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    giftElements.requiredSumMessage.style.display = 'none';

    const giftTo = document.getElementById('giftTo')?.value.trim();
    const giftFrom = document.getElementById('giftFrom')?.value.trim();
    const purchaserEmail = document.getElementById('purchaserEmail')?.value.trim();

    if (!giftTo || !giftFrom || !purchaserEmail) {
        giftElements.requiredInfoMessage.style.display = 'block';
        giftElements.requiredInfoMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    giftElements.requiredInfoMessage.style.display = 'none';

    if (!giftElements.termsCheckbox?.checked) {
        giftElements.termsError.style.display = 'block';
        giftElements.termsError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    const kortSpan = document.getElementById('kortSpan');
    if (kortSpan) {
        kortSpan.innerHTML = `Laddar betalning ..`;
    }

    try {
        const response = await fetch(
            'http://localhost:3000/api/swish/get-gift-form',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    giftTo,
                    giftFrom,
                    purchaserEmail,
                    sumValue
                }),
            }
        );

        if (!response.ok) throw new Error('Failed to get payment link');

        const { url } = await response.json();
        window.location.href = url;

    } catch (error) {
        console.error('Error in handlePayment:', error);
        alert('Ett fel uppstod vid betalningen. Försök igen.');
    }
}

function checkPaymentStatus() {
    let attempts = 0;
    const maxAttempts = 2100; // 35 minutes worth of attempts
    let interval = 3000; // Start checking every 3 seconds

    const checkStatus = setInterval(async () => {
        try {
            attempts++;

            if (attempts === 300) {
                clearInterval(checkStatus);
                interval = 2000;
                checkPaymentStatus(); // Restart with new interval
                return;
            }

            if (attempts >= maxAttempts) {
                clearInterval(checkStatus);
                console.log('Payment status check timed out after 35 minutes');
                return;
            }

            console.log('Checking payment status...');
            const purchaserEmail = document.getElementById('purchaserEmail')?.value.trim();

            const { data, error } = await supabaseClient
                .rpc('get_gift_status', {
                    p_purchaser_email: purchaserEmail
                });

            if (error) {
                console.error('Error fetching booking status:', error);
                return;
            }

            if (data && data.length > 0 && data[0].status === 'completed') {
                clearInterval(checkStatus);
                window.location.href = `http://aventyrsupplevelser.com/tackfordittkop`;
                return;
            }

        } catch (error) {
            console.error('Error in payment status check:', error);
        }
    }, interval);

    // Clean up interval on page unload
    window.addEventListener('unload', () => clearInterval(checkStatus));
}

// Initialize when document is ready
document.addEventListener('DOMContentLoaded', function() {
    // Set up modal functionality
    const giftButton = document.getElementById('presentkort-button');
    const giftModal = document.getElementById('giftModal');
    const giftRoot = document.getElementById('gift-root');
    
    if (giftButton) {
        giftButton.addEventListener('click', function(e) {
            e.preventDefault();
            const giftDiv = document.getElementById('giftDiv');
            const giftStyles = document.querySelectorAll('link[href*="giftstyles.css"]');

            if (giftDiv && !giftRoot.contains(giftDiv)) {
                giftRoot.appendChild(giftDiv);
                giftStyles.forEach(style => {
                    const styleCopy = style.cloneNode(true);
                    giftRoot.appendChild(styleCopy);
                });
            }

            if (giftModal) {
                giftModal.style.display = 'block';
                document.body.style.overflow = 'hidden';
                
                const modalFrame = giftModal.querySelector('.modal-frame');
                if (modalFrame) {
                    requestAnimationFrame(() => {
                        giftModal.classList.add('show');
                        modalFrame.classList.add('show');
                    });
                }
                
                // Initialize gift card functionality
                initializeGiftCard();
            }
        });
    }
});