export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly detail?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    statusCode: number = 400,
    detail?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

export const ErrorCodes = {
  AUTHENTICATION_REQUIRED: "AUTHENTICATION_REQUIRED",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  DOCUMENT_NOT_FOUND: "DOCUMENT_NOT_FOUND",
  DOCUMENT_PARSE_FAILED: "DOCUMENT_PARSE_FAILED",
  EMBEDDING_FAILED: "EMBEDDING_FAILED",
  VECTOR_STORE_UNAVAILABLE: "VECTOR_STORE_UNAVAILABLE",
  LLM_PROVIDER_ERROR: "LLM_PROVIDER_ERROR",
  RAG_CONTEXT_EMPTY: "RAG_CONTEXT_EMPTY",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  MESSAGE_NOT_FOUND: "MESSAGE_NOT_FOUND",
  FEEDBACK_NOT_FOUND: "FEEDBACK_NOT_FOUND",
  FILE_UPLOAD_FAILED: "FILE_UPLOAD_FAILED",
  RAG_SERVICE_ERROR: "RAG_SERVICE_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;
