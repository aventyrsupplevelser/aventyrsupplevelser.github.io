import express from 'express';
import { Agent } from 'https';
import axios from 'axios';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import EmailService from './emailService.js';
import crypto from 'crypto';
import { console } from 'inspector';



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

console.log('cert:', cert);
console.log('key:', key);

// Create an Axios instance with mTLS
const swishClient = axios.create({
    httpsAgent: agent,
    baseURL: 'https://staging.getswish.pub.tds.tieto.com',
});

router.post('/swish-payment', async (req, res) => {
    try {
        const { bookingNumber, isMobile, payerAlias, access_token } = req.body;
        console.log('Swish payment request:', req.body);
        
        const instructionId = crypto.randomBytes(16).toString('hex');
        console.log('Generated instructionId:', instructionId);

        // Test data exactly as in their documentation
        const testPayment = {
            payeePaymentReference: '0123456789',
            callbackUrl: 'https://aventyrsupplevelsergithubio-testing.up.railway.app/api/swish/swish-callback',
            payeeAlias: '1231049352',
            currency: 'SEK',
            payerAlias: '46793403478',
            amount: 100,
            message: 'Kingston USB Flash Drive 8 GB'
        };

        console.log('Sending test payment data:', testPayment);

        try {
            const response = await swishClient.put(
                `/swish-cpcapi/api/v2/paymentrequests/${instructionId}`,
                testPayment
            );
            
            console.log('Swish response headers:', response.headers);
            console.log('Swish response data:', response.data);
            
            res.json({
                success: true,
                paymentId: instructionId,
                token: response.headers['paymentrequesttoken']
            });
            
        } catch (axiosError) {
            console.error('Detailed Swish error:', {
                status: axiosError.response?.status,
                statusText: axiosError.response?.statusText,
                data: axiosError.response?.data,
                headers: axiosError.response?.headers,
                config: {
                    url: axiosError.config?.url,
                    method: axiosError.config?.method,
                    data: axiosError.config?.data,
                    headers: axiosError.config?.headers
                }
            });
            throw axiosError;
        }

    } catch (error) {
        console.error('Full error object:', error);
        res.status(400).json({ 
            success: false, 
            error: error.response?.data || error.message,
            details: error.response?.data 
        });
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

export default router;