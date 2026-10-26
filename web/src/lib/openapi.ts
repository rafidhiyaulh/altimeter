// OpenAPI 3.1 description of the partner API, served at /api/v1/openapi.
const half = { type: 'number', minimum: 0, maximum: 9, multipleOf: 0.5 }
const err = { description: 'RFC 9457 problem details', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } }
const writeHeaders = [
  { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', maxLength: 100 }, description: 'Retries with the same key and body replay the first response.' },
  { name: 'Altimeter-Signature', in: 'header', required: true, schema: { type: 'string', example: 't=1761475200,v1=5f2c...' }, description: 'HMAC-SHA256 with the API key over `${t}.${raw body}`; t within 5 minutes.' },
]

export const openapi = {
  openapi: '3.1.0',
  info: { title: 'Altimeter partner API', version: '1.0.0',
    description: 'Push practice results, essays and official scores from a prep platform; pull readiness forecasts. Every call is scoped to the institution that owns the API key.' },
  servers: [{ url: '/api/v1' }],
  security: [{ bearer: [] }],
  components: {
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'alt_live_... key, shown once at creation; stored only as SHA-256.' } },
    schemas: {
      Problem: { type: 'object', properties: { type: { type: 'string' }, title: { type: 'string' }, status: { type: 'integer' }, detail: { type: 'string' } } },
      Skill: { type: 'string', enum: ['reading', 'listening', 'writing', 'speaking'] },
    },
  },
  paths: {
    '/students': { post: { summary: 'Create or update learners', parameters: writeHeaders,
      requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['students'], properties: { students: { type: 'array', maxItems: 500, items: {
        type: 'object', required: ['ref', 'name', 'cohort'], properties: { ref: { type: 'string' }, name: { type: 'string' }, cohort: { type: 'string', description: 'cohort key' }, birth_year: { type: 'integer' } } } } } } } } },
      responses: { 200: { description: 'Upserted count' }, 400: err, 401: err, 422: err, 429: err } } },
    '/attempts': { post: { summary: 'Ingest practice results', description: 'Each learner touched gets one coalesced readiness job.', parameters: writeHeaders,
      requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['attempts'], properties: { attempts: { type: 'array', maxItems: 500, items: {
        type: 'object', required: ['student_ref', 'skill', 'source', 'band', 'taken_at'], properties: { student_ref: { type: 'string' }, skill: { $ref: '#/components/schemas/Skill' },
          source: { type: 'string', enum: ['practice', 'mock', 'ai_speaking'] }, band: half, raw_score: { type: 'integer', minimum: 0, maximum: 40 }, taken_at: { type: 'string', format: 'date-time' } } } } } } } } },
      responses: { 202: { description: '{ inserted, unknown_learners, readiness_jobs }' }, 400: err, 401: err, 422: err, 429: err } } },
    '/essays': { post: { summary: 'Queue a Writing Task 2 essay for scoring', parameters: writeHeaders,
      requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['student_ref', 'prompt', 'body'], properties: { student_ref: { type: 'string' }, prompt: { type: 'string' }, body: { type: 'string', minLength: 200 } } } } } },
      responses: { 202: { description: '{ id, status: "queued", poll }' }, 400: err, 401: err, 422: err, 429: err } } },
    '/essays/{id}': { get: { summary: 'Essay status and score', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'status, score { overall, interval80, criteria, flags, model_version }' }, 401: err, 404: err } } },
    '/students/{ref}/readiness': { get: { summary: 'Current readiness forecast', parameters: [{ name: 'ref', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 200: { description: 'status, p_target, binding skill, per-skill level / pace / projection, model and calibration versions' }, 401: err, 404: err } } },
    '/official-results': { post: { summary: 'Record an official IELTS result (calibrates practice scores)', parameters: writeHeaders,
      requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['student_ref', 'test_date', 'reading', 'listening', 'writing', 'speaking', 'overall'],
        properties: { student_ref: { type: 'string' }, test_date: { type: 'string', format: 'date' }, reading: half, listening: half, writing: half, speaking: half, overall: half,
          verified: { type: 'string', enum: ['self_reported', 'trf_verified'] } } } } } },
      responses: { 201: { description: '{ id }' }, 400: err, 401: err, 422: err, 429: err } } },
  },
}
