import express from 'express';
import router from './routes/router.js';

const app = express();

// Mount the API router
app.use('/', router);

export default app;