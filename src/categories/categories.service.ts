import {
  POST_COMMENT_WEIGHT,
  POST_LIKE_WEIGHT,
  POST_VIEW_WEIGHT,
} from '../common/configs/keys';
import { CategoryType, PrefixType } from '../common/libs/type';
import { RedisService } from '../redis/redis.service';
import { CategoriesRepository } from './categories.repository';

export class CategoriesService {
  private readonly categoriesRepository: CategoriesRepository;
  private readonly redisService: RedisService;
  constructor(
    categoriesRepository: CategoriesRepository,
    redisService: RedisService,
  ) {
    this.categoriesRepository = categoriesRepository;
    this.redisService = redisService;
  }

  // 인기 카테고리 조회
  popularCategory = async (): Promise<string> => {
    const cached = await this.redisService.get(
      `${PrefixType.CACHED}:${PrefixType.POPULAR}:${PrefixType.CATEGORY}`,
    );

    if (cached) {
      return JSON.parse(cached);
    }

    const posts = await this.categoriesRepository.findByCount();
    const postsSchema = await this.categoriesRepository.findByPostsSchema(
      posts.map((post) => post.id),
    );

    // 인기 게시글 조회
    const topPost = posts
      .map((post) => {
        // 인기 가중치 계산 값
        const popularCount =
          post?._count.likes * POST_LIKE_WEIGHT +
          post?._count.comments * POST_COMMENT_WEIGHT +
          (Number(
            postsSchema.find((schema) => schema._id.toString() === post.id)
              ?.count,
          ) || 0 * POST_VIEW_WEIGHT);
        return {
          id: post?.id,
          category: post?.category,
          popularCount: popularCount,
        };
      })
      .sort((prop) => {
        if (prop.popularCount > 0) {
          return 1;
        } else if (prop.popularCount < 0) {
          return -1;
        }

        return 0;
      })
      .slice(0, 1);

    let popularCategory = null;

    for (const prop of Object.entries(CategoryType)) {
      if (prop[0] === topPost[0]?.category) {
        popularCategory = prop[1];
      }
    }

    if (popularCategory) {
      // 30분 캐시 처리
      await this.redisService.setex(
        `${PrefixType.CACHED}:${PrefixType.POPULAR}:${PrefixType.CATEGORY}`,
        1800,
        JSON.stringify(popularCategory),
      );
    }

    return popularCategory || '자유';
  };
}
