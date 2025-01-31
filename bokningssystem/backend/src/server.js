// In backend/src/server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import timeSlotRoutes from './timeSlotRoutes.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import swishRoutes from './swishRoutes.js';


const app = express();
const port = process.env.PORT || 3000;

dotenv.config();
console.log('Starting server setup...');

// Get directory paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const frontendPath = path.join(__dirname, '../../frontend');

// CORS configuration
const corsOptions = {
    origin: [
        'https://aventyrsupplevelser.com',
        'https://aventyrsupplevelsergithubio-testing.up.railway.app',
        'http://127.0.0.1:5500',      
        'http://localhost:5500'    
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Access-Control-Allow-Origin', 'QuickPay-Checksum-Sha256'],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204
};

app.set('trust proxy', true);

// Handle OPTIONS preflight requests
app.options('*', cors(corsOptions));

// Apply CORS to all routes
app.use(cors(corsOptions));

// CORS debug middleware
app.use((req, res, next) => {
    console.log(`CORS Debug: Method=${req.method}, Origin=${req.headers.origin}, Path=${req.path}`);
    next();
});

// Basic middleware
app.use(express.json());

// Log frontend directory contents
console.log('Looking for frontend files in:', frontendPath);
try {
    console.log('Files in frontend path:', fs.readdirSync(frontendPath));
} catch (error) {
    console.error('Error reading frontend directory:', error);
}

// 1. Serve static files FIRST
console.log('Setting up static file serving from:', frontendPath);
app.use(express.static(frontendPath));

// 2. Mount API routes
console.log('Available routes:');
timeSlotRoutes.stack.forEach((r) => {
    if (r.route && r.route.path) {
        console.log(`${Object.keys(r.route.methods)} ${r.route.path}`);
    }
});

app.use('/api', timeSlotRoutes);
app.use('/api/swish', swishRoutes);

console.log('Routes mounted');

// 3. Request logger
app.use((req, res, next) => {
    console.log(`Request received for ${req.method} ${req.url}`);
    next();
});

// 4. Catch-all route for HTML files
app.get('*', (req, res) => {
    if (req.path.endsWith('.html')) {
        // Try to serve the specific HTML file
        const htmlPath = path.join(frontendPath, req.path);
        if (fs.existsSync(htmlPath)) {
            res.sendFile(htmlPath);
        } else {
            res.status(404).json({ error: 'HTML file not found' });
        }
    } else {
        // Default to main booking page
        res.sendFile(path.join(frontendPath, 'skapabokningchatgpt.html'));
    }
});

// 5. 404 handler (last)
app.use((req, res) => {
    console.log(`404: Route not found for ${req.method} ${req.url}`);
    res.status(404).json({ error: 'Route not found' });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log('Routes have been set up');
});