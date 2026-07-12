import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /** preHandler: verifies the Bearer access token and sets request.userId. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    /** Authenticated user id — only set after the authenticate preHandler ran. */
    userId: string;
  }
}

const authGuard: FastifyPluginAsync = async (app) => {
  app.decorateRequest('userId', '');

  app.decorate('authenticate', async (request: FastifyRequest, _reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing or invalid access token');
    }
    request.userId = request.user.sub;
  });
};

export default fp(authGuard, { name: 'auth-guard' });
