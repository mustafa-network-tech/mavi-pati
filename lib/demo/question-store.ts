import type { UnansweredQuestion } from "@/types";
/** Temporary mock storage. Never used as production persistence. */
export class MockQuestionStore {
  private records = new Map<string, UnansweredQuestion>();
  save(question: UnansweredQuestion) {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [id, record] of this.records)
      if (Date.parse(record.created_at) < cutoff) this.records.delete(id);
    if (this.records.size >= 100)
      this.records.delete(this.records.keys().next().value!);
    this.records.set(question.id, { ...question });
    return { ...question };
  }
  get(id: string, clinicId: string) {
    const record = this.records.get(id);
    return record?.clinic_id === clinicId ? { ...record } : null;
  }
}
