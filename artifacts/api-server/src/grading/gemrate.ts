import { normaliseGemRateGrade, normaliseGrader, normalizeCollectorNumber, normalizeForMatching, structuredGemRateQuery } from "./normalisation.js";
import { scorePopulationMatch, type ProviderCandidate } from "./matching.js";
import type { CardMatchInput, GradingCardMatch, GradingPopulationProvider, GradingPopulationResult, GraderKey, GraderPopulation } from "./types.js";

const DEFAULT_BASE_URL = "https://api.gemrate.com/v1";
const TIMEOUT_MS = 8_000;

export class GemRateUnavailableError extends Error {
  constructor(public readonly kind: "not_configured" | "upstream" | "unauthorized" | "forbidden") {
    super("Grading population provider is unavailable");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export class GemRateProvider implements GradingPopulationProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  constructor(env = process.env, private readonly request = fetch) {
    this.baseUrl = (env.GEMRATE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.apiKey = env.GEMRATE_API_KEY;
  }

  get configured(): boolean { return Boolean(this.apiKey); }

  private async get(path: string): Promise<Record<string, unknown>> {
    if (!this.apiKey) throw new GemRateUnavailableError("not_configured");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await this.request(`${this.baseUrl}${path}`, {
        headers: { "x-api-key": this.apiKey, accept: "application/json" }, signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 401) throw new GemRateUnavailableError("unauthorized");
        if (response.status === 403) throw new GemRateUnavailableError("forbidden");
        throw new GemRateUnavailableError("upstream");
      }
      return asRecord(await response.json());
    } catch (error) {
      if (error instanceof GemRateUnavailableError) throw error;
      throw new GemRateUnavailableError("upstream");
    } finally { clearTimeout(timeout); }
  }

  async searchCard(input: CardMatchInput): Promise<GradingCardMatch | null> {
    const query = structuredGemRateQuery(input);
    if (!query) return null;
    const envelope = await this.get(`/cards/search/structured?query=${encodeURIComponent(query)}`);
    const data = asRecord(envelope.data);
    const results = asRecord(data.results);
    const candidates: ProviderCandidate[] = [];
    for (const value of Object.values(results)) {
      if (!Array.isArray(value)) continue;
      for (const row of value) {
        const entry = asRecord(row);
        const id = typeof entry.gemrate_id === "string" ? entry.gemrate_id : "";
        const description = typeof entry.description === "string" ? entry.description : "";
        if (!id || !description) continue;
        // Structured search currently returns a description, not a parsed card
        // identity. Without exact fields it must not be auto-confirmed.
        const normalized = normalizeForMatching(description);
        const name = normalizeForMatching(input.name);
        const setName = normalizeForMatching(input.setName);
        const number = normalizeCollectorNumber(input.collectorNumber);
        const compactDescription = description.replace(/\s+/g, "").toLowerCase();
        // The structured endpoint returns descriptions rather than a parsed
        // identity. Only promote its best result when every catalog component
        // is literally present; otherwise it is deliberately review-only.
        candidates.push({
          providerCardId: id,
          description,
          name: normalized.includes(name) ? input.name : null,
          setName: normalized.includes(setName) ? input.setName : null,
          collectorNumber: number && compactDescription.includes(number.replace(/\s+/g, "").toLowerCase()) ? input.collectorNumber : null,
          game: input.game,
          raw: entry,
        });
      }
    }
    if (!candidates.length) return null;
    // GemRate groups identical universal cards by grader. Deduplicate before
    // selecting the best result; not enough evidence means needs_review.
    return scorePopulationMatch(input, candidates[0]!);
  }

  async getPopulation(providerCardId: string): Promise<GradingPopulationResult> {
    const envelope = await this.get(`/cards/${encodeURIComponent(providerCardId)}/population`);
    const data = asRecord(envelope.data);
    const population = asRecord(data.population);
    const populationData = asRecord(population.population_data);
    const byGrader = asRecord(populationData.by_grader);
    const graders: Partial<Record<GraderKey, GraderPopulation>> = {};
    for (const [providerGrader, value] of Object.entries(byGrader)) {
      const grader = normaliseGrader(providerGrader);
      if (!grader) continue;
      const row = asRecord(value);
      const gradeRows = asRecord(row.grades);
      const grades: GraderPopulation["grades"] = {};
      for (const [rawCode, rawPopulation] of Object.entries(gradeRows)) {
        const grade = normaliseGemRateGrade(grader, rawCode);
        grade.population = numberOrNull(rawPopulation);
        grades[grade.code] = grade;
      }
      graders[grader] = { label: grader === "bgs" ? "Beckett / BGS" : grader.toUpperCase(), totalPopulation: numberOrNull(row.total), gemRate: numberOrNull(row.gem_rate), grades };
    }
    return { provider: "gemrate", providerCardId, graders, sourceUpdatedAt: typeof populationData.data_last_updated === "string" ? populationData.data_last_updated : null };
  }
}
