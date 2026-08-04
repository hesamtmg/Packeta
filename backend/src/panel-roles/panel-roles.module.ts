import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PanelRole } from './entities/panel-role.entity';
import { PanelRolesService } from './panel-roles.service';

// No controller here — its routes live on AdminController (see
// admin.controller.ts's /admin/roles endpoints) so they share AdminGuard +
// SectionGuard without duplicating that wiring in a second module.
@Module({
  imports: [TypeOrmModule.forFeature([PanelRole])],
  providers: [PanelRolesService],
  exports: [PanelRolesService],
})
export class PanelRolesModule {}
