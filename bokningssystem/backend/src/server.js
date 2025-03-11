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

// Compute repository root (assuming repository root is three levels up)
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

// Optional: Force correct protocol/host in forwarded headers if needed.
app.use((req, res, next) => {
    if (!req.headers['x-forwarded-proto']) {
        req.headers['x-forwarded-proto'] = 'https';
    }
    if (!req.headers['x-forwarded-host']) {
        req.headers['x-forwarded-host'] = 'booking-system-in-prod-production.up.railway.app';
    }
    next();
});

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

// Mount API routes (they won’t be served as static files)
app.use('/api/swish', swishRoutes);
console.log('API routes mounted');

// Block access to the backend folder to avoid exposing backend code
app.use('/bokningssystem/backend', (req, res, next) => {
    res.status(404).send('Not Found');
});

// Serve static files from the repository root, disabling automatic redirects.
app.use(express.static(projectRoot, { redirect: false }));

// Middleware to handle directory requests manually.
// If a request is for a directory (without trailing slash) and an index.html exists, serve it.
app.get('/*', (req, res, next) => {
    const reqPath = req.path;
    const potentialDirIndex = path.join(projectRoot, reqPath, 'index.html');

    if (!reqPath.endsWith('/') && fs.existsSync(potentialDirIndex)) {
        // Serve the directory’s index.html without redirecting
        return res.sendFile(potentialDirIndex);
    }
    next();
});

// Final catch-all route: if nothing else matched, serve the global index.html (for client-side routing)
app.get('*', (req, res) => {
    res.sendFile(path.join(projectRoot, 'index.html'));
});

// Optional 404 handler (unlikely to be reached)
app.use((req, res) => {
    console.log(`404: Route not found for ${req.method} ${req.url}`);
    res.status(404).json({ error: 'Route not found' });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log('Routes have been set up');
});
