import { Body, Controller, Delete, Patch, Req, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChangePasswordDto } from './dto/change-password.dto';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly service: UsersService) {}

  // Смена своего пароля: тело { currentPassword, newPassword }.
  @Patch('me/password')
  changePassword(@Req() req: { user: { userId: string } }, @Body() dto: ChangePasswordDto) {
    return this.service.changePassword(req.user.userId, dto.currentPassword, dto.newPassword);
  }

  @Delete('me')
  deleteMe(@Req() req: { user: { userId: string } }) {
    return this.service.deleteMe(req.user.userId);
  }
}
