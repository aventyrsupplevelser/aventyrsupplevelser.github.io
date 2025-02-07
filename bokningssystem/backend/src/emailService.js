// In backend/src/emailService.js
import sgMail from '@sendgrid/mail';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Initialize SendGrid with API key
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL;
const SENDGRID_BOOKING_TEMPLATE_ID = process.env.SENDGRID_BOOKING_TEMPLATE_ID;
const SENDGRID_PRESENKORT_ID = process.env.SENDGRID_PRESENKORT_ID;


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

if (!SENDGRID_PRESENKORT_ID) {
    console.error('Missing SENDGRID_PRESENKORT_ID environment variable');
    throw new Error('SENDGRID_PRESENKORT_ID is required');
}

sgMail.setApiKey(SENDGRID_API_KEY);

class EmailService {
    static async verifyEmailConfig() {
        try {
            // Test API key by making a simple API call
            const response = await sgMail.send({
                to: SENDGRID_FROM_EMAIL,
                from: {
                    email: process.env.SENDGRID_FROM_EMAIL,
                    name: 'Sörsjöns Äventyrspark'
                },
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
            // Calculate VAT (6%)
            const totalAmountInSEK = booking.paid_amount / 100; // Convert from öre to SEK
            const vatRate = 0.06;
            const amountExVat = Math.round(totalAmountInSEK / (1 + vatRate));
            const vatAmount = totalAmountInSEK - amountExVat;
    
            // Calculate individual sums
            const adultSum = booking.adult_quantity * 400;
            const youthSum = booking.youth_quantity * 300;
            const kidSum = booking.kid_quantity * 200;
            const fullDaySum = booking.full_day * 100;  // full_day is now a number
            const rebookingSum = booking.is_rebookable ? 
                (booking.adult_quantity + booking.youth_quantity + booking.kid_quantity) * 25 : 0;
            
    
            const paymentMethodDisplay = booking.payment_method === 'swish' ? 'Swish' : 'Kontokort';

            // Get gift card info if used
        let giftCardAmount = 0;
        if (booking.gift_card_number) {
            const { data: giftCard } = await supabase
                .from('gift_cards')
                .select('amount')
                .eq('gift_card_number', booking.gift_card_number)
                .single();
            
            if (giftCard) {
                giftCardAmount = giftCard.amount;
            }
        }

        // Get promo code info if used
        let promoDiscount = 0;
        if (booking.promo_code) {
            const { data: promo } = await supabase
                .from('promo_codes')
                .select('*')
                .eq('promo_code', booking.promo_code)
                .single();
            
            if (promo) {
                const subtotal = adultSum + youthSum + kidSum + fullDaySum + rebookingSum - giftCardAmount;
                if (promo.is_percentage) {
                    promoDiscount = Math.round(subtotal * (promo.discount_value / 100));
                } else {
                    promoDiscount = promo.discount_value;
                }
            }
        }

        console.log('promoDiscount:', promoDiscount);

            // Build rebooking URL with access token
        const rebookingUrl = booking.is_rebookable ? 
        `https://aventyrsupplevelser.com/bokningssystem/frontend/bokaomtid.html?booking_id=${booking.id}&token=${booking.access_token}` : 
        null;
    
            const msg = {
                to: booking.customer_email,
                from: {
                    email: process.env.SENDGRID_FROM_EMAIL,
                    name: 'Sörsjöns Äventyrspark'
                },
                templateId: process.env.SENDGRID_BOOKING_TEMPLATE_ID,
                dynamic_template_data: {
                    booking_number: booking.booking_number,
                    customer_name: booking.customer_name,
                    booking_date: new Date(booking.start_time).toLocaleDateString('sv-SE', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric'
                    }),
                    booking_time: new Date(booking.start_time).toLocaleTimeString('sv-SE', { 
                        hour: '2-digit', 
                        minute: '2-digit',
                        hour12: false 
                    }),
                    adult_quantity: booking.adult_quantity,
                    youth_quantity: booking.youth_quantity,
                    kid_quantity: booking.kid_quantity,
                    adult_sum: adultSum,     
                    youth_sum: youthSum,     
                    kid_sum: kidSum,         
                    full_day: booking.full_day,
                    full_day_sum: fullDaySum,
                    is_rebookable: booking.is_rebookable,
                    rebooking_sum: rebookingSum,
                    ombokningsurl: rebookingUrl,
                    gift_card_amount: giftCardAmount || null,  // Only include if used
                    promo_discount: promoDiscount || null,     // Only include if used
                    amount_ex_vat: amountExVat,
                    vat_amount: vatAmount.toFixed(2),
                    total_amount: totalAmountInSEK.toFixed(2),
                    payment_date: new Date(booking.payment_completed_at).toLocaleDateString('sv-SE'),
                    payment_method: paymentMethodDisplay,
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


    static async ombokningConfirmation(booking) {
        try {
            const msg = {
                to: booking.customer_email,
                from: {
                    email: process.env.SENDGRID_FROM_EMAIL,
                    name: 'Sörsjöns Äventyrspark'
                },
                templateId: process.env.SENDGRID_OMBOKNING_ID,
                dynamic_template_data: {
                    booking_number: booking.booking_number,
                    customer_name: booking.customer_name,
                    booking_date: new Date(booking.start_time).toLocaleDateString('sv-SE', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric'
                    }),
                    booking_time: new Date(booking.start_time).toLocaleTimeString('sv-SE', { 
                        hour: '2-digit', 
                        minute: '2-digit',
                        hour12: false 
                    }),
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

    static async sendGiftCardConfirmation(initialData) {
        try {
            console.log('Fetching gift card with number:', initialData.giftCardNumber);
            
            // First fetch complete gift card data from Supabase
            const { data: giftCard, error } = await supabase
                .from('gift_cards')
                .select('*')
                .eq('gift_card_number', initialData.giftCardNumber)
                .single();

            if (error) {
                throw new Error(`Failed to fetch gift card data: ${error.message}`);
            }

            if (!giftCard) {
                throw new Error('Gift card not found');
            }

            console.log('Found gift card:', giftCard);

            // Calculate amount in SEK
            const totalAmountInSEK = giftCard.paid_amount / 100; // Convert from öre to SEK
            const vatRate = 0.06;
            const amountExVat = Math.round(totalAmountInSEK / (1 + vatRate));
            const vatAmount = totalAmountInSEK - amountExVat;
            const amountSEK = Math.round(totalAmountInSEK);

            // Generate URL for gift card generation
            const giftCardUrl = new URL('http://aventyrsupplevelser.com/bokningssystem/frontend/generategiftcard.html');
            giftCardUrl.searchParams.set('gift_to', giftCard.gift_to);
            giftCardUrl.searchParams.set('gift_from', giftCard.gift_from);
            giftCardUrl.searchParams.set('gift_card_number', giftCard.gift_card_number);
            giftCardUrl.searchParams.set('valid_until', giftCard.valid_until);
            giftCardUrl.searchParams.set('amount', amountSEK);

            const msg = {
                to: giftCard.purchaser_email,
                from: {
                    email: process.env.SENDGRID_FROM_EMAIL,
                    name: 'Sörsjöns Äventyrspark'
                },
                templateId: process.env.SENDGRID_PRESENKORT_ID,
                dynamic_template_data: {
                    gift_card_number: giftCard.gift_card_number,
                    purchaser_email: giftCard.purchaser_email,
                    gift_to: giftCard.gift_to,
                    gift_from: giftCard.gift_from,
                    gift_card_url: giftCardUrl.toString(),
                    amountSEK: amountSEK,
                    amount: totalAmountInSEK.toFixed(2),
                    amount_ex_vat: amountExVat.toFixed(2),
                    vat_amount: vatAmount.toFixed(2),
                    payment_date: new Date(giftCard.payment_completed_at).toLocaleDateString('sv-SE'),
                    valid_until: new Date(giftCard.valid_until).toLocaleDateString('sv-SE')
                }
            };

            const response = await sgMail.send(msg);
            console.log('Gift card confirmation email sent successfully:', response[0].statusCode);
            return response;
        } catch (error) {
            console.error('Error sending gift card confirmation email:', error);
            if (error.response) {
                console.error('Error details:', error.response.body);
            }
            throw error; // Re-throw to handle in calling code
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