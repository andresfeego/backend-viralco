import 'dotenv/config';
import cors from 'cors';
import express from 'express';

import { env } from './lib/env.ts';
import { sendApiError } from './lib/api-error.ts';
import { auditLogMiddleware } from './middlewares/audit-log.ts';
import adminRoute from './routes/admin.ts';
import authRoute from './routes/auth.ts';
import permissionsRoute from './routes/permissions.ts';
import postRoute from './routes/post.ts';
import eventsRoute from './routes/events.ts';
import accountsRoute from './routes/accounts.ts';
import libraryRoute from './routes/library.ts';
import publicAssetsRoute from './routes/public-assets.ts';

const app = express();
export { app };

app.use(cors());
app.use(express.json());
app.use(auditLogMiddleware);

app.get('/health', (_, res) => {
  res.status(200).json({ ok: true });
});

app.use('/api/posts', postRoute);

app.use('/api/auth', authRoute);
app.use('/api/permissions', permissionsRoute);
app.use('/api/admin', adminRoute);
app.use('/api/events', eventsRoute);
app.use('/api/accounts', accountsRoute);
app.use('/api/library', libraryRoute);
app.use('/api/public/assets', publicAssetsRoute);

app.use((error: any, req: any, res: any, _next: any) => {
  sendApiError(req, res, error, 'Error interno del servidor');
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(env.port, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${env.port}`);
  });
}
