import {
  BadRequest,
  NotFound,
  Unauthorized,
  Conflict,
  Forbidden,
} from 'http-errors';
import { AuthRepository } from './auth.repository';
import { RedisService } from '../redis/redis.service';
import {
  comparePassword,
  filterTexts,
  randomConst,
  regEx,
} from '../common/utils';
import {
  OmitTCreateUserDto,
  TAuthEmailDto,
  TSignInDto,
  TUpdatePasswordRequestDto,
} from './dto';
import { JwtService } from '../jwt/jwt.service';
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET_KEY,
  GOOGLE_LINK_CALLBACK_URL,
  JWT_ACCESS_SECRET_KEY,
  JWT_ACCESS_TTL,
  JWT_REFRESH_SECRET_KEY,
  JWT_REFRESH_TTL,
} from '../common/configs/keys';
import { TYPE } from '../common/libs';
import { MailerService } from '../mailer/mailer.service';
import { Provider, State } from '../../generated/prisma/enums';
import crypto from 'crypto';
import {
  adjectives,
  animals,
  uniqueNamesGenerator,
} from 'unique-names-generator';
import { google } from 'googleapis';
import { TReqUser, TSignUpGoogleReqUser } from '../common/libs/type';

export class AuthService {
  private readonly authRepository: AuthRepository;
  private readonly redisService: RedisService;
  private readonly jwtService: JwtService;
  private readonly mailerService: MailerService;
  constructor(
    authRepository: AuthRepository,
    redisService: RedisService,
    jwtService: JwtService,
    mailerService: MailerService,
  ) {
    this.authRepository = authRepository;
    this.redisService = redisService;
    this.jwtService = jwtService;
    this.mailerService = mailerService;
  }

  // 로그인 아이디 유무 확인
  checkLoginId = async (loginId: string): Promise<boolean> => {
    const alreadyUserId = await this.authRepository.existLoginId(loginId);

    if (alreadyUserId) {
      return false;
    }

    // 비속어 필터링
    if (filterTexts.includes(loginId)) {
      return false;
    }

    return true;
  };

  // 이메일 유무 확인
  checkEmail = async (email: string): Promise<boolean> => {
    const alreadyEmail = await this.authRepository.existEmail(email);

    if (alreadyEmail) {
      return false;
    }

    // 비속어 필터링
    if (filterTexts.includes(email.slice(0, email.indexOf('@')))) {
      return false;
    }

    return true;
  };

  // 닉네임 유무 확인
  checkNickname = async (nickname: string): Promise<boolean> => {
    const alreadyNickname = await this.authRepository.existNickname(nickname);

    if (alreadyNickname) {
      return false;
    }

    // 비속어 필터링
    if (filterTexts.includes(nickname)) {
      return false;
    }

    return true;
  };

  // 이름 유효성 검사
  checkName = async (name: string): Promise<boolean> => {
    // 비속어 필터링
    if (filterTexts.includes(name)) {
      return false;
    }

    return true;
  };

  // 유저 생성
  signUp = async (dto: OmitTCreateUserDto): Promise<void> => {
    const alreadyEmail = await this.authRepository.existEmail(dto.email);

    if (alreadyEmail) {
      throw new Conflict('이미 존재하는 이메일 입니다.');
    }

    const alreadyUserId = await this.authRepository.existLoginId(dto.loginId);

    if (alreadyUserId) {
      throw new Conflict('이미 존재하는 사용자 ID 입니다.');
    }

    const alreadyNickname = await this.authRepository.existNickname(
      dto.nickname,
    );

    if (alreadyNickname) {
      throw new Conflict('이미 존재하는 닉네임 입니다.');
    }

    // 전화번호 입력 값이 존재할 경우, 중복 체크
    if (dto.phoneNumber) {
      const alreadyPhoneNumber = await this.authRepository.existPhoneNumber(
        dto.phoneNumber,
      );
      if (alreadyPhoneNumber) {
        throw new Conflict('이미 존재하는 전화번호 입니다.');
      }
    }

    await this.authRepository.create(dto);

    // 인증 이메일 전송
    await this.mailerService.send(dto.email, null);
  };

  // 유저 이메일 인증 여부 업데이트
  verifyEmail = async (email: string) => {
    const user = await this.authRepository.verifyEmail(email);

    if (!user) {
      throw new NotFound('존재하지 않는 유저 입니다.');
    }

    if (user.verify === State.TRUE) {
      throw new BadRequest('이미 이메일 인증이 완료된 유저 입니다.');
    }

    await this.authRepository.updateVerify(user.id, email);
  };

  // 로그인
  signIn = async (
    dto: TSignInDto,
  ): Promise<{ access_token: string; refresh_token: string }> => {
    // 입력 받은 값이 이메일 이라면,
    if (dto.loginId?.match(regEx.email)) {
      const user = await this.authRepository.emailSigIn(dto.loginId);

      if (!user) {
        throw new NotFound('존재하지 않는 유저 입니다.');
      }

      // 소셜 로그인 여부 확인
      const accountTypes = await this.authRepository.getAccountTypes(user.id);

      // 계정 유형
      const providers = accountTypes.map((account) => account.provider);

      if (providers.length === 0) {
        throw new Forbidden('접근 권한이 없습니다. 문의 해주세요.');
      }

      if (providers.length > 0 && !providers.includes(Provider.GENERAL)) {
        throw new BadRequest(
          '해당 계정은 소셜 계정입니다. 소셜 로그인을 이용해 주세요.',
        );
      }

      if (
        !accountTypes.some(
          (account) =>
            account.email === dto.loginId && account.provider === 'GENERAL',
        )
      ) {
        throw new NotFound('계정이 존재하지 않습니다. 다시 시도해 주세요.');
      }

      if (!(await comparePassword(dto.password, user.password))) {
        throw new BadRequest(
          '패스워드가 일치하지 않습니다. 다시 시도해 주세요.',
        );
      }

      if (user.verify === State.FALSE) {
        throw new BadRequest(
          '이메일 인증이 완료되지 않은 유저입니다. 이메일 인증을 완료 해주세요.',
        );
      }

      const accessToken = await this.jwtService.sign(
        {
          id: user.id,
          email: user.email,
        },
        JWT_ACCESS_SECRET_KEY,
        TYPE.TokenType.ACCESS,
      );
      const refreshToken = await this.jwtService.sign(
        {
          id: user.id,
          email: user.email,
        },
        JWT_REFRESH_SECRET_KEY,
        TYPE.TokenType.REFRESH,
      );

      // access 토큰 설정
      await this.redisService.setex(
        `${TYPE.PrefixType.USERS}:${TYPE.TokenType.ACCESS}:id=${user.id}`,
        JWT_ACCESS_TTL,
        accessToken,
      );
      // refresh 토큰 설정
      await this.redisService.setex(
        `${TYPE.PrefixType.USERS}:${TYPE.TokenType.REFRESH}:id=${user.id}`,
        JWT_REFRESH_TTL,
        refreshToken,
      );

      return { access_token: accessToken, refresh_token: refreshToken };
    }

    const user = await this.authRepository.loginIdSigIn(dto.loginId);

    if (!user) {
      throw new NotFound('존재하지 않는 유저 입니다.');
    }

    if (!(await comparePassword(dto.password, user.password))) {
      throw new BadRequest('패스워드가 일치하지 않습니다. 다시 시도해 주세요.');
    }

    if (user.verify === State.FALSE) {
      throw new BadRequest(
        '이메일 인증이 완료되지 않은 유저입니다. 이메일 인증을 완료 해주세요.',
      );
    }

    const accessToken = await this.jwtService.sign(
      {
        id: user.id,
        loginId: user.loginId,
      },
      JWT_ACCESS_SECRET_KEY,
      TYPE.TokenType.ACCESS,
    );
    const refreshToken = await this.jwtService.sign(
      {
        id: user.id,
        loginId: user.loginId,
      },
      JWT_REFRESH_SECRET_KEY,
      TYPE.TokenType.REFRESH,
    );

    // access 토큰 설정
    await this.redisService.setex(
      `${TYPE.PrefixType.USERS}:${TYPE.TokenType.ACCESS}:id=${user.id}`,
      JWT_ACCESS_TTL,
      accessToken,
    );
    // refresh 토큰 설정
    await this.redisService.setex(
      `${TYPE.PrefixType.USERS}:${TYPE.TokenType.REFRESH}:id=${user.id}`,
      JWT_REFRESH_TTL,
      refreshToken,
    );

    return { access_token: accessToken, refresh_token: refreshToken };
  };

  // 로그아웃
  signOut = async (userId: string): Promise<void> => {
    await this.redisService.delete(
      `${TYPE.PrefixType.USERS}:${TYPE.TokenType.ACCESS}:id=${userId}`,
    );
    await this.redisService.delete(
      `${TYPE.PrefixType.USERS}:${TYPE.TokenType.REFRESH}:id=${userId}`,
    );
    await this.redisService.delete(
      `${TYPE.PrefixType.USERS}:REQUEST:id=${userId}`,
    );
  };

  // 토큰 재발급
  reissue = async (
    refreshToken: string,
  ): Promise<{ access_token: string; refresh_token: string }> => {
    const payload = await this.jwtService.verify(
      refreshToken,
      TYPE.TokenType.REFRESH,
    );

    if (!payload.email && !payload.loginId) {
      throw new Unauthorized(
        '토큰 정보가 일치하지 않습니다. 다시 로그인 해주세요.',
      );
    }

    // 이메일 로그인 처리
    if (payload.email && payload.email.match(regEx.email)) {
      const user = await this.authRepository.verifyEmailPayload(payload.email);

      if (!user) {
        throw new NotFound('존재하지 않는 유저 입니다.');
      }

      // Access 토큰 생성
      const accessToken = await this.jwtService.sign(
        user,
        JWT_ACCESS_SECRET_KEY,
        TYPE.TokenType.ACCESS,
      );

      // RefreshToken 생성
      const refreshToken = await this.jwtService.sign(
        user,
        JWT_REFRESH_SECRET_KEY,
        TYPE.TokenType.REFRESH,
      );

      await this.redisService.setex(
        `${TYPE.PrefixType.USERS}:${TYPE.TokenType.ACCESS}:id=${user.id}`,
        JWT_ACCESS_TTL,
        accessToken,
      );

      await this.redisService.setex(
        `${TYPE.PrefixType.USERS}:${TYPE.TokenType.REFRESH}:id=${user.id}`,
        JWT_REFRESH_TTL,
        refreshToken,
      );

      return { access_token: accessToken, refresh_token: refreshToken };
    }

    const user = await this.authRepository.verifyLoginIdPayload(
      payload.loginId as string,
    );

    if (!user) {
      throw new NotFound('존재하지 않는 유저 입니다.');
    }

    // Access 토큰 생성
    const newAccessToken = await this.jwtService.sign(
      user,
      JWT_ACCESS_SECRET_KEY,
      TYPE.TokenType.ACCESS,
    );

    // RefreshToken 생성
    const newRefreshToken = await this.jwtService.sign(
      user,
      JWT_REFRESH_SECRET_KEY,
      TYPE.TokenType.REFRESH,
    );

    await this.redisService.setex(
      `${TYPE.PrefixType.USERS}:${TYPE.TokenType.ACCESS}:id=${user.id}`,
      JWT_ACCESS_TTL,
      newAccessToken,
    );

    await this.redisService.setex(
      `${TYPE.PrefixType.USERS}:${TYPE.TokenType.REFRESH}:id=${user.id}`,
      JWT_REFRESH_TTL,
      newRefreshToken,
    );

    return { access_token: newAccessToken, refresh_token: newRefreshToken };
  };

  // 패스워드 변경
  updatePassword = async (
    query: TUpdatePasswordRequestDto,
    updatePassword: string,
  ): Promise<void> => {
    const user = await this.authRepository.emailSigIn(query.email);

    if (!user) {
      throw new NotFound('존재하지 않는 유저 입니다.');
    }

    const token = await this.redisService.get(
      `${TYPE.PrefixType.USERS}:PASSWORD:email=${query.email}`,
    );

    if (!token) {
      throw new NotFound(
        '인증 토큰이 만료되었습니다. 다시 이메일 인증을 진행해 주세요.',
      );
    }

    if (token !== query.token) {
      throw new BadRequest(
        '인증 토큰이 일치하지 않습니다. 다시 이메일 인증을 진행해 주세요.',
      );
    }

    await this.authRepository.updatePassword(
      user.id,
      query.email,
      updatePassword,
    );
  };

  // 패스워드 변경 이메일 인증
  certifiEmail = async (email: string): Promise<void> => {
    // 랜덤 상수
    const random = randomConst();

    await this.redisService.setex(
      `${TYPE.PrefixType.USERS}:CERTIFI:email=${email}`,
      // 3분
      300,
      String(random),
    );

    // 이메일 전송
    await this.mailerService.send(email, random);
  };

  // 패스워드 변경 이메일 인증 완료
  authenticationEmail = async (
    email: string,
    body: TAuthEmailDto,
  ): Promise<string> => {
    const authCode = await this.redisService.get(
      `${TYPE.PrefixType.USERS}:CERTIFI:email=${email}`,
    );

    if (!authCode) {
      throw new NotFound('인증 코드가 만료되었습니다. 다시 요청해 주세요.');
    }

    if (Number(authCode) !== body.code) {
      throw new Unauthorized(
        '인증 번호가 일치하지 않습니다. 다시 시도해주세요.',
      );
    }

    // 인증 성공 시, 기존 인증 코드 삭제
    await this.redisService.delete(
      `${TYPE.PrefixType.USERS}:CERTIFI:email=${email}`,
    );

    const token = crypto.randomBytes(32).toString('hex');

    // 인증 성공 시, 패스워드 변경 요청 가능하도록 Redis에 인증 완료 정보 저장 (3분)
    await this.redisService.setex(
      `${TYPE.PrefixType.USERS}:PASSWORD:email=${email}`,
      300,
      token,
    );

    return token;
  };

  /**
   * OAuth 2.0 Google 로그인
   */

  // Google 회원가입 요청
  googleSignUp = async (googleReqUser: TSignUpGoogleReqUser): Promise<void> => {
    const alreadyAccount = await this.authRepository.getAccountTypeUserId(
      googleReqUser.email,
    );

    if (alreadyAccount) {
      throw new Conflict('이미 연동된 계정입니다. 다시 시도해 주세요.');
    }

    const alreadyNickname = await this.authRepository.existNickname(
      googleReqUser.nickname,
    );

    if (alreadyNickname) {
      // 중복된 닉네임이 있을 때, 랜덤 형식의 닉네임을 생성하여 저장
      googleReqUser['nickname'] =
        uniqueNamesGenerator({
          dictionaries: [adjectives, animals],
          length: 2,
        }) +
        Math.floor(Math.random() * (9999 - 1 + 1)) +
        1;
    }

    // 계정 생성
    await this.authRepository.googleUserCreate(googleReqUser);
  };

  // Google 로그인 요청
  googleSignIn = async (
    googleReqUser: TReqUser,
  ): Promise<{ access_token: string; refresh_token: string }> => {
    // 계정 타입 정보 조회
    const accountTypes = await this.authRepository.getAccountTypes(
      googleReqUser.id,
    );

    // 계정 유형
    const providers = accountTypes.map((account) => account.provider);

    if (providers.length === 0) {
      throw new Forbidden('접근 권한이 없습니다. 문의 해주세요.');
    }

    if (providers.length > 0 && !providers.includes(Provider.GOOGLE)) {
      throw new BadRequest(
        '해당 계정은 일반 계정입니다. 일반 로그인을 이용해 주세요.',
      );
    }

    const user = await this.authRepository.emailSigIn(googleReqUser.email);

    if (!user) {
      throw new NotFound('존재하지 않는 유저 입니다.');
    }

    const accessToken = await this.jwtService.sign(
      {
        id: user.id as string,
        email: user.email,
      },
      JWT_ACCESS_SECRET_KEY,
      TYPE.TokenType.ACCESS,
    );
    const refreshToken = await this.jwtService.sign(
      {
        id: user.id as string,
        email: user.email,
      },
      JWT_REFRESH_SECRET_KEY,
      TYPE.TokenType.REFRESH,
    );

    // access 토큰 설정
    await this.redisService.setex(
      `${TYPE.PrefixType.USERS}:${TYPE.TokenType.ACCESS}:id=${user.id}`,
      JWT_ACCESS_TTL,
      accessToken,
    );
    // refresh 토큰 설정
    await this.redisService.setex(
      `${TYPE.PrefixType.USERS}:${TYPE.TokenType.REFRESH}:id=${user.id}`,
      JWT_REFRESH_TTL,
      refreshToken,
    );

    return { access_token: accessToken, refresh_token: refreshToken };
  };

  /**
   * OAuth 2.0 Google 로그인
   */

  // 구글 계정 연동 URL 요청
  googleSocialLink = (): string => {
    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET_KEY,
      GOOGLE_LINK_CALLBACK_URL,
    );

    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['email', 'profile'],
    });
  };

  // 구글 계정 연동 콜백
  googleSocialLinkCallback = async (code: string): Promise<string> => {
    if (!code) {
      throw new NotFound('올바르지 않은 코드 입니다. 다시 시도해 주세요.');
    }

    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET_KEY,
      GOOGLE_LINK_CALLBACK_URL,
    );

    // 구글 토큰 조회
    const { tokens } = await oauth2Client.getToken(code);
    // 발급 받은 토큰으로 자격 인증
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    if (!userInfo) {
      throw new NotFound('올바르지 않은 유저 정보 입니다. 다시 시도해 주세요.');
    }

    return userInfo.data.email as string;
  };

  // 구글 계정 등록 처리
  googleSocialLinkRegister = async (
    id: string,
    email: string,
  ): Promise<void> => {
    // 계정 연동 유무 조회
    const alreadyAccount =
      await this.authRepository.getAccountTypeUserId(email);

    if (alreadyAccount) {
      throw new Conflict('이미 연동된 계정입니다. 다시 시도해 주세요.');
    }

    // 계정 유형 정보 조회
    const accountTypes = await this.authRepository.getAccountTypes(id);

    // 계정 유형
    const providers = accountTypes.map((account) => account.provider);

    if (providers.length === 0) {
      throw new Forbidden('접근 권한이 없습니다. 문의 해주세요.');
    }

    if (providers.length > 0 && !providers.includes(Provider.GENERAL)) {
      throw new BadRequest(
        '해당 계정은 소셜 계정입니다. 소셜 로그인을 이용해 주세요.',
      );
    }

    // 구글 연동 세션 정보 생성
    await this.authRepository.googleSocialLink(id, email);
  };
}
