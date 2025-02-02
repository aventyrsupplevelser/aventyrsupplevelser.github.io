// supabase/functions/swish-payment/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

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

  console.log('Certificate count:', certs.length);
  console.log('Client cert lines:', certs.map(c => c.split('\n').length));

  return {
    cert: decodedCert, // Use full chain
    key: decodedKey
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  }

  try {
    const { cert, key } = getCertificates();
    const { amount, bookingNumber, isMobile, payerAlias } = await req.json();
    
    console.log('Payment request:', { amount, bookingNumber, isMobile, payerAlias });

    const instructionId = crypto.randomUUID().replace(/-/g, '').toUpperCase();

    const paymentData = {
      payeePaymentReference: bookingNumber,
      callbackUrl: `https://aventyrsupplevelsergithubio-testing.up.railway.app/api/swish/swish-callback`,
      payeeAlias: '1231049352',
      currency: 'SEK',
      amount: amount.toString(),
      message: bookingNumber
    };

    if (payerAlias) {
      paymentData.payerAlias = payerAlias;
    }

    console.log('Making Swish request:', paymentData);

    // Use native fetch with TLS certificates
    const response = await fetch(
      `https://staging.getswish.pub.tds.tieto.com/swish-cpcapi/api/v2/paymentrequests/${instructionId}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(paymentData),
        // @ts-ignore - These options exist in Deno but TypeScript doesn't know about them
        cert: cert,
        key: key,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Swish error response:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText
      });
      throw new Error(errorText || 'Failed to create payment request');
    }

    const token = response.headers.get('paymentrequesttoken');
    
    return new Response(
      JSON.stringify({
        success: true,
        paymentId: instructionId,
        token: isMobile ? token : undefined
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      }
    );

  } catch (error) {
    console.error('Payment error:', error);

    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message
      }),
      { 
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      }
    );
  }
});