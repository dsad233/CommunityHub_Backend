import { Authority, State } from '../../generated/prisma/enums';
import { PrefixType } from '../common/libs/type';
import { transRoleName } from '../common/utils';
import { RedisService } from '../redis/redis.service';
import { GlobalsRepository } from './globals.repostiroy';

export class GlobalsService {
  private readonly globalsRepository: GlobalsRepository;
  private readonly redisService: RedisService;
  constructor(
    globalsRepository: GlobalsRepository,
    redisService: RedisService,
  ) {
    this.globalsRepository = globalsRepository;
    this.redisService = redisService;
  }

  // 유저 총 인원 조회
  countUsers = async (): Promise<number> => {
    const cached = await this.redisService.get(
      `${PrefixType.CACHED}:${PrefixType.USERS}:${PrefixType.COUNT}`,
    );

    if (cached) {
      return JSON.parse(cached);
    }

    const countUsers = await this.globalsRepository.countUsers();

    if (countUsers) {
      // 유저 총 인원 캐시 적재 (30분)
      await this.redisService.setex(
        `${PrefixType.CACHED}:${PrefixType.USERS}:${PrefixType.COUNT}`,
        1800,
        countUsers,
      );
    }

    return countUsers;
  };

  // 댓글 총 갯수 조회
  countComments = async (): Promise<number> => {
    const cached = await this.redisService.get(
      `${PrefixType.CACHED}:${PrefixType.COMMENTS}:${PrefixType.COUNT}`,
    );

    if (cached) {
      return JSON.parse(cached);
    }

    const countComments = await this.globalsRepository.countComments();

    if (countComments) {
      // 댓글 총 갯수 캐시 적재 (30분)
      await this.redisService.setex(
        `${PrefixType.CACHED}:${PrefixType.COMMENTS}:${PrefixType.COUNT}`,
        1800,
        countComments,
      );
    }

    return countComments;
  };

  // 당일 작성 게시글 갯수 조회
  todayPosts = async (): Promise<number> => {
    const cached = await this.redisService.get(
      `${PrefixType.CACHED}:${PrefixType.TODAY}:${PrefixType.NEW}:${PrefixType.POSTS}`,
    );

    if (cached) {
      return JSON.parse(cached);
    }

    const todayPosts = await this.globalsRepository.todayPosts();

    if (todayPosts) {
      // 당일 작성 게시글 갯수 캐시 적재 (30분)
      await this.redisService.setex(
        `${PrefixType.CACHED}:${PrefixType.TODAY}:${PrefixType.NEW}:${PrefixType.POSTS}`,
        1800,
        todayPosts,
      );
    }

    return todayPosts;
  };

  // 오늘 새 댓글 수, 회원 가입 수, 좋아요 누른 수, 오늘 게시글 작성 수 조회
  todayCounts = async (): Promise<{
    users: number;
    posts: number;
    comments: number;
    likes: number;
  }> => {
    const cachedTodayCounts = await this.redisService.get(
      `${PrefixType.CACHED}:${PrefixType.TODAY}:${PrefixType.NEW}:${PrefixType.COUNT}`,
    );

    if (cachedTodayCounts) {
      return JSON.parse(cachedTodayCounts);
    }

    const results = {
      users: await this.globalsRepository.todayUsers(),
      posts: await this.globalsRepository.todayPosts(),
      comments: await this.globalsRepository.todayComments(),
      likes: await this.globalsRepository.todayLikes(),
    };

    if (results) {
      // 30분 캐시 처리
      await this.redisService.setex(
        `${PrefixType.CACHED}:${PrefixType.TODAY}:${PrefixType.NEW}:${PrefixType.COUNT}`,
        1800,
        JSON.stringify(results),
      );
    }

    return results;
  };

  // 인기 작성자 목록 조회 TOP3
  popularPostUsers = async (): Promise<
    {
      nickname: string;
      posts: number;
      role: string;
    }[]
  > => {
    const cachedPopularUsers = await this.redisService.get(
      `${PrefixType.COUNT}:${PrefixType.POPULAR}:${PrefixType.POSTS}`,
    );

    if (cachedPopularUsers) {
      return JSON.parse(cachedPopularUsers);
    }

    const topUsers = await this.globalsRepository.findByUserId(
      await this.redisService.zrevrange(
        `${PrefixType.COUNT}:${PrefixType.POPULAR}:${PrefixType.POSTS}`,
        0,
        10,
      ),
    );

    const result: {
      nickname: string;
      posts: number;
      role: string;
    }[] = [];

    for (const prop of topUsers) {
      result.push({
        nickname: prop.deletedAt !== State.TRUE ? prop.nickname : '탈퇴 유저',
        posts:
          Number(
            await this.redisService.zscore(
              `${PrefixType.COUNT}:${PrefixType.POPULAR}:${PrefixType.POSTS}`,
              prop.id,
            ),
          ) || 0,
        role: transRoleName(prop.roles?.authority as Authority) as string,
      });
    }

    // 30분 캐시 처리
    await this.redisService.setex(
      `${PrefixType.COUNT}:${PrefixType.POPULAR}:${PrefixType.POSTS}`,
      1800,
      JSON.stringify(result),
    );

    return result;
  };
}
