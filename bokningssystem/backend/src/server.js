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

// Update the websiteRootPath to point to where your files actually are
// In Railway, your app is in /app/src/server.js and your website files 
// are likely in /app/public or /app
const websiteRootPath = path.join(__dirname, '/'); // Try '../public' first

// Add debug information
console.log('Environment info:');
console.log('__dirname:', __dirname);
console.log('websiteRootPath:', websiteRootPath);

// Check multiple possible locations
const possiblePaths = [
  path.join(__dirname, '../public'),
  path.join(__dirname, '..'),
  path.join(__dirname, '../frontend'),
  path.join(__dirname, '../dist')
];

console.log('Checking possible website root paths:');
possiblePaths.forEach(pathToCheck => {
  try {
    if (fs.existsSync(pathToCheck)) {
      console.log(`Path exists: ${pathToCheck}`);
      console.log('Contents:', fs.readdirSync(pathToCheck));
    } else {
      console.log(`Path does not exist: ${pathToCheck}`);
    }
  } catch (error) {
    console.error(`Error checking path ${pathToCheck}:`, error);
  }
});

// Define allowed origins - include null for requests without origin
const allowedOrigins = [
  'https://aventyrsupplevelser.com',
  'https://aventyrsupplevelsergithubio-testing.up.railway.app',
  'https://booking-system-in-prod-production.up.railway.app',
  'http://127.0.0.1:5500',
  'http://localhost:5500',
  'null',     // Allow requests with null origin
  undefined   // Allow requests with undefined origin
];

// Improved CORS configuration
const corsOptions = {
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin || allowedOrigins.includes(origin)) {
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

// API routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
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
    // For root path, try to find an index.html in the website root
    let indexPath = path.join(websiteRootPath, 'index.html');
    
    // If we can't find index.html at the root, look for it in subdirectories
    if (!fs.existsSync(indexPath)) {
      console.log('index.html not found at', indexPath);
      
      // Try some common subdirectories
      const possibleDirs = ['public', 'dist', 'build', 'frontend'];
      for (const dir of possibleDirs) {
        const altPath = path.join(websiteRootPath, dir, 'index.html');
        if (fs.existsSync(altPath)) {
          indexPath = altPath;
          console.log('Found index.html at alternate location:', indexPath);
          break;
        }
      }
    }
    
    console.log('Attempting to serve index.html:', indexPath);
    
    // Check if we found an index.html anywhere
    if (!fs.existsSync(indexPath)) {
      console.error('Could not find index.html in any location');
      return res.status(500).send('Could not find index.html');
    }
    
    // Serve the index.html we found
    res.sendFile(indexPath, (err) => {
      if (err) {
        console.error('Error serving index.html:', err);
        return res.status(500).json({ error: 'Failed to serve index.html' });
      }
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