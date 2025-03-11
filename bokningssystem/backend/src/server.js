// ultra-simple-server.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import swishRoutes from './swishRoutes.js';

const app = express();
const port = process.env.PORT || 3000;

// Basic setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const websiteRootPath = path.join(__dirname, '../../../');

// Allow cross-origin requests
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  next();
});

// Basic middleware
app.use(express.json());

// Log all requests
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// API routes first
app.use('/api/swish', swishRoutes);

// Static file serving - everything except backend files
app.use('/', express.static(websiteRootPath, {
  index: ['index.html'],
  extensions: ['html']
}));

// Handle all HTML files and directory requests
app.get('/*', (req, res) => {
  // Skip API requests and backend files
  if (req.path.startsWith('/api/') || req.path.includes('/bokningssystem/backend/')) {
    return res.status(404).send('Not found');
  }
  
  // Send index.html for the root path
  res.sendFile(path.join(websiteRootPath, 'index.html'));
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});