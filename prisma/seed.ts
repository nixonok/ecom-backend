// prisma/seed.ts

import bcrypt from '@node-rs/bcrypt'
import { prisma } from '../src/utils/prisma'

async function main() {
  const hash = await bcrypt.hash('ChangeThisPwd!', 12)
  await prisma.store.upsert({
    where: { id: 'shophikes.com' },
    update: {},
    create: { id: 'shophikes.com', name: 'Shop Hikes', slug: 'shop-hikes' },
  })
  await prisma.user.upsert({
  where: { email: 'admin@shophikes.com' },
  update: {
    password: hash,
    role: 'ADMIN',
    storeId: 'shophikes.com',
  },
  create: {
    id: 'shophikes',
    email: 'admin@shophikes.com',
    password: hash,
    role: 'ADMIN',
    storeId: 'shophikes.com',
  },
})
}

main()