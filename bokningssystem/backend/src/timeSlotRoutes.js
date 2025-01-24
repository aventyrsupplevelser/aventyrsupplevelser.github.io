import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';

const updateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    // Add a custom key generator that doesn't use X-Forwarded-For
    keyGenerator: (req) => {
        return req.ip; // Use the raw IP instead
    }
});

const rawBodyParser = express.raw({ 
    type: 'application/json',
    limit: '50mb'  // Adjust if needed
});


// First, load environment variables
dotenv.config();

// Validate required environment variables before proceeding
const requiredEnvVars = [
    'SUPABASE_URL', 
    'SUPABASE_SERVICE_ROLE_KEY', 
    'ADMIN_EMAIL', 
    'ADMIN_PASSWORD'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
    console.error('Missing required environment variables:', missingVars);
    throw new Error('Missing required environment variables');
}

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

console.log('Supabase client initialized');

// Create router
const router = express.Router();

// Authentication helper function
async function checkAuth() {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
        console.log('Auth error:', error);
        return false;
    }
    if (session) {
        console.log('Authenticated as:', session.user.email);
        return true;
    }
    console.log('Not authenticated');
    return false;
}

function calculateChecksum(params, apiKey) {
    // Flatten and sort parameters
    const flattenedParams = flattenParams(params);
    const sortedValues = Object.keys(flattenedParams)
        .sort() // Sort keys alphabetically
        .map((key) => flattenedParams[key] || ''); // Include empty strings for undefined/null values

    // Concatenate values with a single space
    const concatenatedValues = sortedValues.join(' ');

    // Generate HMAC-SHA256 checksum
    return crypto
        .createHmac('sha256', apiKey)
        .update(concatenatedValues)
        .digest('hex');
}

function flattenParams(params, result = {}, path = []) {
    if (params instanceof Object) {
        for (const key in params) {
            flattenParams(params[key], result, [...path, key]);
        }
    } else {
        const flatKey = path.join('');
        result[flatKey] = params;
    }
    return result;
}

// Updated verification middleware
function verifyQuickPayCallback(req, res, next) {
    try {
        const quickpaySignature = req.get('QuickPay-Checksum-Sha256');
        
        if (!quickpaySignature) {
            console.error('No QuickPay signature found in callback');
            return res.status(401).send('No signature');
        }

        // The body should be a Buffer at this point
        const rawBody = req.body;
        
        if (!Buffer.isBuffer(rawBody)) {
            console.error('Expected raw body to be Buffer');
            return res.status(400).send('Invalid body format');
        }

        // Calculate signature using the raw buffer
        const calculatedSignature = crypto
            .createHmac('sha256', process.env.QUICKPAY_PRIVATE_KEY)
            .update(rawBody)
            .digest('hex');

        if (quickpaySignature !== calculatedSignature) {
            console.error('Invalid QuickPay signature');
            console.log('Received:', quickpaySignature);
            console.log('Calculated:', calculatedSignature);
            return res.status(401).send('Invalid signature');
        }

        // Parse the raw body as JSON for the next middleware
        req.body = JSON.parse(rawBody.toString('utf8'));
        next();
    } catch (error) {
        console.error('Error in QuickPay verification:', error);
        res.status(500).send('Verification error');
    }
}

// Group 1: Authentication Routes
// Update your signin route to be more explicit
router.post('/signin', async (req, res) => {
    console.log('Starting signin process...');
    
    // First, verify we have the credentials
    if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
        console.log('Missing admin credentials in environment variables');
        return res.status(400).json({ 
            error: 'Server configuration error - missing credentials' 
        });
    }

    try {
        console.log('Attempting to sign in with:', {
            email: process.env.ADMIN_EMAIL,
            // Don't log the password!
            hasPassword: !!process.env.ADMIN_PASSWORD
        });

        // Attempt to sign in using Supabase
        const { data, error } = await supabase.auth.signInWithPassword({
            email: process.env.ADMIN_EMAIL,
            password: process.env.ADMIN_PASSWORD
        });
        
        if (error) {
            console.log('Supabase signin error:', error);
            return res.status(400).json({ 
                error: 'Authentication failed',
                details: error.message 
            });
        }

        if (!data.session) {
            console.log('No session returned from Supabase');
            return res.status(400).json({ 
                error: 'No session created' 
            });
        }

        console.log('Sign in successful for:', data.user.email);
        
        // Return the session information that we'll need for future requests
        res.json({ 
            message: 'Signed in successfully',
            session: {
                accessToken: data.session.access_token,
                userId: data.user.id,
                email: data.user.email
            }
        });
    } catch (error) {
        console.error('Unexpected error during signin:', error);
        res.status(500).json({ 
            error: 'Authentication failed',
            details: error.message 
        });
    }
});

// Group 2: Diagnostic Routes
router.get('/test', (req, res) => {
    console.log('Test route accessed!');
    res.json({ message: 'Time slot routes are connected!' });
});

router.get('/hello', (req, res) => {
    console.log('Hello route accessed!');
    res.json({ message: 'Hello from the time slots router!' });
});

// Group 3: Time Slot Management Routes
// Create single time slot
router.post('/time-slots', async (req, res) => {
    try {
        const isAuthenticated = await checkAuth();
        if (!isAuthenticated) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const { start_time, end_time, total_spots, allow_full_day } = req.body;
        console.log('Creating time slot:', { start_time, end_time, total_spots, allow_full_day });

        const { data, error } = await supabase
            .from('time_slots')
            .insert({
                start_time,
                end_time,
                total_spots: total_spots || 20,
                available_spots: total_spots || 20,
                allow_full_day: allow_full_day || false
            })
            .select()
            .single();

        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('Time slot creation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create multiple time slots
router.post('/time-slots/bulk', async (req, res) => {
    try {
        const isAuthenticated = await checkAuth();
        if (!isAuthenticated) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const { 
            start_date, 
            end_date, 
            times,
            duration, 
            total_spots,
            allow_full_day, 
            days_of_week 
        } = req.body;

        const slots = [];
        const startDate = new Date(start_date);
        const endDate = new Date(end_date);

        for (let date = startDate; date <= endDate; date.setDate(date.getDate() + 1)) {
            if (days_of_week.includes(date.getDay())) {
                for (const time of times) {
                    const [hours, minutes] = time.split(':').map(Number);
                    const slotStart = new Date(date);
                    slotStart.setHours(hours, minutes, 0, 0);
                    
                    const slotEnd = new Date(slotStart);
                    slotEnd.setMinutes(slotStart.getMinutes() + duration);

                    slots.push({
                        start_time: slotStart.toISOString(),
                        end_time: slotEnd.toISOString(),
                        total_spots: total_spots || 20,
                        available_spots: total_spots || 20,
                        allow_full_day: allow_full_day || false
                    });
                }
            }
        }

        const { data, error } = await supabase
            .from('time_slots')
            .insert(slots)
            .select();

        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('Bulk time slot creation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all future time slots
router.get('/time-slots', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('time_slots')
            .select('*')
            .gte('start_time', new Date().toISOString())
            .order('start_time', { ascending: true });

        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('Time slot fetch error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update time slot
router.put('/time-slots/:id', async (req, res) => {
    try {
        const isAuthenticated = await checkAuth();
        if (!isAuthenticated) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const { total_spots, allow_full_day } = req.body;
        const slotId = req.params.id;

        const { data, error } = await supabase
            .from('time_slots')
            .update({
                total_spots,
                available_spots: total_spots,
                allow_full_day
            })
            .eq('id', slotId)
            .select()
            .single();

        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('Time slot update error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete time slot
router.delete('/time-slots/:id', async (req, res) => {
    try {
        const isAuthenticated = await checkAuth();
        if (!isAuthenticated) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const slotId = req.params.id;

        // Check for existing bookings
        const { data: bookings, error: bookingError } = await supabase
            .from('bookings')
            .select('id')
            .eq('time_slot_id', slotId)
            .limit(1);

        if (bookingError) throw bookingError;

        if (bookings?.length > 0) {
            return res.status(400).json({ 
                error: 'Cannot delete time slot with existing bookings' 
            });
        }

        const { error: deleteError } = await supabase
            .from('time_slots')
            .delete()
            .eq('id', slotId);

        if (deleteError) throw deleteError;
        res.json({ message: 'Time slot deleted successfully' });
    } catch (error) {
        console.error('Time slot deletion error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Request logging middleware
router.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
    next();
});

router.post('/bookings/pending', async (req, res) => {
    const { time_slot_id, adult_quantity, youth_quantity, kid_quantity } = req.body;

    try {
        // Generate token in the backend
        const accessToken = crypto.randomBytes(32).toString('hex');

        // Call the stored procedure and pass the token
        const { data, error } = await supabase.rpc('create_booking', {
            p_time_slot_id: time_slot_id,
            p_adult_quantity: adult_quantity,
            p_youth_quantity: youth_quantity,
            p_kid_quantity: kid_quantity,
            p_access_token: accessToken, // Pass token to the procedure
        });

        if (error) {
            console.error('Error creating booking:', error);
            return res.status(400).json({ error: error.message });
        }

        console.log('Stored Procedure Response:', data);

        console.log('Response Sent to Frontend:', data);
        res.status(201).json(data);
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).json({ error: error.message });
    }
});

router.put('/bookings/:id', updateLimiter, async (req, res) => {
    const { id } = req.params;
    const {
        full_day,
        access_token,
        time_slot_id,
        adult_quantity,
        youth_quantity,
        kid_quantity,
        status,
        customer_email,
        customer_name,
        comments,
        customer_phone,
    } = req.body;

    if (!access_token) {
        return res.status(401).json({ error: 'No access token provided' });
    }

    try {
        // Call the stored procedure
        const { data, error } = await supabase.rpc('manage_booking', {
            p_booking_id: id,
            p_new_time_slot_id: time_slot_id,
            p_new_adult_quantity: adult_quantity,
            p_new_youth_quantity: youth_quantity,
            p_new_kid_quantity: kid_quantity,
            p_full_day: full_day,
            p_status: status,
            p_customer_email: customer_email,
            p_customer_name: customer_name,
            p_customer_phone: customer_phone,
            p_comments: comments,
            p_delete: false,
        });

        if (error) {
            console.error('Error updating booking:', error.message);
            return res.status(400).json({ error: error.message });
        }

        // Log debug messages
        console.log('Debug Messages:', data);

        res.json({ message: 'Booking updated successfully', debugMessages: data });
    } catch (error) {
        console.error('Unexpected error during booking update:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});






router.get('/bookings/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Get the current booking with access token validation
        const { data: booking, error } = await supabase
            .from('bookings')
            .select('*')
            .eq('id', id)
            .eq('status', 'pending')
            .single();

        if (error) throw error;
        
        if (!booking) {
            return res.status(404).json({ error: 'Booking not found or not pending' });
        }

        res.json(booking);

    } catch (error) {
        console.error('Error fetching booking:', error);
        res.status(500).json({ error: error.message });
    }
});

router.delete('/bookings/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const { error } = await supabase.rpc('manage_booking', {
            p_booking_id: id,
            p_delete: true,
        });

        if (error) {
            console.error('Error deleting booking:', error);
            return res.status(400).json({ error: error.message });
        }

        res.json({ message: 'Booking deleted successfully' });
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).json({ error: error.message });
    }
});


router.post('/test-payment', async (req, res) => {
    try {
        // Use API user key for both operations
        const authHeader = `Basic ${Buffer.from(':' + process.env.QUICKPAY_API_USER_KEY).toString('base64')}`;
        
        // Create payment
        const response = await fetch('https://api.quickpay.net/payments', {
            method: 'POST',
            headers: {
                'Accept-Version': 'v10',
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                order_id: `test-${Date.now()}`,
                currency: 'SEK'
            })
        });

        if (!response.ok) {
            const error = await response.text();
            console.error('Payment creation error response:', error);
            throw new Error('Failed to create payment');
        }

        const payment = await response.json();
        console.log('Payment created:', payment);
        
        // Create payment link
        const linkResponse = await fetch(`https://api.quickpay.net/payments/${payment.id}/link`, {
            method: 'PUT',
            headers: {
                'Accept-Version': 'v10',
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                amount: 1000, // 10 SEK
                continue_url: 'https://localhost:3000/success',
                callback_url: 'https://aventyrsupplevelsergithubio-testing.up.railway.app/api/quickpay-callback',
                cancel_url: 'https://localhost:3000/cancel',
                payment_methods: 'creditcard'
            })
        });

        if (!linkResponse.ok) {
            const error = await linkResponse.text();
            console.error('Link creation error response:', error);
            throw new Error('Failed to create payment link');
        }

        const linkData = await linkResponse.json();
        console.log('Payment link created:', linkData);

        res.json({ 
            payment_id: payment.id,
            payment_url: linkData.url 
        });

    } catch (error) {
        console.error('Test payment error:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/create-payment', async (req, res) => {
    try {
        const { 
            bookingId, 
            paymentMethod,
            customerName,
            customerEmail,
            customerPhone,
            customerComment 
        } = req.body;
        
        // Function to generate booking number
        async function generateUniqueBookingNumber() {
            let isUnique = false;
            let bookingNumber;
            
            while (!isUnique) {
                // Generate 8-digit number
                const randomDigits = Math.floor(10000000 + Math.random() * 90000000);
                bookingNumber = `B${randomDigits}`;
                
                // Check if this number already exists
                const { data, error } = await supabase
                    .from('bookings')
                    .select('booking_number')
                    .eq('booking_number', bookingNumber)
                    .single();
                
                if (error && error.code === 'PGRST116') { // No rows returned
                    isUnique = true;
                } else if (error) {
                    throw error;
                }
            }
            
            return bookingNumber;
        }

        // Generate unique booking number
        const bookingNumber = await generateUniqueBookingNumber();
        console.log('Generated unique booking number:', bookingNumber);

        // Get booking details from Supabase
        const { data: booking, error: bookingError } = await supabase
            .from('bookings')
            .select('*')
            .eq('id', bookingId)
            .single();

        if (bookingError) throw bookingError;

        // Calculate totals
        const adultTotal = booking.adult_quantity * 400;
        const youthTotal = booking.youth_quantity * 300;
        const kidTotal = booking.kid_quantity * 200;
        const fullDayTotal = booking.full_day * 100;
        const totalTickets = booking.adult_quantity + booking.youth_quantity + booking.kid_quantity;
        const rebookingTotal = booking.is_rebookable ? (totalTickets * 25) : 0;
        const totalAmount = adultTotal + youthTotal + kidTotal + fullDayTotal + rebookingTotal;

        // Update booking with customer details and booking number
        const { error: updateError } = await supabase
            .from('bookings')
            .update({
                customer_name: customerName,
                customer_email: customerEmail,
                customer_phone: customerPhone,
                comments: customerComment,
                booking_number: bookingNumber
            })
            .eq('id', bookingId)
            .select();

        if (updateError) {
            console.error('Error updating booking:', updateError);
            throw new Error('Failed to update booking with customer details');
        }

        res.json({ 
            orderId: bookingNumber,
            amount: totalAmount * 100 // Convert to öre
        });

    } catch (error) {
        console.error('Payment creation error:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/get-payment-form', (req, res) => {
    try {
        const { amount, order_id, paymentMethod, basketInfo } = req.body;
        
        if (!amount || !order_id) {
            return res.status(400).json({ error: 'Amount and order_id are required.' });
        }

        const merchant_id = process.env.QUICKPAY_MERCHANT_ID;
        const agreement_id = process.env.QUICKPAY_AGREEMENT_ID;
        const apiKey = process.env.QUICKPAY_PAYMENT_WINDOW_KEY;

        const ngrokUrl = 'https://aventyrsupplevelsergithubio-testing.up.railway.app';

        let payment_methods;
        if (paymentMethod === 'card') {
            payment_methods = '3d-visa, 3d-visa-electron, 3d-mastercard, 3d-mastercard-debet';
        } else if (paymentMethod === 'swish') {
            payment_methods = 'swish';
        }

        const params = {
            version: 'v10',
            merchant_id,
            agreement_id,
            amount,
            currency: 'SEK',
            order_id,
            variables: {
                booking_ref: order_id,
                adult_tickets: `${basketInfo.tickets.adult} st (${basketInfo.pricing.adultTotal} kr)`,
                youth_tickets: `${basketInfo.tickets.youth} st (${basketInfo.pricing.youthTotal} kr)`,
                kid_tickets: `${basketInfo.tickets.kid} st (${basketInfo.pricing.kidTotal} kr)`,
                date_time: `${basketInfo.date} ${basketInfo.time}`,
                full_day: basketInfo.tickets.fullDay ? `Ja (${basketInfo.pricing.fullDayTotal} kr)` : 'Nej',
                rebooking: basketInfo.is_rebookable ? `Ja (${basketInfo.pricing.rebookingTotal} kr)` : 'Nej',
                vat: `${basketInfo.pricing.vatAmount.toFixed(2)} kr`,
                total: `${basketInfo.pricing.total} kr`
            },
            continueurl: `https://aventyrsupplevelser.com/bokningssystem/frontend/tackfordinbokning.html?order_id=${order_id}`,
            cancelurl: `${ngrokUrl}/payment-cancelled.html`,
            callbackurl: `${ngrokUrl}/api/payment-callback`,
            language: 'sv',
            autocapture: '1',
            payment_methods,
            branding_id: '14851'
        };

        params.checksum = calculateChecksum(params, apiKey);

        const formHtml = `
            <form method="POST" action="https://payment.quickpay.net">
                ${Object.entries(params)
                    .map(([key, value]) => {
                        if (key === 'variables') {
                            return Object.entries(value).map(([varKey, varValue]) =>
                                `<input type="hidden" name="variables[${varKey}]" value="${varValue}">`
                            ).join('\n');
                        }
                        return value ? `<input type="hidden" name="${key}" value="${value}">` : '';
                    }).flat().join('\n')}
            </form>
        `;

        res.send(formHtml);
    } catch (error) {
        console.error('Error generating payment form:', error);
        res.status(500).json({ error: error.message });
    }

});



// In timeSlotRoutes.js
router.get('/bookings/:id/summary', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Get the booking details
        const { data: booking, error } = await supabase
            .from('bookings')
            .select(`
                *,
                time_slots (
                    start_time,
                    end_time
                )
            `)
            .eq('id', id)
            .single();

        if (error) throw error;
        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        // Calculate totals
        const adultTotal = booking.adult_quantity * 400;
        const youthTotal = booking.youth_quantity * 300;
        const kidTotal = booking.kid_quantity * 200;
        const fullDayTotal = booking.full_day * 100;
        const totalTickets = booking.adult_quantity + booking.youth_quantity + booking.kid_quantity;
        const rebookingTotal = booking.is_rebookable ? (totalTickets * 25) : 0;

        const subtotal = adultTotal + youthTotal + kidTotal + fullDayTotal + rebookingTotal;
        const vatRate = 0.06; // 6% VAT
        const vatAmount = (subtotal * vatRate) / (1 + vatRate); // Calculate VAT from inclusive price

        const summary = {
            date: new Date(booking.time_slots.start_time).toLocaleDateString('sv-SE'),
            time: new Date(booking.time_slots.start_time).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }),
            tickets: {
                adult: booking.adult_quantity,
                youth: booking.youth_quantity,
                kid: booking.kid_quantity,
                fullDay: booking.full_day
            },
            is_rebookable: booking.is_rebookable,
            pricing: {
                adultTotal,
                youthTotal,
                kidTotal,
                fullDayTotal,
                rebookingTotal,
                subtotal,
                vatAmount,
                total: subtotal
            }
        };

        res.json(summary);
    } catch (error) {
        console.error('Error fetching booking summary:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add this to timeSlotRoutes.js



router.post('/payment-callback', express.json(), async (req, res) => {
    try {
        // Get the QuickPay signature
        const quickpaySignature = req.get('QuickPay-Checksum-Sha256');
        
        if (!quickpaySignature) {
            console.error('No QuickPay signature found in callback');
            return res.status(200).send('No signature'); // Still return 200
        }

        // Convert the body to a string for signature verification
        const bodyString = JSON.stringify(req.body);
        
        // Calculate signature
        const calculatedSignature = crypto
            .createHmac('sha256', process.env.QUICKPAY_PRIVATE_KEY)
            .update(bodyString)
            .digest('hex');

        if (quickpaySignature !== calculatedSignature) {
            console.error('Invalid QuickPay signature');
            return res.status(200).send('Invalid signature');
        }

        const payment = req.body;
        console.log('Received payment callback:', payment);

        // Check if payment is accepted and completed
        if (payment.accepted && payment.state === 'processed') {
            const bookingNumber = payment.order_id;
            
            // Update booking with payment information
            const { error } = await supabase
                .from('bookings')
                .update({ 
                    status: 'confirmed',
                    payment_id: payment.id,
                    payment_method: payment.metadata?.type || 'unknown',
                    paid_amount: payment.operations.find(op => op.type === 'capture')?.amount || 0,
                    payment_metadata: payment,
                    payment_completed_at: new Date().toISOString()
                })
                .eq('booking_number', bookingNumber);

            if (error) {
                console.error('Error updating booking:', error);
                return res.status(200).send('Database update failed');
            }

            console.log('Payment processed and booking updated successfully');
            res.status(200).send('OK');
        } else {
            console.log('Payment not yet accepted or processed:', payment);
            res.status(200).send('Payment status noted');
        }
    } catch (error) {
        console.error('Error processing payment callback:', error);
        res.status(200).send('Error noted');
    }
});

router.get('/payment-status/:bookingNumber', async (req, res) => {
    try {
        const { bookingNumber } = req.params;

        const { data: booking, error } = await supabase
            .from('bookings')
            .select('status, payment_id, paid_amount, refunded_amount')
            .eq('booking_number', bookingNumber)
            .single();

        if (error) throw error;

        if (booking.status === 'confirmed') {
            res.json({
                status: 'completed',
                paymentDetails: {
                    amount: (booking.paid_amount - booking.refunded_amount) / 100, // Convert öre to SEK
                    refunded: booking.refunded_amount > 0,
                    refundedAmount: booking.refunded_amount / 100
                }
            });
        } else {
            res.json({ status: booking.status });
        }

    } catch (error) {
        console.error('Error checking payment status:', error);
        res.status(500).json({ error: 'Failed to check payment status' });
    }
});


// Add a new endpoint for refunds
router.post('/bookings/:bookingNumber/refund', async (req, res) => {
    try {
        const { bookingNumber } = req.params;
        const { amount, reason } = req.body; // amount in SEK

        // First get the booking details
        const { data: booking, error: bookingError } = await supabase
            .from('bookings')
            .select('payment_id, paid_amount, refunded_amount')
            .eq('booking_number', bookingNumber)
            .single();

        if (bookingError) throw bookingError;

        // Convert amount to öre for QuickPay
        const refundAmount = Math.round(amount * 100);

        // Check if refund is possible
        const remainingAmount = booking.paid_amount - booking.refunded_amount;
        if (refundAmount > remainingAmount) {
            return res.status(400).json({ 
                error: 'Refund amount exceeds remaining payment amount' 
            });
        }

        // Process refund with QuickPay
        const response = await fetch(
            `https://api.quickpay.net/payments/${booking.payment_id}/refund`,
            {
                method: 'POST',
                headers: {
                    'Accept-Version': 'v10',
                    'Authorization': `Basic ${Buffer.from(':' + process.env.QUICKPAY_API_KEY).toString('base64')}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    amount: refundAmount,
                    extras: { reason }
                })
            }
        );

        if (!response.ok) {
            throw new Error('QuickPay refund failed');
        }

        // Update booking with refund information
        const { error: updateError } = await supabase
            .from('bookings')
            .update({
                refunded_amount: booking.refunded_amount + refundAmount,
                status: refundAmount === booking.paid_amount ? 'refunded' : 'partial_refund'
            })
            .eq('booking_number', bookingNumber);

        if (updateError) throw updateError;

        res.json({ message: 'Refund processed successfully' });

    } catch (error) {
        console.error('Refund error:', error);
        res.status(500).json({ error: 'Failed to process refund' });
    }
});


export default router;