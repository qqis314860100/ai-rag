declare namespace Express {
  interface Request {
    requestId: string;
    user?: {
      id: string;
      name: string;
      role: string;
      permissions: string[];
      allowedSecurityLevels: string[];
    };
  }
}
