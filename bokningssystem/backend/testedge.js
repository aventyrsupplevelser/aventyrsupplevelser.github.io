// test-edge.js
import axios from 'axios';

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN6YnZ0bXJxenZvdnl0enFva2tvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzU0OTEzNzAsImV4cCI6MjA1MTA2NzM3MH0.ndbAxa4eaqP8coL61aSWQ9oxt1kt3f9vmvumUcV8Olo';

async function testEdgeFunction() {
    try {
        const response = await axios.post(
            'https://czbvtmrqzvovytzqokko.functions.supabase.co/swish-payment',
            {},  // Empty body since our test function doesn't use request body yet
            {
                headers: {
                    'Authorization': `Bearer ${ANON_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log('Edge function response:', response.data);

    } catch (error) {
        if (error.response) {
            console.error('Error response:', {
                status: error.response.status,
                data: error.response.data,
                headers: error.response.headers
            });
        } else {
            console.error('Error:', error.message);
        }
    }
}

// Run the test
testEdgeFunction();