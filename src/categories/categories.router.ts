import express from 'express';
import { prisma } from '../common/configs/prisma-client';
import { redis } from '../redis/redis.config';

import { CategoriesRepository } from './categories.repository';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';

import AsyncWrapper from '../common/middlewares/asyncWrapper';
import { RedisService } from '../redis/redis.service';

const router: express.Router = express.Router();

const categoriesRepository = new CategoriesRepository(prisma);
const categoriesService = new CategoriesService(
  categoriesRepository,
  new RedisService(redis),
);
const categoriesController = new CategoriesController(categoriesService);
// 인기 카테고리 조회
router.get('/popular', AsyncWrapper(categoriesController.popularCategory));

export default router;
