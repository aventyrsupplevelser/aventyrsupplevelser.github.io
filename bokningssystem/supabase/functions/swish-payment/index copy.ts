// Supabase Edge Function: swish-payment
// Endpoint: POST /functions/v1/swish-payment

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import axios from "npm:axios";
import { Agent } from "https://deno.land/std@0.208.0/node/https.ts";

// Load Supabase environment variables
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);

const decodeBase64 = (b64: string) => {
  return new TextDecoder("utf-8").decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
};

const swishCert = decodeBase64(Deno.env.get("SWISH_CERTIFICATE")!);
const swishKey = decodeBase64(Deno.env.get("SWISH_PRIVATE_KEY")!);
const swishCa = decodeBase64(Deno.env.get("SWISH_ROOT_CA")!);

const swishMerchant = Deno.env.get("SWISH_MERCHANT_ALIAS")!;
const swishCallbackUrl = Deno.env.get("SWISH_CALLBACK_URL")!;

// Create HTTPS agent for Swish API
const agent = new Agent({
  cert: swishCert,
  key: swishKey,
  ca: swishCa,
});

// Function to create a Swish payment request
async function createSwishPayment(amount: number, payerAlias: string | null, bookingNumber: string) {
  try {
    // Generate a unique instruction UUID (Swish requires uppercase HEX format)
    const instructionId = crypto.randomUUID().replace(/-/g, "").toUpperCase();

    // Prepare payment request data
    const paymentData = {
      payeePaymentReference: bookingNumber,
      callbackUrl: swishCallbackUrl,
      payeeAlias: swishMerchant,
      payerAlias: payerAlias || undefined, // Only include if provided
      amount: amount.toString(),
      currency: "SEK",
      message: `12345`,
    };

    console.log("Sending Swish payment request:", paymentData);

    // Send request to Swish API
    const response = await axios.put(
      `https://mss.cpc.getswish.net/swish-cpcapi/api/v2/paymentrequests/${instructionId}`,
      paymentData,
      { httpsAgent: agent }
    );

    console.log("Swish Response Headers:", response.headers);

    return {
      success: true,
      token: response.headers["paymentrequesttoken"] || null,
      instructionId,
    };
  } catch (error) {
    console.error("Swish payment error:", error.response?.data || error.message);
    return { success: false, error: error.response?.data || "Swish request failed" };
  }
}

// Handle incoming requests
serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { amount, bookingData, isMobile, payerAlias } = await req.json();

    if (!amount || !bookingData?.bookingNumber) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const result = await createSwishPayment(amount, payerAlias, bookingData.bookingNumber);

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in Swish Edge Function:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
