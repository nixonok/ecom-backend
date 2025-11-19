// src/s3.ts
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const region = process.env.AWS_REGION!;
const bucket = process.env.AWS_S3_BUCKET!;

if (!region || !bucket) {
  throw new Error("Missing AWS_REGION or AWS_S3_BUCKET in env.");
}

export const s3Client = new S3Client({
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function createPresignedUploadUrl(params: {
  key: string;
  contentType: string;
  expiresInSeconds?: number;
}) {
  const { key, contentType, expiresInSeconds = 3600 } = params;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, {
    expiresIn: expiresInSeconds,
  });

  // public URL (or usable URL) for later
  const fileUrl = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

  return { uploadUrl, fileUrl };
}
