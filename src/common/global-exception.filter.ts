import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';

const ERROR_CODES: Partial<Record<HttpStatus, string>> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_FAILED',
  [HttpStatus.UNAUTHORIZED]: 'AUTHENTICATION_FAILED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.GONE]: 'ACTIVATION_EXPIRED',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
};

const SAFE_MESSAGES: Partial<Record<HttpStatus, string>> = {
  [HttpStatus.BAD_REQUEST]: 'The request could not be validated.',
  [HttpStatus.UNAUTHORIZED]: 'The credentials could not be verified.',
  [HttpStatus.FORBIDDEN]: 'The requested action is not permitted.',
  [HttpStatus.NOT_FOUND]: 'The requested resource was not found.',
  [HttpStatus.CONFLICT]: 'The request conflicts with the current state.',
  [HttpStatus.GONE]: 'The requested credential is expired or no longer available.',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too many requests were received.',
};

@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;

    response.status(status).json({
      error: {
        code: ERROR_CODES[status as HttpStatus] ?? 'INTERNAL_ERROR',
        message: SAFE_MESSAGES[status as HttpStatus] ?? 'An unexpected error occurred.',
        details: [],
        requestId: request.requestId,
      },
    });
  }
}
