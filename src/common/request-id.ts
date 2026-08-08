import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { Injectable } from '@nestjs/common';

const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

@Injectable()
export class RequestIdMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const supplied = request.header(REQUEST_ID_HEADER);
    const requestId = supplied && SAFE_REQUEST_ID.test(supplied) ? supplied : `req_${randomUUID()}`;

    request.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);
    next();
  }
}

declare global {
  // Express exposes request extension points through its global namespace.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}
