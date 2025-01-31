import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import axios from "npm:axios";
import { Agent } from "node:https";

// Swish API Config
const SWISH_NUMBER = "1231049352"; // Your sandbox Swish number
const SANDBOX_URL = "https://mss.cpc.getswish.net/swish-cpcapi/api/v2";

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
    // Load certificates from environment variables
    const cert = Deno.env.get("SWISH_CERTIFICATE");
    const key = Deno.env.get("SWISH_PRIVATE_KEY");
    const ca = Deno.env.get("SWISH_ROOT_CA");

    if (!cert || !key || !ca) {
      throw new Error("Missing required certificates");
    }

    console.log("Certificate length:", cert?.length);
    console.log("Private key length:", key?.length);
    console.log("Root CA length:", ca?.length);

    

    // Decode Base64 encoded certificates
    const decodedCert = atob(cert);
    const decodedKey = atob(key);
    const decodedCa = atob(ca);

    console.log("Certificate Start:", decodedCert.slice(0, 100));
console.log("Private Key Start:", decodedKey.slice(0, 100));
console.log("Root CA Start:", decodedCa.slice(0, 100));

console.log("Certificate lines:", decodedCert.split('\n').length);
console.log("Private key lines:", decodedKey.split('\n').length);
console.log("CA lines:", decodedCa.split('\n').length);
    const testResponse = await fetch("https://httpbin.org/get");
    console.log("Test Request Response:", await testResponse.json());
    



    // Generate unique instruction ID
    const instructionId = crypto.randomUUID().replace(/-/g, "").toUpperCase();

    // Prepare payment data
    const data = {
      payeePaymentReference: "TEST123464",
      callbackUrl: "https://aventyrsupplevelsergithubio-testing.up.railway.app/api/payment-callback",
      payeeAlias: SWISH_NUMBER,
      currency: "SEK",
      amount: "100",
      message: "Edge Function Test",
      callbackIdentifier: "11A86BE70EA346E4B1C39C874173F47876",
    };

    console.log(data);

    // Create HTTPS Agent for TLS authentication
    const agent = new Agent({
      cert: decodedCert,
      key: decodedKey,
      ca: decodedCa,
    });

    // Send request using Axios with TLS options
    const response = await axios.put(
      `${SANDBOX_URL}/paymentrequests/${instructionId}`,
      data,
      { httpsAgent: agent }
    );

    // Return response with debug information
    return new Response(
      JSON.stringify({
        success: true,
        paymentId: instructionId,
        token: response.headers["paymentrequesttoken"],
        headers: response.headers,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack,
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
