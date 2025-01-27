// In backend/src/emailService.js
import sgMail from '@sendgrid/mail';
import dotenv from 'dotenv';

dotenv.config();

// Initialize SendGrid with API key
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

class EmailService {
    static async sendBookingConfirmation(booking) {
        try {
            // Calculate VAT (6%)
            const totalAmountInSEK = booking.paid_amount / 100; // Convert from öre to SEK
            const vatRate = 0.06;
            const amountExVat = Math.round(totalAmountInSEK / (1 + vatRate));
            const vatAmount = totalAmountInSEK - amountExVat;

            // Format payment method for display
            const paymentMethodDisplay = booking.payment_method === 'swish' ? 'Swish' : 'Kontokort';

            const msg = {
                to: booking.customer_email,
                from: process.env.SENDGRID_FROM_EMAIL,
                subject: 'Bokningsbekräftelse - Sörsjöns Äventyrspark',
                templateId: process.env.SENDGRID_BOOKING_TEMPLATE_ID,
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

            const response = await sgMail.send(msg);
            console.log('Confirmation email sent successfully:', response[0].statusCode);
            return response;
        } catch (error) {
            console.error('Error sending confirmation email:', error);
            if (error.response) {
                console.error('Error details:', error.response.body);
            }
            return null;
        }
    }

    static async sendBookingReminder(booking) {
        try {
            const msg = {
                to: booking.customer_email,
                from: process.env.SENDGRID_FROM_EMAIL,
                subject: 'Påminnelse - Din bokning imorgon hos Sörsjöns Äventyrspark',
                templateId: process.env.SENDGRID_REMINDER_TEMPLATE_ID,
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
    }
}

export default EmailService;