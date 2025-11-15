import { FastifyInstance } from 'fastify';
import { prisma } from '../utils/prisma';

type Body = {
  email: string;
  name?: string;
  image?: string;
  provider?: string;
  providerAccountId?: string;
  role?: 'ADMIN'|'STAFF'|'CUSTOMER';
};

export default async function nextauthExchangeRoutes(app: FastifyInstance) {
  app.post('/auth/exchange', async (req, reply) => {
    const secret = req.headers['x-backend-secret'];
    if (!process.env.BACKEND_SHARED_SECRET || secret !== process.env.BACKEND_SHARED_SECRET) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { email, role } = req.body as Body;
    if (!email) return reply.code(400).send({ error: 'email required' });

    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, password: '', role: role ?? 'CUSTOMER' }
    });

    const token = (app as any).jwt.sign({ id: user.id, email: user.email, role: user.role }, { expiresIn: '7d' });
    return reply.send({ token, user });
  });

  app.get('/auth/me', { preHandler: (app as any).auth }, async (req) => {
    return { user: (req as any).user };
  });
}
