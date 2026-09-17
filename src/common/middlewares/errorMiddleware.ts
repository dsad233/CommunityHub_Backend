import { NextFunction, Request, Response } from 'express';
import { HttpError } from 'http-errors';
import { StatusCodes } from 'http-status-codes';

export default function ErrorMiddleware(
  error: HttpError,
  req: Request,
  res: Response,
  _: NextFunction,
): Response<{ error: string }> {
  return res
    .status(error.statusCode || StatusCodes.INTERNAL_SERVER_ERROR)
    .json({
      error: error.message || '서버 내부 오류가 발생했습니다.',
    });
}
