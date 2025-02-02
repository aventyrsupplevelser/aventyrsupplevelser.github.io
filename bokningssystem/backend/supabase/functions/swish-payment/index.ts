import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import axios from 'https://esm.sh/axios@1.7.9'
import { Agent } from 'https://deno.land/std@0.170.0/node/https.ts'

function normalizeCertificate(cert: string): string {
  return cert
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

function getCertificates() {
  const rawCert = Deno.env.get('SWISH_CERTIFICATE');
  const rawKey = Deno.env.get('SWISH_PRIVATE_KEY');

  if (!rawCert || !rawKey) {
    throw new Error('Missing required environment variables');
  }

  const decodedCert = normalizeCertificate(atob(rawCert));
  const decodedKey = normalizeCertificate(atob(rawKey));

  const certs = decodedCert
    .split('-----END CERTIFICATE-----\n')
    .map(cert => cert.trim())
    .filter(cert => cert.length > 0)
    .map(cert => `${cert}\n-----END CERTIFICATE-----\n`);

  const clientCert = certs[0];
  const ca = certs.slice(1);

  console.log('Certificate count:', certs.length);
  console.log('Client cert lines:', clientCert.split('\n').length);
  console.log('CA certs lines:', ca.map(c => c.split('\n').length));

  return {
    cert: clientCert,
    key: decodedKey,
    ca
  };
}

// Get the certificates
const { cert, key, ca } = getCertificates();

// Create HTTPS agent with the certificates
const agent = new Agent({
  cert,
  key,
  ca,
  rejectUnauthorized: false
});

// Create Swish client
const swishClient = axios.create({
  httpsAgent: agent,
  baseURL: 'https://staging.getswish.pub.tds.tieto.com',
});

// Create Swish client
const swishClient = axios.create({
  httpsAgent: agent,
  baseURL: 'https://staging.getswish.pub.tds.tieto.com',
})

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    })
  }

  try {
    // Parse request body
    const { amount, bookingNumber, isMobile, payerAlias } = await req.json()
    
    // Log incoming request
    console.log('Payment request:', { amount, bookingNumber, isMobile, payerAlias })

    // Generate instruction ID (same as original)
    const instructionId = crypto.randomUUID().replace(/-/g, '').toUpperCase()

    // Prepare payment data (same as original)
    const paymentData = {
      payeePaymentReference: 123456,
      callbackUrl: `https://aventyrsupplevelsergithubio-testing.up.railway.app/api/swish/swish-callback`,
      payeeAlias: '1231049352',
      currency: 'SEK',
      amount: amount.toString(),
      message: bookingNumber
    }

    if (payerAlias) {
      paymentData.payerAlias = payerAlias
    }

    console.log('Making Swish request:', paymentData)

    // Make request to Swish
    const response = await swishClient.put(
      `/swish-cpcapi/api/v2/paymentrequests/${instructionId}`,
      paymentData
    )

    console.log('Swish response:', {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      data: response.data
    })

    // Return response based on mobile/desktop (same as original)
    return new Response(
      JSON.stringify({
        success: true,
        paymentId: instructionId,
        token: isMobile ? response.headers['paymentrequesttoken'] : undefined
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      }
    )

  } catch (error) {
    console.error('Payment error:', {
      message: error.message,
      response: error.response?.data,
      config: {
        url: error.config?.url,
        method: error.config?.method,
        data: error.config?.data
      }
    })

    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.response?.data?.message || error.message 
      }),
      { 
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      }
    )
  }
})