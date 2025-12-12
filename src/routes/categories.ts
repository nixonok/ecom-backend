// src/routes/categories.ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { deleteObjectByUrl } from '../utils/s3util'
import type { Prisma } from '@prisma/client'

// --------- Zod schemas ---------

/**
 * For SUPER_ADMIN:
 *   - can optionally pass storeId in body to target a specific store
 *
 * For ADMIN / STAFF:
 *   - storeId in body is ignored; we always use req.user.storeId
 */
const categoryCreateDto = z.object({
  title: z.string().min(1, 'Title is required'),
  slug: z.string().min(1, 'Slug is required'),
  description: z.string().optional(),
  iconUrl: z.string().url().optional().nullable(),

  // Only meaningful for SUPER_ADMIN, ignored for normal admins
  storeId: z.string().min(1).optional()
})

// storeId cannot be updated via this route
const categoryUpdateDto = categoryCreateDto.omit({ storeId: true }).partial()

export default async function categoriesRoutes (app: FastifyInstance) {
  /* ------------------------------------------------------------------
   * GET /categories (admin, multi-tenant)
   * - ADMIN / STAFF: only categories for their store
   * - SUPER_ADMIN: can optionally filter with ?storeId=...
   * ----------------------------------------------------------------- */
  app.get(
    '/categories',
    { preHandler: app.admin },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      const query = req.query as any
      const q = typeof query.q === 'string' ? query.q.trim() : undefined
      const storeIdQuery =
        typeof query.storeId === 'string' ? query.storeId.trim() : undefined

      const where: Prisma.CategoryWhereInput = {}

      // Multi-tenant scoping
      if (user.role === 'SUPER_ADMIN') {
        // SUPER_ADMIN can see all categories or filter by storeId
        if (storeIdQuery) {
          where.storeId = storeIdQuery
        }
      } else {
        // Normal admins must belong to a store
        if (!user.storeId) {
          return reply
            .code(400)
            .send({ error: 'This user is not associated with a store.' })
        }
        where.storeId = user.storeId
      }

      // Optional text search
      if (q) {
        where.OR = [
          { title: { contains: q, mode: 'insensitive' } },
          { slug: { contains: q, mode: 'insensitive' } }
        ]
      }

      const categories = await prisma.category.findMany({
        where,
        orderBy: { createdAt: 'desc' }
      })

      return reply.send(categories)
    }
  )

  /* ------------------------------------------------------------------
   * GET /categories/:id  (admin, multi-tenant)
   * ----------------------------------------------------------------- */
  app.get(
    '/categories/:id',
    { preHandler: app.admin },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      const id = (req.params as any).id as string

      const category = await prisma.category.findUnique({
        where: { id }
      })

      if (!category) {
        return reply.code(404).send({ error: 'Category not found' })
      }

      // Multi-tenant access control
      if (user.role !== 'SUPER_ADMIN') {
        if (!user.storeId || user.storeId !== category.storeId) {
          return reply
            .code(403)
            .send({ error: 'You do not own this category/store.' })
        }
      }

      return reply.send(category)
    }
  )

  /* ------------------------------------------------------------------
   * POST /categories  (admin, multi-tenant)
   * ----------------------------------------------------------------- */
  app.post(
    '/categories',
    { preHandler: app.admin },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      const body = categoryCreateDto.parse(req.body)

      // Determine which store this category belongs to
      let storeId: string

      if (user.role === 'SUPER_ADMIN') {
        if (!body.storeId) {
          return reply
            .code(400)
            .send({ error: 'SUPER_ADMIN must provide storeId for category.' })
        }
        storeId = body.storeId
      } else {
        if (!user.storeId) {
          return reply
            .code(400)
            .send({ error: 'This user is not associated with a store.' })
        }
        storeId = user.storeId
      }

      try {
        const created = await prisma.category.create({
          data: {
            title: body.title,
            slug: body.slug,
            description: body.description ?? null,
            iconUrl: body.iconUrl ?? null,
            storeId
          }
        })

        return reply.code(201).send(created)
      } catch (err: any) {
        req.log.error({ err }, 'Create category error')

        if (err.code === 'P2002') {
          // Unique constraint ([storeId, slug])
          return reply
            .code(409)
            .send({ error: 'Slug already exists in this store.' })
        }

        return reply.code(500).send({ error: 'Internal server error' })
      }
    }
  )

  /* ------------------------------------------------------------------
   * PUT /categories/:id  (admin, multi-tenant)
   * ----------------------------------------------------------------- */
  app.put(
    '/categories/:id',
    { preHandler: app.admin },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      const id = (req.params as any).id as string
      const body = categoryUpdateDto.parse(req.body)

      try {
        const existing = await prisma.category.findUnique({
          where: { id }
        })

        if (!existing) {
          return reply.code(404).send({ error: 'Category not found' })
        }

        if (user.role !== 'SUPER_ADMIN') {
          if (!user.storeId || user.storeId !== existing.storeId) {
            return reply
              .code(403)
              .send({ error: 'You do not own this category/store.' })
          }
        }

        const updated = await prisma.category.update({
          where: { id },
          data: {
            title: body.title ?? existing.title,
            slug: body.slug ?? existing.slug,
            description:
              body.description !== undefined
                ? body.description
                : existing.description,
            iconUrl:
              body.iconUrl !== undefined ? body.iconUrl : existing.iconUrl
          }
        })

        return reply.send(updated)
      } catch (err: any) {
        req.log.error({ err, id }, 'Update category error')

        if (err.code === 'P2002') {
          return reply
            .code(409)
            .send({ error: 'Slug already exists in this store.' })
        }

        if (err.code === 'P2025') {
          return reply.code(404).send({ error: 'Category not found' })
        }

        return reply.code(500).send({ error: 'Internal server error' })
      }
    }
  )

  /* ------------------------------------------------------------------
   * DELETE /categories/:id  (admin, multi-tenant)
   * ----------------------------------------------------------------- */
  app.delete(
    '/categories/:id',
    { preHandler: app.admin },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      const id = (req.params as any).id as string

      try {
        const category = await prisma.category.findUnique({
          where: { id },
          select: { storeId: true, iconUrl: true }
        })

        if (!category) {
          return reply.code(404).send({ error: 'Category not found' })
        }

        if (user.role !== 'SUPER_ADMIN') {
          if (!user.storeId || user.storeId !== category.storeId) {
            return reply
              .code(403)
              .send({ error: 'You do not own this category/store.' })
          }
        }

        // Best-effort delete of S3 icon
        if (category.iconUrl) {
          try {
            await deleteObjectByUrl(category.iconUrl)
          } catch (err) {
            req.log.error(
              { err, id },
              'Failed to delete S3 icon for category'
            )
          }
        }

        await prisma.category.delete({ where: { id } })
        return reply.code(204).send()
      } catch (err: any) {
        req.log.error({ err, id }, 'Delete category error')

        if (err.code === 'P2003') {
          return reply
            .code(409)
            .send({ error: 'Category is in use by products' })
        }

        if (err.code === 'P2025') {
          return reply.code(404).send({ error: 'Category not found' })
        }

        return reply.code(500).send({ error: 'Internal server error' })
      }
    }
  )
}
