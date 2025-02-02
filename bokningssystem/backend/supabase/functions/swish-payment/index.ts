// supabase/functions/swish-payment/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import axios from 'https://esm.sh/axios@1.7.9'
import { Agent } from 'https://deno.land/std@0.170.0/node/https.ts'

// Get certificates from environment variables
const cert = Deno.env.get('SWISH_CERTIFICATE')
const key = Deno.env.get('SWISH_PRIVATE_KEY')

if (!cert || !key) {
  throw new Error('Missing certificate environment variables')
}

// Create HTTPS agent with the certificates
const agent = new Agent({
  cert: cert,
  key: key,
  rejectUnauthorized: false // Same as working example
})

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