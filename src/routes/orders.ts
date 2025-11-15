import { FastifyInstance } from 'fastify';
import { prisma } from '../utils/prisma';
import { pageParams } from '../utils/pagination';

export default async function orderRoutes(app: FastifyInstance) {
  app.get('/orders', { preHandler: (app as any).admin }, async (req, reply) => {
    const { limit, skip } = pageParams(req.query as any);
    const status = (req.query as any).status as any;
    const where: any = status ? { status } : {};
    const [items, total] = await Promise.all([
      prisma.order.findMany({
        where, take: limit, skip, orderBy: { createdAt: 'desc' },
        include: { items: true, user: { select: { email: true } } }
      }),
      prisma.order.count({ where })
    ]);
    return reply.send({ total, items });
  });

  app.put('/orders/:id/status', { preHandler: (app as any).admin }, async (req, reply) => {
    const { status } = req.body as any;
    const updated = await prisma.order.update({ where: { id: (req.params as any).id }, data: { status } });
    return reply.send(updated);
  });
}
