import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { GlobalsService } from './globals.service';
import { Authority } from '../../generated/prisma/enums';

export class GlobalsController {
  private readonly globalsService: GlobalsService;
  constructor(globalsService: GlobalsService) {
    this.globalsService = globalsService;
  }

  // 유저 총 인원 조회
  countUsers = async (
    req: Request,
    res: Response,
  ): Promise<Response<{ message: string; count: number }>> => {
    return res.status(StatusCodes.OK).json({
      message: '유저 총 인원 조회 완료.',
      count: await this.globalsService.countUsers(),
    });
  };

  // 댓글 총 갯수 조회
  countComments = async (
    req: Request,
    res: Response,
  ): Promise<Response<{ message: string; count: number }>> => {
    return res.status(StatusCodes.OK).json({
      message: '댓글 총 갯수 조회 완료.',
      count: await this.globalsService.countComments(),
    });
  };

  // 당일 작성 게시글 갯수 조회
  todayPosts = async (
    req: Request,
    res: Response,
  ): Promise<Response<{ message: string; count: number }>> => {
    return res.status(StatusCodes.OK).json({
      message: '오늘 게시글 작성 수 조회 완료.',
      count: await this.globalsService.todayPosts(),
    });
  };

  // 오늘 새 댓글 수, 회원 가입 수, 좋아요 누른 수, 오늘 게시글 작성 수 조회
  todayCounts = async (
    req: Request,
    res: Response,
  ): Promise<
    Response<{
      message: string;
      data: {
        users: number;
        posts: number;
        comments: number;
        likes: number;
      };
    }>
  > => {
    return res.status(StatusCodes.OK).json({
      message: '오늘의 활동 통계 조회 완료.',
      data: await this.globalsService.todayCounts(),
    });
  };

  // 인기 작성자 목록 조회 TOP3
  popularPostUsers = async (
    req: Request,
    res: Response,
  ): Promise<
    Response<{
      message: string;
      data: {
        nickname: string;
        posts: number;
        role: Authority;
      }[];
    }>
  > => {
    return res.status(StatusCodes.OK).json({
      message: '인기 게시글 작성자 조회 완료.',
      data: await this.globalsService.popularPostUsers(),
    });
  };
}
