import { Agent } from 'https';
import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs';

// Helper to get base64 content (for testing Supabase environment vars)
function getBase64Cert(path) {
    return fs.readFileSync(path, { encoding: 'base64' });
}

// Helper to decode base64 back to text
function decodeBase64(base64) {
    return Buffer.from(base64, 'base64').toString('utf8');
}

async function testSwishPayment() {
    try {
        // Create HTTPS agent with certificates
        const agent = new Agent({
            cert: fs.readFileSync('certnew.pem', 'utf8'),
            key: fs.readFileSync('PrivateKey.key', 'utf8'),
            ca: fs.readFileSync('Swish_TLS_RootCA.pem', 'utf8')
        });

        // Generate instruction ID
        const instructionId = crypto.randomUUID().replace(/-/g, "").toUpperCase();

        // Payment data
        const data = {
            payeePaymentReference: 'TEST123464',
            callbackUrl: 'https://aventyrsupplevelsergithubio-testing.up.railway.app/api/payment-callback',
            payeeAlias: '1231049352',
            currency: 'SEK',
            amount: '100',
            message: 'Base64 Certificate Test',
            callbackIdentifier: '11A86BE70EA346E4B1C39C874173F47876'
        };

        // Make the payment request
        const response = await axios.put(
            `https://mss.cpc.getswish.net/swish-cpcapi/api/v2/paymentrequests/${instructionId}`,
            data,
            { httpsAgent: agent }
        );

        console.log('Success! Payment token:', response.headers['paymentrequesttoken']);
        console.log('Full response headers:', response.headers);

        // Let's also test the base64 encoding we'll need for Supabase
        const certBase64 = getBase64Cert('certnew.pem');
        const keyBase64 = getBase64Cert('PrivateKey.key');
        const caBase64 = getBase64Cert('Swish_TLS_RootCA.pem');

        console.log("Certificate length:", certBase64?.length);
        console.log("Private key length:", keyBase64?.length);
        console.log("Root CA length:", caBase64?.length);

        console.log('\nBase64 encoded lengths (for Supabase secrets):');
        console.log('SWISH_CERTIFICATE length:', certBase64.length);
        console.log('SWISH_PRIVATE_KEY length:', keyBase64.length);
        console.log('SWISH_ROOT_CA length:', caBase64.length);

    } catch (error) {
        console.error('Error:', error.response?.data || error.message);
    }
}

// Run the test
testSwishPayment();