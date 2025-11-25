// src/routes/orders.ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../utils/prisma";
import { pageParams } from "../utils/pagination";
import {
  OrderStatus,
  PaymentMethod,
} from "@prisma/client";

/* ---------------------- ZOD DTOs ---------------------- */

const orderItemDto = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPriceCents: z.number().int().nonnegative(),
  productTitle: z.string().min(1),
  productSku: z.string().min(1),
  productImageUrl: z.string().url().nullable().optional(),
});

const createOrderDto = z.object({
  orderNumber: z.string().min(1),
  customerName: z.string().min(1),
  phone: z.string().min(3),
  email: z.string().email().optional().nullable(),

  userId: z.string().optional().nullable(),
  storeId: z.string().min(1),

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
  currency: z.string().default("BDT"),

  status: z.nativeEnum(OrderStatus).optional(),

  paymentMethod: z.nativeEnum(PaymentMethod).default(PaymentMethod.COD),

  items: z.array(orderItemDto).min(1),
});

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
  status: z.nativeEnum(OrderStatus).optional(),
});

const statusPatchDto = z.object({
  status: z.nativeEnum(OrderStatus),
});

/* ---------------------- ROUTES ---------------------- */

export default async function orderRoutes(app: FastifyInstance) {
  /* ---------- LIST ORDERS ---------- */
  app.get(
    "/orders",
    { preHandler: (app as any).admin },
    async (req, reply) => {
      const { limit, skip } = pageParams(req.query as any);
      const qStatus = (req.query as any).status as OrderStatus | undefined;
      const where: any = {};

      if (qStatus) where.status = qStatus;

      const [items, total] = await Promise.all([
        prisma.order.findMany({
          where,
          take: limit,
          skip,
          orderBy: { createdAt: "desc" },
          include: {
            items: true,
            user: { select: { email: true } },
          },
        }),
        prisma.order.count({ where }),
      ]);

      return reply.send({ total, items });
    }
  );

  /* ---------- GET SINGLE ORDER ---------- */
  app.get(
    "/orders/:id",
    { preHandler: (app as any).admin },
    async (req, reply) => {
      const id = (req.params as any).id as string;

      const order = await prisma.order.findUnique({
        where: { id },
        include: {
          items: true,
          user: { select: { email: true } },
        },
      });

      if (!order) return reply.code(404).send({ error: "Order not found" });

      return reply.send(order);
    }
  );

  /* ---------- CREATE ORDER ---------- */
  app.post(
    "/orders",
    { preHandler: (app as any).admin },
    async (req, reply) => {
      const body = createOrderDto.parse(req.body);

      const computedSubtotal = body.items.reduce(
        (sum, it) => sum + it.unitPriceCents * it.quantity,
        0
      );

      const subtotalCents = body.subtotalCents || computedSubtotal;

      const totalCents =
        body.totalCents ??
        subtotalCents + body.deliveryCents + body.taxCents;

      const created = await prisma.$transaction(async (tx) => {
        return tx.order.create({
          data: {
            orderNumber: body.orderNumber,
            customerName: body.customerName,
            phone: body.phone,
            email: body.email,

            userId: body.userId,
            storeId: body.storeId,

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
              create: body.items.map((it) => ({
                productId: it.productId,
                quantity: it.quantity,
                unitPriceCents: it.unitPriceCents,
                lineTotalCents: it.unitPriceCents * it.quantity,
                productTitle: it.productTitle,
                productSku: it.productSku,
                productImageUrl: it.productImageUrl ?? null,
              })),
            },
          },
          include: { items: true },
        });
      });

      return reply.code(201).send(created);
    }
  );

  /* ---------- UPDATE ORDER ---------- */
  app.put(
    "/orders/:id",
    { preHandler: (app as any).admin },
    async (req, reply) => {
      const id = (req.params as any).id as string;
      const body = updateOrderDto.parse(req.body);

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
          status: body.status,
        },
        include: { items: true },
      });

      return reply.send(updated);
    }
  );

  /* ---------- DELETE ORDER ---------- */
  app.delete(
    "/orders/:id",
    { preHandler: (app as any).admin },
    async (req, reply) => {
      const id = (req.params as any).id as string;

      try {
        await prisma.order.delete({ where: { id } });
        return reply.code(204).send();
      } catch (err) {
        console.error("DELETE /orders error:", err);
        return reply.code(500).send({ error: "Delete failed" });
      }
    }
  );

  /* ---------- PATCH STATUS ---------- */
  app.patch(
    "/orders/:id/status",
    { preHandler: (app as any).admin },
    async (req, reply) => {
      const id = (req.params as any).id as string;
      const body = statusPatchDto.parse(req.body);

      try {
        const updated = await prisma.order.update({
          where: { id },
          data: { status: body.status },
        });

        return reply.send(updated);
      } catch (err) {
        console.error("PATCH /orders/status error:", err);
        return reply.code(500).send({ error: "Status update failed" });
      }
    }
  );
}
