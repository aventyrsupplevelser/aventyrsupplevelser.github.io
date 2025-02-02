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

// Load certificates more simply
const cert = fs.readFileSync(path.join(__dirname, '../certnew.pem'), 'utf8');
const key = fs.readFileSync(path.join(__dirname, '../PrivateKey.key'), 'utf8');

// Create HTTPS agent with just the necessary certs
const agent = new Agent({
    cert: cert,
    key: key,
});

// Create Swish client
const swishClient = axios.create({
    httpsAgent: agent,
    baseURL: 'https://staging.getswish.pub.tds.tieto.com',
});

// Rest of your router code...
router.post('/create-payment', async (req, res) => {
    try {
        const { amount, bookingNumber, isMobile, payerAlias } = req.body;
        
        // Log incoming request
        console.log('Payment request:', { amount, bookingNumber, isMobile, payerAlias });

        const instructionId = crypto.randomUUID().replace(/-/g, "").toUpperCase();
        
        const paymentData = {
            payeePaymentReference: 123456,
            callbackUrl: `https://aventyrsupplevelsergithubio-testing.up.railway.app/api/swish/swish-callback`,
            payeeAlias: '1231049352',  // Your sandbox Swish number
            currency: 'SEK',
            amount: amount.toString(),
            message: bookingNumber
        };

       if (payerAlias) {
            paymentData.payerAlias = payerAlias;
        } 

        console.log('Making Swish request:', paymentData);

        const response = await swishClient.put(
            `/swish-cpcapi/api/v2/paymentrequests/${instructionId}`,
            paymentData
        );

        console.log('Swish response:', {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            data: response.data
        });

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
        console.error('Payment error:', {
            message: error.message,
            response: error.response?.data,
            config: {
                url: error.config?.url,
                method: error.config?.method,
                data: error.config?.data
            }
        });
        
        res.status(400).json({
            success: false,
            error: error.response?.data?.message || error.message
        });
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