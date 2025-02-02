// supabase/functions/swish-payment/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

function getCertificates() {
  const rawCert = Deno.env.get('SWISH_CERTIFICATE');
  const rawKey = Deno.env.get('SWISH_PRIVATE_KEY');

  if (!rawCert || !rawKey) {
    throw new Error('Missing required environment variables');
  }

  // Just decode from base64
  const cert = new TextDecoder().decode(Uint8Array.from(atob(rawCert), c => c.charCodeAt(0)));
  const key = new TextDecoder().decode(Uint8Array.from(atob(rawKey), c => c.charCodeAt(0)));
  

  // Log first line of each to verify content (without exposing full cert)
  console.log('Cert starts with:', cert.split('\n')[0]);
  console.log('Key starts with:', key.split('\n')[0]);

  return { cert, key };
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

    const response = await fetch(
      `https://staging.getswish.pub.tds.tieto.com/swish-cpcapi/api/v2/paymentrequests/${instructionId}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(paymentData),
        // @ts-ignore - Deno's fetch has these options but TypeScript doesn't know about them
        cert: cert,
        key: key
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