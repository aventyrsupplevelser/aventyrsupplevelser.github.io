// In bokningssystem/backend/src/server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import swishRoutes from './swishRoutes.js';

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

console.log('Starting server setup...');
// Compute repository root (assuming your repository root is three levels up)
// For a structure like:
//   /index.html
//   /other-static-files...
//   /bokningssystem/backend/src/server.js
// the repo root is:
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = path.join(__dirname, '../../../');
console.log('Project root is:', projectRoot);

// Trust the proxy so Express uses the forwarded headers correctly.
app.set('trust proxy', 1);

// Middleware: override res.redirect to remove any instance of ":8080" from redirect URLs.
app.use((req, res, next) => {
  const originalRedirect = res.redirect.bind(res);
  res.redirect = function(url, ...args) {
    if (typeof url === 'string') {
      url = url.replace(/:8080/g, ''); // strip :8080 from any URL
    }
    return originalRedirect(url, ...args);
  };
  next();
});

// (Optional) Strip any port from the Host header as well.
app.use((req, res, next) => {
  if (req.headers.host) {
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
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Access-Control-Allow-Origin',
    'QuickPay-Checksum-Sha256'
  ],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.use(express.json());

// Mount API routes (these will not be served as static files)
app.use('/api/swish', swishRoutes);
console.log('API routes mounted');

// Block access to the backend folder (prevent backend code from being served as static assets)
app.use('/bokningssystem/backend', (req, res) => {
  res.status(404).send('Not Found');
});

// Serve static files from the repository root. Express.static will
// automatically issue a redirect for directories missing a trailing slash,
// but our override will strip the port from that redirect.
app.use(express.static(projectRoot));

// Catch-all: serve the global index.html (for client-side routing fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(projectRoot, 'index.html'));
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
