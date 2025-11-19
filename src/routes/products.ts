import { FastifyInstance } from 'fastify';
import { prisma } from '../utils/prisma';
import { z } from 'zod';
import { pageParams } from '../utils/pagination';

const productDto = z.object({
  sku: z.string().min(3),
  title: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional(),
  priceCents: z.number().int().nonnegative(),
  currency: z.string().default('USD'),
  stock: z.number().int().nonnegative().default(0),
  images: z.array(z.string()).default([]),
  active: z.boolean().default(true),
});

export default async function productRoutes(app: FastifyInstance) {
  // List + search products (used by admin Product List page)
  app.get('/products', async (req, reply) => {
    const { limit, skip } = pageParams(req.query as any);
    const qRaw = (req.query as any).q;
    const q = typeof qRaw === 'string' ? qRaw.trim() : qRaw?.toString().trim();

    const where: any = q
      ? {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { sku: { contains: q, mode: 'insensitive' } },
            { slug: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {};

    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        take: limit,
        skip,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.product.count({ where }),
    ]);

    return reply.send({ total, items });
  });

  // Single product (optional for admin/details use)
  app.get('/products/:id', async (req, reply) => {
    const id = (req.params as any).id as string;
    const item = await prisma.product.findUnique({ where: { id } });
    if (!item) return reply.code(404).send({ error: 'Not found' });
    return item;
  });

  // Create product (admin only)
  app.post('/products', { preHandler: (app as any).admin }, async (req, reply) => {
    const body = productDto.parse(req.body);
    const created = await prisma.product.create({
      data: {
        ...body,
        images: body.images, // explicit to be clear
      },
    });
    return reply.code(201).send(created);
  });

  // Update product (admin only)
  app.put('/products/:id', { preHandler: (app as any).admin }, async (req, reply) => {
    const id = (req.params as any).id as string;
    const body = productDto.partial().parse(req.body);
    const updated = await prisma.product.update({
      where: { id },
      data: {
        ...body,
      },
    });
    return reply.send(updated);
  });

  // Delete product (admin only)
  app.delete('/products/:id', { preHandler: (app as any).admin }, async (req, reply) => {
    const id = (req.params as any).id as string;
    await prisma.product.delete({ where: { id } });
    return reply.code(204).send();
  });
}
