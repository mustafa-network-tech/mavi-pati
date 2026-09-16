export type Clinic = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  whatsapp: string | null;
  phone: string | null;
  address: string | null;
};
export type Knowledge = {
  id: string;
  clinic_id: string;
  category: string;
  canonical_question: string;
  answer_text: string;
  keywords: string[];
  alternative_questions: string[];
  priority: number;
};
export type UnansweredQuestion = {
  id: string;
  clinic_id: string;
  visitor_name: string;
  visitor_phone: string;
  question_text: string;
  normalized_question: string;
  status: "pending";
  created_at: string;
};
