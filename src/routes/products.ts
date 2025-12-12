// src/routes/products.ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { pageParams } from '../utils/pagination'
import { deleteObjectByUrl, deleteObjectsByUrls } from '../utils/s3util'
import type { Prisma } from '@prisma/client'

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
  categoryIds: z.array(z.string()).optional().default([])
  // storeId is NOT accepted from the client – we trust req.user.storeId
})

// for partial updates
const productUpdateDto = productDto.partial()

export default async function productsRoutes (app: FastifyInstance) {
  /* ------------------------------------------------------------------
   * GET /products  (admin, multi-tenant, paginated, with filters)
   * ------------------------------------------------------------------ */
  app.get(
    '/products',
    { preHandler: app.admin },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { skip, limit } = pageParams(req)
      const query = req.query as any
      const take = limit

      const user = req.user
      if (!user?.storeId) {
        // In this version, only store-bound admins use this route
        return reply
          .code(401)
          .send({ error: 'Unauthorized or missing store for this user.' })
      }

      // Strongly-typed where, scoped to this store
      const where: Prisma.ProductWhereInput = {
        storeId: user.storeId
      }

      /* ---------- Text search ---------- */
      const qRaw = query.q
      const q =
        typeof qRaw === 'string' ? qRaw.trim() : qRaw?.toString().trim()

      if (q) {
        where.OR = [
          { title: { contains: q, mode: 'insensitive' } },
          { sku: { contains: q, mode: 'insensitive' } },
          { slug: { contains: q, mode: 'insensitive' } }
        ]
      }

      /* ---------- Category filter (optional) ---------- */
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

      /* ---------- Price filter (optional) ---------- */
      const minRaw = query.minPrice
      const maxRaw = query.maxPrice

      const minPrice =
        minRaw != null && minRaw !== ''
          ? Number(
              typeof minRaw === 'string' ? minRaw : minRaw.toString()
            )
          : undefined

      const maxPrice =
        maxRaw != null && maxRaw !== ''
          ? Number(
              typeof maxRaw === 'string' ? maxRaw : maxRaw.toString()
            )
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

      /* ---------- Query DB ---------- */
      const findManyArgs: Prisma.ProductFindManyArgs = {
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          categories: {
            include: {
              category: true
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
    }
  )

  /* ------------------------------------------------------------------
   * GET /products/:id  (admin-only, multi-tenant)
   * ------------------------------------------------------------------ */
  app.get(
    '/products/:id',
    { preHandler: app.admin },
    async (req: FastifyRequest, reply: FastifyReply) => {
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

      const user = req.user
      // Tenant isolation: admin must own the store
      if (user?.storeId && product.storeId !== user.storeId) {
        return reply
          .code(403)
          .send({ error: 'You do not own this product/store.' })
      }

      return reply.send(product)
    }
  )

  /* ------------------------------------------------------------------
   * GET /products/slug/:slug  (public storefront, no auth)
   * ------------------------------------------------------------------ */
  app.get(
    '/products/slug/:slug',
    async (req: FastifyRequest, reply: FastifyReply) => {
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
    }
  )

  /* ------------------------------------------------------------------
   * POST /products  (admin-only, multi-tenant)
   * ------------------------------------------------------------------ */
  app.post(
    '/products',
    { preHandler: app.admin },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = productDto.parse(req.body)
      const user = req.user

      if (!user || !user.storeId) {
        return reply.code(401).send({ error: 'Unauthorized or missing store' })
      }

      const storeId = user.storeId

      // Optional: verify store exists
      const store = await prisma.store.findUnique({
        where: { id: storeId },
        select: { id: true }
      })

      if (!store) {
        return reply.code(404).send({ error: 'Store not found' })
      }

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
              images: body.galleryUrls ?? [], // keep JSON images in sync
              videoUrl: body.videoUrl ?? null,
              videoPosterUrl: body.videoPosterUrl ?? null,
              features: body.features ?? null,
              note: body.note ?? null,
              optionsJson: body.optionsJson ?? [],

              // multi-tenant ownership
              storeId
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
        req.log.error({ err }, 'POST /products failed')
        return reply.code(500).send({ error: 'Create failed' })
      }
    }
  )

  /* ------------------------------------------------------------------
   * PUT /products/:id  (admin-only, multi-tenant)
   * ------------------------------------------------------------------ */
  app.put(
    '/products/:id',
    { preHandler: app.admin },
    async (req: FastifyRequest, reply: FastifyReply) => {
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

          // Tenant isolation
          if (!user.storeId || user.storeId !== existing.storeId) {
            throw new Error('FORBIDDEN')
          }

          const data: any = { ...body }

          // Never allow storeId to be changed via this API
          if (data.storeId) {
            delete data.storeId
          }

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
        req.log.error({ err, id }, 'PUT /products/:id failed')

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

  /* ------------------------------------------------------------------
   * DELETE /products/:id  (admin-only, multi-tenant)
   * ------------------------------------------------------------------ */
  app.delete(
    '/products/:id',
    { preHandler: app.admin },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const id = (req.params as any).id as string
      const user = req.user

      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      try {
        // Load product media URLs + store before deleting
        const product = await prisma.product.findUnique({
          where: { id },
          select: {
            storeId: true,
            thumbnailUrl: true,
            galleryUrls: true,
            videoUrl: true,
            videoPosterUrl: true
          }
        })

        if (!product) {
          return reply.code(404).send({ error: 'Product not found' })
        }

        if (!user.storeId || user.storeId !== product.storeId) {
          return reply
            .code(403)
            .send({ error: 'You do not own this product/store.' })
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
            req.log.error(
              { err, id },
              'Failed to delete S3 media for product'
            )
          }
        }

        await prisma.product.delete({ where: { id } })
        return reply.code(204).send()
      } catch (err) {
        req.log.error({ err, id }, 'DELETE /products/:id failed')
        return reply.code(500).send({ error: 'Delete failed' })
      }
    }
  )

  /* ------------------------------------------------------------------
   * DELETE /products/:id/images  (admin-only, delete single gallery image)
   * ------------------------------------------------------------------ */
  app.delete(
    '/products/:id/images',
    { preHandler: app.admin },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const id = (req.params as any).id as string
      const { imageUrl } = req.body as { imageUrl?: string }

      if (!imageUrl) {
        return reply.code(400).send({ error: 'imageUrl is required' })
      }

      const user = req.user
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      try {
        const product = await prisma.product.findUnique({
          where: { id },
          select: { storeId: true, galleryUrls: true }
        })

        if (!product) {
          return reply.code(404).send({ error: 'Product not found' })
        }

        if (!user.storeId || user.storeId !== product.storeId) {
          return reply
            .code(403)
            .send({ error: 'You do not own this product/store.' })
        }

        const existingGallery = Array.isArray(product.galleryUrls)
          ? (product.galleryUrls as string[])
          : []

        const updatedGallery = existingGallery.filter(url => url !== imageUrl)

        // Best-effort delete from S3
        try {
          await deleteObjectByUrl(imageUrl)
        } catch (err) {
          req.log.error(
            { err, id, imageUrl },
            'Failed to delete single S3 image for product'
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
        req.log.error({ err, id }, 'DELETE /products/:id/images failed')
        return reply.code(500).send({ error: 'Failed to delete image' })
      }
    }
  )

  /* ------------------------------------------------------------------
   * PATCH /products/:id/status  (admin-only, toggle active/draft)
   * ------------------------------------------------------------------ */
  app.patch(
    '/products/:id/status',
    { preHandler: app.admin },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const id = (req.params as any).id as string

      const body = req.body as any
      const active = typeof body?.active === 'boolean' ? body.active : null

      if (active === null) {
        return reply
          .code(400)
          .send({ error: "Missing or invalid 'active' boolean" })
      }

      const user = req.user
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      try {
        const existing = await prisma.product.findUnique({
          where: { id },
          select: { storeId: true }
        })

        if (!existing) {
          return reply.code(404).send({ error: 'Product not found' })
        }

        if (!user.storeId || user.storeId !== existing.storeId) {
          return reply
            .code(403)
            .send({ error: 'You do not own this product/store.' })
        }

        const updated = await prisma.product.update({
          where: { id },
          data: { active }
        })

        return reply.send(updated)
      } catch (err) {
        req.log.error({ err, id }, 'PATCH /products/:id/status failed')
        return reply.code(500).send({ error: 'Failed to update status' })
      }
    }
  )
}
