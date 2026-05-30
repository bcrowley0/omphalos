import createClient from "openapi-fetch";
import type { paths } from "./schema";

// Typed client over the GENERATED OpenAPI schema. Every path, param, and
// response shape is derived from the backend's Pydantic models — there are no
// hand-written duplicate interfaces (CLAUDE.md type contract). A backend field
// change regenerates schema.ts and breaks this build, never fails at runtime.
//
// baseUrl "/api" → same-origin /api/* which Next rewrites to FastAPI. A backend
// path like /chart/{symbol} is requested as /api/chart/{symbol} from the browser.
export const api = createClient<paths>({ baseUrl: "/api" });

// Convenience: re-export component schemas so widgets can name canonical types
// without importing the raw schema module.
import type { components } from "./schema";
export type Schemas = components["schemas"];
export type Quote = Schemas["Quote"];
export type Candle = Schemas["Candle"];
export type Position = Schemas["Position"];
export type Balance = Schemas["Balance"];
export type NewsItem = Schemas["NewsItem"];
export type YieldPoint = Schemas["YieldPoint"];
export type SourceStatus = Schemas["SourceStatus"];
