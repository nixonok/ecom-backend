import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { deleteObjectByUrl } from '../utils/s3util'

// --------- Zod schemas ---------
const categoryCreateDto = z.object({
  title: z.string().min(1, 'Title is required'),
  slug: z.string().min(1, 'Slug is required'),
  description: z.string().optional(),
  iconUrl: z.string().url().optional().nullable()
})

const categoryUpdateDto = categoryCreateDto.partial()

// For attached admin info in preHandler
type AdminRequest = FastifyRequest & {
  user?: {
    id: string
    role: 'ADMIN' | 'STAFF'
    storeId: string | null
  }
}

export default async function categoriesRoutes(app: FastifyInstance) {
  // --------- GET /categories with optional search ---------
  app.get('/categories', async (req, reply) => {
    const q = (req.query as any).q as string | undefined

    const where = q
      ? {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { slug: { contains: q, mode: 'insensitive' } }
          ]
        }
      : {}

    const categories = await prisma.category.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    })

    return reply.send(categories)
  })

  // --------- GET /categories/:id ---------
  app.get('/categories/:id', async (req, reply) => {
    const id = (req.params as any).id as string

    const category = await prisma.category.findUnique({
      where: { id }
    })

    if (!category) {
      return reply.code(404).send({ error: 'Category not found' })
    }

    return reply.send(category)
  })

  // --------- POST /categories ---------
  app.post(
    '/categories',
    { preHandler: (app as any).admin },
    async (req: AdminRequest, reply: FastifyReply) => {
      const user = req.user
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      const body = categoryCreateDto.parse(req.body)

      try {
        const created = await prisma.category.create({
          data: {
            title: body.title,
            slug: body.slug,
            description: body.description ?? null,
            iconUrl: body.iconUrl ?? null
          }
        })

        return reply.code(201).send(created)
      } catch (err: any) {
        console.error('Create category error:', err)

        if (err.code === 'P2002') {
          return reply.code(409).send({ error: 'Slug already exists' })
        }

        return reply.code(500).send({ error: 'Internal server error' })
      }
    }
  )

  // --------- PUT /categories/:id ---------
  app.put(
    '/categories/:id',
    { preHandler: (app as any).admin },
    async (req: AdminRequest, reply: FastifyReply) => {
      const id = (req.params as any).id as string
      const body = categoryUpdateDto.parse(req.body)

      try {
        const updated = await prisma.category.update({
          where: { id },
          data: {
            title: body.title,
            slug: body.slug,
            description: body.description ?? null,
            iconUrl: body.iconUrl ?? null
          }
        })

        return reply.send(updated)
      } catch (err: any) {
        console.error('Update category error:', err)

        if (err.code === 'P2002') {
          return reply.code(409).send({ error: 'Slug already exists' })
        }

        if (err.code === 'P2025') {
          return reply.code(404).send({ error: 'Category not found' })
        }

        return reply.code(500).send({ error: 'Internal server error' })
      }
    }
  )

  // --------- DELETE /categories/:id ---------
  app.delete(
    '/categories/:id',
    { preHandler: (app as any).admin },
    async (req: AdminRequest, reply: FastifyReply) => {
      const id = (req.params as any).id as string

      try {
        // Load the category first so we have the icon URL (if any)
        const category = await prisma.category.findUnique({
          where: { id },
          select: { iconUrl: true }
        })

        if (!category) {
          return reply.code(404).send({ error: 'Category not found' })
        }

        // Best-effort delete of icon from S3 before removing DB row
        if (category.iconUrl) {
          try {
            await deleteObjectByUrl(category.iconUrl)
          } catch (err) {
            console.error('Failed to delete S3 icon for category', id, err)
          }
        }

        await prisma.category.delete({ where: { id } })
        return reply.code(204).send()
      } catch (err: any) {
        console.error('Delete category error:', err)

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
