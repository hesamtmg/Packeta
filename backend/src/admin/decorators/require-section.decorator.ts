import { SetMetadata } from '@nestjs/common';
import type { AdminSection } from '../admin-sections';

export const REQUIRE_SECTION_KEY = 'requireSection';

// Any-of semantics: a regular admin needs at least one of the listed
// sections granted to pass. Routes with no decorator are left ungated by
// SectionGuard (unchanged from before this system existed) — only
// AdminGuard's role check applies to them.
export const RequireSection = (...sections: AdminSection[]) =>
  SetMetadata(REQUIRE_SECTION_KEY, sections);
