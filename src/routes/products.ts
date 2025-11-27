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
  previousPriceCents: z.number().int().nonnegative().optional().nullable(),
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
  categoryIds: z.array(z.string()).optional().default([]),

    // Required now
  storeId: z.string().min(1),
})

// for partial updates
const productUpdateDto = productDto.partial()

/**
 * Assumes admin auth preHandler decorates request with:
 *   request.user = { id: string; role: "ADMIN" | "STAFF"; storeId: string | null }
 */
type AdminRequest = FastifyRequest & {
  user?: { id: string; role: string; storeId: string}
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
        orderBy: { createdAt: 'desc' },
        include: {
          categories: {
            include: {
              category: true
            }
          }
        }
      }),
      prisma.product.count({ where })
    ])

    return reply.send({ total, items })
  })

  // Single product
  app.get('/products/:id', async (req, reply) => {
    const id = (req.params as any).id as string
    const item = await prisma.product.findUnique({
      where: { id },
      include: {
        categories: {
          include: {
            category: true
          }
        }
      }
    })
    if (!item) return reply.code(404).send({ error: 'Not found' })
    return reply.send(item)
  })

  // Create product (admin only)
app.post(
  '/products',
  { preHandler: (app as any).admin },
  async (req, reply) => {
    const adminReq = req as AdminRequest;
    const user = adminReq.user;

    const body = productDto.parse(req.body);

    // REQUIRED: storeId must come from frontend DTO
    if (!body.storeId) {
      return reply.code(400).send({ error: "storeId is required" });
    }

    // Security: ensure this admin owns the store
    if (!user?.storeId || user.storeId !== body.storeId) {
      return reply.code(403).send({
        error: "You do not have permission to create products for this store.",
      });
    }

    // Validate that store exists
    const store = await prisma.store.findUnique({
      where: { id: body.storeId },
    });

    if (!store) {
      return reply.code(404).send({ error: "Store not found" });
    }

    console.log("\n\nCreating product for store:", body.storeId, "\n\n");

    const created = await prisma.product.create({
      data: {
        sku: body.sku,
        title: body.title,
        slug: body.slug,
        description: body.description ?? null,
        features: body.features ?? null,
        note: body.note ?? null,
        priceCents: body.priceCents,
        previousPriceCents: body.previousPriceCents ?? null,
        currency: body.currency,
        stock: body.stock,
        active: true,
        featured: body.featured ?? false,

        thumbnailUrl: body.thumbnailUrl ?? null,
        galleryUrls: body.galleryUrls,
        videoUrl: body.videoUrl ?? null,
        videoPosterUrl: body.videoPosterUrl ?? null,

        optionsJson: body.optionsJson,
        images: body.galleryUrls,

        // Correct store connection
        storeId: body.storeId,

        // categories linking
        categories:
          (body.categoryIds ?? []).length > 0
            ? {
                create: body.categoryIds.map((catId) => ({
                  category: {
                    connectOrCreate: {
                      where: { id: catId },
                      create: {
                        title: catId,
                        slug: catId.toLowerCase(),
                      },
                    },
                  },
                })),
              }
            : undefined,
      },
    });

    return reply.code(201).send(created);
  }
);

  // Update product (admin only)
  app.put(
    "/products/:id",
    { preHandler: (app as any).admin },
    async (req, reply) => {
      const id = (req.params as any).id as string;

      // parse body as partial product (includes `categoryIds?`)
      const body = productUpdateDto.parse(req.body);

      // pull categoryIds out so we can handle relation separately
      const { categoryIds, ...rest } = body;

      const updated = await prisma.$transaction(async (tx) => {
        // 1) Update the base product fields
        const product = await tx.product.update({
          where: { id },
          data: {
            ...(rest.sku !== undefined && { sku: rest.sku }),
            ...(rest.title !== undefined && { title: rest.title }),
            ...(rest.slug !== undefined && { slug: rest.slug }),
            description:
              rest.description !== undefined ? rest.description : undefined,
            features:
              rest.features !== undefined ? rest.features : undefined,
            note: rest.note !== undefined ? rest.note : undefined,
            priceCents:
              rest.priceCents !== undefined ? rest.priceCents : undefined,
            previousPriceCents:
              rest.previousPriceCents !== undefined
                ? rest.previousPriceCents
                : undefined,
            currency: rest.currency !== undefined ? rest.currency : undefined,
            stock: rest.stock !== undefined ? rest.stock : undefined,
            featured:
              rest.featured !== undefined ? rest.featured : undefined,
            thumbnailUrl:
              rest.thumbnailUrl !== undefined
                ? rest.thumbnailUrl
                : undefined,
            galleryUrls:
              rest.galleryUrls !== undefined ? rest.galleryUrls : undefined,
            videoUrl:
              rest.videoUrl !== undefined ? rest.videoUrl : undefined,
            videoPosterUrl:
              rest.videoPosterUrl !== undefined
                ? rest.videoPosterUrl
                : undefined,
            optionsJson:
              rest.optionsJson !== undefined ? rest.optionsJson : undefined,
            images:
              rest.galleryUrls !== undefined ? rest.galleryUrls : undefined,
            // ⚠️ we intentionally do NOT allow storeId changes here
          },
        });

        // 2) If categoryIds was sent, update the join table
        if (categoryIds !== undefined) {
          // a) remove all existing links for this product
          await tx.productCategory.deleteMany({
            where: { productId: id },
          });

          // b) re-insert the new set of category links
          if (categoryIds.length > 0) {
            await tx.productCategory.createMany({
              data: categoryIds.map((categoryId) => ({
                productId: id,
                categoryId,
              })),
            });
          }
        }

        return product;
      });

      return reply.send(updated);
    }
  );


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

  // Update product active/draft status (admin only)
  app.patch(
    '/products/:id/status',
    { preHandler: (app as any).admin },
    async (req, reply) => {
      const id = (req.params as any).id as string

      // Expect body like { active: boolean }
      const body = req.body as any
      const active = typeof body?.active === 'boolean' ? body.active : null

      if (active === null) {
        return reply
          .code(400)
          .send({ error: "Missing or invalid 'active' boolean" })
      }

      try {
        const updated = await prisma.product.update({
          where: { id },
          data: { active }
        })

        return reply.send(updated)
      } catch (err) {
        console.error('PATCH /products/:id/status failed', id, err)
        return reply.code(500).send({ error: 'Failed to update status' })
      }
    }
  )
}
