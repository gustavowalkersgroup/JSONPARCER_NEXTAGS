import { z } from 'zod';

// Schema zod (lenient) do payload NexTags Messenger. Modela o contrato sem ser
// excessivamente estrito (payload de attachment fica aberto) para servir de
// oráculo de validade pós-correção sem gerar falsos negativos.

export const buttonSchema = z.object({
  type: z.enum(['web_url', 'postback']),
  title: z.string(),
  url: z.string().optional(),
  payload: z.string().optional(),
});

export const templateElementSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  image_url: z.string().optional(),
  buttons: z.array(buttonSchema).optional(),
});

export const templatePayloadSchema = z.object({
  template_type: z.enum(['generic', 'button']),
  text: z.string().optional(),
  image_aspect_ratio: z.enum(['horizontal', 'square']).optional(),
  elements: z.array(templateElementSchema).optional(),
  buttons: z.array(buttonSchema).optional(),
});

export const attachmentSchema = z.object({
  type: z.enum(['image', 'video', 'audio', 'file', 'template']),
  payload: z.record(z.unknown()),
});

export const messageSchema = z.object({
  text: z.string().optional(),
  attachment: attachmentSchema.optional(),
});

export const messageItemSchema = z.union([
  z.object({ message: messageSchema }),
  z.number().int().min(1).max(30),
]);

export const actionSchema = z.object({ action: z.string() }).passthrough();

export const payloadSchema = z.object({
  messages: z.array(messageItemSchema).optional(),
  actions: z.array(actionSchema).optional(),
});

export function isValidPayload(p: unknown): { ok: boolean; issues: string[] } {
  const r = payloadSchema.safeParse(p);
  if (r.success) return { ok: true, issues: [] };
  return { ok: false, issues: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
}
