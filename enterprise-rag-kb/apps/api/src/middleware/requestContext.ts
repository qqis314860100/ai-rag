import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";

export function requestContext(req: Request, _res: Response, next: NextFunction): void {
  req.requestId = (req.headers["x-request-id"] as string) || uuidv4();
  next();
}
