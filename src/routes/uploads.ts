import { FastifyInstance } from 'fastify';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export default async function uploadsRoutes(app: FastifyInstance) {
  const s3 = new S3Client({
    region: process.env.S3_REGION,
    endpoint: process.env.S3_ENDPOINT,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY || '', secretAccessKey: process.env.S3_SECRET_KEY || '' },
    forcePathStyle: true
  });

  app.post('/uploads/presign', { preHandler: (app as any).admin }, async (req) => {
    const { key, contentType } = req.body as any;
    const url = await getSignedUrl(s3, new PutObjectCommand({
      Bucket: process.env.S3_BUCKET!, Key: key, ContentType: contentType
    }), { expiresIn: 60 });
    return { url, key };
  });
}
