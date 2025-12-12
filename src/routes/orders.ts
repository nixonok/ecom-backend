// src/routes/orders.ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { pageParams } from '../utils/pagination'
import { OrderStatus, PaymentMethod } from '@prisma/client'
import type { Prisma } from '@prisma/client'

/* ---------------------- ZOD DTOs ---------------------- */

const orderItemDto = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPriceCents: z.number().int().nonnegative(),
  productTitle: z.string().min(1),
  productSku: z.string().min(1),
  productImageUrl: z.string().url().nullable().optional()
})

/**
 * For SUPER_ADMIN:
 *   - can optionally pass storeId to create an order for a specific store
 *
 * For ADMIN / STAFF:
 *   - storeId is ignored; we always use req.user.storeId
 */
const createOrderDto = z.object({
  orderNumber: z.string().min(1),
  customerName: z.string().min(1),
  phone: z.string().min(3),
  email: z.string().email().optional().nullable(),

  userId: z.string().optional().nullable(),
  storeId: z.string().min(1).optional(), // used only for SUPER_ADMIN

  // Address fields — optional
  streetAddress: z.string().optional().nullable(),
  division: z.string().optional().nullable(),
  district: z.string().optional().nullable(),
  upazila: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),

  customerNote: z.string().optional().nullable(),
  adminNote: z.string().optional().nullable(),

  subtotalCents: z.number().int().nonnegative(),
  deliveryCents: z.number().int().nonnegative().default(0),
  taxCents: z.number().int().nonnegative().default(0),
  totalCents: z.number().int().nonnegative(),
  currency: z.string().default('BDT'),

  status: z.nativeEnum(OrderStatus).optional(),

  paymentMethod: z.nativeEnum(PaymentMethod).default(PaymentMethod.COD),

  items: z.array(orderItemDto).min(1)
})

const updateOrderDto = z.object({
  customerName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().nullable(),

  streetAddress: z.string().optional().nullable(),
  division: z.string().optional().nullable(),
  district: z.string().optional().nullable(),
  upazila: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),

  customerNote: z.string().optional().nullable(),
  adminNote: z.string().optional().nullable(),

  deliveryCents: z.number().int().nonnegative().optional(),
  taxCents: z.number().int().nonnegative().optional(),
  totalCents: z.number().int().nonnegative().optional(),
  status: z.nativeEnum(OrderStatus).optional()
})

const statusPatchDto = z.object({
  status: z.nativeEnum(OrderStatus)
})

const storefrontOrderItemDto = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive()
})

const storefrontCreateOrderDto = z.object({
  customerName: z.string().min(1),
  phone: z.string().min(3),
  email: z.string().email().optional().nullable(),

  streetAddress: z.string().optional().nullable(),
  division: z.string().optional().nullable(),
  district: z.string().optional().nullable(),
  upazila: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),

  customerNote: z.string().optional().nullable(),

  // storefront can choose a delivery charge; tax usually 0 for you
  deliveryCents: z.number().int().nonnegative().default(0),
  taxCents: z.number().int().nonnegative().default(0),

  items: z.array(storefrontOrderItemDto).min(1)
})

/* ---------------------- ROUTES ---------------------- */

export default async function orderRoutes (app: FastifyInstance) {
  /* ---------- LIST ORDERS (admin, multi-tenant) ---------- */
  app.get(
    '/orders',
    { preHandler: app.admin },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      const { limit, skip } = pageParams(req)
      const query = req.query as any
      const qStatus = query.status as OrderStatus | undefined

      const where: Prisma.OrderWhereInput = {}

      // Multi-tenant scoping
      if (user.role === 'SUPER_ADMIN') {
        const storeIdQuery =
          typeof query.storeId === 'string' ? query.storeId.trim() : undefined
        if (storeIdQuery) {
          where.storeId = storeIdQuery
        }
      } else {
        if (!user.storeId) {
          return reply
            .code(400)
            .send({ error: 'This user is not associated with a store.' })
        }
        where.storeId = user.storeId
      }

      if (qStatus) {
        where.status = qStatus
      }

      const [items, total] = await Promise.all([
        prisma.order.findMany({
          where,
          take: limit,
          skip,
          orderBy: { createdAt: 'desc' },
          include: {
            items: true,
            user: { select: { email: true } }
          }
        }),
        prisma.order.count({ where })
      ])

      return reply.send({ total, items })
    }
  )

  /* ---------- GET SINGLE ORDER (admin, multi-tenant) ---------- */
  app.get(
    '/orders/:id',
    { preHandler: app.admin },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      const id = (req.params as any).id as string

      const order = await prisma.order.findUnique({
        where: { id },
        include: {
          items: true,
          user: { select: { email: true } }
        }
      })

      if (!order) {
        return reply.code(404).send({ error: 'Order not found' })
      }

      // Multi-tenant access control
      if (user.role !== 'SUPER_ADMIN') {
        if (!user.storeId || user.storeId !== order.storeId) {
          return reply
            .code(403)
            .send({ error: 'You do not own this order/store.' })
        }
      }

      return reply.send(order)
    }
  )

  /* ---------- CREATE ORDER (admin, multi-tenant) ---------- */
  app.post(
    '/orders',
    { preHandler: app.admin },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      const body = createOrderDto.parse(req.body)

      // Determine storeId
      let storeId: string

      if (user.role === 'SUPER_ADMIN') {
        if (!body.storeId) {
          return reply
            .code(400)
            .send({ error: 'SUPER_ADMIN must provide storeId for order.' })
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

      const computedSubtotal = body.items.reduce(
        (sum, it) => sum + it.unitPriceCents * it.quantity,
        0
      )

      const subtotalCents = body.subtotalCents || computedSubtotal
      const totalCents =
        body.totalCents ?? subtotalCents + body.deliveryCents + body.taxCents

      const created = await prisma.$transaction(async tx => {
        return tx.order.create({
          data: {
            orderNumber: body.orderNumber,
            customerName: body.customerName,
            phone: body.phone,
            email: body.email,

            userId: body.userId ?? null,
            storeId,

            streetAddress: body.streetAddress,
            division: body.division,
            district: body.district,
            upazila: body.upazila,
            city: body.city,
            postalCode: body.postalCode,

            customerNote: body.customerNote,
            adminNote: body.adminNote,

            status: body.status ?? OrderStatus.PENDING,
            paymentMethod: body.paymentMethod,

            subtotalCents,
            deliveryCents: body.deliveryCents,
            taxCents: body.taxCents,
            totalCents,
            currency: body.currency,

            items: {
              create: body.items.map(it => ({
                productId: it.productId,
                quantity: it.quantity,
                unitPriceCents: it.unitPriceCents,
                lineTotalCents: it.unitPriceCents * it.quantity,
                productTitle: it.productTitle,
                productSku: it.productSku,
                productImageUrl: it.productImageUrl ?? null
              }))
            }
          },
          include: { items: true }
        })
      })

      return reply.code(201).send(created)
    }
  )

  /* ---------- CREATE ORDER FROM STOREFRONT (public, multi-tenant) ---------- */
  app.post('/storefront/orders', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = storefrontCreateOrderDto.parse(req.body)

    // 1) Load products and ensure they all exist
    const productIds = body.items.map(it => it.productId)

    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        sku: true,
        title: true,
        priceCents: true,
        thumbnailUrl: true,
        storeId: true,
        currency: true
      }
    })

    if (products.length !== productIds.length) {
      return reply
        .code(400)
        .send({ error: 'One or more products no longer exist' })
    }

    // Ensure all products belong to the same store (multi-tenant safety)
    const storeIds = new Set(products.map(p => p.storeId))
    if (storeIds.size > 1) {
      return reply
        .code(400)
        .send({ error: 'All products in an order must belong to the same store.' })
    }

    const productsById = new Map(products.map(p => [p.id, p]))

    // 2) Build order items with price + product metadata
    const itemCreates = body.items.map(it => {
      const p = productsById.get(it.productId)!
      const unitPriceCents = p.priceCents
      const lineTotalCents = unitPriceCents * it.quantity

      return {
        productId: it.productId,
        quantity: it.quantity,
        unitPriceCents,
        lineTotalCents,
        productTitle: p.title,
        productSku: p.sku,
        productImageUrl: p.thumbnailUrl ?? null
      }
    })

    const subtotalCents = itemCreates.reduce(
      (sum, it) => sum + it.lineTotalCents,
      0
    )

    const deliveryCents = body.deliveryCents ?? 0
    const taxCents = body.taxCents ?? 0
    const totalCents = subtotalCents + deliveryCents + taxCents

    // 3) Get storeId + currency from the first product
    const firstProduct = products[0]
    const storeId = firstProduct.storeId
    const currency = firstProduct.currency || 'BDT'

    // 4) Generate orderNumber (simple but unique-enough)
    const now = new Date()
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, '')
    const randomPart = Math.floor(1000 + Math.random() * 9000)
    const orderNumber = `ORD-${datePart}-${randomPart}`

    // 5) Create order transaction
    const created = await prisma.order.create({
      data: {
        orderNumber,
        customerName: body.customerName,
        phone: body.phone,
        email: body.email,

        userId: null, // storefront anonymous
        storeId,

        streetAddress: body.streetAddress,
        division: body.division,
        district: body.district,
        upazila: body.upazila,
        city: body.city,
        postalCode: body.postalCode,

        customerNote: body.customerNote,
        adminNote: null,

        status: OrderStatus.PENDING,
        paymentMethod: PaymentMethod.COD,

        subtotalCents,
        deliveryCents,
        taxCents,
        totalCents,
        currency,

        items: {
          create: itemCreates
        }
      },
      include: { items: true }
    })

    return reply.code(201).send(created)
  })

  /* ---------- UPDATE ORDER (admin, multi-tenant) ---------- */
  app.put(
    '/orders/:id',
    { preHandler: app.admin },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      const id = (req.params as any).id as string
      const body = updateOrderDto.parse(req.body)

      try {
        const existing = await prisma.order.findUnique({
          where: { id },
          select: { storeId: true }
        })

        if (!existing) {
          return reply.code(404).send({ error: 'Order not found' })
        }

        if (user.role !== 'SUPER_ADMIN') {
          if (!user.storeId || user.storeId !== existing.storeId) {
            return reply
              .code(403)
              .send({ error: 'You do not own this order/store.' })
          }
        }

        const updated = await prisma.order.update({
          where: { id },
          data: {
            customerName: body.customerName,
            phone: body.phone,
            email: body.email,

            streetAddress: body.streetAddress,
            division: body.division,
            district: body.district,
            upazila: body.upazila,
            city: body.city,
            postalCode: body.postalCode,

            customerNote: body.customerNote,
            adminNote: body.adminNote,

            deliveryCents: body.deliveryCents,
            taxCents: body.taxCents,
            totalCents: body.totalCents,
            status: body.status
          },
          include: { items: true }
        })

        return reply.send(updated)
      } catch (err) {
        req.log.error({ err, id }, 'PUT /orders/:id failed')
        return reply.code(500).send({ error: 'Update failed' })
      }
    }
  )

  /* ---------- DELETE ORDER (admin, multi-tenant) ---------- */
  app.delete(
    '/orders/:id',
    { preHandler: app.admin },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      const id = (req.params as any).id as string

      try {
        const existing = await prisma.order.findUnique({
          where: { id },
          select: { storeId: true }
        })

        if (!existing) {
          return reply.code(404).send({ error: 'Order not found' })
        }

        if (user.role !== 'SUPER_ADMIN') {
          if (!user.storeId || user.storeId !== existing.storeId) {
            return reply
              .code(403)
              .send({ error: 'You do not own this order/store.' })
          }
        }

        await prisma.order.delete({ where: { id } })
        return reply.code(204).send()
      } catch (err) {
        req.log.error({ err, id }, 'DELETE /orders/:id failed')
        return reply.code(500).send({ error: 'Delete failed' })
      }
    }
  )

  /* ---------- PATCH STATUS (admin, multi-tenant) ---------- */
  app.patch(
    '/orders/:id/status',
    { preHandler: app.admin },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      const id = (req.params as any).id as string
      const body = statusPatchDto.parse(req.body)

      try {
        const existing = await prisma.order.findUnique({
          where: { id },
          select: { storeId: true }
        })

        if (!existing) {
          return reply.code(404).send({ error: 'Order not found' })
        }

        if (user.role !== 'SUPER_ADMIN') {
          if (!user.storeId || user.storeId !== existing.storeId) {
            return reply
              .code(403)
              .send({ error: 'You do not own this order/store.' })
          }
        }

        const updated = await prisma.order.update({
          where: { id },
          data: { status: body.status }
        })

        return reply.send(updated)
      } catch (err) {
        req.log.error({ err, id }, 'PATCH /orders/:id/status failed')
        return reply.code(500).send({ error: 'Status update failed' })
      }
    }
  )

  // Public endpoint: storefront customers can see their order status by orderNumber
  app.get('/storefront/orders/:orderNumber', async (req: FastifyRequest, reply: FastifyReply) => {
    const { orderNumber } = (req.params as any) as { orderNumber: string }

    const order = await prisma.order.findFirst({
      where: { orderNumber },
      select: {
        orderNumber: true,
        status: true,
        totalCents: true
      }
    })

    if (!order) {
      return reply.code(404).send({ error: 'Order not found' })
    }

    return reply.send({
      orderNumber: order.orderNumber,
      status: order.status,
      totalCents: order.totalCents
    })
  })

  /* ---------- PUBLIC: TRACK ORDER BY ORDER NUMBER (detailed) ---------- */
  app.get('/orders/track/:orderNumber', async (req: FastifyRequest, reply: FastifyReply) => {
    const orderNumber = (req.params as any).orderNumber as string

    try {
      const order = await prisma.order.findFirst({
        where: { orderNumber },
        select: {
          orderNumber: true,
          status: true,
          createdAt: true,

          customerName: true,
          phone: true,

          streetAddress: true,
          division: true,
          district: true,
          upazila: true,
          city: true,
          postalCode: true,

          deliveryCents: true,
          subtotalCents: true,
          taxCents: true,
          totalCents: true,
          currency: true,

          items: {
            select: {
              id: true,
              productId: true,
              productTitle: true,
              productSku: true,
              productImageUrl: true,
              quantity: true,
              unitPriceCents: true,
              lineTotalCents: true
            }
          }
        }
      })

      if (!order) {
        return reply.code(404).send({ error: 'Order not found' })
      }

      return reply.send(order)
    } catch (err) {
      ;(req as any).log?.error?.({ err, orderNumber }, 'GET /orders/track error')
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })
}
