import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import axios from "https://cdn.jsdelivr.net/npm/axios@1.4.0/+esm";

// Decode from Base64 (Deno-compatible)
function getCertificates() {
  const rawCert = Deno.env.get("SWISH_CERTIFICATE");
  const rawKey = Deno.env.get("SWISH_KEY");

  if (!rawCert || !rawKey) {
    throw new Error("Missing required environment variables");
  }

  const cert = new TextDecoder().decode(Uint8Array.from(atob(rawCert), (c) => c.charCodeAt(0)));
  const key = new TextDecoder().decode(Uint8Array.from(atob(rawKey), (c) => c.charCodeAt(0)));

  return { cert, key };
}

// Load the certificates
const { cert, key } = getCertificates();

// Axios instance with mTLS
const swishClient = axios.create({
  baseURL: "https://staging.getswish.pub.tds.tieto.com",
  httpsAgent: {
    cert,
    key,
  },
});

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  try {
    const { amount, bookingNumber, isMobile, payerAlias } = await req.json();
    console.log("Payment request:", { amount, bookingNumber, isMobile, payerAlias });

    const instructionId = crypto.randomUUID().replace(/-/g, "").toUpperCase();

    const paymentData = {
      payeePaymentReference: bookingNumber,
      callbackUrl: `https://aventyrsupplevelsergithubio-testing.up.railway.app/api/swish/swish-callback`,
      payeeAlias: "1231049352",
      currency: "SEK",
      amount: amount.toString(),
      message: bookingNumber,
    };

    if (payerAlias) {
      paymentData.payerAlias = payerAlias;
    }

    console.log("Making Swish request:", paymentData);

    const response = await swishClient.put(
      `/swish-cpcapi/api/v2/paymentrequests/${instructionId}`,
      paymentData
    );

    return new Response(
      JSON.stringify({
        success: true,
        paymentId: instructionId,
        token: isMobile ? response.headers["paymentrequesttoken"] : undefined,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );

  } catch (error) {
    console.error("Payment error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
});
