// src/plugins/auth.ts
import fp from 'fastify-plugin'
import jwt from '@fastify/jwt'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

declare module '@fastify/jwt' {
  interface FastifyJWT {
    // what you sign into the token:
    payload: { id: string; role: 'ADMIN' | 'STAFF' | 'CUSTOMER'; email: string }
    // what you’ll get on req.user after verify():
    user: { id: string; role: 'ADMIN' | 'STAFF' | 'CUSTOMER'; email: string }
  }
}

export default fp(async function authPlugin(app: FastifyInstance) {
  if (!process.env.JWT_SECRET) {
    app.log.warn('JWT_SECRET is not set – using a weak default for dev only')
  }
  app.register(jwt, { secret: process.env.JWT_SECRET || 'dev-secret-change-me' })

  // Simple auth preHandler
  app.decorate(
    'auth',
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        await req.jwtVerify() // -> req.user typed from FastifyJWT.user
      } catch {
        return reply.code(401).send({ error: 'Unauthorized' })
      }
    }
  )

  // Admin-only preHandler
  app.decorate(
    'admin',
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        await req.jwtVerify()
        if (req.user.role !== 'ADMIN') {
          return reply.code(403).send({ error: 'Forbidden' })
        }
      } catch {
        return reply.code(401).send({ error: 'Unauthorized' })
      }
    }
  )
})

declare module 'fastify' {
  interface FastifyInstance {
    auth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
    admin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}
