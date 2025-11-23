import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../utils/prisma'

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
  user?: { id: string; role: string; storeId?: string }
}

export default async function categoryRoutes (app: FastifyInstance) {
  // --------- GET /categories: List all ---------
  app.get('/categories', async (req, reply) => {
    const categories = await prisma.category.findMany({
      orderBy: { createdAt: 'desc' }
    })
    return reply.send(categories)
  })

  // --------- GET /categories/:id: Single category ---------
  app.get('/categories/:id', async (req, reply) => {
    const id = (req.params as any).id as string
    const category = await prisma.category.findUnique({ where: { id } })
    if (!category) {
      return reply.code(404).send({ error: 'Category not found' })
    }
    return reply.send(category)
  })

  // --------- POST /categories: Create new ---------
  app.post(
    '/categories',
    { preHandler: (app as any).admin },
    async (req: AdminRequest, reply: FastifyReply) => {
      let body
      try {
        body = categoryCreateDto.parse(req.body)
      } catch (err) {
        return reply.code(400).send({ error: 'Invalid data', details: err })
      }

      // Uniqueness check for slug
      const exists = await prisma.category.findUnique({
        where: { slug: body.slug }
      })
      if (exists) {
        return reply.code(409).send({ error: 'Slug already exists' })
      }

      const created = await prisma.category.create({
        data: {
          title: body.title,
          slug: body.slug,
          description: body.description,
          iconUrl: body.iconUrl ?? null
        }
      })

      return reply.code(201).send(created)
    }
  )

  // --------- PUT /categories/:id: Update ---------
  app.put(
    '/categories/:id',
    { preHandler: (app as any).admin },
    async (req: AdminRequest, reply: FastifyReply) => {
      const id = (req.params as any).id as string
      let body
      try {
        body = categoryUpdateDto.parse(req.body)
      } catch (err) {
        return reply.code(400).send({ error: 'Invalid data', details: err })
      }

      // Check if updating the slug to a value another category already has
      if (body.slug) {
        const duplicate = await prisma.category.findFirst({
          where: { slug: body.slug, id: { not: id } }
        })
        if (duplicate) {
          return reply.code(409).send({ error: 'Slug already exists' })
        }
      }

      try {
        const updated = await prisma.category.update({
          where: { id },
          data: {
            ...(body.title && { title: body.title }),
            ...(body.slug && { slug: body.slug }),
            description: body.description,
            iconUrl: body.iconUrl ?? undefined
          }
        })
        return reply.send(updated)
      } catch (err) {
        return reply.code(404).send({ error: 'Category not found' })
      }
    }
  )

  // --------- DELETE /categories/:id: Delete ---------
  app.delete(
    '/categories/:id',
    { preHandler: (app as any).admin },
    async (req: AdminRequest, reply: FastifyReply) => {
      const id = (req.params as any).id as string

      try {
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
