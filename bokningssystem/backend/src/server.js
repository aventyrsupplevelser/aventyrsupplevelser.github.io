// In bokningssystem/backend/src/server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import swishRoutes from './swishRoutes.js';

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

console.log('Starting server setup...');

// Get the directory of this file and compute the repository root.
// __dirname is "/bokningssystem/backend/src", so three levels up is the repo root.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = path.join(__dirname, '../../../'); 

console.log('Project root is:', projectRoot);

// CORS configuration remains the same.
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

// Handle OPTIONS preflight requests
app.options('*', cors(corsOptions));

// Apply CORS to all routes
app.use(cors(corsOptions));

// CORS debug middleware
app.use((req, res, next) => {
    console.log(`CORS Debug: Method=${req.method}, Origin=${req.headers.origin}, Path=${req.path}`);
    next();
});

// Parse JSON payloads
app.use(express.json());

// Log the repository root directory contents for debugging
console.log('Files in project root:', fs.readdirSync(projectRoot));

// Mount API routes (these will not be served as static files)
app.use('/api/swish', swishRoutes);
console.log('API routes mounted');

// Block access to the backend folder to avoid exposing backend code
app.use('/bokningssystem/backend', (req, res, next) => {
    res.status(404).send('Not Found');
});

// Serve static files from the repository root (which contains index.html and all other site assets)
console.log('Serving static files from:', projectRoot);
app.use(express.static(projectRoot));

// Catch-all route: if a file is not found via the static middleware, serve index.html.
// This supports client-side routing (SPA) where the URL might not match a physical file.
app.get('*', (req, res) => {
    res.sendFile(path.join(projectRoot, 'index.html'));
});

// Optional: 404 handler for any other requests (should rarely be reached)
app.use((req, res) => {
    console.log(`404: Route not found for ${req.method} ${req.url}`);
    res.status(404).json({ error: 'Route not found' });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log('Routes have been set up');
});
