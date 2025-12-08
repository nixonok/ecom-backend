import { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { pageParams } from '../utils/pagination'
import { deleteObjectByUrl, deleteObjectsByUrls } from '../utils/s3util'

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
  priceCents: z.number().int().nonnegative(),
  previousPriceCents: z.number().int().nonnegative().optional().nullable(),

  // extra fields in schema
  purchasePriceCents: z.number().int().nonnegative().optional().nullable(),
  pageView: z.number().int().nonnegative().optional().nullable(),
  inCart: z.number().int().nonnegative().optional().nullable(),
  totalUnitsSold: z.number().int().nonnegative().optional().nullable(),
  totalRevenueCents: z.number().int().nonnegative().optional().nullable(),

  currency: z.string().default('BDT'),
  stock: z.number().int().nonnegative().default(0),
  featured: z.boolean().default(false),

  // media from dashboard
  thumbnailUrl: z.string().url().optional().nullable(),
  galleryUrls: z.array(z.string().url()).default([]),
  videoUrl: z.string().url().optional().nullable(),
  videoPosterUrl: z.string().url().optional().nullable(),

  features: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  optionsJson: z.array(productOptionDto).optional().default([]),

  // categories from dashboard (IDs)
  categoryIds: z.array(z.string()).optional().default([]),

  // store
  storeId: z.string().min(1)
})

// for partial updates
const productUpdateDto = productDto.partial()

/**
 * Assumes admin auth preHandler decorates request with:
 *   request.user = { id: string; role: string; storeId: string }
 */
type AdminRequest = FastifyRequest & {
  user?: { id: string; role: string; storeId: string }
}

export default async function productsRoutes (app: FastifyInstance) {
  /* ---------- List products with pagination & search ---------- */
  // app.get('/products', async (req, reply) => {
  //   const { skip, take } = pageParams(req)

  //   const qRaw = (req.query as any).q
  //   const q = typeof qRaw === 'string' ? qRaw.trim() : qRaw?.toString().trim()

  //   const where: any = q
  //     ? {
  //         OR: [
  //           { title: { contains: q, mode: 'insensitive' } },
  //           { sku: { contains: q, mode: 'insensitive' } },
  //           { slug: { contains: q, mode: 'insensitive' } }
  //         ]
  //       }
  //     : {}

  //   const findManyArgs: any = {
  //     where,
  //     orderBy: { createdAt: 'desc' },
  //     include: {
  //       // Product.categories -> ProductCategory[]
  //       categories: {
  //         include: {
  //           category: true // Category model
  //         }
  //       },
  //       store: true
  //     }
  //   }
  //   if (typeof skip === 'number') findManyArgs.skip = skip
  //   if (typeof take === 'number') findManyArgs.take = take

  //   const [items, total] = await Promise.all([
  //     prisma.product.findMany(findManyArgs),
  //     prisma.product.count({ where })
  //   ])

  //   return reply.send({
  //     items,
  //     total,
  //     pageSize: take ?? items.length,
  //     page: skip && take ? skip / take + 1 : 1
  //   })
  // })

  app.get('/products', async (req, reply) => {
    const { skip, take } = pageParams(req)
    const query = req.query as any

    /** ------------------ Text search (existing behavior) ------------------ */
    const qRaw = query.q
    const q = typeof qRaw === 'string' ? qRaw.trim() : qRaw?.toString().trim()

    const where: any = {}

    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { sku: { contains: q, mode: 'insensitive' } },
        { slug: { contains: q, mode: 'insensitive' } }
      ]
    }

    /** ------------------ Category filter (optional) ------------------ */
    // Accepts:
    //   ?category=smart-watch
    //   ?category=watch&category=bottle   (multiple)
    const categoryRaw = query.category
    let categorySlugs: string[] | undefined

    if (Array.isArray(categoryRaw)) {
      categorySlugs = categoryRaw
        .map((c: any) =>
          typeof c === 'string' ? c.trim() : c?.toString().trim()
        )
        .filter(Boolean)
    } else if (typeof categoryRaw === 'string' && categoryRaw.trim()) {
      categorySlugs = [categoryRaw.trim()]
    }

    if (categorySlugs && categorySlugs.length > 0) {
      // Product.categories -> ProductCategory[] -> Category
      where.categories = {
        some: {
          category: {
            slug: {
              in: categorySlugs
            }
          }
        }
      }
    }

    /** ------------------ Price filter (optional) ------------------ */
    // Frontend sends minPrice/maxPrice in "taka" (same as Sanity price).
    // We convert to cents to match priceCents in DB.
    const minRaw = query.minPrice
    const maxRaw = query.maxPrice

    const minPrice =
      minRaw != null && minRaw !== ''
        ? Number(typeof minRaw === 'string' ? minRaw : minRaw.toString())
        : undefined
    const maxPrice =
      maxRaw != null && maxRaw !== ''
        ? Number(typeof maxRaw === 'string' ? maxRaw : maxRaw.toString())
        : undefined

    const minPriceCents =
      typeof minPrice === 'number' && !Number.isNaN(minPrice)
        ? Math.round(minPrice * 100)
        : undefined
    const maxPriceCents =
      typeof maxPrice === 'number' && !Number.isNaN(maxPrice)
        ? Math.round(maxPrice * 100)
        : undefined

    if (minPriceCents != null || maxPriceCents != null) {
      where.priceCents = {}
      if (minPriceCents != null) {
        where.priceCents.gte = minPriceCents
      }
      if (maxPriceCents != null) {
        where.priceCents.lte = maxPriceCents
      }
    }

    /** ------------------ Query DB (unchanged shape) ------------------ */
    const findManyArgs: any = {
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        // Product.categories -> ProductCategory[]
        categories: {
          include: {
            category: true // Category model
          }
        },
        store: true
      }
    }

    if (typeof skip === 'number') findManyArgs.skip = skip
    if (typeof take === 'number') findManyArgs.take = take

    const [items, total] = await Promise.all([
      prisma.product.findMany(findManyArgs),
      prisma.product.count({ where })
    ])

    return reply.send({
      items,
      total,
      pageSize: take ?? items.length,
      page: skip && take ? skip / take + 1 : 1
    })
  })

  /* ---------- Get single product ---------- */
  app.get('/products/:id', async (req, reply) => {
    const id = (req.params as any).id as string

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        categories: {
          include: { category: true }
        },
        store: true
      }
    })

    if (!product) {
      return reply.code(404).send({ error: 'Product not found' })
    }

    return reply.send(product)
  })

  /* ---------- Get single product by slug (storefront) ---------- */
  app.get('/products/slug/:slug', async (req, reply) => {
    const { slug } = req.params as any

    if (!slug || typeof slug !== 'string') {
      return reply.code(400).send({ error: 'Invalid slug' })
    }

    const product = await prisma.product.findFirst({
      where: { slug },
      include: {
        categories: {
          include: { category: true }
        },
        store: true
      }
    })

    if (!product) {
      return reply.code(404).send({ error: 'Product not found' })
    }

    return reply.send(product)
  })

  /* ---------- Create product (admin only) ---------- */
  app.post(
    '/products',
    { preHandler: (app as any).admin },
    async (req: AdminRequest, reply) => {
      const body = productDto.parse(req.body)

      const user = req.user
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      // Security: ensure this admin owns the store
      if (!user.storeId || user.storeId !== body.storeId) {
        return reply.code(403).send({
          error: 'You do not have permission to create products for this store.'
        })
      }

      // Validate that store exists
      const store = await prisma.store.findUnique({
        where: { id: body.storeId }
      })

      if (!store) {
        return reply.code(404).send({ error: 'Store not found' })
      }

      // Check for unique SKU within store
      // const skuExists = await prisma.product.findFirst({
      //   where: {
      //     sku: body.sku,
      //     storeId: body.storeId,
      //   },
      // })

      // if (skuExists) {
      //   return reply.code(409).send({
      //     error: 'SKU is already used by another product in this store.',
      //   })
      // }

      try {
        const created = await prisma.$transaction(async tx => {
          const product = await tx.product.create({
            data: {
              sku: body.sku,
              title: body.title,
              slug: body.slug,
              description: body.description ?? null,
              priceCents: body.priceCents,
              previousPriceCents: body.previousPriceCents ?? null,

              purchasePriceCents: body.purchasePriceCents ?? 0,
              pageView: body.pageView ?? 0,
              inCart: body.inCart ?? 0,
              totalUnitsSold: body.totalUnitsSold ?? 0,
              totalRevenueCents: body.totalRevenueCents ?? 0,

              currency: body.currency,
              stock: body.stock,
              featured: body.featured,
              thumbnailUrl: body.thumbnailUrl ?? null,
              galleryUrls: body.galleryUrls ?? [],
              // 👇 keep required JSON `images` in sync with galleryUrls
              images: body.galleryUrls ?? [],
              videoUrl: body.videoUrl ?? null,
              videoPosterUrl: body.videoPosterUrl ?? null,
              features: body.features ?? null,
              note: body.note ?? null,
              optionsJson: body.optionsJson ?? [],
              storeId: body.storeId
            }
          })

          if (body.categoryIds && body.categoryIds.length > 0) {
            await tx.productCategory.createMany({
              data: body.categoryIds.map(categoryId => ({
                productId: product.id,
                categoryId
              }))
            })
          }

          return tx.product.findUnique({
            where: { id: product.id },
            include: {
              categories: { include: { category: true } },
              store: true
            }
          })
        })

        return reply.code(201).send(created)
      } catch (err) {
        console.error('POST /products failed', err)
        return reply.code(500).send({ error: 'Create failed' })
      }
    }
  )

  /* ---------- Update product (admin only) ---------- */
  app.put(
    '/products/:id',
    { preHandler: (app as any).admin },
    async (req: AdminRequest, reply) => {
      const id = (req.params as any).id as string
      const body = productUpdateDto.parse(req.body)

      const user = req.user
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      try {
        const updated = await prisma.$transaction(async tx => {
          const existing = await tx.product.findUnique({
            where: { id }
          })

          if (!existing) {
            throw new Error('NOT_FOUND')
          }

          // Security: ensure the admin owns this store
          if (!user.storeId || user.storeId !== existing.storeId) {
            throw new Error('FORBIDDEN')
          }

          const data: any = { ...body }

          // Ensure we don't send categoryIds directly to Product
          if (data.categoryIds) {
            delete data.categoryIds
          }

          // Keep JSON fields in sync
          if (Array.isArray(body.galleryUrls)) {
            data.galleryUrls = body.galleryUrls
            data.images = body.galleryUrls
          }

          const product = await tx.product.update({
            where: { id },
            data
          })

          // Replace categories if new categoryIds provided
          if (body.categoryIds) {
            // Delete existing links
            await tx.productCategory.deleteMany({
              where: { productId: id }
            })

            if (body.categoryIds.length > 0) {
              await tx.productCategory.createMany({
                data: body.categoryIds.map(categoryId => ({
                  productId: id,
                  categoryId
                }))
              })
            }
          }

          return tx.product.findUnique({
            where: { id: product.id },
            include: {
              categories: { include: { category: true } },
              store: true
            }
          })
        })

        return reply.send(updated)
      } catch (err: any) {
        console.error('PUT /products/:id failed', id, err)

        if (err.message === 'NOT_FOUND') {
          return reply.code(404).send({ error: 'Product not found' })
        }

        if (err.message === 'FORBIDDEN') {
          return reply
            .code(403)
            .send({ error: 'You do not own this product/store.' })
        }

        return reply.code(500).send({ error: 'Update failed' })
      }
    }
  )

  /* ---------- Delete product (admin only) ---------- */
  app.delete(
    '/products/:id',
    { preHandler: (app as any).admin },
    async (req, reply) => {
      const id = (req.params as any).id as string

      try {
        // Load product media URLs before deleting
        const product = await prisma.product.findUnique({
          where: { id },
          select: {
            thumbnailUrl: true,
            galleryUrls: true,
            videoUrl: true,
            videoPosterUrl: true
          }
        })

        if (!product) {
          return reply.code(404).send({ error: 'Product not found' })
        }

        const urlsToDelete: string[] = []

        if (product.thumbnailUrl) {
          urlsToDelete.push(product.thumbnailUrl)
        }

        if (Array.isArray(product.galleryUrls)) {
          urlsToDelete.push(...(product.galleryUrls as string[]))
        }

        if (product.videoPosterUrl) {
          urlsToDelete.push(product.videoPosterUrl)
        }

        if (product.videoUrl) {
          urlsToDelete.push(product.videoUrl)
        }

        if (urlsToDelete.length > 0) {
          try {
            await deleteObjectsByUrls(urlsToDelete)
          } catch (err) {
            // Log but do not block DB deletion
            console.error('Failed to delete S3 media for product', id, err)
          }
        }

        // ProductCategory rows will cascade delete (onDelete: Cascade on product)
        await prisma.product.delete({ where: { id } })
        return reply.code(204).send()
      } catch (err) {
        console.error('DELETE /products/:id failed', id, err)
        return reply.code(500).send({ error: 'Delete failed' })
      }
    }
  )

  // ---------- Delete a single gallery image by URL and update DB ----------
  app.delete(
    '/products/:id/images',
    { preHandler: (app as any).admin },
    async (req, reply) => {
      const id = (req.params as any).id as string
      const { imageUrl } = req.body as { imageUrl?: string }

      if (!imageUrl) {
        return reply.code(400).send({ error: 'imageUrl is required' })
      }

      try {
        const product = await prisma.product.findUnique({
          where: { id },
          select: { galleryUrls: true }
        })

        if (!product) {
          return reply.code(404).send({ error: 'Product not found' })
        }

        const existingGallery = Array.isArray(product.galleryUrls)
          ? (product.galleryUrls as string[])
          : []

        const updatedGallery = existingGallery.filter(url => url !== imageUrl)

        // Delete from S3 (best-effort)
        try {
          await deleteObjectByUrl(imageUrl)
        } catch (err) {
          console.error(
            'Failed to delete single S3 image for product',
            id,
            imageUrl,
            err
          )
        }

        const updated = await prisma.product.update({
          where: { id },
          data: {
            galleryUrls: updatedGallery,
            images: updatedGallery
          },
          include: {
            categories: { include: { category: true } },
            store: true
          }
        })

        return reply.send(updated)
      } catch (err) {
        console.error('DELETE /products/:id/images failed', id, err)
        return reply.code(500).send({ error: 'Failed to delete image' })
      }
    }
  )

  /* ---------- Update product active/draft status (admin only) ---------- */
  app.patch(
    '/products/:id/status',
    { preHandler: (app as any).admin },
    async (req, reply) => {
      const id = (req.params as any).id as string

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
