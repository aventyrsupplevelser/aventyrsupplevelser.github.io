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

// Compute repository root (assuming repo root is three levels up)
// If your repository structure is like:
//   /index.html
//   /other-static-files...
//   /bokningssystem/backend/src/server.js
// then the repo root is 3 levels up.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = path.join(__dirname, '../../../'); 
console.log('Project root is:', projectRoot);

// Trust the proxy (Railway uses a reverse proxy)
// Setting to 1 means trust the first proxy in front of the app.
app.set('trust proxy', 1);

// Middleware: Remove port (e.g. :8080) from Host header
app.use((req, res, next) => {
  if (req.headers.host) {
    // Remove any colon and digits at the end of the host header.
    req.headers.host = req.headers.host.replace(/:\d+$/, '');
  }
  next();
});

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

// Optional: Force a default protocol if missing
app.use((req, res, next) => {
    if (!req.headers['x-forwarded-proto']) {
        req.headers['x-forwarded-proto'] = 'https';
    }
    next();
});

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

// Mount API routes (these will not be served as static files)
app.use('/api/swish', swishRoutes);
console.log('API routes mounted');

// Block access to the backend folder so that backend files aren’t served statically.
app.use('/bokningssystem/backend', (req, res, next) => {
    res.status(404).send('Not Found');
});

// Serve static files from the repository root with automatic redirects disabled.
app.use(express.static(projectRoot, { redirect: false }));

// Custom middleware to manually serve a directory’s index.html when a directory is requested
app.get('/*', (req, res, next) => {
    const requestedPath = path.join(projectRoot, req.path);
    fs.stat(requestedPath, (err, stats) => {
        if (!err && stats.isDirectory()) {
            const indexPath = path.join(requestedPath, 'index.html');
            if (fs.existsSync(indexPath)) {
                // Serve the directory’s index.html without issuing a redirect.
                return res.sendFile(indexPath);
            }
        }
        next();
    });
});

// Final catch-all: serve the global index.html for client-side routing fallback.
app.get('*', (req, res) => {
    res.sendFile(path.join(projectRoot, 'index.html'));
});

// Optional 404 handler (unlikely to be reached due to the catch-all above)
app.use((req, res) => {
    console.log(`404: Route not found for ${req.method} ${req.url}`);
    res.status(404).json({ error: 'Route not found' });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log('Routes have been set up');
});
