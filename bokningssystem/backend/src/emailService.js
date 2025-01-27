// In backend/src/emailService.js
import sgMail from '@sendgrid/mail';
import dotenv from 'dotenv';

dotenv.config();

// Initialize SendGrid with API key
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL;
const SENDGRID_BOOKING_TEMPLATE_ID = process.env.SENDGRID_BOOKING_TEMPLATE_ID;

// Verify required environment variables
if (!SENDGRID_API_KEY) {
    console.error('Missing SENDGRID_API_KEY environment variable');
    throw new Error('SendGrid API key is required');
}

if (!SENDGRID_FROM_EMAIL) {
    console.error('Missing SENDGRID_FROM_EMAIL environment variable');
    throw new Error('SendGrid sender email is required');
}

if (!SENDGRID_BOOKING_TEMPLATE_ID) {
    console.error('Missing SENDGRID_BOOKING_TEMPLATE_ID environment variable');
    throw new Error('SendGrid booking template ID is required');
}

sgMail.setApiKey(SENDGRID_API_KEY);

class EmailService {
    static async verifyEmailConfig() {
        try {
            // Test API key by making a simple API call
            const response = await sgMail.send({
                to: SENDGRID_FROM_EMAIL,
                from: SENDGRID_FROM_EMAIL,
                subject: 'API Key Verification',
                text: 'This is a test email to verify the SendGrid API key.',
            });
            console.log('SendGrid configuration verified successfully');
            return true;
        } catch (error) {
            console.error('SendGrid configuration verification failed:', error);
            if (error.response) {
                console.error('Error details:', error.response.body);
            }
            return false;
        }
    }

    static async sendBookingConfirmation(booking) {
        try {
            if (!booking.customer_email) {
                console.error('Customer email is required');
                return null;
            }

            // Calculate VAT (6%)
            const totalAmountInSEK = booking.paid_amount / 100; // Convert from öre to SEK
            const vatRate = 0.06;
            const amountExVat = Math.round(totalAmountInSEK / (1 + vatRate));
            const vatAmount = totalAmountInSEK - amountExVat;

            // Format payment method for display
            const paymentMethodDisplay = booking.payment_method === 'swish' ? 'Swish' : 'Kontokort';

            const msg = {
                to: booking.customer_email,
                from: {
                    email: SENDGRID_FROM_EMAIL,
                    name: 'Sörsjöns Äventyrspark'
                },
                subject: 'Bokningsbekräftelse - Sörsjöns Äventyrspark',
                templateId: SENDGRID_BOOKING_TEMPLATE_ID,
                dynamic_template_data: {
                    booking_number: booking.booking_number,
                    customer_name: booking.customer_name,
                    booking_date: new Date(booking.start_time).toLocaleDateString('sv-SE'),
                    booking_time: new Date(booking.start_time).toLocaleTimeString('sv-SE', { 
                        hour: '2-digit', 
                        minute: '2-digit',
                        hour12: false 
                    }),
                    adult_quantity: booking.adult_quantity,
                    youth_quantity: booking.youth_quantity,
                    kid_quantity: booking.kid_quantity,
                    full_day: booking.full_day ? 'Ja' : 'Nej',
                    is_rebookable: booking.is_rebookable ? 'Ja' : 'Nej',
                    amount_ex_vat: amountExVat,
                    vat_amount: vatAmount.toFixed(2),
                    total_amount: totalAmountInSEK.toFixed(2),
                    payment_date: new Date(booking.payment_completed_at).toLocaleDateString('sv-SE'),
                    payment_method: paymentMethodDisplay,
                    special_instructions: booking.comments || ''
                }
            };

            console.log('Attempting to send confirmation email to:', booking.customer_email);
            const response = await sgMail.send(msg);
            console.log('Confirmation email sent successfully:', response[0].statusCode);
            return response;
        } catch (error) {
            console.error('Error sending confirmation email:', error);
            if (error.response) {
                console.error('Error details:', error.response.body);
            }
            // Log additional debugging information
            console.error('API Key length:', SENDGRID_API_KEY?.length);
            console.error('From email:', SENDGRID_FROM_EMAIL);
            console.error('Template ID:', SENDGRID_BOOKING_TEMPLATE_ID);
            return null;
        }
    }

    /*static async sendBookingReminder(booking) {
        try {
            if (!booking.customer_email) {
                console.error('Customer email is required');
                return null;
            }

            const msg = {
                to: booking.customer_email,
                from: {
                    email: SENDGRID_FROM_EMAIL,
                    name: 'Sörsjöns Äventyrspark'
                },
                subject: 'Påminnelse - Din bokning imorgon hos Sörsjöns Äventyrspark',
                templateId: SENDGRID_REMINDER_TEMPLATE_ID,
                dynamic_template_data: {
                    booking_number: booking.booking_number,
                    customer_name: booking.customer_name,
                    booking_date: new Date(booking.start_time).toLocaleDateString('sv-SE'),
                    booking_time: new Date(booking.start_time).toLocaleTimeString('sv-SE', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false
                    })
                }
            };

            console.log('Attempting to send reminder email to:', booking.customer_email);
            const response = await sgMail.send(msg);
            console.log('Reminder email sent successfully:', response[0].statusCode);
            return response;
        } catch (error) {
            console.error('Error sending reminder email:', error);
            if (error.response) {
                console.error('Error details:', error.response.body);
            }
            return null;
        }
    }*/
}

export default EmailService;