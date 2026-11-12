import { getPaginationAnalyzerConfig } from './config.ts';
import { requestJson } from './http.ts';
import type { DevpostApiResponse } from './models.ts';
import { normalizePaginationClassifications,normalizePaginationModelSummary } from './pagination-model.ts';
import type {
PaginationAnalysis,
PaginationModelResponse
} from './types.ts';

// The prompt constrains the model to pagination evidence only so the response can be validated safely.
export const buildPaginationAnalysisPrompt = (
  payload: DevpostApiResponse,
  requestedPage: number,
): string =>
  [
    'Inspect this API JSON and determine which fields are valid pagination evidence.',
    'Return JSON with this exact shape:',
    '{',
    '  "classifications": [',
    '    {',
    '      "key": "field_name",',
    '      "path": "payload.meta.total_count",',
    '      "meaning": "why this field matters for pagination",',
    '      "confidence": "high | medium | low"',
    '    }',
    '  ],',
    '  "summary": {',
    '    "totalCount": 0,',
    '    "perPage": 0,',
    '    "totalPages": 0,',
    '    "hasMorePages": true,',
    '    "canFetchAllPages": true,',
    '    "confidence": "high | medium | low | none",',
    '    "recommendation": "plain-English advice"',
    '  }',
    '}',
    'Rules:',
    '- Only include fields that genuinely indicate pagination, page counts, page cursors, offsets, or total item counts.',
    '- Do not include per-item popularity metrics such as registrations_count unless they directly prove pagination.',
    '- Never invent values or field paths.',
    '- You may derive totalPages only from values present in the payload.',
    `- The requested page is ${requestedPage}.`,
    '',
    `Payload:\n${JSON.stringify(payload, null, 2)}`,
  ].join('\n');

export const requestPaginationModelResponse = async (
  payload: DevpostApiResponse,
  requestedPage: number,
  fallback: PaginationAnalysis,
  apiKeyOverride?: string,
): Promise<PaginationModelResponse> => {
  const config = getPaginationAnalyzerConfig(apiKeyOverride);
  const aiConfig = config.ai;

  if (!aiConfig.enabled) {
    return {
      classifications: fallback.signals.map((signal) => ({
        key: signal.path.split('.').at(-1) ?? signal.path,
        path: signal.path,
        meaning: signal.meaning,
        confidence: signal.confidence,
      })),
      summary: {
        totalCount: fallback.totalCount,
        perPage: fallback.perPage,
        totalPages: fallback.totalPages,
        hasMorePages: fallback.hasMorePages,
        canFetchAllPages: fallback.canFetchAllPages,
        confidence: fallback.confidence,
        recommendation: fallback.recommendation,
      },
    };
  }

  const completionUrl = `${aiConfig.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const completionResponse = await requestJson<{
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  }>(completionUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${aiConfig.apiKey}`,
    },
    body: {
      model: aiConfig.model,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: config.aiSystemPrompt,
        },
        {
          role: 'user',
          content: buildPaginationAnalysisPrompt(payload, requestedPage),
        },
      ],
    },
    timeoutMs: aiConfig.timeoutMs,
  });

  if (!completionResponse.ok) {
    throw new Error(
      `AI pagination analyzer request failed with status ${completionResponse.statusCode}.`,
    );
  }

  const aiContent = completionResponse.body.choices?.[0]?.message?.content;

  if (typeof aiContent !== 'string' || aiContent.trim() === '') {
    throw new Error('AI pagination analyzer returned an empty completion payload.');
  }

  let parsedContent: unknown;

  try {
    parsedContent = JSON.parse(aiContent);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown JSON parse error';
    throw new Error(`AI pagination analyzer returned invalid JSON: ${message}`);
  }

  const record =
    typeof parsedContent === 'object' && parsedContent !== null
      ? (parsedContent as Record<string, unknown>)
      : {};

  return {
    classifications: normalizePaginationClassifications(record.classifications),
    summary: normalizePaginationModelSummary(record.summary, fallback),
  };
};
