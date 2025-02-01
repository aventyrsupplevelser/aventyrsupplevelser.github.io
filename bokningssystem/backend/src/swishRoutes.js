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
    ca: fs.readFileSync(path.join(__dirname, '../Swish_TLS_RootCA.pem'), 'utf8'),
    rejectUnauthorized: true  // Enable certificate validation
});

// Create Swish client for sandbox
const swishClient = axios.create({
    httpsAgent: agent,
    baseURL: 'https://staging.getswish.pub.tds.tieto.com',
    headers: {
        'Content-Type': 'application/json'
    }
});

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

        // Prepare payment data with sandbox Swish number
        const paymentData = {
            payeePaymentReference: bookingNumber,
            callbackUrl: `${process.env.PUBLIC_URL}/api/swish/swish-callback`,
            payeeAlias: '1231049352', // Your sandbox Swish number
            currency: 'SEK',
            amount: amount.toString(),
            message: `${bookingNumber}`,
            callbackIdentifier: crypto.randomBytes(16).toString('hex').toUpperCase()
        };

        if (payerAlias) {
            paymentData.payerAlias = payerAlias;
            console.log('Adding payer alias:', payerAlias);
        }

        console.log('Making Swish request with data:', paymentData);

        // Make request to Swish sandbox
        const response = await swishClient.put(
            `/swish-cpcapi/api/v2/paymentrequests/${instructionId}`,
            paymentData
        );

        console.log('Swish response:', {
            status: response.status,
            headers: response.headers,
            data: response.data
        });

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
        // Enhanced error logging
        console.error('Detailed error:', {
            message: error.message,
            response: error.response?.data,
            request: error.request,
            status: error.response?.status,
            stack: error.stack,
            config: {
                url: error.config?.url,
                method: error.config?.method,
                headers: error.config?.headers,
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