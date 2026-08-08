import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('identity')
@Controller({ path: 'identity/health', version: '1' })
export class HealthController {
  @Get()
  @ApiOkResponse({
    schema: {
      example: { status: 'ok', service: 'edupay-identity' },
    },
  })
  health(): { status: 'ok'; service: 'edupay-identity' } {
    return { status: 'ok', service: 'edupay-identity' };
  }
}
