import { IsUUID, ValidateIf } from 'class-validator';

export class AssignPanelRoleDto {
  // Explicit null clears the assignment — @IsOptional() would also accept
  // `undefined`, which reads as "field left out" rather than "unassign", so
  // this only skips validation when the value is exactly null.
  @ValidateIf((dto: AssignPanelRoleDto) => dto.panelRoleId !== null)
  @IsUUID()
  panelRoleId: string | null;
}
