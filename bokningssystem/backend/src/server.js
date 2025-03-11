// In server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
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

// Change this to your website root instead of just frontend
// Assuming your directory structure is: /root/backend/src/server.js
// And your website files are in: /root/
const websiteRootPath = path.join(__dirname, '../..'); 

// Add debug information
console.log('Environment info:');
console.log('__dirname:', __dirname);
console.log('websiteRootPath:', websiteRootPath);

// Check if index.html exists at startup
const indexPath = path.join(websiteRootPath, 'index.html');
fs.access(indexPath, fs.constants.R_OK, (err) => {
  if (err) {
    console.error('WARNING: Cannot access index.html at', indexPath);
    console.error('Error details:', err);
  } else {
    console.log('index.html is accessible at', indexPath);
  }
});

// List the contents of the website root
try {
  console.log('Contents of website root:');
  const rootContents = fs.readdirSync(websiteRootPath);
  console.log(rootContents);
} catch (error) {
  console.error('Error reading website root directory:', error);
}

// Define allowed origins
const allowedOrigins = [
  'https://aventyrsupplevelser.com',
  'https://aventyrsupplevelsergithubio-testing.up.railway.app',
  'https://booking-system-in-prod-production.up.railway.app',
  'http://127.0.0.1:5500',
  'http://localhost:5500'
];

// Improved CORS configuration
const corsOptions = {
  origin: function(origin, callback) {
    // Only allow requests from specified origins
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log(`Blocked request from unauthorized origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
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

app.set('trust proxy', true);

// Handle OPTIONS preflight requests
app.options('*', cors(corsOptions));

// Apply CORS to all routes
app.use(cors(corsOptions));

// Add Content Security Policy middleware
app.use((req, res, next) => {
  // Set Content Security Policy headers
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net"
  );
  next();
});

// Basic middleware
app.use(express.json());

// Set up static file serving with specific exclusions
console.log('Setting up static file serving from:', websiteRootPath);
app.use(express.static(websiteRootPath, {
  // Exclude these directories and files from being served statically
  setHeaders: (res, path) => {
    // Check if the requested path is in a sensitive directory
    if (
      path.includes('/backend/') ||       // Exclude backend directory
      path.includes('/.git/') ||          // Exclude git directory
      path.includes('/.env') ||           // Exclude env files
      path.endsWith('.env') ||
      path.includes('/node_modules/')     // Exclude node_modules
    ) {
      res.status(404).end();  // Return 404 for sensitive paths
      return false;
    }
  }
}));

// Mount API routes
app.use('/api/swish', swishRoutes);

// Request logger
app.use((req, res, next) => {
  console.log(`Request received for ${req.method} ${req.url}`);
  next();
});

// Catch-all route for HTML files
app.get('*', (req, res, next) => {
  // Skip if it's an API request
  if (req.path.startsWith('/api/')) {
    return next();
  }
  
  // Skip protected paths
  if (
    req.path.includes('/backend/') ||
    req.path.includes('/.git/') ||
    req.path.includes('/.env') ||
    req.path.endsWith('.env') ||
    req.path.includes('/node_modules/')
  ) {
    return res.status(404).json({ error: 'Not found' });
  }

  if (req.path.endsWith('.html')) {
    // Try to serve the specific HTML file
    const htmlPath = path.join(websiteRootPath, req.path);
    console.log('Attempting to serve HTML file:', htmlPath);
    
    if (fs.existsSync(htmlPath)) {
      return res.sendFile(htmlPath);
    } else {
      console.log('HTML file not found:', htmlPath);
      return res.status(404).json({ error: 'HTML file not found' });
    }
  } else {
    const indexPath = path.join(websiteRootPath, 'index.html');
    console.log('Attempting to serve index.html:', indexPath);
    
    // Check if index.html exists before trying to serve it
    fs.access(indexPath, fs.constants.R_OK, (err) => {
      if (err) {
        console.error('Error accessing index.html:', err);
        return res.status(500).json({ error: 'Could not access index.html' });
      }
      
      // Serve index.html with better error handling
      res.sendFile(indexPath, (err) => {
        if (err) {
          console.error('Error serving index.html:', err);
          return res.status(500).json({ error: 'Failed to serve index.html' });
        }
      });
    });
  }
});

// 404 handler (last)
app.use((req, res) => {
  console.log(`404: Route not found for ${req.method} ${req.url}`);
  res.status(404).json({ error: 'Route not found' });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log('Routes have been set up');
});