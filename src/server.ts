import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swaggerPlugin from './plugins/swagger';
import authPlugin from './plugins/auth';

import authRoutes from './routes/auth';
import productRoutes from './routes/products';
import orderRoutes from './routes/orders';
import dashboardRoutes from './routes/dashboard';
import uploadsRoutes from './routes/uploads';
import nextauthExchangeRoutes from './routes/nextauth-exchange';

const app = Fastify({ logger: true });

async function main() {
  await app.register(helmet);
  await app.register(cors, { origin: true, credentials: true });
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' });
  await app.register(swaggerPlugin);
  await app.register(authPlugin);

  app.get('/health', async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(productRoutes);
  await app.register(orderRoutes);
  await app.register(dashboardRoutes);
  await app.register(uploadsRoutes);
  await app.register(nextauthExchangeRoutes);

  await app.ready();
  app.swagger();
  const port = parseInt(process.env.PORT || '4000', 10);
  await app.listen({ port, host: '0.0.0.0' });
}
main();
