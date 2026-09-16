import { z } from "zod";
export const questionSchema = z.object({
  question: z.string().trim().min(3).max(1000),
});
export const unansweredSchema = questionSchema.extend({
  visitor_name: z.string().trim().min(3).max(100),
  visitor_phone: z
    .string()
    .trim()
    .regex(/^\+?[\d\s()-]{10,22}$/)
    .refine((v) => {
      const n = v.replace(/\D/g, "");
      return n.length >= 10 && n.length <= 15;
    }),
  consent: z.literal(true),
  website: z.string().max(0).optional(),
});
