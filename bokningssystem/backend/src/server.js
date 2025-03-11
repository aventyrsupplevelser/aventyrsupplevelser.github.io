// Simple server.js
import express from 'express';
import cors from 'cors';
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

// Simple CORS - allow all origins
app.use(cors());

// Parse JSON requests
app.use(express.json());

// Serve static files from the root
app.use(express.static(websiteRootPath));

// Mount API routes
app.use('/api/swish', swishRoutes);

// Simple request logger
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Catch-all route to handle HTML pages
app.get('*', (req, res) => {
  // Skip API routes
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  
  // Skip backend files
  if (req.path.includes('/bokningssystem/backend/')) {
    return res.status(404).send('Not found');
  }
  
  // If it has .html extension, try to serve it
  if (req.path.endsWith('.html')) {
    const filePath = path.join(websiteRootPath, req.path);
    return res.sendFile(filePath, err => {
      if (err) {
        console.error('Error serving file:', err);
        return res.status(404).send('File not found');
      }
    });
  }
  
  // For paths without extensions, redirect to .html version
  if (!path.extname(req.path) && req.path !== '/') {
    return res.redirect(`${req.path}.html`);
  }
  
  // Default to index.html
  const indexPath = path.join(websiteRootPath, 'index.html');
  res.sendFile(indexPath, err => {
    if (err) {
      console.error('Error serving index.html:', err);
      return res.status(500).send('Server error');
    }
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});