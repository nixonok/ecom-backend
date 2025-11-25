// prisma/seed.ts

import bcrypt from '@node-rs/bcrypt'
import { prisma } from '../src/utils/prisma'

async function main() {
  const hash = await bcrypt.hash('ChangeThisPwd!', 12)
  await prisma.store.upsert({
    where: { id: 'cmidw2xlc0000n0e00dgk8std' },
    update: {},
    create: { id: 'cmidw2xlc0000n0e00dgk8std', name: 'My Shop', slug: 'my-shop' },
  })
  await prisma.user.upsert({
    where: { email: 'admin@shophikes.com' },
    update: { password: hash },
    create: {
      id: 'cmidw2xlc0001n0e00dgk8std',
      email: 'admin@shophikes.com',
      password: hash,
      role: 'ADMIN',
      storeId: 'cmidw2xlc0000n0e00dgk8std',
    },
  })
}
main()