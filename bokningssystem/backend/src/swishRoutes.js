import express from 'express';
import { Agent } from 'https';
import axios from 'axios';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import EmailService from './emailService.js';



dotenv.config();

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const router = express.Router(); // <--- You forgot this line!

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
        const { bookingNumber, isMobile, payerAlias, access_token } = req.body;
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
            callbackIdentifier: access_token
        };

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
        if (!callbackIdentifier) {
            console.error('Missing callback identifier');
            return;
        }

        // First get the booking
        const { data: booking, error: bookingError } = await supabase
            .from('bookings')
            .select('*, time_slots(*)')
            .eq('booking_number', payment.payeePaymentReference)
            .eq('access_token', callbackIdentifier)
            .single();

        if (bookingError || !booking) {
            console.error('Booking not found or access token mismatch');
            return;
        }

        if (booking.status !== 'pending') {
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
                .eq('status', 'pending')
                .eq('access_token', callbackIdentifier);

            if (updateError) {
                console.error('Error updating booking with payment info:', updateError);
                return;
            }

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
        const { order_id, access_token } = req.body;
        
        // Log incoming request
        console.log('Received request:', { order_id, access_token: '***' });

        if (!order_id || !access_token) {
            return res.status(400).json({ error: 'order_id and access_token are required.' });
        }

        // Calculate amount and log it
        const { data: amount, error } = await supabase.rpc('calculate_booking_amount', {
            p_access_token: access_token
        });
        if (error) throw error;
        console.log('Calculated amount:', amount);

        // Log API credentials (mask sensitive data)
        const apiKey = process.env.QUICKPAY_API_USER_KEY; // Note: Changed from QUICKPAY_PAYMENT_WINDOW_KEY
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

        // Step 2: Create payment link with detailed logging
        const linkRequestBody = {
            amount: amount,  // Make sure this is in smallest currency unit (öre)
            continue_url: `http://localhost:3000/bokningssystem/frontend/tackfordinbokning.html?order_id=${order_id}`,
            cancel_url: `https://aventyrsupplevelsergithubio-testing.up.railway.app/payment-cancelled.html`,
            callback_url: `https://aventyrsupplevelsergithubio-testing.up.railway.app/api/payment-callback`,
            auto_capture: true,
            payment_methods: 'creditcard',
            language: 'sv'
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

export default router;