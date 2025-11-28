// src/utils/s3util.ts
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const region = process.env.AWS_REGION!
const bucket = process.env.AWS_S3_BUCKET!

if (!region || !bucket) {
  throw new Error('Missing AWS_REGION or AWS_S3_BUCKET in env.')
}

export const s3Client = new S3Client({
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

/**
 * Create a presigned URL for uploading a file to S3 from the client.
 * Used by the /uploads/presign endpoint.
 */
export async function createPresignedUploadUrl(params: {
  key: string
  contentType: string
  expiresInSeconds?: number
}) {
  const { key, contentType, expiresInSeconds = 3600 } = params

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  })

  const uploadUrl = await getSignedUrl(s3Client, command, {
    expiresIn: expiresInSeconds,
  })

  // Public URL for later use in the app
  const fileUrl = `https://${bucket}.s3.${region}.amazonaws.com/${key}`

  return { uploadUrl, fileUrl }
}

/**
 * Extract the S3 object key from a full S3 URL.
 * Falls back to returning the input if it is already a key.
 *
 * Example:
 *   https://ecom-file-uploads-sg.s3.ap-southeast-1.amazonaws.com/admins/nixonokk@gmail.com/categories/icons/1764334290635-hot-pot.png
 *   -> admins/nixonokk@gmail.com/categories/icons/1764334290635-hot-pot.png
 */
export function extractKeyFromUrl(url: string): string {
  try {
    const u = new URL(url)
    // pathname starts with "/"
    return decodeURIComponent(u.pathname.replace(/^\/+/, ''))
  } catch {
    // If it's not a valid URL, assume the string is already a key
    return url
  }
}

/**
 * Delete a single S3 object by key.
 */
export async function deleteObjectByKey(key: string): Promise<void> {
  if (!key) return

  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  )
}

/**
 * Delete a single S3 object using its full URL.
 */
export async function deleteObjectByUrl(url: string): Promise<void> {
  if (!url) return
  const key = extractKeyFromUrl(url)
  if (!key) return

  await deleteObjectByKey(key)
}

/**
 * Delete many S3 objects given an array of URLs.
 * Uses DeleteObjects when there are multiple keys.
 */
export async function deleteObjectsByUrls(urls: string[]): Promise<void> {
  const keys = (urls || [])
    .filter(Boolean)
    .map((url) => extractKeyFromUrl(url))
    .filter(Boolean)

  if (!keys.length) return

  if (keys.length === 1) {
    return deleteObjectByKey(keys[0]!)
  }

  await s3Client.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: keys.map((Key) => ({ Key })),
      },
    })
  )
}

/**
 * Delete every object under a given prefix (a "folder").
 * Example prefix:
 *   admins/nixonokk@gmail.com/stores/<storeId>/products/<slug>/
 *
 * Not strictly required for now, but handy if you later store
 * a "productFolderPrefix" in the DB and want to nuke everything.
 */
export async function deleteAllByPrefix(prefix: string): Promise<void> {
  if (!prefix) return

  let continuationToken: string | undefined

  do {
    const listed = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    )

    const contents = listed.Contents ?? []
    if (!contents.length) {
      break
    }

    await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: contents.map((obj) => ({ Key: obj.Key! })),
        },
      })
    )

    continuationToken = listed.IsTruncated
      ? listed.NextContinuationToken
      : undefined
  } while (continuationToken)
}
