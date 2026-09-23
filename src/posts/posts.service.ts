import { NotFound } from 'http-errors';
import { TCreatePostDto } from './dto/createPostDto';
import { PostsRepository } from './posts.repository';
import { TPaginationDto } from '../common/dto/paginationDto';
import { TRequestPostDto } from './dto/requestPostDto';
import { Category, State, Type } from '../../generated/prisma/enums';
import { TUpdatePostDto } from './dto/updatePostDto';
import { categoryTranslate, dateFormat, timeFormat } from '../common/utils';
import { RedisService } from '../redis/redis.service';
import { PrefixType } from '../common/libs/type';
import { OrderByStatus } from '../common/libs/status';

export class PostsService {
  private readonly postsRepository: PostsRepository;
  private readonly redisService: RedisService;
  constructor(postsRepository: PostsRepository, redisService: RedisService) {
    this.postsRepository = postsRepository;
    this.redisService = redisService;
  }

  // 게시글 생성
  create = async (userId: string, dto: TCreatePostDto): Promise<void> => {
    await this.postsRepository.create(userId, dto);

    // 인기 작성자 테이블에 저장
    await this.redisService.zincr(
      `${PrefixType.COUNT}:${PrefixType.POPULAR}:${PrefixType.POSTS}`,
      userId,
    );
  };

  // 카테고리 목록 조회
  findCategory = async (): Promise<
    Array<{
      key: string;
      name: string;
    }>
  > => {
    return await this.postsRepository.findCategory();
  };

  // 카테고리별 게시글 수 조회
  countByCategoryPost = async (): Promise<
    {
      key: string;
      name: string;
      count: number;
    }[]
  > => {
    const categoryMap: Record<string, string> = {
      FREE: '자유',
      SPORTS: '스포츠',
      GAME: '게임',
    };

    const result: Array<{
      key: string;
      name: string;
      count: number;
    }> = [];

    const counts = await this.postsRepository.countByCategoryPost();

    if (counts.length) {
      for (let i = 0; i < counts.length; i++) {
        for (const [key, value] of Object.entries(categoryMap)) {
          if (counts[i]?.category === key) {
            result.push({
              key: key,
              name: value,
              count: counts[i]?._count?._all ?? 0,
            });
          }
        }
      }
    }

    return result;
  };

  // 게시글 전체 조회
  find = async (
    paginations: TPaginationDto,
    query: TRequestPostDto,
  ): Promise<{
    posts: {
      id: string;
      title: string;
      context: string | null;
      category: {
        key: string;
        name: string;
      };
      createdAt: string;
      users: { nickname: string; image: string | null };
      count: {
        comments: number;
        likes: number;
        views: number;
      };
    }[];
    paginations: {
      page: number;
      pages: number;
      count: number;
    };
  }> => {
    if (query.orderBy === OrderByStatus.VIEWS) {
      // 검색어가 유효하지 않을 시에만 캐시 사용
      if (!query.search) {
        const cachedPosts = await this.redisService.get(
          `${PrefixType.CACHED}:${PrefixType.POSTS}:page=${paginations.page}:pages=${paginations.pages}:category=${query.category}:orderBy=${OrderByStatus.VIEWS}`,
        );

        // 캐시 히드 시, 캐시 데이터 리턴
        if (cachedPosts) {
          return {
            posts: JSON.parse(cachedPosts),
            paginations: {
              page: Number(paginations.page),
              pages: Number(paginations.pages),
              count: await this.postsRepository.countPosts(
                query.category as string,
              ),
            },
          };
        }
      }

      const postIds = (
        await this.postsRepository.topViewPosts(paginations)
      ).map((schema) => schema._id.toString());

      const posts = await this.postsRepository.find(
        paginations,
        query,
        postIds,
      );

      if (posts) {
        // 캐시 미히트시 캐시 적재 (5분)
        await this.redisService.setex(
          `${PrefixType.CACHED}:${PrefixType.POSTS}:page=${paginations.page}:pages=${paginations.pages}:category=${query.category}:orderBy=${OrderByStatus.VIEWS}`,
          300,
          JSON.stringify(posts),
        );
      }

      return {
        posts: posts,
        paginations: {
          page: Number(paginations.page),
          pages: Number(paginations.pages),
          count: await this.postsRepository.countPosts(
            query.category as string,
          ),
        },
      };
    }

    // 검색어가 유효하지 않을 시에만 캐시 사용
    if (!query.search) {
      const cachedPosts = await this.redisService.get(
        `${PrefixType.CACHED}:${PrefixType.POSTS}:page=${paginations.page}:pages=${paginations.pages}:category=${query.category}:orderBy=${query.orderBy}`,
      );

      // 캐시 히드 시, 캐시 데이터 리턴
      if (cachedPosts) {
        return {
          posts: JSON.parse(cachedPosts),
          paginations: {
            page: Number(paginations.page),
            pages: Number(paginations.pages),
            count: await this.postsRepository.countPosts(
              query.category as string,
            ),
          },
        };
      }
    }

    const posts = await this.postsRepository.find(paginations, query, null);

    if (posts) {
      // 캐시 미히트시 캐시 적재 (5분)
      await this.redisService.setex(
        `${PrefixType.CACHED}:${PrefixType.POSTS}:page=${paginations.page}:pages=${paginations.pages}:category=${query.category}:orderBy=${query.orderBy}`,
        300,
        JSON.stringify(posts),
      );
    }

    return {
      posts: posts,
      paginations: {
        page: Number(paginations.page),
        pages: Number(paginations.pages),
        count: await this.postsRepository.countPosts(query.category as string),
      },
    };
  };

  // 게시글 상세 조회
  findOne = async (
    id: string,
    userId: string,
    userIp: string,
  ): Promise<{
    id: string;
    title: string;
    context: string | null;
    category: {
      key: string;
      name: string;
    };
    images: string[] | null;
    isPublic: State;
    createdAt: string;
    users: { nickname: string; image: string | null; property: boolean };
    count: {
      likes: number;
      commentCount: number;
    };
    comments: {
      id: string | undefined;
      context: string | undefined;
      type: Type | undefined;
      parentId: string | undefined | null;
      createdAt: string | undefined;
      deletedAt: string | undefined;
      author:
        | { nickname: string; image: string | null; property: boolean }
        | undefined;
      count: {
        likes: number | undefined;
      };
      replies:
        | {
            id: string | null;
            context: string | null;
            type: Type | null;
            parentId: string | null;
            createdAt: string | null;
            deletedAt: string;
            author: {
              nickname: string;
              image: string | null;
              property: boolean;
            };
            count: {
              replyLikes: number | null;
            };
          }[]
        | undefined;
    }[];
  }> => {
    const post = await this.postsRepository.findOne(id);

    if (!post) {
      throw new NotFound('게시글을 찾을 수 없습니다.');
    }

    if (userIp) {
      const dupeSession = await this.redisService.get(
        `${PrefixType.POSTS}:${PrefixType.DUPE}:${PrefixType.CONNECT}:postId=${id}:userIp=${userIp.trim()}`,
      );

      if (!dupeSession) {
        await this.redisService.setex(
          `${PrefixType.POSTS}:${PrefixType.DUPE}:${PrefixType.CONNECT}:postId=${id}:userIp=${userIp.trim()}`,
          60 * 10,
          'Duplication count',
        );

        // 게시글 조회수 업데이트
        await this.postsRepository.updatePostCount(id);
      }
    }

    // 게시글에 댓글을 단 유저들의 ID 목록들
    const userIds: string[] = [];

    // 댓글을 단 유저의 ID 목록
    post.comments.map((comment) => {
      userIds.push(comment.users.id);
      comment.replies.map((reply) => {
        userIds.push(reply.users.id);
      });
    });

    const userImages = await this.postsRepository.getUserImages([
      ...new Set(userIds),
    ]);

    const ifDeleteUser = post.users.deletedAt !== State.TRUE;
    return {
      id: post.id,
      title: post.title,
      context: post.context,
      category: categoryTranslate(post.category),
      images: await this.postsRepository.getImages(post.id),
      isPublic: post.isPublic,
      createdAt: dateFormat(post.createdAt) + ' ' + timeFormat(post.createdAt),
      users: {
        nickname: ifDeleteUser ? post.users.nickname : '탈퇴 유저',
        image: ifDeleteUser
          ? await this.postsRepository.getUserImage(post.users.id)
          : null,
        property: userId && userId === post.users.id ? true : false,
      },
      count: {
        likes: post._count.likes ?? 0,
        commentCount: post._count.comments ?? 0,
      },
      comments: post.comments
        .map((comment) => {
          // 삭제된 댓글
          const notDeleted = comment?.deletedAt !== State.TRUE;
          // 삭제된 메시지 댓글 팝업 유지 조건 지정
          const keepComment =
            comment.replies.length > 0 ? '삭제된 댓글 입니다.' : undefined;
          // 탈퇴 유저
          const ifDeleteUser = comment?.users?.deletedAt !== State.TRUE;
          // 해당 유저 이미지 목록 조회
          const userImage = userImages.find(
            (image) => image.typeId === comment.users.id,
          )?.image
            ? (userImages.find((image) => image.typeId === comment.users.id)
                ?.image as string)
            : null;
          return {
            id: notDeleted ? comment?.id : undefined,
            context: notDeleted ? comment?.context : keepComment,
            type: notDeleted ? comment?.type : undefined,
            parentId: notDeleted ? comment?.parentId : undefined,
            createdAt: notDeleted
              ? dateFormat(comment?.createdAt) +
                ' ' +
                timeFormat(comment?.createdAt)
              : undefined,
            author: notDeleted
              ? {
                  nickname: ifDeleteUser
                    ? comment?.users?.nickname
                    : '탈퇴 유저',
                  image: ifDeleteUser ? userImage : null,
                  property:
                    userId && userId === comment?.users?.id ? true : false,
                }
              : undefined,
            deletedAt: comment?.deletedAt,
            count: {
              likes: notDeleted ? comment?._count?.likes || 0 : undefined,
            },
            replies: comment?.replies.map((reply) => {
              // 삭제된 댓글
              const notDeleted = reply?.deletedAt !== State.TRUE;
              // 탈퇴 유저
              const ifDeleteUser = reply?.users?.deletedAt !== State.TRUE;
              // 해당 유저 이미지 목록 조회
              const userImage = userImages.find(
                (image) => image.typeId === comment.users.id,
              )?.image
                ? (userImages.find((image) => image.typeId === reply.users.id)
                    ?.image as string)
                : null;
              return {
                id: notDeleted ? reply?.id : null,
                context: notDeleted ? reply?.context : null,
                type: notDeleted ? reply?.type : null,
                parentId: notDeleted ? reply?.parentId : null,
                createdAt: notDeleted
                  ? dateFormat(reply?.createdAt) +
                    ' ' +
                    timeFormat(reply?.createdAt)
                  : null,
                deletedAt: reply.deletedAt,
                author: {
                  nickname: ifDeleteUser ? reply?.users?.nickname : '탈퇴 유저',
                  image: ifDeleteUser ? userImage : null,
                  property:
                    userId && userId === reply?.users?.id ? true : false,
                },
                count: {
                  replyLikes: notDeleted
                    ? reply?._count?.replyLikes || 0
                    : null,
                },
              };
            }),
          };
        })
        .filter((comment) => {
          // 상위 댓글 삭제, 대댓글 존재
          if (
            !comment.id &&
            comment.context &&
            comment.deletedAt === State.TRUE &&
            comment.replies?.length
          ) {
            return {
              ...comment,
              comments: comment.context,
              replies: comment.replies,
            };
            // 상위 댓글 존재, 대댓글 삭제
          } else if (
            comment.id &&
            comment.deletedAt === State.FALSE &&
            comment.replies?.length === 0
          ) {
            return {
              ...comment,
              replies: undefined,
            };
            // 상위 댓글 존재, 대댓글 존재
          } else if (
            comment.id &&
            comment.deletedAt === State.FALSE &&
            comment.replies?.length
          ) {
            return {
              ...comment,
            };
          }
        }),
    };
  };

  // 게시글 기존 정보 조회
  getExistingPostInfo = async (
    id: string,
    userId: string,
  ): Promise<{
    title: string;
    category: Category;
    context: string | null;
    images: string[] | null;
    isPublic: State;
  }> => {
    const postInfo = await this.postsRepository.getExistingPostInfo(id, userId);

    if (!postInfo) {
      throw new NotFound('게시글을 찾을 수 없습니다.');
    }

    return {
      title: postInfo.title,
      category: postInfo.category,
      context: postInfo.context,
      images: await this.postsRepository.getImages(id),
      isPublic: postInfo.isPublic,
    };
  };

  // 게시글 수정
  update = async (
    id: string,
    userId: string,
    body: TUpdatePostDto,
  ): Promise<void> => {
    await this.postsRepository.update(id, userId, body);

    if (body.images) {
      if (body.images === 'REMOVE') {
        const postImageIds = await this.postsRepository.getImageIds(id);

        // 프로필 이미지가 존재 할때, 프로필 이미지 제거 처리
        if (postImageIds.length > 0) {
          await this.postsRepository.removeImages(id, postImageIds);

          return;
        }
      }

      const postImageIds = await this.postsRepository.getImageIds(id);

      // 기존 이미지가 없다면, 이미지 생성 처리
      if (postImageIds.length === 0) {
        for (const image of body.images) {
          await this.postsRepository.createImages(id, image);
        }

        return;
      }

      // 기존 이미지 삭제 처리
      await this.postsRepository.removeImages(id, postImageIds);

      // 새 이미지로 생성 처리
      for (const image of body.images) {
        await this.postsRepository.createImages(id, image);
      }
    }
  };

  // 게시글 삭제 (소프트 삭제)
  remove = async (id: string, userId: string): Promise<void> => {
    await this.postsRepository.remove(id, userId);
  };
}
