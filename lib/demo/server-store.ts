import "server-only";
import { MockQuestionStore } from "./question-store";
const localGlobal = globalThis as typeof globalThis & {
  clinicMockQuestions?: MockQuestionStore;
};
export function mockQuestionStore() {
  return (localGlobal.clinicMockQuestions ??= new MockQuestionStore());
}
