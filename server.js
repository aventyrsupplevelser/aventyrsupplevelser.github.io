// In backend/src/server.js (now at repository root)
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import compression from 'compression';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import swishRoutes from './bokningssystem/backend/src/swishRoutes.js';

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

console.log('Starting server setup...');

// Get directory paths (now __dirname is the repository root)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const frontendPath = path.join(__dirname, '/');

console.log('Frontend (static) files will be served from:', frontendPath);

// CORS configuration
const corsOptions = {
    origin: [
        'https://aventyrsupplevelser.com',
        'https://aventyrsupplevelsergithubio-testing.up.railway.app',
        'booking-system-in-prod-production.up.railway.app',
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

// Use compression middleware to speed up responses
app.use(compression());

// Handle OPTIONS preflight requests
app.options('*', cors(corsOptions));

// Apply CORS to all routes
app.use(cors(corsOptions));

// Debug middleware for CORS
app.use((req, res, next) => {
    console.log(`CORS Debug: Method=${req.method}, Origin=${req.headers.origin}, Path=${req.path}`);
    next();
});

// Parse JSON payloads
app.use(express.json());

// Log frontend directory contents for debugging
try {
    console.log('Files in frontend path:', fs.readdirSync(frontendPath));
} catch (error) {
    console.error('Error reading frontend directory:', error);
}

// Block access to the backend folder so it's not served as static content
app.use('/bokningssystem/backend', (req, res) => {
    res.status(404).send('Not Found');
});

// 1. Serve static files
console.log('Setting up static file serving from:', frontendPath);
app.use(express.static(frontendPath));

// Mount API routes (they won’t be served as static files)
app.use('/api/swish', swishRoutes);
console.log('API routes mounted');

// Request logger (for debugging)
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
            return res.sendFile(htmlPath);
        }
        return res.status(404).json({ error: 'HTML file not found' });
    }
    // Optionally serve index.html for client-side routing fallback
    res.sendFile(path.join(frontendPath, 'index.html'));
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
