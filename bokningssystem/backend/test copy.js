import { readFileSync } from 'fs';
import { Agent } from 'https';
import axios from 'axios';
import crypto from 'crypto'; // Fix UUID generation

const agent = new Agent({
  cert: readFileSync('certnew.pem', { encoding: 'utf8' }),
  key: readFileSync('PrivateKey.key', { encoding: 'utf8' }),
  ca: readFileSync('Swish_TLS_RootCA.pem', { encoding: 'utf8' }),
});

// Generate a UUID correctly in ESM
const instructionId = crypto.randomUUID().replace(/-/g, "").toUpperCase();

const data = {
  payeePaymentReference: 'HEJ123463',
  callbackUrl: 'https://aventyrsupplevelsergithubio-testing.up.railway.app/api/payment-callback',
  payeeAlias: '1231049352',
  currency: 'SEK',
  amount: '100',
  message: 'Kingston USB Flash Drive 8 GB',
  callbackIdentifier: '11A86BE70EA346E4B1C39C874173F47876'
};

// Make the payment request
axios.put(
  `https://mss.cpc.getswish.net/swish-cpcapi/api/v2/paymentrequests/${instructionId}`,
  data,
  { httpsAgent: agent }
).then((res) => {
  console.log('Payment request created:', res.data);
  console.log("Response Headers:", res.headers); // Log headers
}).catch((err) => {
  console.error('Error creating payment request:', err.response?.data || err.message);
});