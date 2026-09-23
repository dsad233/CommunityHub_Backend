import cron from 'node-cron';
import { redis } from '../redis/redis.config';
import { PrefixType } from '../common/libs/type';

export function CronController() {
  // 달 1일 마다 초기화 처리
  cron.schedule('* 5 0 1 * *', async () => {
    // 인기 작성자 TOP3 목록 초기화
    await redis.del(
      `${PrefixType.COUNT}:${PrefixType.POPULAR}:${PrefixType.POSTS}`,
    );
  });
}
