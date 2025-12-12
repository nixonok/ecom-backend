// src/plugins/auth.ts
import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    // what you sign into the token:
    payload: {
      id: string;
      email: string;
      role: 'SUPER_ADMIN' | 'ADMIN' | 'STAFF' | 'CUSTOMER';
      storeId: string | null;
    };
    // what you’ll get on req.user after verify():
    user: {
      id: string;
      email: string;
      role: 'SUPER_ADMIN' | 'ADMIN' | 'STAFF' | 'CUSTOMER';
      storeId: string | null;
    };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    auth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    admin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    superAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async function authPlugin(app: FastifyInstance) {
  if (!process.env.JWT_SECRET) {
    app.log.warn('JWT_SECRET is not set – using a weak default for dev only');
  }

  app.register(jwt, {
    secret: process.env.JWT_SECRET || 'dev-secret-change-me',
  });

  // Any logged-in user
  app.decorate(
    'auth',
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        await req.jwtVerify(); // -> req.user is typed from FastifyJWT.user
      } catch {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
    }
  );

  // Admin guard: SUPER_ADMIN, ADMIN, STAFF
  app.decorate(
    'admin',
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        await req.jwtVerify();

        if (
          req.user.role !== 'SUPER_ADMIN' &&
          req.user.role !== 'ADMIN' &&
          req.user.role !== 'STAFF'
        ) {
          return reply.code(403).send({ error: 'Forbidden' });
        }
      } catch {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
    }
  );

  // Super-admin only (for store management, multi-tenant setup, etc.)
  app.decorate(
    'superAdmin',
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        await req.jwtVerify();

        if (req.user.role !== 'SUPER_ADMIN') {
          return reply.code(403).send({ error: 'Forbidden' });
        }
      } catch {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
    }
  );
});
