import { FastifyInstance } from 'fastify';
import { prisma } from '../utils/prisma';
import { startOfMonth, subMonths, format } from 'date-fns';

export default async function dashboardRoutes(app: FastifyInstance) {
  // KPIs (top four cards)
  app.get('/dashboard/kpis', { preHandler: (app as any).admin }, async () => {
    const [orders, revenue, products, users] = await Promise.all([
      prisma.order.count(),
      prisma.order.aggregate({ _sum: { totalCents: true } }),
      prisma.product.count(),
      prisma.user.count(),
    ]);
    const revenueCents = revenue._sum.totalCents ?? 0;
    const profitCents = Math.round(revenueCents * 0.3); // demo 30% margin
    return { views: 3500, profitCents, products, users };
  });

  // Payments overview (12 months line chart)
  app.get('/dashboard/payments', { preHandler: (app as any).admin }, async () => {
    const months = Array.from({ length: 12 }).map((_, i) =>
      subMonths(startOfMonth(new Date()), i)
    ).reverse();

    const data = [];
    for (const d of months) {
      const month = d.getMonth();
      const year = d.getFullYear();
      const orders = await prisma.order.findMany({
        where: {
          createdAt: { gte: new Date(year, month, 1), lt: new Date(year, month + 1, 1) },
        },
        select: { totalCents: true },
      });
      const revenue = orders.reduce((a, c) => a + c.totalCents, 0);
      data.push({ label: format(d, 'MMM'), sales: Math.round(revenue / 10000), revenue });
    }
    return data;
  });

  // Profit this week (bar chart)
  app.get('/dashboard/profit-week', { preHandler: (app as any).admin }, async () => {
    const days = Array.from({ length: 7 }).map(
      (_, i) => new Date(Date.now() - (6 - i) * 24 * 3600 * 1000)
    );
    const res = [];
    for (const d of days) {
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      const orders = await prisma.order.findMany({
        where: { createdAt: { gte: start, lt: end } },
        select: { totalCents: true },
      });
      const revenue = orders.reduce((a, c) => a + c.totalCents, 0);
      res.push({ day: format(d, 'EEE'), sales: Math.round(revenue / 10000), revenue });
    }
    return res;
  });

  // Used devices (donut chart)
  app.get('/dashboard/devices', { preHandler: (app as any).admin }, async () => {
    return [
      { name: 'Desktop', value: 65 },
      { name: 'Mobile', value: 25 },
      { name: 'Tablet', value: 7 },
      { name: 'Other', value: 3 },
    ];
  });

  // Region labels (mini map data)
  app.get('/dashboard/regions', { preHandler: (app as any).admin }, async () => {
    return [
      { code: 'CA', value: 120 },
      { code: 'TX', value: 95 },
      { code: 'NY', value: 90 },
      { code: 'FL', value: 80 },
      { code: 'WA', value: 60 },
      { code: 'IL', value: 55 },
      { code: 'GA', value: 45 },
      { code: 'MA', value: 40 },
    ];
  });
}
