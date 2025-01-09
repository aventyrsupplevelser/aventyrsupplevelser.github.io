// In backend/src/server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import timeSlotRoutes from './timeSlotRoutes.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';

dotenv.config();
console.log('Starting server setup...');

const app = express();
const port = process.env.PORT || 3000;

// Get directory paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const frontendPath = path.join(__dirname, '../../frontend');

console.log('Current directory:', __dirname);
console.log('Looking for frontend files in:', frontendPath);
try {
    console.log('Files in frontend path:', fs.readdirSync(frontendPath));
} catch (error) {
    console.error('Error reading frontend directory:', error);
}

// Set up middleware
console.log('Setting up middleware...');
app.use(cors());
app.use(express.json());

// Main test route
app.get('/', (req, res) => {
    res.json({ message: 'Server is working!' });
});

// Before mounting
console.log('Available routes:');
timeSlotRoutes.stack.forEach((r) => {
    if (r.route && r.route.path) {
        console.log(`${Object.keys(r.route.methods)} ${r.route.path}`);
    }
});

// Mount API routes FIRST
app.use('/api', timeSlotRoutes);
console.log('Routes mounted');

// THEN serve static files
console.log('Setting up static file serving from:', frontendPath);
app.use(express.static(frontendPath));

// Add the catch-all route logger
app.use((req, res, next) => {
    console.log(`Request received for ${req.method} ${req.url}`);
    next();
});

// Add the 404 handler
app.use((req, res) => {
    console.log(`404: Route not found for ${req.method} ${req.url}`);
    res.status(404).json({ error: 'Route not found' });
});

// Start the server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log('Routes have been set up');
});