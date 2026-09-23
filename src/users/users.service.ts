import { NotFound } from 'http-errors';
import { UsersRepository } from './users.repository';
import {
  Authority,
  Gender,
  Provider,
  State,
  Type,
} from '../../generated/prisma/enums';
import {
  categoryTranslate,
  dateFormat,
  parseCreatedAt,
  transRoleName,
} from '../common/utils';
import {
  TRequestUseCommentDto,
  TRequestUsePostDto,
  TRequestUserDto,
  TUpdateProfileDto,
  TUpdateUserDto,
} from './dto';
import { TPaginationDto } from '../common/dto/paginationDto';
import { RedisService } from '../redis/redis.service';
import { TYPE } from '../common/libs';
export class UsersService {
  private readonly usersRepository: UsersRepository;
  private readonly redisService: RedisService;
  constructor(usersRepository: UsersRepository, redisService: RedisService) {
    this.usersRepository = usersRepository;
    this.redisService = redisService;
  }

  // 유저 마이페이지 조회
  userInfo = async ({
    id,
  }: TRequestUserDto): Promise<{
    id: string;
    email: string;
    nickname: string;
    image: string | null;
    verify: State;
    isPublic: State;
    createdAt: string;
    roles: { authority: string } | null;
    provider: Provider[];
    posts: Array<{
      id: string;
      title: string;
      category: {
        key: string;
        name: string;
      };
      createdAt: string;
      count: {
        comments: number;
        likes: number;
      };
    }>;
    comments: Array<{
      id: string;
      context: string;
      createdAt: string;
      posts: {
        id: string;
        title: string;
      };
    }>;
    count: {
      posts: number;
      comments: number;
    };
  }> => {
    const user = await this.usersRepository.userInfo(id);

    if (!user) {
      throw new NotFound('유저 항목이 존재하지 않습니다.');
    }

    const image = await this.usersRepository.getImage(id);

    const now = new Date();
    return {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      image: image?.image || null,
      verify: user.verify,
      isPublic: user.isPublic,
      createdAt: dateFormat(user.createdAt),
      roles: {
        authority: transRoleName(user.roles?.authority as Authority) as string,
      },
      provider: await this.usersRepository.getAccountType(id),
      posts: user.posts.map((post) => {
        return {
          id: post?.id,
          title: post?.title,
          category: categoryTranslate(post?.category),
          createdAt: parseCreatedAt(post?.createdAt, now),
          count: {
            likes: post?._count?.likes,
            comments: post?._count?.comments,
          },
        };
      }),
      comments: user.comments.map((comment) => {
        return {
          id: comment?.id,
          context: comment?.context,
          createdAt: parseCreatedAt(comment?.createdAt, now),
          posts: {
            id: comment?.posts?.id,
            title: comment?.posts?.title,
          },
        };
      }),
      count: user._count,
    };
  };

  // 해당 받은 좋아요 수 조회(게시글 좋아요)
  receiveLikes = async ({ id }: TRequestUserDto): Promise<number> => {
    // 유저가 소유하고 있는 게시글 postIds 조회
    const postIds = await this.usersRepository.findByPostIds(id);
    return await this.usersRepository.countLikes(postIds);
  };

  // 작성 댓글 목록 조회
  writeUserPosts = async (
    { id }: TRequestUserDto,
    paginations: TPaginationDto,
    query: TRequestUsePostDto,
  ): Promise<{
    posts: {
      id: string;
      title: string;
      context: string | null;
      category: {
        key: string;
        name: string;
      };
      isPublic: State;
      createdAt: string;
      count: {
        comments: number;
        likes: number;
        views: number;
      };
    }[];
    countState: {
      public: number;
      private: number;
    };
    paginations: {
      page: number;
      pages: number;
      count: number;
    };
  }> => {
    return {
      posts: await this.usersRepository.writeUserPosts(id, paginations, query),
      countState: {
        public: await this.usersRepository.writeCountStatePosts(id, State.TRUE),
        private: await this.usersRepository.writeCountStatePosts(
          id,
          State.FALSE,
        ),
      },
      paginations: {
        page: Number(paginations.page),
        pages: Number(paginations.pages),
        count: await this.usersRepository.writeCountPosts(
          id,
          query.category as string,
        ),
      },
    };
  };

  // 유저가 작성한 댓글 목록 조회 (정렬 고려)
  writeUserComments = async (
    id: string,
    paginations: TPaginationDto,
    query: TRequestUseCommentDto,
  ): Promise<{
    comments: {
      id: string;
      context: string;
      type: Type;
      parentId: string | null;
      createdAt: string;
      posts: {
        id: string;
        title: string;
        category: {
          key: string;
          name: string;
        };
      };
      users: {
        nickname: string;
      };
    }[];
    countState: {
      week: number;
      reply: number;
    };
    paginations: {
      page: number;
      pages: number;
      count: number;
    };
  }> => {
    return {
      comments: await this.usersRepository.writeUserComments(
        id,
        paginations,
        query,
      ),
      countState: {
        week: await this.usersRepository.writeCountWeekComments(id),
        reply: await this.usersRepository.writeCountReplies(id),
      },
      paginations: {
        page: Number(paginations.page),
        pages: Number(paginations.pages),
        count: await this.usersRepository.writeCountComments(id, query.type),
      },
    };
  };

  // 유저 기존 프로필 정보 조회
  getExistingProfileInfo = async (
    id: string,
  ): Promise<{
    id: string;
    email: string;
    loginId: string | null;
    nickname: string;
    image: string | null;
    isPublic: State;
  }> => {
    const userProfileInfo =
      await this.usersRepository.getExistingProfileInfo(id);

    if (!userProfileInfo) {
      throw new NotFound('유저 항목이 존재하지 않습니다.');
    }

    const image = await this.usersRepository.getImage(id);

    return {
      ...userProfileInfo,
      image: image?.image || null,
    };
  };

  // 유저 기존 정보 조회
  getExistingInfo = async (
    id: string,
  ): Promise<{
    id: string;
    email: string;
    loginId: string | null;
    name: string | null;
    nickname: string;
    image: string | null;
    gender: Gender | null;
    birthDay: Date | null;
    phoneNumber: string | null;
    address: string | null;
    isPublic: State;
  }> => {
    const userInfo = await this.usersRepository.getExistingInfo(id);

    if (!userInfo) {
      throw new NotFound('유저 항목이 존재하지 않습니다.');
    }

    const image = await this.usersRepository.getImage(id);

    return {
      ...userInfo,
      image: image?.image || null,
    };
  };

  // 유저 프로필 업데이트
  prifileUpdate = async (
    id: string,
    body: TUpdateProfileDto,
  ): Promise<void> => {
    await this.usersRepository.prifileUpdate(id, {
      nickname: body.nickname,
      isPublic: body.isPublic,
    });

    if (body.image) {
      if (body.image === 'REMOVE') {
        const userImage = await this.usersRepository.getImage(id);

        // 프로필 이미지가 존재 할때, 프로필 이미지 제거 처리
        if (userImage) {
          await this.usersRepository.imageRemove(id, userImage.id);
        }

        return;
      }

      const userImage = await this.usersRepository.getImage(id);

      // 프로필 이미지 생성
      if (!userImage) {
        await this.usersRepository.createProfileImage(id, body.image);

        return;
      }

      // 프로필 이미지 업데이트
      await this.usersRepository.imageUpdate(
        id,
        userImage.id as string,
        body.image,
      );

      // 캐시된 user 세션 정보 삭제 처리
      await this.redisService.delete(
        `${TYPE.PrefixType.USERS}:REQUEST:id=${id}`,
      );
    }
  };

  // 유저 정보 업데이트
  update = async (id: string, body: TUpdateUserDto): Promise<void> => {
    await this.usersRepository.update(id, body);

    // 캐시된 user 세션 정보 삭제 처리
    await this.redisService.delete(`${TYPE.PrefixType.USERS}:REQUEST:id=${id}`);
  };

  // 유저 회원 탈퇴
  remove = async (id: string): Promise<void> => {
    // 토큰 제거
    await this.redisService.delete(
      `${TYPE.PrefixType.USERS}:${TYPE.TokenType.ACCESS}:id=${id}`,
    );
    await this.redisService.delete(
      `${TYPE.PrefixType.USERS}:${TYPE.TokenType.REFRESH}:id=${id}`,
    );
    // 캐시된 user 세션 정보 삭제 처리
    await this.redisService.delete(`${TYPE.PrefixType.USERS}:REQUEST:id=${id}`);

    // 탈퇴 처리
    await this.usersRepository.remove(id);
  };
}
