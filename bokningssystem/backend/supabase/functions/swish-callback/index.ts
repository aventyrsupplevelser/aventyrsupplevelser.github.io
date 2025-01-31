import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

serve(async (req) => {
  try {
    const payment = await req.json()
    console.log('Received Swish callback:', payment)

    // Initialize Supabase client
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    if (payment.status === 'PAID') {
      // Update booking status in database
      const { error } = await supabaseAdmin
        .from('bookings')
        .update({
          status: 'confirmed',
          payment_id: payment.paymentReference,
          payment_method: 'swish',
          paid_amount: Math.round(parseFloat(payment.amount) * 100), // Convert to öre
          payment_completed_at: new Date().toISOString()
        })
        .eq('booking_number', payment.payeePaymentReference)

      if (error) {
        console.error('Database update error:', error)
      }
    }

    // Always return 200 OK to acknowledge the callback
    return new Response('OK', { status: 200 })
  } catch (error) {
    console.error('Callback error:', error)
    return new Response('OK', { status: 200 }) 
  }
})