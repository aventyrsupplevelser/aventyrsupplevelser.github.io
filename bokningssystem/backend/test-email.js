// test-email.js
import sgMail from '@sendgrid/mail';
import dotenv from 'dotenv';

dotenv.config();

// Initialize SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function sendTestEmail() {
    try {
        const msg = {
            to: 'petter.rylen@gmail.com', // Replace with your email
            from: process.env.SENDGRID_FROM_EMAIL, // Must be verified with SendGrid
            subject: 'SendGrid Test Email',
            text: 'This is a test email from SendGrid',
            html: '<strong>This is a test email from SendGrid</strong>',
        };

        const response = await sgMail.send(msg);
        console.log('Test email sent successfully:', response[0].statusCode);
        console.log('Headers:', response[0].headers);
    } catch (error) {
        console.error('Error sending test email:', error);
        if (error.response) {
            console.error('Error details:', error.response.body);
        }
    }
}

sendTestEmail();