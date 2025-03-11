// Simplified server.js with direct file serving
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import swishRoutes from './swishRoutes.js';

const app = express();
const port = process.env.PORT || 3000;

// Basic setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const websiteRootPath = path.join(__dirname, '../../../');

console.log('Website root path:', websiteRootPath);

// Simple CORS - allow all origins
app.use(cors());

// Parse JSON requests
app.use(express.json());

// Don't serve backend files
app.use(express.static(websiteRootPath, {
  setHeaders: (res, filePath) => {
    if (filePath.includes('/bokningssystem/backend/')) {
      res.status(404).end();
    }
  }
}));

// Mount API routes
app.use('/api/swish', swishRoutes);

// Simple handling for all non-API routes
app.get('*', (req, res, next) => {
  // Skip if it's an API request or already handled by static middleware
  if (req.path.startsWith('/api/')) {
    return next();
  }
  
  // Skip backend files
  if (req.path.includes('/bokningssystem/backend/')) {
    return res.status(404).send('Not found');
  }
  
  // Try these paths in order:
  const pathsToTry = [
    req.path,                        // Exact path as requested
    `${req.path}.html`,              // Add .html extension
    path.join(req.path, 'index.html') // Check for index.html in directory
  ];
  
  // Try each path
  for (const pathToTry of pathsToTry) {
    const fullPath = path.join(websiteRootPath, pathToTry);
    
    try {
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        return res.sendFile(fullPath);
      }
    } catch (error) {
      console.error(`Error checking path ${fullPath}:`, error);
    }
  }
  
  // If we get here, just send index.html
  return res.sendFile(path.join(websiteRootPath, 'index.html'));
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});