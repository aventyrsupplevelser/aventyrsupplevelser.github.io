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
    try {
        const { time_slot_id, adult_quantity, youth_quantity, kid_quantity } = req.body;
        const totalTickets = (adult_quantity || 0) + (youth_quantity || 0) + (kid_quantity || 0);

        // First check if spots are available
        const { data: timeSlot, error: timeSlotError } = await supabase
            .from('time_slots')
            .select('available_spots')
            .eq('id', time_slot_id)
            .single();

        if (timeSlotError) throw timeSlotError;

        if (timeSlot.available_spots < totalTickets) {
            return res.status(400).json({ error: 'Not enough spots available' });
        }

        // Generate booking token
        const bookingToken = crypto.randomBytes(32).toString('hex');

        // Create pending booking and update spots in a transaction
        const { data: booking, error: bookingError } = await supabase
            .from('bookings')
            .insert({
                time_slot_id,
                adult_quantity,
                youth_quantity,
                kid_quantity,
                status: 'pending',
                access_token: bookingToken  // Add this
            })
            .select()
            .single();

        if (bookingError) throw bookingError;

        // Update available spots
        const { error: updateError } = await supabase
            .from('time_slots')
            .update({ available_spots: timeSlot.available_spots - totalTickets })
            .eq('id', time_slot_id);

        if (updateError) throw updateError;

        // Return booking data WITH the token
        res.json({
            ...booking,
            access_token: bookingToken  // Make sure to include this in response
        });

    } catch (error) {
        console.error('Error creating pending booking:', error);
        res.status(500).json({ error: error.message });
    }
});

router.put('/bookings/:id', updateLimiter, async (req, res) => {
    try {
        const { id } = req.params;
        const { full_day, access_token } = req.body;  // Changed bookingToken to access_token to match DB

        if (!access_token) {
            return res.status(401).json({ error: 'No access token provided' });
        }

        console.log('Attempting to update booking:', { id, full_day });

        const { data: booking, error } = await supabase
            .from('bookings')
            .update({ full_day })
            .eq('id', id)
            .eq('access_token', access_token)  // Verify token matches
            .eq('status', 'pending')
            .select('*');

        if (error) {
            console.log('Update error:', error);
            throw error;
        }

        if (!booking || booking.length === 0) {
            return res.status(404).json({ error: 'Booking not found, not pending, or invalid token' });
        }

        console.log('Successfully updated booking:', booking[0]);
        res.json(booking[0]);

    } catch (error) {
        console.error('Error updating booking:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;