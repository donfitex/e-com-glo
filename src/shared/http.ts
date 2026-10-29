import { Request, Response, NextFunction, RequestHandler } from 'express';
export function endpoint(
  fn: (req: Request, res: Response) => Promise<unknown>,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}
