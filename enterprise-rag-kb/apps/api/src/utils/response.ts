import { Response } from "express";

export function sendSuccess<T>(res: Response, data: T, requestId?: string): void {
  const body: Record<string, unknown> = { data };
  if (requestId) {
    body.request_id = requestId;
  }
  res.json(body);
}

export function sendError(
  res: Response,
  code: string,
  message: string,
  statusCode: number = 400,
  detail?: Record<string, unknown>,
  requestId?: string
): void {
  const body: Record<string, unknown> = {
    error: { code, message },
  };
  if (detail) {
    (body.error as Record<string, unknown>).detail = detail;
  }
  if (requestId) {
    body.request_id = requestId;
  }
  res.status(statusCode).json(body);
}

export function sendPaginated<T>(
  res: Response,
  items: T[],
  page: number,
  pageSize: number,
  total: number,
  requestId?: string
): void {
  const body: Record<string, unknown> = {
    data: {
      items,
      pagination: {
        page,
        page_size: pageSize,
        total,
        total_pages: Math.ceil(total / pageSize),
      },
    },
  };
  if (requestId) {
    body.request_id = requestId;
  }
  res.json(body);
}
