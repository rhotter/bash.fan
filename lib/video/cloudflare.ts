import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

export function videoConfiguration() {
  return {
    r2: ["CLOUDFLARE_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_VIDEO_BUCKET"].every(k => !!process.env[k]),
    stream: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_STREAM_TOKEN"].every(k => !!process.env[k]),
  }
}
function storage() {
  if (!videoConfiguration().r2) throw new Error("R2 is not configured")
  return new S3Client({ region: "auto", endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" })
}
export async function uploadUrl(key: string, bytes: number) {
  return getSignedUrl(storage(), new PutObjectCommand({ Bucket: process.env.R2_VIDEO_BUCKET, Key: key,
    ContentType: "video/mp4", ContentLength: bytes }), { expiresIn: 3600 })
}
export async function playbackUrl(key: string) {
  return getSignedUrl(storage(), new GetObjectCommand({ Bucket: process.env.R2_VIDEO_BUCKET, Key: key }), { expiresIn: 3600 })
}
export async function verifyUpload(key: string, bytes: number) {
  const object = await storage().send(new HeadObjectCommand({ Bucket: process.env.R2_VIDEO_BUCKET, Key: key }))
  return object.ContentLength === bytes && object.ContentType === "video/mp4"
}
export async function streamRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (!videoConfiguration().stream) throw new Error("Cloudflare Stream is not configured")
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/stream/${path}`, {
    ...init, headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_STREAM_TOKEN}`, "Content-Type": "application/json" },
    cache: "no-store", signal: AbortSignal.timeout(15000),
  })
  const body = await response.json()
  if (!response.ok || !body.success) throw new Error("Cloudflare Stream request failed")
  return body.result as T
}
export interface LiveInput { uid: string; rtmps: { url: string; streamKey: string }; playback?: { hls: string; dash: string } }
