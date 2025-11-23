import { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { pageParams } from '../utils/pagination'

/* ---------- Zod types matching dashboard ---------- */

const productOptionValueDto = z.object({
  label: z.string(),
  hex: z.string().nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  // imageFile never reaches backend
  priceDelta: z.number().nullable().optional(),
  stock: z.number().nullable().optional()
})

const productOptionDto = z.object({
  name: z.string(),
  values: z.array(productOptionValueDto)
})

const productDto = z.object({
  sku: z.string().min(3),
  title: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional().nullable(),
  features: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  priceCents: z.number().int().nonnegative(),
  currency: z.string().default('USD'),
  stock: z.number().int().nonnegative().default(0),
  featured: z.boolean().default(true),

  // media from dashboard
  thumbnailUrl: z.string().url().optional().nullable(),
  galleryUrls: z.array(z.string().url()).default([]),
  videoUrl: z.string().url().optional().nullable(),
  videoPosterUrl: z.string().url().optional().nullable(),

  // options JSON from dashboard: ProductOption[]
  optionsJson: z.array(productOptionDto).optional().default([]),

  // categories from dashboard (IDs or slugs)
  categoryIds: z.array(z.string()).optional().default([])
})

// for partial updates
const productUpdateDto = productDto.partial()

/**
 * Assumes admin auth preHandler decorates request with:
 *   request.user = { id: string; role: "ADMIN" | "STAFF"; storeId: string | null }
 */
type AdminRequest = FastifyRequest & {
  user?: { id: string; role: string; storeId?: string | 'sh_admin_v4' }
}

export default async function productRoutes (app: FastifyInstance) {
  // List + search products (admin list)
  app.get('/products', async (req, reply) => {
    const { limit, skip } = pageParams(req.query as any)
    const qRaw = (req.query as any).q
    const q = typeof qRaw === 'string' ? qRaw.trim() : qRaw?.toString().trim()

    const where: any = q
      ? {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { sku: { contains: q, mode: 'insensitive' } },
            { slug: { contains: q, mode: 'insensitive' } }
          ]
        }
      : {}

    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        take: limit,
        skip,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.product.count({ where })
    ])

    return reply.send({ total, items })
  })

  // Single product
  app.get('/products/:id', async (req, reply) => {
    const id = (req.params as any).id as string
    const item = await prisma.product.findUnique({ where: { id } })
    if (!item) return reply.code(404).send({ error: 'Not found' })
    return reply.send(item)
  })

  // Create product (admin only)
  app.post(
    '/products',
    { preHandler: (app as any).admin },
    async (req, reply) => {
      const adminReq = req as AdminRequest
      const user = adminReq.user

      const body = productDto.parse(req.body)

      const store = await prisma.store.findFirst({
        where: { slug: 'shop-hikes' }
      })

      // if (!store) {
      //   return reply
      //     .code(500)
      //     .send({ error: "Default store not found (slug: shop-hikes)" });
      // }

      console.log('\n\nSlug received from Admin:', body.slug, '\n\n')
      const created = await prisma.product.create({
        data: {
          sku: body.sku,
          title: body.title,
          slug: body.slug,
          description: body.description ?? null,
          features: body.features ?? null,
          note: body.note ?? null,
          priceCents: body.priceCents,
          currency: body.currency,
          stock: body.stock,
          active: body.featured,
          // media
          thumbnailUrl: body.thumbnailUrl ?? null,
          galleryUrls: body.galleryUrls,
          videoUrl: body.videoUrl ?? null,
          videoPosterUrl: body.videoPosterUrl ?? null,
          // options: exact ProductOption[] JSON from dashboard
          optionsJson: body.optionsJson,
          // legacy images[] for compatibility with existing UI
          images: body.galleryUrls,
          // store relation (required)
          storeId: store!.id,
          // categories: create Category if missing, then link
          categories:
            (body.categoryIds ?? []).length > 0
              ? {
                  create: (body.categoryIds ?? []).map(rawIdOrSlug => ({
                    category: {
                      connectOrCreate: {
                        where: { id: rawIdOrSlug },
                        create: {
                          title: rawIdOrSlug,
                          slug: rawIdOrSlug.toLowerCase()
                        }
                      }
                    }
                  }))
                }
              : undefined
        }
      })

      return reply.code(201).send(created)
    }
  )

  // Update product (admin only)
  app.put(
    '/products/:id',
    { preHandler: (app as any).admin },
    async (req, reply) => {
      const id = (req.params as any).id as string
      const body = productUpdateDto.parse(req.body)

      const updated = await prisma.product.update({
        where: { id },
        data: {
          ...(body.sku && { sku: body.sku }),
          ...(body.title && { title: body.title }),
          ...(body.slug && { slug: body.slug }),
          description:
            body.description !== undefined ? body.description : undefined,
          features: body.features !== undefined ? body.features : undefined,
          note: body.note !== undefined ? body.note : undefined,
          priceCents:
            body.priceCents !== undefined ? body.priceCents : undefined,
          currency: body.currency,
          stock: body.stock,
          active: body.featured,
          thumbnailUrl:
            body.thumbnailUrl !== undefined ? body.thumbnailUrl : undefined,
          galleryUrls:
            body.galleryUrls !== undefined ? body.galleryUrls : undefined,
          videoUrl: body.videoUrl !== undefined ? body.videoUrl : undefined,
          videoPosterUrl:
            body.videoPosterUrl !== undefined ? body.videoPosterUrl : undefined,
          optionsJson:
            body.optionsJson !== undefined ? body.optionsJson : undefined,
          images: body.galleryUrls !== undefined ? body.galleryUrls : undefined
          // Note: updating categories is more complex (disconnect + reconnect),
          // you can add that later if needed.
        }
      })

      return reply.send(updated)
    }
  )

  // Delete product (admin only)
  // app.delete(
  //   "/products/:id",
  //   { preHandler: (app as any).admin },
  //   async (req, reply) => {
  //     const id = (req.params as any).id as string;
  //     await prisma.product.delete({ where: { id } });
  //     return reply.code(204).send();
  //   }
  // );
  app.delete(
    '/products/:id',
    { preHandler: (app as any).admin },
    async (req, reply) => {
      const id = (req.params as any).id as string

      try {
        await prisma.product.delete({ where: { id } })
        return reply.code(204).send()
      } catch (err) {
        console.error('DELETE /products/:id failed', id, err)
        return reply.code(500).send({ error: 'Delete failed' })
      }
    }
  )
}
