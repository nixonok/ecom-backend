// src/server.ts
import 'dotenv/config';
import fastify, { FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import fastifyJwt from '@fastify/jwt';

// Route modules
import authRoutes from './routes/auth';
import productRoutes from './routes/products';
import orderRoutes from './routes/orders';
import dashboardRoutes from './routes/dashboard';
import uploadsRoutes from './routes/uploads';
import nextauthExchangeRoutes from './routes/nextauth-exchange';

declare module 'fastify' {
  interface FastifyInstance {
    auth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    admin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    user?: {
      id: string;
      email: string;
      role: 'ADMIN' | 'STAFF' | 'CUSTOMER';
      [key: string]: any;
    };
  }
}

const app = fastify({ logger: true });

// CORS + body parsing
app.register(cors, { origin: true });
app.register(formbody);

// JWT
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error('JWT_SECRET is not set in .env');
}

app.register(fastifyJwt, {
  secret: jwtSecret,
});

// Auth guard: any logged-in user
app.decorate(
  'auth',
  async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        reply.code(401).send({ error: 'Missing token' });
        return;
      }

      const token = authHeader.slice('Bearer '.length);
      const payload = await (app as any).jwt.verify(token);
      (req as any).user = payload;
    } catch (err) {
      req.log.error(err);
      reply.code(401).send({ error: 'Invalid token' });
    }
  }
);

// Admin guard: ADMIN or STAFF only
app.decorate(
  'admin',
  async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await (app as any).auth(req, reply);
    if (reply.sent) return;

    const user = (req as any).user;
    if (!user || (user.role !== 'ADMIN' && user.role !== 'STAFF')) {
      reply.code(403).send({ error: 'Forbidden' });
    }
  }
);

// Simple health check
app.get('/health', async () => {
  return { ok: true };
});

// Register all routes (no prefix → paths are exactly as defined)
app.register(authRoutes);
app.register(nextauthExchangeRoutes);
app.register(productRoutes);
app.register(orderRoutes);
app.register(dashboardRoutes);
app.register(uploadsRoutes);

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
