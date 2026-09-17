import express, { Express, NextFunction, Request, Response } from 'express';

import MainRouter from './mainRouter';

import ErrorMiddleware from './common/middlewares/errorMiddleware';
import { MorganConfig } from './common/middlewares/morganConfig';
import { CorsConfig } from './common/middlewares/corsConfig';

import { prisma } from './common/configs/prisma-client';
import cookieParser from 'cookie-parser';
import { MongoDBConfig } from './common/configs/mongodb.config';
import passport from 'passport';
import { GoogleStrategy } from './common/middlewares/googleStrategy';
import { NODE_ENV, RUNNING_PORT } from './common/configs/keys';
import helmet from 'helmet';
import { rateLimitConfig } from './common/middlewares/rateLimitConfig';
import { CronController } from './cron/cron.controller';
import { HttpError } from 'http-errors';

const app: Express = express();
const port: number = RUNNING_PORT;

// req.body 수용 용량을 기존 100kb에서 50mb 수용으로 변경
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(CorsConfig());
if (NODE_ENV === 'prod') {
  // http header 보안 설정
  app.use(helmet());
  // rate limit 설정
  app.use(rateLimitConfig());
  // 프록시 설정
  app.set('trust proxy', true);
}

// cron controller
CronController();

// MongoDB 설정
MongoDBConfig();
// passport 설정
passport.use(GoogleStrategy());
// morgan logger 설정
app.use(MorganConfig());

// Main 라우터에 URL 연결
app.use('/api', MainRouter);

// 에러 핸들링 미들웨어
app.use((error: HttpError, req: Request, res: Response, next: NextFunction) => {
  ErrorMiddleware(error, req, res, next);
});

app.listen(port, () => {
  prisma.$connect();
  console.log(port, '실행중...');
});

// 종료 이벤트
process.on('exit', () => {
  console.log('애플리케이션 종료중...');

  setTimeout(() => {
    prisma.$disconnect();

    process.exit(1);
  }, 2000);
});
