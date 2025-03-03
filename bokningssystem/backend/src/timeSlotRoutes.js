import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import EmailService from './emailService.js';

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
    limit: '50mb'  // Increase limit if needed
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

// Request logging middleware
router.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
    next();
});

// Add this near the top of timeSlotRoutes.js, before your routes
const timeLogger = (req, res, next) => {
    req.startTime = Date.now();
    
    // Capture the original res.end
    const oldEnd = res.end;
    
    // Override res.end to include timing
    res.end = function(...args) {
        const duration = Date.now() - req.startTime;
        console.log(`${req.method} ${req.originalUrl} took ${duration}ms`);
        oldEnd.apply(res, args);
    };
    
    next();
};

const paymentTimingMiddleware = (req, res, next) => {
    req.paymentTiming = {
        start: Date.now(),
        checkpoints: []
    };

    // Add checkpoint logging function to the request object
    req.logCheckpoint = (checkpoint) => {
        req.paymentTiming.checkpoints.push({
            name: checkpoint,
            timestamp: Date.now(),
            timeSinceStart: Date.now() - req.paymentTiming.start
        });
    };

    // Capture timing information on response
    const originalEnd = res.end;
    res.end = function(...args) {
        const totalTime = Date.now() - req.paymentTiming.start;
        console.log(`Payment Process Timing - ${req.originalUrl}:`);
        console.log(`Total time: ${totalTime}ms`);
        req.paymentTiming.checkpoints.forEach(cp => {
            console.log(`${cp.name}: ${cp.timeSinceStart}ms`);
        });
        originalEnd.apply(res, args);
    };

    next();
};

router.use(timeLogger);

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

let backendSession = null;

async function ensureBackendAuth() {
    if (!backendSession) {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: process.env.ADMIN_EMAIL,
            password: process.env.ADMIN_PASSWORD
        });
        
        if (error) throw error;
        backendSession = data.session;
    }
    return backendSession;
}

// Create single time slot
router.post('/time-slots', async (req, res) => {
    try {
        const { start_time, end_time, total_spots, allow_full_day } = req.body;
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
        res.status(500).json({ error: error.message });
    }
});

// Create multiple time slots
router.post('/time-slots/bulk', async (req, res) => {
    try {
        await ensureBackendAuth();

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
        await ensureBackendAuth();

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
        await ensureBackendAuth();


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



router.post('/bookings/pending', async (req, res) => {
    const { time_slot_id, adult_quantity, youth_quantity, kid_quantity, full_day, is_rebookable } = req.body;

    try {
        // Generate token in the backend
        const accessToken = crypto.randomBytes(32).toString('hex');

        // Call the stored procedure and pass the token
        const { data, error } = await supabase.rpc('create_booking', {
            p_time_slot_id: time_slot_id,
            p_adult_quantity: adult_quantity,
            p_youth_quantity: youth_quantity,
            p_kid_quantity: kid_quantity,
            p_access_token: accessToken, 
            p_full_day: full_day,           
            p_is_rebookable: is_rebookable
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
        is_rebookable, 
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
            p_is_rebookable: is_rebookable,
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


// Modified update route
router.put('/bookings/:id/details', async (req, res) => {
    try {
        const { id } = req.params;
        const { customerName, customerEmail, customerPhone, comments, bookingNumber } = req.body;

        const { error } = await supabase
            .from('bookings')
            .update({
                customer_name: customerName,
                customer_email: customerEmail,
                customer_phone: customerPhone,
                comments,
                booking_number: bookingNumber
            })
            .eq('id', id);

        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating booking:', error);
        res.status(500).json({ error: error.message });
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


router.post('/get-payment-form', paymentTimingMiddleware, async (req, res) => {
    try {
        req.logCheckpoint('Starting payment form generation');
        
        const { order_id } = req.body;

        if (!order_id) {
            req.logCheckpoint('Missing order_id');
            return res.status(400).json({ error: 'order_id is required.' });
        }

        const { data: data, error } = await supabase.rpc('calculate_booking_amount', { 
            p_access_token: accessToken
        });
      if (error) throw error;

      const amount = data;

        const merchant_id = process.env.QUICKPAY_MERCHANT_ID;
        const agreement_id = process.env.QUICKPAY_AGREEMENT_ID;
        const apiKey = process.env.QUICKPAY_PAYMENT_WINDOW_KEY;

        if (!merchant_id || !agreement_id || !apiKey) {
            req.logCheckpoint('Missing QuickPay configuration');
            throw new Error('Missing required QuickPay configuration');
        }

        req.logCheckpoint('Validated configuration');

        const railwayUrl = 'https://aventyrsupplevelsergithubio-testing.up.railway.app';

        payment_methods = 'visa, visa-electron, mastercard, mastercard-debet';

        const params = {
            version: 'v10',
            merchant_id,
            agreement_id,
            amount,
            currency: 'SEK',
            order_id,
            continueurl: `https://aventyrsupplevelser.com/bokningssystem/frontend/tackfordinbokning.html?order_id=${order_id}`,
            cancelurl: `${railwayUrl}/payment-cancelled.html`,
            callbackurl: `https://aventyrsupplevelsergithubio-testing.up.railway.app/api/payment-callback`,
            language: 'sv',
            autocapture: '1',
            payment_methods,
            /*branding_id: '14851' */
        };

        params.checksum = calculateChecksum(params, apiKey);

        const formHtml = `
            <form method="POST" action="https://payment.quickpay.net/framed">
                ${Object.entries(params)
                    .map(([key, value]) => 
                        value ? `<input type="hidden" name="${key}" value="${value}">` : '')
                    .join('\n')}
            </form>
        `;

        if (!formHtml) {
            req.logCheckpoint('Failed to generate form HTML');
            throw new Error('Failed to generate payment form');
        }

        req.logCheckpoint('Successfully generated payment form');
        res.send(formHtml);

    } catch (error) {
        req.logCheckpoint('Error generating payment form');
        console.error('Error generating payment form:', error);
        res.status(500).json({ 
            error: 'Failed to generate payment form',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

router.post('/generate-booking-number', async (req, res) => {
    try {
        // Using Postgres sequence (much faster than the while loop)
        const { data, error } = await supabase
            .rpc('generate_booking_number');
        
        if (error) throw error;
        
        res.json({ bookingNumber: data });
    } catch (error) {
        console.error('Error generating booking number:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/payment-callback', 
    rawBodyParser,           
    paymentTimingMiddleware, 
    async (req, res) => {
        console.log('----------------------------------------');
        console.log('Payment callback received');
        
        try {
            // Get QuickPay signature
            const quickpaySignature = req.get('QuickPay-Checksum-Sha256');
            if (!quickpaySignature) {
                console.error('Missing QuickPay signature');
                return res.status(400).send('Missing signature');
            }

            // Log raw body details
            console.log('Raw body type:', typeof req.body);
            console.log('Is Buffer?', Buffer.isBuffer(req.body));
            
            // Make sure we have a buffer
            const bodyBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));

            // Verify the signature with raw body
            const calculatedSignature = crypto
                .createHmac('sha256', process.env.QUICKPAY_PRIVATE_KEY)
                .update(bodyBuffer)
                .digest('hex');

            if (quickpaySignature !== calculatedSignature) {
                console.error('Invalid signature');
                console.log('Received:', quickpaySignature);
                console.log('Calculated:', calculatedSignature);
                return res.status(400).send('Invalid signature');
            }

            // Parse the raw body
            const payment = JSON.parse(bodyBuffer.toString('utf8'));
            
            console.log('Payment data:', {
                order_id: payment.order_id,
                state: payment.state,
                accepted: payment.accepted
            });

            // Send success response immediately
            res.status(200).send('OK');

            // Process payment asynchronously
            await processPaymentCallback(payment);

        } catch (error) {
            console.error('Error processing callback:', error);
            // Still return 200 to prevent retries
            res.status(200).send('OK');
        }
    }
);

async function processPaymentCallback(payment) {
    console.log('Processing payment callback for order:', payment.order_id);

    try {
        if (payment.accepted && payment.state === 'processed') {
            console.log('Payment was accepted and processed');
            
            // First check current booking status
            const { data: currentBooking, error: checkError } = await supabase
                .from('bookings')
                .select('status')
                .eq('booking_number', payment.order_id)
                .single();

            if (checkError) {
                console.error('Error checking current booking:', checkError);
                return;
            }

            console.log('Current booking status:', currentBooking.status);

            // Update booking status
            const { data: updatedBooking, error: updateError } = await supabase
                .from('bookings')
                .update({
                    status: 'confirmed',
                    payment_id: payment.id,
                    payment_method: payment.metadata?.type || 'unknown',
                    paid_amount: payment.operations.find(op => op.type === 'capture')?.amount || 0,
                    payment_metadata: payment,
                    payment_completed_at: new Date().toISOString()
                })
                .eq('booking_number', payment.order_id)
                .select('*, time_slots(*)')
                .single();

            if (updateError) {
                console.error('Error updating booking:', updateError);
                return;
            }

            console.log('Successfully updated booking status to confirmed');

            // Send confirmation email
            if (updatedBooking) {
                try {
                    await EmailService.sendBookingConfirmation({
                        ...updatedBooking,
                        start_time: updatedBooking.time_slots.start_time
                    });
                    console.log('Confirmation email sent successfully');
                } catch (emailError) {
                    console.error('Error sending confirmation email:', emailError);
                }
            }
        } else {
            console.log('Payment not accepted or not processed:', payment.state);
        }

    } catch (error) {
        console.error('Error in payment callback:', error);
    }
}

router.get('/payment-status/:bookingNumber', paymentTimingMiddleware, async (req, res) => {
    try {
        const { bookingNumber } = req.params;
        console.log('Checking payment status for booking:', bookingNumber);

        const { data: booking, error } = await supabase
            .from('bookings')
            .select('status, payment_id, paid_amount, refunded_amount')
            .eq('booking_number', bookingNumber)
            .single();

        if (error) {
            console.error('Error fetching booking status:', error);
            throw error;
        }

        console.log('Retrieved booking status:', booking);

        if (booking.status === 'confirmed') {
            console.log('Payment confirmed for booking:', bookingNumber);
            res.json({
                status: 'completed',
                paymentDetails: {
                    amount: (booking.paid_amount - booking.refunded_amount) / 100,
                    refunded: booking.refunded_amount > 0,
                    refundedAmount: booking.refunded_amount / 100
                }
            });
        } else {
            console.log('Payment pending for booking:', bookingNumber, 'Status:', booking.status);
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

// Get all bookings
router.get('/bookings', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('bookings')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('Error fetching bookings:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single time slot
router.get('/time-slots/:id', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('time_slots')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('Error fetching time slot:', error);
        res.status(500).json({ error: error.message });
    }
});

router.put('/bookings/:id/rebook', updateLimiter, async (req, res) => {
    const { id } = req.params;
    const {
      access_token,
      time_slot_id
    } = req.body;
  
    if (!access_token) {
      return res.status(401).json({ error: 'No access token provided' });
    }
  
    try {
      // 1) Fetch the existing booking to validate
      const { data: currentBooking, error: fetchError } = await supabase
        .from('bookings')
        .select('*, time_slots(*)')
        .eq('id', id)
        .eq('access_token', access_token)
        .single();
  
      if (fetchError || !currentBooking) {
        return res.status(401).json({ error: 'Invalid access token or booking not found' });
      }
  
      // 2) Check rebookable
      if (!currentBooking.is_rebookable) {
        return res.status(403).json({ error: 'Denna bokning har inte ombokningsgaranti' });
      }
  
      // 3) Check 24h rule
      const bookingTime = new Date(currentBooking.time_slots.start_time);
      const now = new Date();
      const hoursUntilBooking = (bookingTime - now) / (1000 * 60 * 60);
      if (hoursUntilBooking < 24) {
        return res.status(400).json({
          error: 'Ombokningar måste göras senast 24 timmar innan bokad tid'
        });
      }
  
      // 4) Call manage_booking
      // IMPORTANT: The function in your snippet references p_new_adult_quantity,
      // p_new_youth_quantity, etc. So we pass them exactly that way:
      const { data, error } = await supabase.rpc('manage_booking', {
        p_booking_id: id,
        p_new_time_slot_id: time_slot_id,          // the new slot
        p_new_adult_quantity: currentBooking.adult_quantity,
        p_new_youth_quantity: currentBooking.youth_quantity,
        p_new_kid_quantity: currentBooking.kid_quantity,
        p_full_day: currentBooking.full_day,
        p_is_rebookable: currentBooking.is_rebookable,
        p_customer_email: currentBooking.customer_email,
        p_customer_name: currentBooking.customer_name,
        p_customer_phone: currentBooking.customer_phone,
        p_comments: currentBooking.comments,
        p_status: currentBooking.status,           // keep same status
        p_delete: false                            // not deleting
      });
  
      if (error) {
        console.error('Error rebooking:', error.message);
        return res.status(400).json({ error: error.message });
      }
  
      // 5) Optionally send a "rebooking" confirmation email
      try {
        const { data: newSlot, error: slotErr } = await supabase
          .from('time_slots')
          .select('start_time')
          .eq('id', time_slot_id)
          .single();
  
        // We'll try to send the new start_time
        if (!slotErr && newSlot) {
          await EmailService.ombokningConfirmation({
            ...currentBooking,
            start_time: newSlot.start_time
          });
        }
      } catch (emailError) {
        console.error('Error sending rebooking confirmation email:', emailError);
        // Don’t fail the entire request if email fails
      }
  
      res.json({ message: 'Booking rescheduled successfully' });
  
    } catch (error) {
      console.error('Unexpected error during rebooking:', error.message);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

router.get('/bookings/:id/rebook', async (req, res) => {
    try {
        const { id } = req.params;
        const access_token = req.query.token;

        if (!access_token) {
            return res.status(401).json({ error: 'No access token provided' });
        }

        // Get booking with access token validation
        const { data: booking, error: fetchError } = await supabase
            .from('bookings')
            .select('*, time_slots(*)')
            .eq('id', id)
            .eq('access_token', access_token)
            .single();

        if (fetchError || !booking) {
            return res.status(401).json({ error: 'Invalid access token or booking not found' });
        }

        // Check if booking has rebooking permission
        if (!booking.is_rebookable) {
            return res.status(403).json({ 
                error: 'Denna bokning har inte ombokningsgaranti' 
            });
        }

        // Check if booking is within 24 hours
        const bookingTime = new Date(booking.time_slots.start_time);
        const now = new Date();
        const hoursUntilBooking = (bookingTime - now) / (1000 * 60 * 60);

        if (hoursUntilBooking < 24) {
            return res.status(400).json({ 
                error: 'Ombokningar måste göras senast 24 timmar innan bokad tid' 
            });
        }

        res.json(booking);

    } catch (error) {
        console.error('Error fetching booking for rebooking:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

router.post('/giftcards/payment-form', async (req, res) => {
    try {
        const { 
            gift_to, 
            gift_from, 
            purchaser_email, 
            sum_in_sek, 
            paymentMethod 
        } = req.body;

        // Validate required fields
        if (!purchaser_email || !sum_in_sek) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const amount = Math.round(sum_in_sek * 100);

        // Generate gift card number
        const { data: giftCardNumber, error: numberError } = await supabase
            .rpc('generate_gift_card_number');

        if (numberError) {
            console.error('Error generating number:', numberError);
            return res.status(400).json({ error: numberError.message });
        }

        const merchant_id = process.env.QUICKPAY_MERCHANT_ID;
        const agreement_id = process.env.QUICKPAY_AGREEMENT_ID;
        const apiKey = process.env.QUICKPAY_PAYMENT_WINDOW_KEY;

        // Build the params object including variables
        const params = {
            version: 'v10',
            merchant_id,
            agreement_id,
            amount,
            currency: 'SEK',
            order_id: giftCardNumber,
            continueurl: 'https://aventyrsupplevelser.com/tackfordittkop',
            cancelurl: 'https://aventyrsupplevelser.com/cancelled.html',
            callbackurl: 'https://aventyrsupplevelsergithubio-testing.up.railway.app/api/giftcards/payment-callback',
            language: 'sv',
            autocapture: '1',
            payment_methods: paymentMethod === 'swish' ? 'swish' : 'visa,mastercard',
            branding_id: '14851',
            variables: {
                gift_to: gift_to || '',
                gift_from: gift_from || '',
                purchaser_email: purchaser_email || ''
            }
        };

        // Calculate checksum with all params including variables
        params.checksum = calculateChecksum(params, apiKey);

        // Generate form HTML
        const formHtml = `
            <form method="POST" action="https://payment.quickpay.net/framed">
                ${Object.entries(params)
                    .map(([key, value]) => {
                        if (key === 'variables') {
                            // Handle variables object specially
                            return Object.entries(value)
                                .map(([vKey, vVal]) => 
                                    `<input type="hidden" name="variables[${vKey}]" value="${vVal}">`)
                                .join('\n');
                        }
                        return value ? `<input type="hidden" name="${key}" value="${value}">` : '';
                    })
                    .join('\n')}
            </form>
        `;

        res.send(formHtml);

    } catch (err) {
        console.error('Error generating gift card payment form:', err);
        res.status(500).json({ error: 'Failed to generate payment form' });
    }
});

// Payment callback handler
router.post('/giftcards/payment-callback', rawBodyParser, async (req, res) => {
    console.log('Gift card payment callback received');
    
    try {
        // Verify QuickPay signature
        const quickpaySignature = req.get('QuickPay-Checksum-Sha256');
        if (!quickpaySignature) {
            console.error('Missing QuickPay signature');
            return res.status(400).send('Missing signature');
        }

        const bodyBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
        
        const calculatedSignature = crypto
            .createHmac('sha256', process.env.QUICKPAY_PRIVATE_KEY)
            .update(bodyBuffer)
            .digest('hex');

        if (quickpaySignature !== calculatedSignature) {
            console.error('Invalid signature', {
                received: quickpaySignature,
                calculated: calculatedSignature
            });
            return res.status(400).send('Invalid signature');
        }

        // Parse payment data
        const payment = JSON.parse(bodyBuffer.toString('utf8'));
        console.log('Payment data:', {
            order_id: payment.order_id,
            state: payment.state,
            accepted: payment.accepted
        });

        // Send immediate response
        res.status(200).send('OK');

        // Process the rest asynchronously
        await processGiftCardPayment(payment);

    } catch (error) {
        console.error('Error in gift card payment callback:', error);
        res.status(200).send('OK');
    }
});

async function processGiftCardPayment(payment) {
    console.log('Processing gift card payment:', payment.order_id); 
    try {
        if (!payment.accepted || payment.state !== 'processed') {
            console.log('Payment not accepted or not processed:', payment.state);
            return;
        }

        const variables = payment.variables || {};
        const amount = payment.operations.find(op => op.type === 'capture')?.amount || 0;

        // Create new gift card in Supabase
        const { data: giftCard, error: insertError } = await supabase
            .from('gift_cards')
            .insert({
                gift_card_number: payment.order_id,
                sum_in_sek: amount / 100,
                gift_to: variables.gift_to || null,
                gift_from: variables.gift_from || null,
                purchaser_email: variables.purchaser_email || null,
                payment_id: payment.id,
                payment_method: payment.metadata?.type || 'unknown',
                payment_completed_at: new Date().toISOString(),
                valid_until: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
            })
            .select()
            .single();

        if (insertError) {
            throw new Error(`Failed to create gift card: ${insertError.message}`);
        }

        // Send confirmation email
        try {
            await EmailService.sendGiftConfirmation({
                gift_to: variables.gift_to,
                gift_from: variables.gift_from,
                purchaser_email: variables.purchaser_email,
                gift_card_number: payment.order_id,
                sum_in_sek: amount / 100
            });
            console.log('Gift card confirmation email sent successfully');
        } catch (emailError) {
            console.error('Failed to send gift card confirmation email:', emailError);
        }

    } catch (error) {
        console.error('Error processing gift card payment:', error);
    }
}

router.get('/giftcards/payment-status/:giftCardNumber', paymentTimingMiddleware, async (req, res) => {
    try {
        const { giftCardNumber } = req.params;
        console.log('Checking gift card payment status for:', giftCardNumber);

        const { data: giftCard, error } = await supabase
            .from('gift_cards')
            .select('payment_id, sum_in_sek')
            .eq('gift_card_number', giftCardNumber)
            .single();

        if (error) {
            console.error('Error fetching gift card status:', error);
            throw error;
        }

        console.log('Retrieved gift card:', giftCard);

        if (giftCard.payment_id) {
            console.log('Payment confirmed for gift card:', giftCardNumber);
            res.json({
                paymentDetails: {
                    amount: giftCard.sum_in_sek,
                    giftCardNumber: giftCardNumber
                }
            });
        } else {
            console.log('Payment pending for gift card:', giftCardNumber);
            res.json({ status: 'pending' });  // Changed to return explicit 'pending' status
        }

    } catch (error) {
        console.error('Error checking gift card payment status:', error);
        res.status(500).json({ error: 'Failed to check payment status' });
    }
});

export default router;