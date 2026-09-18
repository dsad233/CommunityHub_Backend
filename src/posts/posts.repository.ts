import {
  Category,
  PrismaClient,
  State,
  Type,
} from '../../generated/prisma/client';
import { TPaginationDto } from '../common/dto/paginationDto';
import {
  categoryTranslate,
  contextTranslate,
  parseCreatedAt,
} from '../common/utils';
import { TCreatePostDto, TRequestPostDto, TUpdatePostDto } from './dto';
import { PostsSchema } from '../common/configs/mongodb.config';
import { Types } from 'mongoose';
import {
  POST_COMMENT_WEIGHT,
  POST_LIKE_WEIGHT,
  POST_VIEW_WEIGHT,
} from '../common/configs/keys';
import { CategoryType } from '../common/libs/type';
import { IsPublicStatus, OrderByStatus } from '../common/libs/status';

export class PostsRepository {
  private prisma: PrismaClient;
  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  // 게시글 생성
  create = async (userId: string, dto: TCreatePostDto): Promise<void> => {
    const now = new Date();
    const post = await this.prisma.post.create({
      data: {
        title: dto.title,
        context: dto.context ?? null,
        isPublic: dto.isPublic,
        category: dto.category,
        userId: userId,
        createdAt: now,
      },
    });

    if (dto.images?.length) {
      // 이미지를 하나씩 저장
      for (const image of dto.images) {
        await this.createImages(post.id, image);
      }
    }

    new PostsSchema({
      _id: post.id,
      userId: userId,
      createdAt: now,
    }).save();
  };

  // 유저 이미지 조회
  getUserImage = async (userId: string): Promise<string | null> => {
    const image = await this.prisma.image.findFirst({
      where: {
        typeId: userId,
      },
      select: {
        image: true,
      },
    });

    return image?.image
      ? Buffer.from(image.image.buffer).toString('base64')
      : null;
  };

  // 유저 이미지 목록들 조회
  getUserImages = async (
    userIds: string[],
  ): Promise<
    {
      image: string;
      typeId: string;
    }[]
  > => {
    const images = await this.prisma.image.findMany({
      where: {
        typeId: {
          in: userIds,
        },
      },
      select: {
        image: true,
        typeId: true,
      },
    });

    return images.map((image) => {
      return {
        image: Buffer.from(image.image.buffer).toString('base64'),
        typeId: image.typeId,
      };
    });
  };

  // 카테고리 목록 조회
  findCategory = async (): Promise<
    Array<{
      key: string;
      name: string;
    }>
  > => {
    const categories: Array<{
      key: string;
      name: string;
    }> = [];

    for (const category of Object.entries(CategoryType)) {
      categories.push({
        key: category[0],
        name: category[1],
      });
    }

    return categories;
  };

  // 게시글 수 조회
  countPosts = async (category: string): Promise<number> => {
    const where: Record<string, any> = {
      isPublic: State.TRUE,
      deletedAt: State.FALSE,
    };

    if (category === Category.FREE) {
      where['category'] = Category.FREE;
    } else if (category === Category.SPORTS) {
      where['category'] = Category.SPORTS;
    } else if (category === Category.GAME) {
      where['category'] = Category.GAME;
    }

    return await this.prisma.post.count({
      where,
    });
  };

  // 카테고리별 게시글 수 조회
  countByCategoryPost = async (): Promise<
    {
      _count: {
        _all: number;
      };
      category: Category;
    }[]
  > => {
    const counts = await this.prisma.post.groupBy({
      where: {
        isPublic: State.TRUE,
        deletedAt: State.FALSE,
      },
      by: ['category'],
      _count: {
        _all: true,
      },
    });

    return counts;
  };

  // 게시글 조회수 조회
  findPostCount = async (id: string): Promise<number> => {
    const post = await PostsSchema.findById(id);
    return Number(post?.count) || 0;
  };

  // 조회수 높은 게시글 ID들 조회
  topViewPosts = async (
    paginations: TPaginationDto,
  ): Promise<
    {
      _id: Types.UUID;
    }[]
  > => {
    return await PostsSchema.find()
      .select('_id')
      .sort({ count: -1 })
      .limit(Number(paginations.pages));
  };

  // 게시글 전체 조회
  find = async (
    paginations: TPaginationDto,
    query: TRequestPostDto,
    postIds: string[] | null,
  ): Promise<
    {
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
    }[]
  > => {
    let where: Record<string, any> = {
      isPublic: State.TRUE,
      deletedAt: State.FALSE,
    };

    // 게시글 제목, 내용, 작성자 검색
    if (query.search) {
      // 카테고리 조회로 인한 데이터 가공 처리
      let categorySearch;

      if (query.search === Category.FREE) {
        categorySearch = Category.FREE;
      } else if (query.search === Category.SPORTS) {
        categorySearch = Category.SPORTS;
      } else if (query.search === Category.GAME) {
        categorySearch = Category.GAME;
      }

      where['OR'] = [
        {
          title: {
            startsWith: query.search,
          },
        },
        {
          context: {
            startsWith: query.search,
          },
        },
        {
          users: {
            nickname: {
              startsWith: query.search,
            },
          },
        },
        {
          category: {
            equals: categorySearch || undefined,
          },
        },
      ];
    }

    // 카테고리 필터링
    if (query.category) {
      where['category'] = query.category;
    } else if (query.isPublic === IsPublicStatus.PUBLIC) {
      where['isPublic'] = State.TRUE;
    }
    // 조회순으로 정렬
    if (postIds?.length && query.orderBy === OrderByStatus.VIEWS) {
      where['id'] = {
        in: postIds as string[],
      };
    }

    let orderBy: Record<string, any> = {};

    if (query.orderBy === OrderByStatus.NEW) {
      orderBy['createdAt'] = 'desc';
    } else if (query.orderBy === OrderByStatus.COMMENTS) {
      orderBy['comments'] = {
        _count: 'desc',
      };
      // 좋아요 기준으로 인기 게시글을 지정
    } else if (query.orderBy === OrderByStatus.POPULAR) {
      orderBy['likes'] = {
        _count: 'desc',
      };
    }

    const posts = await this.prisma.post.findMany({
      where,
      select: {
        id: true,
        title: true,
        context: true,
        category: true,
        createdAt: true,
        users: {
          select: {
            id: true,
            nickname: true,
            deletedAt: true,
          },
        },
        _count: {
          select: {
            comments: {
              where: {
                deletedAt: State.FALSE,
              },
            },
            likes: true,
          },
        },
      },
      orderBy,
      skip: (Number(paginations.page) - 1) * Number(paginations.pages),
      take: Number(paginations.pages),
    });

    const userImages = await this.prisma.image.findMany({
      where: {
        typeId: {
          in: posts.map((post) => post.users.id),
        },
      },
      select: {
        typeId: true,
        image: true,
      },
    });

    const postsSchema = await PostsSchema.find({
      _id: { $in: posts.map((post) => post.id) },
    }).select('_id count');

    if (query.orderBy === OrderByStatus.POPULAR) {
      return posts
        .map((post) => {
          // 인기 가중치 계산 값
          const popularCount =
            post?._count.likes * POST_LIKE_WEIGHT +
            post?._count.comments * POST_COMMENT_WEIGHT +
            (Number(
              postsSchema.find((schema) => schema._id.toString() === post.id)
                ?.count,
            ) || 0 * POST_VIEW_WEIGHT);

          const ifDeleteUser = post?.users.deletedAt !== State.TRUE;

          const userImage = userImages.find(
            (image) => image.typeId === post.users.id,
          )?.image
            ? Buffer.from(
                userImages.find((image) => image.typeId === post.users.id)
                  ?.image.buffer as ArrayBuffer,
              ).toString('base64')
            : null;
          return {
            id: post?.id,
            title: post?.title,
            context: contextTranslate(post?.context),
            category: categoryTranslate(post?.category),
            createdAt: parseCreatedAt(post?.createdAt, new Date()),
            users: {
              nickname: ifDeleteUser ? post?.users.nickname : '탈퇴 유저',
              image: ifDeleteUser ? userImage : null,
            },
            count: {
              comments: post?._count.comments ?? 0,
              likes: post._count.likes ?? 0,
              views:
                Number(
                  postsSchema.find((schema) => schema.id.toString() === post.id)
                    ?.count,
                ) || 0,
            },
            popularCount: popularCount,
          };
        })
        .sort((post) => {
          if (post.popularCount > 0) {
            return 1;
          } else if (post.popularCount < 0) {
            return -1;
          }

          return 0;
        })
        .map((post) => {
          return {
            id: post?.id,
            title: post?.title,
            context: post?.context,
            category: post?.category,
            createdAt: post?.createdAt,
            users: {
              nickname: post?.users.nickname,
              image: post?.users.image,
            },
            count: post?.count,
          };
        });
    } else if (postIds?.length && query.orderBy === OrderByStatus.VIEWS) {
      return posts.map((post) => {
        const userImage = userImages.find(
          (image) => image.typeId === post.users.id,
        )?.image;
        return {
          id: post?.id,
          title: post?.title,
          context: contextTranslate(post?.context),
          category: categoryTranslate(post?.category),
          createdAt: parseCreatedAt(post?.createdAt, new Date()),
          users: {
            nickname: post?.users.nickname,
            image: userImage
              ? Buffer.from(
                  userImages.find((image) => image.typeId === post.users.id)
                    ?.image.buffer as ArrayBuffer,
                ).toString('base64')
              : null,
          },
          count: {
            comments: post?._count.comments ?? 0,
            likes: post._count.likes ?? 0,
            views:
              Number(
                postsSchema.find((schema) => schema.id.toString() === post.id)
                  ?.count,
              ) || 0,
          },
        };
      });
    }

    return posts.map((post) => {
      const userImage = userImages.find(
        (image) => image.typeId === post.users.id,
      )?.image;
      return {
        id: post?.id,
        title: post?.title,
        context: contextTranslate(post?.context),
        category: categoryTranslate(post?.category),
        createdAt: parseCreatedAt(post?.createdAt, new Date()),
        users: {
          nickname: post?.users.nickname,
          image: userImage
            ? Buffer.from(
                userImages.find((image) => image.typeId === post.users.id)
                  ?.image.buffer as ArrayBuffer,
              ).toString('base64')
            : null,
        },
        count: {
          comments: post?._count.comments ?? 0,
          likes: post._count.likes ?? 0,
          views:
            Number(
              postsSchema.find((schema) => schema.id.toString() === post.id)
                ?.count,
            ) || 0,
        },
      };
    });
  };

  // 게시글 상세 조회
  findOne = async (
    id: string,
  ): Promise<{
    id: string;
    title: string;
    context: string | null;
    category: Category;
    isPublic: State;
    createdAt: Date;
    users: {
      id: string;
      nickname: string;
      deletedAt: State;
    };
    _count: {
      likes: number;
      comments: number;
    };
    comments: {
      id: string;
      context: string;
      type: Type;
      parentId: string | null;
      createdAt: Date;
      deletedAt: State;
      users: {
        id: string;
        nickname: string;
        deletedAt: State;
      };
      _count: {
        likes: number;
      };
      replies: {
        id: string;
        context: string;
        type: Type;
        parentId: string | null;
        createdAt: Date;
        deletedAt: State;
        users: {
          id: string;
          nickname: string;
          deletedAt: State;
        };
        _count: {
          replyLikes: number;
        };
      }[];
    }[];
  } | null> => {
    return await this.prisma.post.findFirst({
      where: {
        id: id,
        isPublic: State.TRUE,
        deletedAt: State.FALSE,
      },
      select: {
        id: true,
        title: true,
        context: true,
        category: true,
        isPublic: true,
        createdAt: true,
        users: {
          select: {
            id: true,
            nickname: true,
            deletedAt: true,
          },
        },
        _count: {
          select: {
            // 게시글 좋아요 수
            likes: {
              where: {
                type: Type.POST,
              },
            },
            // 댓글 수
            comments: {
              where: {
                deletedAt: State.FALSE,
              },
            },
          },
        },
        comments: {
          where: {
            parentId: null,
            type: Type.COMMENT,
            deletedAt: State.FALSE,
          },
          select: {
            id: true,
            context: true,
            type: true,
            parentId: true,
            createdAt: true,
            deletedAt: true,
            users: {
              select: {
                id: true,
                nickname: true,
                deletedAt: true,
              },
            },
            _count: {
              select: {
                // 댓글 좋아요 조회
                likes: {
                  where: {
                    type: Type.COMMENT,
                    replyId: null,
                  },
                },
              },
            },
            replies: {
              where: {
                type: Type.REPLY,
                deletedAt: State.FALSE,
              },
              select: {
                id: true,
                context: true,
                type: true,
                parentId: true,
                createdAt: true,
                deletedAt: true,
                users: {
                  select: {
                    id: true,
                    nickname: true,
                    deletedAt: true,
                  },
                },
                _count: {
                  select: {
                    replyLikes: {
                      where: {
                        type: Type.REPLY,
                        replyId: {
                          not: null,
                        },
                      },
                    },
                  },
                },
              },
              orderBy: {
                createdAt: 'asc',
              },
            },
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });
  };

  // 게시글 기존 정보 조회
  getExistingPostInfo = async (
    id: string,
    userId: string,
  ): Promise<{
    title: string;
    category: Category;
    context: string | null;
    isPublic: State;
  } | null> => {
    return await this.prisma.post.findFirst({
      where: {
        id: id,
        userId: userId,
        deletedAt: State.FALSE,
      },
      select: {
        title: true,
        category: true,
        context: true,
        isPublic: true,
      },
    });
  };

  // 게시글 수정
  update = async (
    id: string,
    userId: string,
    body: TUpdatePostDto,
  ): Promise<void> => {
    await this.prisma.post.update({
      where: {
        id: id,
        userId: userId,
      },
      data: {
        title: body.title,
        context: body.context || null,
        isPublic: body.isPublic,
        category: body.category,
      },
    });
  };

  // 게시글 조회수 업데이트
  updatePostCount = async (id: string): Promise<void> => {
    const postSchema = await PostsSchema.findById(id);

    if (postSchema) {
      postSchema.count += 1n;

      postSchema.save();
    }
  };

  // 게시글 삭제 (소프트 삭제)
  remove = async (id: string, userId: string): Promise<void> => {
    await this.prisma.post.update({
      where: {
        id: id,
        userId: userId,
        deletedAt: State.FALSE,
      },
      data: {
        deletedAt: State.TRUE,
      },
    });
  };

  /**
   * 이미지 처리 관련 로직
   */

  // 게시글 이미지 조회
  getImages = async (id: string): Promise<string[] | null> => {
    const images = await this.prisma.image.findMany({
      where: {
        type: 'POST',
        typeId: id,
      },
      select: {
        image: true,
        createdAt: true,
      },
    });

    const result: string[] = [];

    // createdAt 순으로 정렬 후, 리턴
    images
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      )
      .map((image) => {
        const imageBufferStr = Buffer.from(image.image).toString('base64');
        result.push(imageBufferStr);
      });

    return result.length > 0 ? result : null;
  };

  // 이미지 ID 목록 조회
  getImageIds = async (id: string): Promise<string[] | []> => {
    const imageIds = await this.prisma.image.findMany({
      where: {
        type: 'POST',
        typeId: id,
      },
      select: {
        id: true,
      },
    });

    return imageIds.map((image) => image.id);
  };

  // 이미지 업데이트
  createImages = async (id: string, image: string): Promise<void> => {
    const imageBuffer = Buffer.from(image, 'base64');
    await this.prisma.image.create({
      data: {
        type: 'POST',
        typeId: id,
        image: new Uint8Array(imageBuffer.buffer),
      },
    });
  };

  // 기존 이미지 제거
  removeImages = async (id: string, imageIds: string[]): Promise<void> => {
    await this.prisma.image.deleteMany({
      where: {
        id: {
          in: imageIds,
        },
        type: 'POST',
        typeId: id,
      },
    });
  };
}
