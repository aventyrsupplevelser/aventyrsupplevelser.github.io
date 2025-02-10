import express from 'express';
import { Agent } from 'https';
import axios from 'axios';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import EmailService from './emailService.js';
import crypto from 'crypto';



dotenv.config();

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const router = express.Router(); // <--- You forgot this line!

function generateCallbackId(bookingId) {
    const serverSecret = process.env.CALLBACK_SECRET;
    const hmac = crypto.createHmac('sha256', serverSecret);
    hmac.update(`${bookingId}`);
    return hmac.digest('hex').slice(0, 32);  // Take first 32 chars to match Swish requirements
}

function verifyCallbackId(callbackId, bookingId) {
    try {
        const expectedCallbackId = generateCallbackId(bookingId);
        return crypto.timingSafeEqual(
            Buffer.from(callbackId),
            Buffer.from(expectedCallbackId)
        );
    } catch {
        return false;
    }
}

// Decode from Base64
function getCertificates() {
    const rawCert = process.env.SWISH_CERTIFICATE;
    const rawKey = process.env.SWISH_PRIVATE_KEY;

    if (!rawCert || !rawKey) {
        throw new Error('Missing required environment variables');
    }

    const cert = Buffer.from(rawCert, 'base64').toString('utf8');
    const key = Buffer.from(rawKey, 'base64').toString('utf8');

    return { cert, key };
}

// Load the certificates
const { cert, key } = getCertificates();

// Create HTTPS agent
const agent = new Agent({ cert, key });

// Create an Axios instance with mTLS
const swishClient = axios.create({
    httpsAgent: agent,
});

router.post('/swish-payment', async (req, res) => {
    try {

        const { bookingNumber, isMobile, payerAlias, access_token, bookingId } = req.body;

        // Update booking status to requested
        const { data: statusData, error: statusError } = await supabase.rpc('request_booking', {
        p_booking_id: bookingId,
         p_access_token: access_token
        });

        if (statusError) throw statusError;
        console.log('bookingNumber:', bookingNumber)

        const callbackIdentifier = generateCallbackId(bookingNumber);
        const instructionId = access_token

        const { data: data, error } = await supabase.rpc('calculate_booking_amount', { 
            p_access_token: access_token
        });
      if (error) throw error;

      const amount = data / 100;

        const paymentData = {
            payeePaymentReference: bookingNumber,
            callbackUrl: `https://aventyrsupplevelsergithubio-testing.up.railway.app/api/swish/swish-callback`,
            payeeAlias: '1231049352',
            currency: 'SEK',
            amount: amount,
            message: 'Sörsjöns Äventyrspark',
            callbackIdentifier: callbackIdentifier
        };
        console.log('callbackIdentifier:', callbackIdentifier)



        if (payerAlias) {
            paymentData.payerAlias = payerAlias;
        }

        console.log('Making Swish request:', paymentData);

        const response = await swishClient.put(`https://staging.getswish.pub.tds.tieto.com/swish-cpcapi/api/v2/paymentrequests/${instructionId}`,
            paymentData
        ).then((res) => {
            console.log('Payment request created')
         });

        res.json({
            success: true,
            paymentId: instructionId,
        });

    } catch (error) {
        console.error('Swish payment error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

router.post('/swish-callback', express.json(), async (req, res) => {
    try {
        const payment = req.body;
        console.log('Received Swish callback:', payment);

        // Always send 200 OK first
        res.status(200).send('OK');


        // Get and validate callback identifier
        const callbackIdentifier = req.get('callbackIdentifier');

        if (!verifyCallbackId(callbackIdentifier, payment.payeePaymentReference)) {
            console.error('Invalid callback checksum');
            return; 
        }

        // First get the booking
        const { data: booking, error: bookingError } = await supabase
            .from('bookings')
            .select('*, time_slots(*)')
            .eq('booking_number', payment.payeePaymentReference)
            .single();

        if (bookingError || !booking) {
            console.error('Booking not found or access token mismatch');
            return;
        }

        if (booking.status !== 'requested') {
            console.log('Booking already processed:', booking.status);
            return;
        }

        if (payment.status === 'PAID') {
            const paidAmountOre = Math.round(payment.amount * 100);

            // Update the booking
            const { error: updateError } = await supabase
                .from('bookings')
                .update({
                    status: 'confirmed',
                    payment_method: 'swish',
                    payment_id: payment.id,
                    paid_amount: paidAmountOre,
                    payment_completed_at: new Date().toISOString(),
                    payment_metadata: payment
                })
                .eq('id', booking.id)
                .eq('status', 'requested')

            if (updateError) {
                console.error('Error updating booking with payment info:', updateError);
                return;
            }

            await updateAppliedCodes(booking);

            console.log('Payment recorded successfully:', payment.id);

            // Send confirmation email using the original booking data we already have
            try {
                await EmailService.sendBookingConfirmation({
                    ...booking,
                    start_time: booking.time_slots.start_time,
                    paid_amount: paidAmountOre,
                    payment_completed_at: new Date().toISOString()
                });
                console.log('Confirmation email sent successfully');
            } catch (emailError) {
                console.error('Error sending confirmation email:', emailError);
            }
        }

    } catch (error) {
        console.error('Swish callback error:', error);
    }
});

router.post('/get-payment-form', async (req, res) => {
    try {
        const { order_id, access_token, bookingId } = req.body;

         // Update booking status to requested
         const { data: statusData, error: statusError } = await supabase.rpc('request_booking', {
            p_booking_id: bookingId,
            p_access_token: access_token
        });

        if (statusError) throw statusError;
        
        // Log incoming request
        console.log('Received request:', { order_id, access_token: '***' });

        if (!order_id || !access_token) {
            return res.status(400).json({ error: 'order_id and access_token are required.' });
        }

        const callbackIdentifier = generateCallbackId(order_id);

        // Calculate amount and log it
        const { data: amount, error } = await supabase.rpc('calculate_booking_amount', {
            p_access_token: access_token
        });
        if (error) throw error;
        console.log('Calculated amount:', amount);

        // Log API credentials (mask sensitive data)
        const apiKey = process.env.QUICKPAY_API_USER_KEY;
        console.log('API configuration present:', {
            apiKeyPresent: !!apiKey
        });

        // Step 1: Create payment with detailed logging
        const createPaymentResponse = await fetch('https://api.quickpay.net/payments', {
            method: 'POST',
            headers: {
                'Accept-Version': 'v10',
                'Content-Type': 'application/json',
                'Authorization': `Basic ${Buffer.from(':' + apiKey).toString('base64')}`
            },
            body: JSON.stringify({
                order_id,
                currency: 'SEK'
            })
        });

        // Log full payment creation response
        const paymentResponseText = await createPaymentResponse.text();
        console.log('Payment creation response:', {
            status: createPaymentResponse.status,
            headers: Object.fromEntries(createPaymentResponse.headers.entries()),
            body: paymentResponseText
        });

        if (!createPaymentResponse.ok) {
            throw new Error(`Failed to create QuickPay payment: ${paymentResponseText}`);
        }

        const payment = JSON.parse(paymentResponseText);
        console.log('Payment created:', payment);

        const callbackUrl = new URL('https://aventyrsupplevelsergithubio-testing.up.railway.app/api/swish/card-callback');
        callbackUrl.searchParams.set('callbackIdentifier', callbackIdentifier);

        console.log('Constructed callback URL:', callbackUrl.toString());


        // Step 2: Create payment link with detailed logging
        const linkRequestBody = {
            amount: amount,  // Make sure this is in smallest currency unit (öre)
            continue_url: `http://127.0.0.1:5500/bokningssystem/frontend/tackfordinbokning.html?order_id=${order_id}`,
            cancel_url: `https://aventyrsupplevelsergithubio-testing.up.railway.app/payment-cancelled.html`,
            callback_url: callbackUrl.toString(),
            auto_capture: true,
            payment_methods: 'creditcard',
            language: 'sv',
            deadline: 1800
        };

        console.log('Link request payload:', linkRequestBody);

        const createLinkResponse = await fetch(`https://api.quickpay.net/payments/${payment.id}/link`, {
            method: 'PUT',
            headers: {
                'Accept-Version': 'v10',
                'Content-Type': 'application/json',
                'Authorization': `Basic ${Buffer.from(':' + apiKey).toString('base64')}`
            },
            body: JSON.stringify(linkRequestBody)
        });

        // Log full link creation response
        const linkResponseText = await createLinkResponse.text();
        console.log('Link creation response:', {
            status: createLinkResponse.status,
            headers: Object.fromEntries(createLinkResponse.headers.entries()),
            body: linkResponseText
        });

        if (!createLinkResponse.ok) {
            throw new Error(`Failed to create QuickPay payment link: ${linkResponseText}`);
        }

        const link = JSON.parse(linkResponseText);
        
        // Return success response
        res.json({
            url: link.url,
            payment_id: payment.id
        });

    } catch (error) {
        console.error('Detailed error:', {
            message: error.message,
            stack: error.stack
        });
        
        res.status(500).json({
            error: 'Failed to generate payment link',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

router.post('/card-callback', express.json(), async (req, res) => {
    try {
        // 1. Always respond with 200 OK first to acknowledge receipt
        res.status(200).send('OK');
        console.log('starting')

        // 2. Get the callback data
        const callbackData = req.body;
        
        // 3. Get booking number from QuickPay's order_id
        const bookingNumber = callbackData.order_id;
        if (!bookingNumber) {
            console.error('Missing booking number in callback');
            return;
        }

        const callbackUrl = new URL(callbackData.link.callback_url);
        const callbackIdentifier = callbackUrl.searchParams.get('callbackIdentifier');

        if (!verifyCallbackId(callbackIdentifier, bookingNumber)) {
            console.error('Invalid callback checksum');
        }

        // 5. Get the booking using both booking number and access token
        const { data: booking, error: bookingError } = await supabase
            .from('bookings')
            .select('*, time_slots(*)')
            .eq('booking_number', bookingNumber)
            .single();

        if (bookingError || !booking) {
            console.error('Booking not found or access token mismatch');
            return;
        }

        // 6. Check if booking is still requesting
        if (booking.status !== 'requested') {
            console.log('Booking already processed:', booking.status);
            return;
        }

        // 7. Check for successful payment
        const isSuccess = callbackData.accepted && callbackData.state === 'processed';
        if (isSuccess) {
            // Get amount in öre from the payment link data
            const paidAmountOre = callbackData.link.amount;

            // Update the booking
            const { error: updateError } = await supabase
                .from('bookings')
                .update({
                    status: 'confirmed',
                    payment_method: 'card',
                    payment_id: callbackData.id.toString(),
                    paid_amount: paidAmountOre,
                    payment_completed_at: new Date().toISOString(),
                    payment_metadata: callbackData
                })
                .eq('id', booking.id)
                .eq('status', 'requested')

            if (updateError) {
                console.error('Error updating booking:', updateError);
                return;
            }

            await updateAppliedCodes(booking);

            console.log('Payment recorded successfully:', callbackData.id);

            // Send confirmation email
            try {
                await EmailService.sendBookingConfirmation({
                    ...booking,
                    start_time: booking.time_slots.start_time,
                    paid_amount: paidAmountOre,
                    payment_completed_at: new Date().toISOString()
                });
                console.log('Confirmation email sent successfully');
            } catch (emailError) {
                console.error('Error sending confirmation email:', emailError);
            }
        }

    } catch (error) {
        console.error('QuickPay callback error:', error);
    }
});

async function updateAppliedCodes(booking) {
    try {
        // Update gift card if one was used
        if (booking.gift_card_number) {
            const { error: giftCardError } = await supabase
                .from('gift_cards')
                .update({
                    gift_card_used: true,
                    used_at: new Date().toISOString(),
                    used_in_booking: booking.booking_number
                })
                .eq('gift_card_number', booking.gift_card_number);

            if (giftCardError) {
                console.error('Error updating gift card:', giftCardError);
            }
        }

        // Update promo code usage if one was used
        if (booking.promo_code) {
            // First get the current promo code data
            const { data: promoData, error: fetchError } = await supabase
                .from('promo_codes')
                .select('current_uses')
                .eq('promo_code', booking.promo_code)
                .single();

            if (fetchError) {
                console.error('Error fetching promo code:', fetchError);
                return;
            }

            // Then update with incremented value
            const { error: promoError } = await supabase
                .from('promo_codes')
                .update({
                    current_uses: (promoData.current_uses || 0) + 1,
                    last_used_at: new Date().toISOString()
                })
                .eq('promo_code', booking.promo_code);

            if (promoError) {
                console.error('Error updating promo code:', promoError);
            }
        }
    } catch (error) {
        console.error('Error updating codes:', error);
    }
}

router.post('/gift-swish', async (req, res) => {
    try {

        const { isMobile, payerAlias, giftTo, giftFrom, purchaserEmail, sumValue } = req.body;

        console.log(req.body);

       // Create giftcard
        const { data, error } = await supabase.rpc('create_gift_card', {
        p_gift_to: giftTo,
        p_gift_from: giftFrom,
        p_purchaser_email: purchaserEmail,
        p_amount: sumValue
      });
  
      if (error) throw error;
  
      // The data will contain what your PG function returned as jsonb
      const giftCardNumber = data.gift_card_number;
  
      if (!giftCardNumber) {
        throw new Error('Failed to generate gift card number');
      }

        const callbackIdentifier = generateCallbackId(giftCardNumber);

        const instructionId = crypto.randomBytes(16).toString('hex').toUpperCase();

        const paymentData = {
            payeePaymentReference: giftCardNumber,
            callbackUrl: `https://aventyrsupplevelsergithubio-testing.up.railway.app/api/swish/gift-swish-callback`,
            payeeAlias: '1231049352',
            currency: 'SEK',
            amount: sumValue,
            message: 'Sörsjöns Äventyrspark - Presentkort',
            callbackIdentifier: callbackIdentifier
        };
        console.log('callbackIdentifier:', callbackIdentifier)

        if (payerAlias) {
            paymentData.payerAlias = payerAlias;
        }

        console.log('Making Swish request:', paymentData);

        const response = await swishClient.put(`https://staging.getswish.pub.tds.tieto.com/swish-cpcapi/api/v2/paymentrequests/${instructionId}`,
            paymentData
        ).then((res) => {
            console.log('Payment request created')
         });

        res.json({
            success: true,
            paymentId: instructionId,
        });

    } catch (error) {
        console.error('Swish payment error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

router.post('/get-gift-form', async (req, res) => {
    try {
        const { giftTo, giftFrom, purchaserEmail, sumValue } = req.body;

        console.log(req.body);

        // Create giftcard
         const { data, error } = await supabase.rpc('create_gift_card', {
         p_gift_to: giftTo,
         p_gift_from: giftFrom,
         p_purchaser_email: purchaserEmail,
         p_amount: sumValue
       });
   
       if (error) throw error;
   
       // The data will contain what your PG function returned as jsonb
       const giftCardNumber = data.gift_card_number;
   
       if (!giftCardNumber) {
         throw new Error('Failed to generate gift card number');
       }

        const callbackIdentifier = generateCallbackId(giftCardNumber);

        // Log API credentials (mask sensitive data)
        const apiKey = process.env.QUICKPAY_API_USER_KEY;

        const order_id = giftCardNumber;

        // Step 1: Create payment with detailed logging
        const createPaymentResponse = await fetch('https://api.quickpay.net/payments', {
            method: 'POST',
            headers: {
                'Accept-Version': 'v10',
                'Content-Type': 'application/json',
                'Authorization': `Basic ${Buffer.from(':' + apiKey).toString('base64')}`
            },
            body: JSON.stringify({
                order_id,
                currency: 'SEK'
            })
        });

        // Log full payment creation response
        const paymentResponseText = await createPaymentResponse.text();
        console.log('Payment creation response:', {
            status: createPaymentResponse.status,
            headers: Object.fromEntries(createPaymentResponse.headers.entries()),
            body: paymentResponseText
        });

        if (!createPaymentResponse.ok) {
            throw new Error(`Failed to create QuickPay payment: ${paymentResponseText}`);
        }

        const payment = JSON.parse(paymentResponseText);
        console.log('Payment created:', payment);

        const callbackUrl = new URL('https://aventyrsupplevelsergithubio-testing.up.railway.app/api/swish/gift-card-callback');
        callbackUrl.searchParams.set('callbackIdentifier', callbackIdentifier);

        console.log('Constructed callback URL:', callbackUrl.toString());

        const amountInOre = sumValue * 100;

        // Step 2: Create payment link with detailed logging
        const linkRequestBody = {
            amount: amountInOre,  // Make sure this is in smallest currency unit (öre)
            continue_url: `https://aventyrsupplevelser.com/tackfordittkop`,
            cancel_url: `https://aventyrsupplevelsergithubio-testing.up.railway.app/payment-cancelled.html`,
            callback_url: callbackUrl.toString(),
            auto_capture: true,
            payment_methods: 'creditcard',
            language: 'sv',
        };

        console.log('Link request payload:', linkRequestBody);

        const createLinkResponse = await fetch(`https://api.quickpay.net/payments/${payment.id}/link`, {
            method: 'PUT',
            headers: {
                'Accept-Version': 'v10',
                'Content-Type': 'application/json',
                'Authorization': `Basic ${Buffer.from(':' + apiKey).toString('base64')}`
            },
            body: JSON.stringify(linkRequestBody)
        });

        // Log full link creation response
        const linkResponseText = await createLinkResponse.text();
        console.log('Link creation response:', {
            status: createLinkResponse.status,
            headers: Object.fromEntries(createLinkResponse.headers.entries()),
            body: linkResponseText
        });

        if (!createLinkResponse.ok) {
            throw new Error(`Failed to create QuickPay payment link: ${linkResponseText}`);
        }

        const link = JSON.parse(linkResponseText);
        
        // Return success response
        res.json({
            url: link.url,
            payment_id: payment.id
        });

    } catch (error) {
        console.error('Detailed error:', {
            message: error.message,
            stack: error.stack
        });
        
        res.status(500).json({
            error: 'Failed to generate payment link',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

router.post('/gift-swish-callback', async (req, res) => {
    try {
        const payment = req.body;
        console.log('Received Swish callback:', payment);

        // Always send 200 OK first
        res.status(200).send('OK');

        // Get and validate callback identifier
        const callbackIdentifier = req.get('callbackIdentifier');

        if (!verifyCallbackId(callbackIdentifier, payment.payeePaymentReference)) {
            console.error('Invalid callback checksum');
            return; 
        }

        // First get the gift card
        const { data: giftCards, error: giftError } = await supabase
         .from('gift_cards')
         .select('*')
         .eq('gift_card_number', payment.payeePaymentReference)
         .limit(1);

         if (giftError || !giftCards || giftCards.length === 0) {
            console.error('Giftcard not found or card number mismatch');
            return;
        }
        
        const giftCard = giftCards[0];

        if (giftCard.status !== 'pending') {
            console.log('Gift card already processed:', giftCard.status);
            return;
        }

        if (payment.status === 'PAID') {
            const paidAmountOre = Math.round(payment.amount * 100);

            // Update the gift card
            const { error: updateError } = await supabase
                .from('gift_cards')
                .update({
                    status: 'completed',
                    payment_method: 'swish',
                    payment_id: payment.id,
                    paid_amount: paidAmountOre,
                    payment_completed_at: new Date().toISOString(),
                    payment_metadata: payment
                })
                .match({ 
                    gift_card_number: payment.payeePaymentReference,
                    status: 'pending'
                });

            if (updateError) {
                console.error('Error updating giftCard with payment info:', updateError);
                return;
            }

            console.log('Payment recorded successfully:', payment.id);

            // Send confirmation email using the original gift card data we already have
            try {
                await EmailService.sendGiftCardConfirmation({
                    giftCardNumber: payment.payeePaymentReference,
                    paid_amount: paidAmountOre,
                });
                console.log('Confirmation email sent successfully');
            } catch (emailError) {
                console.error('Error sending confirmation email:', emailError);
            }
        }

    } catch (error) {
        console.error('Swish callback error:', error);
    }
});




router.post('/gift-card-callback', async (req, res) => {
    try {
        const payment = req.body;
        console.log('Received Card callback:', payment);

        // Always send 200 OK first
        res.status(200).send('OK');

        const callbackUrl = new URL(payment.link.callback_url);
        const callbackIdentifier = callbackUrl.searchParams.get('callbackIdentifier');
        const giftCardNumber = payment.order_id;

        if (!verifyCallbackId(callbackIdentifier, giftCardNumber)) {
            console.error('Invalid callback checksum');
            return;
        }

        // Get the gift card
        const { data: giftCards, error: giftError } = await supabase
            .from('gift_cards')
            .select('*')
            .eq('gift_card_number', giftCardNumber)
            .limit(1);

        if (giftError || !giftCards || giftCards.length === 0) {
            console.error('Giftcard not found or card number mismatch');
            return;
        }

        const giftCard = giftCards[0];

        if (giftCard.status !== 'pending') {
            console.log('Gift card already processed:', giftCard.status);
            return;
        }

        // Check for successful payment
        const isSuccess = payment.accepted && payment.state === 'processed';
        if (isSuccess) {
            // Get amount in öre from the payment link data
            const paidAmountOre = payment.link.amount;

            // Update the gift card
            const { error: updateError } = await supabase
                .from('gift_cards')
                .update({
                    status: 'completed',
                    payment_method: 'card',
                    payment_id: payment.id.toString(),
                    paid_amount: paidAmountOre,
                    payment_completed_at: new Date().toISOString(),
                    payment_metadata: payment
                })
                .match({ 
                    gift_card_number: giftCardNumber,
                    status: 'pending'
                });

            if (updateError) {
                console.error('Error updating giftCard with payment info:', updateError);
                return;
            }

            console.log('Payment recorded successfully:', payment.id);

            // Send confirmation email
            try {
                await EmailService.sendGiftCardConfirmation({
                    giftCardNumber: giftCardNumber,
                    paid_amount: paidAmountOre,
                });
                console.log('Confirmation email sent successfully');
            } catch (emailError) {
                console.error('Error sending confirmation email:', emailError);
            }
        }

    } catch (error) {
        console.error('Card callback error:', error);
    }
});

// Add to swishRoutes.js

router.post('/free-booking', async (req, res) => {
    try {
        const { bookingId, access_token, booking_number } = req.body;

        // First get the booking with its time slot details
        const { data: booking, error: bookingError } = await supabase
            .from('bookings')
            .select('*, time_slots(*)')
            .eq('id', bookingId)
            .eq('access_token', access_token)
            .single();

        if (bookingError || !booking) {
            throw new Error('Booking not found or invalid access token');
        }

        // Verify booking is still pending
        if (booking.status !== 'pending') {
            throw new Error('Invalid booking status');
        }

        // Double check that the total amount is actually 0
        const { data: amount, error: amountError } = await supabase.rpc('calculate_booking_amount', {
            p_access_token: access_token
        });

        if (amountError) throw amountError;

        if (amount !== 0) {
            throw new Error('This booking requires payment');
        }

        // Update the booking status and add payment info
        const { error: updateError } = await supabase
            .from('bookings')
            .update({
                status: 'confirmed',
                payment_method: 'free',
                paid_amount: 0,
                payment_completed_at: new Date().toISOString(),
                payment_metadata: { 
                    method: 'free',
                    confirmed_at: new Date().toISOString()
                }
            })
            .eq('id', bookingId)
            .eq('status', 'pending');

        if (updateError) {
            throw updateError;
        }

        // Update any applied gift cards or promo codes
        await updateAppliedCodes(booking);

        // Send confirmation email
        try {
            await EmailService.sendBookingConfirmation({
                ...booking,
                start_time: booking.time_slots.start_time,
                paid_amount: 0,
                payment_completed_at: new Date().toISOString()
            });
        } catch (emailError) {
            console.error('Error sending confirmation email:', emailError);
            // Don't throw here - booking is still valid even if email fails
        }

        res.json({ success: true });

    } catch (error) {
        console.error('Free booking error:', error);
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

router.post('/rebooking-confirmation', async (req, res) => {
    try {
        const { booking, start_time } = req.body;
        console.log('start_time:', start_time )

        if (!booking || !start_time ) {
            return res.status(400).json({ 
                error: 'Booking data and start time is required' 
            });
        }

        // Send the confirmation email
        const emailResult = await EmailService.ombokningConfirmation(booking, start_time);

        if (!emailResult) {
            throw new Error('Failed to send confirmation email');
        }

        res.json({ 
            success: true, 
            message: 'Confirmation email sent successfully' 
        });

    } catch (error) {
        console.error('Error sending rebooking confirmation email:', error);
        res.status(500).json({ 
            error: 'Failed to send confirmation email' 
        });
    }
});

router.post('/backend-book', async (req, res) => {
    try {
        const {
            time_slot_id,
            adult_quantity = 0,
            youth_quantity = 0,
            kid_quantity = 0,
            full_day = 0,
            is_rebookable,
            customer_name,
            customer_email,
            customer_comment,
            gift_card,
            promo_code,
            payment_method,
        } = req.body;

        // Validate no negative quantities
        if (adult_quantity < 0 || youth_quantity < 0 || kid_quantity < 0 || full_day < 0) {
            throw new Error('Quantities cannot be negative');
        }

        // Validate codes if provided
        let giftCardValid = null;
        let promoCodeValid = null;

        if (gift_card) {
            const { data: giftCardData, error: giftCardError } = await supabase.rpc('validate_code', {
                p_code: gift_card.code
            });
            if (giftCardError) throw giftCardError;
            if (giftCardData.success) giftCardValid = giftCardData;
        }

        if (promo_code) {
            const { data: promoData, error: promoError } = await supabase.rpc('validate_code', {
                p_code: promo_code.code
            });
            if (promoError) throw promoError;
            if (promoData.success) promoCodeValid = promoData;
        }

        // Calculate base amount (without rebooking)
        let baseAmount = (adult_quantity * 400) + (youth_quantity * 300) + (kid_quantity * 200);
        if (full_day) baseAmount += (full_day * 100);

        // Apply discounts to base amount only
        if (giftCardValid) {
            baseAmount -= giftCardValid.amount;
        }
        if (promoCodeValid) {
            const discountAmount = promoCodeValid.is_percentage ? 
                (baseAmount * (promoCodeValid.discount_value / 100)) : 
                promoCodeValid.discount_value;
            baseAmount -= discountAmount;
        }

        // Ensure base amount doesn't go below 0
        baseAmount = Math.max(0, baseAmount);

        // Add rebooking fee AFTER discounts
        let totalAmount = baseAmount;
        if (is_rebookable) {
            totalAmount += ((adult_quantity + youth_quantity + kid_quantity) * 25);
        }

        let status;
        let quickPayLink = null;

        if (totalAmount === 0) {
            status = 'confirmed';
            payment_method = 'free';
        } else if (payment_method === 'invoice') {
            status = 'confirmed';
        } else {
            status = 'unpaid';
        }

        // Create booking first
        const { data: booking, error: bookingError } = await supabase.rpc('create_admin_booking', {
            p_time_slot_id: time_slot_id,
            p_adult_quantity: adult_quantity,
            p_youth_quantity: youth_quantity,
            p_kid_quantity: kid_quantity,
            p_full_day: full_day,
            p_is_rebookable: is_rebookable,
            p_customer_name: customer_name,
            p_customer_email: customer_email,
            p_customer_comment: customer_comment,
            p_status: status,
            p_payment_method: payment_method
        });

        if (bookingError) throw bookingError;

        // Create QuickPay link if needed
        if (status === 'unpaid') {
            const apiKey = process.env.QUICKPAY_API_USER_KEY;
            const callbackIdentifier = generateCallbackId(booking.booking_number);

            const callbackUrl = new URL('https://aventyrsupplevelsergithubio-testing.up.railway.app/api/swish/admin-callback');
            callbackUrl.searchParams.set('callbackIdentifier', callbackIdentifier);
            
            // Create payment
            const createPaymentResponse = await fetch('https://api.quickpay.net/payments', {
                method: 'POST',
                headers: {
                    'Accept-Version': 'v10',
                    'Content-Type': 'application/json',
                    'Authorization': `Basic ${Buffer.from(':' + apiKey).toString('base64')}`
                },
                body: JSON.stringify({
                    order_id: booking.booking_number,
                    currency: 'SEK'
                })
            });

            if (!createPaymentResponse.ok) {
                throw new Error('Failed to create QuickPay payment');
            }

            const payment = await createPaymentResponse.json();

            // Create payment link
            const linkResponse = await fetch(`https://api.quickpay.net/payments/${payment.id}/link`, {
                method: 'PUT',
                headers: {
                    'Accept-Version': 'v10',
                    'Content-Type': 'application/json',
                    'Authorization': `Basic ${Buffer.from(':' + apiKey).toString('base64')}`
                },
                body: JSON.stringify({
                    amount: totalAmount * 100, // Convert to öre
                    continue_url: `http://127.0.0.1:5500/bokningssystem/frontend/tackfordinbokning.html?order_id=${booking.booking_number}`,
                    cancel_url: `https://aventyrsupplevelsergithubio-testing.up.railway.app/payment-cancelled.html`,
                    callback_url: callbackUrl.toString(),
                    auto_capture: true,
                    payment_methods: 'creditcard,swish',
                    language: 'sv'
                })
            });

            if (!linkResponse.ok) {
                throw new Error('Failed to create QuickPay payment link');
            }

            const link = await linkResponse.json();
            quickPayLink = link.url;
        }

        // Apply codes if valid
        if (giftCardValid) {
            await supabase.rpc('admin_validate_apply_code', {
                p_code: gift_card.code,
                p_booking_id: booking.booking_id,
                p_access_token: booking.access_token
            });
        }

        if (promoCodeValid) {
            await supabase.rpc('admin_validate_apply_code', {
                p_code: promo_code.code,
                p_booking_id: booking.booking_id,
                p_access_token: booking.access_token
            });
        }

        // Send confirmation email if requested
        if (payment_method !== 'invoice') {
            await EmailService.sendBookingConfirmation({
                ...booking,
                customer_name,
                customer_email,
                adult_quantity,
                youth_quantity,
                kid_quantity,
                full_day,
                is_rebookable,
                payment_method,
                quickpay_link: quickPayLink,
                status
            });
        }

        res.json({
            success: true,
            message: 'Booking created successfully',
            booking: booking,
            payment_link: quickPayLink
        });

    } catch (error) {
        console.error('Error in backend-book:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});


export default router;