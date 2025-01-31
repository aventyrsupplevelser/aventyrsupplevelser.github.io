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
router.post('/create-payment', async (req, res) => {
    try {
        const { amount, bookingNumber, isMobile, payerAlias } = req.body;

        // Generate instruction ID
        const instructionId = crypto.randomUUID().replace(/-/g, "").toUpperCase();

        // Prepare payment data
        const paymentData = {
            payeePaymentReference: 12345678,
            callbackUrl: `https://aventyrsupplevelsergithubio-testing.up.railway.app/api/swish/swish-callback`,
            payeeAlias: '1231049352', // Your Swish number
            currency: 'SEK',
            amount: amount.toString(),
            message: `test`
        };

        // Add payerAlias for E-commerce flow (desktop)
        if (payerAlias) {
            paymentData.payerAlias = payerAlias;
        }

        // Make request to Swish
        const response = await swishClient.put(
            `/paymentrequests/${instructionId}`,
            paymentData
        );

        console.log('Payment request created:', response.data);

        // Return different responses based on mobile/desktop
        if (isMobile) {
            res.json({
                success: true,
                paymentId: instructionId,
                token: response.headers['paymentrequesttoken']
            });
        } else {
            res.json({
                success: true,
                paymentId: instructionId
            });
        }

    } catch (error) {
        console.error('Swish payment error:', error.response?.data || error);
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