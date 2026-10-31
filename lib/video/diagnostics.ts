import { z } from "zod"
const count = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER)
const age = count.nullable()
const label = z.string().max(96).regex(/^[A-Za-z0-9._-]*$/)
export const cameraDiagnostics = z.object({
  version: z.literal(1), sampledAt: count, appBuild: z.string().max(32), osVersion: z.string().max(32),
  quality: z.enum(["hd30", "hd60", "uhd30", "uhd60"]), thermalState: z.number().int().min(0).max(3), lowPower: z.boolean(), freeBytes: count,
  network: z.object({ status: label, interface: label, expensive: z.boolean(), constrained: z.boolean() }).strict(),
  stream: z.object({ connected: z.boolean(), encodedFPS: count, queuedBytes: count, queuedBytesPerSecond: count,
    sampleAge: age, secondsWithoutVideoProgress: age, secondsWithoutByteProgress: age }).strict(),
  uploads: z.object({ pending: count, taskCount: count, tasks: z.array(z.object({ task: count, state: count, sent: count,
    expected: count, bytesPerSecond: count, secondsWithoutProgress: count }).strict()).max(6) }).strict(),
  events: z.array(z.object({ at: count, name: label.max(48), detail: label.optional(), code: z.number().int().optional() }).strict()).max(24),
}).strict()
