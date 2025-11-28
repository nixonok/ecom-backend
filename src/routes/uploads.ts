// src/routes/uploads.ts
import { FastifyInstance } from 'fastify';
import { createPresignedUploadUrl } from '../utils/s3util';

export default async function uploadsRoutes(app: FastifyInstance) {
  app.post(
    '/uploads/presign',
    { preHandler: (app as any).admin },
    async (req, reply) => {
      const { fileName, fileType, folder } = req.body as any;

      if (!fileName || !fileType) {
        return reply.code(400).send({ error: 'fileName and fileType are required' });
      }

      // Clean file name
      const safeName = String(fileName).replace(/[^a-zA-Z0-9.\-_]/g, '_');

      // Who is uploading?
      const user = (req as any).user as { id?: string; email?: string; storeId?: string } | undefined;

      const adminSegment = user?.storeId ? `shops/${user.storeId}/` : 'shops/unknown/';

      // Folder from client, e.g. "products/my-product-slug/images"
      const baseFolder = folder
        ? String(folder).replace(/^\/+|\/+$/g, '') // trim leading/trailing slashes
        : 'uploads';

      // Final key: admins/{adminId}/{baseFolder}/{timestamp}-{safeName}
      const key = `${adminSegment}${baseFolder}/${Date.now()}-${safeName}`;

      const { uploadUrl, fileUrl } = await createPresignedUploadUrl({
        key,
        contentType: fileType,
        expiresInSeconds: 3600,
      });

      return { uploadUrl, fileUrl, key };
    }
  );
}
