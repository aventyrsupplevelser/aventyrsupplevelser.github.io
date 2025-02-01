// In backend/src/swishRoutes.js
import express from 'express';
import { Agent } from 'https';
import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize HTTPS agent with certificates
const agent = new Agent({
    cert: fs.readFileSync(path.join(__dirname, '../certnew.pem'), 'utf8'),
    key: fs.readFileSync(path.join(__dirname, '../PrivateKey.key'), 'utf8'),
    ca: fs.readFileSync(path.join(__dirname, '../Swish_TLS_RootCA.pem'), 'utf8')
});

// Create Swish client
const swishClient = axios.create({
    httpsAgent: agent,
    baseURL: 'https://mss.cpc.getswish.net/swish-cpcapi/api/v2'
});

// Create payment request
//In swishRoutes.js, add this logging:

router.post('/create-payment', async (req, res) => {
    try {
        const { amount, bookingNumber, isMobile, payerAlias } = req.body;
        
        console.log('Received payment request:', {
            amount,
            bookingNumber,
            isMobile,
            payerAlias,
        });

        // Generate instruction ID
        const instructionId = crypto.randomUUID().replace(/-/g, "").toUpperCase();
        console.log('Generated instruction ID:', instructionId);

        // Prepare payment data
        const paymentData = {
            payeePaymentReference: bookingNumber,
            callbackUrl: `${process.env.PUBLIC_URL}/api/swish-callback`,
            payeeAlias: '1231049352',
            currency: 'SEK',
            amount: amount.toString(),
            message: `Booking ${bookingNumber}`
        };

        if (payerAlias) {
            paymentData.payerAlias = payerAlias;
            console.log('Adding payer alias:', payerAlias);
        }

        console.log('Making Swish request with data:', paymentData);

        // Make request to Swish
        const response = await swishClient.put(
            `/paymentrequests/${instructionId}`,
            paymentData
        );

        console.log('Swish response headers:', response.headers);
        console.log('Swish response status:', response.status);
        console.log('Swish response data:', response.data);

        // Rest of the code...
    } catch (error) {
        console.error('Detailed error:', {
            message: error.message,
            response: error.response?.data,
            stack: error.stack
        });
        res.status(400).json({
            success: false,
            error: error.response?.data?.message || error.message
        });
    }
});

// Handle Swish callback
router.post('/swish-callback', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        // Verify Swish signature
        const signature = req.get('Swish-Signature');
        if (!signature) {
            console.error('Missing Swish signature');
            return res.status(400).send('Missing signature');
        }

        // Parse the callback data
        const payment = JSON.parse(req.body.toString());
        console.log('Received Swish callback:', payment);

        // Return 200 OK immediately to acknowledge receipt
        res.status(200).send('OK');

        // Process payment result asynchronously
        if (payment.status === 'PAID') {
            // Update booking status in Supabase
            // You'll need to implement this part
            await updateBookingPaymentStatus(payment);
        }

    } catch (error) {
        console.error('Swish callback error:', error);
        // Still return 200 to prevent retries
        res.status(200).send('OK');
    }
});

// Check payment status
router.get('/payment-status/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const response = await swishClient.get(`/paymentrequests/${id}`);
        const payment = response.data;

        if (payment.status === 'PAID') {
            res.json({
                status: 'completed',
                paymentDetails: {
                    amount: parseFloat(payment.amount),
                    reference: payment.payeePaymentReference
                }
            });
        } else {
            res.json({ status: payment.status.toLowerCase() });
        }

    } catch (error) {
        console.error('Error checking payment status:', error);
        res.status(500).json({ error: 'Failed to check payment status' });
    }
});

export default router;