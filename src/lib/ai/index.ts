import { loadCoreEnv } from "../env";
import { GroqProvider, MockProvider, type AIProvider } from "./provider";

let cached: AIProvider | undefined;
export function getAIProvider(): AIProvider {
  if (cached) return cached;
  const env = loadCoreEnv();
  cached = env.AI_PROVIDER === "mock" ? new MockProvider() : new GroqProvider(env.GROQ_API_KEY!, env.GROQ_MODEL);
  return cached;
}
