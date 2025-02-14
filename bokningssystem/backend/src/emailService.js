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
const SENDGRID_ADMIN_BOOKING_ID = process.env.SENDGRID_ADMIN_BOOKING_ID;


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

                    console.log(booking)
                    // Calculate individual sums
                    const adultSum = booking.adult_quantity * 400;
                    const youthSum = booking.youth_quantity * 300;
                    const kidSum = booking.kid_quantity * 200;
                    const fullDaySum = booking.full_day * 100;
                    
                    // Calculate base total (without rebooking)
                    const baseTotal = adultSum + youthSum + kidSum + fullDaySum;
                    
                    // Calculate rebooking fee separately
                    const rebookingSum = booking.is_rebookable ? 
                        (booking.adult_quantity + booking.youth_quantity + booking.kid_quantity) * 25 : 0;
            
                    const totalAmountInSEK = booking.paid_amount / 100; // Convert from öre to SEK
                    
                    // Calculate VAT (6%) only on the taxable amount (excluding rebooking fee)
                    const vatRate = 0.06;
                    const taxableAmount = totalAmountInSEK - rebookingSum; // Remove rebooking fee before VAT calc
                    const vatAmount = (taxableAmount * vatRate) / (1 + vatRate);
                    const amountExVat = taxableAmount - vatAmount;


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
                const subtotal = adultSum + youthSum + kidSum + fullDaySum - giftCardAmount;
                if (promo.is_percentage) {
                    promoDiscount = Math.max(subtotal * (promo.discount_value / 100), 0);
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
                    amount_ex_vat: amountExVat.toFixed(2),
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

    static async sendAdminConfirmation(booking) {
        try {

            console.log('emailbooking', booking);
            console.log(booking.quickpay_link);

            // Calculate individual sums
            const adultSum = booking.adult_quantity * 400;
            const youthSum = booking.youth_quantity * 300;
            const kidSum = booking.kid_quantity * 200;
            const fullDaySum = booking.full_day * 100;
            
            // Calculate base total (without rebooking)
            const baseTotal = adultSum + youthSum + kidSum + fullDaySum;
            
            // Calculate rebooking fee separately
            const rebookingSum = booking.is_rebookable ? 
                (booking.adult_quantity + booking.youth_quantity + booking.kid_quantity) * 25 : 0;


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

    if (giftCardAmount > baseTotal) {
        giftCardAmount = baseTotal;
        console.log('equalized gift card to base Total')
    }

}

let subtotal = baseTotal

// Get promo code info if used
let promoDiscount = 0;
if (booking.promo_code) {
    const { data: promo } = await supabase
        .from('promo_codes')
        .select('*')
        .eq('promo_code', booking.promo_code)
        .single();
    
    if (promo ) {
        subtotal = baseTotal - giftCardAmount;
        if (promo.is_percentage) {
            promoDiscount = subtotal * (promo.discount_value / 100);
        } else {
            promoDiscount = promo.discount_value;
        } 
    }
}

if (promoDiscount > subtotal) {
    promoDiscount = subtotal;
}
            let totalAmountInSEK = subtotal - promoDiscount + rebookingSum; // Convert from öre to SEK

            if (totalAmountInSEK < 0) {
                totalAmountInSEK = 0; 
            }

            // Calculate VAT (6%) only on the taxable amount (excluding rebooking fee)
            const vatRate = 0.06;
            const taxableAmount = Math.max(totalAmountInSEK - rebookingSum, 0);
            const vatAmount = (taxableAmount * vatRate) / (1 + vatRate);
            const amountExVat = taxableAmount - vatAmount;


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
    // Choose template based on whether there's a payment link
    templateId: booking.quickpay_link ? 
        process.env.SENDGRID_ADMIN_BOOKING_ID : 
        process.env.SENDGRID_ADMIN_FREE_BOOKING_ID,
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
        gift_card_amount: giftCardAmount || null,
        promo_discount: promoDiscount || null,
        amount_ex_vat: amountExVat.toFixed(2),
        vat_amount: vatAmount.toFixed(2),
        total_amount: totalAmountInSEK.toFixed(2),
        payment_date: new Date(booking.payment_completed_at).toLocaleDateString('sv-SE'),
        // Only include payment link if it exists
        ...(booking.quickpay_link && { payment_link: booking.quickpay_link })
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

static async sendAddOnEmail(booking) {
    try {
        console.log('Sending add-on email for booking:nolog', );

        // Calculate sums for added spots only
        const adultSum = booking.adult_added * 400;
        const youthSum = booking.youth_added * 300;
        const kidSum = booking.kid_added * 200;
        const fullDaySum = booking.full_day_added * 100;

        const baseTotal = adultSum + youthSum + kidSum + fullDaySum;

        const rebookingSum = booking.is_rebookable ? 
                (adultSum + youthSum + kidSum) * 25 : 0;


        // Calculate total (no gift cards or promos for add-ons)
        const totalAmount = baseTotal + rebookingSum;

        // Calculate VAT (6%) on the total amount
        const vatRate = 0.06;
        const vatAmount = (baseTotal * vatRate) / (1 + vatRate);
        const amountExVat = totalAmount - vatAmount;

        const msg = {
            to: booking.customer_email,
            from: {
                email: process.env.SENDGRID_FROM_EMAIL,
                name: 'Sörsjöns Äventyrspark'
            },
            templateId: process.env.SENDGRID_ADD_ON_ID,
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
                // Only include quantities that were added
                ...(booking.adult_added && { adult_quantity: booking.adult_added, adult_sum: adultSum }),
                ...(booking.youth_added && { youth_quantity: booking.youth_added, youth_sum: youthSum }),
                ...(booking.kid_added && { kid_quantity: booking.kid_added, kid_sum: kidSum }),
                ...(booking.full_day_added && { full_day: booking.full_day_added, full_day_sum: fullDaySum }),
                // VAT and total
                amount_ex_vat: amountExVat.toFixed(2),
                vat_amount: vatAmount.toFixed(2),
                total_amount: totalAmount.toFixed(2),
                // Include the payment link
                payment_link: booking.quickpay_link,
                // Include the current total spots after the addition
                total_adult_quantity: booking.adult_quantity,
                total_youth_quantity: booking.youth_quantity,
                total_kid_quantity: booking.kid_quantity,
                total_full_day: booking.full_day
            }
        };

        const response = await sgMail.send(msg);
        console.log('Add-on confirmation email sent successfully:', response[0].statusCode);
        return response;

    } catch (error) {
        console.error('Error sending add-on confirmation email:', error);
        if (error.response) {
            console.error('Error details:', error.response.body);
        }
        throw error;
    }
}

static async sendAddOnConfirmation(data) {
    try {
        console.log('addondata received', data);

        // Use data instead of booking
        const adultSum = data.adult_added * 400;
        const youthSum = data.youth_added * 300;
        const kidSum = data.kid_added * 200;
        const fullDaySum = data.full_day_added * 100;

        const baseTotal = adultSum + youthSum + kidSum + fullDaySum;
        console.log('basetotal add on:', baseTotal);

        const rebookingSum = data.is_rebookable ? 
            (adultSum + youthSum + kidSum) * 25 : 0;

        // Calculate total (no gift cards or promos for add-ons)
        const totalAmount = baseTotal + rebookingSum;

        // Calculate VAT (6%) on the total amount
        const vatRate = 0.06;
        const vatAmount = (baseTotal * vatRate) / (1 + vatRate);
        const amountExVat = totalAmount - vatAmount;

        const msg = {
            to: data.customer_email,
            from: {
                email: process.env.SENDGRID_FROM_EMAIL,
                name: 'Sörsjöns Äventyrspark'
            },
            templateId: process.env.SENDGRID_ADDON_CONFIRMATION_ID,
            dynamic_template_data: {
                booking_number: data.booking_number,
                customer_name: data.customer_name,
                booking_date: new Date(data.start_time).toLocaleDateString('sv-SE', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric'
                }),
                booking_time: new Date(data.start_time).toLocaleTimeString('sv-SE', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                }),
                // Only include quantities that were added
                ...(data.adult_added && { adult_added: data.adult_added, adult_sum: adultSum }),
                ...(data.youth_added && { youth_added: data.youth_added, youth_sum: youthSum }),
                ...(data.kid_added && { kid_added: data.kid_added, kid_sum: kidSum }),
                ...(data.full_day_added && { full_day_added: data.full_day_added, full_day_sum: fullDaySum }),
                
                // Original booking totals for reference
                total_adult: data.adult_quantity,
                total_youth: data.youth_quantity,
                total_kid: data.kid_quantity,
                total_full_day: data.full_day,

                // Payment details
                amount_ex_vat: amountExVat.toFixed(2),
                vat_amount: vatAmount.toFixed(2),
                total_amount: (data.paid_amount / 100).toFixed(2),
                payment_date: new Date(data.payment_completed_at).toLocaleDateString('sv-SE')
            }
        };

        const response = await sgMail.send(msg);
        console.log('Add-on confirmation email sent successfully:', response[0].statusCode);
        return response;

    } catch (error) {
        console.error('Error sending add-on confirmation email:', error);
        if (error.response) {
            console.error('Error details:', error.response.body);
        }
        throw error;
    }
}


    static async ombokningConfirmation(booking, start_time) {
        console.log('sending ombokningsemail')
        console.log('start_time:', start_time)
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
                    booking_date: new Date(start_time).toLocaleDateString('sv-SE', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric'
                    }),
                    booking_time: new Date(start_time).toLocaleTimeString('sv-SE', { 
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