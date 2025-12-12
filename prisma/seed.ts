// prisma/seed.ts

import bcrypt from '@node-rs/bcrypt'
import { prisma } from '../src/utils/prisma'
import { Role } from '@prisma/client'

async function main() {
  // ─────────────────────────────────────────────
  // Passwords for local/dev testing ONLY
  // ─────────────────────────────────────────────
  const superAdminPassword = await bcrypt.hash('SuperAdmin123!', 12)
  const shop1AdminPassword = await bcrypt.hash('AdminShop1!', 12)
  const shop2AdminPassword = await bcrypt.hash('AdminShop2!', 12)

  // ─────────────────────────────────────────────
  // STORES (TENANTS)
  // ─────────────────────────────────────────────
  // Store 1: Shop Hikes
  const shopHikes = await prisma.store.upsert({
    where: { id: 'shophikes.com' }, // stable tenant id
    update: {},
    create: {
      id: 'shophikes.com',
      name: 'Shop Hikes',
      slug: 'shop-hikes',
    },
  })

  // Store 2: Second demo store
  const secondStore = await prisma.store.upsert({
    where: { id: 'secondstore.com' },
    update: {},
    create: {
      id: 'secondstore.com',
      name: 'Second Demo Store',
      slug: 'second-store',
    },
  })

  // ─────────────────────────────────────────────
  // SUPER ADMIN (Global, no store)
  // ─────────────────────────────────────────────
  // Login:
  //   email: superadmin@admin.com
  //   pass : SuperAdmin123!
  const superAdmin = await prisma.user.upsert({
    where: { email: 'super@admin.com' },
    update: {
      password: superAdminPassword,
      role: Role.SUPER_ADMIN,
      storeId: null, // 🔑 global, not bound to a single store
    },
    create: {
      email: 'super@admin.com',
      password: superAdminPassword,
      role: Role.SUPER_ADMIN,
      storeId: null,
    },
  })

  // ─────────────────────────────────────────────
  // STORE 1 ADMIN (bound to Shop Hikes)
  // ─────────────────────────────────────────────
  // Login:
  //   email: admin@shophikes.com
  //   pass : AdminShop1!
  const shopHikesAdmin = await prisma.user.upsert({
    where: { email: 'admin@shophikes.com' },
    update: {
      password: shop1AdminPassword,
      role: Role.ADMIN,
      storeId: shopHikes.id,
    },
    create: {
      // let Prisma generate id
      email: 'admin@shophikes.com',
      password: shop1AdminPassword,
      role: Role.ADMIN,
      storeId: shopHikes.id,
    },
  })

  // ─────────────────────────────────────────────
  // STORE 2 ADMIN (bound to Second Store)
  // ─────────────────────────────────────────────
  // Login:
  //   email: admin@secondstore.com
  //   pass : AdminShop2!
  const secondStoreAdmin = await prisma.user.upsert({
    where: { email: 'admin@secondstore.com' },
    update: {
      password: shop2AdminPassword,
      role: Role.ADMIN,
      storeId: secondStore.id,
    },
    create: {
      email: 'admin@secondstore.com',
      password: shop2AdminPassword,
      role: Role.ADMIN,
      storeId: secondStore.id,
    },
  })

  console.log('Seeded:')
  console.log('- SUPER_ADMIN:', superAdmin.email)
  console.log('- Admin 1 (Shop Hikes):', shopHikesAdmin.email, '→', shopHikes.id)
  console.log('- Admin 2 (Second Store):', secondStoreAdmin.email, '→', secondStore.id)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
