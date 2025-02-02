import express from 'express';
import { Agent } from 'https';
import axios from 'axios';
import dotenv from 'dotenv';
import crypto from 'crypto'; 
import { createClient } from '@supabase/supabase-js';


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
    baseURL: 'https://staging.getswish.pub.tds.tieto.com',
});

router.post('/swish-payment', async (req, res) => {
    try {
        const { bookingNumber, isMobile, payerAlias, token } = req.body;
        console.log('Swish payment request:', req.body);
        console.log('Token:', token);
        console.log(token.type);
        const instructionId = crypto.randomUUID().replace(/-/g, "").toUpperCase();

        const { data: data, error } = await supabase.rpc('calculate_booking_amount', { 
            p_access_token: token
        });
      if (error) throw error;

      const amount = data;

        const paymentData = {
            payeePaymentReference: bookingNumber,
            callbackUrl: `https://aventyrsupplevelsergithubio-testing.up.railway.app/api/swish/swish-callback`,
            payeeAlias: '1231049352',
            currency: 'SEK',
            amount: amount.toString(),
            message: 'Sörsjöns Äventyrspark'
        };

        if (payerAlias) {
            paymentData.payerAlias = payerAlias;
        }

        console.log('Making Swish request:', paymentData);

        const response = await swishClient.put(
            `/swish-cpcapi/api/v2/paymentrequests/${instructionId}`,
            paymentData
        );

        res.json({
            success: true,
            paymentId: instructionId,
            token: response.headers['paymentrequesttoken']
        });

    } catch (error) {
        console.error('Swish payment error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

// Handle callbacks from Swish
router.post('/swish-callback', express.json(), async (req, res) => {
    try {
        const payment = req.body;
        console.log('Received Swish callback:', payment);
        res.status(200).send('OK');

        // If payment successful, update booking status
        if (payment.status === 'PAID') {
            // TODO: Update booking status in Supabase
        }
    } catch (error) {
        console.error('Swish callback error:', error);
        res.status(200).send('OK');  // Always return 200 to prevent retries
    }
});

// Check payment status
router.get('/payment-status/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const response = await swishClient.get(
            `/swish-cpcapi/api/v2/paymentrequests/${id}`
        );

        if (response.data.status === 'PAID') {
            res.json({
                status: 'completed',
                paymentDetails: {
                    amount: parseFloat(response.data.amount),
                    reference: response.data.payeePaymentReference
                }
            });
        } else {
            res.json({ status: response.data.status.toLowerCase() });
        }

    } catch (error) {
        console.error('Error checking payment status:', error);
        res.status(500).json({ error: 'Failed to check payment status' });
    }
});

export default router;