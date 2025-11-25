import { FastifyInstance } from 'fastify'
import { prisma } from '../utils/prisma'
import bcrypt from '@node-rs/bcrypt'

export default async function authRoutes(app: FastifyInstance) {
  app.post(
    '/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string' }
          }
        }
      }
    },
    async (req, reply) => {
      const { email, password } = req.body as any
      const user = await prisma.user.findUnique({ where: { email } })
      if (!user || !(await bcrypt.compare(password, user.password))) {
        return reply.code(401).send({ error: 'Invalid credentials' })
      }
      const token = (app as any).jwt.sign(
        { id: user.id, role: user.role, email: user.email },
        { expiresIn: '7d' }
      )
      return reply.send({ token, role: user.role, storeId: user.storeId })
    }
  )
}
