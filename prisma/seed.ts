// prisma/seed.ts
import { PrismaClient, Role, OrderStatus } from '@prisma/client';
const bcrypt = require('@node-rs/bcrypt'); // ✅ use require() in CJS

const prisma = new PrismaClient();

const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

function randomDayInMonth(year: number, month: number) {
  const d = Math.floor(Math.random() * 27) + 1;
  const h = Math.floor(Math.random() * 23);
  const m = Math.floor(Math.random() * 59);
  return new Date(year, month, d, h, m);
}

async function main() {
  // 1️⃣ Admin user
  await prisma.user.upsert({
    where: { email: 'admin@shophikes.com' },
    update: {},
    create: {
      email: 'admin@shophikes.com',
      password: await bcrypt.hash('ChangeThisPwd!', 12),
      role: Role.ADMIN,
    },
  });

  // 2️⃣ Products
  const titles = [
    'Trail Runner Shoes',
    'Compact Travel Backpack',
    'Wireless Earbuds Pro',
    'Insulated Water Bottle',
    '4K Action Camera',
    'Minimalist Wallet',
  ];

  const products = await Promise.all(
    titles.map((t, i) =>
      prisma.product.upsert({
        where: { sku: `SKU-${1000 + i}` },
        update: {},
        create: {
          sku: `SKU-${1000 + i}`,
          title: t,
          slug: slugify(t),
          description: `${t} — premium build, great reviews.`,
          priceCents: 3900 + i * 500,
          currency: 'USD',
          stock: 50 + i * 10,
          images: [],
          active: true,
        },
      })
    )
  );

  // 3️⃣ Customers
  const customers = [];
  for (let i = 0; i < 20; i++) {
    const c = await prisma.user.upsert({
      where: { email: `customer${i + 1}@example.com` },
      update: {},
      create: {
        email: `customer${i + 1}@example.com`,
        password: await bcrypt.hash('demo1234', 10),
        role: Role.CUSTOMER,
      },
    });
    customers.push(c);
  }

  // 4️⃣ Orders (last 12 months)
  const now = new Date();
  for (let m = 11; m >= 0; m--) {
    const ref = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const year = ref.getFullYear();
    const month = ref.getMonth();
    const ordersThisMonth = 8 + Math.floor(Math.random() * 7);

    for (let k = 0; k < ordersThisMonth; k++) {
      const user = pick(customers);
      const itemsCount = 1 + Math.floor(Math.random() * 3);
      const createdAt = randomDayInMonth(year, month);
      const items = Array.from({ length: itemsCount }).map(() => {
        const p = pick(products);
        const qty = 1 + Math.floor(Math.random() * 2);
        return { productId: p.id, qty, priceCents: p.priceCents };
      });

      const subtotalCents = items.reduce((a, i) => a + i.priceCents * i.qty, 0);
      const shippingCents = subtotalCents > 10000 ? 0 : 599;
      const taxCents = Math.round(subtotalCents * 0.075);
      const totalCents = subtotalCents + shippingCents + taxCents;

      await prisma.order.create({
        data: {
          userId: user.id,
          status: pick([OrderStatus.PAID, OrderStatus.FULFILLED, OrderStatus.PENDING]),
          subtotalCents,
          shippingCents,
          taxCents,
          totalCents,
          createdAt,
          items: {
            create: items.map(i => ({
              productId: i.productId,
              qty: i.qty,
              priceCents: i.priceCents,
            })),
          },
        },
      });
    }
  }

  console.log('✅ Seed complete');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
