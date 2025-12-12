// src/server.ts
import 'dotenv/config';
import fastify, { FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';

// Route modules
import authRoutes from './routes/auth';
import productRoutes from './routes/products';
import orderRoutes from './routes/orders';
import dashboardRoutes from './routes/dashboard';
import uploadsRoutes from './routes/uploads';
import nextauthExchangeRoutes from './routes/nextauth-exchange';
import categoryRoutes from './routes/categories';

// 🔐 Auth plugin (handles jwt + auth/admin decorators)
import authPlugin from './plugins/auth';

declare module 'fastify' {
  interface FastifyInstance {
    auth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    admin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    superAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const app = fastify({ logger: true });

// CORS + body parsing
app.register(cors, { origin: true });
app.register(formbody);

// 🔐 Register auth plugin (jwt + auth/admin guards)
app.register(authPlugin);

// Simple health check
app.get('/health', async () => {
  return { ok: true };
});

// Register all routes
app.register(authRoutes);
app.register(nextauthExchangeRoutes);
app.register(productRoutes);
app.register(orderRoutes);
app.register(dashboardRoutes);
app.register(uploadsRoutes);
app.register(categoryRoutes);

const port = Number(process.env.PORT || 4000);
const host = '0.0.0.0';

app
  .listen({ port, host })
  .then(() => {
    console.log(`Server running at http://${host}:${port}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
