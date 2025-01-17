import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';

// Add rate limiter config
const updateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 100 
});

// First, load environment variables
dotenv.config();

console.log('DINTERO_API_BASE_URL:', process.env.DINTERO_API_BASE_URL);
console.log('DINTERO_API_BASE_URL:', process.env.DINTERO_API_BASE_URL);
console.log('DINTERO_CLIENT_ID:', process.env.DINTERO_CLIENT_ID);
console.log('DINTERO_CLIENT_SECRET:', process.env.DINTERO_CLIENT_SECRET);

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


router.post('/create-payment', async (req, res) => {
    try {
        const { amount, currency, orderId } = req.body;
        
        const response = await fetch('https://api.quickpay.net/payments', {
            method: 'POST',
            headers: {
                'Accept-Version': 'v10',
                'Authorization': `Basic ${Buffer.from(':' + process.env.QUICKPAY_API_KEY).toString('base64')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                order_id: orderId,
                currency: currency,
                variables: {
                    booking_id: orderId
                }
            })
        });

        if (!response.ok) {
            const error = await response.text();
            console.error('QuickPay payment creation error:', error);
            throw new Error('Failed to create payment');
        }

        const payment = await response.json();
        
        // Create payment link
        const linkResponse = await fetch(`https://api.quickpay.net/payments/${payment.id}/link`, {
            method: 'PUT',
            headers: {
                'Accept-Version': 'v10',
                'Authorization': `Basic ${Buffer.from(':' + process.env.QUICKPAY_API_KEY).toString('base64')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                amount: amount,
                continue_url: 'https://aventyrsupplevelser.com/tackfordinbokning',
                callback_url: process.env.QUICKPAY_CALLBACK_URL,
                cancel_url: 'https://aventyrsupplevelser.com/booking'
            })
        });

        if (!linkResponse.ok) {
            const error = await linkResponse.text();
            console.error('QuickPay link creation error:', error);
            throw new Error('Failed to create payment link');
        }

        const linkData = await linkResponse.json();
        res.json({ 
            payment_id: payment.id,
            payment_url: linkData.url 
        });

    } catch (error) {
        console.error('Payment creation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add callback endpoint to handle QuickPay notifications
router.post('/quickpay-callback', async (req, res) => {
    try {
        // Get the checksum from headers
        const receivedChecksum = req.headers['quickpay-checksum-sha256'];
        
        // Get the raw body
        const rawBody = JSON.stringify(req.body);
        
        // Calculate checksum
        const calculatedChecksum = crypto
            .createHmac('sha256', process.env.QUICKPAY_PRIVATE_KEY)
            .update(rawBody)
            .digest('hex');

        // Verify checksum
        if (receivedChecksum !== calculatedChecksum) {
            console.error('Invalid QuickPay callback checksum');
            return res.status(400).json({ error: 'Invalid checksum' });
        }

        const { id: payment_id, accepted, operations } = req.body;
        
        if (accepted && operations && operations.length > 0) {
            const latestOperation = operations[operations.length - 1];
            
            if (latestOperation.type === 'authorize' && latestOperation.qp_status_code === '20000') {
                // Payment was successful
                // Update your booking status here
                
                // Example: Update booking status in Supabase
                const { error } = await supabase.rpc('manage_booking', {
                    p_booking_id: req.body.variables.booking_id,
                    p_status: 'confirmed',
                    // Add other necessary parameters
                });

                if (error) throw error;
            }
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('Callback processing error:', error);
        res.status(500).json({ error: error.message });
    }
});


export default router;