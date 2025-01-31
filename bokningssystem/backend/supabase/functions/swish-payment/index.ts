import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import * as https from "node:https";
import { Buffer } from "node:buffer";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type",
      }
    });
  }

  try {
    // Get and decode certificates
    const cert = atob(Deno.env.get("SWISH_CERTIFICATE") || '');
    const key = atob(Deno.env.get("SWISH_PRIVATE_KEY") || '');
    const ca = atob(Deno.env.get("SWISH_ROOT_CA") || '');

    // Generate instruction ID
    const instructionId = crypto.randomUUID().replace(/-/g, "").toUpperCase();

    // Payment data
    const data = {
      payeePaymentReference: 'TEST123464',
      callbackUrl: 'https://aventyrsupplevelsergithubio-testing.up.railway.app/api/payment-callback',
      payeeAlias: '1231049352',
      currency: 'SEK',
      amount: '100',
      message: 'Edge Function Test',
      callbackIdentifier: '11A86BE70EA346E4B1C39C874173F47876'
    };

    // Create HTTPS request using Node's https module
    const result = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'mss.cpc.getswish.net',
        port: 443,
        path: `/swish-cpcapi/api/v2/paymentrequests/${instructionId}`,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(JSON.stringify(data))
        },
        cert: cert,
        key: key,
        ca: ca
      };

      console.log("Making HTTPS request with options:", {
        hostname: options.hostname,
        path: options.path,
        method: options.method,
        headers: options.headers
      });

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data
          });
        });
      });

      req.on('error', (error) => {
        console.error("HTTPS request error:", error);
        reject(error);
      });

      req.write(JSON.stringify(data));
      req.end();
    });

    console.log("HTTPS Response:", result);

    return new Response(
      JSON.stringify({
        success: true,
        ...result
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      }
    );

  } catch (error) {
    console.error("Error details:", {
      name: error.name,
      message: error.message,
      stack: error.stack
    });

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        details: {
          name: error.name,
          stack: error.stack
        }
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      }
    );
  }
});